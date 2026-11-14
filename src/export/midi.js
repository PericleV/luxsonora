// Type 1 MIDI file (480 PPQ) for a DAW: a conductor track (title, tempo, metre, key signature with
// the modulation, a marker at every focus point) and one track per audible layer, named after the
// layer and its instrument, with the General MIDI program closest to that instrument.
// Per layer: the notes (velocities and timing as performed), the expression curve (CC11) and the
// vibrato curve (CC1) from perform.js, and on melody and harmony the timbre of each focus point as
// CC messages (attack 73, decay 75, release 72, brightness 74, resonance 71, pan 10).
// Every track ends exactly at the end of the piece (T seconds).
import { clamp, clampInt } from "../core/util.js";
import { STYLES, NOTE_SH } from "../core/theory.js";
import { ROLES } from "../core/arrange.js";
import { gmProgram } from "../core/gm.js";
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
// key signature: sharps (+) or flats (−) of a key, from its tonic and whether it is major
const MAJOR_SF = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
export const keySignature = (pc, major) => MAJOR_SF[(((major ? pc : pc + 3) % 12) + 12) % 12];
const SECTION = { intro: "Introduction", development: "Development", climax: "Climax", resolution: "Resolution" };

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
  const major = sc.major ?? (sc.modeIv ? sc.modeIv[2] === 4 : true);
  const ks = pc => { const sf = keySignature(pc, major); return meta(0x59, [sf & 255, major ? 0 : 1]); };
  const cond = [
    { t: 0, o: 0, b: meta(0x03, str("Lux Sonora")) },
    { t: 0, o: 0, b: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) },
    { t: 0, o: 0, b: meta(0x58, [4, 2, 24, 8]) },
    { t: 0, o: 0, b: ks(sc.pc) }
  ];
  const M = sc.modulation;
  if (M) { cond.push({ t: tick(M.t0), o: 0, b: ks(M.keyPc) }); cond.push({ t: tick(M.t1), o: 0, b: ks(sc.pc) }); }
  (sc.points || []).forEach((F, i) => cond.push({ t: tick(F.t0), o: 1, b: meta(0x06, str(`Point ${i + 1}${F.section ? " · " + (SECTION[F.section] || F.section) : ""}`)) }));
  if (sc.intro > 0) cond.push({ t: 0, o: 1, b: meta(0x06, str("Intro")) });
  if (sc.body < sc.total) cond.push({ t: tick(sc.body), o: 1, b: meta(0x06, str("Ending")) });
  const tracks = [ser(cond)];
  const c7 = v => clampInt(Math.round(v * 127), 0, 127);
  const defs = [...LAYER_DEF, ...(sc.extra || []).slice(0, EXTRA_CH.length).map((X, i) => ({ key: X.id, ch: EXTRA_CH[i], name: X.read ? "Raw: " + X.read : (ROLES[X.role] || {}).name || X.id, gm: (ROLES[X.role] || {}).gm ?? 0 }))];
  for (const L of defs) {
    if (!isOn(L.key) || (sc.omit || []).includes(L.key)) continue;
    const ch = L.ch, inst = (sc.inst && sc.inst[L.key]) || null;
    const ev = [{ t: 0, o: 0, b: meta(0x03, str(inst && inst.name && L.key !== "perc" ? `${L.name}: ${inst.name}` : L.name)) }];
    if (inst && inst.name && L.key !== "perc") ev.push({ t: 0, o: 0, b: meta(0x04, str(inst.name)) });
    if (ch !== 9) ev.push({ t: 0, o: 1, b: [0xc0 | ch, gmProgram(inst, L.gm ?? st.gm[L.key])] });
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
    // expression (CC11): the curve's points and its ramps, a value every eighth note when it moves
    const C = sc.cc && sc.cc[L.key];
    if (C && C.expr && C.expr.length) {
      let last = -1;
      const put = (b, v) => { const x = c7(v); if (x !== last) { ev.push({ t: tick(b), o: 1, b: [0xb0 | ch, 11, x] }); last = x; } };
      for (let i = 0; i < C.expr.length; i++) {
        const [b0, v0] = C.expr[i], nx = C.expr[i + 1];
        put(b0, v0);
        if (nx) for (let b = b0 + 0.5; b < nx[0] - 1e-9; b += 0.5) put(b, v0 + ((nx[1] - v0) * (b - b0)) / (nx[0] - b0));
      }
    }
    if (C && C.mod) for (const [b, v] of C.mod) ev.push({ t: tick(b), o: 1, b: [0xb0 | ch, 1, c7(v)] });
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
export const keyName = (pc, major) => NOTE_SH[((pc % 12) + 12) % 12] + (major ? " major" : " minor");
