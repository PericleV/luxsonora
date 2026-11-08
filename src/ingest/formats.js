// Format detection from the first bytes of a file, and image size from the header
// (so oversized images can be refused before they are decoded).

export const FORMAT_NAME = { png: "PNG", jpeg: "JPEG", gif: "GIF", webp: "WebP", bmp: "BMP", avif: "AVIF", heic: "HEIC", tiff: "TIFF", bigtiff: "BigTIFF" };

export function sniff(b) {
  const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
  const str = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (str(0, 4) === "GIF8") return "gif";
  if (str(0, 4) === "RIFF" && str(8, 4) === "WEBP") return "webp";
  if (str(0, 2) === "BM") return "bmp";
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return "tiff";
  if (at(0, 0x49, 0x49, 0x2b, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2b)) return "bigtiff";
  if (str(4, 4) === "ftyp") {
    const brand = str(8, 4);
    if (brand === "avif" || brand === "avis") return "avif";
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return null;
}

// Width and height from the header, or null if unknown. TIFF sizes come from geotiff.
export function headerSize(b, fmt) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = b.length;
  try {
    if (fmt === "png" && n >= 24) return { w: dv.getUint32(16), h: dv.getUint32(20) };
    if (fmt === "gif" && n >= 10) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
    if (fmt === "bmp" && n >= 26) return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
    if (fmt === "jpeg") {
      let i = 2;
      while (i + 9 < n) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        const len = dv.getUint16(i + 2);
        if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
        i += 2 + len;
      }
      return null;
    }
    if (fmt === "webp" && n >= 30) {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
      if (chunk === "VP8L") { const v = dv.getUint32(21, true); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
      if (chunk === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    }
    if (fmt === "avif" || fmt === "heic") {
      // the first 'ispe' (image spatial extents) property box
      for (let i = 0; i + 20 < Math.min(n, 1 << 20); i++) {
        if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) return { w: dv.getUint32(i + 8), h: dv.getUint32(i + 12) };
      }
    }
  } catch (e) { return null; }
  return null;
}
