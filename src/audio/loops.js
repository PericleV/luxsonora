// Loops for sustained sampled sounds. A General MIDI recording of an organ, strings, a voice, a
// wind or a pad lasts a few seconds: a chord held longer would stop dead at the end of the
// recording, with a click. Each note gets a loop inside its steady part, between two points where
// the wave before the jump matches the wave after it, so a held note keeps sounding as long as it
// is held, without a seam.

// Frame energy (10 ms frames) of the channels.
function envelope(chans, sr) {
  const F = Math.max(1, Math.round(sr * 0.01)), N = chans[0].length, out = new Float32Array(Math.floor(N / F));
  for (let f = 0; f < out.length; f++) {
    let s = 0;
    for (let c = 0; c < chans.length; c++) { const x = chans[c]; for (let i = f * F; i < (f + 1) * F; i++) s += x[i] * x[i]; }
    out[f] = Math.sqrt(s / (F * chans.length));
  }
  return { env: out, F };
}
// Upward zero crossings of the mix between i0 and i1, at most `max` of them, evenly spread.
function crossings(chans, i0, i1, max) {
  const r = [], a = chans[0], b = chans[1] || null;
  let prev = a[Math.max(0, i0 - 1)] + (b ? b[Math.max(0, i0 - 1)] : 0);
  for (let i = Math.max(1, i0); i < i1; i++) { const v = a[i] + (b ? b[i] : 0); if (prev < 0 && v >= 0) r.push(i); prev = v; }
  if (r.length <= max) return r;
  const step = r.length / max;
  return Array.from({ length: max }, (_, k) => r[Math.floor(k * step)]);
}
// Mismatch of the wave around s and around e (0 when the jump from e to s is seamless).
function mismatch(chans, s, e, half) {
  let d = 0, p = 0;
  for (let c = 0; c < chans.length; c++) { const x = chans[c]; for (let k = -half; k < half; k++) { const a = x[s + k], b = x[e + k]; d += (a - b) * (a - b); p += a * a + b * b; } }
  return d / (p + 1e-12);
}

/*
 * chans: the channels of a decoded note (Float32Arrays), sr: their sample rate. Returns
 * [loopStart, loopEnd] in seconds, or null when the note has no steady part long enough to loop
 * (a short or fading sound keeps playing as recorded).
 */
export function loopPoints(chans, sr) {
  const N = chans[0].length;
  if (N < sr * 0.8) return null;
  const { env, F } = envelope(chans, sr);
  let peak = 0; for (let f = 0; f < env.length; f++) if (env[f] > peak) peak = env[f];
  if (!(peak > 1e-4)) return null;
  // the steady part: from where the sound has grown to 60% of its peak (and not before a quarter
  // of the recording, past the attack) to the last place it is still at half of it
  let a = env.findIndex(v => v >= 0.6 * peak), b = env.length - 1;
  while (b > 0 && env[b] < 0.5 * peak) b--;
  const s0 = Math.max(a * F + Math.round(0.05 * sr), Math.round(N * 0.25)), e0 = b * F - Math.round(0.03 * sr);
  if (e0 - s0 < sr * 0.3) return null;
  const span = e0 - s0, minLen = Math.max(Math.round(sr * 0.25), Math.round(span * 0.4));
  const S = crossings(chans, s0, s0 + Math.round(span * 0.45), 90), E = crossings(chans, e0 - Math.round(span * 0.35), e0, 90);
  // a quick look at a short window around each pair, then a close look at the best ones
  const coarse = [];
  for (const e of E) for (const s of S) if (e - s >= minLen) coarse.push([mismatch(chans, s, e, 12), s, e]);
  if (!coarse.length) return null;
  coarse.sort((p, q) => p[0] - q[0]);
  let best = null;
  for (const [, s, e] of coarse.slice(0, 24)) { const m = mismatch(chans, s, e, 256); if (!best || m < best[0]) best = [m, s, e]; }
  // a jump this far off would itself be heard: leave the note as recorded
  if (best[0] > 0.5) return null;
  return [best[1] / sr, best[2] / sr];
}
