// The tuning of the sampled instruments measured out of tune, and the tails that would ring into
// a chord they rub against.
import { describe, it, expect } from "vitest";
import { tuneFix, TUNED } from "../src/audio/tuning.js";
import { cutTails } from "../src/core/rules.js";
import { LIBRARY } from "../src/core/instruments.js";

describe("tuning", () => {
  it("detunes the measured notes back, the nearest key beyond them, nothing for the others", () => {
    expect(tuneFix({ kind: "mellotron", instrument: "BOYS CHOIR" }, 70)).toBe(38);
    expect(tuneFix({ kind: "mellotron", instrument: "CHMB FEMALE" }, 60)).toBe(-36);
    expect(tuneFix({ kind: "mellotron", instrument: "CHMB FEMALE" }, 90)).toBe(-10);
    expect(tuneFix({ kind: "sf", instrument: "flute" }, 60)).toBe(0);
    expect(tuneFix({ kind: "sf", instrument: "acoustic_guitar_nylon" }, 53)).toBe(0); // 2 cents: left alone
    expect(tuneFix(undefined, 60)).toBe(0);
  });
  it("every tuned instrument is one the library plays", () => {
    const srcs = new Set(Object.values(LIBRARY).filter(v => v.src).map(v => `${v.src.kind}:${v.src.instrument}`));
    for (const k of TUNED) expect(srcs.has(k), k).toBe(true);
  });
});

describe("no ringing into the next chord", () => {
  const C = [{ t0: 4, pcs: new Set([0, 4, 7]) }];
  it("cuts the release of a note that would rub against the next chord", () => {
    const n = { layer: "harm", t: 0, dur: 4, midi: 59, tim: { r: 1.5 } }; // B against C major
    cutTails([n], C, 0.5);
    // a short release, but not so short it clicks; the note ends a little earlier to fade in time
    expect(n.tim.r).toBeLessThanOrEqual(0.15 + 1e-9); expect(n.tim.r).toBeGreaterThanOrEqual(0.15 - 1e-9);
    expect(n.t + n.dur + (0.5 * n.tim.r) / 0.5).toBeLessThanOrEqual(4 + 1e-6);
  });
  it("keeps the tail of a note the chords share, and of one that does not rub", () => {
    const a = { layer: "harm", t: 0, dur: 4, midi: 60, tim: { r: 1.5 } }, b = { layer: "harm", t: 0, dur: 4, midi: 62, tim: { r: 1.5 } };
    cutTails([a, b], C, 0.5); expect(a.tim.r).toBe(1.5); expect(b.tim.r).toBe(1.5);
  });
  it("leaves the drums and a note that ends long before the change", () => {
    const d = { layer: "perc", t: 3.9, dur: 0.05, midi: 38 }, e = { layer: "harm", t: 0, dur: 1, midi: 59, tim: { r: 0.3 } };
    cutTails([d, e], C, 0.5); expect(d.tim).toBeUndefined(); expect(e.tim.r).toBe(0.3);
  });
});
