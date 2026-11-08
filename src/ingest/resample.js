// Exact area-average (box) resampling, fed tile by tile.
//
// A source pixel x covers [x, x+1) in source units, i.e. [x·s, (x+1)·s) in target units
// (s = dstW / srcW ≤ 1). It contributes to each target cell in proportion to the overlap,
// so every source pixel counts exactly as much as the area it covers. The filter is
// separable: rows are first reduced along x into a row buffer, then spread over the
// target rows they overlap. The result does not depend on how the source is tiled.

// Per source index: first target cell, its weight, and the weight of the next cell.
function axisMap(n, m) {
  const s = m / n, i0 = new Int32Array(n), w0 = new Float64Array(n), w1 = new Float64Array(n);
  for (let x = 0; x < n; x++) {
    const a = x * s, b = (x + 1) * s, k = Math.min(m - 1, Math.floor(a + 1e-12));
    i0[x] = k;
    const edge = k + 1;
    if (b <= edge + 1e-12 || k === m - 1) { w0[x] = b - a; w1[x] = 0; } else { w0[x] = edge - a; w1[x] = b - edge; }
  }
  return { i0, w0, w1 };
}

// Target size with the long side at most `maxSide`, never upscaling.
export function fitSize(w, h, maxSide) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export class AreaAccumulator {
  constructor(srcW, srcH, dstW, dstH, ch) {
    Object.assign(this, { srcW, srcH, dstW, dstH, ch });
    this.mx = axisMap(srcW, dstW); this.my = axisMap(srcH, dstH);
    this.acc = new Float64Array(dstW * dstH * ch);
    this.wsum = new Float64Array(dstW * dstH);
    this.row = new Float64Array(dstW * ch);
    this.rowW = new Float64Array(dstW);
  }
  // Adds a tile. get(i, c) returns channel c of the i-th pixel of the tile (row-major, width tw).
  addTile(x0, y0, tw, th, get) {
    const { ch, dstW, mx, my, acc, wsum, row, rowW } = this;
    for (let ty = 0; ty < th; ty++) {
      const cMin = mx.i0[x0], cMax = Math.min(dstW - 1, mx.i0[x0 + tw - 1] + 1);
      row.fill(0, cMin * ch, (cMax + 1) * ch); rowW.fill(0, cMin, cMax + 1);
      for (let tx = 0; tx < tw; tx++) {
        const x = x0 + tx, k = mx.i0[x], a = mx.w0[x], b = mx.w1[x], p = ty * tw + tx;
        for (let c = 0; c < ch; c++) {
          const v = get(p, c);
          row[k * ch + c] += a * v;
          if (b) row[(k + 1) * ch + c] += b * v;
        }
        rowW[k] += a; if (b) rowW[k + 1] += b;
      }
      const y = y0 + ty, j = my.i0[y], wa = my.w0[y], wb = my.w1[y];
      for (let i = cMin; i <= cMax; i++) {
        const rw = rowW[i]; if (!rw) continue;
        const oa = j * dstW + i;
        wsum[oa] += wa * rw;
        for (let c = 0; c < ch; c++) acc[oa * ch + c] += wa * row[i * ch + c];
        if (wb) {
          const ob = oa + dstW;
          wsum[ob] += wb * rw;
          for (let c = 0; c < ch; c++) acc[ob * ch + c] += wb * row[i * ch + c];
        }
      }
    }
  }
  // Interleaved Float32 result, normalized by the covered area.
  result() {
    const { acc, wsum, ch } = this, out = new Float32Array(acc.length);
    for (let p = 0; p < wsum.length; p++) { const w = wsum[p] || 1; for (let c = 0; c < ch; c++) out[p * ch + c] = acc[p * ch + c] / w; }
    return out;
  }
}

// Area-average of an interleaved Float32 image (used for crop → analysis size).
export function resampleFloat(data, w, h, ch, dw, dh) {
  if (dw === w && dh === h) return Float32Array.from(data);
  const acc = new AreaAccumulator(w, h, dw, dh, ch);
  acc.addTile(0, 0, w, h, (i, c) => data[i * ch + c]);
  return acc.result();
}

// Crop of an interleaved image, by fractions of each side.
export function cropFloat(data, w, h, ch, crop) {
  const x0 = Math.round(w * crop.l), x1 = Math.max(x0 + 1, Math.round(w * (1 - crop.r)));
  const y0 = Math.round(h * crop.t), y1 = Math.max(y0 + 1, Math.round(h * (1 - crop.b)));
  const cw = x1 - x0, chh = y1 - y0, out = new Float32Array(cw * chh * ch);
  for (let y = 0; y < chh; y++) out.set(data.subarray(((y + y0) * w + x0) * ch, ((y + y0) * w + x1) * ch), y * cw * ch);
  return { data: out, w: cw, h: chh };
}
