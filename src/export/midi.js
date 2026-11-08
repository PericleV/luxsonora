// Type 1 MIDI file (480 PPQ): a tempo track and one track per audible layer.
// The timbre of each focus point is written as CC messages at its start, on melody and harmony.
// Every track ends exactly at the end of the piece (T seconds).
import { clamp, clampInt } from "../core/util.js";
import { STYLES } from "../core/theory.js";
import { ROLES } from "../core/arrange.js";
// channels for extra layers (channel 10, index 9, is percussion)
const EXTRA_CH = [4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

export function vlq(n) { const out = [n & 0x7f]; n >>= 7; while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; } return out; }
export const LAYER_DEF = [
  { key: "lead", ch: 0, name: "Melody" }, { key: "harm", ch: 1, name: "Harmony" }, { key: "bass", ch: 2, name: "Bass" },
  { key: "pad", ch: 3, name: "Pad" }, { key: "perc", ch: 9, name: "Rhythm" }
];
// CC encoding (documented in docs/documentation.md).
export const CC = {
  attack: T => Math.sqrt(clamp(T.a)), decay: T => Math.sqrt(clamp(T.d / 4)), release: T => Math.sqrt(clamp(T.r / 3)),
  brightness: T => clamp(Math.log2(T.cut / 300) / 5.5), resonance: T => clamp(T.q / 12)
};
export function midiFile(sc, isOn) {
  const PPQ = 480, st = STYLES[sc.style], tick = b => Math.max(0, Math.round(b * PPQ)), endT = tick(sc.total);
  const str = s => [...new TextEncoder().encode(s)];
  const meta = (type, bytes) => [0xff, type, ...vlq(bytes.length), ...bytes];
  const ser = evts => {
    evts.sort((a, b) => a.t - b.t || a.o - b.o);
    const out = []; let last = 0;
    for (const e of evts) { out.push(...vlq(e.t - last), ...e.b); last = e.t; }
    out.push(...vlq(Math.max(0, endT - last)), 0xff, 0x2f, 0); return out;
  };
  const us = Math.round(60000000 / sc.bpm);
  const tracks = [ser([
    { t: 0, o: 0, b: meta(0x03, str("Lux Sonora")) },
    { t: 0, o: 0, b: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) },
    { t: 0, o: 0, b: meta(0x58, [4, 2, 24, 8]) }
  ])];
  const c7 = v => clampInt(Math.round(v * 127), 0, 127);
  const defs = [...LAYER_DEF, ...(sc.extra || []).slice(0, EXTRA_CH.length).map((X, i) => ({ key: X.id, ch: EXTRA_CH[i], name: (ROLES[X.role] || {}).name || X.id, gm: (ROLES[X.role] || {}).gm ?? 0 }))];
  for (const L of defs) {
    if (!isOn(L.key)) continue;
    const ch = L.ch, ev = [{ t: 0, o: 0, b: meta(0x03, str(L.name)) }];
    if (ch !== 9) ev.push({ t: 0, o: 1, b: [0xc0 | ch, L.gm ?? st.gm[L.key]] });
    ev.push({ t: 0, o: 1, b: [0xb0 | ch, 7, 100] });
    if (L.key === "lead" || L.key === "harm") {
      const segs = sc.points.map(F => ({ t: F.t0, T: F.tim[L.key], pan: F.pan * (L.key === "lead" ? 1 : 0.4) }));
      const cad = sc.notes.find(nn => nn.point === -2 && nn.layer === L.key);
      if (cad) segs.push({ t: cad.t, T: cad.tim, pan: 0 });
      for (const s of segs) {
        const tt = tick(s.t);
        ev.push({ t: tt, o: 1, b: [0xb0 | ch, 73, c7(CC.attack(s.T))] });
        ev.push({ t: tt, o: 1, b: [0xb0 | ch, 75, c7(CC.decay(s.T))] });
        ev.push({ t: tt, o: 1, b: [0xb0 | ch, 72, c7(CC.release(s.T))] });
        ev.push({ t: tt, o: 1, b: [0xb0 | ch, 74, c7(CC.brightness(s.T))] });
        ev.push({ t: tt, o: 1, b: [0xb0 | ch, 71, c7(CC.resonance(s.T))] });
        ev.push({ t: tt, o: 1, b: [0xb0 | ch, 10, c7(0.5 + s.pan / 2)] });
      }
    }
    for (const nn of sc.notes) if (nn.layer === L.key) {
      const on = tick(nn.t), off = Math.min(endT, Math.max(on + 1, tick(nn.t + nn.dur)));
      ev.push({ t: on, o: 2, b: [0x90 | ch, nn.midi & 127, clampInt(nn.vel, 1, 127)] });
      ev.push({ t: off, o: 0, b: [0x80 | ch, nn.midi & 127, 0] });
    }
    tracks.push(ser(ev));
  }
  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 255, tracks.length & 255, PPQ >> 8, PPQ & 255];
  for (const tr of tracks) { const l = tr.length; out.push(0x4d, 0x54, 0x72, 0x6b, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255, ...tr); }
  return new Uint8Array(out);
}
