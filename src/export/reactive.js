// What the video reads from the sound: loudness, beats and a spectrum, frame by frame.
//
// From the rendered audio when it is there (the export, and the preview once the piece has been
// rendered in the background); from the notes otherwise (kick hits and a loudness estimate), so
// the preview reacts at once.
import FFT from "fft.js";
import { clamp } from "../core/util.js";

export const BANDS = 40;
const N = 2048, fft = new FFT(N);
const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));

/*
 * chs: rendered channels, sr: sample rate. Returns { fps, frames, rms, beat, bands (frames × BANDS),
 * env (160-bin overview), wave(sec, n) }, all in [0, 1].
 */
export function analyzeAudio(chs, sr, fps = 60) {
  const len = chs[0].length, R = chs[1] || chs[0], mono = new Float32Array(len);
  for (let i = 0; i < len; i++) mono[i] = 0.5 * (chs[0][i] + R[i]);
  const frames = Math.max(1, Math.ceil((len / sr) * fps)), hop = sr / fps;
  const rms = new Float32Array(frames), low = new Float32Array(frames), bands = new Float32Array(frames * BANDS);
  // band edges: log-spaced from 40 Hz to 16 kHz
  const edges = Array.from({ length: BANDS + 1 }, (_, b) => 40 * (16000 / 40) ** (b / BANDS));
  const bin = f => Math.max(1, Math.min(N / 2 - 1, Math.round((f / sr) * N)));
  const input = new Float32Array(N), out = fft.createComplexArray();
  for (let f = 0; f < frames; f++) {
    const c = Math.round(f * hop), s0 = c - N / 2;
    let e = 0;
    for (let i = 0; i < N; i++) { const k = s0 + i, v = k >= 0 && k < len ? mono[k] : 0; input[i] = v * hann[i]; }
    for (let i = Math.max(0, c - Math.round(hop)); i < Math.min(len, c + Math.round(hop)); i++) e += mono[i] * mono[i];
    rms[f] = Math.sqrt(e / Math.max(1, 2 * hop));
    fft.realTransform(out, input);
    const mag = k => Math.hypot(out[2 * k], out[2 * k + 1]);
    for (let b = 0; b < BANDS; b++) {
      let m = 0, n = 0; for (let k = bin(edges[b]); k <= bin(edges[b + 1]); k++) { m += mag(k); n++; }
      const db = 20 * Math.log10(m / Math.max(1, n) / (N / 4) + 1e-9);
      bands[f * BANDS + b] = clamp((db + 72) / 66);
    }
    let lo = 0; for (let k = bin(40); k <= bin(160); k++) lo += mag(k); low[f] = lo;
  }
  // display: bands fall slowly (a release of about 0.25 s), like a meter
  const rel = Math.exp(-1 / (0.25 * fps));
  for (let f = 1; f < frames; f++) for (let b = 0; b < BANDS; b++) { const i = f * BANDS + b; bands[i] = Math.max(bands[i], bands[i - BANDS] * rel); }
  // beats: positive change of the low band, normalized by a running peak, held with a 0.18 s decay
  const beat = new Float32Array(frames); let peak = 1e-9, held = 0; const dec = Math.exp(-1 / (0.18 * fps));
  for (let f = 1; f < frames; f++) {
    const flux = Math.max(0, low[f] - low[f - 1]); peak = Math.max(flux, peak * Math.exp(-1 / (4 * fps)));
    const v = flux / peak; held = Math.max(v > 0.35 ? v : 0, held * dec); beat[f] = clamp(held);
  }
  let mx = 1e-9; for (const v of rms) mx = Math.max(mx, v);
  for (let f = 0; f < frames; f++) rms[f] /= mx;
  const env = new Float32Array(160);
  for (let b = 0; b < 160; b++) { const f0 = Math.floor((b / 160) * frames), f1 = Math.max(f0 + 1, Math.floor(((b + 1) / 160) * frames)); let s = 0; for (let f = f0; f < f1; f++) s = Math.max(s, rms[Math.min(frames - 1, f)]); env[b] = s; }
  return {
    fps, frames, rms, beat, bands, env, source: "audio",
    // n samples of the waveform around sec (a 40 ms window), scaled to the loudest sample
    wave(sec, n = 256) {
      const c = Math.round(sec * sr), half = Math.round(0.02 * sr), out2 = new Float32Array(n);
      for (let i = 0; i < n; i++) { const k = c - half + Math.round((i / (n - 1)) * 2 * half); out2[i] = k >= 0 && k < len ? mono[k] : 0; }
      return out2;
    }
  };
}

// The same from the notes: kick hits (and accents) for the beats, a note-energy loudness.
export function analyzeNotes(sc, env, fps = 60) {
  const spb = 60 / sc.bpm, total = sc.total * spb, frames = Math.max(1, Math.ceil(total * fps));
  const beat = new Float32Array(frames), rms = new Float32Array(frames), dec = Math.exp(-1 / (0.18 * fps));
  const hits = sc.notes.filter(n => n.layer === "perc" && (n.midi === 36 || n.midi === 35 || n.accent || n.midi === 49)).map(n => [Math.round(n.t * spb * fps), n.vel / 127]);
  for (const [f, v] of hits) if (f >= 0 && f < frames) beat[f] = Math.max(beat[f], v);
  for (let f = 1; f < frames; f++) beat[f] = Math.max(beat[f], beat[f - 1] * dec);
  for (let f = 0; f < frames; f++) rms[f] = env[Math.min(env.length - 1, Math.floor((f / frames) * env.length))];
  return { fps, frames, rms, beat, bands: null, env, source: "notes", wave: null };
}
// value of a per-frame array at a time (linear)
export function valueAt(an, arr, sec) {
  if (!an || !arr) return 0;
  const f = clamp(sec * an.fps, 0, an.frames - 1), i = Math.min(an.frames - 2, Math.floor(f)), t = f - i;
  return i < 0 ? arr[0] : arr[i] + (arr[i + 1] - arr[i]) * t;
}
export function bandsAt(an, sec) {
  if (!an || !an.bands) return null;
  const f = Math.round(clamp(sec * an.fps, 0, an.frames - 1));
  return an.bands.subarray(f * BANDS, (f + 1) * BANDS);
}
