// Decoders that turn a file into a working image (interleaved Float32, long side at most
// DISPLAY_MAX) without ever holding a full-size canvas.
//   photo: browser formats and RGB TIFF, values in linear light 0..1
//   data:  single-channel TIFF (SEM, TEM, detector images), values in raw units
import { fromArrayBuffer } from "geotiff";
import { AreaAccumulator, fitSize } from "./resample.js";
import { LIN8, srgbToLinear } from "./tone.js";

export const DISPLAY_MAX = 2048;
const TILE = 2048; // ≤ 4096² keeps every intermediate canvas within Safari's limits
// lets the page repaint (and a cancel click through) when decoding runs on the main thread
const yieldToPage = () => new Promise(r => setTimeout(r, 0));

// Transparent pixels are composited over black (the stage colour), in linear light.
export function fromRGBA8(rgba, W, H, maxSide = DISPLAY_MAX) {
  const { w, h } = fitSize(W, H, maxSide), acc = new AreaAccumulator(W, H, w, h, 3);
  acc.addTile(0, 0, W, H, (i, c) => LIN8[rgba[i * 4 + c]] * (rgba[i * 4 + 3] / 255));
  return { kind: "photo", ch: 3, w, h, data: acc.result() };
}

// Browser-decoded bitmap, read back in tiles through a small OffscreenCanvas.
export async function fromBitmap(bmp, maxSide = DISPLAY_MAX, onProgress = () => {}) {
  const W = bmp.width, H = bmp.height, { w, h } = fitSize(W, H, maxSide), acc = new AreaAccumulator(W, H, w, h, 3);
  const tw0 = Math.min(TILE, W), th0 = Math.min(TILE, H);
  const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(tw0, th0) : Object.assign(document.createElement("canvas"), { width: tw0, height: th0 });
  const g = cv.getContext("2d", { willReadFrequently: true });
  const total = Math.ceil(W / TILE) * Math.ceil(H / TILE); let done = 0;
  for (let y0 = 0; y0 < H; y0 += TILE) for (let x0 = 0; x0 < W; x0 += TILE) {
    const tw = Math.min(TILE, W - x0), th = Math.min(TILE, H - y0);
    g.clearRect(0, 0, tw, th); g.drawImage(bmp, x0, y0, tw, th, 0, 0, tw, th);
    const d = g.getImageData(0, 0, tw, th).data;
    acc.addTile(x0, y0, tw, th, (i, c) => LIN8[d[i * 4 + c]] * (d[i * 4 + 3] / 255));
    onProgress(++done / total);
    await yieldToPage();
  }
  return { kind: "photo", ch: 3, w, h, data: acc.result() };
}

const SAMPLE_FORMAT_NAME = { 1: "unsigned integer", 2: "signed integer", 3: "floating point" };
const PHOTOMETRIC = { 0: "WhiteIsZero", 1: "BlackIsZero", 2: "RGB", 3: "Palette", 4: "Mask", 5: "CMYK", 6: "YCbCr", 8: "CIELab" };

// TIFF metadata without decoding pixels.
export async function tiffInfo(buf) {
  const tiff = await fromArrayBuffer(buf), img = await tiff.getImage(0);
  const fd = img.fileDirectory, pi = fd.getValue("PhotometricInterpretation");
  return {
    tiff, img, w: img.getWidth(), h: img.getHeight(), spp: img.getSamplesPerPixel(),
    bits: img.getBitsPerSample(0), sampleFormat: img.getSampleFormat(0), photometric: pi ?? 1,
    pages: await tiff.getImageCount(), compression: fd.getValue("Compression") ?? 1
  };
}

// Decodes a TIFF in horizontal bands so memory stays proportional to one band.
export async function fromTiff(buf, maxSide = DISPLAY_MAX, onProgress = () => {}, known = null) {
  const t = known || await tiffInfo(buf), { img, w: W, h: H, spp, bits, sampleFormat, photometric } = t;
  const { w, h } = fitSize(W, H, maxSide);
  // single-channel images (optionally with alpha) are measurement data; everything else is a photo
  const data = (spp === 1 || spp === 2) && (photometric === 0 || photometric === 1);
  const rgbDirect = photometric === 2 && spp >= 3 && sampleFormat !== 3;
  const ch = data ? 1 : 3, acc = new AreaAccumulator(W, H, w, h, ch);
  const bandRows = Math.max(1, Math.floor(8e6 / (W * Math.max(1, spp))));
  const maxInt = 2 ** bits - 1;
  for (let y0 = 0; y0 < H; y0 += bandRows) {
    const y1 = Math.min(H, y0 + bandRows), th = y1 - y0, win = [0, y0, W, y1];
    if (data) {
      const [band] = await img.readRasters({ window: win, samples: [0] });
      const white = photometric === 0;
      // NaN (no-data) samples count as 0
      const get = white ? (i => { const v = band[i]; return v === v ? (sampleFormat === 3 ? -v : maxInt - v) : 0; }) : (i => { const v = band[i]; return v === v ? v : 0; });
      acc.addTile(0, y0, W, th, get);
    } else if (rgbDirect) {
      const r = await img.readRasters({ window: win, samples: [0, 1, 2] });
      const lut = bits === 8 ? LIN8 : null;
      acc.addTile(0, y0, W, th, lut ? ((i, c) => lut[r[c][i]]) : ((i, c) => srgbToLinear(r[c][i] / maxInt)));
    } else {
      // palette, CMYK, YCbCr, CIELab: geotiff converts to 8-bit RGB
      const rgb = await img.readRGB({ window: win, interleave: true });
      acc.addTile(0, y0, W, th, (i, c) => LIN8[rgb[i * 3 + c]]);
    }
    onProgress(y1 / H);
    await yieldToPage();
  }
  return { kind: data ? "data" : "photo", ch, w, h, data: acc.result() };
}

export function tiffDescription(t) {
  const parts = [`${t.bits}-bit ${SAMPLE_FORMAT_NAME[t.sampleFormat] || "integer"}`, PHOTOMETRIC[t.photometric] || `photometric ${t.photometric}`];
  if (t.spp > 1) parts.push(`${t.spp} samples per pixel`);
  return parts.join(", ");
}
