// File → working image + description. Runs in the decoding worker (or on the main
// thread as a fallback); it never creates a canvas larger than one tile.
import { sniff, headerSize, FORMAT_NAME } from "./formats.js";
import { tiffInfo, fromTiff, fromBitmap, tiffDescription, DISPLAY_MAX } from "./decode.js";

export const DEFAULT_LIMITS = { warnMP: 100, maxMP: 300 };

function fail(code, message) { const e = new Error(message); e.code = code; return e; }

function checkSize(w, h, limits) {
  const mp = (w * h) / 1e6;
  if (mp > limits.maxMP) throw fail("too_large", `This image has ${mp.toFixed(0)} megapixels; the limit on this device is ${limits.maxMP}. Downscale it first.`);
  return mp;
}

export async function ingestBuffer(buf, name, limits = DEFAULT_LIMITS, onProgress = () => {}) {
  const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 1 << 20));
  const fmt = sniff(head);
  if (!fmt) throw fail("unsupported", "This file isn't an image format Lux Sonora can read (PNG, JPEG, WebP, GIF, BMP, AVIF, TIFF).");
  const info = { name, format: FORMAT_NAME[fmt], bytes: buf.byteLength, pages: 1 };
  let base;
  if (fmt === "tiff" || fmt === "bigtiff") {
    const t = await tiffInfo(buf);
    info.mp = checkSize(t.w, t.h, limits);
    Object.assign(info, { w: t.w, h: t.h, bits: t.bits, sampleFormat: t.sampleFormat, spp: t.spp, pages: t.pages, description: tiffDescription(t) });
    base = await fromTiff(buf, limits.maxSide || DISPLAY_MAX, onProgress, t);
  } else {
    const hs = headerSize(head, fmt);
    if (hs) info.mp = checkSize(hs.w, hs.h, limits);
    let bmp;
    try { bmp = await createImageBitmap(new Blob([buf])); }
    catch (e) {
      throw fail("decode_failed", fmt === "heic" ? "This browser can't decode HEIC. Export the photo as JPEG or PNG." : "The image couldn't be decoded. The file may be damaged.");
    }
    info.mp = checkSize(bmp.width, bmp.height, limits);
    Object.assign(info, { w: bmp.width, h: bmp.height, bits: 8, sampleFormat: 1, spp: 3, description: "8-bit, decoded by the browser" });
    base = await fromBitmap(bmp, limits.maxSide || DISPLAY_MAX, onProgress);
    bmp.close();
  }
  info.kind = base.kind;
  info.large = info.mp > limits.warnMP;
  return { info, base };
}
