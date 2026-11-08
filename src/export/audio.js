// Audio file formats for the export: WAV (16 or 24 bit), MP3 and M4A (AAC).
//
// Every format starts from the same master: the offline render (two channels) and one gain
// (the −14 LUFS gain when loudness matching is on, otherwise the gain that brings the peak to 0.9).
// WAV is written here; M4A uses the browser's own AAC encoder (WebCodecs) packed by mp4-muxer;
// MP3 uses LAME (lamejs, LGPL), loaded from a CDN only when MP3 is chosen and never bundled.
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { clamp } from "../core/util.js";
import { wavFromChannels } from "./wavzip.js";

export const AUDIO_FORMATS = {
  wav16: { name: "WAV, 16-bit", ext: "wav", mime: "audio/wav", note: "Uncompressed, CD quality. Plays everywhere." },
  wav24: { name: "WAV, 24-bit", ext: "wav", mime: "audio/wav", note: "Uncompressed, with extra detail for mixing and mastering." },
  mp3: { name: "MP3", ext: "mp3", mime: "audio/mpeg", rates: [320, 192, 128], note: "Small and plays everywhere. The first time, a small encoder downloads (about 150 kB)." },
  m4a: { name: "M4A (AAC)", ext: "m4a", mime: "audio/mp4", rates: [256, 192, 128], note: "Smaller than MP3 at the same quality. Great for phones." }
};
export const LAME_URL = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";

// The gain every format applies: fixed (loudness), or the one that brings the peak to 0.9 (at most ×4).
export function masterGain(chs, fixedGain = null) {
  if (fixedGain !== null && fixedGain !== undefined) return fixedGain;
  let peak = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
  return peak > 0 ? Math.min(4, 0.9 / peak) : 1;
}

// WAV: 16-bit (the existing writer) or 24-bit little-endian PCM.
export function wavEncode(chs, sr, gain, bits = 16) {
  if (bits !== 24) return wavFromChannels(chs, sr, gain);
  const nc = chs.length, len = chs[0].length, bytes = len * nc * 3;
  const dv = new DataView(new ArrayBuffer(44 + bytes));
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + bytes, true); ws(8, "WAVE"); ws(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * nc * 3, true); dv.setUint16(32, nc * 3, true); dv.setUint16(34, 24, true); ws(36, "data"); dv.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nc; c++) {
    const v = Math.round(clamp(chs[c][i] * gain, -1, 1) * 8388607);
    dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255); o += 3;
  }
  return new Uint8Array(dv.buffer);
}

// Yields to the page without timers (a hidden tab throttles setTimeout to once a second).
export const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });

// 16-bit integer copy of a block of one channel, with the gain.
function int16(ch, from, n, gain) {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(clamp(ch[from + i] * gain, -1, 1) * 32767);
  return out;
}

let lamePromise = null;
export function loadLame(url = LAME_URL) {
  if (typeof window !== "undefined" && window.lamejs) return Promise.resolve(window.lamejs);
  if (!lamePromise) lamePromise = new Promise((resolve, reject) => {
    const s = document.createElement("script"); s.src = url; s.async = true; s.crossOrigin = "anonymous";
    s.onload = () => (window.lamejs ? resolve(window.lamejs) : reject(new Error("The MP3 encoder didn't load.")));
    s.onerror = () => { lamePromise = null; reject(new Error("The MP3 encoder couldn't be downloaded (offline?).")); };
    document.head.appendChild(s);
  });
  return lamePromise;
}

// MP3, constant bit rate, stereo; yields to the page between blocks.
export async function mp3Encode(chs, sr, gain, kbps = 320, onProgress = null) {
  const lame = await loadLame();
  const enc = new lame.Mp3Encoder(2, sr, kbps), parts = [], len = chs[0].length, B = 1152 * 32;
  for (let o = 0; o < len; o += B) {
    const n = Math.min(B, len - o), buf = enc.encodeBuffer(int16(chs[0], o, n, gain), int16(chs[1] || chs[0], o, n, gain));
    if (buf.length) parts.push(new Uint8Array(buf));
    if (onProgress) onProgress(o / len);
    await tick();
  }
  const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: "audio/mpeg" });
}

// Audio for WebCodecs: f32-planar blocks of 4096 frames, with the gain.
// offset: the first sample's position in the piece (for the timestamps)
export function encodeAudioData(encoder, chs, sr, gain, offset = 0) {
  const len = chs[0].length, B = 4096;
  for (let o = 0; o < len; o += B) {
    const n = Math.min(B, len - o), data = new Float32Array(n * 2);
    for (let c = 0; c < 2; c++) { const ch = chs[c] || chs[0]; for (let i = 0; i < n; i++) data[c * n + i] = clamp(ch[o + i] * gain, -1, 1); }
    const ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(((offset + o) * 1e6) / sr), data });
    encoder.encode(ad); ad.close();
  }
}

// The first audio codec this browser can encode for an MP4 container: AAC, else Opus.
export async function pickAudioCodec(sr, kbps = 192, only = null) {
  if (typeof AudioEncoder === "undefined") return null;
  for (const c of [{ mux: "aac", codec: "mp4a.40.2" }, { mux: "opus", codec: "opus" }].filter(c => !only || c.mux === only)) {
    const config = { codec: c.codec, sampleRate: sr, numberOfChannels: 2, bitrate: kbps * 1000 };
    try { if ((await AudioEncoder.isConfigSupported(config)).supported) return { ...c, config }; } catch (e) { /* try the next */ }
  }
  return null;
}
export async function aacSupported(sr = 44100) { const c = await pickAudioCodec(sr); return !!c && c.mux === "aac"; }

// M4A: AAC in an MP4 container (audio only).
export async function m4aEncode(chs, sr, gain, kbps = 256) {
  const pick = await pickAudioCodec(sr, kbps);
  if (!pick || pick.mux !== "aac") throw new Error("This browser can't encode AAC; choose MP3 or WAV.");
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, audio: { codec: "aac", numberOfChannels: 2, sampleRate: sr }, fastStart: "in-memory", firstTimestampBehavior: "offset" });
  let err = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { err = e; } });
  enc.configure(pick.config);
  encodeAudioData(enc, chs, sr, gain);
  await enc.flush(); enc.close();
  if (err) throw err;
  muxer.finalize();
  return new Blob([target.buffer], { type: "audio/mp4" });
}

// One entry point: the encoded file for a format id.
export async function encodeAudio(format, chs, sr, gain, kbps, onProgress) {
  if (format === "wav24") return new Blob([wavEncode(chs, sr, gain, 24)], { type: "audio/wav" });
  if (format === "mp3") return mp3Encode(chs, sr, gain, kbps, onProgress);
  if (format === "m4a") return m4aEncode(chs, sr, gain, kbps);
  return new Blob([wavEncode(chs, sr, gain, 16)], { type: "audio/wav" });
}

// The channels at another sample rate (for Opus, which wants 48 kHz), through an offline context.
export async function resampleChannels(chs, sr, target) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const len = Math.round((chs[0].length * target) / sr), ctx = new OAC(chs.length, len, target);
  const buf = ctx.createBuffer(chs.length, chs[0].length, sr);
  chs.forEach((c, i) => buf.copyToChannel(c, i));
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
  const out = await ctx.startRendering();
  return chs.map((_, i) => out.getChannelData(i));
}
