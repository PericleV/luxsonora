import { describe, it, expect } from "vitest";
import { RULES, MODES, STYLES, autoModeOf, moodOf } from "../src/core/theory.js";

const triad = (iv, d) => { const a = iv[d], b = iv[(d + 2) % 7] + (d + 2 >= 7 ? 12 : 0), e = iv[(d + 4) % 7] + (d + 4 >= 7 ? 12 : 0); return [b - a, e - a].join(","); };

describe("progression families and the mood of the picture", () => {
  it("every candidate chord of a family is a major or a minor triad in each of its modes", () => {
    for (const R of Object.values(RULES)) for (const F of R.families || []) for (const m of Object.keys(F.modes)) {
      const c = (F.candsBy && F.candsBy[m]) || F.cands;
      for (const d of c.flat()) expect(["4,7", "3,7"]).toContain(triad(MODES[m].iv, d));
    }
  });
  it("the mood is stretched: an ordinary range of pictures reaches the dark and the bright families", () => {
    expect(moodOf(0.2)).toBe(0); expect(moodOf(0.8)).toBe(1);
    const fams = new Set([0.27, 0.39, 0.48, 0.58, 0.63, 0.7].map(v => autoModeOf("epic", v).family.key));
    expect([...fams].sort()).toEqual(["dark", "heroic", "minor"]);
  });
  it("a style without families spreads its modes over the mood, darkest first", () => {
    const modes = [0.25, 0.4, 0.55, 0.75].map(v => autoModeOf("synthwave", v).modeKey);
    expect(new Set(modes).size).toBeGreaterThanOrEqual(3);
    for (const m of modes) expect(STYLES.synthwave.modes).toContain(m);
    expect(MODES[modes[0]].b).toBeLessThanOrEqual(MODES[modes[3]].b);
  });
  it("a mode chosen by hand brings its family", () => {
    expect(autoModeOf("epic", 0.3, "lydian")).toMatchObject({ modeKey: "lydian", family: { key: "heroic" } });
    expect(autoModeOf("epic", 0.7, "phrygian").family.key).toBe("dark");
    expect(autoModeOf("epic", 0.3, "aeolian").family.key).toBe("minor");
  });
});
