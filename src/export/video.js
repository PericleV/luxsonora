// Video export: the image with the gaze path drawn over it in time with the music.
//
// One function draws a frame for a time in seconds (drawVideoFrame); the stage uses it for the
// live preview while the Export tab is open, and the encoders for every frame of the file, so the
// preview is the video. Everything is a function of the time: the eye's position (it moves to the
// next point while the connection to it plays), the camera (a smoothed track computed once), the
// effects when the eye arrives at a place, the sound (beats, loudness, spectrum), the text, the
// fades and the end card.
// Encoding: WebCodecs (H.264, else VP9 or AV1; AAC, else Opus) in MP4 (mp4-muxer) or WebM
// (VP9/VP8 and Opus, webm-muxer); GIF with gifenc; a PNG poster from one frame.
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { clamp } from "../core/util.js";
import { pickAudioCodec, encodeAudioData, resampleChannels, tick } from "./audio.js";
import { pathGeometry, drawPath } from "./paths.js";
import { FONTS, QUALITY, safeArea, drawSafeGuides, drawVignette, drawGrain, fadeAt } from "./look.js";
import { analyzeNotes, valueAt, bandsAt, BANDS } from "./reactive.js";
import { labelFor } from "./labels.js";

export const SHAPES = { image: "Like the image", wide: "16:9", square: "1:1", portrait: "4:5", vertical: "9:16" };
export const VIDEO_THEMES = {
  gold: { name: "Gold", path: "#F5C26B", point: "#FFE7B0" },
  neon: { name: "Neon", path: "#22E4FF", point: "#FF4FD8" },
  ember: { name: "Ember", path: "#FF6B3D", point: "#FFC24B" },
  mint: { name: "Mint", path: "#5EF2B8", point: "#D9FFF0" },
  rose: { name: "Rose", path: "#FF8FB1", point: "#FFE3EC" },
  white: { name: "White", path: "#FFFFFF", point: "#FFFFFF" }
};
export const PATH_MODES = { draw: "As it plays", all: "From the start", trail: "Last jump", off: "Off" };
export const POINT_MODES = { visited: "As it plays", all: "From the start", current: "Current only", off: "Off" };
// Camera motion curves, x ∈ [0, 1] → [0, 1]
export const EASES = {
  linear: { name: "Linear", f: x => x },
  gentle: { name: "Gentle", f: x => 0.5 - 0.5 * Math.cos(Math.PI * x) },
  smooth: { name: "Smooth", f: x => x * x * x * (x * (6 * x - 15) + 10) },
  cinematic: { name: "Cinematic", f: x => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2) }
};
export const EFFECTS = { pulse: "Pulse", ripple: "Ripple", spotlight: "Spotlight", glow: "Glow", flash: "Flash on accents" };
export const EYES = { dot: "Dot", comet: "Comet", ring: "Ring", off: "Off" };
export const CAPTIONS = { title: "Title", points: "Title and chords", none: "None" };
export const TITLE_POS = { tl: "Top left", tc: "Top centre", bl: "Bottom left", center: "Centre" };
export const TITLE_WHEN = { always: "Always", intro: "First seconds" };
export const SUBTITLES = { info: "Style, key and tempo", custom: "My own", none: "None" };
export const BOTTOMS = { bars: "Sound bars", spectrum: "Spectrum", wave: "Waveform", line: "Progress line", none: "None" };
export const GIF_RANGES = { climax: "8 s around the climax", start: "First 10 s", whole: "Whole piece" };

export function defaultVideo() {
  return {
    platform: "custom", shape: "image", size: "original", fps: 30, quality: "high", safe: true,
    fit: "fill", camera: "follow", zoom: 0.35, camEase: "smooth", camMove: 1.6, camSmooth: 0.45, drift: 0,
    theme: "gold", pathColor: VIDEO_THEMES.gold.path, pointColor: VIDEO_THEMES.gold.point,
    path: "draw", lineShape: "straight", line: "glow", lineWidth: 3, pathDone: 1, pathAhead: 0.25,
    points: "visited", placeDone: 0.7, placeAhead: 0.35, numbers: true, passages: true, eye: "dot",
    labels: "off", labelText: {}, labelKeep: false,
    fx: { pulse: true, ripple: false, spotlight: true, glow: true, flash: true }, strength: 0.6, react: 0.4, dim: 0.1,
    grade: "none", gradeAmt: 0.6, vignette: 0.25, grain: 0,
    caption: "title", title: "", subtitle: "info", subText: "", titleColor: "#FFFFFF", subColor: "#FFFFFF", eyeColor: "#FFFFFF", labelColor: "#FFFFFF", labelBg: "#080A0E", font: "geist", titlePos: "tl", titleWhen: "always", titleSecs: 4.5, textSize: 1,
    bottom: "bars", bottomFill: "solid", bottomColor: VIDEO_THEMES.gold.point, bottomColor2: VIDEO_THEMES.gold.path, fadeIn: 0.6, fadeOut: 1.5, fadeSound: true, endCard: false, credit: "Made with Lux Sonora",
    gifWidth: 480, gifFps: 12, gifRange: "climax"
  };
}

const even = v => Math.max(2, Math.round(v / 2) * 2);
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
export function hexA(hex, a) {
  const h = String(hex || "#ffffff").replace("#", ""), n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a)})`;
}
// a colour between two hex colours (t = 0: a, 1: b), as hex
export function mixHex(a, b, t) {
  const p = h => { const x = String(h || "#ffffff").replace("#", ""), n = parseInt(x.length === 3 ? x.replace(/./g, c => c + c) : x, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const A = p(a), B = p(b), k = clamp(t);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, "0")).join("");
}
export const BOTTOM_FILLS = { solid: "One colour", gradient: "Gradient", reactive: "Follows the sound" };
const eyeStyle = o => (o.eye === true ? "dot" : o.eye === false ? "off" : o.eye || "dot");

// Frame size in pixels (even numbers): the short side is `size`; "image" keeps the image's
// shape (at most 2.4:1 either way). size "original": the image's own pixels (the long side at
// most 3840, the short side at least 240); other shapes then take the image's short side.
export const MAX_SIDE = 3840;
export function frameSize(shape, size, iw, ih) {
  if (size === "original") {
    if (shape === "image" || !shape) {
      // at most 3840 px long and 8.8 MP (what H.264 level 5.1 can encode)
      const a = clamp(iw / ih, 1 / 2.4, 2.4), k = Math.min(1, MAX_SIDE / Math.max(iw, ih), Math.sqrt(8.8e6 / (iw * ih)));
      let W = iw * k, H = ih * k; if (a !== iw / ih) { if (a >= 1) H = W / a; else W = H * a; }
      const up = Math.max(1, 240 / Math.min(W, H));
      return { W: even(W * up), H: even(H * up) };
    }
    size = clamp(Math.min(iw, ih), 240, 2160);
  }
  if (shape === "square") return { W: even(size), H: even(size) };
  if (shape === "vertical") return { W: even(size), H: even((size * 16) / 9) };
  if (shape === "portrait") return { W: even(size), H: even((size * 5) / 4) };
  if (shape === "wide") return { W: even((size * 16) / 9), H: even(size) };
  const a = clamp(iw / ih, 1 / 2.4, 2.4);
  return a >= 1 ? { W: even(size * a), H: even(size) } : { W: even(size), H: even(size / a) };
}

// Times of the focus points in seconds and when the eye leaves each one: with the first
// connection note to the next point (the passage), else in the last quarter (at most half a beat).
export function videoTimeline(sc) {
  const spb = 60 / sc.bpm, pts = sc.points, lead = sc.notes.filter(n => n.passage && n.layer === "lead");
  return pts.map((F, i) => {
    const t0 = F.t0 * spb, t1 = F.t1 * spb, nx = pts[i + 1];
    let move = null;
    if (nx) {
      const ps = lead.filter(n => n.passage.from === i), first = ps.length ? Math.min(...ps.map(n => n.t)) * spb : null;
      move = first ?? t1 - Math.min(0.5 * spb, 0.25 * (t1 - t0));
      move = clamp(move, t0 + 0.3 * (t1 - t0), t1 - 0.04);
    }
    return { i, x: F.x, y: F.y, r: F.r, t0, t1, move, section: F.section, accent: !!F.accent };
  });
}
function indexAt(tl, sec) {
  if (!tl.length) return -1;
  if (sec < tl[0].t0) return 0;
  for (let i = 0; i < tl.length; i++) if (sec < tl[i].t1) return i;
  return tl.length - 1;
}
// The eye: which point it is on, how far it has moved toward the next one (u), its position,
// the time since it arrived (age) and how much of the path is drawn (i + u).
export function gazeAt(tl, sec) {
  const i = indexAt(tl, sec); if (i < 0) return null;
  const p = tl[i], q = tl[i + 1];
  const u = q && p.move !== null && sec > p.move ? ease((sec - p.move) / (p.t1 - p.move)) : 0;
  return { i, u, x: q ? lerp(p.x, q.x, u) : p.x, y: q ? lerp(p.y, q.y, u) : p.y, age: sec - p.t0, drawn: i + u };
}
// Where the camera aims: it glides from point to point over a window centred on each boundary,
// `move` seconds long (at most 0.45 of each neighbouring point on its side), with an easing curve.
export function cameraAt(tl, sec, move = 2.2, curve = "smooth") {
  const i = indexAt(tl, sec); if (i < 0) return { x: 0.5, y: 0.5 };
  const f = (EASES[curve] || EASES.smooth).f;
  const p = tl[i], half = j => Math.max(1e-3, Math.min(move / 2, 0.45 * Math.min(tl[j].t1 - tl[j].t0, tl[j + 1].t1 - tl[j + 1].t0)));
  let x = p.x, y = p.y;
  const nx = tl[i + 1], pv = tl[i - 1];
  // one move over [boundary − w, boundary + w]: its first half while on the point before
  if (nx) { const w = half(i); if (sec > p.t1 - w) { const u = f(clamp((sec - (p.t1 - w)) / (2 * w))); x = lerp(p.x, nx.x, u); y = lerp(p.y, nx.y, u); } }
  if (pv) { const w = half(i - 1); if (sec < p.t0 + w) { const u = f(clamp((sec - (p.t0 - w)) / (2 * w))); x = lerp(pv.x, p.x, u); y = lerp(pv.y, p.y, u); } }
  return { x, y };
}
// Keeps a view inside the image where it fits (centred where it does not).
function clampView(x, y, w, a, iw, ih) {
  const h = w / a;
  return { x: w <= iw ? clamp(x, 0, iw - w) : (iw - w) / 2, y: h <= ih ? clamp(y, 0, ih - h) : (ih - h) / 2, w, h };
}
/*
 * The camera over the whole piece, sampled 60 times a second: the aimed view (centre from
 * cameraAt, zoom from zoomEnv and the slow push-in), kept inside the image, then smoothed by a
 * critically damped spring with time constant τ = 1.2·smooth s. The aim is read τ ahead, so
 * the smoothed camera still arrives on time. Deterministic; frames read it by interpolation.
 * o: { camera, fit, zoom, camEase, camMove, camSmooth, drift }.
 */
export function cameraTrack(tl, total, o, iw, ih, W, H, hz = 60) {
  const a = W / H, n = Math.max(2, Math.ceil(total * hz) + 2), follow = o.camera === "follow" && tl.length > 0;
  const tau = 1.2 * clamp(o.camSmooth ?? 0), drift = o.drift || 0;
  const base = (o.fit === "fit" ? Math.max(iw, ih * a) : Math.min(iw, ih * a));
  const aim = t => {
    t = clamp(t, 0, total);
    const c = follow ? cameraAt(tl, t, o.camMove ?? 1.6, o.camEase) : { x: 0.5, y: 0.5 };
    const z = (follow ? 1 + (o.zoom || 0) * zoomEnv(tl, t, total) : 1) * (1 + drift * (t / Math.max(1e-6, total)));
    const w = base / z;
    return clampView(c.x * iw - w / 2, c.y * ih - w / a / 2, w, a, iw, ih);
  };
  const xs = new Float64Array(n), ys = new Float64Array(n), ws = new Float64Array(n);
  let p = aim(tau), vx = 0, vy = 0, vw = 0;
  const om = tau > 0.02 ? 2 / tau : 0, sub = 4, dt = 1 / hz / sub;
  for (let k = 0; k < n; k++) {
    const t = k / hz;
    if (!om) p = aim(t);
    else for (let s = 0; s < sub; s++) {
      const T = aim(t + tau + s * dt);
      vx += (om * om * (T.x - p.x) - 2 * om * vx) * dt; vy += (om * om * (T.y - p.y) - 2 * om * vy) * dt; vw += (om * om * (T.w - p.w) - 2 * om * vw) * dt;
      p = { x: p.x + vx * dt, y: p.y + vy * dt, w: p.w + vw * dt };
    }
    const c = clampView(p.x, p.y, p.w, a, iw, ih);
    xs[k] = c.x; ys[k] = c.y; ws[k] = c.w;
  }
  return {
    hz, at(sec) {
      const f = clamp(sec * hz, 0, n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
      const w = lerp(ws[i], ws[i + 1], u);
      return { x: lerp(xs[i], xs[i + 1], u), y: lerp(ys[i], ys[i + 1], u), w, h: w / a };
    }
  };
}
// How far the camera is zoomed in (0-1): in over the first 1.5 s, out over the cadence.
export function zoomEnv(tl, sec, total) {
  if (!tl.length) return 0;
  const end = tl[tl.length - 1].t1, outLen = Math.max(0.5, total - end);
  return ease(sec / 1.5) * (1 - ease((sec - end) / outLen));
}
// The part of the image (pixels) shown in a W × H frame: the largest rect of the frame's shape
// inside the image (fill) or the smallest one around it (fit), zoomed by z, centred on (cx, cy)
// and kept inside the image where it fits.
export function viewRect(iw, ih, W, H, fit, cx, cy, z = 1) {
  const a = W / H;
  const vw = (fit === "fit" ? Math.max(iw, ih * a) : Math.min(iw, ih * a)) / z, vh = vw / a;
  const px = cx * iw, py = cy * ih;
  return { x: vw <= iw ? clamp(px - vw / 2, 0, iw - vw) : (iw - vw) / 2, y: vh <= ih ? clamp(py - vh / 2, 0, ih - vh) : (ih - vh) / 2, w: vw, h: vh };
}
// A loudness-like envelope from the notes (n bins over the piece), for the sound bars.
export function soundEnvelope(sc, n = 160) {
  const env = new Float32Array(n), total = sc.total || 1, W = { perc: 0.5, pad: 0.35, lead: 1, harm: 0.6, bass: 0.8 };
  for (const nt of sc.notes) {
    const w = (W[nt.layer] ?? 0.45) * (nt.vel / 127) ** 2, b0 = Math.floor((nt.t / total) * n);
    const b1 = nt.layer === "perc" ? b0 : Math.min(n - 1, Math.floor(((nt.t + nt.dur) / total) * n));
    for (let b = Math.max(0, b0); b <= b1 && b < n; b++) env[b] += w * (nt.layer === "perc" ? 1 : 1 / (1 + 0.15 * (b - b0)));
  }
  let mx = 0; for (const v of env) mx = Math.max(mx, v);
  for (let b = 0; b < n; b++) env[b] = mx > 0 ? Math.sqrt(env[b] / mx) : 0;
  return env;
}
// Everything the frames need that does not change with time. src: the (graded) image.
// extra: { an (sound analysis; the notes' until the audio's is ready), auto (automatic labels) }.
export function videoScene(sc, src, opts, caption = {}, extra = {}) {
  const small = document.createElement("canvas"), k = 48 / Math.max(src.width, src.height);
  small.width = Math.max(4, Math.round(src.width * k)); small.height = Math.max(4, Math.round(src.height * k));
  small.getContext("2d").drawImage(src, 0, 0, small.width, small.height);
  const spb = 60 / sc.bpm, tl = videoTimeline(sc), env = soundEnvelope(sc);
  const geos = {};
  return {
    sc, src, blur: small, o: opts, tl, env, total: sc.total * spb, spb, caption, auto: extra.auto || [],
    an: extra.an || analyzeNotes(sc, env), passages: sc.notes.filter(n => n.passage && n.layer === "lead"),
    geo(shape) { return geos[shape] || (geos[shape] = pathGeometry(tl, shape === "curved")); }
  };
}

const FONT_UI = '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif';
function ring(g, x, y, r, col, a, w) { if (a <= 0 || r <= 0) return; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.strokeStyle = hexA(col, a); g.lineWidth = w; g.stroke(); }
function pill(g, x, y, w, h) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, h / 2); else g.rect(x, y, w, h); }

/*
 * Draws the frame at `sec` seconds into context g (W × H, in the context's units).
 * opt: { preview (draws the safe-area guides), frame (index, for the grain) }.
 */
export function drawVideoFrame(g, W, H, sec, S, opt = {}) {
  const { tl, o } = S, src = S.src, iw = src.width, ih = src.height, u = Math.min(W, H) / 1080;
  const gz = gazeAt(tl, sec);
  // the camera track is computed once per frame size and camera settings
  const camKey = [W, H, iw, ih, o.camera, o.fit, o.zoom, o.camEase, o.camMove, o.camSmooth, o.drift].join("|");
  if (!S.cam || S.cam.key !== camKey) S.cam = { key: camKey, track: cameraTrack(tl, S.total, o, iw, ih, W, H) };
  const v = S.cam.track.at(sec);
  const k = W / v.w, X = fx => (fx * iw - v.x) * k, Y = fy => (fy * ih - v.y) * k, diag = Math.hypot(iw, ih) * k;
  g.save();
  g.fillStyle = "#07090d"; g.fillRect(0, 0, W, H);
  // past the image (fit, or a frame of another shape): the image blurred and darkened behind it
  if (v.x < -0.5 || v.y < -0.5 || v.x + v.w > iw + 0.5 || v.y + v.h > ih + 0.5) {
    const c = Math.max(W / iw, H / ih); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(S.blur, (W - iw * c) / 2, (H - ih * c) / 2, iw * c, ih * c);
    g.fillStyle = "rgba(4,6,10,0.45)"; g.fillRect(0, 0, W, H);
  }
  const sx = Math.max(0, v.x), sy = Math.max(0, v.y), ex = Math.min(iw, v.x + v.w), ey = Math.min(ih, v.y + v.h);
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  if (ex > sx && ey > sy) g.drawImage(src, sx, sy, ex - sx, ey - sy, (sx - v.x) * k, (sy - v.y) * k, (ex - sx) * k, (ey - sy) * k);
  if (o.dim > 0) { g.fillStyle = `rgba(0,0,0,${o.dim})`; g.fillRect(0, 0, W, H); }
  const n = tl.length, C = S.caption || {}, Fnt = FONTS[o.font] || FONTS.geist, ts = o.textSize || 1;
  const sa = safeArea(o.shape), pad = 44 * u, L = Math.max(pad, sa.left * W), T = Math.max(pad, sa.top * H), Rm = Math.max(pad, sa.right * W), B = Math.max(pad * 0.8, sa.bottom * H);
  S._pointText = null;
  // the end card takes the last 3.2 s
  const endA = o.endCard ? ease((sec - (S.total - 3.2)) / 0.8) : 0;
  if (gz) {
    const last = tl[n - 1], fadeEnd = 1 - ease((sec - last.t1) / Math.max(0.5, S.total - last.t1));
    const R = p => Math.max(8 * u, p.r * diag), str = o.strength, beat = clamp(valueAt(S.an, S.an.beat, sec) * (o.react || 0));
    const boostOf = p => (p.section === "climax" ? 1.6 : 1);
    const geo = S.geo(o.lineShape || "straight"), eye = geo.at(gz.i + gz.u), exX = X(eye.x), exY = Y(eye.y);
    // spotlight: the rest of the frame darkens around the eye
    if (o.fx.spotlight && str > 0) {
      const rc = R(tl[gz.i]), gr = g.createRadialGradient(exX, exY, rc * 0.9, exX, exY, rc * 2.6 + 0.22 * Math.min(W, H));
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, `rgba(0,0,0,${0.6 * str * fadeEnd})`);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    // the path: the travelled part at its opacity; with "From the start" the part still ahead too
    const drawn = gz.drawn, dOp = o.pathDone ?? 1, aOp = o.path === "all" ? o.pathAhead ?? 0.25 : 0;
    if (o.path !== "off" && n > 1) {
      const parts = [];
      if (o.path === "trail") { const j = Math.floor(drawn); if (j > 0) parts.push({ f0: j - 1, f1: j, a: dOp * (1 - ease(gz.age / 1.6)), done: true }); parts.push({ f0: j, f1: drawn, a: dOp, done: true }); }
      else { parts.push({ f0: 0, f1: drawn, a: dOp, done: true }); if (aOp > 0) parts.push({ f0: drawn, f1: n - 1, a: aOp, done: false }); }
      drawPath(g, geo, X, Y, { ...o, lineWidth: o.lineWidth * (1 + 0.35 * beat) }, u, sec, parts, hexA);
    }
    // connection notes: dots along the path (with the opacity of their part), lit while they play
    if (o.passages && o.path !== "off") {
      for (const nt of S.passages) {
        const pos = nt.passage.from + nt.passage.f, done = pos <= drawn + 1e-6;
        if (o.path === "trail" && (!done || nt.passage.from < Math.floor(drawn) - 1)) continue;
        const op = done ? dOp : aOp; if (op <= 0) continue;
        const t0 = nt.t * S.spb, on = sec >= t0 && sec < t0 + nt.dur * S.spb, p = geo.at(pos);
        g.globalAlpha = on ? 1 : op;
        g.beginPath(); g.arc(X(p.x), Y(p.y), (on ? 6 : 3.2) * u, 0, Math.PI * 2);
        g.fillStyle = on ? "#ffffff" : hexA(o.pathColor, 0.95); g.fill();
      }
      g.globalAlpha = 1;
    }
    // the places: revisits share one marker with all their numbers. Opacity: 1 while the eye is
    // there, "visited" after it leaves, "still ahead" before it arrives (From the start); the
    // changes take 0.35 s on arrival and 0.5 s on leaving.
    const groups = new Map();
    tl.forEach((p, j) => { const key = p.x.toFixed(5) + "," + p.y.toFixed(5); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(j); });
    const doneOp = o.placeDone ?? 0.7, aheadOp = o.points === "all" ? o.placeAhead ?? 0.35 : 0;
    const labelsOn = o.labels && o.labels !== "off" && endA < 1, labelQueue = [];
    for (const js of groups.values()) {
      const cur = js.includes(gz.i), reached = js.filter(j => sec >= tl[j].t0);
      let a = 0;
      if (cur) {
        // arriving: from what it was before (visited before, ahead, or nothing) up to 1
        const t0 = tl[gz.i].t0, before = reached.some(j => j !== gz.i && tl[j].t1 <= t0) ? doneOp : aheadOp;
        a = lerp(o.points === "current" ? 0 : before, 1, ease((sec - t0) / 0.35));
      } else if (reached.length) a = lerp(1, o.points === "current" ? 0 : doneOp, ease((sec - Math.max(...reached.map(j => tl[j].t1))) / 0.5));
      else a = aheadOp;
      const p = tl[js[0]], x = X(p.x), y = Y(p.y), first = reached.length ? tl[reached[0]].t0 : -1;
      const show = o.points !== "off" && !(o.points === "current" && !cur) && !(o.points === "visited" && !reached.length);
      // the first arrival grows the marker in (when it was not shown before)
      const grow = o.points === "all" || first < 0 ? 1 : 0.6 + 0.4 * ease((sec - first) / 0.35), r = R(p) * grow * (cur ? 1 + 0.12 * beat : 1);
      if (show && a > 0.005) {
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = hexA(o.pointColor, 0.18 * a); g.fill();
        ring(g, x, y, r, o.pointColor, 0.95 * a, (cur ? 2.6 : 1.6) * u);
        if (o.numbers) {
          const label = (o.points === "all" ? js : reached.length ? reached : js).map(j => j + 1).join("·"); g.font = `600 ${16 * u}px ${FONT_UI}`;
          const tw = Math.max(26 * u, g.measureText(label).width + 14 * u), th = 26 * u;
          g.globalAlpha = a; pill(g, x - tw / 2, y - th / 2, tw, th); g.fillStyle = o.pointColor; g.fill();
          g.fillStyle = "#0B0D11"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, x, y + 0.5 * u);
          g.globalAlpha = 1;
        }
      }
      // label: while the eye is there (fading in 0.35 s, out 0.5 s), or kept at the visited opacity
      if (labelsOn && reached.length) {
        const j = cur ? gz.i : reached[reached.length - 1], text = labelFor(o.labels, j, S.auto, o.labelText);
        if (text) {
          const la = cur ? ease((sec - tl[gz.i].t0) / 0.35) : lerp(1, o.labelKeep ? doneOp : 0, ease((sec - Math.max(...reached.map(q => tl[q].t1))) / 0.5));
          if (la > 0.01) labelQueue.push({ text, x, y, r: R(p), a: la * (1 - endA), rise: cur ? 1 - ease((sec - tl[gz.i].t0) / 0.35) : 0 });
        }
      }
    }
    // arrival effects: every point the eye reached in the last 1.6 s
    for (let j = Math.max(0, gz.i - 2); j <= gz.i; j++) {
      const p = tl[j], age = sec - p.t0; if (age < 0 || age > 1.6) continue;
      const x = X(p.x), y = Y(p.y), r = R(p), b = boostOf(p) * str;
      if (o.fx.pulse) { const a = age / 1.1; if (a < 1) ring(g, x, y, r + (10 * u + r * 0.9 * b) * ease(a), o.pointColor, (1 - a) * 0.95, (1 + 3 * (1 - a)) * u); }
      if (o.fx.ripple) for (let m = 0; m < 3; m++) { const a = (age - m * 0.22) / 1.3; if (a > 0 && a < 1) ring(g, x, y, r * (1 + 1.7 * a * b), o.pointColor, (1 - a) * 0.6, 1.6 * u); }
      if (o.fx.flash && (p.accent || p.section === "climax") && age < 0.35) { g.fillStyle = `rgba(255,255,255,${0.22 * str * (1 - age / 0.35)})`; g.fillRect(0, 0, W, H); }
    }
    // beats: a ring on the current place that throbs with the kick
    if (beat > 0.05 && o.points !== "off") { const p = tl[gz.i]; ring(g, X(p.x), Y(p.y), R(p) * (1.06 + 0.25 * beat), o.pointColor, 0.55 * beat * fadeEnd, 2 * u); }
    if (o.fx.glow && str > 0) {
      const p = tl[gz.i], r = R(p), a = (0.16 + 0.42 * Math.exp(-Math.max(0, gz.age) / 0.7) + 0.3 * beat) * str * boostOf(p) * fadeEnd;
      const gr = g.createRadialGradient(exX, exY, 0, exX, exY, r * 2.2);
      gr.addColorStop(0, hexA(o.pointColor, Math.min(0.9, a))); gr.addColorStop(1, hexA(o.pointColor, 0));
      g.save(); g.globalCompositeOperation = "lighter"; g.fillStyle = gr; g.fillRect(exX - r * 2.2, exY - r * 2.2, r * 4.4, r * 4.4); g.restore();
    }
    // the eye
    const es = eyeStyle(o);
    if (es !== "off" && fadeEnd > 0.01) {
      const moving = gz.i + 1 < n && gz.u > 0 && gz.u < 1, size = (6.5 + 3 * beat) * u;
      g.save(); g.shadowColor = hexA(o.pathColor, 1); g.shadowBlur = 16 * u;
      if (moving && (es === "dot" || es === "comet")) {
        const steps = es === "comet" ? 10 : 4, gap = es === "comet" ? 0.045 : 0.07;
        for (let m = steps; m >= 1; m--) {
          const f = Math.max(0, gz.u - m * gap), p = geo.at(gz.i + f);
          g.beginPath(); g.arc(X(p.x), Y(p.y), size * (1 - m / (steps + 1)), 0, Math.PI * 2); g.fillStyle = hexA(o.eyeColor || "#ffffff", (0.5 / steps) * (steps + 1 - m) * fadeEnd); g.fill();
        }
      }
      if (es === "ring") ring(g, exX, exY, size * 1.6, o.eyeColor || "#ffffff", fadeEnd, 2.4 * u);
      else { g.beginPath(); g.arc(exX, exY, size, 0, Math.PI * 2); g.fillStyle = hexA(o.eyeColor || "#ffffff", fadeEnd); g.fill(); }
      g.restore();
    }
    // labels, over the effects: a pill above the place (below it near the top), rising in
    g.save(); g.font = `600 ${22 * u * ts}px ${Fnt.css}`; g.textAlign = "center"; g.textBaseline = "middle";
    for (const q of labelQueue) {
      const text = Fnt.caps ? q.text.toUpperCase() : q.text, tw = g.measureText(text).width + 22 * u * ts, th = 36 * u * ts;
      let ly = q.y - q.r - th / 2 - 10 * u + q.rise * 10 * u; if (ly - th / 2 < T * 0.5) ly = q.y + q.r + th / 2 + 10 * u;
      const lx = clamp(q.x, L + tw / 2, W - Rm - tw / 2);
      g.globalAlpha = q.a; pill(g, lx - tw / 2, ly - th / 2, tw, th); g.fillStyle = hexA(o.labelBg || "#080a0e", 0.78); g.fill();
      g.lineWidth = 1.2 * u; g.strokeStyle = hexA(o.pointColor, 0.8); g.stroke();
      g.fillStyle = o.labelColor || "#fff"; g.fillText(text, lx, ly + 1 * u);
    }
    g.restore();
    if (o.caption === "points" && C.point && sec < last.t1 && endA < 1) S._pointText = { text: C.point(gz.i), a: ease(gz.age / 0.4) * (1 - endA) };
    else S._pointText = null;
  }
  drawVignette(g, W, H, o.vignette || 0);
  // bottom: overview bars, live spectrum, live waveform or a progress line
  const prog = clamp(sec / S.total), base = H - B, hMax = 60 * u, x0 = L, x1 = W - Rm, bw0 = x1 - x0;
  // its colour: one colour, a gradient from left to right, or a colour that follows the sound
  // (from the first colour when quiet to the second when loud)
  const cA = o.bottomColor || o.pointColor, cB = o.bottomColor2 || o.pathColor, fill = o.bottomFill || "solid";
  const level = valueAt(S.an, S.an.rms, sec), punch = clamp(Math.max(level, valueAt(S.an, S.an.beat, sec)));
  let grad = null;
  if (fill === "gradient") { grad = g.createLinearGradient(x0, 0, x1, 0); grad.addColorStop(0, hexA(cA, 0.95)); grad.addColorStop(1, hexA(cB, 0.95)); }
  // the colour of a part whose own level is e (a bar's height; the loudness for lines)
  const paint = e => (grad ? grad : fill === "reactive" ? hexA(mixHex(cA, cB, clamp(0.55 * e + 0.45 * punch)), 0.95) : hexA(cA, 0.95));
  const glow = fill === "reactive" ? mixHex(cA, cB, punch) : cA;
  let bottomH = 0;
  if (o.bottom === "bars") {
    const env = S.an && S.an.source === "audio" ? S.an.env : S.env, bw = 6 * u, gap = 4 * u, nb = Math.max(8, Math.floor((bw0 + gap) / (bw + gap)));
    for (let b = 0; b < nb; b++) {
      const e = env[Math.min(env.length - 1, Math.floor((b / nb) * env.length))], h = Math.max(3 * u, e * hMax);
      // the bars already played take the colour; with "follows the sound", by their own height
      g.fillStyle = (b + 0.5) / nb <= prog ? (fill === "reactive" ? hexA(mixHex(cA, cB, e), 0.95) : paint(e)) : "rgba(255,255,255,0.32)";
      g.fillRect(x0 + b * (bw + gap), base - h, bw, h);
    }
    bottomH = hMax;
  } else if (o.bottom === "spectrum") {
    const bands = bandsAt(S.an, sec), nb = BANDS, step = bw0 / nb, bw = step * 0.62;
    g.save(); g.shadowColor = hexA(glow, 0.8); g.shadowBlur = 10 * u;
    for (let b = 0; b < nb; b++) {
      // without the rendered sound: a shape from the loudness, until the analysis is ready
      const e = bands ? bands[b] : level * (0.55 + 0.45 * Math.sin(b * 0.9 + sec * 6)) * (1 - b / nb * 0.6);
      const h = Math.max(3 * u, e * hMax * 1.2);
      g.fillStyle = paint(e); g.fillRect(x0 + b * step + (step - bw) / 2, base - h, bw, h);
    }
    g.restore(); bottomH = hMax * 1.2;
  } else if (o.bottom === "wave") {
    const wv = S.an && S.an.wave ? S.an.wave(sec, 220) : null, mid = base - hMax / 2;
    g.save(); g.lineWidth = 2.4 * u; g.strokeStyle = paint(level); g.shadowColor = hexA(glow, 0.8); g.shadowBlur = 8 * u; g.lineJoin = "round";
    g.beginPath();
    for (let i = 0; i < 220; i++) {
      const s = wv ? clamp(wv[i] * 2.2, -1, 1) : level * Math.sin(i * 0.35 + sec * 20) * Math.sin((i / 219) * Math.PI);
      const x = x0 + (i / 219) * bw0, y = mid - s * hMax / 2;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke(); g.restore(); bottomH = hMax;
  } else if (o.bottom === "line") {
    const y = base - 4 * u; g.fillStyle = "rgba(255,255,255,0.3)"; g.fillRect(x0, y, bw0, 4 * u);
    g.fillStyle = paint(level); g.fillRect(x0, y, bw0 * prog, 4 * u); bottomH = 8 * u;
  }
  // text: the title (always, or the first seconds), the point line, the end card
  // the line under the title: the style, key and tempo, the user's own text, or nothing
  const sub = o.subtitle === "none" ? "" : o.subtitle === "custom" ? (o.subText || "").trim() : C.sub || "";
  const title = C.title ? (Fnt.caps ? C.title.toUpperCase() : C.title) : "";
  const tA = (o.caption === "none" ? 0 : o.titleWhen === "intro" ? ease((sec - 0.2) / 0.6) * (1 - ease((sec - (o.titleSecs ?? 4.5)) / 1)) : 1) * (1 - endA);
  const tSize = (Fnt.caps ? 58 : 44) * u * ts, sSize = 22 * u * ts;
  if (tA > 0.01 && (title || sub)) {
    g.save(); g.globalAlpha = tA; g.shadowColor = "rgba(0,0,0,0.55)"; g.shadowBlur = 12 * u; g.textBaseline = "alphabetic";
    let x = L, y = T + tSize, align = "left";
    if (o.titlePos === "tc") { x = W / 2; align = "center"; }
    else if (o.titlePos === "center") { x = W / 2; y = H / 2; align = "center"; }
    else if (o.titlePos === "bl") y = base - bottomH - 18 * u - sSize * 1.5;
    g.textAlign = align;
    g.fillStyle = o.titleColor || "#fff"; g.font = `${Fnt.weight} ${tSize}px ${Fnt.css}`; if (title) g.fillText(title, x, y, W - L - Rm);
    g.fillStyle = hexA(o.subColor || "#ffffff", 0.85); g.font = `450 ${sSize}px ${FONT_UI}`; if (sub) g.fillText(sub, x, y + sSize * 1.5, W - L - Rm);
    g.restore();
  }
  if (S._pointText && S._pointText.a > 0.01) {
    const top = o.titlePos === "bl";
    g.save(); g.globalAlpha = S._pointText.a; g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 10 * u; g.textAlign = "left";
    g.fillStyle = o.subColor || "#fff"; g.font = `550 ${26 * u * ts}px ${FONT_UI}`;
    g.fillText(S._pointText.text, L, top ? T + 26 * u * ts : base - bottomH - 16 * u, W - L - Rm); g.restore();
  }
  if (endA > 0.01) {
    g.fillStyle = `rgba(4,6,10,${0.6 * endA})`; g.fillRect(0, 0, W, H);
    g.save(); g.globalAlpha = endA; g.textAlign = "center"; g.textBaseline = "middle"; g.shadowColor = "rgba(0,0,0,0.5)"; g.shadowBlur = 14 * u;
    const big = (Fnt.caps ? 92 : 68) * u * ts;
    g.fillStyle = o.titleColor || "#fff"; g.font = `${Fnt.weight} ${big}px ${Fnt.css}`; if (title) g.fillText(title, W / 2, H / 2 - big * 0.35, W - L - Rm);
    g.fillStyle = hexA(o.subColor || "#ffffff", 0.85); g.font = `450 ${26 * u * ts}px ${FONT_UI}`; if (sub) g.fillText(sub, W / 2, H / 2 + big * 0.45, W - L - Rm);
    if (o.credit) { g.fillStyle = hexA(o.pointColor, 0.9); g.font = `500 ${20 * u * ts}px ${FONT_UI}`; g.fillText(o.credit, W / 2, H - B - 10 * u, W - L - Rm); }
    g.restore();
  }
  drawGrain(g, W, H, o.grain || 0, opt.frame ?? Math.round(sec * 24), u);
  // fades from and to black
  const fa = fadeAt(sec, S.total, o.fadeIn || 0, o.fadeOut || 0);
  if (fa > 0) { g.fillStyle = `rgba(0,0,0,${fa})`; g.fillRect(0, 0, W, H); }
  if (opt.preview && o.safe && (o.shape === "vertical" || o.shape === "portrait")) drawSafeGuides(g, W, H, o.shape, u);
  g.restore();
}

// ---- encoders
const MP4_VIDEO = [["avc", "avc1.640033"], ["avc", "avc1.4d0033"], ["avc", "avc1.420033"], ["vp9", "vp09.00.41.08"], ["av1", "av01.0.09M.08"]];
const WEBM_VIDEO = [["V_VP9", "vp09.00.41.08"], ["V_VP8", "vp8"], ["V_AV1", "av01.0.09M.08"]];
// The first video codec this browser can encode at this size (bits per pixel from the quality).
export async function pickVideoCodec(W, H, fps, bpp = 0.14, container = "mp4") {
  if (typeof VideoEncoder === "undefined") return null;
  const bitrate = Math.round(W * H * fps * bpp);
  for (const [mux, codec] of container === "webm" ? WEBM_VIDEO : MP4_VIDEO) {
    const config = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: "quality", ...(mux === "avc" ? { avc: { format: "avc" } } : {}) };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return { mux, codec, config }; } catch (e) { /* next */ }
  }
  return null;
}
export const videoSupported = () => typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
const cancelErr = () => { const c = new Error("cancelled"); c.code = "cancelled"; return c; };

/*
 * Encodes the video: every frame drawn with drawVideoFrame, the audio from the master render.
 * audio: { chs, sr, gain }. container: "mp4" or "webm". onProgress(f), cancelled() → true stops.
 * Returns { blob, codec, audio } with the codecs used.
 */
export async function encodeVideo(S, { W, H, fps = 30, audio, container = "mp4", bpp = 0.14, onProgress = null, cancelled = null }) {
  const webm = container === "webm";
  const vc = await pickVideoCodec(W, H, fps, bpp, container);
  if (!vc) throw new Error(webm ? "This browser can't encode WebM video." : "This browser can't encode video. Chrome, Edge and Safari 17 or newer can.");
  // audio: AAC (else Opus) in MP4, Opus in WebM; Opus may need 48 kHz
  let ac = null, au = audio;
  if (audio) {
    if (webm) {
      const ok = a => pickAudioCodec(a.sr, 160, "opus");
      ac = await ok(au);
      if (!ac && au.sr !== 48000) { au = { ...au, chs: await resampleChannels(au.chs, au.sr, 48000), sr: 48000 }; ac = await ok(au); }
      if (ac) ac = { ...ac, mux: "A_OPUS" };
    } else {
      ac = await pickAudioCodec(au.sr, 192);
      if (ac && ac.mux === "opus" && au.sr !== 48000) { au = { ...au, chs: await resampleChannels(au.chs, au.sr, 48000), sr: 48000 }; ac = await pickAudioCodec(48000, 192); }
    }
  }
  const target = webm ? new WebmTarget() : new ArrayBufferTarget();
  const muxer = webm
    ? new WebmMuxer({ target, video: { codec: vc.mux, width: W, height: H, frameRate: fps }, ...(ac ? { audio: { codec: "A_OPUS", numberOfChannels: 2, sampleRate: au.sr } } : {}), firstTimestampBehavior: "offset" })
    : new Muxer({ target, fastStart: "in-memory", firstTimestampBehavior: "offset", video: { codec: vc.mux, width: W, height: H, frameRate: fps }, ...(ac ? { audio: { codec: ac.mux, numberOfChannels: 2, sampleRate: au.sr } } : {}) });
  let err = null;
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { err = e; } });
  ve.configure(vc.config);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { alpha: false });
  const dur = au ? au.chs[0].length / au.sr : S.total, N = Math.ceil(dur * fps);
  // WebM wants the tracks interleaved in time: audio goes in alongside the frames
  let ae = null, aDone = 0;
  if (ac) { ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: e => { err = e; } }); ae.configure(ac.config); }
  const audioUpTo = sec => { if (!ae) return; const end = Math.min(au.chs[0].length, Math.round(sec * au.sr)); if (end > aDone) { encodeAudioData(ae, au.chs.map(c => c.subarray(aDone, end)), au.sr, au.gain, aDone); aDone = end; } };
  for (let f = 0; f < N; f++) {
    if (err) throw err;
    if (cancelled && cancelled()) { try { ve.close(); if (ae) ae.close(); } catch (e) { /* closed */ } throw cancelErr(); }
    audioUpTo((f + 1) / fps);
    drawVideoFrame(g, W, H, f / fps, S, { frame: f });
    const frame = new VideoFrame(cv, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
    ve.encode(frame, { keyFrame: f % (fps * 2) === 0 }); frame.close();
    // wait for the encoder (its dequeue event where there is one) and let the page breathe
    while (ve.encodeQueueSize > 4) await ("ondequeue" in ve ? new Promise(r => ve.addEventListener("dequeue", r, { once: true })) : tick());
    if (f % 6 === 0) { if (onProgress) onProgress(f / N); await tick(); }
  }
  audioUpTo(dur + 1);
  await ve.flush(); ve.close();
  if (ae) { await ae.flush(); ae.close(); }
  if (err) throw err;
  muxer.finalize();
  if (onProgress) onProgress(1);
  return { blob: new Blob([target.buffer], { type: webm ? "video/webm" : "video/mp4" }), codec: vc.codec, audio: ac ? ac.codec : null };
}

// The time range of a GIF: 8 s around the climax, the first 10 s, or the whole piece.
export function gifRange(S, range) {
  if (range === "whole") return [0, S.total];
  if (range === "start") return [0, Math.min(10, S.total)];
  const c = S.tl.find(p => p.section === "climax") || S.tl[Math.floor(S.tl.length * 0.65)] || { t0: 0 };
  const a = clamp(c.t0 - 1.5, 0, Math.max(0, S.total - 8));
  return [a, Math.min(S.total, a + 8)];
}
// GIF (silent, looping): frames drawn small and quantized to 256 colours each.
export async function encodeGif(S, { W, H, fps = 12, from = 0, to = 8, onProgress = null, cancelled = null }) {
  const gif = GIFEncoder(), cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d", { willReadFrequently: true }), N = Math.max(1, Math.round((to - from) * fps)), delay = Math.round(1000 / fps);
  for (let f = 0; f < N; f++) {
    if (cancelled && cancelled()) throw cancelErr();
    drawVideoFrame(g, W, H, from + f / fps, S, { frame: f });
    const data = g.getImageData(0, 0, W, H).data, palette = quantize(data, 256), index = applyPalette(data, palette);
    gif.writeFrame(index, W, H, { palette, delay, repeat: 0 });
    if (f % 2 === 0) { if (onProgress) onProgress(f / N); await tick(); }
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}
// A PNG of one frame.
export async function posterPng(S, W, H, sec) {
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  drawVideoFrame(cv.getContext("2d"), W, H, sec, S, { frame: 0 });
  return new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error("The poster couldn't be made."))), "image/png"));
}
