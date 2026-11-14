// Style suggestion (src/core/suggest.js): every style has a profile, the three best are distinct,
// and clear pictures get the styles one would expect.
import { describe, it, expect } from "vitest";
import { STYLES } from "../src/core/theory.js";
import { suggestStyles, SUGGEST_PROFILES } from "../src/core/suggest.js";
import { analyze } from "../src/core/analyze.js";
import { synthImage } from "./helpers.js";

// a picture from its measures: lightness, warmth, saturation, hue, detail, contrast
const pic = ({ L = 0.5, warm = 0.5, sat = 0.3, hue = 0, hueStr = 0.3, detail = 0.5, contrast = 0.5 }) => {
  const n = 4000, arr = new Float32Array(n), sd = contrast * 0.3;
  for (let i = 0; i < n; i++) arr[i] = Math.min(1, Math.max(0, L + (i % 2 ? sd : -sd)));
  return { global: { brightness: L, warmth01: warm, sat: sat * 0.6, hue, hueStr, entropy: detail, edgeN: detail }, L: arr };
};
const top = A => suggestStyles(A).map(x => x.style);

describe("style suggestion", () => {
  it("every style has a profile, and every profile is a style", () => {
    for (const s of Object.keys(STYLES)) expect(SUGGEST_PROFILES[s], s).toBeTruthy();
    for (const s of Object.keys(SUGGEST_PROFILES)) expect(STYLES[s], s).toBeTruthy();
  });
  it("gives three distinct styles with a score and a reason", () => {
    const r = suggestStyles(analyze(synthImage(200, 133, 1)));
    expect(r.length).toBe(3); expect(new Set(r.map(x => x.style)).size).toBe(3);
    for (const x of r) { expect(x.score).toBeGreaterThan(0); expect(x.score).toBeLessThanOrEqual(1); expect(x.reason.length).toBeGreaterThan(3); }
    expect(r[0].score).toBeGreaterThanOrEqual(r[2].score);
  });
  it("a calm green landscape suggests the calm styles", () => {
    const t = top(pic({ L: 0.58, warm: 0.55, sat: 0.35, hue: 110, detail: 0.35, contrast: 0.35 }));
    expect(t.some(s => ["lofinature", "folk", "ambient", "meditation", "eastasian"].includes(s))).toBe(true);
    expect(t).not.toContain("metal");
  });
  it("a dark, grey, high-contrast, detailed picture suggests the heavy ones", () => {
    const t = top(pic({ L: 0.2, warm: 0.4, sat: 0.05, hueStr: 0.02, detail: 0.85, contrast: 0.85 }));
    expect(t.some(s => ["metal", "techno", "epic", "rock", "dnb"].includes(s))).toBe(true);
    expect(t).not.toContain("meditation");
  });
  it("a bright, vivid, warm picture suggests the lively ones", () => {
    const t = top(pic({ L: 0.7, warm: 0.65, sat: 0.8, hue: 40, detail: 0.6, contrast: 0.55 }));
    expect(t.some(s => ["pop", "funk", "reggae", "bossa", "chiptune"].includes(s))).toBe(true);
  });
  it("neon magenta at night suggests synthwave or electronic", () => {
    const t = top(pic({ L: 0.3, warm: 0.5, sat: 0.8, hue: 310, detail: 0.5, contrast: 0.65 }));
    expect(t.some(s => ["synthwave", "electronic"].includes(s))).toBe(true);
  });
});

// A style kept in the code but not offered yet is never suggested.
import { HIDDEN_STYLES } from "../src/core/theory.js";
describe("hidden styles", () => {
  it("are real styles, kept out of the suggestions", () => {
    for (const s of HIDDEN_STYLES) expect(STYLES[s], s).toBeTruthy();
    for (const seed of [1, 2, 3, 5, 7, 11, 13]) for (const x of suggestStyles(analyze(synthImage(160, 120, seed)), 28)) expect(HIDDEN_STYLES.has(x.style)).toBe(false);
  });
});
