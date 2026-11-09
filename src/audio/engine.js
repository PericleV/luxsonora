// Web Audio engine: mix graph with effects and five deterministic synthesized instruments.
//   pluck: Karplus-Strong with fractional delay (allpass), buffer computed in JS
//   fm:    2 operators, modulation index with its own envelope
//   bass:  sine + filtered sawtooth
//   pad:   three detuned saws + triangle, spread in stereo
//   wave:  texture wavetable (PeriodicWave from the image profile through a focus point)
import { clamp, mulberry32 } from "../core/util.js";
import { LAYERS, RULES } from "../core/theory.js";
import { ROLES } from "../core/arrange.js";
import { tiltWave } from "../core/instruments.js";
import { defaultFx, driveCurve, DELAY_TIMES, defaultEq } from "./fx.js";
import { measure } from "lufs-web";
import { playSample, playDrum, prepareSamples, kitSpecs } from "./samples.js";
export { defaultFx };

export const LAYER_GAIN = { lead: 0.95, harm: 0.5, bass: 0.8, pad: 0.42, perc: 0.6 };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export function defaultMix() {
  const o = {};
  for (const l of LAYERS) o[l] = { vol: 1, mute: false, solo: false };
  return o;
}
// Effective gain: if any layer is soloed, only soloed layers are heard.
export function audible(mix, l) {
  const m = mix[l] || { vol: 1, mute: false, solo: false }, anySolo = Object.values(mix).some(k => k && k.solo);
  return anySolo ? !!m.solo : !m.mute;
}
// base: the layer's level in the mix (extra layers take their role's level, arrange.js)
export function layerGain(mix, l, base = LAYER_GAIN[l] ?? 0.45) { return audible(mix, l) ? base * ((mix[l] && mix[l].vol) ?? 1) : 0; }
// Per-layer effect settings, with defaults for layers the settings don't know yet (extra layers).
const layerFx = (fx, l) => fx.layer[l] || { drive: 0, rev: 0.45, dly: 0.1 };
const layerEq = (fx, l) => fx.eq[l] || defaultEq();

const IR_CACHE = new WeakMap(), NOISE_CACHE = new WeakMap(), KS_CACHE = new WeakMap(), WAVE_CACHE = new WeakMap();
// Seeded decaying-noise impulse response; `size` is its length in seconds.
function makeIR(ctx, size = 3.4) {
  let m = IR_CACHE.get(ctx); if (!m) { m = new Map(); IR_CACHE.set(ctx, m); }
  const key = size.toFixed(2); if (m.has(key)) return m.get(key);
  const len = Math.max(1, Math.floor(ctx.sampleRate * size)), b = ctx.createBuffer(2, len, ctx.sampleRate), rnd = mulberry32(11);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  m.set(key, b); return b;
}
function makeNoise(ctx) {
  if (NOISE_CACHE.has(ctx)) return NOISE_CACHE.get(ctx);
  const len = ctx.sampleRate, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0), rnd = mulberry32(5);
  for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  NOISE_CACHE.set(ctx, b); return b;
}
const dbToGain = db => Math.pow(10, db / 20);

function eqChain(ctx, bands) {
  const nodes = bands.map(b => { const n = ctx.createBiquadFilter(); n.type = b.type; return n; });
  for (let k = 0; k < nodes.length - 1; k++) nodes[k].connect(nodes[k + 1]);
  return { input: nodes[0], output: nodes[nodes.length - 1], nodes };
}
function setEq(chain, bands, t) {
  bands.forEach((b, k) => {
    const n = chain.nodes[k];
    n.frequency.setTargetAtTime(Math.min(20000, Math.max(10, b.f)), t, 0.02);
    if ("gain" in n) n.gain.setTargetAtTime(b.g || 0, t, 0.02);
    n.Q.setTargetAtTime(b.q || 0.707, t, 0.02);
  });
}

/*
 * Mix graph:
 *   voices → in[l] → drive → EQ → fader[l] → master bus
 *                                   ├→ reverb send → pre-delay → convolver → damping → wet
 *                                   └→ delay send → delay (feedback through tone filter) → delay return
 *   master bus + wet + delay return → master EQ → chorus (dry + modulated delay) → compressor
 *   → makeup → limiter → output → destination
 */
// extra: the score's extra layers [{ id, role }] (arrange.js), which get their own channels.
export function buildGraph(ctx, reverb, mix, fx = defaultFx(), bpm = 90, extra = []) {
  const t = ctx.currentTime;
  const out = ctx.createGain(); out.gain.value = 0.9 * dbToGain(fx.output || 0);
  const limiter = ctx.createDynamicsCompressor();
  limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  const comp = ctx.createDynamicsCompressor(); comp.knee.value = 12;
  const mEq = eqChain(ctx, fx.eq.master);
  const bus = ctx.createGain();
  // chorus: dry path plus a delay line modulated by a sine LFO (starts at time 0: deterministic)
  const chDry = ctx.createGain(), chWet = ctx.createGain(), chDelay = ctx.createDelay(0.05), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
  lfo.type = "sine"; lfo.connect(lfoGain); lfoGain.connect(chDelay.delayTime); lfo.start(0);
  bus.connect(mEq.input);
  mEq.output.connect(chDry); mEq.output.connect(chDelay); chDelay.connect(chWet);
  chDry.connect(comp); chWet.connect(comp);
  // makeup: gain into the limiter (used by the export's loudness pass)
  const makeup = ctx.createGain(); comp.connect(makeup); makeup.connect(limiter); limiter.connect(out); out.connect(ctx.destination);
  // reverb
  const revIn = ctx.createGain(), pre = ctx.createDelay(0.5), conv = ctx.createConvolver(), damp = ctx.createBiquadFilter(), wet = ctx.createGain();
  conv.buffer = makeIR(ctx, fx.reverb.size); damp.type = "lowpass";
  revIn.connect(pre); pre.connect(conv); conv.connect(damp); damp.connect(wet); wet.connect(bus);
  // delay
  const dlyIn = ctx.createGain(), dly = ctx.createDelay(4), tone = ctx.createBiquadFilter(), fb = ctx.createGain(), dlyOut = ctx.createGain();
  tone.type = "lowpass"; dlyIn.connect(dly); dly.connect(tone); tone.connect(fb); fb.connect(dly); tone.connect(dlyOut); dlyOut.connect(bus);
  const inp = {}, drive = {}, eq = {}, fader = {}, rSend = {}, dSend = {}, duck = {};
  const baseGain = {}, layers = [...LAYERS, ...extra.map(L => L.id)];
  for (const L of extra) baseGain[L.id] = (ROLES[L.role] || {}).gain ?? 0.45;
  for (const l of layers) {
    inp[l] = ctx.createGain();
    drive[l] = ctx.createWaveShaper(); drive[l].oversample = "4x";
    eq[l] = eqChain(ctx, layerEq(fx, l));
    fader[l] = ctx.createGain();
    rSend[l] = ctx.createGain(); dSend[l] = ctx.createGain();
    // duck: sidechain gain, pulled down on each kick in styles that pump (see playNote)
    duck[l] = ctx.createGain();
    inp[l].connect(drive[l]); drive[l].connect(eq[l].input); eq[l].output.connect(duck[l]); duck[l].connect(fader[l]);
    fader[l].connect(bus); fader[l].connect(rSend[l]); rSend[l].connect(revIn); fader[l].connect(dSend[l]); dSend[l].connect(dlyIn);
  }
  const G = { ctx, master: out, out, makeup, wet, bus: inp, fader, duck, sidechain: 0, baseGain, extraIds: extra.map(L => L.id), rSend, dSend, drive, eq, mEq, comp, limiter, pre, conv, damp, dly, tone, fb, dlyOut, chDry, chWet, chDelay, lfo, lfoGain, noise: makeNoise(ctx), irSize: fx.reverb.size, bpm };
  updateGraph(G, fx, mix, reverb, t, true);
  return G;
}

// Applies settings to a running graph (live changes during playback).
export function updateGraph(G, fx, mix, reverb, t = G.ctx.currentTime, initial = false) {
  const ctx = G.ctx, set = (p, v) => (initial ? (p.value = v) : p.setTargetAtTime(v, t, 0.03));
  for (const l of Object.keys(G.fader)) {
    const L = layerFx(fx, l);
    G.drive[l].curve = L.drive > 0.001 ? driveCurve(L.drive) : null;
    setEq(G.eq[l], layerEq(fx, l), t);
    set(G.fader[l].gain, layerGain(mix, l, G.baseGain[l]));
    set(G.rSend[l].gain, L.rev); set(G.dSend[l].gain, L.dly);
  }
  setEq(G.mEq, fx.eq.master, t);
  set(G.wet.gain, reverb * 0.9);
  set(G.pre.delayTime, fx.reverb.predelay); set(G.damp.frequency, Math.min(20000, fx.reverb.damping));
  if (Math.abs(fx.reverb.size - G.irSize) > 0.005) {
    // a convolver keeps its buffer; swap in a new one
    const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx, fx.reverb.size);
    G.pre.disconnect(); G.pre.connect(conv); conv.connect(G.damp); try { G.conv.disconnect(); } catch (e) { /* already disconnected */ }
    G.conv = conv; G.irSize = fx.reverb.size;
  }
  set(G.dly.delayTime, Math.min(4, (DELAY_TIMES[fx.delay.time] || 0.75) * (60 / G.bpm)));
  set(G.fb.gain, Math.min(0.9, fx.delay.feedback)); set(G.tone.frequency, fx.delay.tone); set(G.dlyOut.gain, fx.delay.mix);
  set(G.chWet.gain, fx.chorus.mix); set(G.chDry.gain, 1 - 0.5 * fx.chorus.mix);
  set(G.lfo.frequency, fx.chorus.rate); set(G.lfoGain.gain, fx.chorus.depth); set(G.chDelay.delayTime, 0.012);
  set(G.comp.threshold, fx.comp.threshold); set(G.comp.ratio, fx.comp.ratio); set(G.comp.attack, fx.comp.attack); set(G.comp.release, fx.comp.release);
  set(G.limiter.threshold, fx.limiter.on ? fx.limiter.ceiling : 0); set(G.limiter.ratio, fx.limiter.on ? 20 : 1);
  set(G.makeup.gain, dbToGain(fx.makeup || 0));
  if (!initial) G.out.gain.setTargetAtTime(0.9 * dbToGain(fx.output || 0), t, 0.03);
}

// ADSR on an AudioParam; returns the time at which the sound has died out.
function adsr(p, t0, durSec, a, d, s, r, peak) {
  a = Math.max(0.002, a); d = Math.max(0.02, d); r = Math.max(0.03, r); s = clamp(s);
  const tr = t0 + Math.max(durSec, a + 0.005);
  p.setValueAtTime(0, t0); p.linearRampToValueAtTime(peak, t0 + a); p.setTargetAtTime(peak * s, t0 + a, d / 3);
  const lvl = peak * s + (peak - peak * s) * Math.exp(-(tr - (t0 + a)) / (d / 3));
  p.setValueAtTime(lvl, tr); p.setTargetAtTime(0, tr, r / 4);
  return tr + r * 1.6 + 0.05;
}
function connectPan(ctx, node, out, pan, glide, t0) {
  if ((pan || glide) && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    if (glide) { p.pan.setValueAtTime(glide.pan0, t0); p.pan.linearRampToValueAtTime(pan, t0 + glide.sec); } else p.pan.value = pan;
    node.connect(p); p.connect(out);
  } else node.connect(out);
}
// Filter cutoff and Q, gliding from the previous focus point's values when a glide is given.
function setFilter(lp, tim, t0, glide) {
  const cut = Math.min(tim.cut, 16000), q = Math.min(tim.q, 12);
  if (glide) {
    lp.frequency.setValueAtTime(Math.min(glide.cut0, 16000), t0); lp.frequency.exponentialRampToValueAtTime(cut, t0 + glide.sec);
    lp.Q.setValueAtTime(Math.min(glide.q0, 12), t0); lp.Q.linearRampToValueAtTime(q, t0 + glide.sec);
  } else { lp.frequency.value = cut; lp.Q.value = q; }
}

// Slow timbre changes inside a held note (the pad holds common tones across focus points):
// sw = { steps: [{ at (beats from the note start), cut, q }], spb, from (beats already elapsed
// when playback of this note starts) }. Each step glides with a time constant of 0.35 beat.
function applySweep(lp, sw, t0) {
  if (!sw) return;
  const tc = 0.35 * sw.spb;
  for (const st of sw.steps) {
    const cut = Math.min(st.cut, 16000), q = Math.min(st.q, 12), t = t0 + (st.at - sw.from) * sw.spb;
    if (t <= t0) { lp.frequency.setValueAtTime(cut, t0); lp.Q.setValueAtTime(q, t0); }
    else { lp.frequency.setTargetAtTime(cut, t, tc); lp.Q.setTargetAtTime(q, t, tc); }
  }
}

// Delayed vibrato for sustained notes (instrument parameter vib, in cents): a 5.2 Hz sine
// that fades in from 0.3 s to 0.8 s after the attack, on the given detune parameters.
function vibrato(ctx, params, t0, durSec, end, cents) {
  if (!cents || durSec < 0.5) return;
  const lfo = ctx.createOscillator(), g = ctx.createGain(); lfo.frequency.value = 5.2;
  g.gain.setValueAtTime(0, t0); g.gain.setValueAtTime(0, t0 + 0.3); g.gain.linearRampToValueAtTime(cents, t0 + 0.8);
  lfo.connect(g); for (const p of params) g.connect(p);
  lfo.start(t0); lfo.stop(end);
}

/* ---------- pluck: Karplus-Strong ---------- */
// Loop: delay N + averaging (0.5 samples) + fractional allpass (δ), total P = sr/f.
// Per-period gain g = 0.001^(1/(T60·f)) decays the string by 60 dB in T60 seconds.
export function ksSamples(sr, f, t60, col, len, seed) {
  const P = sr / f, Pd = P - 0.5;
  let N = Math.floor(Pd), delta = Pd - N;
  if (delta < 0.1) { N -= 1; delta += 1; }
  N = Math.max(2, N);
  const C = (1 - delta) / (1 + delta), gLoop = Math.pow(0.001, 1 / (Math.max(0.05, t60) * f));
  const buf = new Float32Array(N), rnd = mulberry32(seed), aLP = 0.08 + 0.9 * clamp(col);
  let e = 0, mean = 0;
  for (let i = 0; i < N; i++) { e = aLP * (rnd() * 2 - 1) + (1 - aLP) * e; buf[i] = e; mean += e; }
  mean /= N; let peak = 1e-9;
  for (let i = 0; i < N; i++) { buf[i] -= mean; peak = Math.max(peak, Math.abs(buf[i])); }
  for (let i = 0; i < N; i++) buf[i] /= peak;
  const L = Math.max(1, Math.floor(len * sr)), out = new Float32Array(L);
  let idx = 0, prev = 0, x1 = 0, y1 = 0;
  for (let i = 0; i < L; i++) {
    const cur = buf[idx]; out[i] = cur;
    const avg = 0.5 * (cur + prev); prev = cur;
    const ap = C * avg + x1 - C * y1; x1 = avg; y1 = ap;
    buf[idx] = ap * gLoop;
    if (++idx === N) idx = 0;
  }
  return out;
}
function ksBuffer(ctx, midi, t60, col, len) {
  let cache = KS_CACHE.get(ctx); if (!cache) { cache = new Map(); KS_CACHE.set(ctx, cache); }
  // quantization: T60 on 1/12 octave, colour on 0.05, length on 0.25 s
  const qT = Math.pow(2, Math.round(Math.log2(t60) * 12) / 12), qC = Math.round(col * 20) / 20, qL = Math.ceil(len * 4) / 4;
  const key = `${midi}|${qT.toFixed(4)}|${qC}|${qL}`;
  if (cache.has(key)) { const b = cache.get(key); cache.delete(key); cache.set(key, b); return b; }
  const data = ksSamples(ctx.sampleRate, mtof(midi), qT, qC, qL, 1009 * midi + 17);
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.getChannelData(0).set(data);
  cache.set(key, b);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return b;
}
function pluckVoice(ctx, out, t0, durSec, midi, vel, tim, pan, glide) {
  const len = Math.min(8, durSec + tim.r * 1.6 + 0.1);
  const src = ctx.createBufferSource(); src.buffer = ksBuffer(ctx, midi, tim.d, tim.col, len);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; setFilter(lp, tim, t0, glide);
  const g = ctx.createGain(), peak = (vel / 127) * 0.7;
  const end = adsr(g.gain, t0, durSec, tim.a, 30, 1, tim.r, peak);
  src.connect(lp); lp.connect(g); connectPan(ctx, g, out, pan, glide, t0);
  src.start(t0); src.stop(Math.min(end, t0 + len));
}

/* ---------- fm: 2 operators ---------- */
function fmVoice(ctx, out, t0, durSec, midi, vel, tim, pan, glide) {
  const f = mtof(midi), ratio = tim.ratio || 1, I0 = 0.3 + 4 * tim.col, fm = f * ratio;
  const car = ctx.createOscillator(); car.type = "sine"; car.frequency.value = f;
  const mod = ctx.createOscillator(); mod.type = "sine"; mod.frequency.value = fm;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(I0 * fm, t0); mg.gain.setTargetAtTime(I0 * fm * 0.25, t0 + tim.a, Math.max(0.02, tim.d) / 2);
  mod.connect(mg); mg.connect(car.frequency);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; setFilter(lp, tim, t0, glide);
  const g = ctx.createGain();
  const end = adsr(g.gain, t0, durSec, tim.a, tim.d, tim.s, tim.r, (vel / 127) * 0.2);
  car.connect(lp); lp.connect(g); connectPan(ctx, g, out, pan, glide, t0);
  vibrato(ctx, [car.detune, mod.detune], t0, durSec, end, tim.vib);
  car.start(t0); mod.start(t0); car.stop(end); mod.stop(end);
}

/* ---------- bass: sine + sawtooth ---------- */
function bassVoice(ctx, out, t0, durSec, midi, vel, tim, pan, glide) {
  const f = mtof(midi);
  const o1 = ctx.createOscillator(); o1.type = "sine"; o1.frequency.value = f;
  const o2 = ctx.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = f;
  const g1 = ctx.createGain(); g1.gain.value = 1 - 0.5 * tim.col;
  const g2 = ctx.createGain(); g2.gain.value = 0.6 * tim.col;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = Math.min(tim.q, 12);
  const cut = Math.min(tim.cut, 8000);
  if (glide) { lp.frequency.setValueAtTime(Math.min(glide.cut0, 8000), t0); lp.frequency.exponentialRampToValueAtTime(cut, t0 + glide.sec); }
  else { lp.frequency.setValueAtTime(Math.min(cut * 1.8, 12000), t0); lp.frequency.setTargetAtTime(cut, t0 + tim.a, 0.06); }
  const g = ctx.createGain();
  const end = adsr(g.gain, t0, durSec, tim.a, tim.d, tim.s, tim.r, (vel / 127) * 0.12);
  o1.connect(g1); o2.connect(g2); g1.connect(lp); g2.connect(lp); lp.connect(g); g.connect(out);
  o1.start(t0); o2.start(t0); o1.stop(end); o2.stop(end);
}

/* ---------- pad: unison ---------- */
function padVoice(ctx, out, t0, durSec, midi, vel, tim, pan, glide, sw) {
  const f = mtof(midi), det = tim.det || 8;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = Math.min(tim.cut, 16000); lp.Q.value = Math.min(tim.q, 12);
  applySweep(lp, sw, t0);
  const g = ctx.createGain();
  const end = adsr(g.gain, t0, durSec, tim.a, tim.d, tim.s, tim.r, (vel / 127) * 0.14);
  const oscs = [];
  [[-det, -0.6], [0, 0], [det, 0.6]].forEach(([dc, pn]) => {
    const o = ctx.createOscillator(); o.type = tim.osc || "sawtooth"; o.frequency.value = f; o.detune.value = dc;
    const og = ctx.createGain(); og.gain.value = 0.5 * tim.col;
    o.connect(og); connectPan(ctx, og, lp, pn); oscs.push(o);
  });
  const tri = ctx.createOscillator(); tri.type = "triangle"; tri.frequency.value = f;
  const tg = ctx.createGain(); tg.gain.value = 1 - tim.col; tri.connect(tg); tg.connect(lp); oscs.push(tri);
  lp.connect(g); g.connect(out);
  vibrato(ctx, oscs.map(o => o.detune), t0, durSec, end, tim.vib);
  for (const o of oscs) { o.start(t0); o.stop(end); }
}

/* ---------- wave: texture wavetable ---------- */
function periodicWave(ctx, wave, col) {
  let m = WAVE_CACHE.get(ctx); if (!m) { m = new Map(); WAVE_CACHE.set(ctx, m); }
  const qc = Math.round(col * 20) / 20, key = wave.key + "|" + qc;
  if (m.has(key)) return m.get(key);
  const tw = tiltWave(wave, qc), pw = ctx.createPeriodicWave(tw.real, tw.imag);
  m.set(key, pw); if (m.size > 300) m.delete(m.keys().next().value);
  return pw;
}
function waveVoice(ctx, out, t0, durSec, midi, vel, tim, pan, glide, sw) {
  const o = ctx.createOscillator(); o.frequency.value = mtof(midi);
  if (tim.wave) o.setPeriodicWave(periodicWave(ctx, tim.wave, tim.col)); else o.type = "triangle";
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; setFilter(lp, tim, t0, glide); applySweep(lp, sw, t0);
  const g = ctx.createGain();
  const end = adsr(g.gain, t0, durSec, tim.a, tim.d, tim.s, tim.r, (vel / 127) * 0.2);
  o.connect(lp); lp.connect(g); connectPan(ctx, g, out, pan, glide, t0);
  vibrato(ctx, [o.detune], t0, durSec, end, tim.vib);
  o.start(t0); o.stop(end);
}

/* ---------- percussion ---------- */
function kick(ctx, out, t, vel) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine";
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime((vel / 127) * 0.9, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.45);
}
function hat(ctx, out, t, vel, noise, decay, freq, offset) {
  const src = ctx.createBufferSource(); src.buffer = noise;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = freq;
  const g = ctx.createGain(); g.gain.setValueAtTime((vel / 127) * 0.28, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(hp); hp.connect(g); g.connect(out);
  if (offset + decay > 0.9) src.loop = true; // the noise buffer lasts 1 s; a crash rings longer
  src.start(t, offset); src.stop(t + decay + 0.02);
}

// Snare: band-passed noise plus a short tone body. Clap: three noise bursts and a tail.
function snare(ctx, out, t, vel, noise, offset) {
  const src = ctx.createBufferSource(); src.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.setValueAtTime((vel / 127) * 0.42, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
  src.connect(bp); bp.connect(g); g.connect(out); src.start(t, offset); src.stop(t + 0.22);
  const o = ctx.createOscillator(), og = ctx.createGain(); o.type = "triangle";
  o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(170, t + 0.06);
  og.gain.setValueAtTime((vel / 127) * 0.3, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.1);
}
function clap(ctx, out, t, vel, noise, offset) {
  const src = ctx.createBufferSource(); src.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1200; bp.Q.value = 1.2;
  const g = ctx.createGain(), pk = (vel / 127) * 0.5;
  g.gain.setValueAtTime(0.0001, t);
  for (const d of [0, 0.011, 0.022]) { g.gain.setValueAtTime(pk, t + d); g.gain.exponentialRampToValueAtTime(pk * 0.15, t + d + 0.009); }
  g.gain.setValueAtTime(pk * 0.8, t + 0.033); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  src.connect(bp); bp.connect(g); g.connect(out); src.start(t, offset); src.stop(t + 0.22);
}
// Rim: a short high click. Tom: a sine with a pitch drop.
function rim(ctx, out, t, vel) {
  const o = ctx.createOscillator(), g = ctx.createGain(), hp = ctx.createBiquadFilter(); o.type = "square"; o.frequency.value = 1750;
  hp.type = "highpass"; hp.frequency.value = 900;
  g.gain.setValueAtTime((vel / 127) * 0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  o.connect(hp); hp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.04);
}
function tom(ctx, out, t, vel, f) {
  const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine";
  o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime((vel / 127) * 0.6, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.4);
}
const TOM_HZ = { 45: 92, 48: 128, 50: 172 };

const VOICES = { pluck: pluckVoice, fm: fmVoice, bass: bassVoice, pad: padVoice, wave: waveVoice };
// Swell before a section change: a cymbal heard backwards (high-passed noise rising to a peak
// and stopping) or a riser (band-passed noise sweeping up, with a rising sine underneath).
function swellFx(ctx, out, t, durSec, vel, noise, kind) {
  const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
  const f = ctx.createBiquadFilter(), g = ctx.createGain(), peak = (vel / 127) * (kind === "riser" ? 0.32 : 0.36);
  if (kind === "riser") { f.type = "bandpass"; f.Q.value = 2.5; f.frequency.setValueAtTime(350, t); f.frequency.exponentialRampToValueAtTime(7000, t + durSec); }
  else { f.type = "highpass"; f.frequency.value = 3200; }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + durSec); g.gain.linearRampToValueAtTime(0.0001, t + durSec + 0.04);
  src.connect(f); f.connect(g); g.connect(out); src.start(t); src.stop(t + durSec + 0.06);
  if (kind === "riser") {
    const o = ctx.createOscillator(), og = ctx.createGain(); o.type = "sine";
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + durSec);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(peak * 0.25, t + durSec); og.gain.linearRampToValueAtTime(0.0001, t + durSec + 0.04);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + durSec + 0.06);
  }
}
// Sidechain: on each kick the ducked layers drop by `amount` and recover over a quarter beat.
const DUCKED = ["harm", "bass", "pad"];
function pump(G, t, amount) {
  const rec = 0.11 * (60 / G.bpm);
  for (const l of [...DUCKED, ...(G.extraIds || [])]) { const p = G.duck[l].gain; p.setValueAtTime(1 - amount, t); p.setTargetAtTime(1, t + 0.012, rec); }
}

// Expression (CC11, perform.js): each layer's level follows its curve, ramping between the places.
export function ccValueAt(curve, b) {
  if (!curve || !curve.length) return 1;
  if (b <= curve[0][0]) return curve[0][1];
  for (let i = 0; i + 1 < curve.length; i++) { const [b0, v0] = curve[i], [b1, v1] = curve[i + 1]; if (b < b1) return v0 + ((v1 - v0) * (b - b0)) / Math.max(1e-9, b1 - b0); }
  return curve[curve.length - 1][1];
}
export function scheduleExpression(G, sc, fromBeat = 0, t0 = G.ctx.currentTime) {
  if (!sc.cc) return;
  const spb = 60 / sc.bpm;
  for (const [l, c] of Object.entries(sc.cc)) {
    const p = G.bus[l] && G.bus[l].gain; if (!p || !c.expr || !c.expr.length) continue;
    p.cancelScheduledValues(0); p.setValueAtTime(ccValueAt(c.expr, fromBeat), t0);
    for (const [b, v] of c.expr) if (b > fromBeat) p.linearRampToValueAtTime(v, t0 + (b - fromBeat) * spb);
  }
}

// from: the beat at which playback of this note starts (later than n.t when seeking into a held note)
export function playNote(G, n, t0, durSec, from = n.t) {
  const ctx = G.ctx;
  if (n.layer === "perc") {
    // the offset into the noise buffer depends on the beat, not the clock: the same hit always sounds the same
    const off = (n.t * 0.37) % 0.5;
    const bus = G.bus.perc, m = n.midi;
    if (n.swell) { swellFx(ctx, bus, t0, durSec, n.vel, G.noise, n.swell); return; }
    if (m === 36 && G.sidechain > 0) pump(G, t0, G.sidechain);
    if (G.kit && playDrum(G, G.kit, n, t0)) return;
    if (m === 36) kick(ctx, bus, t0, n.vel);
    else if (m === 38) snare(ctx, bus, t0, n.vel, G.noise, off);
    else if (m === 39) clap(ctx, bus, t0, n.vel, G.noise, off);
    else if (m === 37) rim(ctx, bus, t0, n.vel);
    else if (TOM_HZ[m]) tom(ctx, bus, t0, n.vel, TOM_HZ[m]);
    else if (m === 49) hat(ctx, bus, t0, n.vel * 0.8, G.noise, 1.6, 3500, off);
    else if (m === 70) hat(ctx, bus, t0, n.vel * 0.7, G.noise, 0.07, 6000, off);
    else if (m === 46) hat(ctx, bus, t0, n.vel * 0.85, G.noise, 0.32, 7000, off);
    else hat(ctx, bus, t0, n.vel, G.noise, m === 51 ? 0.35 : m === 44 ? 0.04 : 0.06, m === 51 ? 5200 : 7500, off);
  } else {
    // a swelling note (film strings) grows from 35% to full level over its length
    let dest = G.bus[n.layer];
    if (n.swell) { const sg = ctx.createGain(); sg.gain.setValueAtTime(0.35, t0); sg.gain.linearRampToValueAtTime(1, t0 + Math.max(0.1, durSec * 0.8)); sg.connect(dest); dest = sg; }
    // sampled instruments play their samples once loaded, otherwise their synthesized fallback
    let tim = n.tim;
    if (tim.type === "sample") { if (playSample(G, n.layer, n, t0, durSec, tim)) return; tim = { ...tim, type: tim.fb }; }
    VOICES[tim.type](ctx, dest, t0, durSec, n.midi, n.vel * (tim.lvl ?? 1), tim, n.pan || 0, n.glide || null, n.sweep ? { steps: n.sweep, spb: 60 / G.bpm, from: from - n.t } : null);
  }
}

// Offline render of exactly T seconds, with a master fade over the last 0.4 s.
// opts: { specs (sampled instruments to load, see samples.js), kit (drum kit) }.
export async function renderOffline(sc, reverb, mix, fx = defaultFx(), opts = {}) {
  const sr = 44100, spb = 60 / sc.bpm, T = sc.total * spb, len = Math.round(T * sr);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, len, sr), G = buildGraph(ctx, reverb, mix, fx, sc.bpm, sc.extra || []);
  G.sidechain = sc.sidechain ?? ((RULES[sc.style] || {}).sidechain || 0); G.kit = opts.kit || null;
  if (opts.specs && opts.specs.length) await prepareSamples(G, opts.specs, 60000);
  const g0 = G.out.gain.value;
  G.out.gain.setValueAtTime(g0, Math.max(0, T - 0.4)); G.out.gain.linearRampToValueAtTime(0, T);
  scheduleExpression(G, sc, 0, 0);
  for (const n of sc.notes) if (audible(mix, n.layer)) playNote(G, n, n.t * spb, n.dur * spb);
  return await ctx.startRendering();
}

/*
 * Loudness normalization for export. Integrated loudness and true peak are measured per
 * ITU-R BS.1770-4 (lufs-web). The gain brings the piece to the target loudness, but is
 * reduced if the true peak would exceed the ceiling, so the result never clips.
 */
export function loudnessGain(channels, sampleRate, target = -14, ceilingDb = -1) {
  const m = measure({ sampleRate, channels });
  if (!(m.integratedLUFS > -70)) return { gain: 1, before: m, lufs: m.integratedLUFS, peakDb: m.truePeakDB, limited: false };
  let gainDb = target - m.integratedLUFS, limited = false;
  if (m.truePeakDB + gainDb > ceilingDb) { gainDb = ceilingDb - m.truePeakDB; limited = true; }
  return { gain: dbToGain(gainDb), before: m, lufs: m.integratedLUFS + gainDb, peakDb: m.truePeakDB + gainDb, limited };
}

// Preview of an instrument (an arpeggio in its layer's register) or of a drum kit (one bar),
// on its own small graph; sampled sounds are loaded first (the fallback plays if they can't).
export async function preview(ctx, layer, tim, kit = null) {
  const G = buildGraph(ctx, 0.25, defaultMix(), defaultFx(), 100);
  G.kit = kit;
  const specs = [];
  if (tim && tim.type === "sample") specs.push({ layer, src: tim.src });
  if (kit) specs.push(...kitSpecs(kit));
  if (specs.length) await prepareSamples(G, specs, 20000);
  const t0 = ctx.currentTime + 0.06, spb = 0.6;
  if (layer === "perc") {
    const bar = [[0, 36], [0, 42], [0.5, 42], [1, 38], [1, 42], [1.5, 42], [2, 36], [2.5, 36], [2.5, 42], [3, 38], [3, 42], [3.5, 46]];
    for (const [b, m] of bar) playNote(G, { layer: "perc", t: b, dur: 0.1, midi: m, vel: 96 }, t0 + b * spb, 0.1);
  } else {
    const base = layer === "bass" ? 36 : layer === "pad" ? 55 : 60, held = layer === "pad";
    [0, 4, 7, 12].forEach((iv, k) => playNote(G, { layer, t: held ? 0 : k, dur: held ? 3 : 0.9, midi: base + iv, vel: 92, tim, pan: 0 }, t0 + (held ? 0 : k * spb), held ? 3 * spb : 0.9 * spb));
  }
  setTimeout(() => { try { G.out.disconnect(); } catch (e) { /* already gone */ } }, 7000);
}
