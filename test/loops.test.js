import { describe, it, expect } from "vitest";
import { loopPoints } from "../src/audio/loops.js";

const SR = 22050;
// a held tone: a quick attack, a steady part, a fade at the end
function tone(sec, f, { fade = 0.3, noise = 0 } = {}) {
  const N = Math.round(sec * SR), x = new Float32Array(N);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < N; i++) {
    const t = i / SR, env = Math.min(1, t / 0.05) * Math.min(1, (sec - t) / fade);
    x[i] = env * (0.5 * Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(2 * Math.PI * 2 * f * t) + noise * rnd());
  }
  return x;
}

describe("loops for sustained samples", () => {
  it("a held tone gets a loop inside its steady part where the wave joins up", () => {
    const x = tone(3, 220), lp = loopPoints([x, x], SR);
    expect(lp).not.toBeNull();
    const [s, e] = lp;
    expect(s).toBeGreaterThan(0.7);
    expect(e).toBeLessThan(3 - 0.3);
    expect(e - s).toBeGreaterThan(0.25);
    // the jump from e back to s is seamless: the next samples match
    const is = Math.round(s * SR), ie = Math.round(e * SR);
    let d = 0, p = 0;
    for (let k = 0; k < 64; k++) { d += (x[is + k] - x[ie + k]) ** 2; p += x[ie + k] ** 2; }
    expect(d / p).toBeLessThan(0.05);
  });
  it("a short or decaying sound keeps playing as recorded", () => {
    expect(loopPoints([tone(0.5, 220)], SR)).toBeNull();
    const N = 3 * SR, pluck = new Float32Array(N);
    for (let i = 0; i < N; i++) pluck[i] = Math.exp(-i / (0.15 * SR)) * Math.sin((2 * Math.PI * 330 * i) / SR);
    expect(loopPoints([pluck], SR)).toBeNull();
  });
  it("silence has no loop", () => {
    expect(loopPoints([new Float32Array(3 * SR)], SR)).toBeNull();
  });
});
