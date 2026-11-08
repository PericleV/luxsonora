// Video export geometry (frame size, eye, camera, view) and the audio formats written here.
import { describe, it, expect } from "vitest";
import { synthImage } from "./helpers.js";
import { analyze } from "../src/core/analyze.js";
import { computeSaliency } from "../src/core/saliency.js";
import { clusterRegions, buildMotifs } from "../src/core/motifs.js";
import { gazePath, readPoints, coverage, backgroundZone, DEFAULT_RADIUS } from "../src/core/focus.js";
import { compose } from "../src/core/compose.js";
import { frameSize, videoTimeline, gazeAt, cameraAt, cameraTrack, EASES, zoomEnv, viewRect, soundEnvelope, defaultVideo } from "../src/export/video.js";
import { wavEncode, masterGain } from "../src/export/audio.js";

const P0 = { style: "cinematic", duration: 30, count: 8, returns: 2, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS, wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, smooth: 0.6, arc: 0.7, connect: "rich" };
function score(P = P0) {
  const A = analyze(synthImage(200, 133, 1)), CL = clusterRegions(A, 6), MOT = buildMotifs(CL, A.regions);
  const SAL = computeSaliency(A, { color: 0.7, texture: 0.5, semantic: 0 }, null);
  const pts = readPoints(A, CL, gazePath(A, SAL.map, P)), cov = coverage(A, pts); cov.zone = backgroundZone(A, cov);
  return compose({ A, sal: SAL, points: pts, cl: CL, motifs: MOT, P, sem: null, cov });
}

describe("frame size", () => {
  it("has even sides, the short one the chosen size", () => {
    expect(frameSize("square", 1080, 300, 200)).toEqual({ W: 1080, H: 1080 });
    expect(frameSize("vertical", 1080, 300, 200)).toEqual({ W: 1080, H: 1920 });
    expect(frameSize("wide", 720, 300, 200)).toEqual({ W: 1280, H: 720 });
    expect(frameSize("image", 1080, 3000, 2000)).toEqual({ W: 1620, H: 1080 });
    const tall = frameSize("image", 1080, 1000, 5000);
    expect(tall.W).toBe(1080); expect(tall.H % 2).toBe(0); expect(tall.H / tall.W).toBeLessThanOrEqual(2.41);
  });
});

describe("the eye and the camera", () => {
  const sc = score(), tl = videoTimeline(sc), spb = 60 / sc.bpm, total = sc.total * spb;
  it("leave each point with its connection and arrive on the next one's start", () => {
    expect(tl.length).toBe(sc.points.length);
    for (let i = 0; i + 1 < tl.length; i++) {
      const p = tl[i];
      expect(p.move).toBeGreaterThan(p.t0); expect(p.move).toBeLessThan(p.t1);
      const firstPassage = sc.notes.filter(n => n.layer === "lead" && n.passage && n.passage.from === i).map(n => n.t * spb);
      if (firstPassage.length) expect(p.move).toBeGreaterThanOrEqual(Math.min(p.t1 - 0.04, Math.max(p.t0 + 0.3 * (p.t1 - p.t0), Math.min(...firstPassage))) - 1e-9);
      // on the point until it leaves, on the next one at the boundary
      const a = gazeAt(tl, p.move - 1e-3); expect(a.x).toBeCloseTo(p.x, 9); expect(a.u).toBe(0);
      const b = gazeAt(tl, p.t1 - 1e-6); expect(b.x).toBeCloseTo(tl[i + 1].x, 3);
      expect(gazeAt(tl, p.t1).i).toBe(i + 1);
    }
  });
  it("move continuously: no jump between two frames", () => {
    let prev = null, prevCam = null;
    for (let t = 0; t <= total; t += 1 / 60) {
      const g = gazeAt(tl, t), c = cameraAt(tl, t);
      if (prev) {
        expect(Math.hypot(g.x - prev.x, g.y - prev.y)).toBeLessThan(0.2);
        expect(Math.hypot(c.x - prevCam.x, c.y - prevCam.y)).toBeLessThan(0.05);
      }
      prev = g; prevCam = c;
    }
  });
  it("follow the eye with a smoothed track that stays in the image and still arrives", () => {
    const iw = 1500, ih = 1000, W = 1080, H = 1920, o = { ...defaultVideo(), camera: "follow", zoom: 0.5 };
    const accel = tr => { let mx = 0; for (let t = 2 / 60; t <= total; t += 1 / 60) { const a = tr.at(t - 2 / 60), b = tr.at(t - 1 / 60), c = tr.at(t); mx = Math.max(mx, Math.abs(c.x - 2 * b.x + a.x), Math.abs(c.y - 2 * b.y + a.y)); } return mx; };
    const raw = cameraTrack(tl, total, { ...o, camSmooth: 0, camEase: "linear" }, iw, ih, W, H);
    const smooth = cameraTrack(tl, total, { ...o, camSmooth: 0.5, camEase: "smooth" }, iw, ih, W, H);
    expect(accel(smooth)).toBeLessThan(accel(raw) / 2);
    for (let t = 0; t <= total; t += 0.25) {
      const v = smooth.at(t);
      expect(v.x).toBeGreaterThanOrEqual(-1e-6); expect(v.x + v.w).toBeLessThanOrEqual(iw + 1e-6);
      expect(v.y).toBeGreaterThanOrEqual(-1e-6); expect(v.y + v.h).toBeLessThanOrEqual(ih + 1e-6);
      expect(v.w / v.h).toBeCloseTo(W / H, 6);
    }
    // in the middle of a long point the smoothed view matches the aimed one (it does not lag behind)
    const p = tl.reduce((a, b) => (b.t1 - b.t0 > a.t1 - a.t0 ? b : a)), mid = (p.t0 + p.t1) / 2;
    const ra = raw.at(mid), sa = smooth.at(mid);
    expect(Math.abs(ra.x - sa.x)).toBeLessThan(0.06 * iw); expect(Math.abs(ra.y - sa.y)).toBeLessThan(0.06 * ih);
    // a still camera with a push-in narrows the view over the piece
    const still = cameraTrack(tl, total, { ...o, camera: "still", drift: 0.2, camSmooth: 0 }, iw, ih, W, H);
    expect(still.at(total).w).toBeCloseTo(still.at(0).w / 1.2, 3);
    for (const k of Object.keys(EASES)) { expect(EASES[k].f(0)).toBeCloseTo(0, 9); expect(EASES[k].f(1)).toBeCloseTo(1, 9); expect(EASES[k].f(0.5)).toBeCloseTo(0.5, 9); }
  });
  it("zoom in after the start and out over the cadence", () => {
    expect(zoomEnv(tl, 0, total)).toBe(0);
    expect(zoomEnv(tl, 2, total)).toBe(1);
    expect(zoomEnv(tl, total, total)).toBeCloseTo(0, 9);
  });
  it("have a sound envelope in [0, 1]", () => {
    const env = soundEnvelope(sc, 100);
    expect(env.length).toBe(100); expect(Math.max(...env)).toBeCloseTo(1, 6);
    for (const v of env) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe("view", () => {
  it("fills the frame inside the image, or shows the whole image", () => {
    const f = viewRect(3000, 2000, 1080, 1920, "fill", 0.9, 0.5, 1);
    expect(f.h).toBeCloseTo(2000, 6); expect(f.w / f.h).toBeCloseTo(1080 / 1920, 9);
    expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x + f.w).toBeLessThanOrEqual(3000 + 1e-9);
    const z = viewRect(3000, 2000, 1920, 1080, "fill", 0, 0, 2);
    expect(z.x).toBe(0); expect(z.y).toBe(0); expect(z.w).toBeCloseTo(1500, 6);
    const fit = viewRect(3000, 2000, 1080, 1080, "fit", 0.2, 0.2, 1);
    expect(fit.w).toBe(3000); expect(fit.x).toBe(0); expect(fit.y).toBe(-500);
  });
  it("defaults are complete", () => {
    const v = defaultVideo();
    for (const k of ["shape", "size", "fps", "camera", "path", "points", "fx", "caption", "bottom", "pathColor", "pointColor"]) expect(v[k]).toBeDefined();
  });
});

describe("WAV", () => {
  const sr = 8000, a = new Float32Array([0, 0.5, -0.5, 1.2]), b = new Float32Array([0.25, -1, 0, 0]);
  it("writes 24-bit samples with the gain, clipped", () => {
    const w = wavEncode([a, b], sr, 1, 24), dv = new DataView(w.buffer);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe("RIFF");
    expect(dv.getUint16(34, true)).toBe(24); expect(dv.getUint32(40, true)).toBe(4 * 2 * 3);
    const s24 = o => { const v = w[o] | (w[o + 1] << 8) | (w[o + 2] << 16); return v & 0x800000 ? v - 0x1000000 : v; };
    expect(s24(44 + 3)).toBe(Math.round(0.25 * 8388607)); // first frame, right
    expect(s24(44 + 6)).toBe(Math.round(0.5 * 8388607));  // second frame, left
    expect(s24(44 + 9)).toBe(-8388607);                   // −1
    expect(s24(44 + 18)).toBe(8388607);                   // 1.2 clipped
  });
  it("normalizes the peak to 0.9 without a fixed gain", () => {
    expect(masterGain([a, b])).toBeCloseTo(0.9 / 1.2, 6); // Float32 peak
    expect(masterGain([a, b], 0.5)).toBe(0.5);
    const w16 = wavEncode([a, b], sr, 1, 16); expect(new DataView(w16.buffer).getUint16(34, true)).toBe(16);
  });
});
