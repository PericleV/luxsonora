// Sampled instruments (smplr, MIT): General MIDI soundfonts (MusyngKite), a Steinway grand,
// electric pianos and classic drum machines, downloaded when first used (decision 22).
//
// Each sampled preset in the library (instruments.js, type "sample") names its source and a
// synthesized fallback type with the same envelope and filter values: until the samples are
// loaded, or when they can't be (offline, file://), the fallback synth plays instead, so the
// piece always sounds. Image modulation reaches the samples through the note's low-pass cutoff
// (lpfCutoffHz), its release (ampRelease) and its velocity.
//
// Instances are created per audio graph (live playback or offline export) and write into the
// layer's bus; one SampleLoader per sample rate caches the decoded buffers across graphs, and
// a scheduler with a very long look-ahead dispatches every note immediately (our own scheduler
// already feeds notes ahead of time, and an OfflineAudioContext never advances while we schedule).
import { GM } from "../core/gm.js";
import { Soundfont, SplendidGrandPiano, ElectricPiano, DrumMachine, DrumAbuse, Mellotron, Mallet, SampleLoader, Scheduler, getMellotronNames, getMalletNames, getElectricPianoNames, getDrumAbuseMachineNames } from "smplr";

export const KITS = {
  synth: { name: "Synthesized kit", group: "Built in" },
  "TR-808": { name: "Roland TR-808", machine: "TR-808", gain: 4, group: "Classic drum machines" },
  "LM-2": { name: "LinnDrum LM-2", machine: "LM-2", gain: 2.5, group: "Classic drum machines" },
  // the rock and metal kits (sampled acoustic-style drums), listed from the start
  "abuse:linn-9000": { name: "Linn 9000", abuse: "linn-9000", gain: 2.5, group: "Classic drum machines" },
  "abuse:oberheim-dmx": { name: "Oberheim DMX", abuse: "oberheim-dmx", gain: 2.5, group: "Classic drum machines" },
  "Casio-RZ1": { name: "Casio RZ-1", machine: "Casio-RZ1", gain: 2.5, group: "Classic drum machines" },
  orchestral: { name: "Orchestral (taiko, timpani, cymbals)", orchestral: true, group: "Built in" }
};
// Default kit per style: the genre's sound (electronic on an 808; orchestral styles on taiko and timpani).
export const STYLE_KIT = { blues: "abuse:linn-9000", funk: "LM-2", pop: "LM-2", rock: "abuse:linn-9000", metal: "abuse:oberheim-dmx", ambient: "synth", cinematic: "orchestral", minimal: "synth", jazz: "synth", electronic: "TR-808", epic: "orchestral", movie: "orchestral", lofi: "LM-2", bossa: "synth", synthwave: "LM-2", classical: "synth" };

// General MIDI drum note → candidate group names in a drum machine (first match wins).
const DM_GROUPS = {
  36: ["kick", "bd", "bass-drum", "bassdrum"], 38: ["snare", "sd"], 39: ["clap", "cp", "handclap", "hand-clap"], 37: ["rimshot", "rim", "rs", "stick", "clave"],
  42: ["hihat-close", "hihat-closed", "hhclosed", "closed-hihat", "closed-hi-hat", "hi-hat-closed", "hh", "ch", "hihat", "hi-hat"], 44: ["hihat-close", "hhclosed", "closed-hi-hat", "hh", "ch", "hihat", "hi-hat"], 46: ["hihat-open", "hhopen", "open-hihat", "open-hi-hat", "hi-hat-open", "oh", "hihat", "hi-hat"],
  49: ["crash", "cymbal", "cy"], 51: ["ride", "cymbal", "cy"], 45: ["tom-low", "low-tom", "tom-lo", "lt", "tom", "conga-low"], 48: ["tom-mid", "mid-tom", "mt", "tom", "conga-mid"],
  50: ["tom-hi", "tom-high", "hi-tom", "ht", "tom", "conga-hi"], 70: ["maraca", "maracas", "shaker", "cabasa", "ma"]
};
// Orchestral kit: kick and toms on taiko (pitched), rolls on timpani tuned to the piece (n.tune);
// snare, cymbals and the rest stay on the synthesized kit.
const ORCH = { 36: ["taiko_drum", 36], 45: ["taiko_drum", 41], 48: ["taiko_drum", 45], 50: ["taiko_drum", 48] };
const TIMPANI = "timpani";

const loaders = new Map();
function loaderFor(ctx) {
  if (!loaders.has(ctx.sampleRate)) loaders.set(ctx.sampleRate, SampleLoader(ctx));
  return loaders.get(ctx.sampleRate);
}
const status = { loading: 0, failed: new Set(), listeners: new Set() };
export function onSampleStatus(fn) { status.listeners.add(fn); return () => status.listeners.delete(fn); }
const emit = () => status.listeners.forEach(fn => fn({ loading: status.loading, failed: [...status.failed] }));

function create(ctx, dest, src) {
  // level trim per source (measured RMS against the synthesized versions)
  if (src.gain && src.gain !== 1) { const g = ctx.createGain(); g.gain.value = src.gain; g.connect(dest); dest = g; }
  const common = { destination: dest, loader: loaderFor(ctx), scheduler: Scheduler(ctx, { lookaheadMs: 1e9, intervalMs: 1000 }) };
  if (src.kind === "piano") return SplendidGrandPiano(ctx, { ...common, decayTime: 0.6 });
  if (src.kind === "epiano") return ElectricPiano(ctx, { ...common, instrument: src.instrument });
  if (src.kind === "drums") return DrumMachine(ctx, { ...common, instrument: src.instrument });
  if (src.kind === "abuse") return DrumAbuse(ctx, { ...common, source: { kind: "machine", machine: src.instrument } });
  if (src.kind === "mellotron") return Mellotron(ctx, { ...common, instrument: src.instrument });
  if (src.kind === "mallet") return Mallet(ctx, { ...common, instrument: src.instrument });
  return Soundfont(ctx, { ...common, instrument: src.instrument, kit: "MusyngKite" });
}
const keyOf = src => `${src.kind}:${src.instrument || ""}`;

// Loads (or reuses) the instruments a score needs into graph G. specs: [{ layer, src }].
// Resolves when all are ready or after timeoutMs; instruments not ready by then stay on their fallback.
export async function prepareSamples(G, specs, timeoutMs = 20000) {
  G.samplers = G.samplers || {};
  const jobs = [];
  for (const { layer, src } of specs) {
    const k = layer + "|" + keyOf(src);
    if (G.samplers[k] || status.failed.has(keyOf(src))) continue;
    const entry = { inst: create(G.ctx, G.bus[layer], src), ready: false, src };
    G.samplers[k] = entry;
    status.loading++; emit();
    jobs.push(Promise.resolve(entry.inst.ready).then(() => { entry.ready = true; if (src.kind === "drums" || src.kind === "abuse") entry.map = drumMap(entry.inst); })
      .catch(() => status.failed.add(keyOf(src)))
      .finally(() => { status.loading--; emit(); }));
  }
  await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, timeoutMs))]);
}
function drumMap(dm) {
  const groups = (dm.getGroupNames ? dm.getGroupNames() : []).map(g => String(g));
  const map = {};
  for (const [midi, cands] of Object.entries(DM_GROUPS)) {
    const lc = groups.map(g => g.toLowerCase().replace(/[\s_]+/g, "-"));
    const at = i => (i >= 0 ? groups[i] : null);
    const hit = cands.map(c => at(lc.indexOf(c)) || at(lc.findIndex(g => g.startsWith(c)))).find(Boolean) || cands.map(c => at(lc.findIndex(g => g.includes(c)))).find(Boolean);
    if (hit) map[midi] = hit;
  }
  return map;
}
export function sampler(G, layer, src) {
  const e = G.samplers && G.samplers[layer + "|" + keyOf(src)];
  return e && e.ready ? e : null;
}

// Plays a pitched sampled note; returns false when the instrument isn't ready (use the fallback).
export function playSample(G, layer, n, t0, durSec, tim) {
  const e = sampler(G, layer, tim.src);
  if (!e) return false;
  e.inst.start({ note: n.midi, velocity: Math.max(1, Math.min(127, Math.round(n.vel * (tim.lvl ?? 1)))), time: t0, duration: durSec, lpfCutoffHz: Math.min(16000, tim.cut), ampRelease: Math.max(0.05, tim.r) });
  return true;
}
// Plays a drum hit on the selected kit; returns false when it can't (use the synthesized kit).
export function playDrum(G, kit, n, t0) {
  const K = KITS[kit];
  if (!K || kit === "synth") return false;
  if (K.machine || K.abuse) {
    const e = sampler(G, "perc", K.abuse ? { kind: "abuse", instrument: K.abuse } : { kind: "drums", instrument: K.machine });
    if (!e || !e.map[n.midi]) return false;
    e.inst.start({ note: e.map[n.midi], velocity: n.vel, time: t0 });
    return true;
  }
  const o = n.roll ? [TIMPANI, n.tune ?? 43] : ORCH[n.midi];
  if (!o) return false;
  const e = sampler(G, "perc", { kind: "sf", instrument: o[0] });
  if (!e) return false;
  e.inst.start({ note: o[1], velocity: n.vel, time: t0, duration: n.roll ? 0.3 : 1.2 });
  return true;
}
// What a kit needs loaded.
export function kitSpecs(kit) {
  const K = KITS[kit];
  if (!K || kit === "synth") return [];
  if (K.machine) return [{ layer: "perc", src: { kind: "drums", instrument: K.machine, gain: K.gain || 1 } }];
  if (K.abuse) return [{ layer: "perc", src: { kind: "abuse", instrument: K.abuse, gain: K.gain || 1 } }];
  return [...new Set([...Object.values(ORCH).map(o => o[0]), TIMPANI])].map(instrument => ({ layer: "perc", src: { kind: "sf", instrument } }));
}

/* ---------------- catalog: every sampled instrument and kit smplr offers ---------------- */
// General MIDI programs in order (the soundfont names), so each gets its GM family.
// (the list lives in core/gm.js, which the MIDI export shares)
// family: name, synthesized fallback type and envelope (release reaches the samples too)
const FAMILY = [
  ["Piano", "fm", { d: 2.4, s: 0.15, r: 0.8, ratio: 1, col: 0.15 }], ["Chromatic percussion", "fm", { d: 1.4, s: 0.15, r: 0.8, ratio: 3.5 }],
  ["Organ", "pad", { a: 0.02, r: 0.3, col: 0.3 }], ["Guitar", "pluck", { d: 1.8, r: 0.4 }], ["Bass", "bass", { a: 0.008, r: 0.2, cut: 3000 }],
  ["Strings", "pad", { a: 0.1, r: 0.6, col: 0.55 }], ["Ensemble", "pad", { a: 0.25, r: 0.9, col: 0.5 }], ["Brass", "pad", { a: 0.04, r: 0.4, col: 0.7 }],
  ["Reed", "pad", { a: 0.04, r: 0.35, col: 0.4 }], ["Pipe", "pad", { a: 0.05, r: 0.35, col: 0.1 }], ["Synth lead", "pad", { a: 0.01, r: 0.3, col: 0.75 }],
  ["Synth pad", "pad", { a: 0.6, r: 1.4, col: 0.4 }], ["Synth effects", "pad", { a: 0.4, r: 1.2, col: 0.5 }], ["Ethnic", "pluck", { d: 1.5, r: 0.5 }],
  ["Percussive", "fm", { d: 0.6, s: 0.1, r: 0.5, ratio: 2 }], ["Sound effects", "pad", { a: 0.2, r: 0.8, col: 0.5 }]
];
const pretty = s => { const t = s.replace(/__/g, " ").replace(/_/g, " ").replace(/\s+/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const base = (name, src, family, fb, p) => ({ type: "sample", name, src, family, fb, a: 0.01, d: 0.8, s: 0.8, r: 0.6, cut: 9000, q: 0.7, col: 0.35, det: 6, ratio: 1, ...p });

// Library entries for the whole catalog: { key: preset }. Curated presets stay as they are.
export function instrumentCatalog() {
  const out = {};
  GM.forEach((n, i) => { const [family, fb, p] = FAMILY[Math.floor(i / 8)]; out["gm." + n] = base(pretty(n), { kind: "sf", instrument: n }, "General MIDI: " + family, fb, p); });
  for (const n of getMellotronNames()) out["mt." + n] = base("Mellotron " + n.toLowerCase(), { kind: "mellotron", instrument: n }, "Mellotron", "pad", { a: 0.05, r: 0.5, col: 0.4 });
  for (const n of getMalletNames()) out["ml." + n] = base(n, { kind: "mallet", instrument: n }, "Mallets (VCSL)", "fm", { d: 1.4, s: 0.15, r: 0.8, ratio: 4 });
  for (const n of getElectricPianoNames()) out["ep." + n] = base("Electric piano " + n, { kind: "epiano", instrument: n }, "Electric pianos", "fm", { d: 1.2, s: 0.3, r: 0.5, ratio: 1, col: 0.35 });
  return out;
}
// Drum kits: the curated ones plus every DrumAbuse machine (about 220).
export function kitCatalog() {
  for (const id of getDrumAbuseMachineNames()) {
    const key = "abuse:" + id;
    if (!KITS[key]) KITS[key] = { name: pretty(id.replace(/-/g, " ")), abuse: id, gain: 2.5, group: "DrumAbuse machines" };
  }
  return KITS;
}
