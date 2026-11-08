// Image ingest: exact area averaging, format detection, TIFF decoding, tone processing.
import { describe, it, expect } from "vitest";
import { writeArrayBuffer } from "geotiff";
import { AreaAccumulator, resampleFloat, cropFloat, fitSize } from "../src/ingest/resample.js";
import { sniff, headerSize } from "../src/ingest/formats.js";
import { fromTiff, tiffInfo, fromRGBA8 } from "../src/ingest/decode.js";
import { ingestBuffer } from "../src/ingest/pipeline.js";
import { processImage, stats, dataRange, DEFAULT_SOURCE, LIN8, linearToSrgb } from "../src/ingest/tone.js";
import { mulberry32 } from "../src/core/util.js";

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

describe("area averaging", () => {
  it("preserves the mean exactly for non-integer factors", () => {
    const W = 997, H = 613, rnd = mulberry32(1), src = new Float32Array(W * H);
    for (let i = 0; i < src.length; i++) src[i] = rnd();
    for (const [w, h] of [[200, 123], [97, 61], [333, 205]]) {
      const out = resampleFloat(src, W, H, 1, w, h);
      // each output cell covers the same area, so the means agree
      expect(mean(Array.from(out))).toBeCloseTo(mean(Array.from(src)), 4);
    }
  });
  it("is exact for integer factors (block means)", () => {
    const W = 8, H = 4, src = Float32Array.from({ length: 32 }, (_, i) => i);
    const out = resampleFloat(src, W, H, 1, 4, 2);
    expect(Array.from(out)).toEqual([4.5, 6.5, 8.5, 10.5, 20.5, 22.5, 24.5, 26.5]);
  });
  it("does not depend on tiling", () => {
    const W = 300, H = 170, rnd = mulberry32(2), src = new Float32Array(W * H * 3);
    for (let i = 0; i < src.length; i++) src[i] = rnd();
    const whole = resampleFloat(src, W, H, 3, 77, 44);
    const acc = new AreaAccumulator(W, H, 77, 44, 3);
    for (let y0 = 0; y0 < H; y0 += 64) for (let x0 = 0; x0 < W; x0 += 64) {
      const tw = Math.min(64, W - x0), th = Math.min(64, H - y0);
      acc.addTile(x0, y0, tw, th, (i, c) => src[((y0 + ((i / tw) | 0)) * W + x0 + (i % tw)) * 3 + c]);
    }
    const tiled = acc.result();
    for (let i = 0; i < whole.length; i++) expect(tiled[i]).toBeCloseTo(whole[i], 5);
  });
  it("averages fine black and white stripes to mid grey in linear light", () => {
    const W = 600, H = 400, rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const v = (i % W) % 2 ? 255 : 0; rgba.set([v, v, v, 255], i * 4); }
    const base = fromRGBA8(rgba, W, H, 60);
    for (const v of base.data) expect(v).toBeCloseTo(0.5, 6);
    // shown as sRGB this is 188, not the 127 of averaging encoded values
    expect(Math.round(linearToSrgb(0.5) * 255)).toBe(188);
  });
  it("fitSize never upscales", () => {
    expect(fitSize(100, 50, 2048)).toEqual({ w: 100, h: 50 });
    expect(fitSize(8000, 2000, 2048)).toEqual({ w: 2048, h: 512 });
  });
  it("crop keeps the requested fractions", () => {
    const src = Float32Array.from({ length: 100 }, (_, i) => i), c = cropFloat(src, 10, 10, 1, { l: 0.1, t: 0.2, r: 0.3, b: 0 });
    expect([c.w, c.h, c.data[0]]).toEqual([6, 8, 21]);
  });
});

describe("format detection", () => {
  it("recognizes magic bytes and reads header sizes", () => {
    const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(png.buffer).setUint32(16, 6000); new DataView(png.buffer).setUint32(20, 4000);
    expect(sniff(png)).toBe("png"); expect(headerSize(png, "png")).toEqual({ w: 6000, h: 4000 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x17, 0x70, 0x03, 0, 0, 0, 0, 0, 0]);
    expect(sniff(jpg)).toBe("jpeg"); expect(headerSize(jpg, "jpeg")).toEqual({ w: 6000, h: 4000 });
    expect(sniff(new Uint8Array([0x49, 0x49, 0x2a, 0]))).toBe("tiff");
    expect(sniff(new Uint8Array([0x4d, 0x4d, 0, 0x2a]))).toBe("tiff");
    expect(sniff(new Uint8Array([0x49, 0x49, 0x2b, 0]))).toBe("bigtiff");
    expect(sniff(new Uint8Array([1, 2, 3, 4]))).toBe(null);
  });
});

// A synthetic SEM-like image: dark background, bright particles, noise, 16-bit.
function semImage(W, H) {
  const rnd = mulberry32(5), v = new Uint16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 9000 + 1500 * rnd();
    for (const [cx, cy, r] of [[0.3, 0.4, 0.08], [0.7, 0.6, 0.12], [0.5, 0.2, 0.05]]) if ((x / W - cx) ** 2 + (y / H - cy) ** 2 < r * r) s += 30000;
    v[y * W + x] = s;
  }
  return v;
}

describe("TIFF", () => {
  it("decodes a 16-bit greyscale image as measurement data, averaged in raw units", async () => {
    const W = 640, H = 480, px = semImage(W, H);
    const buf = writeArrayBuffer(px, { width: W, height: H });
    const t = await tiffInfo(buf);
    expect([t.w, t.h, t.bits, t.spp]).toEqual([W, H, 16, 1]);
    const base = await fromTiff(buf, 160);
    expect([base.kind, base.ch, base.w, base.h]).toEqual(["data", 1, 160, 120]);
    expect(mean(Array.from(base.data))).toBeCloseTo(mean(Array.from(px)), 0);
  });
  it("decodes 32-bit float data", async () => {
    const W = 100, H = 80, v = new Float32Array(W * H).map((_, i) => Math.sin(i * 0.01) * 1e-3);
    const base = await fromTiff(writeArrayBuffer(v, { width: W, height: H }), 50);
    expect(base.kind).toBe("data");
    expect(mean(Array.from(base.data))).toBeCloseTo(mean(Array.from(v)), 8);
  });
  it("treats 8-bit RGB TIFF as a photo in linear light", async () => {
    const W = 40, H = 20, v = new Uint8Array(W * H * 3).fill(128);
    const base = await fromTiff(writeArrayBuffer(v, { width: W, height: H, BitsPerSample: [8, 8, 8] }), 20);
    expect([base.kind, base.ch]).toEqual(["photo", 3]);
    expect(base.data[0]).toBeCloseTo(LIN8[128], 6);
  });
  it("goes through the full pipeline and refuses images over the limit", async () => {
    const W = 300, H = 200, buf = writeArrayBuffer(semImage(W, H), { width: W, height: H });
    const { info, base } = await ingestBuffer(buf, "sem.tif");
    expect(info.format).toBe("TIFF"); expect(info.kind).toBe("data"); expect(base.w).toBe(300);
    await expect(ingestBuffer(buf, "sem.tif", { warnMP: 0.01, maxMP: 0.05 })).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("tone processing", () => {
  it("default settings reproduce a photo to within one 8-bit step", () => {
    const W = 64, H = 4, rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) rgba.set([i % 256, (i * 3) % 256, (i * 7) % 256, 255], i * 4);
    const base = fromRGBA8(rgba, W, H, 2048), out = processImage(base.data, W, H, 3, "photo", null, DEFAULT_SOURCE);
    for (let i = 0; i < out.length; i++) if (i % 4 !== 3) expect(Math.abs(out[i] - rgba[i])).toBeLessThanOrEqual(1);
  });
  it("percentile stretch maps the data range onto 0..255", () => {
    const d = Float32Array.from({ length: 1000 }, (_, i) => 1000 + i);
    const st = stats(d, 1, 0.5, 99.5), r = dataRange({ bits: 16, sampleFormat: 1 }, st, DEFAULT_SOURCE);
    expect(r.mode).toBe("percentile");
    const out = processImage(d, 1000, 1, 1, "data", r, DEFAULT_SOURCE);
    expect(out[0]).toBe(0); expect(out[999 * 4]).toBe(255); expect(Math.abs(out[500 * 4] - 128)).toBeLessThanOrEqual(2);
  });
  it("8-bit data keeps its full range by default", () => {
    expect(dataRange({ bits: 8, sampleFormat: 1 }, { min: 10, max: 200, lo: 20, hi: 190 }, DEFAULT_SOURCE)).toMatchObject({ mode: "full", lo: 0, hi: 255 });
  });
  it("invert, contrast, gamma and greyscale behave as documented", () => {
    const d = Float32Array.from([0.25, 0.5, 1]);
    const inv = processImage(d, 3, 1, 1, "data", { lo: 0, hi: 1 }, { ...DEFAULT_SOURCE, invert: true });
    expect([inv[0], inv[4], inv[8]]).toEqual([191, 128, 0]);
    const gam = processImage(d, 3, 1, 1, "data", { lo: 0, hi: 1 }, { ...DEFAULT_SOURCE, gamma: 2 });
    expect(gam[0]).toBe(Math.round(Math.sqrt(0.25) * 255));
    const rgb = Float32Array.from([1, 0, 0]);
    const g = processImage(rgb, 1, 1, 3, "photo", null, { ...DEFAULT_SOURCE, channels: "gray" });
    expect(g[0]).toBe(g[1]); expect(g[0]).toBe(Math.round(linearToSrgb(0.2126) * 255));
  });
});
