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

// ---- vignette and grain, drawn over each frame
export function drawVignette(g, W, H, amount) {
  if (amount <= 0) return;
  const r = Math.hypot(W, H) / 2, gr = g.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r * 1.02);
  gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, `rgba(0,0,0,${0.8 * amount})`);
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
  "points", "placeDone", "placeAhead", "numbers", "passages", "eye", "fx", "strength", "react", "dim", "grade", "gradeAmt", "vignette", "grain", "font", "titlePos", "titleWhen", "titleSecs", "subtitle", "textSize", "bottom", "bottomFill", "bottomColor", "bottomColor2", "titleColor", "subColor", "eyeColor", "labelColor", "labelBg", "fadeIn", "fadeOut", "endCard"];
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
