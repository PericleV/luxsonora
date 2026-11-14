// Video look: path geometry, labels, grades, fades, looks, the sound analysis, GIF ranges.
import { describe, it, expect } from "vitest";
import { pathGeometry, LINE_STYLES } from "../src/export/paths.js";
import { colourLabel, objectAt, labelFor, autoLabels, hueName } from "../src/export/labels.js";
import { gradePixel, GRADES, fadeAt, fadeAudio, LOOKS, LOOK_KEYS, pickLook, PLATFORMS, safeArea } from "../src/export/look.js";
import { analyzeAudio, analyzeNotes, valueAt, BANDS } from "../src/export/reactive.js";
import { defaultVideo, frameSize, gifRange, EYES, BOTTOMS, mixHex } from "../src/export/video.js";

const tl = [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.8 }, { x: 0.9, y: 0.3 }, { x: 0.4, y: 0.1 }];

describe("path geometry", () => {
  for (const curved of [false, true]) it(`passes through every point and is continuous (${curved ? "curved" : "straight"})`, () => {
    const g = pathGeometry(tl, curved);
    tl.forEach((p, j) => { const q = g.at(j); expect(q.x).toBeCloseTo(p.x, 9); expect(q.y).toBeCloseTo(p.y, 9); });
    let prev = g.at(0);
    for (let f = 0.01; f <= 3; f += 0.01) { const q = g.at(f); expect(Math.hypot(q.x - prev.x, q.y - prev.y)).toBeLessThan(0.03); prev = q; }
    const r = g.range(0.5, 2.25);
    expect(r[0].f).toBe(0.5); expect(r[r.length - 1].f).toBe(2.25);
    for (let k = 1; k < r.length; k++) expect(r[k].f).toBeGreaterThan(r[k - 1].f);
    if (curved) expect(r.length).toBeGreaterThan(10); else expect(r.length).toBe(4);
  });
  it("offers at least ten line styles", () => { expect(Object.keys(LINE_STYLES).length).toBeGreaterThanOrEqual(10); });
});

describe("labels", () => {
  const objs = [{ name: "boat", x: 0.4, y: 0.5, w: 0.2, h: 0.2 }, { name: "person", x: 0.45, y: 0.55, w: 0.05, h: 0.1 }, { name: "dog", x: 0.8, y: 0.8, w: 0.05, h: 0.05 }];
  it("name the smallest object under a place, else a near one, else nothing", () => {
    expect(objectAt(objs, 0.47, 0.6).name).toBe("person");
    expect(objectAt(objs, 0.42, 0.52).name).toBe("boat");
    expect(objectAt(objs, 0.86, 0.84).name).toBe("dog");
    expect(objectAt(objs, 0.05, 0.05)).toBe(null);
  });
  it("describe colour and light when there is no object", () => {
    expect(hueName(30)).toBe("orange"); expect(hueName(220)).toBe("blue"); expect(hueName(350)).toBe("red");
    expect(colourLabel({ L: 0.85, sat: 0.6, hue: 40, edge: 0.2 })).toBe("bright warm light");
    expect(colourLabel({ L: 0.15, sat: 0.5, hue: 220, edge: 0.2 })).toBe("deep blue shadow");
    expect(colourLabel({ L: 0.5, sat: 0.05, hue: 0, edge: 0.2 })).toBe("grey area");
    const sc = { points: [{ x: 0.47, y: 0.6, idx: 0, reg: { L: 0.5, sat: 0.4, hue: 100 } }, { x: 0.1, y: 0.1, idx: 1, reg: { L: 0.5, sat: 0.4, hue: 100, edge: 0.7 } }] };
    expect(autoLabels(sc, objs)).toEqual(["Person", "Green detail"]);
  });
  it("use the user's own text by point number; empty shows nothing", () => {
    expect(labelFor("custom", 0, ["Auto"], { 1: " Turnul " })).toBe("Turnul");
    expect(labelFor("custom", 1, ["Auto", "B"], { 1: "x" })).toBe("");
    expect(labelFor("auto", 1, ["Auto", "B"], {})).toBe("B");
    expect(labelFor("off", 0, ["A"], { 1: "x" })).toBe("");
  });
});

describe("look", () => {
  it("grades stay in range and do nothing at 0", () => {
    for (const g of Object.keys(GRADES)) for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.9], [0.9, 0.4, 0.1]]) {
      const o = gradePixel(...c, g, 1); for (const v of o) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      const z = gradePixel(...c, g, 0); z.forEach((v, i) => expect(v).toBeCloseTo(c[i], 9));
    }
    const m = gradePixel(0.9, 0.2, 0.1, "mono", 1); expect(m[0]).toBeCloseTo(m[1], 9); expect(m[1]).toBeCloseTo(m[2], 9);
  });
  it("fade the picture and the sound in and out", () => {
    expect(fadeAt(0, 30, 1, 2)).toBe(1); expect(fadeAt(0.5, 30, 1, 2)).toBeCloseTo(0.5, 9); expect(fadeAt(10, 30, 1, 2)).toBe(0); expect(fadeAt(30, 30, 1, 2)).toBe(1);
    const c = new Float32Array(100).fill(1), [f] = fadeAudio([c], 10, 2, 3);
    expect(f[0]).toBe(0); expect(f[10]).toBeCloseTo(0.5, 6); expect(f[50]).toBe(1); expect(f[99]).toBe(0); expect(c[0]).toBe(1);
  });
  it("looks use only known settings, and every look key has a default", () => {
    const d = defaultVideo();
    for (const k of LOOK_KEYS) expect(d).toHaveProperty(k);
    for (const l of Object.values(LOOKS)) for (const k of Object.keys(l)) if (k !== "name") expect(LOOK_KEYS).toContain(k);
    for (const l of Object.values(LOOKS)) { if (l.eye) expect(Object.keys(EYES)).toContain(l.eye); if (l.bottom) expect(Object.keys(BOTTOMS)).toContain(l.bottom); }
    const pick = pickLook(d); expect(pick).not.toHaveProperty("title"); expect(pick).not.toHaveProperty("size"); expect(pick.fx).not.toBe(d.fx);
  });
  it("platforms and safe areas", () => {
    for (const p of Object.values(PLATFORMS)) if (p.shape) { const f = frameSize(p.shape, p.size, 3000, 2000); expect(f.W % 2 + f.H % 2).toBe(0); }
    expect(frameSize("portrait", 1080, 10, 10)).toEqual({ W: 1080, H: 1350 });
    expect(frameSize("wide", 2160, 10, 10)).toEqual({ W: 3840, H: 2160 });
    // the image's own size: even sides, at most 3840 px and 8.8 MP, at least 240 px
    expect(frameSize("image", "original", 1601, 1067)).toEqual({ W: 1602, H: 1068 });
    const big = frameSize("image", "original", 6000, 4000); expect(big.W).toBeLessThanOrEqual(3840); expect(big.W * big.H).toBeLessThanOrEqual(8.8e6 + 4000); expect(big.W / big.H).toBeCloseTo(1.5, 2);
    expect(frameSize("image", "original", 100, 50)).toEqual({ W: 480, H: 240 });
    expect(frameSize("square", "original", 3000, 2000)).toEqual({ W: 2000, H: 2000 });
    const s = safeArea("vertical"); expect(s.top + s.bottom).toBeLessThan(0.5);
  });
});

describe("colours", () => {
  it("mix two colours for the gradient and the colour that follows the sound", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#ff0000", "#0000ff", 0.5)).toBe("#800080");
    expect(mixHex("#123", "#123", 0.7)).toBe("#112233");
    expect(mixHex("#ff0000", "#0000ff", 2)).toBe("#0000ff");
    const d = defaultVideo(); for (const k of ["titleColor", "subColor", "eyeColor", "labelColor", "labelBg", "bottomColor", "bottomColor2"]) expect(d[k]).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("sound analysis", () => {
  it("finds the kicks of a rendered signal and stays in range", () => {
    const sr = 22050, len = sr * 4, ch = new Float32Array(len);
    const kicks = [0.5, 1.5, 2.5, 3.5];
    for (const t of kicks) for (let i = 0; i < sr * 0.15; i++) { const k = Math.round(t * sr) + i; ch[k] += Math.sin(2 * Math.PI * 60 * i / sr) * Math.exp(-i / (sr * 0.05)); }
    for (let i = 0; i < len; i++) ch[i] += 0.02 * Math.sin(2 * Math.PI * 2000 * i / sr);
    const an = analyzeAudio([ch, ch], sr, 60);
    for (const t of kicks) expect(Math.max(valueAt(an, an.beat, t + 0.02), valueAt(an, an.beat, t + 0.04))).toBeGreaterThan(0.5);
    expect(valueAt(an, an.beat, 1.1)).toBeLessThan(0.3);
    expect(an.bands.length).toBe(an.frames * BANDS);
    for (const arr of [an.rms, an.beat, an.bands, an.env]) for (const v of arr) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(an.wave(1, 64).length).toBe(64);
  });
  it("falls back to the notes' kicks", () => {
    const sc = { bpm: 60, total: 4, notes: [{ layer: "perc", midi: 36, t: 1, dur: 0.1, vel: 127 }, { layer: "lead", midi: 60, t: 0, dur: 4, vel: 90 }] };
    const an = analyzeNotes(sc, new Float32Array(10).fill(0.5));
    expect(valueAt(an, an.beat, 1)).toBeCloseTo(1, 6); expect(valueAt(an, an.beat, 0.5)).toBe(0);
  });
  it("GIF ranges stay inside the piece", () => {
    const S = { total: 30, tl: [{ t0: 0, section: "intro" }, { t0: 20, section: "climax" }] };
    expect(gifRange(S, "climax")).toEqual([18.5, 26.5]);
    expect(gifRange(S, "start")).toEqual([0, 10]);
    expect(gifRange({ total: 6, tl: [{ t0: 5, section: "climax" }] }, "climax")).toEqual([0, 6]);
  });
});

// Labels with their own animation, the place the eye is on, three more lines.
import { PLACE_NOW, LABEL_INS, LABEL_OUTS, LABEL_POS } from "../src/export/video.js";
describe("labels, the active place and the new lines", () => {
  it("defaults keep the earlier look and every new choice is a known one", () => {
    const V = defaultVideo();
    expect(V.labelIn).toBe("rise"); expect(V.labelOut).toBe("fade"); expect(V.labelInSecs).toBe(0.35); expect(V.labelOutSecs).toBe(0.5);
    expect(V.labelHold).toBe(0); expect(V.labelPos).toBe("auto"); expect(V.labelSize).toBe(1); expect(V.labelLine).toBe(false); expect(V.labelBgOp).toBe(0.78);
    expect(V.placeNow).toBe("same"); expect(V.placeNowOp).toBe(1); expect(V.placeFill).toBe(1); expect(V.placeLineW).toBe(1);
    expect(LABEL_INS[V.labelIn]).toBeTruthy(); expect(LABEL_OUTS[V.labelOut]).toBeTruthy(); expect(LABEL_POS[V.labelPos]).toBeTruthy(); expect(PLACE_NOW[V.placeNow]).toBeTruthy();
  });
  it("a saved look keeps the new choices", () => {
    for (const k of ["labelIn", "labelOut", "labelInSecs", "labelOutSecs", "labelHold", "labelPos", "labelSize", "labelBgOp", "labelLine", "placeNow", "placeNowOp", "placeFill", "placeLineW"]) expect(LOOK_KEYS, k).toContain(k);
    expect(new Set(LOOK_KEYS).size).toBe(LOOK_KEYS.length);
  });
  it("offers the particles, constellation and electric lines", () => {
    for (const k of ["particles", "constellation", "electric"]) expect(LINE_STYLES[k]).toBeTruthy();
  });
});

// Labels dragged on the preview, a sound display with its own shape, more ripples.
import { RIPPLE_LOOKS, RIPPLE_FILLS, LABEL_BEATS, LABEL_FILLS } from "../src/export/video.js";
describe("labels that move, the sound display's shape and the new ripples", () => {
  it("defaults keep the earlier look", () => {
    const V = defaultVideo();
    expect(V.labelOff).toEqual({}); expect(V.labelBeat).toBe("off"); expect(V.labelFill).toBe("solid");
    expect(V.barThick).toBe(1); expect(V.barGain).toBe(1); expect(V.barGap).toBe(1); expect(V.barRound).toBe(false);
    expect(V.rippleFill).toBe("solid");
    expect(LABEL_BEATS[V.labelBeat]).toBeTruthy(); expect(LABEL_FILLS[V.labelFill]).toBeTruthy(); expect(RIPPLE_FILLS[V.rippleFill]).toBeTruthy();
  });
  it("offers tiles, a grid and a matrix as ripples, and a look keeps the new choices but not where labels were dragged", () => {
    for (const k of ["lens", "rings", "dots", "squares", "grid", "matrix"]) expect(RIPPLE_LOOKS[k]).toBeTruthy();
    for (const k of ["labelBeat", "labelBeatAmt", "labelFill", "labelBg2", "barThick", "barGain", "barGap", "barRound", "rippleFill", "rippleColor2"]) expect(LOOK_KEYS, k).toContain(k);
    // the places of one picture mean nothing on another
    expect(LOOK_KEYS).not.toContain("labelOff");
  });
});
