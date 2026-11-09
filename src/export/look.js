// The finish of the video: colour grade, vignette, film grain, fonts, platform presets, safe
// areas and saved looks.
import { clamp, mulberry32 } from "../core/util.js";

// ---- colour grade: applied once to the image (pixels), not per frame
export const GRADES = { none: "None", warm: "Warm", cool: "Cool", contrast: "Contrast", vivid: "Vivid", matte: "Matte", mono: "Black and white", teal: "Teal and orange" };
const smooth = x => x * x * (3 - 2 * x);
// one pixel (r, g, b in 0-1) through a grade at amount a
export function gradePixel(r, g, b, grade, a) {
  let R = r, G = g, B = b;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  switch (grade) {
    case "warm": R = r * (1 + 0.12 * a) + 0.02 * a; G = g * (1 + 0.03 * a); B = b * (1 - 0.14 * a); break;
    case "cool": R = r * (1 - 0.1 * a); G = g * (1 + 0.01 * a); B = b * (1 + 0.14 * a) + 0.02 * a; break;
    case "contrast": R = r + (smooth(clamp(r)) - r) * a; G = g + (smooth(clamp(g)) - g) * a; B = b + (smooth(clamp(b)) - b) * a; break;
    case "vivid": { const s = 1 + 0.6 * a; R = lum + (r - lum) * s; G = lum + (g - lum) * s; B = lum + (b - lum) * s; break; }
    case "matte": { const s = 1 - 0.25 * a; R = 0.07 * a + (lum + (r - lum) * s) * (1 - 0.14 * a); G = 0.07 * a + (lum + (g - lum) * s) * (1 - 0.14 * a); B = 0.09 * a + (lum + (b - lum) * s) * (1 - 0.14 * a); break; }
    case "mono": R = r + (lum - r) * a; G = g + (lum - g) * a; B = b + (lum - b) * a; break;
    case "teal": {
      // shadows toward teal, highlights toward orange
      const h = smooth(clamp(lum * 1.4 - 0.2));
      R = r + a * (0.1 * h - 0.06 * (1 - h)); G = g + a * (0.03 * h + 0.02 * (1 - h)); B = b + a * (-0.1 * h + 0.07 * (1 - h)); break;
    }
    default: break;
  }
  return [clamp(R), clamp(G), clamp(B)];
}
// A graded copy of a canvas (the same canvas when there is nothing to do).
export function gradeCanvas(src, grade, amount) {
  if (!grade || grade === "none" || amount <= 0) return src;
  const c = document.createElement("canvas"); c.width = src.width; c.height = src.height;
  const g = c.getContext("2d"); g.drawImage(src, 0, 0);
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  // straight per pixel (exact, no banding in skies); done once per image and grade
  for (let p = 0; p < d.length; p += 4) {
    const o = gradePixel(d[p] / 255, d[p + 1] / 255, d[p + 2] / 255, grade, amount);
    d[p] = o[0] * 255; d[p + 1] = o[1] * 255; d[p + 2] = o[2] * 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}

// ---- image edit (the video's picture only; the music always reads the original image)
// White balance, exposure, levels, contrast, highlights and shadows, saturation and vibrance, then
// curves (luminance, red, green, blue: five points each, at 0, ¼, ½, ¾ and 1). Applied once per
// image and settings, before the colour grade.
export const CURVE_X = [0, 0.25, 0.5, 0.75, 1];
const ID_CURVE = () => [0, 0.25, 0.5, 0.75, 1];
export function defaultEdit() {
  return { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0, saturation: 0, vibrance: 0, black: 0, white: 1, gamma: 1, curves: { l: ID_CURVE(), r: ID_CURVE(), g: ID_CURVE(), b: ID_CURVE() } };
}
const isId = c => !c || c.every((y, i) => Math.abs(y - CURVE_X[i]) < 1e-6);
export function editIsIdentity(e) {
  if (!e) return true;
  const D = defaultEdit();
  for (const k of Object.keys(D)) if (k !== "curves" && Math.abs((e[k] ?? D[k]) - D[k]) > 1e-6) return false;
  return !e.curves || ["l", "r", "g", "b"].every(k => isId(e.curves[k]));
}
// A smooth curve through the five points that never overshoots (monotone cubic, Fritsch-Carlson),
// as a 256-entry table.
export function curveLUT(ys) {
  const xs = CURVE_X, n = xs.length, y = (ys || ID_CURVE()).map(v => clamp(v)), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const lut = new Float32Array(256);
  for (let k = 0; k < 256; k++) {
    const x = k / 255; let i = Math.min(n - 2, Math.floor(x / 0.25)); const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh;
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
    lut[k] = clamp(h00 * y[i] + h10 * hh * m[i] + h01 * y[i + 1] + h11 * hh * m[i + 1]);
  }
  return lut;
}
const lutAt = (lut, v) => { const x = clamp(v) * 255, i = Math.min(254, Math.floor(x)), f = x - i; return lut[i] + (lut[i + 1] - lut[i]) * f; };
// one pixel (0-1) through the edit; L: the curve tables
export function editPixel(r, g, b, e, L) {
  // white balance: warmer (more red, less blue) or cooler; tint toward magenta or green
  const t = e.temp || 0, ti = e.tint || 0;
  r *= 1 + 0.22 * t + 0.06 * ti; g *= 1 - 0.14 * ti; b *= 1 - 0.22 * t + 0.06 * ti;
  // exposure in stops
  const ex = Math.pow(2, e.exposure || 0); r *= ex; g *= ex; b *= ex;
  // levels: black and white points, then the midtones (gamma)
  const lo = e.black ?? 0, hi = Math.max(lo + 0.02, e.white ?? 1), gm = 1 / Math.max(0.1, e.gamma ?? 1);
  const lv = v => Math.pow(clamp((v - lo) / (hi - lo)), gm);
  r = lv(r); g = lv(g); b = lv(b);
  // contrast round the middle grey
  const c = e.contrast || 0; if (c) { const k = 1 + c; r = 0.5 + (r - 0.5) * k; g = 0.5 + (g - 0.5) * k; b = 0.5 + (b - 0.5) * k; }
  // highlights and shadows: lift or pull the bright and the dark tones
  let lum = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const sh = (e.shadows || 0) * 0.35 * (1 - lum) ** 2, hl = (e.highlights || 0) * 0.35 * lum ** 2;
  if (sh || hl) { r += sh + hl; g += sh + hl; b += sh + hl; lum = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b); }
  // saturation, and vibrance (more on the dull colours)
  const sat0 = Math.max(r, g, b) - Math.min(r, g, b), k = 1 + (e.saturation || 0) + (e.vibrance || 0) * (1 - clamp(sat0));
  if (k !== 1) { r = lum + (r - lum) * k; g = lum + (g - lum) * k; b = lum + (b - lum) * k; }
  // curves: luminance first (by the difference, so the colour stays), then each channel
  if (L.l) { const l0 = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b), dl = lutAt(L.l, l0) - l0; r += dl; g += dl; b += dl; }
  if (L.r) r = lutAt(L.r, r); if (L.g) g = lutAt(L.g, g); if (L.b) b = lutAt(L.b, b);
  return [clamp(r), clamp(g), clamp(b)];
}
// An edited and graded copy of a canvas (the same canvas when there is nothing to do).
export function editCanvas(src, e, grade = "none", amount = 0) {
  const doEdit = !editIsIdentity(e), doGrade = grade && grade !== "none" && amount > 0;
  if (!doEdit && !doGrade) return src;
  const c = document.createElement("canvas"); c.width = src.width; c.height = src.height;
  const g = c.getContext("2d"); g.drawImage(src, 0, 0);
  const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
  const cv = (e && e.curves) || {}, L = {};
  for (const k of ["l", "r", "g", "b"]) if (!isId(cv[k])) L[k] = curveLUT(cv[k]);
  for (let p = 0; p < d.length; p += 4) {
    let o = [d[p] / 255, d[p + 1] / 255, d[p + 2] / 255];
    if (doEdit) o = editPixel(o[0], o[1], o[2], e, L);
    if (doGrade) o = gradePixel(o[0], o[1], o[2], grade, amount);
    d[p] = o[0] * 255; d[p + 1] = o[1] * 255; d[p + 2] = o[2] * 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}

// ---- vignette and grain, drawn over each frame
export function drawVignette(g, W, H, amount, color = "#000000") {
  if (amount <= 0) return;
  const r = Math.hypot(W, H) / 2, gr = g.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r * 1.02);
  const h = String(color || "#000000").replace("#", ""), n = parseInt(h, 16) || 0, rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  gr.addColorStop(0, `rgba(${rgb},0)`); gr.addColorStop(1, `rgba(${rgb},${0.8 * amount})`);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
}
let GRAIN = null;
// four 256 px tiles of seeded noise, cycled frame by frame (deterministic)
function grainTiles() {
  if (GRAIN) return GRAIN;
  GRAIN = [0, 1, 2, 3].map(s => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d"), im = g.createImageData(256, 256), rnd = mulberry32(101 + s);
    for (let p = 0; p < im.data.length; p += 4) { const v = Math.round(128 + (rnd() + rnd() - 1) * 110); im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 255; }
    g.putImageData(im, 0, 0); return c;
  });
  return GRAIN;
}
export function drawGrain(g, W, H, amount, frame, u) {
  if (amount <= 0) return;
  const tile = grainTiles()[frame & 3], pat = g.createPattern(tile, "repeat");
  g.save(); g.globalCompositeOperation = "overlay"; g.globalAlpha = 0.32 * amount;
  const k = Math.max(1, Math.round(u * 1.5)); g.scale(k, k);
  g.fillStyle = pat; g.fillRect(0, 0, W / k + 1, H / k + 1); g.restore();
}

// ---- fonts (Google Fonts, loaded when chosen)
export const FONTS = {
  geist: { name: "Geist", family: "Geist", css: '"Geist", system-ui, sans-serif', weight: 650 },
  grotesk: { name: "Space Grotesk", family: "Space Grotesk", gf: "Space+Grotesk:wght@500;700", css: '"Space Grotesk", system-ui, sans-serif', weight: 700 },
  serif: { name: "Instrument Serif", family: "Instrument Serif", gf: "Instrument+Serif", css: '"Instrument Serif", Georgia, serif', weight: 400 },
  playfair: { name: "Playfair Display", family: "Playfair Display", gf: "Playfair+Display:wght@600", css: '"Playfair Display", Georgia, serif', weight: 600 },
  bebas: { name: "Bebas Neue", family: "Bebas Neue", gf: "Bebas+Neue", css: '"Bebas Neue", Impact, sans-serif', weight: 400, caps: true },
  mono: { name: "Geist Mono", family: "Geist Mono", css: '"Geist Mono", ui-monospace, monospace', weight: 500 }
};
const loaded = new Set(["geist", "mono"]);
export function ensureFont(key) {
  const F = FONTS[key] || FONTS.geist;
  if (loaded.has(key) || !F.gf || typeof document === "undefined") return Promise.resolve();
  if (!document.querySelector(`link[data-font="${key}"]`)) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.font = key;
    l.href = `https://fonts.googleapis.com/css2?family=${F.gf}&display=swap`; document.head.appendChild(l);
  }
  return document.fonts.load(`${F.weight} 40px "${F.family}"`).then(() => { loaded.add(key); }).catch(() => {});
}

// ---- platforms: shape, resolution, frame rate and quality in one choice
export const PLATFORMS = {
  custom: { name: "Custom" },
  reel: { name: "Instagram Reel", shape: "vertical", size: 1080, fps: 30, quality: "high" },
  tiktok: { name: "TikTok", shape: "vertical", size: 1080, fps: 30, quality: "high" },
  shorts: { name: "YouTube Shorts", shape: "vertical", size: 1080, fps: 60, quality: "high" },
  youtube: { name: "YouTube", shape: "wide", size: 1080, fps: 30, quality: "high" },
  youtube4k: { name: "YouTube 4K", shape: "wide", size: 2160, fps: 30, quality: "master" },
  post: { name: "Instagram post (4:5)", shape: "portrait", size: 1080, fps: 30, quality: "high" },
  square: { name: "Square post", shape: "square", size: 1080, fps: 30, quality: "high" }
};
export const QUALITY = { standard: { name: "Standard", bpp: 0.08 }, high: { name: "High", bpp: 0.14 }, master: { name: "Master", bpp: 0.24 } };
// Where the apps draw their own buttons and captions (fractions of the frame). Text keeps out.
export function safeArea(shape) {
  if (shape === "vertical") return { top: 0.13, bottom: 0.22, left: 0.06, right: 0.15 };
  if (shape === "portrait") return { top: 0.06, bottom: 0.1, left: 0.06, right: 0.06 };
  return { top: 0.05, bottom: 0.07, left: 0.04, right: 0.04 };
}
export function drawSafeGuides(g, W, H, shape, u) {
  const s = safeArea(shape);
  g.save(); g.setLineDash([8 * u, 6 * u]); g.lineWidth = 2 * u; g.strokeStyle = "rgba(120,220,255,0.85)";
  g.strokeRect(s.left * W, s.top * H, W * (1 - s.left - s.right), H * (1 - s.top - s.bottom));
  g.fillStyle = "rgba(120,220,255,0.12)";
  g.fillRect(0, 0, W, s.top * H); g.fillRect(0, H * (1 - s.bottom), W, s.bottom * H);
  g.fillRect(W * (1 - s.right), s.top * H, s.right * W, H * (1 - s.top - s.bottom));
  g.setLineDash([]); g.fillStyle = "rgba(120,220,255,0.95)"; g.font = `600 ${18 * u}px system-ui, sans-serif`;
  g.fillText("Safe area (preview only)", s.left * W + 8 * u, s.top * H + 24 * u);
  g.restore();
}

// ---- looks: every setting of how the video looks (not its size, text or labels)
export const LOOK_KEYS = ["camera", "zoom", "camEase", "camMove", "camSmooth", "drift", "fit", "theme", "pathColor", "pointColor", "path", "lineShape", "line", "lineWidth", "pathDone", "pathAhead",
  "points", "placeDone", "placeAhead", "numbers", "passages", "eye", "fx", "strength", "react", "dim", "grade", "gradeAmt", "vignette", "grain", "font", "titlePos", "titleWhen", "titleSecs", "subtitle", "textSize", "bottom", "pathFill", "pathColor2", "glow", "dashLen", "dashGap", "curve", "placeStyle", "placeSize", "numberStyle", "climaxOwn", "climaxColor", "spotColor", "vigColor", "tintColor", "tintAmt", "textStyle", "boxColor", "caps", "letterSpace", "titleAnim", "bottomFill", "bottomColor", "bottomColor2", "titleColor", "subColor", "eyeColor", "labelColor", "labelBg", "fadeIn", "fadeOut", "endCard", "edit", "barOrient", "barXY", "barDir", "barSize", "barLength", "barOpacity", "coverClean"];
export const LOOKS = {
  minimal: { name: "Minimal", camera: "still", drift: 0.06, theme: "white", pathColor: "#FFFFFF", pointColor: "#FFFFFF", path: "draw", lineShape: "curved", line: "solid", lineWidth: 2, points: "visited", placeDone: 0.5, numbers: false, passages: false, eye: "dot",
    fx: { pulse: true, ripple: false, spotlight: false, glow: false, flash: false }, strength: 0.4, react: 0.2, dim: 0.05, grade: "matte", gradeAmt: 0.5, vignette: 0.2, grain: 0, font: "grotesk", titlePos: "bl", titleWhen: "always", bottom: "line" },
  neon: { name: "Neon night", camera: "follow", zoom: 0.4, camEase: "smooth", camSmooth: 0.5, theme: "neon", pathColor: "#22E4FF", pointColor: "#FF4FD8", path: "all", pathAhead: 0.18, lineShape: "curved", line: "neon", lineWidth: 3, points: "all", placeAhead: 0.25, placeDone: 0.6, numbers: true, passages: true, eye: "comet",
    fx: { pulse: true, ripple: true, spotlight: true, glow: true, flash: true }, strength: 0.75, react: 0.7, dim: 0.25, grade: "cool", gradeAmt: 0.6, vignette: 0.45, grain: 0.15, font: "bebas", titlePos: "tc", titleWhen: "intro", bottom: "spectrum" },
  documentary: { name: "Documentary", camera: "follow", zoom: 0.25, camEase: "gentle", camSmooth: 0.7, camMove: 2.4, drift: 0.05, theme: "white", pathColor: "#FFFFFF", pointColor: "#FFE7B0", path: "trail", lineShape: "straight", line: "dashed", lineWidth: 2, points: "current", numbers: false, passages: false, eye: "dot",
    fx: { pulse: false, ripple: false, spotlight: true, glow: false, flash: false }, strength: 0.5, react: 0, dim: 0.05, grade: "contrast", gradeAmt: 0.4, vignette: 0.35, grain: 0.2, font: "serif", titlePos: "bl", titleWhen: "intro", bottom: "none" },
  cinematic: { name: "Cinematic", camera: "follow", zoom: 0.45, camEase: "cinematic", camSmooth: 0.6, camMove: 2, drift: 0.04, theme: "gold", pathColor: "#F5C26B", pointColor: "#FFE7B0", path: "draw", lineShape: "curved", line: "comet", lineWidth: 4, points: "visited", placeDone: 0.45, numbers: false, passages: true, eye: "comet",
    fx: { pulse: true, ripple: false, spotlight: true, glow: true, flash: true }, strength: 0.65, react: 0.35, dim: 0.1, grade: "teal", gradeAmt: 0.6, vignette: 0.55, grain: 0.25, font: "playfair", titlePos: "center", titleWhen: "intro", bottom: "none", fadeIn: 1.2, fadeOut: 2, endCard: true },
  sketch: { name: "Sketchbook", camera: "still", drift: 0.03, theme: "white", pathColor: "#FFF6E5", pointColor: "#FFF6E5", path: "draw", lineShape: "curved", line: "brush", lineWidth: 4, points: "visited", placeDone: 0.7, numbers: true, passages: false, eye: "off",
    fx: { pulse: false, ripple: true, spotlight: false, glow: false, flash: false }, strength: 0.5, react: 0.2, dim: 0.15, grade: "matte", gradeAmt: 0.7, vignette: 0.3, grain: 0.35, font: "serif", titlePos: "tl", titleWhen: "always", bottom: "line" },
  waveform: { name: "Audiogram", camera: "still", drift: 0, theme: "ember", pathColor: "#FF6B3D", pointColor: "#FFC24B", path: "draw", lineShape: "straight", line: "glow", lineWidth: 3, points: "visited", numbers: true, passages: true, eye: "dot",
    fx: { pulse: true, ripple: false, spotlight: false, glow: true, flash: false }, strength: 0.6, react: 0.8, dim: 0.3, grade: "none", vignette: 0.3, grain: 0, font: "geist", titlePos: "tl", titleWhen: "always", bottom: "wave" }
};
// the look part of a settings object (deep copy)
export function pickLook(v) { const o = {}; for (const k of LOOK_KEYS) if (k in v) o[k] = structuredClone(v[k]); return o; }

// ---- fades: the black over the picture at a time, and the same on the sound
export function fadeAt(sec, total, fadeIn, fadeOut) {
  let a = 0;
  if (fadeIn > 0 && sec < fadeIn) a = Math.max(a, 1 - sec / fadeIn);
  if (fadeOut > 0 && sec > total - fadeOut) a = Math.max(a, (sec - (total - fadeOut)) / fadeOut);
  return clamp(a);
}
export function fadeAudio(chs, sr, fadeIn, fadeOut) {
  const len = chs[0].length;
  return chs.map(c => {
    const o = new Float32Array(c);
    const nIn = Math.min(len, Math.round(fadeIn * sr)), nOut = Math.min(len, Math.round(fadeOut * sr));
    for (let i = 0; i < nIn; i++) o[i] *= i / nIn;
    for (let i = 0; i < nOut; i++) o[len - 1 - i] *= i / nOut;
    return o;
  });
}
