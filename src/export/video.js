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
import { defaultEdit } from "./look.js";
import { clamp } from "../core/util.js";
import { pickAudioCodec, encodeAudioData, resampleChannels, tick } from "./audio.js";
import { pathGeometry, drawPath } from "./paths.js";
import { FONTS, QUALITY, safeArea, drawSafeGuides, drawVignette, drawGrain, fadeAt } from "./look.js";
import { analyzeNotes, valueAt, bandsAt, BANDS } from "./reactive.js";
import { labelFor, placeLabels, placeNoteTimes, tickerAt } from "./labels.js";

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
// the texture of a place, shown when the eye arrives: which view of the analysis, and how it appears
export const PATCH_MAPS = { auto: "Auto (what shaped its sound)", edges: "Edges", texture: "Texture", attention: "Eye map", regions: "Regions", colour: "Colour areas", picture: "The picture" };
export const PATCH_ANIMS = { rise: "Rises", reveal: "Changes its texture", both: "Rises and changes" };
// the ripple: which track sets it off
export const RIPPLE_TRACKS = { off: "Off", perc: "Drums", bass: "Bass", lead: "Melody", harm: "Harmony", pad: "Pad" };
export const RIPPLE_LOOKS = { lens: "Lens", rings: "Rings", dots: "Dots", squares: "Tiles", grid: "Grid", matrix: "Matrix" };
// the colour of the ripple: one colour, two along the way out, or all the hues around the eye
export const RIPPLE_FILLS = { solid: "One colour", gradient: "Gradient", rainbow: "Rainbow" };
// labels: how the label moves with the music, and how it is coloured
export const LABEL_BEATS = { off: "Still", both: "Grows", h: "Stretches wide", v: "Stretches tall" };
export const LABEL_FILLS = { solid: "One colour", gradient: "Gradient", cycle: "A colour each", pulse: "Follows the sound" };
// the sound display: lying along the frame or standing up its side, and which way its bars grow
// (its place is dragged on the preview, barXY; by default along the bottom, or up the right side)
export const BAR_ORIENT = { h: "Horizontal", v: "Vertical" };
// the logo (src/assets/logo.svg, 102 × 90 units): its outline paths, and the six waves as x, top, length
const LOGO_D = ["M73.329,86.912l-59.811,0c-6.085,-0 -11.018,-4.199 -11.018,-9.379l-0,-65.654c0,-5.18 4.933,-9.379 11.018,-9.379l59.811,0", "M2.5,67.693l22.983,-22.987l38.684,42.206", "M38.671,59.095l17.687,-23.877"];
const LOGO_WAVES = [[56.384, 30.633, 28.146], [64.82, 19.25, 50.911], [73.329, 30.13, 29.151], [81.838, 34.298, 20.815], [90.346, 26.126, 37.161], [98.855, 38.6, 12.211]];
let LOGO_PATHS = null;
export const BAR_DIR = { up: "Grows in", down: "Grows out", mirror: "Both ways" };
export const GIF_RANGES = { climax: "8 s around the climax", start: "First 10 s", whole: "Whole piece" };

export function defaultVideo() {
  return {
    platform: "custom", shape: "image", size: "original", fps: 30, quality: "high", safe: true,
    fit: "fill", camera: "follow", zoom: 0.35, camEase: "smooth", camMove: 1.6, camSmooth: 0.45, drift: 0,
    theme: "gold", pathColor: VIDEO_THEMES.gold.path, pointColor: VIDEO_THEMES.gold.point,
    path: "draw", lineShape: "straight", line: "glow", lineWidth: 3, pathDone: 1, pathAhead: 0.25,
    points: "visited", placeDone: 0.7, placeAhead: 0.35, numbers: true, passages: true, eye: "dot",
    labels: "off", labelText: {}, labelKeep: false, labelIn: "rise", labelOut: "fade", labelInSecs: 0.35, labelOutSecs: 0.5, labelHold: 0, labelPos: "auto", labelSize: 1, labelBgOp: 0.78, labelLine: false, labelOff: {}, labelBeat: "off", labelBeatAmt: 0.5, labelFill: "solid", labelBg2: "#6D5DF0", labelDetail: true, labelLive: true,
    barThick: 1, barGain: 1, barGap: 1, barRound: false,
    rippleFill: "solid", rippleColor2: "#6D5DF0",
    placeNow: "same", placeNowOp: 1, placeFill: 1, placeLineW: 1,
    fx: { pulse: true, ripple: false, spotlight: true, glow: true, flash: true }, strength: 0.6, react: 0.4, dim: 0.1,
    grade: "none", gradeAmt: 0.6, vignette: 0.25, grain: 0,
    caption: "title", title: "", subtitle: "info", subText: "", titleColor: "#FFFFFF", subColor: "#FFFFFF", eyeColor: "#FFFFFF", labelColor: "#FFFFFF", labelBg: "#080A0E", font: "geist", titlePos: "tl", titleWhen: "always", titleSecs: 4.5, textSize: 1,
    cover: "climax", coverTime: 5, coverHold: 0.5, coverOut: "fade", coverFade: 1.2,
    pathFill: "solid", pathColor2: VIDEO_THEMES.gold.point, glow: 0.6, dashLen: 3.2, dashGap: 2.6, curve: 0.3,
    placeStyle: "ring", placeSize: 1, numberStyle: "pill", climaxOwn: false, climaxColor: "#FF6B6B",
    spotColor: "#000000", vigColor: "#000000", tintColor: "#2B1B4A", tintAmt: 0,
    titleAlign: "auto", titleXY: null, pointXY: null, pointAlign: "left", textStyle: "shadow", boxColor: "#000000", caps: false, letterSpace: 0, titleAnim: "fade",
    patch: false, patchMap: "auto", patchAnim: "both", patchKeep: false, patchOpacity: 0.6, patchSoft: 0.4, ripple: "off", rippleAmt: 0.5, rippleLook: "lens", rippleBand: 0.5, rippleSoft: 0.6, rippleColor: "#FFFFFF", pathFrom: 0, pathTo: 0, pathTrail: 0,
    logo: false, logoColor: "#FFFFFF", logoSize: 1, logoOpacity: 0.85, logoAnim: true, logoXY: null,
    barOrient: "h", barXY: null, barDir: "up", barSize: 1, barLength: 1, barOpacity: 1, coverClean: false, edit: defaultEdit(),
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
export const COVERS = { off: "Off", climax: "The climax", time: "A moment", image: "My own image" };
// how the cover gives way to the video
export const COVER_OUTS = { fade: "Fades", zoom: "Zooms in and fades", iris: "Opens from the first place", cut: "Cut" };
export const BOTTOM_FILLS = { solid: "One colour", gradient: "Gradient", reactive: "Follows the sound" };
export const PATH_FILLS = { solid: "One colour", gradient: "Along the path", story: "Follows the story" };
export const PLACE_STYLES = { ring: "Ring", filled: "Filled", dashed: "Dashed", dot: "Dot", none: "No circle" };
export const NUMBER_STYLES = { pill: "In a pill", plain: "Plain", none: "None" };
// the place the eye is on: how it stands out from the others
export const PLACE_NOW = { same: "Like the others", halo: "Halo", brackets: "Viewfinder", target: "Target" };
// labels on places: how one appears, how it leaves, where it sits
export const LABEL_INS = { rise: "Rises in", fade: "Fades in", pop: "Pops", type: "Typed", none: "At once" };
export const LABEL_OUTS = { fade: "Fades out", sink: "Sinks", shrink: "Shrinks", none: "At once" };
export const LABEL_POS = { auto: "Above (below near the top)", above: "Above", below: "Below", left: "Left", right: "Right", center: "On the place" };
export const TEXT_STYLES = { shadow: "Soft shadow", outline: "Outline", box: "Box", none: "Plain" };
export const TITLE_ANIMS = { fade: "Fade", rise: "Rise", type: "Typed", none: "At once" };
export const ALIGNS = { auto: "Auto", left: "Left", center: "Centre", right: "Right" };
const eyeStyle = o => (o.eye === true ? "dot" : o.eye === false ? "off" : o.eye || "dot");

// Frame size in pixels (even numbers): the short side is `size`; "image" keeps the image's
// shape (at most 2.4:1 either way). size "original": the image's own pixels (the long side at
// most 3840, the short side at least 240); other shapes then take the image's short side.
export const MAX_SIDE = 3840;
export function frameSize(shape, size, iw, ih) {
  if (size === "original") {
    if (shape === "image" || !shape) {
      // at most 3840 px long and 2160 px across (the 4K frame, upright or lying): what graphics
      // cards encode, several times faster than the browser's own encoder, which a larger frame
      // would fall back to; and at most 8.8 MP (what H.264 level 5.1 can encode)
      const a = clamp(iw / ih, 1 / 2.4, 2.4), k = Math.min(1, MAX_SIDE / Math.max(iw, ih), 2160 / Math.min(iw, ih), Math.sqrt(8.8e6 / (iw * ih)));
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
// the index of the place at sec (the first before it starts)
export const gazeIndex = (tl, sec) => indexAt(tl, sec);
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
// The view of the analysis that best shows what shaped a place's sound: its edges when they were
// sharp, its texture when it was busy, its colour when it was vivid, else where the eye goes.
function autoMap(F) {
  const m = (F.tim && F.tim.m) || {};
  const c = [["edges", -(m.att ?? 0)], ["texture", m.bri ?? 0], ["colour", Math.max(m.res ?? 0, m.col ?? 0)]].sort((a, b) => b[1] - a[1])[0];
  return c[1] > 0.2 ? c[0] : "attention";
}
// note starts per layer in seconds (drums: the kicks and snares, else every hit), with their loudness
function onsetsOf(sc, spb) {
  const out = {};
  for (const n of sc.notes) { if (n.dbl) continue; (out[n.layer] = out[n.layer] || []).push([n.t * spb, n.vel / 127, n.midi]); }
  if (out.perc) { const main = out.perc.filter(x => x[2] === 36 || x[2] === 38 || x[2] === 39); if (main.length) out.perc = main; }
  for (const k of Object.keys(out)) { out[k].sort((a, b) => a[0] - b[0]); const dedup = []; for (const x of out[k]) if (!dedup.length || x[0] - dedup[dedup.length - 1][0] > 0.06) dedup.push(x); out[k] = dedup; }
  return out;
}
export function videoScene(sc, src, opts, caption = {}, extra = {}) {
  const small = document.createElement("canvas"), k = 48 / Math.max(src.width, src.height);
  small.width = Math.max(4, Math.round(src.width * k)); small.height = Math.max(4, Math.round(src.height * k));
  small.getContext("2d").drawImage(src, 0, 0, small.width, small.height);
  const spb = 60 / sc.bpm, tl = videoTimeline(sc), env = soundEnvelope(sc);
  const geos = {};
  return {
    sc, src, blur: small, o: opts, tl, env, total: sc.total * spb, spb, caption, auto: extra.auto || placeLabels(sc), noteTimes: placeNoteTimes(sc, spb),
    an: extra.an || analyzeNotes(sc, env), passages: sc.notes.filter(n => n.passage && n.layer === "lead"),
    maps: extra.maps || null, mapOf: sc.points.map(F => autoMap(F)), onsets: onsetsOf(sc, spb),
    geo(shape, tension = 0.5) { const k = shape + "|" + tension; return geos[k] || (geos[k] = pathGeometry(tl, shape === "curved", 18, tension)); }
  };
}

const FONT_UI = '"Geist", system-ui, -apple-system, "Segoe UI", sans-serif';
const MATRIX_CHARS = "01アイウエオカキクケコサシスセソ7Z:.=*+-<>¦";
const FONT_MONO = '"Geist Mono", ui-monospace, Menlo, Consolas, monospace';
// a fully saturated colour for a hue (0-1), as a hex string
function hueHex(h) {
  const f = n => { const k = (n + h * 12) % 12, v = 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(v * 255).toString(16).padStart(2, "0"); };
  return "#" + f(0) + f(8) + f(4);
}
// a frame-sized canvas for the ripple's lens
let RIPPLE_CV = null;
function rippleCanvas(W, H) {
  if (!RIPPLE_CV) RIPPLE_CV = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : document.createElement("canvas");
  if (RIPPLE_CV.width !== W || RIPPLE_CV.height !== H) { RIPPLE_CV.width = W; RIPPLE_CV.height = H; }
  return RIPPLE_CV;
}
// one small canvas reused for every place's texture (grown when a bigger place needs it)
let PATCH_CV = null;
function patchCanvas(D) {
  if (!PATCH_CV) PATCH_CV = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(D, D) : document.createElement("canvas");
  if (PATCH_CV.width < D || PATCH_CV.height < D) { PATCH_CV.width = Math.max(PATCH_CV.width, D); PATCH_CV.height = Math.max(PATCH_CV.height, D); }
  return PATCH_CV;
}
function ring(g, x, y, r, col, a, w) { if (a <= 0 || r <= 0) return; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.strokeStyle = hexA(col, a); g.lineWidth = w; g.stroke(); }
function pill(g, x, y, w, h, rad = h / 2) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, rad); else g.rect(x, y, w, h); }
// The cover: the first frame of the video (what messaging apps show as its preview), held for a
// moment and then blended into the video, instead of fading in from black. A frame of the video
// (at the climax, or at a chosen second) or the user's own image, filling the frame.
export function coverTime(S) {
  const o = S.o;
  if (o.cover === "time") return clamp(o.coverTime ?? 0, 0, Math.max(0, S.total - 0.05));
  const c = S.tl.find(p => p.section === "climax");
  return c ? Math.min(S.total - 0.05, c.t0 + 0.45) : S.total * 0.6;
}
export const hasCover = S => !!(S.o.cover && S.o.cover !== "off" && (S.o.cover !== "image" || S.coverImg));
function coverCanvas(S, W, H) {
  const o = S.o, look = { ...o, cover: undefined, coverHold: undefined };
  const key = [W, H, o.cover, o.cover === "time" ? o.coverTime : 0, S.coverImgId || 0, JSON.stringify(look)].join("|");
  if (S._cover && S._cover.key === key) return S._cover.c;
  const c = typeof document !== "undefined" ? document.createElement("canvas") : null; if (!c) return null;
  c.width = W; c.height = H; const g = c.getContext("2d");
  if (o.cover === "image" && S.coverImg) {
    const im = S.coverImg, k = Math.max(W / im.width, H / im.height);
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.imageSmoothingQuality = "high";
    g.drawImage(im, (W - im.width * k) / 2, (H - im.height * k) / 2, im.width * k, im.height * k);
  } else {
    const keep = { hit: S.hit, pt: S._pointText };
    drawVideoFrame(g, W, H, coverTime(S), S, { noCover: true, frame: 0, clean: !!o.coverClean });
    S.hit = keep.hit; S._pointText = keep.pt;
  }
  S._cover = { key, c };
  return c;
}

// A block of text lines at (x, y) (the first line's baseline), aligned left, centre or right, in
// the chosen style: a soft shadow, an outline, a box behind it, or plain. Returns its bounds.
function textBlock(g, lines, x, y, align, alpha, o, u, maxW) {
  const vis = lines.filter(l => l.text);
  if (!vis.length || alpha <= 0.01) return null;
  g.save(); g.globalAlpha = alpha; g.textAlign = align; g.textBaseline = "alphabetic";
  const canLS = "letterSpacing" in g, setLS = l => { if (canLS) g.letterSpacing = `${((o.letterSpace || 0) * l.size).toFixed(2)}px`; };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const l of vis) {
    g.font = l.font; setLS(l);
    const w = Math.min(maxW, g.measureText(l.measure || l.text).width), lx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    x0 = Math.min(x0, lx); x1 = Math.max(x1, lx + w); y0 = Math.min(y0, y + l.dy - l.size * 0.8); y1 = Math.max(y1, y + l.dy + l.size * 0.25);
  }
  const style = o.textStyle || "shadow", pad = 14 * u;
  if (style === "box") { g.beginPath(); if (g.roundRect) g.roundRect(x0 - pad, y0 - pad * 0.8, x1 - x0 + 2 * pad, y1 - y0 + 1.6 * pad, 10 * u); else g.rect(x0 - pad, y0 - pad * 0.8, x1 - x0 + 2 * pad, y1 - y0 + 1.6 * pad); g.fillStyle = hexA(o.boxColor || "#000000", 0.55); g.fill(); }
  for (const l of vis) {
    g.font = l.font; setLS(l);
    if (style === "shadow") { g.shadowColor = "rgba(0,0,0,0.55)"; g.shadowBlur = 12 * u; } else g.shadowBlur = 0;
    if (style === "outline") { g.lineJoin = "round"; g.lineWidth = Math.max(1.5 * u, l.size * 0.09); g.strokeStyle = hexA(o.boxColor || "#000000", 0.85); g.strokeText(l.text, x, y + l.dy, maxW); }
    g.fillStyle = l.color; g.fillText(l.text, x, y + l.dy, maxW);
  }
  g.restore();
  return { x0: x0 - pad * 0.6, y0: y0 - pad * 0.6, x1: x1 + pad * 0.6, y1: y1 + pad * 0.6 };
}

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
  const drawPicture = (img = src, to = g) => { if (ex > sx && ey > sy) { const fx = img.width / iw, fy = img.height / ih; to.drawImage(img, sx * fx, sy * fy, (ex - sx) * fx, (ey - sy) * fy, (sx - v.x) * k, (sy - v.y) * k, (ex - sx) * k, (ey - sy) * k); } };
  drawPicture();
  if (o.dim > 0) { g.fillStyle = `rgba(0,0,0,${o.dim})`; g.fillRect(0, 0, W, H); }
  // the ripple: every note of the chosen track sends a wave across the picture from where the eye
  // is. Lens: inside the wave the picture is magnified a little, like water. Rings: thin rings only.
  // Dots: a grid of dots lights up as the wave passes, like an LED matrix. The band's opacity and
  // the softness of its edges are set apart from the strength (its size and width).
  if (o.ripple && o.ripple !== "off" && !opt.clean && S.onsets && S.onsets[o.ripple]) {
    const life = 1.4, amt = clamp(o.rippleAmt ?? 0.5), band = clamp(o.rippleBand ?? 0.5), soft = clamp(o.rippleSoft ?? 0.6), look = o.rippleLook || "lens", col = o.rippleColor || "#FFFFFF", col2 = o.rippleColor2 || o.pathColor, rfill = o.rippleFill || "solid";
    const list = S.onsets[o.ripple], cur = tl.length ? tl[Math.max(0, gazeIndex(tl, sec))] : null;
    const cx = cur ? X(cur.x) : W / 2, cy = cur ? Y(cur.y) : H / 2, maxR = Math.hypot(W, H) * (0.25 + 0.35 * amt), ringW = (16 + 28 * amt) * u;
    let lo = 0, hi = list.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid][0] <= sec) lo = mid + 1; else hi = mid; }
    const waves = [];
    for (let q = lo - 1; q >= 0 && waves.length < 4; q--) {
      const age = sec - list[q][0]; if (age > life) break;
      const f = age / life;
      waves.push({ rr: ringW + f * maxR, s: (1 - f) * (0.4 + 0.6 * list[q][1]) });
    }
    // the band's profile across its width (d: distance from its middle): flat in the middle, its
    // edges fading over `soft` of the half-width (0: hard edges)
    const hw = ringW / 2, feather = Math.max(0.001, soft * hw);
    const prof = d => { const e = Math.abs(d); return e >= hw ? 0 : e <= hw - feather ? 1 : (hw - e) / feather; };
    // the colour at a distance d from the eye, in the direction ang: one colour, from the first to
    // the second on the way out, or every hue around the eye
    const colAt = (d, ang) => (rfill === "gradient" ? mixHex(col, col2, clamp(d / maxR)) : rfill === "rainbow" ? hueHex(((ang / (Math.PI * 2)) % 1 + 1 + sec * 0.05) % 1) : col);
    // how lit a point is: by the nearest wave's band and its strength
    const litAt = d => { let v = 0; for (const w of waves) { const pv = prof(d - w.rr) * w.s; if (pv > v) v = pv; } return v; };
    if (waves.length && band > 0) {
      if (look === "lens") {
        // the waves are drawn as a mask on a frame-sized canvas, the magnified (and as dimmed)
        // picture is put inside it, and the result goes over the frame at the band's opacity
        const rc = rippleCanvas(W, H), rg = rc.getContext("2d"), R = waves[0].rr + hw + 2, bx = Math.max(0, cx - R), by = Math.max(0, cy - R), bw = Math.min(W, cx + R) - bx, bh = Math.min(H, cy + R) - by;
        if (bw > 0 && bh > 0) {
          rg.setTransform(1, 0, 0, 1, 0, 0); rg.globalCompositeOperation = "source-over"; rg.globalAlpha = 1; rg.clearRect(bx, by, bw, bh);
          for (const w of waves) {
            const i0 = Math.max(0, w.rr - hw), o0 = w.rr + hw, gr = rg.createRadialGradient(cx, cy, i0, cx, cy, o0), fz = Math.min(0.49, feather / (o0 - i0 || 1));
            gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(fz, `rgba(0,0,0,${w.s})`); gr.addColorStop(1 - fz, `rgba(0,0,0,${w.s})`); gr.addColorStop(1, "rgba(0,0,0,0)");
            rg.fillStyle = gr; rg.beginPath(); rg.arc(cx, cy, o0, 0, Math.PI * 2); rg.arc(cx, cy, i0, 0, Math.PI * 2, true); rg.fill();
          }
          const zoom = 1.03 + 0.05 * amt;
          rg.save(); rg.globalCompositeOperation = "source-in"; rg.beginPath(); rg.rect(bx, by, bw, bh); rg.clip();
          rg.imageSmoothingEnabled = true; rg.translate(cx, cy); rg.scale(zoom, zoom); rg.translate(-cx, -cy); drawPicture(src, rg); rg.restore();
          // as dimmed as the rest of the frame (the old band was bright because it was not), with a
          // light sheen of the ripple's colour
          rg.save(); rg.globalCompositeOperation = "source-atop";
          if (o.dim > 0) { rg.fillStyle = `rgba(0,0,0,${o.dim})`; rg.fillRect(bx, by, bw, bh); }
          rg.fillStyle = hexA(col, 0.12); rg.fillRect(bx, by, bw, bh); rg.restore();
          g.save(); g.globalAlpha = Math.min(1, band * 1.6); g.drawImage(rc, bx, by, bw, bh, bx, by, bw, bh); g.restore();
        }
        // a faint line in the middle of each band, gone when the edges are fully soft
        for (const w of waves) ring(g, cx, cy, w.rr, colAt(w.rr, 0), 0.3 * w.s * band * (1 - soft), 1.4 * u);
      } else if (look === "rings") {
        // two or three thin rings per wave; softness widens them into a haze
        for (const w of waves) for (let m = 0; m < 3; m++) {
          const rr = w.rr - m * ringW * 0.45; if (rr <= 0) continue;
          const a = w.s * band * (1 - m * 0.3);
          if (soft > 0.05) ring(g, cx, cy, rr, colAt(rr, 0), a * 0.25 * soft, (2 + 10 * soft) * u);
          ring(g, cx, cy, rr, colAt(rr, 0), a * 0.8, 1.5 * u);
        }
      } else {
        // dots, tiles, a grid and a matrix share one fixed lattice: each cell near a wave lights up
        // by how close it is to the wave's middle
        const step = Math.max(6, (look === "squares" ? 34 - 12 * amt : look === "matrix" ? 26 - 8 * amt : look === "grid" ? 44 - 16 * amt : 22 - 10 * amt) * u), R = waves[0].rr + hw;
        const x0 = Math.max(0, cx - R), x1 = Math.min(W, cx + R), y0 = Math.max(0, cy - R), y1 = Math.min(H, cy + R);
        g.save();
        if (look === "grid") {
          // the lines of the lattice, each piece lit where the wave is passing
          g.lineWidth = Math.max(1, 1.4 * u); g.lineCap = "butt";
          for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
            const d = Math.hypot(x - cx, y + step / 2 - cy), v = litAt(d); if (v <= 0.03) continue;
            g.strokeStyle = hexA(colAt(d, Math.atan2(y - cy, x - cx)), Math.min(1, band * 1.6 * v)); g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + step); g.stroke();
          }
          for (let y = Math.ceil(y0 / step) * step; y < y1; y += step) for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
            const d = Math.hypot(x + step / 2 - cx, y - cy), v = litAt(d); if (v <= 0.03) continue;
            g.strokeStyle = hexA(colAt(d, Math.atan2(y - cy, x - cx)), Math.min(1, band * 1.6 * v)); g.beginPath(); g.moveTo(x, y); g.lineTo(x + step, y); g.stroke();
          }
        } else {
          if (look === "matrix") { g.font = `600 ${Math.round(step * 0.82)}px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "middle"; }
          const tick = Math.floor(sec * 9);
          for (let y = Math.ceil(y0 / step) * step + step / 2; y < y1; y += step) for (let x = Math.ceil(x0 / step) * step + step / 2; x < x1; x += step) {
            const d = Math.hypot(x - cx, y - cy), v = litAt(d); if (v <= 0.03) continue;
            const c = colAt(d, Math.atan2(y - cy, x - cx)), a = Math.min(1, band * 1.5 * v);
            if (look === "squares") { const sz = step * (0.5 + 0.42 * v); g.fillStyle = hexA(c, a); g.fillRect(x - sz / 2, y - sz / 2, sz, sz); }
            else if (look === "matrix") {
              // a character that changes nine times a second; the brightest cells turn white
              const h = Math.sin((Math.round(x / step) * 12.9898 + Math.round(y / step) * 78.233 + tick * 37.719)) * 43758.5453, ch = MATRIX_CHARS[Math.floor((h - Math.floor(h)) * MATRIX_CHARS.length)];
              g.fillStyle = v > 0.8 ? `rgba(255,255,255,${a})` : hexA(c, a); g.fillText(ch, x, y);
            } else { const rad = step * 0.32 * (0.45 + 0.55 * v); g.fillStyle = hexA(c, a); g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); }
          }
        }
        g.restore();
      }
    }
  }
  // the picture alone (a cover without the drawings): its tint, vignette and grain, nothing over it
  if (opt.clean) {
    if ((o.tintAmt || 0) > 0) { g.save(); g.globalCompositeOperation = "soft-light"; g.fillStyle = hexA(o.tintColor || "#2B1B4A", Math.min(1, o.tintAmt * 1.4)); g.fillRect(0, 0, W, H); g.restore(); }
    drawVignette(g, W, H, o.vignette || 0, o.vigColor); drawGrain(g, W, H, o.grain || 0, 0, u);
    g.restore(); return;
  }
  const n = tl.length, C = S.caption || {}, Fnt = FONTS[o.font] || FONTS.geist, ts = o.textSize || 1;
  const sa = safeArea(o.shape), pad = 44 * u, L = Math.max(pad, sa.left * W), T = Math.max(pad, sa.top * H), Rm = Math.max(pad, sa.right * W), B = Math.max(pad * 0.8, sa.bottom * H);
  S._pointText = null;
  // the end card takes the last 3.2 s
  const endA = o.endCard ? ease((sec - (S.total - 3.2)) / 0.8) : 0;
  if (gz) {
    const last = tl[n - 1], fadeEnd = 1 - ease((sec - last.t1) / Math.max(0.5, S.total - last.t1));
    const R = p => Math.max(8 * u, p.r * diag) * (o.placeSize || 1), str = o.strength, beat = clamp(valueAt(S.an, S.an.beat, sec) * (o.react || 0));
    const boostOf = p => (p.section === "climax" ? 1.6 : 1);
    const geo = S.geo(o.lineShape || "straight", o.curve ?? 0.5), eye = geo.at(gz.i + gz.u), exX = X(eye.x), exY = Y(eye.y);
    // spotlight: the rest of the frame darkens around the eye
    if (o.fx.spotlight && str > 0) {
      const rc = R(tl[gz.i]), gr = g.createRadialGradient(exX, exY, rc * 0.9, exX, exY, rc * 2.6 + 0.22 * Math.min(W, H));
      gr.addColorStop(0, hexA(o.spotColor || "#000000", 0)); gr.addColorStop(1, hexA(o.spotColor || "#000000", 0.6 * str * fadeEnd));
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    if (o.patch && !opt.clean) {
      // texture: how strongly the analysis view shows over the picture; soft: how much of the radius
      // fades out towards the edge (0 is a hard disc with a thin ring, 1 fades from the centre)
      const texA = clamp(o.patchOpacity ?? 0.6), soft = clamp(o.patchSoft ?? 0.4);
      const drawPatch = (j, a, lift) => {
        const p = tl[j], key = o.patchMap === "auto" || !o.patchMap ? S.mapOf[j] : o.patchMap, map = key === "picture" ? null : S.maps && S.maps[key];
        const x = X(p.x), y = Y(p.y), r = R(p), anim = o.patchAnim || "both", rises = anim !== "reveal", changes = anim !== "rise";
        const sc = rises ? 1 + 0.1 * lift : 1, up = rises ? 10 * u * lift : 0, rr = r * sc, cy = y - up;
        if (rr < 1) return;
        // the shadow under a rising place: a hard one under a hard disc, a soft blur under a soft one
        if (rises && lift > 0.01) {
          g.save();
          if (soft < 0.15) { g.globalAlpha = a; g.shadowColor = "rgba(0,0,0,0.55)"; g.shadowBlur = 22 * u * lift; g.shadowOffsetY = 10 * u * lift; g.beginPath(); g.arc(x, cy, rr, 0, Math.PI * 2); g.fillStyle = "rgba(0,0,0,0.6)"; g.fill(); }
          else { const sy = cy + 10 * u * lift, gr = g.createRadialGradient(x, sy, rr * (1 - soft) * 0.6, x, sy, rr * 1.2); gr.addColorStop(0, `rgba(0,0,0,${0.45 * a * lift})`); gr.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gr; g.fillRect(x - rr * 1.3, sy - rr * 1.3, rr * 2.6, rr * 2.6); }
          g.restore();
        }
        // the place is drawn on its own small canvas, then its edge is faded with a radial mask
        const D = Math.ceil(2 * rr) + 4, ox = x - rr - 2, oy = cy - rr - 2, pc = patchCanvas(D), pg = pc.getContext("2d");
        pg.setTransform(1, 0, 0, 1, 0, 0); pg.globalCompositeOperation = "source-over"; pg.globalAlpha = 1; pg.clearRect(0, 0, D, D);
        pg.save(); pg.beginPath(); pg.arc(D / 2, D / 2, rr, 0, Math.PI * 2); pg.clip();
        pg.translate(-ox, -oy); pg.translate(x, cy); pg.scale(sc, sc); pg.translate(-x, -y);
        pg.imageSmoothingEnabled = true; pg.imageSmoothingQuality = "high";
        drawPicture(src, pg);
        if (changes && map && texA > 0) { pg.globalAlpha = texA * (lift > 0 ? 0.25 + 0.75 * lift : 0.85); drawPicture(map, pg); }
        pg.restore();
        if (soft > 0.01) {
          const m = pg.createRadialGradient(D / 2, D / 2, rr * (1 - soft), D / 2, D / 2, rr);
          m.addColorStop(0, "rgba(0,0,0,1)"); m.addColorStop(0.5, "rgba(0,0,0,0.6)"); m.addColorStop(1, "rgba(0,0,0,0)");
          pg.globalCompositeOperation = "destination-in"; pg.fillStyle = m; pg.fillRect(0, 0, D, D); pg.globalCompositeOperation = "source-over";
        }
        g.save(); g.globalAlpha = a; g.drawImage(pc, 0, 0, D, D, ox, oy, D, D); g.restore();
        // the thin ring belongs to the hard edge; it fades as the edge softens
        ring(g, x, cy, rr, "#ffffff", 0.5 * a * (1 - soft) * (1 - soft), 1.6 * u);
      };
      // the places already visited keep their texture, flat and quieter
      if (o.patchKeep) for (let j = 0; j < gz.i; j++) if (j !== gz.i) drawPatch(j, 0.55, 0);
      // the current one rises in over 0.45 s and settles back as the eye moves on
      const lift = ease(gz.age / 0.45) * (1 - gz.u);
      if (lift > 0.005) drawPatch(gz.i, Math.min(1, lift * 1.4), lift);
    }
    // the path: the travelled part at its opacity; with "From the start" the part still ahead too.
    // It can be shown only from one second to another, fading in and out over 0.6 s.
    const pathVis = clamp((sec - (o.pathFrom || 0)) / 0.6 + (o.pathFrom ? 0 : 1)) * (o.pathTo > 0 ? 1 - clamp((sec - o.pathTo) / 0.6) : 1);
    const drawn = gz.drawn, dOp = (o.pathDone ?? 1) * pathVis, aOp = (o.path === "all" ? o.pathAhead ?? 0.25 : 0) * pathVis;
    if (o.path !== "off" && n > 1 && pathVis > 0.001) {
      const parts = [];
      if (o.path === "trail") { const j = Math.floor(drawn); if (j > 0) parts.push({ f0: j - 1, f1: j, a: dOp * (1 - ease(gz.age / 1.6)), done: true }); parts.push({ f0: j, f1: drawn, a: dOp, done: true }); }
      // a trail of the last few places only, when asked
      else { parts.push({ f0: o.pathTrail > 0 ? Math.max(0, drawn - o.pathTrail) : 0, f1: drawn, a: dOp, done: true }); if (aOp > 0) parts.push({ f0: drawn, f1: n - 1, a: aOp, done: false }); }
      const pf = o.pathFill || "solid", c2 = o.pathColor2 || o.pointColor;
      const colorAt = pf === "gradient" ? f => mixHex(o.pathColor, c2, f / Math.max(1, n - 1)) : pf === "story" ? f => mixHex(o.pathColor, c2, clamp(((S.sc.points[Math.min(n - 1, Math.floor(f))] || {}).tension ?? 0.6) * 1.4 - 0.4)) : null;
      drawPath(g, geo, X, Y, { ...o, lineWidth: o.lineWidth * (1 + 0.35 * beat) }, u, sec, parts, hexA, colorAt);
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
      // the marker's own opacity (the place the eye is on has its own), how much it is filled, how thick its line
      const am = a * (cur ? clamp(o.placeNowOp ?? 1) : 1), fillK = o.placeFill ?? 1, lineK = o.placeLineW ?? 1;
      if (show && am > 0.005) {
        const pcol = o.climaxOwn && js.some(j => tl[j].section === "climax") ? o.climaxColor || "#FF6B6B" : o.pointColor, ps = o.placeStyle || "ring";
        if (ps === "ring" || ps === "filled" || ps === "dashed") { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = hexA(pcol, Math.min(0.9, (ps === "filled" ? 0.42 : 0.18) * fillK) * am); g.fill(); }
        if (ps === "dashed") { g.save(); g.setLineDash([6 * u, 5 * u]); ring(g, x, y, r, pcol, 0.95 * am, (cur ? 2.6 : 1.8) * u * lineK); g.restore(); }
        else if (ps === "ring" || ps === "filled") ring(g, x, y, r, pcol, 0.95 * am, (cur ? 2.6 : 1.6) * u * lineK);
        else if (ps === "dot") { g.beginPath(); g.arc(x, y, (cur ? 7 : 5) * u, 0, Math.PI * 2); g.fillStyle = hexA(pcol, am); g.fill(); }
        // the place the eye is on can stand out: a soft halo, viewfinder corners or a target
        if (cur && o.placeNow && o.placeNow !== "same") {
          const kind = o.placeNow, breathe = 1 + 0.035 * Math.sin(sec * 3.2) + 0.08 * beat;
          g.save(); g.lineCap = "round";
          if (kind === "halo") {
            const r1 = r * 1.75 * breathe, gr = g.createRadialGradient(x, y, r * 0.8, x, y, r1);
            gr.addColorStop(0, hexA(pcol, 0)); gr.addColorStop(0.22, hexA(pcol, 0.6 * am)); gr.addColorStop(1, hexA(pcol, 0));
            g.fillStyle = gr; g.beginPath(); g.arc(x, y, r1, 0, Math.PI * 2); g.fill();
          } else if (kind === "brackets") {
            const h = r * 1.2 * breathe, arm = h * 0.4; g.strokeStyle = hexA(pcol, am); g.lineWidth = 2.8 * u * lineK; g.beginPath();
            for (const [sx2, sy2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.moveTo(x + sx2 * h, y + sy2 * (h - arm)); g.lineTo(x + sx2 * h, y + sy2 * h); g.lineTo(x + sx2 * (h - arm), y + sy2 * h); }
            g.stroke();
          } else if (kind === "target") {
            const r0 = r * 1.1, r1 = r * 1.38 * breathe; g.strokeStyle = hexA(pcol, am); g.lineWidth = 2.4 * u * lineK; g.beginPath();
            for (let q = 0; q < 4; q++) { const ang = (q * Math.PI) / 2; g.moveTo(x + Math.cos(ang) * r0, y + Math.sin(ang) * r0); g.lineTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1); }
            g.stroke(); ring(g, x, y, r1, pcol, 0.35 * am, 1.2 * u * lineK);
          }
          g.restore();
        }
        const nst = o.numbers === false ? "none" : o.numberStyle || "pill";
        if (nst === "plain") {
          const label = (o.points === "all" ? js : reached.length ? reached : js).map(j => j + 1).join("·");
          g.save(); g.globalAlpha = am; g.font = `600 ${18 * u}px ${FONT_UI}`; g.textAlign = "center"; g.textBaseline = "middle"; g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 6 * u;
          g.fillStyle = pcol; g.fillText(label, x, ps === "dot" ? y - 16 * u : y); g.restore();
        } else if (nst === "pill") {
          const label = (o.points === "all" ? js : reached.length ? reached : js).map(j => j + 1).join("·"); g.font = `600 ${16 * u}px ${FONT_UI}`;
          const tw = Math.max(26 * u, g.measureText(label).width + 14 * u), th = 26 * u;
          g.globalAlpha = am; pill(g, x - tw / 2, y - th / 2, tw, th); g.fillStyle = pcol; g.fill();
          g.fillStyle = "#0B0D11"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, x, y + 0.5 * u);
          g.globalAlpha = 1;
        }
      }
      // label: while the eye is there (fading in 0.35 s, out 0.5 s), or kept at the visited opacity
      if (labelsOn && reached.length) {
        const j = cur ? gz.i : reached[reached.length - 1], text = labelFor(o.labels, j, S.auto, o.labelText, o.labelDetail !== false);
        if (text) {
          // it comes in when the eye arrives and leaves when the eye does, or after its own time
          // (Stays for) if that comes first; kept labels settle at the visited opacity instead
          const inS = Math.max(0.01, o.labelInSecs ?? 0.35), outS = Math.max(0.01, o.labelOutSecs ?? 0.5), hold = o.labelHold || 0, kin = o.labelIn || "rise", kout = o.labelOut || "fade";
          const age = sec - tl[j].t0, left = cur ? -1 : sec - Math.max(...reached.map(q => tl[q].t1)), gone = hold > 0 ? Math.max(left, age - hold) : left;
          const tin = clamp(age / inS), pin = kin === "none" ? 1 : ease(tin), pout = gone > 0 ? (kout === "none" ? 1 : ease(gone / outS)) : 0, rest = o.labelKeep ? doneOp : 0;
          const la = (kin === "type" ? Math.min(1, tin * 4) : pin) * lerp(1, rest, pout);
          // the notes can follow the melody: the last ones played, the newest sliding in
          const tick = o.labels === "notes" && o.labelLive !== false ? tickerAt(S.noteTimes && S.noteTimes[j], sec) : null;
          if (la > 0.01) labelQueue.push({
            text, tick, x, y, r: R(p), a: la * (1 - endA), key: js[0] + 1, n: labelQueue.length,
            dy: (kin === "rise" ? (1 - pin) * 10 : 0) + (kout === "sink" && !rest ? pout * 12 : 0),
            scale: (kin === "pop" ? 0.6 + 0.4 * (1 + 2.2 * (tin - 1) ** 3 + 1.2 * (tin - 1) ** 2) : 1) * (kout === "shrink" && !rest ? 1 - 0.4 * pout : 1),
            chars: kin === "type" ? tin : 1
          });
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
    const lsz = ts * (o.labelSize ?? 1), lpos = o.labelPos || "auto", M = Math.min(W, H);
    // the music moves a label: it grows, or stretches wide or tall, with the beat
    const lbeat = o.labelBeat && o.labelBeat !== "off" ? clamp(valueAt(S.an, S.an.beat, sec)) * (o.labelBeatAmt ?? 0.5) * 0.45 : 0, lfill = o.labelFill || "solid";
    const lpal = [o.labelBg || "#080a0e", o.labelBg2 || o.pathColor, o.pointColor, o.pathColor];
    S._labelHits = [];
    // a label of several lines: the first as before, its details under it, smaller
    const ls = u * lsz, fHead = `600 ${22 * ls}px ${Fnt.css}`, fDet = `500 ${15 * ls}px ${Fnt.css}`;
    g.save(); g.font = fHead; g.textBaseline = "middle";
    for (const q of labelQueue) {
      const lines = q.text.split("\n").map((t, k) => (k === 0 && Fnt.caps ? t.toUpperCase() : t)), nl = lines.length;
      // typed: the characters appear across the lines, in order
      let left = q.chars < 1 ? Math.max(1, Math.ceil(lines.reduce((a, t) => a + t.length, 0) * q.chars)) : Infinity;
      const shown = lines.map(t => { const s = t.slice(0, Math.max(0, left)); left -= t.length; return s; });
      // a following label: the notes in fixed slots as wide as the widest name, so it keeps its size
      const tk = q.tick, slotW = tk ? g.measureText("G#4").width + 12 * ls : 0;
      if (tk) shown[0] = "";
      let wMax = tk ? tk.slots * slotW - 12 * ls : 0; lines.forEach((t, k) => { if (tk && !k) return; g.font = k ? fDet : fHead; wMax = Math.max(wMax, g.measureText(t).width); }); g.font = fHead;
      const tw = wMax + 22 * ls, th = nl === 1 ? 36 * ls : (16 + 24 + 19 * (nl - 1)) * ls, gap = (o.labelLine ? 28 : 10) * u;
      const lineY = k => (nl === 1 ? 1 * u : k === 0 ? -th / 2 + 20 * ls : -th / 2 + (8 + 24 + 19 * (k - 1) + 9.5) * ls);
      // where it sits: where it was dragged to (kept relative to its place), else above the place
      // (below it near the top), or on the side that was asked
      const off = o.labelOff && o.labelOff[q.key];
      let lx = q.x, ly = q.y - q.r - th / 2 - gap, side = "above";
      if (off) { lx = q.x + off.dx * M; ly = q.y + off.dy * M; side = Math.abs(off.dx) > Math.abs(off.dy) ? (off.dx < 0 ? "left" : "right") : off.dy > 0 ? "below" : "above"; }
      else if (lpos === "below" || ((lpos === "auto" || lpos === "above") && ly - th / 2 < T * 0.5)) { ly = q.y + q.r + th / 2 + gap; side = "below"; }
      else if (lpos === "left") { lx = q.x - q.r - tw / 2 - gap; ly = q.y; side = "left"; }
      else if (lpos === "right") { lx = q.x + q.r + tw / 2 + gap; ly = q.y; side = "right"; }
      else if (lpos === "center") { ly = q.y; side = "center"; }
      // it moves in from the side of the place
      if (side === "above") ly += q.dy * u; else if (side === "below") ly -= q.dy * u; else if (side === "left") lx += q.dy * u; else if (side === "right") lx -= q.dy * u; else ly += q.dy * u;
      lx = clamp(lx, tw / 2 + 4 * u, W - tw / 2 - 4 * u); ly = clamp(ly, th / 2 + 4 * u, H - th / 2 - 4 * u);
      const sx = q.scale * (1 + (o.labelBeat === "both" || o.labelBeat === "h" ? lbeat : 0)), sy = q.scale * (1 + (o.labelBeat === "both" || o.labelBeat === "v" ? lbeat : 0));
      // its box on the frame, to drag it on the preview
      S._labelHits.push({ key: q.key, x0: lx - (tw / 2) * sx, x1: lx + (tw / 2) * sx, y0: ly - (th / 2) * sy, y1: ly + (th / 2) * sy, ax: lx, ay: ly, px: q.x, py: q.y });
      g.globalAlpha = q.a;
      const inside = Math.abs(lx - q.x) < (tw / 2) * sx + q.r * 0.3 && Math.abs(ly - q.y) < (th / 2) * sy + q.r * 0.3;
      if (o.labelLine && !inside) {
        // an arrow from the label to its place, wherever the label is: it leaves the edge of the
        // label's box on the way to the place and stops at the edge of the circle
        const ddx = q.x - lx, ddy = q.y - ly, dist = Math.hypot(ddx, ddy) || 1, ux = ddx / dist, uy = ddy / dist;
        const tb = Math.min(Math.abs(ux) > 1e-6 ? ((tw / 2) * sx) / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? ((th / 2) * sy) / Math.abs(uy) : Infinity);
        const ax0 = lx + ux * tb, ay0 = ly + uy * tb, ax1 = q.x - ux * (q.r + 3 * u), ay1 = q.y - uy * (q.r + 3 * u);
        if ((ax1 - ax0) * ux + (ay1 - ay0) * uy > 6 * u) {
          const hd = 9 * u * Math.min(1.4, lsz);
          g.beginPath(); g.moveTo(ax0, ay0); g.lineTo(ax1 - ux * hd * 0.6, ay1 - uy * hd * 0.6); g.lineWidth = 1.6 * u; g.strokeStyle = hexA(o.pointColor, 0.9); g.stroke();
          g.beginPath(); g.moveTo(ax1, ay1); g.lineTo(ax1 - ux * hd - uy * hd * 0.5, ay1 - uy * hd + ux * hd * 0.5); g.lineTo(ax1 - ux * hd + uy * hd * 0.5, ay1 - uy * hd - ux * hd * 0.5); g.closePath(); g.fillStyle = hexA(o.pointColor, 1); g.fill();
        }
      }
      g.save(); g.translate(lx, ly); g.scale(sx, sy);
      // its colour: one, a gradient across it, a colour each, or one that follows the sound
      const bgA = clamp(o.labelBgOp ?? 0.78);
      if (lfill === "gradient") { const gr = g.createLinearGradient(-tw / 2, 0, tw / 2, 0); gr.addColorStop(0, hexA(lpal[0], bgA)); gr.addColorStop(1, hexA(lpal[1], bgA)); g.fillStyle = gr; }
      else if (lfill === "cycle") g.fillStyle = hexA(lpal[(q.key - 1) % lpal.length], bgA);
      else if (lfill === "pulse") g.fillStyle = hexA(mixHex(lpal[0], lpal[1], clamp(valueAt(S.an, S.an.beat, sec) * 1.2)), bgA);
      else g.fillStyle = hexA(lpal[0], bgA);
      pill(g, -tw / 2, -th / 2, tw, th, nl === 1 ? th / 2 : 14 * ls); g.fill();
      g.lineWidth = 1.2 * u; g.strokeStyle = hexA(o.pointColor, 0.8); g.stroke();
      g.fillStyle = o.labelColor || "#fff"; g.textAlign = q.chars < 1 ? "left" : "center";
      const tx = q.chars < 1 ? -tw / 2 + 11 * ls : 0;
      shown.forEach((t, k) => { if (!t) return; g.font = k ? fDet : fHead; g.globalAlpha = q.a * (k ? 0.82 : 1); g.fillText(t, tx, lineY(k)); });
      if (tk) {
        // the row of notes: the newest in full, the older ones fainter; when the row is full a new
        // note pushes it left and the oldest fades out at the left edge
        const e = ease(tk.u), nn = tk.names.length, x0 = -tw / 2 + 11 * ls + (slotW - 12 * ls) / 2, y0 = lineY(0);
        g.save(); g.beginPath(); g.rect(-tw / 2 + 4 * ls, y0 - 16 * ls, tw - 8 * ls, 32 * ls); g.clip();
        g.font = fHead; g.textAlign = "center";
        tk.names.forEach((name, i) => {
          const back = nn - 1 - i, slot = tk.full ? tk.slots - 1 - back + (1 - e) : i;
          let al = back === 0 ? (tk.full ? e : 0.35 + 0.65 * e) : Math.max(0.3, 0.8 - 0.1 * (back - 1));
          if (tk.full && back === tk.slots) al *= 1 - e;
          if (al <= 0.01) return;
          g.globalAlpha = q.a * al; g.fillText(Fnt.caps ? name.toUpperCase() : name, x0 + slot * slotW, y0);
        });
        g.restore(); g.globalAlpha = q.a;
      }
      g.font = fHead; g.globalAlpha = q.a;
      g.restore();
    }
    g.restore();
    if (o.caption === "points" && C.point && sec < last.t1 && endA < 1) S._pointText = { text: C.point(gz.i), a: ease(gz.age / 0.4) * (1 - endA) };
    else S._pointText = null;
  }
  if ((o.tintAmt || 0) > 0) { g.save(); g.globalCompositeOperation = "soft-light"; g.fillStyle = hexA(o.tintColor || "#2B1B4A", Math.min(1, o.tintAmt * 1.4)); g.fillRect(0, 0, W, H); g.restore(); }
  drawVignette(g, W, H, o.vignette || 0, o.vigColor);
  // the sound display (overview bars, live spectrum, live waveform or a progress line), drawn in its
  // own frame: along the bottom, the top, through the centre or up a side, its length, height,
  // opacity, distance from the edge and which way it grows all chosen in the Effects and sound group
  const prog = clamp(sec / S.total), vert = (o.barOrient || (o.barPos === "left" || o.barPos === "right" ? "v" : "h")) === "v";
  const span = vert ? H - T - B : W - L - Rm, bw0 = span * clamp(o.barLength ?? 1, 0.1, 1), hMax = 60 * u * (o.barSize ?? 1), x0 = 0;
  const dir = o.barDir || "up";
  // its colour: one colour, a gradient from left to right, or a colour that follows the sound
  // (from the first colour when quiet to the second when loud)
  const cA = o.bottomColor || o.pointColor, cB = o.bottomColor2 || o.pathColor, fill = o.bottomFill || "solid";
  const level = valueAt(S.an, S.an.rms, sec), punch = clamp(Math.max(level, valueAt(S.an, S.an.beat, sec)));
  let grad = null;
  if (fill === "gradient") { grad = g.createLinearGradient(x0, 0, bw0, 0); grad.addColorStop(0, hexA(cA, 0.95)); grad.addColorStop(1, hexA(cB, 0.95)); }
  // the colour of a part whose own level is e (a bar's height; the loudness for lines)
  const paint = e => (grad ? grad : fill === "reactive" ? hexA(mixHex(cA, cB, clamp(0.55 * e + 0.45 * punch)), 0.95) : hexA(cA, 0.95));
  const glow = fill === "reactive" ? mixHex(cA, cB, punch) : cA;
  // a bar of height h at x: up from the base, down from it, or centred on it
  // thickness of its bars or line, how tall the sound makes it (it may go past its own height),
  // the spacing of the bars, and round ends
  const bThick = clamp(o.barThick ?? 1, 0.2, 4), bGain = clamp(o.barGain ?? 1, 0.2, 5), bGap = clamp(o.barGap ?? 1, 0, 4), bRound = !!o.barRound;
  const bar = (x, w, h) => { const y = dir === "mirror" ? -h / 2 : -h; if (bRound && g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, Math.min(w, h) / 2); g.fill(); } else g.fillRect(x, y, w, h); };
  let bottomH = 0; S._barHit = null;
  if (o.bottom && o.bottom !== "none") {
    g.save(); g.globalAlpha = clamp(o.barOpacity ?? 1);
    const thick = o.bottom === "line" ? 8 * u : o.bottom === "spectrum" ? hMax * 1.2 : hMax;
    // its centre: where it was dragged, else along the bottom (horizontal) or up the right side
    const cx = o.barXY ? o.barXY.x * W : vert ? W - Rm - thick / 2 : W / 2, cy = o.barXY ? o.barXY.y * H : vert ? H / 2 : H - B - thick / 2;
    // its box on the frame, to drag it on the preview
    S._barHit = vert ? { x0: cx - thick / 2, x1: cx + thick / 2, y0: cy - bw0 / 2, y1: cy + bw0 / 2, ax: cx, ay: cy } : { x0: cx - bw0 / 2, x1: cx + bw0 / 2, y0: cy - thick / 2, y1: cy + thick / 2, ax: cx, ay: cy };
    // the frame: x along the display, y = 0 on its base line, the bars toward negative y
    g.translate(cx, cy); if (vert) g.rotate(-Math.PI / 2); g.translate(-bw0 / 2, 0);
    if (dir === "up") g.translate(0, thick / 2);
    else if (dir === "down") { g.translate(0, -thick / 2); g.scale(1, -1); }
    if (o.bottom === "bars") {
      const env = S.an && S.an.source === "audio" ? S.an.env : S.env, bw = 6 * u * bThick, gap = 4 * u * bGap, nb = Math.max(8, Math.floor((bw0 + gap) / (bw + gap)));
      for (let b = 0; b < nb; b++) {
        const e = env[Math.min(env.length - 1, Math.floor((b / nb) * env.length))], h = Math.max(3 * u, e * hMax * bGain);
        // the bars already played take the colour; with "follows the sound", by their own height
        g.fillStyle = (b + 0.5) / nb <= prog ? (fill === "reactive" ? hexA(mixHex(cA, cB, e), 0.95) : paint(e)) : "rgba(255,255,255,0.32)";
        bar(x0 + b * (bw + gap), bw, h);
      }
    } else if (o.bottom === "spectrum") {
      const bands = bandsAt(S.an, sec), nb = BANDS, step = bw0 / nb, bw = step * clamp(0.62 * bThick, 0.06, 1);
      g.shadowColor = hexA(glow, 0.8); g.shadowBlur = 10 * u;
      for (let b = 0; b < nb; b++) {
        // without the rendered sound: a shape from the loudness, until the analysis is ready
        const e = bands ? bands[b] : level * (0.55 + 0.45 * Math.sin(b * 0.9 + sec * 6)) * (1 - b / nb * 0.6);
        g.fillStyle = paint(e); bar(x0 + b * step + (step - bw) / 2, bw, Math.max(3 * u, e * hMax * 1.2 * bGain));
      }
    } else if (o.bottom === "wave") {
      const wv = S.an && S.an.wave ? S.an.wave(sec, 220) : null, mid = dir === "mirror" ? 0 : -hMax / 2;
      g.lineWidth = 2.4 * u * bThick; g.lineCap = bRound ? "round" : "butt"; g.strokeStyle = paint(level); g.shadowColor = hexA(glow, 0.8); g.shadowBlur = 8 * u; g.lineJoin = "round";
      g.beginPath();
      for (let i = 0; i < 220; i++) {
        const sv = (wv ? clamp(wv[i] * 2.2, -1, 1) : level * Math.sin(i * 0.35 + sec * 20) * Math.sin((i / 219) * Math.PI)) * bGain;
        const x = x0 + (i / 219) * bw0, y = mid - sv * hMax / 2;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    } else if (o.bottom === "line") {
      g.fillStyle = "rgba(255,255,255,0.3)"; bar(x0, bw0, 4 * u * bThick);
      g.fillStyle = paint(level); bar(x0, bw0 * prog, 4 * u * bThick);
    }
    g.restore();
    // the text at the bottom keeps clear of a display left along the bottom
    if (!vert && !o.barXY) bottomH = thick;
  }
  const baseY = H - B;
  // the Lux Sonora logo: its picture frame, mountains and sun, and six sound waves that move with
  // the music (the spectrum, low to high) when animated; placed top right until it is dragged
  S._logoHit = null;
  if (o.logo) {
    const s = ((o.logoSize ?? 1) * 0.09 * Math.min(W, H)) / 90, cx = o.logoXY ? o.logoXY.x * W : W - Rm - 51 * s, cy = o.logoXY ? o.logoXY.y * H : T + 45 * s;
    S._logoHit = { x0: cx - 51 * s, x1: cx + 51 * s, y0: cy - 45 * s, y1: cy + 45 * s, ax: cx, ay: cy };
    if (!LOGO_PATHS) LOGO_PATHS = LOGO_D.map(d => new Path2D(d));
    const bands = o.logoAnim ? bandsAt(S.an, sec) : null, lvl = o.logoAnim ? clamp(valueAt(S.an, S.an.rms, sec)) : 0;
    g.save(); g.globalAlpha = clamp(o.logoOpacity ?? 0.85) * (1 - endA * 0.5);
    g.translate(cx - 51 * s, cy - 45 * s); g.scale(s, s);
    g.strokeStyle = o.logoColor || "#FFFFFF"; g.lineWidth = 5; g.lineCap = "round"; g.lineJoin = "round";
    for (const p of LOGO_PATHS) g.stroke(p);
    g.beginPath(); g.arc(37.914, 24.302, 7.973, 0, Math.PI * 2); g.stroke();
    LOGO_WAVES.forEach(([x, y0, len], i) => {
      let k = 1;
      if (o.logoAnim) {
        // the band's share of the spectrum, or the loudness until the sound is analysed
        let e = lvl;
        if (bands) { const a = Math.floor((i / 6) ** 1.6 * BANDS), b = Math.max(a + 1, Math.floor(((i + 1) / 6) ** 1.6 * BANDS)); e = 0; for (let j = a; j < b && j < BANDS; j++) e = Math.max(e, bands[j]); }
        k = 0.33 + 0.92 * Math.pow(clamp(e), 1.2);
      }
      const mid = y0 + len / 2, h = (len * k) / 2;
      g.beginPath(); g.moveTo(x, mid - h); g.lineTo(x, mid + h); g.stroke();
    });
    g.restore();
  }
  // text: the title (always, or the first seconds), the point line, the end card
  // the line under the title: the style, key and tempo, the user's own text, or nothing
  const sub = o.subtitle === "none" ? "" : o.subtitle === "custom" ? (o.subText || "").trim() : C.sub || "";
  const title = C.title ? (Fnt.caps || o.caps ? C.title.toUpperCase() : C.title) : "";
  const tA = (o.caption === "none" ? 0 : opt.noCover ? 1 : o.titleWhen === "intro" ? ease((sec - 0.2) / 0.6) * (1 - ease((sec - (o.titleSecs ?? 4.5)) / 1)) : 1) * (1 - endA);
  const tSize = (Fnt.caps ? 58 : 44) * u * ts, sSize = 22 * u * ts;
  S.hit = {};
  if (S._barHit && o.bottom && o.bottom !== "none") S.hit.bar = S._barHit;
  if (S._logoHit) S.hit.logo = S._logoHit;
  if (S._labelHits && S._labelHits.length && o.labels && o.labels !== "off") S.hit.labels = S._labelHits;
  // how the title comes in: fade, rise, typed letter by letter, or at once
  const inP = clamp((sec - 0.2) / 0.9), anim = o.titleAnim || "fade";
  const shownTitle = anim === "type" ? title.slice(0, Math.ceil(title.length * clamp((sec - 0.2) / 1.4))) : title;
  // with "Always" the title still comes in at the start (with "First seconds" it fades in anyway)
  const animA = o.titleWhen === "always" && anim !== "none" && anim !== "type" ? ease(inP) : 1;
  const rise = (anim === "rise" ? 1 - ease(inP) : 0) * 26 * u;
  if (tA > 0.01 && (title || sub)) {
    let x = L, y = T + tSize, align = "left";
    if (o.titleXY) { x = o.titleXY.x * W; y = o.titleXY.y * H; align = o.titleAlign || "left"; }
    else if (o.titlePos === "tc") { x = W / 2; align = "center"; }
    else if (o.titlePos === "center") { x = W / 2; y = H / 2; align = "center"; }
    else if (o.titlePos === "bl") y = baseY - bottomH - 18 * u - sSize * 1.5;
    if (!o.titleXY && o.titleAlign && o.titleAlign !== "auto") { align = o.titleAlign; x = align === "center" ? W / 2 : align === "right" ? W - Rm : L; }
    const box = textBlock(g, [{ text: shownTitle, measure: title, font: `${Fnt.weight} ${tSize}px ${Fnt.css}`, size: tSize, color: o.titleColor || "#fff", dy: 0 },
      { text: sub, font: `450 ${sSize}px ${FONT_UI}`, size: sSize, color: hexA(o.subColor || "#ffffff", 0.85), dy: sSize * 1.5 }], x, y + rise, align, tA * animA, o, u, W - L - Rm);
    if (box) S.hit.title = { ...box, ax: x, ay: y, align };
  }
  if (S._pointText && S._pointText.a > 0.01) {
    const top = o.titlePos === "bl";
    let x = L, y = top ? T + 26 * u * ts : baseY - bottomH - 16 * u, align = "left";
    if (o.pointXY) { x = o.pointXY.x * W; y = o.pointXY.y * H; align = o.pointAlign || "left"; }
    const box = textBlock(g, [{ text: S._pointText.text, font: `550 ${26 * u * ts}px ${FONT_UI}`, size: 26 * u * ts, color: o.subColor || "#fff", dy: 0 }], x, y, align, S._pointText.a, o, u, W - L - Rm);
    if (box) S.hit.point = { ...box, ax: x, ay: y, align };
  }
  // guides while a text is dragged on the preview
  if (opt.preview && S.guides) {
    g.save(); g.strokeStyle = "rgba(120,220,255,0.9)"; g.lineWidth = 1.5 * u; g.setLineDash([6 * u, 5 * u]);
    for (const gd of S.guides) { g.beginPath(); if (gd.x !== undefined) { g.moveTo(gd.x * W, 0); g.lineTo(gd.x * W, H); } else { g.moveTo(0, gd.y * H); g.lineTo(W, gd.y * H); } g.stroke(); }
    g.restore();
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
  // fades from and to black (with a cover, the video starts from the cover instead)
  const withCover = !opt.noCover && hasCover(S);
  const fa = fadeAt(sec, S.total, withCover ? 0 : o.fadeIn || 0, o.fadeOut || 0);
  if (fa > 0) { g.fillStyle = `rgba(0,0,0,${fa})`; g.fillRect(0, 0, W, H); }
  if (withCover) {
    // the cover is held, then gives way over its own time: a fade, a slow zoom into the picture
    // while it fades, a circle that opens from the first place, or a plain cut
    const hold = o.coverHold ?? 0.5, kind = o.coverOut || "fade", xf = kind === "cut" ? 0 : Math.max(0.1, o.coverFade ?? 1.2), tt = sec <= hold + 1e-9 ? 0 : xf > 0 ? clamp((sec - hold) / xf) : 1, e2 = ease(tt);
    if (tt < 1) {
      const cc = coverCanvas(S, W, H);
      if (cc) {
        g.save();
        if (kind === "zoom") { const z = 1 + 0.12 * e2; g.globalAlpha = 1 - e2; g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2); g.drawImage(cc, 0, 0, W, H); }
        else if (kind === "iris") {
          // the video shows through a growing circle centred on the first place; the cover stays outside it
          const p0 = tl[0], cx = p0 ? X(p0.x) : W / 2, cy = p0 ? Y(p0.y) : H / 2, far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
          g.beginPath(); g.rect(0, 0, W, H); g.arc(cx, cy, far * e2, 0, Math.PI * 2, true); g.clip("evenodd"); g.drawImage(cc, 0, 0, W, H);
        } else { g.globalAlpha = 1 - e2; g.drawImage(cc, 0, 0, W, H); }
        g.restore();
      }
    }
  }
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
  // the graphics card's encoder first (several times faster), then the browser's own
  for (const hw of ["prefer-hardware", null]) for (const [mux, codec] of container === "webm" ? WEBM_VIDEO : MP4_VIDEO) {
    const config = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: "quality", ...(hw ? { hardwareAcceleration: hw } : {}), ...(mux === "avc" ? { avc: { format: "avc" } } : {}) };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return { mux, codec, config, hardware: !!hw }; } catch (e) { /* next */ }
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
  return { blob: new Blob([target.buffer], { type: webm ? "video/webm" : "video/mp4" }), codec: vc.codec, hardware: !!vc.hardware, audio: ac ? ac.codec : null };
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
