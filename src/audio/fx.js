// Effect settings: per-channel parametric EQ, drive and sends; master reverb, delay,
// chorus, compressor, limiter and output. Defaults reproduce the sound before these
// controls existed (flat EQ, no drive, no delay, no chorus).
export const CHANNELS = ["master", "lead", "harm", "bass", "pad", "perc"];
export const EQ_BANDS = [
  { key: "hp", type: "highpass", label: "Low cut", f: 20, q: 0.707 },
  { key: "ls", type: "lowshelf", label: "Low shelf", f: 180, g: 0 },
  { key: "p1", type: "peaking", label: "Low mid", f: 500, g: 0, q: 1 },
  { key: "p2", type: "peaking", label: "High mid", f: 2500, g: 0, q: 1 },
  { key: "hs", type: "highshelf", label: "High shelf", f: 7000, g: 0 },
  { key: "lp", type: "lowpass", label: "High cut", f: 20000, q: 0.707 }
];
export const defaultEq = () => EQ_BANDS.map(b => ({ key: b.key, type: b.type, f: b.f, g: b.g ?? 0, q: b.q ?? 1 }));
export const DELAY_TIMES = { "1/8": 0.5, "3/16": 0.75, "1/4": 1, "3/8": 1.5, "1/2": 2 }; // in beats
export const DEFAULT_SEND = { lead: 0.55, harm: 0.6, bass: 0.12, pad: 0.85, perc: 0.22 };

export function defaultFx() {
  const eq = {}, layer = {};
  for (const c of CHANNELS) eq[c] = defaultEq();
  for (const l of ["lead", "harm", "bass", "pad", "perc"]) layer[l] = { drive: 0, rev: DEFAULT_SEND[l], dly: l === "lead" ? 0.3 : l === "harm" ? 0.15 : 0 };
  return {
    eq, layer,
    reverb: { size: 3.4, predelay: 0, damping: 20000 },
    delay: { mix: 0, time: "3/16", feedback: 0.35, tone: 4500 },
    chorus: { mix: 0, rate: 0.6, depth: 0.004 },
    comp: { threshold: -16, ratio: 3.5, attack: 0.01, release: 0.25 },
    limiter: { on: true, ceiling: -1 },
    output: 0,
    loudness: "lufs" // export: "lufs" (−14 LUFS) or "peak" (normalized to a 0.9 peak)
  };
}

// tanh soft clipping, normalized so the curve passes through ±1.
// A style's own distortion (rock and metal guitars, theory.js RULES.drive) on its synthesized
// layers: the drive of a layer is the larger of the user's and the style's; sampled guitars are
// already distorted and get none (a second distortion over them sounds harsh).
export function styleFx(fx, style, inst = {}, rules = {}) {
  const d = rules[style] && rules[style].drive;
  if (!d) return fx;
  const out = structuredClone(fx);
  for (const [l, v] of Object.entries(d)) {
    const want = inst[l] && inst[l].type === "sample" ? 0 : v;
    out.layer[l] = { ...(out.layer[l] || { drive: 0, rev: 0.45, dly: 0.1 }), drive: Math.max((out.layer[l] && out.layer[l].drive) || 0, want) };
  }
  return out;
}
export function driveCurve(drive, n = 2048) {
  const k = 1 + 9 * drive, c = new Float32Array(n), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}
