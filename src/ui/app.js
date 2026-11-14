// User interface: state, level-based recomputation, stage, inspector, timeline, playback, export.
import { clamp, lerp } from "../core/util.js";
import { analyze } from "../core/analyze.js";
import { computeSaliency } from "../core/saliency.js";
import { gazePath, readPoints, coverage, backgroundZone, saliencyAt, newId, DEFAULT_RADIUS } from "../core/focus.js";
import { hashBytes } from "../core/util.js";
import { clusterRegions, buildMotifs } from "../core/motifs.js";
import { setSpelling, pcName, midiName, MODES, STYLES, RULES, CAT, LAYERS, LAYER_NAME, PERC_NAME, NOTE_SH, NOTE_FL } from "../core/theory.js";
import { DIMS, DIM_NAME, DIM_SOURCE } from "../core/timbre.js";
import { compose, romanOf, SCORE_VERSION } from "../core/compose.js";
import { RULES_INFO, RULE_GROUPS, defaultRules } from "../core/rules.js";
import { CONDITIONS, ACTIONS, SECTIONS, COLOURS, newRule, pointMatches, describeRule } from "../core/expert.js";
import { suggestStyles, explainStyles } from "../core/suggest.js";
import { saveSession, loadSession } from "./session.js";
import { midiFile } from "../export/midi.js";
import { zipStore } from "../export/wavzip.js";
import { buildGraph, updateGraph, playNote, renderOffline, loudnessGain, defaultMix, audible, defaultFx, preview, scheduleExpression } from "../audio/engine.js";
import { perform, PERFORM_DEFAULTS } from "../core/perform.js";
import { initSound } from "./sound.js";
import { drawDemo } from "./demo.js";
import { ingestFile, cancelIngest, fromRGBA8 } from "../ingest/index.js";
import { cropFloat, resampleFloat, fitSize } from "../ingest/resample.js";
import { processImage, stats, dataRange, DEFAULT_SOURCE } from "../ingest/tone.js";
import { makeSlider, makeSeg } from "./controls.js";
import { openInfo, openPicker } from "./picker.js";
import { modelApi, improvApi, grooveApi, MODEL_URL, IMPROV_URL, GROOVE_URL } from "../ml/magenta.js";
import { PLACEMENTS, isNeural, attentionMap, regionMeans, scanPath } from "../core/placement.js";
import { objectsMap, learnedMap, dequantize, COCO_URL, MSI_URL } from "../ml/vision.js";
import pkg from "../../package.json";
const APP_VERSION = pkg.version, APP_NAME = "Lux Sonora", APP_NAMES = ["Lux Sonora", "Sonification"];
import { improvMelody } from "../ml/improv.js";
import { grooveFor, applyGroove, grooveKey } from "../ml/groove.js";
import { prepareSamples, kitSpecs, STYLE_KIT, onSampleStatus, instrumentCatalog } from "../audio/samples.js";
import { addToLibrary, LIBRARY } from "../core/instruments.js";
import { ROLES, ROLE_COLOR, ORCHESTRATION, roleInstrument, STYLE_BAND, roleFor, autoLayers, richnessOf } from "../core/arrange.js";
import { KITS, kitCatalog } from "../audio/samples.js";
import { defaultEq, styleFx } from "../audio/fx.js";
import { storyMelody, applyStory, storyKey } from "../ml/story.js";
import { SECTION_NAME } from "../core/arc.js";
import { CONNECT } from "../core/passages.js";
import { HARM_NAME, BASS_NAME } from "../core/patterns.js";
import { AUDIO_FORMATS, encodeAudio, masterGain, wavEncode } from "../export/audio.js";
import { defaultVideo, frameSize, videoScene, drawVideoFrame, encodeVideo, encodeGif, gifRange, posterPng, hasCover } from "../export/video.js";
import { editCanvas, editCanvasAsync, ensureFont, fadeAudio, QUALITY, safeArea } from "../export/look.js";
import { analyzeAudio } from "../export/reactive.js";
import { autoLabels } from "../export/labels.js";
import qrUrl from "../assets/instagram-qr.webp";
import LOGO from "../assets/logo.svg?raw";
import { initExport } from "./exportTab.js";

/* ============ state ============ */
const $ = s => document.querySelector(s);
const LV = { AUDIO: 0, MUSIC: 1, PATH: 2, SAL: 3, IMAGE: 4 };
const P = {
  style: "ambient", duration: 30, count: 8, returns: 3, inhibition: 0.18, memory: 0.05, seed: 0, radius: DEFAULT_RADIUS,
  wColor: 0.7, wTex: 0.5, wSem: 0.6, fidelity: 0.6, tempoAdj: 0, timbre: 1, reverb: 0.6,
  smooth: 0.6, arc: 0.7, melody: "classic", connect: "light", groove: "straight", placement: "contrast", orch: "small", layers: [], samples: true, kit: "style", keyMode: "auto", keyPc: 0, scale: "auto", octave: 0, range: 2,
  rules: defaultRules(),
  expert: [],
  // the circles: each one sized from the spot it reads ("area"), or all the same ("same")
  circleSize: "area",
  // Advanced: composition (chord changes, swing, how the layers build up, contrast) and performance (perform.js)
  chordRate: 1, swingAdj: 1, buildUp: 0.5, contrastThr: 0.45,
  // the generated intro and ending: "off", 1 or 2 bars, or "auto"
  intro: "auto", end: "auto",
  ...PERFORM_DEFAULTS,
  mix: defaultMix(),
  instruments: {},
  fx: defaultFx(),
  src: structuredClone(DEFAULT_SOURCE),
  out: { format: "wav16", kbps: 320 },
  video: defaultVideo()
};
let SRC = null, IMG = null, A = null, SAL = null, POINTS = null, CL = null, MOT = null, SCORE = null, SEM = null, COV = null;
// The gaze path: generated (auto), a user-owned list (manual), or user anchors with
// automatic points around them (mixed). Edits push the previous state on an undo stack.
const PATH = { mode: "auto", points: [] };
let HIST = [], FUT = [], tool = "select";
let SEL = 0, view = "img", showPath = true, dirty = 0, raf = 0;
const SEM_CACHE = new Map(), SL = {};
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const CLUSTER_COL = ["#F2B145", "#5FA8E8", "#E07A8F", "#6CC4A1", "#B79CF0", "#E8D36A"];
const DURATIONS = [15, 30, 60];
const ACCENTS = [["violet", "#6D5DF0"], ["blue", "#2F6FEB"], ["teal", "#0F9D86"], ["amber", "#D9861A"], ["rose", "#E0457B"], ["graphite", "#3B4352"]];

/* ============ formatting ============ */
const nf = (x, d = 2) => Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const nf1 = x => nf(x, Math.abs(x - Math.round(x)) < 1e-9 ? 0 : 1);
const fsec = s => (s < 1 ? Math.round(s * 1000) + " ms" : nf(s, s < 10 ? 2 : 1) + " s");
const fhz = h => (h < 1000 ? Math.round(h) + " Hz" : nf(h / 1000, 1) + " kHz");
const ftime = s => { s = Math.max(0, s); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ordinal = v => ["first visit", "second visit", "third visit"][v] || `visit ${v + 1}`;
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const store = {
  get(k) { try { return localStorage.getItem("sonification." + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("sonification." + k, v); } catch (e) { /* storage unavailable */ } }
};
const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
  listen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>'
};

/* ============ image loading ============ */
// BASE is the working image (≤ 2048 px, linear light or raw data units); the analysis
// source settings turn it into the displayed image (SRC) and the analysed image (IMG).
let BASE = null, INFO = null, STATS = null, srcRaf = 0, LUM = null;
const ANALYSIS_MAX = 200;
function setBase(base, info) {
  BASE = base; INFO = info; STATS = null;
  INFO.hash = hashBytes(new Uint8Array(base.data.buffer, base.data.byteOffset, base.data.byteLength));
  PATH.mode = "auto"; PATH.points = []; HIST = []; FUT = [];
  stopPlayback(); Player.pausedBeat = 0; SEL = 0;
  renderImageInfo(); syncSourceControls(); applySource();
}
function scheduleSource() { if (!srcRaf) srcRaf = requestAnimationFrame(() => { srcRaf = 0; applySource(); }); }
function applySource() {
  if (!BASE) return;
  const src = P.src, cr = cropFloat(BASE.data, BASE.w, BASE.h, BASE.ch, src.crop);
  let range = null;
  if (BASE.kind === "data") {
    const key = JSON.stringify([src.crop, src.lo, src.hi]);
    if (!STATS || STATS.key !== key) STATS = { key, st: stats(cr.data, BASE.ch, src.lo, src.hi) };
    range = dataRange(INFO, STATS.st, src);
  }
  const disp = processImage(cr.data, cr.w, cr.h, BASE.ch, BASE.kind, range, src);
  SRC = document.createElement("canvas"); SRC.width = cr.w; SRC.height = cr.h;
  SRC.getContext("2d").putImageData(new ImageData(disp, cr.w, cr.h), 0, 0);
  const a = fitSize(cr.w, cr.h, ANALYSIS_MAX), aw = Math.max(16, a.w), ah = Math.max(16, a.h);
  const af = resampleFloat(cr.data, cr.w, cr.h, BASE.ch, Math.min(aw, cr.w), Math.min(ah, cr.h));
  const ab = processImage(af, Math.min(aw, cr.w), Math.min(ah, cr.h), BASE.ch, BASE.kind, range, src);
  IMG = new ImageData(ab, Math.min(aw, cr.w), Math.min(ah, cr.h));
  renderRangeNote(range);
  // luminance at up to 1024 px for texture wavetables (the processed image, as the analysis sees it)
  const lw = fitSize(cr.w, cr.h, 1024), lumSrc = new Float32Array(cr.w * cr.h);
  for (let p = 0; p < lumSrc.length; p++) lumSrc[p] = (0.2126 * disp[p * 4] + 0.7152 * disp[p * 4 + 1] + 0.0722 * disp[p * 4 + 2]) / 255;
  LUM = { w: lw.w, h: lw.h, data: resampleFloat(lumSrc, cr.w, cr.h, 1, lw.w, lw.h) };
  invalidate(LV.IMAGE);
}
const DEMOS = { lac: "Lake sunset", oras: "City at night" };
function loadDemo(kind) {
  ORIG = { demo: kind };
  const c = drawDemo(kind), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  setBase(fromRGBA8(d, c.width, c.height), { name: kind === "lac" ? "Lake sunset" : "City at night", format: "Generated", w: c.width, h: c.height, bits: 8, sampleFormat: 1, spp: 3, kind: "photo", description: "8-bit demo image", bytes: 0, mp: (c.width * c.height) / 1e6, pages: 1 });
}
function showLoading(on, text = "", p = 0) {
  const el = $("#loading"); el.hidden = !on;
  if (on) { $("#loadingText").textContent = text; $("#loadingBar").style.width = Math.round(p * 100) + "%"; }
}
async function loadFile(file) {
  if (!file) return;
  const mb = file.size / 1e6, label = `Decoding ${file.name}`;
  showLoading(true, label, 0);
  try {
    const { info, base } = await ingestFile(file, p => showLoading(true, label, p));
    showLoading(false);
    $("#demo").value = "";
    ORIG = { file };
    setBase(base, info);
    NEW_SONG_PENDING = true; // once the image is analysed, the New song dialog opens
    if (info.large) flash(`Large image (${info.mp.toFixed(0)} MP, ${mb.toFixed(0)} MB): it was reduced to ${base.w} × ${base.h} for display and analysis.`);
    if (info.pages > 1) flash(`This TIFF has ${info.pages} pages; the first one is used.`);
  } catch (e) {
    showLoading(false);
    if (e.code !== "cancelled") flash(e.message || "The image couldn't be read. Try another file.");
  }
}
function flash(msg) { const el = $("#flash"); el.textContent = msg; el.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => (el.hidden = true), 6000); }

/* ============ recomputation ============ */
const OV = { edge: null, reg: null, sal: null, cov: null };
function invalidate(l) { dirty = Math.max(dirty, l); if (!raf) raf = requestAnimationFrame(recompute); }
function recompute() {
  raf = 0; const lvl = dirty; dirty = 0;
  if (!IMG) return;
  if (lvl >= LV.IMAGE) {
    A = analyze(IMG); CL = clusterRegions(A, 6); MOT = buildMotifs(CL, A.regions);
    SEM = null; buildStaticOverlays();
  }
  if (lvl >= LV.SAL) { SAL = attention(computeSaliency(A, { color: P.wColor, texture: P.wTex, semantic: SEM ? P.wSem : 0 }, SEM)); buildSalOverlay(); }
  if (lvl >= LV.PATH) {
    const pp = { count: P.count, returns: P.returns, inhibition: P.inhibition, memory: P.memory, seed: P.seed, radius: P.radius, sizing: P.circleSize || "same" };
    let raw;
    if (PATH.mode === "manual") raw = PATH.points.map((q, i) => ({ ...q, s: saliencyAt(A, SAL.map, q.x, q.y), source: "manual", revisitOf: null, index: i }));
    else if (P.placement === "scan") raw = scanPath(A, SAL.map, P.count, P.radius, newId);
    else raw = gazePath(A, SAL.map, pp, PATH.mode === "mixed" ? PATH.points.map(q => ({ ...q, s: saliencyAt(A, SAL.map, q.x, q.y) })) : []);
    POINTS = readPoints(A, CL, raw);
    COV = coverage(A, POINTS); COV.zone = backgroundZone(A, COV); buildCovOverlay();
  }
  if (lvl >= LV.MUSIC) {
    // objects found by the Objects placement colour the timbre of the places on them
    const semEff = SEM || (ATTN.objects && ATTN.objects.length ? { objects: ATTN.objects, valence: null, energy: null } : null);
    SCORE = compose({ A, sal: SAL, points: POINTS, cl: CL, motifs: MOT, P, sem: semEff, cov: COV, lum: LUM });
    ensureLayerState(SCORE); renderOrch(); renderExpert(); renderStyleSuggest();
    storyStep();
    grooveStep();
    // how it is played: dynamics from the image, accents, phrasing, CC curves, humanize
    perform(SCORE, P, A);
    preloadSamples();
    setSpelling(SCORE.pc);
    if (SEL >= SCORE.points.length) SEL = 0;
    renderPieceNotes(); renderGlobal(); renderPoint(); renderLanes(); if (SOUND) SOUND.render(); syncPathUI(); scheduleRestart();
    if (EXPORT) { refreshLabels(); scheduleAnalysis(); }
  }
  drawAll();
  refreshStatus();
  checkRecipe();
  scheduleSave();
  if (NEW_SONG_PENDING && A && !document.querySelector(".dlg-backdrop")) { NEW_SONG_PENDING = false; openNewSong(true); }
  // Play pressed while a neural model was still working: start now that the piece is final
  if (WAIT_PLAY && SCORE && !jobsPending() && !dirty) { WAIT_PLAY = false; startPlayback(Player.pausedBeat >= SCORE.total ? 0 : Player.pausedBeat); }
  updatePlayBtn();
}
/* ============ Simple / Advanced, one status line, why a point sounds as it does ============ */
const UI = { mode: store.get("uiMode") || "simple", samples: 0, failed: false };
function applyUiMode(m) {
  UI.mode = m; store.set("uiMode", m);
  document.documentElement.classList.toggle("ui-simple", m === "simple");
  document.documentElement.classList.toggle("ui-expert", m === "expert");
  if (UI_SEG) UI_SEG.set(m);
  requestAnimationFrame(() => { drawAll(); });
}
// one place that says what is downloading (instruments and models), next to Export
function refreshStatus() {
  const st = $("#exportStatus"); if (st.dataset.busy) return;
  const parts = [];
  if (UI.samples) parts.push(`instruments (${UI.samples})`);
  if (STORY.job) parts.push(P.melody === "improv" ? "the improvisation model" : "the melody model");
  if (GROOVE.job) parts.push("the groove model");
  if (ATTN.job) parts.push(P.placement === "objects" ? "the object detector" : "the saliency model");
  st.classList.toggle("busy", parts.length > 0);
  st.textContent = parts.length ? "Loading " + parts.join(", ") + "…" + (WAIT_PLAY ? " The song starts as soon as it's ready." : "") : UI.failed ? "Some instruments couldn't load, so you're hearing synthesized versions of them." : "";
  renderModelLoad();
}
// The bar under the top bar while an AI model downloads or works, so it is clear the app is busy,
// not stuck: which model, its size, and how far it has got when that is known.
function renderModelLoad() {
  const box = $("#modelLoad"); if (!box) return;
  let text = "", frac = null;
  if (STORY.job) {
    const M = P.melody === "improv" ? ["Magenta ImprovRNN", "about 6 MB", "Improvising the melody"] : ["Magenta MusicVAE", "about 18 MB", "Composing the melody"];
    if (STORY.phase === "run") { text = `${M[2]} with ${M[0]}`; frac = STORY.progress; } else text = `Loading the melody model (${M[0]}, ${M[1]}, only the first time)`;
  } else if (GROOVE.job) text = GROOVE.phase === "run" ? "Playing the drums with Magenta GrooVAE" : "Loading the groove model (Magenta GrooVAE, about 15 MB, only the first time)";
  else if (ATTN.job) text = P.placement === "objects" ? "Loading the object detector (COCO-SSD, about 5 MB, only the first time)" : "Loading the saliency model (MSI-Net, about 25 MB, only the first time)";
  box.hidden = !text;
  if (!text) return;
  $("#modelLoadText").textContent = text + (WAIT_PLAY ? ". The song starts as soon as it's ready." : "…");
  const fill = $("#modelLoadFill");
  box.classList.toggle("indeterminate", frac === null || frac === undefined);
  fill.style.width = frac === null || frac === undefined ? "" : Math.round(Math.max(0.04, frac) * 100) + "%";
}
// a line over the stage saying how the selected point's area becomes sound
function renderWhy() {
  const el = $("#pointWhy");
  if (!SCORE || !SCORE.points.length || !showPath || exportView()) { el.hidden = true; return; }
  const F = SCORE.points[SEL], m = F.tim.m, parts = [];
  parts.push(F.y < 0.34 ? "high in the image → high notes" : F.y > 0.66 ? "low in the image → low notes" : "middle height → middle register");
  if (m.leg > 0.3) parts.push("smooth area → long, legato notes"); else if (m.leg < -0.3) parts.push("busy edges → shorter notes, more drum hits");
  if (m.att < -0.3) parts.push("sharp edges → fast attack");
  if (m.bri > 0.3) parts.push("complex texture → brighter sound"); else if (m.bri < -0.3) parts.push("plain texture → darker sound");
  if (m.res > 0.3) parts.push("vivid colour → resonant tone");
  if (m.col > 0.3) parts.push("warm colours → richer harmonics"); else if (m.col < -0.3) parts.push("cool colours → purer tone");
  // the composition rules that touched this point
  if (F.modulation) parts.unshift(`not the colour of the rest of the picture → the key moves ${F.modulation.dir > 0 ? "up" : "down"} a fifth, to ${pcName(F.modulation.keyPc)}`);
  if (SCORE.picardy && F.idx === SCORE.points.length - 1) parts.unshift("a bright last place → the minor piece ends on a major chord");
  // the Expert rules that apply here
  (P.expert || []).forEach((r, k) => { if (r.on !== false && r.when.type !== "time" && pointMatches(r.when, F, 60 / SCORE.bpm)) parts.unshift(`your rule ${k + 1}`); });
  if (F.passage) parts.splice(1, 0, `the path to point ${F.idx + 2} crosses ${F.passage.crossings} edge${F.passage.crossings === 1 ? "" : "s"} → a ${F.passage.notes}-note run`);
  el.innerHTML = `<b>Point ${F.idx + 1}</b> · ${esc(SECTION_NAME[F.section] || "Development")} · chord ${esc(romanOf(F.root, SCORE.modeIv))} · ${esc(parts.slice(0, 3).join("; "))}.`;
  el.hidden = false;
}

/* ============ styles: groups and one-line descriptions for the dropdown ============ */
const STYLE_GROUPS = [
  ["Calm and nature", ["ambient", "lofinature", "meditation", "neoclassical", "minimal", "eastasian"]],
  ["Classical and film", ["classical", "baroque", "movie", "cinematic", "epic"]],
  ["Jazz, soul and world", ["jazz", "bossa", "blues", "funk", "reggae", "lofi", "triphop"]],
  ["Band", ["pop", "rock", "postrock", "folk", "metal"]],
  ["Electronic", ["electronic", "techno", "dnb", "synthwave", "chiptune"]]
];
const STYLE_DESC = {
  ambient: "Slow chords over a held bass note. No real drums, just soft shakers, bells and pads.",
  minimal: "A steady pulse and patterns that repeat and slowly shift, on marimba and vibraphone. Think Steve Reich.",
  lofi: "A lazy, swung beat with dusty drums and jazzy electric piano chords. Slow and relaxed.",
  classical: "Piano and cello with classical harmony, a flowing left hand and a proper ending. No drums.",
  cinematic: "Harp and strings over rolling toms, with cymbal swells leading into each new part.",
  movie: "Like a film score. Swelling strings, a piano theme and timpani when it peaks.",
  epic: "Trailer music. Driving strings, horns, choir and big drums, with a sudden pause right before the climax.",
  jazz: "Swing. A ride cymbal, a walking bass and piano chords that bounce off the beat.",
  bossa: "Nylon guitar on the bossa nova rhythm, a soft bass and gentle percussion.",
  electronic: "House music. A kick on every beat, a clap on 2 and 4, and that pumping feel.",
  synthwave: "Straight out of the 80s. A pulsing bass, a bright synth lead and a big snare.",
  pop: "Catchy and bright. Four chords that keep coming back, piano and guitar, and a beat with claps.",
  rock: "Guitars and drums. Power chords, a driving bass, a big snare on 2 and 4 and a crash at every new part.",
  metal: "Heavy and fast. Palm-muted guitar riffs, double bass drum at the climax and a sudden break before it.",
  blues: "Twelve bars and a shuffle. Seventh chords, a boogie bass line, guitar, piano and harmonica.",
  funk: "Tight and syncopated. Scratchy guitar, popping bass, ghost notes on the snare and horns.",
  lofinature: "Slow and warm, for nature and quiet light. Felt piano, a soft guitar, a tape-worn pad and almost no drums.",
  neoclassical: "Intimate piano with a cello and soft strings. Open chords, long phrases, no drums.",
  folk: "Fingerpicked acoustic guitar, a fiddle and an accordion, with a light kick and a shaker.",
  meditation: "Very slow. Long drones, a singing bowl and bells on a five-note scale, no drums.",
  postrock: "Echoing guitars that build slowly to a big climax with the whole band, then settle.",
  chiptune: "8-bit game music. Square waves, fast arpeggios, a bouncing bass and a simple drum machine.",
  triphop: "Slow, dark and heavy. A half-time break, Rhodes chords, a deep sub bass and a haunted lead.",
  reggae: "The skank on the off-beats, a dub bass and the one-drop, with an organ bubbling underneath.",
  baroque: "Harpsichord and violin over a walking cello, like the 1700s, ending on a proper cadence.",
  eastasian: "A bamboo flute and a koto on a five-note scale, over a drone, with woodblock and taiko.",
  dnb: "Fast and rolling. A two-step break at 170 BPM, a long reese bass and liquid pads.",
  techno: "Four on the floor, an off-beat bass, minimal stabs and an acid line. Dark and hypnotic."
};

// The three styles that suit the picture best (core/suggest.js), as buttons: the name and why.
let WHY_OPEN = false;
function styleSuggestHtml(cur) {
  if (!A) return "";
  const list = suggestStyles(A), ex = explainStyles(A, list);
  // why: the picture's five measures in words, then each style's fit, in plain sentences
  const why = `<details class="sugg-why"${WHY_OPEN ? " open" : ""}><summary>Why these styles?</summary>
    <p>This picture: ${ex.measures.map(m => `${m.name.toLowerCase()} ${nf(m.value)} (${m.level})`).join(", ")}; its main colour is ${esc(ex.family)}. Each style has a profile on the same measures, and the closest three are suggested.</p>
    ${ex.styles.map(x => `<p><b>${esc(STYLES[x.style].name)}</b> (${Math.round(x.score * 100)}% match). ${esc(STYLE_DESC[x.style] || "")} ${esc(x.lines.join(" "))}</p>`).join("")}</details>`;
  return `<span class="sugg-k">Suits this picture:</span>${list.map(x => `<button type="button" class="chip-btn${x.style === cur ? " on" : ""}" data-style="${x.style}" title="${esc(x.reason)}"><b>${esc(STYLES[x.style].name)}</b><small>${esc(x.reason)}</small></button>`).join("")}${why}`;
}
// the explanation stays open or closed as you left it
document.addEventListener("toggle", e => { if (e.target.classList && e.target.classList.contains("sugg-why")) WHY_OPEN = e.target.open; }, true);
function renderStyleSuggest() { const el = $("#styleSuggest"); if (el) el.innerHTML = styleSuggestHtml(P.style); }

/* ============ orchestration: extra layers (src/core/arrange.js) ============ */
// Small, Medium and Full are chosen automatically from the analysis; any change to the list
// (add, remove, change an instrument) copies it into a custom list the user owns.
const laneKeys = () => [...LAYERS, ...((SCORE && SCORE.extra) || []).map(L => L.id)];
const extraOf = id => ((SCORE && SCORE.extra) || []).find(L => L.id === id);
const layerName = l => LAYER_NAME[l] || (extraOf(l) ? ROLES[extraOf(l).role].name : l);
// an added layer takes its role's colour; a second or third layer with the same role gets a lighter
// or darker shade of it, so the lanes, the notes and the orchestration list can tell them apart
const shadeHex = (hex, to, a) => { const c = parseInt(hex.slice(1), 16), t = to === "w" ? 255 : 0, m = v => Math.round(v + (t - v) * a); return "#" + ((m(c >> 16) << 16) | (m((c >> 8) & 255) << 8) | m(c & 255)).toString(16).padStart(6, "0"); };
function extraColor(L) {
  const same = ((SCORE && SCORE.extra) || []).filter(x => x.role === L.role), k = Math.max(0, same.findIndex(x => x.id === L.id));
  const base = ROLE_COLOR[L.role] || "#888888";
  return k === 0 ? base : k % 2 ? shadeHex(base, "w", 0.4) : shadeHex(base, "b", 0.3);
}
const laneColor = l => css("--lane-" + l) || (extraOf(l) ? extraColor(extraOf(l)) : "#888");
// mixer and effect state for every layer the score has
function ensureLayerState(sc) {
  for (const L of sc.extra || []) {
    if (!P.mix[L.id]) P.mix[L.id] = { vol: 1, mute: false, solo: false };
    if (!P.fx.layer[L.id]) P.fx.layer[L.id] = { drive: 0, rev: 0.45, dly: L.role === "ornament" || L.role === "counter" ? 0.2 : 0.05 };
    if (!P.fx.eq[L.id]) P.fx.eq[L.id] = defaultEq();
  }
}
function customize() {
  if (P.orch !== "custom") { P.layers = ((SCORE && SCORE.extra) || []).map(L => ({ id: L.id, role: L.role, preset: L.preset })); P.orch = "custom"; }
}
function nextLayerId() { const used = new Set([...(P.layers || []).map(L => L.id)]); let i = 1; while (used.has("x" + i)) i++; return "x" + i; }
// the five main tracks (Advanced shows them above the extra layers, each with its instrument)
const MAIN_DESC = { lead: "the gaze path, from the height of each place", harm: "the chords, on the style's grid", bass: "the chord roots and the style's bass line", pad: "the background, held under everything", perc: "the style's drum patterns, driven by the edges" };
function renderOrch() {
  if (ORCH_SEG) ORCH_SEG.set(P.orch || "small");
  const host = $("#orchList"); if (!host || !SCORE) return;
  const xs = SCORE.extra || [];
  const kitLabel = () => { const k = P.kit && P.kit !== "style" ? P.kit : null; return k ? (kitCatalog()[k] || {}).name || k : "Style kit: " + ((KITS[STYLE_KIT[P.style]] || KITS.synth).name); };
  const main = LAYERS.map(l => `<li class="adv-only main" data-main="${l}" style="--dot:${css("--lane-" + l) || "#888"}"><span class="odot" aria-hidden="true"></span>
      <span class="oname"><b>${esc(LAYER_NAME[l])}</b><small>${esc(MAIN_DESC[l])}</small></span>
      <button type="button" class="choose ochoose" data-act="${l === "perc" ? "kit" : "minst"}" aria-haspopup="dialog" title="${l === "perc" ? "Change drum kit" : "Change instrument"}"><span>${esc(l === "perc" ? kitLabel() : (SCORE.inst[l] || {}).name || "")}</span></button><span aria-hidden="true"></span></li>`).join("");
  const roleSel = L => `<span class="select select-sm adv-only"><select data-act="role" aria-label="What the ${esc(L.name)} plays">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === L.role ? " selected" : ""}>${esc(r.name)}</option>`).join("")}</select></span>`;
  host.innerHTML = main + (xs.length ? xs.map(L => `<li data-id="${L.id}" style="--dot:${extraColor(L)}"><span class="odot" aria-hidden="true"></span>
      <span class="oname"><b class="simple-only">${esc(ROLES[L.role].name)}</b>${roleSel(L)}<small>${esc(ROLES[L.role].desc)}</small></span>
      <button type="button" class="choose ochoose" data-act="inst" aria-haspopup="dialog" title="Change instrument"><span>${esc(L.name)}</span></button>
      <button type="button" class="icon-btn" data-act="remove" aria-label="Remove ${esc(ROLES[L.role].name)}" title="Remove"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></li>`).join("")
    : `<li class="empty">Five layers: melody, harmony, bass, pad and rhythm. Medium and Full add layers chosen from the image; Add layer picks one yourself.</li>`);
}
function initOrch() {
  ORCH_SEG = makeSeg($("#orchSeg"), Object.entries(ORCHESTRATION), P.orch || "small", v => {
    if (v === "custom") customize(); else P.orch = v;
    invalidate(LV.MUSIC);
  });
  $("#orchList").addEventListener("change", e => {
    if (e.target.dataset.act !== "role") return;
    const id = e.target.closest("li[data-id]").dataset.id; customize();
    const C = P.layers.find(x => x.id === id); if (C) C.role = e.target.value; invalidate(LV.MUSIC);
  });
  $("#orchList").addEventListener("click", e => {
    const mb = e.target.closest("li[data-main] [data-act]");
    if (mb && SOUND) { const l = mb.closest("li").dataset.main; if (mb.dataset.act === "kit") SOUND.pickKit(); else SOUND.pickInstrument(l); return; }
    if (e.target.closest("select")) return;
    const li = e.target.closest("li[data-id]"), b = e.target.closest("[data-act]"); if (!li || !b) return;
    const id = li.dataset.id;
    if (b.dataset.act === "remove") { customize(); P.layers = P.layers.filter(L => L.id !== id); invalidate(LV.MUSIC); return; }
    pickLayerInstrument(id);
  });
  // Add layer: the style's band first (each instrument with the role it plays), then every other
  // instrument (its role guessed from its name, changeable afterwards in the list)
  $("#addLayer").addEventListener("click", () => {
    const band = STYLE_BAND[P.style] || [], styleName = STYLES[P.style].name, inBand = new Set(band.map(([k]) => k)), items = [];
    band.forEach(([k, role], i) => { if (LIBRARY[k]) items.push({ key: `b${i}`, name: LIBRARY[k].name, group: `${styleName} band`, sub: `${ROLES[role].name}: ${ROLES[role].desc}`, preset: k, role }); });
    for (const [k, v] of Object.entries(LIBRARY)) if (!inBand.has(k)) { const role = roleFor(k, v); items.push({ key: "o:" + k, name: v.name, group: "Other instruments", sub: `${ROLES[role].name}: ${ROLES[role].desc}`, preset: k, role }); }
    const byKey = Object.fromEntries(items.map(x => [x.key, x]));
    openPicker({
      title: "Add a layer", searchLabel: "Search instruments", items,
      note: "Each instrument plays a role that reads its own part of the image; its notes come from the sounding chord, in its own register. You can change the role in the list afterwards.",
      onPick: key => { const x = byKey[key]; if (!x) return; customize(); P.layers.push({ id: nextLayerId(), role: x.role, preset: x.preset }); invalidate(LV.MUSIC); },
      onPreview: key => { const x = byKey[key]; if (x) preview(ensureCtx(), "harm", LIBRARY[x.preset]); }
    });
  });
}
function pickLayerInstrument(id) {
  const L = extraOf(id); if (!L) return;
  // the style's band first, then the whole library by family
  const band = new Set((STYLE_BAND[P.style] || []).map(([k]) => k)), bandName = `${STYLES[P.style].name} band`;
  const items = Object.entries(LIBRARY).map(([k, v]) => ({ key: k, name: v.name, group: band.has(k) ? bandName : v.family || (v.type === "sample" ? "Recommended (sampled)" : "Synthesizers") }));
  items.sort((a, b) => (b.group === bandName) - (a.group === bandName) || a.group.localeCompare(b.group));
  openPicker({
    title: `${ROLES[L.role].name} instrument`, items, current: L.preset || "", searchLabel: "Search instruments",
    note: "Sampled instruments download when first used.",
    onPick: key => { customize(); const C = P.layers.find(x => x.id === id); if (C) C.preset = key; invalidate(LV.MUSIC); },
    onPreview: key => preview(ensureCtx(), "harm", LIBRARY[key])
  });
}

/* ============ sampled instruments (smplr, downloaded when first used) ============ */
// A persistent sampler graph on the live context keeps the instruments loaded across playbacks;
// its per-layer outputs are routed into each new playback graph.
const SAMP = { G: null };
const kitName = () => (P.kit === "style" ? STYLE_KIT[P.style] : P.kit) || "synth";
function sampleSpecs(sc) {
  const specs = [];
  for (const l of ["lead", "harm", "bass", "pad", ...(sc.extra || []).map(L => L.id)]) if (sc.inst[l] && sc.inst[l].type === "sample") specs.push({ layer: l, src: sc.inst[l].src });
  return specs.concat(kitSpecs(kitName()));
}
function liveSamples() {
  const ctx = ensureCtx();
  if (!SAMP.G) SAMP.G = { ctx, bus: {}, samplers: {} };
  // one output per layer, extra layers included (created as layers appear)
  for (const l of [...LAYERS, ...((SCORE && SCORE.extra) || []).map(L => L.id)]) if (!SAMP.G.bus[l]) SAMP.G.bus[l] = ctx.createGain();
  return SAMP.G;
}
function preloadSamples() { if (SCORE) { const specs = sampleSpecs(SCORE); if (specs.length) prepareSamples(liveSamples(), specs, 0); } }
onSampleStatus(({ loading, failed }) => { UI.samples = loading; UI.failed = failed.length > 0; refreshStatus(); });

/* ============ placement: where the focus points go (src/core/placement.js, src/ml/vision.js) ============ */
const ATTN = { cache: new Map(), job: null, failed: false, ref: null, objects: null };
const PLACEMENT_URLS = { objects: COCO_URL, learned: MSI_URL };
function placeNote(text) { const el = $("#placeNote"); if (el) el.textContent = text; }
// The attention map for the chosen method; neural maps run asynchronously (region contrast is
// used until they are ready), are cached per analysed image and are stored in the recipe.
function attention(contrast) {
  const m = P.placement || "contrast", D = PLACEMENTS[m] || PLACEMENTS.contrast;
  ATTN.ref = null; ATTN.objects = null;
  if (m === "contrast" || m === "scan") { placeNote(D.desc); return contrast; }
  if (!isNeural(m)) { placeNote(D.desc); const map = attentionMap(m, A, IMG, contrast.map); return { map, region: regionMeans(A, map) }; }
  const key = m + "|" + A.hash, hit = ATTN.cache.get(key);
  if (hit) {
    ATTN.ref = hit; ATTN.objects = hit.objects;
    placeNote(D.desc + (m === "objects" ? (hit.objects.length ? ` It found: ${hit.objects.map(o => o.name).join(", ")}.` : " It didn't find anything, so colour and texture decide instead.") : ""));
    const map = dequantize(fromB64(hit.data));
    if (m === "objects") {
      if (!hit.objects.length) return contrast;
      // objects lead, but a quarter of region contrast keeps the rest of the image in play
      for (let p = 0; p < map.length; p++) map[p] = 0.75 * map[p] + 0.25 * contrast.map[p];
    }
    return { map, region: regionMeans(A, map) };
  }
  if (ATTN.failed) { placeNote("The model couldn't load, maybe you're offline. For now the spots are picked by colour and texture. Choose it again to try once more."); return contrast; }
  if (!ATTN.job) {
    ATTN.job = key; setTimeout(refreshStatus, 0); placeNote(`Downloading the model (${m === "objects" ? "about 5 MB" : "about 25 MB"}, only the first time)…`);
    const W = A.W, H = A.H, canvas = SRC;
    (async () => {
      try {
        const r = await (m === "objects" ? objectsMap : learnedMap)(canvas, W, H);
        ATTN.cache.set(key, { key, method: m, w: W, h: H, data: toB64(r.q), objects: r.objects });
      } catch (e) { console.warn("Placement model unavailable:", e); ATTN.failed = true; }
      finally { ATTN.job = null; refreshStatus(); invalidate(LV.SAL); }
    })();
  }
  return contrast;
}

/* ============ New song: the guided start (genre, duration, points; automatic or by hand) ============ */
let NEW_SONG_PENDING = false;
// a suggested number of places from the image: richer images get more (4-14), within what the duration fits
function suggestedCount() {
  if (!A) return 8;
  const rich = clamp(0.5 * A.global.entropy + 0.5 * A.global.edgeN);
  return Math.round(4 + 10 * rich);
}
// the orange part of a plain range input, up to its thumb (the shared sliders do this themselves)
function fillRange(r) { const lo = Number(r.min) || 0, hi = Number(r.max) || 100; r.style.setProperty("--p", (((Number(r.value) - lo) / (hi - lo || 1)) * 100).toFixed(2) + "%"); }
function openNewSong(fresh = false) {
  const name = INFO ? INFO.name : "this image", sug = suggestedCount(), data = BASE && BASE.kind === "data";
  const groups = STYLE_GROUPS.map(([g, keys]) => `<optgroup label="${g}">${keys.filter(k => STYLES[k]).map(k => `<option value="${k}"${k === P.style ? " selected" : ""}>${esc(STYLES[k].name)}</option>`).join("")}</optgroup>`).join("");
  const places = Object.entries(PLACEMENTS).map(([k, v]) => `<option value="${k}"${k === (data ? "details" : P.placement) ? " selected" : ""}>${esc(v.name)}${v.group === "Neural" ? " (neural)" : ""}</option>`).join("");
  const { body, close } = openInfo(`New song from “${name}”`, `<div class="dlg-info newsong">
    <div class="field"><label class="flabel" for="nsStyle">Genre</label><span class="select"><select id="nsStyle">${groups}</select></span><div class="sugg" id="nsSuggest"></div><p class="snote" id="nsStyleNote"></p></div>
    <div class="field"><div class="flabel" id="nsLblDur">Duration</div><div class="seg" id="nsDur" role="radiogroup" aria-labelledby="nsLblDur"></div></div>
    <div class="field"><div class="srow"><label class="flabel" for="nsCount">Focus points</label><b id="nsCountVal" class="mono"></b></div>
      <input type="range" id="nsCount" min="2" max="24" step="1" value="${Math.min(24, P.count || sug)}">
      <p class="snote">How many spots the eye visits. Each one becomes a part of the song. For this picture we'd go with <button type="button" class="linkbtn" id="nsSug">${sug}</button>.${P.returns > 0 ? ` The eye may also look back at up to ${P.returns} of them.` : ""}</p></div>
    <div class="field"><label class="flabel" for="nsPlace">Where the eye looks</label><span class="select"><select id="nsPlace">${places}</select></span><p class="snote" id="nsPlaceNote"></p></div>
    <div class="field"><div class="flabel" id="nsLblCircle">Circle size</div><div class="seg" id="nsCircle" role="radiogroup" aria-labelledby="nsLblCircle"></div><p class="snote" id="nsCircleNote"></p></div>
    <div class="field"><div class="flabel" id="nsLblMel">Melody</div><div class="seg" id="nsMel" role="radiogroup" aria-labelledby="nsLblMel"></div><p class="snote" id="nsMelNote"></p></div>
    <div class="field"><div class="flabel" id="nsLblConn">Between the spots</div><div class="seg" id="nsConn" role="radiogroup" aria-labelledby="nsLblConn"></div><p class="snote" id="nsConnNote"></p></div>
    <div class="field"><div class="flabel" id="nsLblOrch">Orchestration</div><div class="seg" id="nsOrch" role="radiogroup" aria-labelledby="nsLblOrch"></div><p class="snote" id="nsOrchNote"></p></div>
    <div class="field"><div class="flabel" id="nsLblGroove">Groove</div><div class="seg" id="nsGroove" role="radiogroup" aria-labelledby="nsLblGroove"></div><p class="snote" id="nsGrooveNote"></p></div>
    <p class="snote">Everything here can be changed later in the Piece tab. Advanced shows the rest: every instrument, the composition rules, how it is played, and more.</p>
    <div class="ns-actions">
      <button type="button" class="btn btn-primary" id="nsAuto"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>Generate song</button>
      <button type="button" class="btn" id="nsManual">Place the points myself</button>
    </div>
    <p class="snote"><b>Generate song</b> picks the spots for you, and you can still move them afterwards. With <b>Place the points myself</b> you tap them in, in the order you want to hear them.</p></div>`, "dlg-newsong");
  const $b = s => body.querySelector(s);
  // a new picture starts on the style that suits it best
  if (fresh && A) { const best = suggestStyles(A)[0]; if (best) $b("#nsStyle").value = best.style; }
  $b("#nsSuggest").addEventListener("click", e => { const x = e.target.closest("[data-style]"); if (!x) return; $b("#nsStyle").value = x.dataset.style; note(); });
  let dur = P.duration, mel = P.melody || "classic", conn = P.connect || "light", orch = P.orch === "custom" ? "custom" : P.orch || "small";
  let circle = P.circleSize || "area", groove = P.groove === "neural" ? "neural" : "straight";
  const CIRCLE_DESC = {
    area: "Each circle takes the size of the spot that draws the eye there: small for a sharp detail, large for a wide, even area. The circle is what that place reads, so its size shapes the sound too.",
    same: "Every circle has the same size, set by Radius in the Piece tab."
  };
  const GROOVE_DESC = {
    straight: "The drums play exactly on the grid, with the style's own accents and swing.",
    neural: "A neural model (Magenta GrooVAE, about 15 MB, downloaded once) plays the drums like a drummer, with small shifts in timing and loudness. The hits stay the ones the picture chose."
  };
  const MEL_DESC = {
    classic: "The tune follows the eye: high places sound high, every place has its own motif, and places that look alike share one.",
    story: "A neural model (Magenta MusicVAE, about 18 MB, downloaded once) writes a longer, singing line that still follows the places and the chords.",
    improv: "A neural model (Magenta ImprovRNN, about 6 MB) improvises over the chords, like a soloist reading the picture."
  };
  const CONN_DESC = {
    off: "Each spot plays on its own; the music moves straight on to the next one.",
    light: "A few notes follow the eye's path from one spot to the next, so the parts flow into each other.",
    rich: "Longer runs that trace the path between spots, with more notes where it crosses edges."
  };
  // which instruments an orchestration adds, for this picture and style
  const orchNote = () => {
    const st = $b("#nsStyle").value, n = Number($b("#nsCount").value);
    if (orch === "custom") return "Your own list of instruments stays as it is.";
    if (orch === "small") return "Five tracks: melody, harmony, bass, a pad underneath and the drums (or the style's percussion).";
    const xs = A ? autoLayers(st, orch, richnessOf(A, n), P.samples !== false) : [];
    return `The five tracks, plus ${xs.length} more from the ${STYLES[st].name} band: ${xs.map(L => `${(LIBRARY[L.preset] || {}).name || L.preset} (${ROLES[L.role].name.toLowerCase()})`).join(", ")}. They come in one by one as the music builds; one with almost nothing to play in this picture is swapped for the next in the style's band.`;
  };
  const note = () => {
    $b("#nsStyleNote").textContent = STYLE_DESC[$b("#nsStyle").value] || ""; $b("#nsSuggest").innerHTML = styleSuggestHtml($b("#nsStyle").value); $b("#nsPlaceNote").textContent = (PLACEMENTS[$b("#nsPlace").value] || {}).desc || "";
    $b("#nsCountVal").textContent = $b("#nsCount").value; fillRange($b("#nsCount"));
    $b("#nsMelNote").textContent = MEL_DESC[mel] || ""; $b("#nsConnNote").textContent = CONN_DESC[conn] || ""; $b("#nsOrchNote").textContent = orchNote();
    $b("#nsCircleNote").textContent = CIRCLE_DESC[circle]; $b("#nsGrooveNote").textContent = GROOVE_DESC[groove];
  };
  makeSeg($b("#nsCircle"), [["area", "From the area"], ["same", "Same for all"]], circle, v => { circle = v; note(); });
  makeSeg($b("#nsGroove"), [["straight", "Straight"], ["neural", "Human (GrooVAE)"]], groove, v => { groove = v; note(); });
  makeSeg($b("#nsDur"), DURATIONS.map(d => [String(d), `${d} s`]), String(dur), v => { dur = Number(v); });
  makeSeg($b("#nsMel"), [["classic", "Classic"], ["story", "Story (AI)"], ["improv", "Improvise (AI)"]], mel, v => { mel = v; note(); });
  makeSeg($b("#nsConn"), Object.entries(CONNECT), conn, v => { conn = v; note(); });
  makeSeg($b("#nsOrch"), Object.entries(ORCHESTRATION).filter(([k]) => k !== "custom" || P.orch === "custom"), orch, v => { orch = v; note(); });
  ["#nsStyle", "#nsPlace"].forEach(s => $b(s).addEventListener("change", note));
  $b("#nsCount").addEventListener("input", note);
  $b("#nsSug").addEventListener("click", () => { $b("#nsCount").value = sug; note(); });
  note();
  const apply = () => {
    P.style = $b("#nsStyle").value; P.duration = dur; P.placement = $b("#nsPlace").value; P.count = Number($b("#nsCount").value);
    if (P.melody !== mel) { P.melody = mel; STORY.failed = false; }
    P.connect = conn; P.orch = orch; P.circleSize = circle;
    if (P.groove !== groove) { P.groove = groove; GROOVE.failed = false; }
    SL.reverb.set(STYLES[P.style].reverb, false); ATTN.failed = false;
  };
  $b("#nsAuto").addEventListener("click", () => {
    apply(); ensureCtx(); // the click unlocks audio, so the piece can start by itself
    pushHistory(); PATH.mode = "auto"; PATH.points = []; tool = "select"; SEL = 0;
    close(); syncAllControls(); invalidate(LV.SAL);
  });
  $b("#nsManual").addEventListener("click", () => {
    apply(); ensureCtx();
    pushHistory(); PATH.mode = "manual"; PATH.points = []; tool = "add"; SEL = 0;
    close(); syncAllControls(); invalidate(LV.SAL); showPlaceHint();
  });
}
// the hint shown while placing points by hand
function showPlaceHint() {
  const old = document.querySelector(".guide"); if (old) old.remove();
  const g = document.createElement("section"); g.className = "guide"; g.setAttribute("aria-label", "Placing points");
  g.innerHTML = `<button type="button" class="icon-btn guide-x" data-a="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <h2>Place your points</h2>
    <ol><li><b>Tap the picture</b> where you want the eye to stop, in the order you want to hear them.</li>
    <li><b>Tap a circle</b> to open it in the Focus point tab. There you can make it calm, a build-up, the climax or the release.</li>
    <li><b>Press play</b> whenever you're ready. The music keeps up with your changes.</li></ol>
    <div class="row"><button type="button" class="btn btn-primary" data-a="ok">Got it</button></div>`;
  $("#lightbox").appendChild(g);
  g.addEventListener("click", e => { if (e.target.closest("[data-a]")) g.remove(); });
}

/* ============ welcome page: what the app does, who made it ============ */
const INSTAGRAM_URL = "https://www.instagram.com/pericle_v/";
function showWelcome() {
  const old = document.querySelector(".welcome-backdrop"); if (old) old.remove();
  const bd = document.createElement("div"); bd.className = "welcome-backdrop";
  bd.innerHTML = `<section class="welcome" role="dialog" aria-modal="true" aria-labelledby="wTitle">
    <button type="button" class="icon-btn welcome-x" data-w="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <header class="welcome-head">
      <div class="welcome-logo" aria-hidden="true">${LOGO}</div>
      <h1 id="wTitle">Lux Sonora</h1>
      <p class="welcome-tag">Image sonification: from image to sound.</p>
    </header>
    <p class="welcome-lead">Every image holds a story. Part of it is in plain sight, but most of it waits in the light, in the colours and in the places where the eye lingers a little longer than it meant to. Lux Sonora follows the eye as it wanders through a picture and gives that story a voice, in whatever style you pick.</p>
    <ol class="welcome-steps">
      <li><b>Pick a picture</b><span>A photo, a painting, even a microscope image. Or start with one of the demos.</span></li>
      <li><b>Make a song</b><span>Choose a genre and a length, then let the app pick the spots, or tap them in yourself.</span></li>
      <li><b>Play with it</b><span>Drag the spots around, pick the climax, then save the song or a video of it.</span></li>
    </ol>
    <ul class="welcome-points">
      <li>28 styles, from ambient, nature lo-fi and classical to jazz, reggae, rock, metal, techno and 8-bit</li>
      <li>Real recorded instruments, plus optional AI models (Magenta) for melodies and grooves that feel more human</li>
      <li>It all runs in your browser, so your picture stays on your device</li>
      <li>Same picture, same settings, same song. Save the project and anyone can open it again</li>
      <li>Free and open source</li>
    </ul>
    <div class="welcome-actions">
      <button type="button" class="btn btn-primary" data-w="upload"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>Upload an image</button>
      <button type="button" class="btn" data-w="demo">Try a demo</button>
    </div>
    <footer class="welcome-foot">
      <a class="welcome-qr" href="${INSTAGRAM_URL}" target="_blank" rel="noopener noreferrer" aria-label="Instagram: pericle_v"><img src="${qrUrl}" alt="QR code for the Instagram account pericle_v" width="120" height="133"></a>
      <div class="welcome-credit">
        <p class="welcome-by">Developed by <b>Pericle</b></p>
        <p>If you like it, please follow me on Instagram.</p>
        <a class="btn welcome-ig" href="${INSTAGRAM_URL}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>@pericle_v</a>
        <p class="sub">You can come back to this page anytime with Welcome, at the top.</p>
      </div>
    </footer>
  </section>`;
  document.body.appendChild(bd);
  const close = then => { store.set("welcomeDone", "1"); bd.remove(); document.removeEventListener("keydown", onKey, true); if (then) then(); };
  const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(() => showGuide()); } };
  document.addEventListener("keydown", onKey, true);
  bd.addEventListener("click", e => {
    if (e.target === bd) { close(() => showGuide()); return; }
    const a = e.target.closest("[data-w]"); if (!a) return;
    if (a.dataset.w === "upload") { store.set("guideDone", "1"); close(); $("#file").click(); }
    else close(() => showGuide());
  });
  bd.querySelector('[data-w="upload"]').focus();
}

/* ============ UI help: first-run guide, About, keyboard shortcuts ============ */
function showGuide(force = false) {
  if (!force && store.get("guideDone")) return;
  const old = document.querySelector(".guide"); if (old) old.remove();
  const g = document.createElement("section"); g.className = "guide"; g.setAttribute("aria-label", "Getting started");
  g.innerHTML = `<button type="button" class="icon-btn guide-x" data-a="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <h2>Getting started</h2>
    <ol><li><b>Upload a photo</b> or drag it onto the picture. You can also keep the demo.</li>
    <li>Press <b>New song</b>, choose a genre, a length and how many spots, then hit <b>Generate song</b>. Or place the spots yourself.</li>
    <li>Drag the circles around, add or remove some, or make one of them the climax. The music changes as you go.</li></ol>
    <div class="row"><button type="button" class="btn" data-a="shortcuts">Keyboard shortcuts</button><button type="button" class="btn" data-a="upload">Upload a photo</button><button type="button" class="btn btn-primary" data-a="new">New song</button></div>`;
  $("#lightbox").appendChild(g);
  g.addEventListener("click", e => {
    const a = e.target.closest("[data-a]"); if (!a) return;
    if (a.dataset.a === "upload") $("#file").click();
    if (a.dataset.a === "shortcuts") { showShortcuts(); return; }
    if (a.dataset.a === "new") { store.set("guideDone", "1"); g.remove(); openNewSong(); return; }
    store.set("guideDone", "1"); g.remove();
  });
}
function showShortcuts() {
  openInfo("Keyboard shortcuts", `<div class="dlg-info"><table>
    <tr><td><kbd>Space</kbd></td><td>Play or pause</td></tr>
    <tr><td><kbd>[</kbd> <kbd>]</kbd></td><td>Previous or next focus point</td></tr>
    <tr><td><kbd>A</kbd></td><td>Add focus points by clicking the stage</td></tr>
    <tr><td><kbd>Delete</kbd></td><td>Remove the selected focus point</td></tr>
    <tr><td><kbd>Alt</kbd> + scroll</td><td>Resize the focus point under the pointer</td></tr>
    <tr><td><kbd>Ctrl</kbd> <kbd>Z</kbd> / <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd></td><td>Undo or redo an edit of the path</td></tr>
    <tr><td><kbd>?</kbd></td><td>This list</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Close a dialog or menu</td></tr></table></div>`);
}
// Help › How it works: the whole idea in plain words, every rule the composer follows (from the
// rules' own descriptions, so the list is always complete) and the AI models it can use.
// The numbers behind the open picture's key, mode and tempo (the same formulas as the composer),
// so the explanation can be checked against what you hear.
function howThisPicture() {
  if (!SCORE || !A) return "";
  const g = A.global, sc = SCORE, st = STYLES[sc.style], val = 0.5 * g.brightness + 0.3 * g.warmth01 + 0.2 * g.sat, energy = 0.6 * g.edgeN + 0.4 * g.entropy;
  const modes = [...st.modes].sort((a, b) => MODES[a].b - MODES[b].b), keyFrom = g.hueStr > 0.06 ? `its colour, at ${Math.round(g.hue)}° on the wheel` : `its lightness (${nf(g.brightness)}), as it has no clear colour`;
  const mode = sc.scaleManual ? "chosen by hand" : `brightness score ${nf(val)} picks ${MODES[sc.modeKey].name.split(" ")[0]} among ${modes.map(m => MODES[m].name.split(" ")[0]).join(", ")}`;
  return `<div class="howto-now"><b>For this picture</b> (${esc(st.name)}): the key is ${esc(pcName(sc.pc))}${sc.keyManual ? " (chosen by hand)" : `, from ${esc(keyFrom)}`}; the mood is ${esc(mode)}; the energy score ${nf(energy)} sets ${nf1(sc.bpmStyle)} BPM in the style's ${st.tempo[0]}-${st.tempo[1]}, rounded to ${nf1(sc.bpm)} BPM so ${sc.bars} bars last exactly ${sc.seconds} s; ${sc.points.length} places share ${sc.body - (sc.intro || 0)} beats.${sc.modulation ? ` The climax moves to ${esc(pcName(sc.modulation.keyPc))}.` : ""}</div>`;
}
// Every style's particulars, read from its settings (theory.js STYLES and RULES, patterns.js).
function howStyles() {
  const mname = m => MODES[m].name.split(" ")[0], every = u => (u >= 8 ? "every two bars" : u === 4 ? "every bar" : `every ${u} beats`);
  const kinds = (list, names) => [...new Set(list)].map(k => names[k] || k).join(", then ");
  return STYLE_GROUPS.map(([gname, keys]) => `<h4>${esc(gname)}</h4><ul class="howto-styles">${keys.filter(k => STYLES[k]).map(k => {
    const st = STYLES[k], R = RULES[k], extra = [];
    if (R.loop) extra.push(R.loop.major.length === 12 ? "the 12-bar blues form" : R.loop.major.length === 4 && new Set(R.loop.major).size <= 2 ? "a vamp on one or two chords" : `a ${R.loop.major.length}-chord loop`);
    if (R.quality === "dom7") extra.push("every chord a dominant seventh");
    if (st.melScale) extra.push("a blues melody scale"); else if (st.pent) extra.push("a five-note (pentatonic) melody");
    if (st.swing16) extra.push("swung sixteenths"); else if (st.swing >= 0.3) extra.push("swung eighths"); else if (st.swing > 0) extra.push("a light swing");
    extra.push(st.ext >= 9 ? "ninths in the chords" : st.ext >= 7 ? "sevenths in the chords" : "plain triads");
    if (R.cadentialV) extra.push("the dominant before the last chord");
    if (R.stopDown) extra.push("a break before the climax");
    if (R.sidechain >= 0.3) extra.push("pumping on the kick (sidechain)");
    if (R.drive) extra.push("distorted guitars");
    if (R.swell) extra.push(`a ${R.swell === "riser" ? "riser" : R.swell === "timpani" ? "timpani roll" : "cymbal swell"} into new parts`);
    return `<li><b>${esc(st.name)}.</b> ${esc(STYLE_DESC[k] || "")}<br><small>${st.tempo[0]}-${st.tempo[1]} BPM · ${esc(st.modes.map(mname).join(", "))} · chords change ${every(R.unit)} · harmony: ${esc(kinds(R.harm, HARM_NAME))} · bass: ${esc(kinds(R.bass, BASS_NAME))} · drums: ${esc(PERC_NAME[k] || "none")} · ${esc(extra.join(", "))}</small></li>`;
  }).join("")}</ul>`).join("");
}
function showHowItWorks() {
  const rules = Object.entries(RULE_GROUPS).map(([g, gname]) => `<h4>${esc(gname)}</h4><ul>${Object.values(RULES_INFO).filter(r => r.group === g).map(r => `<li><b>${esc(r.name)}.</b> ${esc(r.desc)}</li>`).join("")}</ul>`).join("");
  const { body } = openInfo("How Lux Sonora works", `<div class="dlg-info howto">
    <p>Lux Sonora looks at a picture the way a person does, one place at a time, and turns that journey into a song. Everything happens on your device: the picture is never uploaded, and there are no accounts or keys.</p>

    <h3>1. Reading the picture</h3>
    <p>The app measures the light, the colours, the edges and the texture of the image and splits it into regions of similar colour. From these it builds an <b>eye map</b>: the spots that stand out, by contrast, by detail, or (with a neural model) by what people tend to look at. A simulated eye then jumps from spot to spot, the way your gaze would, sometimes going back to a place it liked. Each stop is a <b>focus point</b>, drawn as a numbered circle. You can move, add or remove them.</p>

    <h3>2. How the notes are found</h3>
    <ol class="howto-steps">
      <li><b>The key.</b> The picture's main colour is an angle on the colour wheel. Every 30° step on the wheel is one step on the circle of fifths, so neighbouring colours give related keys (red C, orange G, yellow D and so on round the wheel). A picture without a clear colour takes its key from its lightness instead.</li>
      <li><b>The mood.</b> A brightness score is made from the picture: half its lightness, three tenths its warmth and two tenths its saturation. The style's modes are lined up from the darkest (Phrygian) to the brightest (Lydian), and the score picks one: a dark, cold picture lands on the darkest mode the style allows, a bright, warm one on the brightest.</li>
      <li><b>The tempo.</b> An energy score (six tenths edges, four tenths texture) places the tempo inside the style's range, and it is then rounded so the song fits whole bars in exactly the length you chose.</li>
      <li><b>How long each place lasts.</b> Every place gets a share of the song from how much it draws the eye (the more it stands out, up to four times longer), on the style's grid, at least one beat.</li>
      <li><b>The melody's height.</b> The height of a place in the picture sets the height of its notes in the scale: the top of the picture is the top of the melody's range. When the eye moves, the melody moves the same way (up when the eye goes up), by a step that grows with the distance; Fidelity chooses between following the path and following the height.</li>
      <li><b>The tune of a place.</b> Places that look alike (similar colour and texture) belong to one family, and each family has a short motif. When the eye comes back to a family, its motif returns, repeated, upside down or backwards, so the song has themes.</li>
      <li><b>The chord.</b> Each style has a few chords it likes for light places and a few for dark ones. The chord chosen holds the melody's first note (as its root, third or fifth) and, among those, shares the most notes with the chord before, so the harmony moves smoothly (a place very unlike the one before jumps further; with Smoothness at zero the first that fits is taken). Some styles always add the seventh or the ninth; in the others a busy texture adds them.</li>
      <li><b>Keeping it in tune.</b> A melody note on a beat moves to the nearest note of the chord, a note that would rub a semitone against the chord moves or becomes a gentle tension, held notes resolve when the chord changes, and the melody always stays on top. All the rules are in section 4.</li>
      <li><b>The sound.</b> Each place colours the instruments: sharp edges give a fast attack, smooth areas long legato notes, busy textures a brighter tone, vivid colour a more resonant one, warm colours richer harmonics.</li>
      <li><b>The shape.</b> The song has an introduction, a build-up, a climax at the most striking place and a resolution. The extra instruments join as it builds, and a short intro and ending are written for the whole piece.</li>
    </ol>
    ${howThisPicture()}

    <h3>3. The styles</h3>
    <p>Each style brings its own frame: how often the chords change, its drum patterns, its instruments, its swing and its form. The picture chooses inside that frame, never against it. Under the style the app suggests the three that suit the picture best, from its light, colours, detail and contrast. This list is made from the same settings the composer uses, so it is always exact.</p>
    ${howStyles()}

    <h3>4. The rules the composer follows</h3>
    <p>On top of the style, the composer keeps to these rules. Each one can be turned off in Piece, Advanced, Composition rules, so you can hear what it does.</p>
    ${rules}

    <h3>5. How it is played</h3>
    <p>After the notes are written, they are played with some life: each note of a place reads the picture around it and is a little louder or softer, the first beat of the bar gets an accent, phrases rise and relax, each instrument swells with the story (expression, CC11) and saturated places get more vibrato (CC1). A light humanizer moves notes by a few milliseconds and varies their length and velocity, the same way every time. All of it is in Piece, Advanced, Performance, and goes into the MIDI file.</p>

    <h3>6. Your own rules (Expert)</h3>
    <p>In Expert mode you can add rules on the places the eye finds: at one place, in a part of the song, where the picture has a colour, inside a zone you draw, or between two seconds, you can add an instrument, silence a track, choose the chord, move the melody by octaves, or play louder or softer. Your rules win over the style's, and stay in harmony: chords come from the key and the melody is fitted to them.</p>

    <h3>7. The AI models</h3>
    <p>They are optional. Each one downloads the first time you choose it (a bar at the top shows it loading), then runs on your device. Without a connection the app falls back to its own rules and still makes a complete song.</p>
    <ul>
      <li><b>Magenta MusicVAE</b> (about 18 MB), for the <b>Story</b> melody: a neural network trained on melodies writes a longer, singing line that still starts from your places and follows the chords.</li>
      <li><b>Magenta ImprovRNN</b> (about 6 MB), for the <b>Improvise</b> melody: it improvises over the chords, like a soloist, starting from the places.</li>
      <li><b>Magenta GrooVAE</b> (about 15 MB), for the <b>Human</b> groove: it plays the drums like a drummer, with small shifts in timing and dynamics. The hits stay the ones the picture chose.</li>
      <li><b>COCO-SSD</b> (about 5 MB), for <b>Objects</b> (in Where the eye looks) and for the labels in the video: it finds people, animals and things in the picture, and the eye goes to them.</li>
      <li><b>MSI-Net</b> (about 25 MB), for <b>Learned saliency</b> (in Where the eye looks): trained on where real people look at photos, it predicts where the eye goes.</li>
    </ul>
    <p>The instruments you hear are recordings of real instruments (downloaded when first used) or the app's own synthesizers.</p>

    <h3>8. The same picture, the same song</h3>
    <p>Nothing is left to chance: the same picture with the same settings always gives the same song. Save project keeps the picture and every setting, so you or anyone else can open the exact same song later. The Export tab saves the audio, the MIDI for your music software and the video.</p>
    <div class="row" style="display:flex;justify-content:flex-end"><button type="button" class="btn btn-primary" data-close>Close</button></div></div>`, "dlg-wide");
  // start at the top (the focus would otherwise scroll it to the Close button)
  body.closest(".dlg").querySelector(".dlg-close").focus({ preventScroll: true }); body.scrollTop = 0;
}
function showAbout() {
  openInfo("About Lux Sonora", `<div class="dlg-info">
    <div class="about-logo" aria-hidden="true">${LOGO}</div>
    <p><b>Lux Sonora ${esc(APP_VERSION)}</b> turns an image into music: a simulated gaze moves across the image, and every place it looks at becomes melody, harmony, rhythm and timbre, in the rules of the chosen style. The same image and settings always give the same piece; a saved project lets anyone make it again.</p>
    <p>Developed by <b>Pericle</b>. If you like it, please follow me on Instagram: <a href="${INSTAGRAM_URL}" target="_blank" rel="noopener noreferrer">@pericle_v</a>.</p>
    <h3>Licence</h3><p>Open source under the MIT License. Copyright © 2026 Pericle and the Lux Sonora contributors. Source code: <a href="https://github.com/periclev/luxsonora" target="_blank" rel="noopener noreferrer">github.com/periclev/luxsonora</a>.</p>
    <h3>Built with</h3><ul>
      <li>smplr (MIT) and the General MIDI soundfonts of gleitz/midi-js-soundfonts (MIT; MusyngKite CC BY-SA 3.0)</li>
      <li>Magenta.js and its MusicVAE, ImprovRNN and GrooVAE models; TensorFlow.js (Apache-2.0)</li>
      <li>MSI-Net saliency, Kroner et al. (MIT); COCO-SSD (Apache-2.0)</li>
      <li>geotiff.js, fft.js, lufs-web (MIT)</li></ul>
    <p>Sampled instruments and models are downloaded when first used and keep their own licences; the full list is in THIRD_PARTY_NOTICES.md.</p>
    <div class="row" style="display:flex;justify-content:flex-end;gap:8px"><button type="button" class="btn" id="aboutGuide">Show the guide</button><button type="button" class="btn btn-primary" data-close>Close</button></div></div>`).body.querySelector("#aboutGuide").addEventListener("click", () => { document.querySelector(".dlg-backdrop").remove(); showGuide(true); });
}

/* ============ story melody (Magenta MusicVAE, downloaded at runtime) ============ */
// The model runs asynchronously: until the story for the current score is ready the
// classic melody plays; when it arrives the score is recomputed and the story applied.
const STORY = { cache: new Map(), job: null, failed: false, backend: "" };
const GROOVE = { cache: new Map(), job: null, failed: false };
function melNote(text) { const el = $("#melNote"); el.hidden = !text; el.textContent = text || ""; }
function grooveNote(text) { const el = $("#grooveNote"); el.hidden = !text; el.textContent = text || ""; }
const MEL = {
  story: { name: "Story by Magenta MusicVAE", api: modelApi, run: storyMelody, size: "about 18 MB", verb: "Composing the story" },
  improv: { name: "Improvised by Magenta ImprovRNN", api: improvApi, run: improvMelody, size: "about 6 MB", verb: "Improvising" }
};
// Neural melodies (Story, Improvise) run asynchronously: until the result for the current score
// is ready the classic melody plays; when it arrives the score is recomputed and the result applied.
function storyStep() {
  const M = MEL[P.melody];
  if (!M) { melNote(""); return; }
  if (STORY.failed) { melNote("The music model couldn't load, maybe you're offline. You'll hear the classic melody for now. Choose it again to try once more."); return; }
  const key = P.melody + "|" + storyKey(SCORE), hit = STORY.cache.get(key);
  if (hit) { applyStory(SCORE, hit); SCORE.storyRef = { key, res: hit }; melNote(`${M.name}: ${hit.segments.length} segments from ${hit.places} places, following the chords.`); return; }
  if (STORY.job) return; // the running job recomputes when it ends, then this key is composed
  const sc = composedCopy(SCORE); STORY.job = key; STORY.phase = "download"; STORY.progress = null;
  melNote(`Downloading the music model (${M.size}, only the first time)…`);
  (async () => {
    try {
      const model = await M.api(); STORY.backend = model.backend; STORY.phase = "run"; STORY.progress = 0; refreshStatus();
      const res = await M.run(sc, model, (d, t) => { melNote(`${M.verb}: ${d} of ${t}…`); STORY.progress = t ? d / t : 0; refreshStatus(); });
      STORY.cache.set(key, res);
      if (STORY.cache.size > 24) STORY.cache.delete(STORY.cache.keys().next().value);
    } catch (e) {
      console.warn("Neural melody unavailable:", e); STORY.failed = true;
    } finally { STORY.job = null; invalidate(LV.MUSIC); }
  })();
}
// Human groove (GrooVAE): same pattern, on the drums, after the melody.
function grooveStep() {
  if (P.groove !== "neural") { grooveNote(""); return; }
  if (GROOVE.failed) { grooveNote("The groove model couldn't load, so the drums stay perfectly in time. Choose Human again to try once more."); return; }
  const key = grooveKey(SCORE), hit = GROOVE.cache.get(key);
  if (hit) { applyGroove(SCORE, hit); SCORE.grooveRef = { key, res: hit }; grooveNote(`Played by Magenta GrooVAE: ${hit.hits.length} hits with human timing and dynamics${SCORE.style === "electronic" ? " (timing kept on the grid, as a drum machine)" : ""}.`); return; }
  if (GROOVE.job) return;
  const sc = composedCopy(SCORE); GROOVE.job = key; GROOVE.phase = "download";
  grooveNote("Downloading the groove model (about 15 MB, only the first time)…");
  (async () => {
    try {
      const model = await grooveApi(); GROOVE.phase = "run"; refreshStatus();
      GROOVE.cache.set(key, await grooveFor(sc, model));
      if (GROOVE.cache.size > 24) GROOVE.cache.delete(GROOVE.cache.keys().next().value);
    } catch (e) {
      console.warn("Groove unavailable:", e); GROOVE.failed = true;
    } finally { GROOVE.job = null; invalidate(LV.MUSIC); }
  })();
}
// the score as composed (the performance changes timing and velocities in place afterwards)
function composedCopy(sc) { return { ...sc, notes: sc.notes.map(n => ({ ...n })) }; }
function makeCanvas(W, H) { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; }
function buildStaticOverlays() {
  const { W, H, N, mag, p95, labels } = A;
  const e = makeCanvas(W, H), ei = e.getContext("2d").createImageData(W, H);
  for (let p = 0; p < N; p++) { const a = clamp(mag[p] / p95); ei.data.set([236, 243, 255, Math.round(a * 255)], p * 4); }
  e.getContext("2d").putImageData(ei, 0, 0);
  const r = makeCanvas(W, H), ri = r.getContext("2d").createImageData(W, H);
  const rgb = CLUSTER_COL.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  for (let p = 0; p < N; p++) {
    const x = p % W, y = (p / W) | 0, l = labels[p];
    const bnd = (x < W - 1 && labels[p + 1] !== l) || (y < H - 1 && labels[p + W] !== l);
    const c = rgb[CL.assign[l] % rgb.length];
    ri.data.set(bnd ? [255, 255, 255, 210] : [c[0], c[1], c[2], 105], p * 4);
  }
  r.getContext("2d").putImageData(ri, 0, 0);
  OV.edge = e; OV.reg = r;
}
const HEAT = [[0, [20, 40, 90, 0]], [0.35, [47, 111, 179, 120]], [0.7, [242, 177, 69, 190]], [1, [255, 246, 220, 235]]];
function heat(v) {
  for (let i = 1; i < HEAT.length; i++) if (v <= HEAT[i][0]) {
    const [a0, c0] = HEAT[i - 1], [a1, c1] = HEAT[i], t = (v - a0) / (a1 - a0);
    return c0.map((c, k) => Math.round(lerp(c, c1[k], t)));
  }
  return HEAT[HEAT.length - 1][1];
}
// The views of the analysis for the video's place textures (Export › Effects and sound), at the
// analysis size and drawn over the picture: edges (light on dark), texture (each region's entropy
// as heat), the eye map, the regions in their family colours, and colour areas (each region in its
// average colour). Made once per analysis.
let VMAPS = null;
function videoMaps() {
  if (!A || !SAL || !IMG) return null;
  if (VMAPS && VMAPS.A === A && VMAPS.SAL === SAL) return VMAPS.maps;
  const { W, H, N, mag, p95, labels, regions } = A, mk = fn => { const c = makeCanvas(W, H), im = c.getContext("2d").createImageData(W, H); for (let p = 0; p < N; p++) im.data.set(fn(p), p * 4); c.getContext("2d").putImageData(im, 0, 0); return c; };
  // average colour of each region, from the analysed image
  const sum = new Float64Array(regions.length * 4), d = IMG.data, sx = IMG.width / W, sy = IMG.height / H;
  for (let p = 0; p < N; p++) { const x = p % W, y = (p / W) | 0, q = (Math.min(IMG.height - 1, Math.floor(y * sy)) * IMG.width + Math.min(IMG.width - 1, Math.floor(x * sx))) * 4, l = labels[p] * 4; sum[l] += d[q]; sum[l + 1] += d[q + 1]; sum[l + 2] += d[q + 2]; sum[l + 3]++; }
  const rgb = CLUSTER_COL.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const maps = {
    edges: mk(p => { const a = clamp(mag[p] / p95); return [Math.round(12 + 236 * a), Math.round(14 + 236 * a), Math.round(20 + 235 * a), 255]; }),
    texture: mk(p => { const h = heat(clamp((regions[labels[p]].entropy ?? 0.5) * 1.1)); return [h[0], h[1], h[2], 255]; }),
    attention: mk(p => { const h = heat(SAL.map[p]); return [h[0], h[1], h[2], 255]; }),
    regions: mk(p => { const x = p % W, y = (p / W) | 0, l = labels[p], bnd = (x < W - 1 && labels[p + 1] !== l) || (y < H - 1 && labels[p + W] !== l), c = rgb[CL.assign[l] % rgb.length]; return bnd ? [255, 255, 255, 255] : [c[0], c[1], c[2], 255]; }),
    colour: mk(p => { const l = labels[p] * 4, n = sum[l + 3] || 1; return [sum[l] / n, sum[l + 1] / n, sum[l + 2] / n, 255]; })
  };
  VMAPS = { A, SAL, maps };
  return maps;
}
function buildCovOverlay() {
  const { W, H, N } = A, c = makeCanvas(W, H), im = c.getContext("2d").createImageData(W, H);
  for (let p = 0; p < N; p++) im.data.set(heat(COV.map[p]), p * 4);
  c.getContext("2d").putImageData(im, 0, 0); OV.cov = c;
}
function buildSalOverlay() {
  const { W, H, N } = A, c = makeCanvas(W, H), im = c.getContext("2d").createImageData(W, H);
  for (let p = 0; p < N; p++) im.data.set(heat(SAL.map[p]), p * 4);
  c.getContext("2d").putImageData(im, 0, 0); OV.sal = c;
}

/* ============ playback ============ */
const Player = { ctx: null, G: null, playing: false, startTime: 0, fromBeat: 0, idx: 0, notes: [], timer: null, score: null, pausedBeat: 0, stopAt: Infinity, audition: false };
function ensureCtx() {
  if (!Player.ctx) {
    // on iPhone, Web Audio is muted by the silent switch unless the page says it plays music
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* not supported */ }
    const AC = window.AudioContext || window.webkitAudioContext; Player.ctx = new AC();
  }
  if (Player.ctx.state === "suspended") Player.ctx.resume();
  return Player.ctx;
}
function currentBeat() {
  if (!Player.playing) return Player.pausedBeat;
  return Player.fromBeat + Math.max(0, Player.ctx.currentTime - Player.startTime) * (Player.score.bpm / 60);
}
function startPlayback(fromBeat = 0, stopAt = null) {
  if (!SCORE) return;
  stopPlayback();
  const ctx = ensureCtx(), sc = SCORE;
  Player.G = buildGraph(ctx, P.reverb, P.mix, effFx(sc), sc.bpm, sc.extra || []);
  // the logo listens: an analyser on the master moves its sound waves while the song plays
  Player.an = ctx.createAnalyser(); Player.an.fftSize = 512; Player.an.smoothingTimeConstant = 0.72; Player.G.out.connect(Player.an); Player.G.sidechain = sc.sidechain ?? ((RULES[sc.style] || {}).sidechain || 0); Player.score = sc; Player.playing = true;
  // sampled instruments: route the persistent samplers into this graph
  const SG = liveSamples(); Player.G.samplers = SG.samplers; Player.G.kit = kitName();
  for (const l of Object.keys(SG.bus)) { try { SG.bus[l].disconnect(); } catch (e) { /* not connected */ } if (Player.G.bus[l]) SG.bus[l].connect(Player.G.bus[l]); }
  Player.fromBeat = fromBeat; Player.startTime = ctx.currentTime + 0.08;
  Player.audition = stopAt !== null; Player.stopAt = stopAt ?? sc.total;
  const until = Player.audition ? stopAt : Infinity;
  Player.notes = sc.notes
    .filter(n => (n.t >= fromBeat - 1e-6 && n.t < until) || (n.layer === "pad" && n.t < fromBeat && n.t + n.dur > fromBeat))
    .map(n => ({ n, s: Math.max(n.t, fromBeat) })).sort((a, b) => a.s - b.s);
  scheduleExpression(Player.G, sc, fromBeat, Player.startTime);
  Player.idx = 0; schedTick(); Player.timer = setInterval(schedTick, 40);
  updatePlayBtn(); requestAnimationFrame(frame);
}
function schedTick() {
  const ctx = Player.ctx, sc = Player.score, spb = 60 / sc.bpm, now = ctx.currentTime, horizon = now + 0.35;
  while (Player.idx < Player.notes.length) {
    const { n, s } = Player.notes[Player.idx];
    const t0 = Player.startTime + (s - Player.fromBeat) * spb;
    if (t0 > horizon) break;
    let end = n.t + n.dur; if (Player.audition) end = Math.min(end, Player.stopAt);
    playNote(Player.G, n, Math.max(t0, now), Math.max(0.05, (end - s) * spb), s);
    Player.idx++;
  }
  if (currentBeat() >= Player.stopAt + (Player.audition ? 0 : 0.25)) {
    const aud = Player.audition; stopPlayback(); Player.pausedBeat = aud ? Player.pausedBeat : 0; drawAll();
  }
}
function stopPlayback() {
  if (Player.timer) clearInterval(Player.timer); Player.timer = null;
  if (Player.G) {
    const G = Player.G, ctx = Player.ctx;
    G.master.gain.cancelScheduledValues(ctx.currentTime); G.master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    setTimeout(() => { try { G.master.disconnect(); } catch (e) { /* already disconnected */ } }, 400);
    Player.G = null;
  }
  Player.playing = false; Player.an = null; updatePlayBtn(); logoWaves(null);
}
// The logo's six sound waves follow the music: each one a band of the spectrum, low to high, from
// a third of its height when quiet to its full height and a little more when loud. Still when the
// song is stopped, or when the system asks for less motion.
let LOGO_BINS = null;
function logoWaves(an) {
  const ws = document.querySelectorAll("#brandLogo .wv"); if (!ws.length) return;
  if (!an || reduceMotion) { ws.forEach(w => (w.style.transform = "")); return; }
  const n = an.frequencyBinCount; if (!LOGO_BINS || LOGO_BINS.length !== n) LOGO_BINS = new Uint8Array(n);
  an.getByteFrequencyData(LOGO_BINS);
  const sr = an.context.sampleRate, edges = [60, 160, 400, 900, 2000, 4500, 10000];
  ws.forEach((w, i) => {
    const a = Math.max(1, Math.floor((edges[i] / (sr / 2)) * n)), b = Math.max(a + 1, Math.floor((edges[i + 1] / (sr / 2)) * n));
    let m = 0; for (let k = a; k < b && k < n; k++) m = Math.max(m, LOGO_BINS[k]);
    w.style.transform = `scaleY(${(0.33 + 0.92 * Math.pow(m / 255, 1.4)).toFixed(3)})`;
  });
}
let restartT = 0;
function scheduleRestart() {
  clearTimeout(restartT);
  if (!Player.playing || Player.audition) return;
  restartT = setTimeout(() => { if (Player.playing && !Player.audition) startPlayback(Math.max(0, Math.min(currentBeat(), SCORE.total - 0.05))); }, 150);
}
// The piece is final only when the neural models it uses have answered: until then Play waits
// (pressing it again cancels), so what you hear is what the export and the recipe hold.
let WAIT_PLAY = false;
const jobsPending = () => !!(STORY.job || GROOVE.job || ATTN.job);
function togglePlay() {
  if (!SCORE) return;
  if (WAIT_PLAY) { WAIT_PLAY = false; updatePlayBtn(); return; }
  if (Player.playing && !Player.audition) { Player.pausedBeat = currentBeat(); stopPlayback(); drawAll(); return; }
  if (jobsPending() || dirty) { ensureCtx(); WAIT_PLAY = true; updatePlayBtn(); return; }
  const from = Player.pausedBeat >= SCORE.total ? 0 : Player.pausedBeat;
  startPlayback(from);
}
function audition(i) {
  const F = SCORE.points[i]; if (!F) return;
  SEL = i; renderPoint(); Player.pausedBeat = F.t0;
  startPlayback(F.t0, F.t1);
}
// the mixer's effects, with the style's own distortion on its guitars (rock, metal)
const effFx = (sc = SCORE) => (sc ? styleFx(P.fx, sc.style, sc.inst, RULES) : P.fx);
function applyMixLive() { if (Player.G) updateGraph(Player.G, effFx(Player.score), P.mix, P.reverb); }
function updatePlayBtn() {
  const b = $("#play"), on = Player.playing && !Player.audition, wait = WAIT_PLAY && !on;
  const label = wait ? "Starts when the models are ready (press to cancel)" : on ? "Pause" : "Play";
  const state = wait ? "wait" : on ? "pause" : "play";
  if (b.dataset.state === state) return;
  b.dataset.state = state; b.setAttribute("aria-label", label); b.title = wait ? label : "";
  b.classList.toggle("waiting", wait);
  b.innerHTML = wait ? '<span class="spin" aria-hidden="true"></span>' : on ? ICON.pause : ICON.play;
}
let lastPoint = -1;
function frame() {
  if (!Player.playing) { lastPoint = -1; drawAll(); return; }
  const beat = currentBeat(), sc = Player.score;
  logoWaves(Player.an);
  const fi = sc.points.findIndex(F => beat >= F.t0 && beat < F.t1);
  if (fi >= 0 && fi !== lastPoint && sc === SCORE) { lastPoint = fi; SEL = fi; renderPoint(); }
  drawAll(); requestAnimationFrame(frame);
}
function selectPoint(i) {
  if (!SCORE || !SCORE.points.length) return;
  SEL = (i + SCORE.points.length) % SCORE.points.length; renderPoint(); drawAll();
}

/* ============ drawing: stage ============ */
let stageGeom = { w: 0, h: 0 };
function hexA(hex, a) {
  const h = hex.replace("#", ""), n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function drawAll() { drawStage(); drawTimeline(); updateReadout(); }
function drawStage() {
  const cv = $("#stage"); if (!SRC) return;
  if (exportView() && SCORE) { drawVideoPreview(cv); return; }
  const wrap = $("#lightbox"), ar = SRC.height / SRC.width;
  const small = window.matchMedia("(max-width: 980px)").matches;
  const cw = wrap.clientWidth - 16, chMax = small ? Math.min(window.innerHeight * 0.6, cw * ar) : wrap.clientHeight - 16;
  let w = cw, h = cw * ar;
  if (h > chMax) { h = chMax; w = h / ar; }
  if (small) wrap.style.height = h + 16 + "px";
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + "px"; cv.style.height = h + "px"; }
  stageGeom = { w, h };
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(SRC, 0, 0, w, h);
  if (view !== "img" && A) {
    g.fillStyle = "rgba(6,10,18,0.6)"; g.fillRect(0, 0, w, h);
    if (view === "sal" && OV.sal) g.drawImage(OV.sal, 0, 0, w, h);
    if (view === "edge" && OV.edge) g.drawImage(OV.edge, 0, 0, w, h);
    if (view === "reg" && OV.reg) { g.imageSmoothingEnabled = false; g.drawImage(OV.reg, 0, 0, w, h); g.imageSmoothingEnabled = true; }
  }
  if (SEM && SEM.objects) {
    g.save(); g.setLineDash([5, 4]); g.lineWidth = 1.5; g.font = '500 12px "Geist", system-ui, sans-serif';
    for (const o of SEM.objects) {
      g.strokeStyle = "rgba(255,255,255,0.75)"; g.strokeRect(o.x * w, o.y * h, o.w * w, o.h * h);
      const tw = g.measureText(o.name).width + 10;
      g.fillStyle = "rgba(8,12,20,0.8)"; g.fillRect(o.x * w, Math.max(0, o.y * h - 18), tw, 18);
      g.fillStyle = "#fff"; g.fillText(o.name, o.x * w + 5, Math.max(13, o.y * h - 5));
    }
    g.restore();
  }
  if (view === "cov" && OV.cov) { g.fillStyle = "rgba(6,10,18,0.6)"; g.fillRect(0, 0, w, h); g.drawImage(OV.cov, 0, 0, w, h); }
  if (!showPath || !SCORE) return;
  drawZones(g, w, h);
  const fx = SCORE.points, acc = css("--accent") || "#6D5DF0", diag = Math.hypot(w, h);
  g.lineWidth = 1.6; g.strokeStyle = hexA(acc, 0.85); g.lineJoin = "round";
  g.beginPath(); fx.forEach((F, i) => (i ? g.lineTo(F.x * w, F.y * h) : g.moveTo(F.x * w, F.y * h))); g.stroke();
  const beat = currentBeat(), cur = Player.playing ? fx.findIndex(F => beat >= F.t0 && beat < F.t1) : -1;
  // connections: a dot on the path where each passage note comes from (lit while it plays)
  const pnotes = SCORE.notes.filter(n => n.passage && n.layer === "lead");
  for (const n of pnotes) {
    const A0 = fx[n.passage.from], B0 = fx[n.passage.to]; if (!A0 || !B0) continue;
    const px = (A0.x + (B0.x - A0.x) * n.passage.f) * w, py = (A0.y + (B0.y - A0.y) * n.passage.f) * h, on = Player.playing && beat >= n.t && beat < n.t + n.dur;
    g.beginPath(); g.arc(px, py, on ? 4.5 : 2.6, 0, Math.PI * 2); g.fillStyle = on ? "#fff" : hexA(acc, 0.95); g.fill();
  }
  // points at the same position (revisits) share one marker with all their numbers
  const groups = new Map();
  fx.forEach((F, i) => { const k = F.x.toFixed(5) + "," + F.y.toFixed(5); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  for (const idxs of groups.values()) {
    const F = fx[idxs[0]], x = F.x * w, y = F.y * h, R = Math.max(6, F.r * diag), sel = idxs.includes(SEL), pinned = F.source === "manual";
    g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fillStyle = hexA(acc, sel ? 0.22 : 0.13); g.fill();
    g.strokeStyle = hexA(acc, pinned ? 0.95 : 0.65); g.lineWidth = pinned ? 1.8 : 1.1; g.stroke();
    if (idxs.includes(cur)) {
      const ph = reduceMotion ? 0.5 : (beat - fx[cur].t0) / fx[cur].dur;
      g.beginPath(); g.arc(x, y, R + 4 + ph * 10, 0, Math.PI * 2); g.strokeStyle = `rgba(255,255,255,${1 - ph * 0.8})`; g.lineWidth = 2.5; g.stroke();
    }
    if (sel) {
      g.save(); g.setLineDash([3, 3]); g.beginPath(); g.arc(x, y, R + 3, 0, Math.PI * 2); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.stroke(); g.restore();
      const hx = x + (R + 3) * Math.SQRT1_2, hy = y - (R + 3) * Math.SQRT1_2;
      g.beginPath(); g.arc(hx, hy, 5, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill(); g.strokeStyle = acc; g.lineWidth = 2; g.stroke();
    }
    const label = idxs.map(k => k + 1).join("·");
    g.font = '600 10.5px "Geist", system-ui, sans-serif'; const tw = Math.max(18, g.measureText(label).width + 9);
    g.beginPath(); g.roundRect ? g.roundRect(x - tw / 2, y - 9, tw, 18, 9) : g.arc(x, y, 9, 0, Math.PI * 2); g.fillStyle = sel ? "#fff" : acc; g.fill();
    g.fillStyle = sel ? "#0B0D11" : (css("--accent-ink") || "#fff"); g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(label, x, y + 0.5);
  }
  g.textAlign = "start"; g.textBaseline = "alphabetic";
}

/* ============ drawing: timeline ============ */
let tlGeom = null;
function drawTimeline() {
  const cv = $("#roll"), wrap = cv.parentElement; if (!SCORE) return;
  const laneH = parseFloat(css("--lane-h")) || 36, rulerH = parseFloat(css("--ruler-h")) || 26;
  const LANE_KEYS = laneKeys(), w = wrap.clientWidth, h = rulerH + laneH * LANE_KEYS.length, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + "px"; }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sc = SCORE, padL = 6, padR = 10, X = b => padL + (b / sc.total) * (w - padL - padR);
  tlGeom = { X, padL, padR, w };
  g.clearRect(0, 0, w, h);
  const text2 = css("--text-2"), text3 = css("--text-3"), line = css("--line"), text = css("--text"), acc = css("--accent");
  // tension along the arc: a band at the top of the ruler, stronger where the tension is higher
  sc.points.forEach(F => { g.fillStyle = hexA(acc, 0.08 + 0.5 * clamp(((F.tension ?? 0.6) - 0.2) / 0.8)); g.fillRect(X(F.t0), 0, X(F.t1) - X(F.t0), 3); });
  // selected point band, point dividers, bar lines
  sc.points.forEach((F, i) => {
    const x0 = X(F.t0), x1 = X(F.t1);
    if (i === SEL) { g.fillStyle = hexA(acc, 0.1); g.fillRect(x0, 0, x1 - x0, h); g.fillStyle = acc; g.fillRect(x0, rulerH - 2, x1 - x0, 2); }
  });
  g.fillStyle = line;
  for (let l = 1; l < LANE_KEYS.length; l++) g.fillRect(0, rulerH + l * laneH, w, 1);
  g.fillRect(0, rulerH, w, 1);
  // the columns match the ruler: each place's edges run down through the lanes (as do the intro's
  // and the ending's); the bars are faint dotted lines behind them
  g.save(); g.globalAlpha = 0.55; g.setLineDash([2, 3]); g.strokeStyle = line; g.lineWidth = 1; g.beginPath();
  for (let b = 0; b <= sc.total + 1e-9; b += 4) { const x = Math.round(X(b)) + 0.5; g.moveTo(x, rulerH); g.lineTo(x, h); }
  g.stroke(); g.restore();
  const edges = new Set([0, sc.total, ...sc.points.map(F => F.t0), ...sc.points.map(F => F.t1), ...(sc.intro ? [sc.intro] : []), ...(sc.cadence ? [sc.cadence.t] : [])].map(v => Math.round(v * 1000) / 1000));
  g.fillStyle = hexA(text3, 0.4);
  for (const b of edges) g.fillRect(Math.round(X(b)), rulerH, 1, h - rulerH);
  g.globalAlpha = 1;
  g.font = '500 10.5px "Geist Mono", ui-monospace, monospace'; g.textAlign = "center"; g.textBaseline = "middle";
  sc.points.forEach((F, i) => {
    const x0 = X(F.t0), x1 = X(F.t1);
    g.fillStyle = hexA(text3, 0.35); g.fillRect(x0, 5, 1, rulerH - 10);
    if (x1 - x0 > 14) { g.fillStyle = i === SEL ? text : text2; g.fillText(String(i + 1), (x0 + x1) / 2, rulerH / 2); }
  });
  // the generated intro and ending, named over the ruler like the places
  g.font = '500 10.5px "Geist", system-ui, sans-serif';
  if (sc.intro > 0 && X(sc.intro) - X(0) > 30) { g.fillStyle = text3; g.fillText("Intro", (X(0) + X(sc.intro)) / 2, rulerH / 2); }
  if (sc.cadence) {
    const xc = X(sc.cadence.t);
    g.fillStyle = hexA(text3, 0.35); g.fillRect(xc, 5, 1, rulerH - 10);
    if (X(sc.total) - xc > 30) { g.fillStyle = text3; g.fillText("End", (xc + X(sc.total)) / 2, rulerH / 2); }
  }
  // notes per lane
  LANE_KEYS.forEach((l, li) => {
    const y0 = rulerH + li * laneH + 5, lh = laneH - 10, col = laneColor(l);
    const on = audible(P.mix, l), ns = sc.notes.filter(n => n.layer === l);
    g.globalAlpha = on ? 1 : 0.18; g.fillStyle = col;
    if (l === "perc") {
      const PH = { 36: 1, 38: 0.8, 39: 0.8, 45: 0.7, 48: 0.7, 50: 0.7, 49: 0.9 };
      for (const n of ns) { const hh = lh * (PH[n.midi] || 0.45); g.globalAlpha = (on ? 1 : 0.18) * (0.45 + 0.55 * n.vel / 127); g.fillRect(X(n.t), y0 + (lh - hh), 1.5, hh); }
    } else if (ns.length) {
      const lo = Math.min(...ns.map(n => n.midi)), hi = Math.max(...ns.map(n => n.midi)), span = Math.max(1, hi - lo);
      const rowH = Math.max(2, Math.min(4, lh / (span + 1)));
      for (const n of ns) {
        const y = y0 + (1 - (n.midi - lo) / span) * (lh - rowH);
        g.globalAlpha = (on ? 1 : 0.18) * (l === "pad" ? 0.55 : 0.95);
        g.fillRect(X(n.t), y, Math.max(1.5, X(n.t + n.dur) - X(n.t) - 1), rowH);
      }
    }
  });
  g.globalAlpha = 1;
  const beat = currentBeat();
  if (beat > 0 || Player.playing) { const x = X(Math.min(beat, sc.total)); g.fillStyle = text; g.fillRect(x - 0.75, 0, 1.5, h); }
  g.textAlign = "start"; g.textBaseline = "alphabetic";
}

/* ============ text panels ============ */
function updateReadout() {
  if (!SCORE) return;
  const sc = SCORE, spb = 60 / sc.bpm;
  $("#rKey").textContent = `${pcName(sc.pc)} ${sc.pent ? (sc.major ? "major pentatonic" : "minor pentatonic") : MODES[sc.modeKey].name.split(" ")[0]}`;
  $("#rMeta").textContent = `${nf1(sc.bpm)} BPM · ${sc.bars} bars · ${sc.points.length} points`;
  $("#rTime").textContent = `${ftime(Math.min(currentBeat(), sc.total) * spb)} / ${ftime(sc.total * spb)}`;
  const sk = $("#seek"); if (!SEEK.drag) { sk.value = Math.round(clamp(currentBeat() / sc.total) * 1000); sk.style.setProperty("--p", sk.value / 10 + "%"); }
}
// the position bar in the top bar: drag to choose where the song plays from (it keeps playing if it was)
const SEEK = { drag: false, wasPlaying: false };
function initSeek() {
  const sk = $("#seek");
  const beatOf = () => (Number(sk.value) / 1000) * (SCORE ? SCORE.total : 0);
  sk.addEventListener("input", () => {
    if (!SCORE) return;
    if (!SEEK.drag) { SEEK.drag = true; SEEK.wasPlaying = Player.playing && !Player.audition; if (Player.playing) stopPlayback(); }
    Player.pausedBeat = Math.min(beatOf(), SCORE.total - 0.05); sk.style.setProperty("--p", sk.value / 10 + "%");
    const i = SCORE.points.findIndex(F => Player.pausedBeat >= F.t0 && Player.pausedBeat < F.t1); if (i >= 0 && i !== SEL) { SEL = i; renderPoint(); }
    drawAll();
  });
  sk.addEventListener("change", () => {
    if (!SCORE) return;
    const beat = Math.min(beatOf(), SCORE.total - 0.05), play = SEEK.wasPlaying; SEEK.drag = false; SEEK.wasPlaying = false;
    if (play) startPlayback(beat); else { Player.pausedBeat = beat; drawAll(); }
  });
}
function renderPieceNotes() {
  const sc = SCORE;
  const minB = Math.max(1, (RULES[sc.style] || {}).grid || 1), fits = Math.floor((sc.body - (sc.intro || 0)) / minB);
  SL.count.setMax(Math.max(2, Math.min(32, fits)));
  const places = new Set(sc.points.map(q => q.revisitOf ?? q.index)).size, back = sc.points.length - places;
  SL.count.setNote(sc.truncated > 0 ? `At this duration the piece fits at most ${fits} segments (${minB === 1 ? "one beat" : minB + " beats"} each); the first ${sc.points.length} are used.` : PATH.mode !== "manual" && places < P.count ? `The image only offered ${places} distinct places at this inhibition radius.` : "");
  SL.returns.setNote(PATH.mode === "manual" ? "" : `${places} places, ${back} ${back === 1 ? "return" : "returns"}: ${sc.points.length} segments in the piece.`);
  SL.tempoAdj.setNote(`Result: ${nf1(sc.bpm)} BPM, ${sc.bars} whole bars in ${sc.seconds} s.`);
  const ci = sc.arc ? sc.arc.climax : -1;
  SL.arc.setNote(ci >= 0 && sc.arc.amount > 0.25 ? `Climax at focus point ${ci + 1} (${ftime(sc.points[ci].t0 * 60 / sc.bpm)}), the most striking new place of the second half.` : "");
}
function renderGlobal() {
  const sc = SCORE, g = A.global, rows = [], spb = 60 / sc.bpm;
  const hueTxt = g.hueStr > 0.06 ? `dominant hue ${Math.round(g.hue)}°, read on the circle of fifths` : "the image is nearly colourless, so the key comes from brightness";
  rows.push(["Key", pcName(sc.pc), sc.keyManual ? "chosen by hand" : hueTxt]);
  rows.push(["Mode", sc.scaleManual ? (SCALES.find(x => x[0] === P.scale) || [0, MODES[sc.modeKey].name])[1] : MODES[sc.modeKey].name, sc.scaleManual ? "chosen by hand" : `brightness ${nf(g.brightness)}, warmth ${nf(g.warmth01)}, saturation ${nf(g.sat)}`]);
  rows.push(["Tempo", `${nf1(sc.bpm)} BPM`, `the style asks for ${nf(sc.bpmStyle, 1)} BPM from the image energy (edges ${nf(g.edgeN)}, entropy ${nf(g.entropy)}); rounded to ${sc.bars} whole bars so the piece lasts exactly ${sc.seconds} s`]);
  {
    const I = sc.intro || 0, E = sc.total - sc.body, places = sc.body - I, bars = b => `${b / 4} bar${b === 4 ? "" : "s"}`;
    const parts = [`${places} beats split between focus points by weight (${nf(places * spb, 1)} s)`];
    if (I) parts.push(`an intro of ${bars(I)} (${nf(I * spb, 1)} s)`);
    parts.push(E ? `an ending of ${bars(E)} on the tonic (${nf(E * spb, 1)} s)` : "no ending");
    rows.push(["Duration", `${sc.seconds} s`, parts.join(", ").replace(/, ([^,]*)$/, ", and $1")]);
  }
  rows.push(["Timbre", "relative to the image", "each area is compared with the image mean; the contrast shifts attack, legato, brightness, resonance and colour of the instruments within fixed bounds"]);
  rows.push(["Pad", `${Math.round(sc.bgArea * 100)}% background`, "areas that don't draw the eye hold a long chord with their average timbre"]);
  rows.push(["Motifs", `${sc.motifCount} families`, "regions grouped by colour and texture; returning to a family repeats its motif, varied"]);
  $("#globalDl").innerHTML = rows.map(([a, b, c]) => `<div class="row"><dt>${a}</dt><dd><strong>${esc(b)}</strong><span>${esc(c)}</span></dd></div>`).join("");
}

// Envelope of one layer, sampled for drawing: the note is held for 0.5 s, then released.
function envPoints(T) {
  const hold = 0.5, pts = [], a = T.a, tr = a + hold;
  const level = t => {
    if (t < a) return t / a;
    if (T.type === "pluck") return Math.exp((-6.9 * (Math.min(t, tr) - a)) / T.d) * (t <= tr ? 1 : Math.exp((-4 * (t - tr)) / T.r));
    const sus = T.s + (1 - T.s) * Math.exp((-3 * (Math.min(t, tr) - a)) / T.d);
    return t <= tr ? sus : sus * Math.exp((-4 * (t - tr)) / T.r);
  };
  const end = tr + T.r * 1.2;
  for (let i = 0; i <= 80; i++) { const t = (end * i) / 80; pts.push([t, level(t)]); }
  return pts;
}
function adsrSvg(list) {
  const W = 300, H = 80, top = 6, base = H - 4, tmax = Math.max(...list.map(([, T]) => T.a + 0.5 + T.r * 1.2));
  const paths = list.map(([l, T]) => {
    const d = envPoints(T).map(([t, y], i) => `${i ? "L" : "M"}${(2 + (t / tmax) * (W - 4)).toFixed(1)} ${(base - (base - top) * y).toFixed(1)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="var(--lane-${l})" stroke-width="1.8" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  }).join("");
  return `<svg class="adsr" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Envelopes of the layers"><line x1="2" y1="${base}" x2="${W - 2}" y2="${base}" class="base" vector-effect="non-scaling-stroke"/>${paths}</svg>`;
}
const MOD_TXT = {
  att: ["faster attack", "slower attack"], leg: ["more detached", "more legato"], bri: ["darker", "brighter"],
  res: ["drier", "more resonant"], col: ["cooler", "warmer"]
};
const SRC_KEY = { att: "sharp", leg: "smooth", bri: "ent", res: "sat", col: "warm" };
const PT = {};
function initPointEditor() {
  $("#pan-point").innerHTML = `<div id="pointHead"></div>
    <div class="pedit" id="pointEdit">
      <div class="field"><div class="flabel" id="lblMood">Role in the story</div><div class="seg seg-sm" id="moodSeg" role="radiogroup" aria-labelledby="lblMood"></div>
        <label class="toggle"><input type="checkbox" id="accentOn"><span>Accent (a hit on its first beat)</span></label></div>
      <div class="sliders" id="pointSliders"></div>
      <div class="pbtns">
        <button type="button" class="btn" data-hear>${ICON.listen}Listen</button>
        <button type="button" class="btn" data-move="-1" aria-label="Move earlier in the path">Earlier</button>
        <button type="button" class="btn" data-move="1" aria-label="Move later in the path">Later</button>
        <button type="button" class="btn btn-danger" data-del>Delete</button>
      </div>
      <p class="snote" id="pointSource"></p>
    </div>
    <div id="pointBody" class="pbody"></div>`;
  PT.vals = { r: DEFAULT_RADIUS, w: 0.5 };
  const defs = [
    { key: "r", label: "Area", min: 0.01, max: 0.5, step: 0.005, def: DEFAULT_RADIUS, scale: 100, unit: "%", dec: 1, help: "How much of the picture this spot takes in. The circle shows it." },
    { key: "w", label: "Importance", min: 0, max: 1, step: 0.01, def: 0.5, dec: 2, help: "How much this spot matters. Important spots last longer and play louder." }
  ];
  for (const d of defs) {
    const sl = makeSlider(d, PT.vals, (def, v) => editPoint(SEL, q => { q[def.key] = v; }));
    PT[d.key] = sl; $("#pointSliders").appendChild(sl.el);
  }
  // the point's role in the story (overrides the dramatic arc) and an accent on its first beat
  PT.mood = makeSeg($("#moodSeg"), [["auto", "Auto"], ["calm", "Calm"], ["build", "Build"], ["climax", "Climax"], ["release", "Release"]], "auto", v => editPoint(SEL, q => {
    if (v === "climax") for (const o of PATH.points) if (o !== q && o.mood === "climax") delete o.mood; // one climax
    if (v === "auto") delete q.mood; else q.mood = v;
  }));
  $("#accentOn").addEventListener("change", e => editPoint(SEL, q => { if (e.target.checked) q.accent = true; else delete q.accent; }));
}
function renderPoint() {
  renderWhy();
  const sc = SCORE, host = $("#pointBody"); if (!sc) return;
  $("#pointEdit").hidden = !sc.points.length;
  if (!sc.points.length) { $("#pointHead").innerHTML = ""; host.innerHTML = '<p class="empty">No focus points. Use Add point on the stage, or switch the path to Auto.</p>'; return; }
  const F = sc.points[SEL], r = F.reg, st = STYLES[sc.style], S = F.tim.src;
  const panTxt = Math.abs(F.pan) < 0.08 ? "centre" : `${Math.round(Math.abs(F.pan) * 100)}% ${F.pan < 0 ? "left" : "right"}`;
  const stepTxt = F.idx === 0 ? "starts from the height in the image" : F.step > 0 ? `rises ${F.step} steps (upward saccade)` : `falls ${-F.step} steps (downward saccade)`;
  const kv = rows => rows.map(([a, b, c]) => `<div class="kv"><dt>${a}</dt><dd>${esc(b)}${c ? `<span>${esc(c)}</span>` : ""}</dd></div>`).join("");
  const maxE = sc.stats.maxE;
  const mods = DIMS.map(d => {
    const m = F.tim.m[d], k = SRC_KEY[d], left = m < 0 ? 50 + m * 50 : 50, wd = Math.abs(m) * 50;
    const txt = Math.abs(m) < 0.1 ? "close to the instrument" : MOD_TXT[d][m < 0 ? 0 : 1];
    return `<div class="mod"><b>${DIM_NAME[d]}</b><span class="mbar" aria-hidden="true"><i style="left:${left}%;width:${wd}%"></i></span><span>${txt}</span>
      <small>${DIM_SOURCE[d]} ${nf(S[k])}, image mean ${nf(sc.stats.mu[k])}</small></div>`;
  }).join("");
  const prow = l => { const T = F.tim[l]; return `<tr><td>${LAYER_NAME[l]}<span>${esc(sc.inst[l].name)}</span></td><td>${fsec(T.a)}</td><td>${fsec(T.type === "pluck" ? T.d : T.r)}</td><td>${fhz(T.cut)}</td><td>${nf(T.q, 1)}</td></tr>`; };
  $("#pointHead").innerHTML = `<div class="pointhead"><div><h2>Focus point ${F.idx + 1} <span>of ${sc.points.length}</span></h2>
      <p class="sub">Family ${F.letter}, ${ordinal(F.visit)}${F.variant !== "original" ? ` (${F.variant})` : ""}${F.obj ? `, on “${esc(F.obj.name)}”` : ""}</p></div>
      <div class="nav"><button type="button" class="icon-btn" data-nav="-1" aria-label="Previous focus point">${ICON.prev}</button><button type="button" class="icon-btn" data-nav="1" aria-label="Next focus point">${ICON.next}</button></div></div>`;
  PT.vals.r = F.r; PT.vals.w = F.w ?? F.s; PT.r.set(PT.vals.r, false); PT.w.set(PT.vals.w, false);
  PT.mood.set(F.mood || "auto"); $("#accentOn").checked = !!F.accent;
  $("#pointSource").textContent = F.revisitOf !== null && F.revisitOf !== undefined ? `The eye came back to point ${F.revisitOf + 1} here, so it sits in the same place.` : F.source === "manual" ? "You placed or moved this one." : "The app placed this spot. Move it and the path is yours to edit.";
  $("[data-move='-1']").disabled = SEL === 0; $("[data-move='1']").disabled = SEL >= sc.points.length - 1;
  host.innerHTML = `
    <div class="share"><div class="sharebar"><span style="width:${(F.share * 100).toFixed(1)}%"></span></div>
      <p>${nf(F.sec, 1)} s of ${sc.seconds} s (${Math.round(F.share * 100)}%), ${nf1(F.dur)} beats. Saliency here ${nf(F.s)}.</p></div>
    <h3>Timbre</h3>
    ${adsrSvg([["lead", F.tim.lead], ["harm", F.tim.harm], ["bass", F.tim.bass]])}
    <div class="legend"><span style="--dot:var(--lane-lead)">${esc(sc.inst.lead.name)}</span><span style="--dot:var(--lane-harm)">${esc(sc.inst.harm.name)}</span><span style="--dot:var(--lane-bass)">${esc(sc.inst.bass.name)}</span></div>
    <div class="mods">${mods}</div>
    <table class="ptab"><thead><tr><th>Layer</th><th>Attack</th><th>Decay</th><th>Filter</th><th>Q</th></tr></thead>
      <tbody>${prow("lead")}${prow("harm")}${prow("bass")}</tbody></table>
    ${F.obj && CAT[F.obj.category] && P.wSem > 0 ? `<p class="note">The object “${esc(F.obj.name)}” pulls the timbre toward ${CAT[F.obj.category].label}.</p>` : ""}
    <h3>Music</h3>
    <dl>${kv([
      ["Arc", `${SECTION_NAME[F.section] || "Development"}, tension ${nf(F.tension ?? 0.6)}`, F.section === "climax" ? "the melody is doubled an octave above" : F.section === "intro" ? "texture only: the bass and the drum backbone enter after it" : F.section === "resolution" ? "the arrangement thins toward the cadence" : "density and dynamics follow the tension"],
      ["Melody", F.lead.map(midiName).join("  "), F.story ? (P.melody === "improv" ? "improvised over the chords (Magenta ImprovRNN) on this place's theme" : "story melody (Magenta), shaped by this place and the next") : stepTxt],
      ["Chord", `${romanOf(F.root, sc.modeIv)} (${F.chord.map(m => pcName(m)).join(" ")})`, r.L > 0.5 ? "bright area: stable functions" : "dark area: relative functions"],
      ["Harmony plays", HARM_NAME[F.harmKind] || "held chord", F.harmKind === "arp" ? "complex area or climax" : F.harmKind === "pulse" ? "rough area" : F.harmKind === "broken" ? "moderate texture" : "smooth area or quiet moment"],
      ["Bass", midiName(F.bass), BASS_NAME[F.bassKind] || ""],
      ["Drums", F.hits ? `${F.hits} hits` : "none", (F.drums || []).join(", ")],
      ["Stereo", panTxt, "from the horizontal position"]])}</dl>
    <h3>Area</h3>
    <dl>${kv([["Saliency", nf(F.s), ""], ["Brightness", nf(r.L), ""], ["Saturation", nf(r.sat), ""],
      ["Edges", nf(clamp(r.edge / maxE)), ""],
      ["Entropy", nf(r.entropy), ""]])}</dl>`;
}
function renderLanes() {
  const st = STYLES[P.style], host = $("#lanesHead"), LANE_KEYS = laneKeys(), sig = LANE_KEYS.join(",");
  if (host.dataset.keys !== sig) {
    // lanes follow the layers of the score (extra layers come and go with the orchestration)
    host.querySelectorAll(".lane").forEach(e => e.remove());
    host.insertAdjacentHTML("beforeend", LANE_KEYS.map(l => `<div class="lane" data-layer="${l}" style="--dot:${laneColor(l)}">
      <span class="lname"><span class="lt">${esc(layerName(l))}</span><em></em></span>
      <span class="ms"><button type="button" data-act="mute" aria-pressed="false" aria-label="Mute ${esc(layerName(l))}" title="Mute">M</button><button type="button" data-act="solo" aria-pressed="false" aria-label="Solo ${esc(layerName(l))}" title="Solo">S</button></span>
      <input type="range" min="0" max="1.5" step="0.01" value="${P.mix[l] ? P.mix[l].vol : 1}" aria-label="${esc(layerName(l))} volume" style="--p:${(((P.mix[l] ? P.mix[l].vol : 1) / 1.5) * 100).toFixed(1)}%"></div>`).join(""));
    host.dataset.keys = sig;
  }
  if (!host.dataset.bound) {
    host.dataset.bound = "1";
    host.addEventListener("click", e => {
      const b = e.target.closest(".ms button"); if (!b) return;
      const l = b.closest(".lane").dataset.layer, k = b.dataset.act;
      P.mix[l][k] = !P.mix[l][k]; applyMixLive(); renderLanes(); drawTimeline();
    });
    host.addEventListener("input", e => {
      if (e.target.type !== "range") return;
      const l = e.target.closest(".lane").dataset.layer, v = Number(e.target.value);
      P.mix[l].vol = v; e.target.style.setProperty("--p", ((v / 1.5) * 100).toFixed(1) + "%"); applyMixLive();
    });
  }
  for (const l of LANE_KEYS) {
    const s = host.querySelector(`.lane[data-layer="${l}"]`);
    // the colour is set every time: a layer's role (and so its colour) or the theme can change
    s.style.setProperty("--dot", laneColor(l));
    const iname = l === "perc" ? PERC_NAME[P.style] : ((SCORE && SCORE.inst[l]) || st.inst[l] || { name: "" }).name;
    s.querySelector("em").textContent = iname; s.querySelector(".lname").title = `${layerName(l)}: ${iname}`;
    s.querySelector('[data-act="mute"]').setAttribute("aria-pressed", String(P.mix[l].mute));
    s.querySelector('[data-act="solo"]').setAttribute("aria-pressed", String(P.mix[l].solo));
    s.classList.toggle("off", !audible(P.mix, l));
  }
}

/* ============ Expert rules (src/core/expert.js) ============ */
// The list in Piece (Expert): each rule is a condition on the places and an action there. Zones are
// drawn on the picture; the matching places are named under each rule.
let ZONE = null; // { id, drawing }: the rule whose zone is being drawn
const MAIN_LAYERS = () => [["lead", "Melody"], ["harm", "Harmony"], ["bass", "Bass"], ["pad", "Pad"], ["perc", "Rhythm"], ...((SCORE && SCORE.extra) || []).filter(L => !L.only).map(L => [L.id, ROLES[L.role].name + (L.name ? ": " + L.name : "")])];
function drawZones(g, w, h) {
  if (UI.mode !== "expert") return;
  const acc = css("--accent") || "#6D5DF0";
  (P.expert || []).forEach((r, k) => {
    const z = r.when && r.when.type === "zone" && r.when.zone; if (!z) return;
    const x = Math.min(z.x0, z.x1) * w, y = Math.min(z.y0, z.y1) * h, zw = Math.abs(z.x1 - z.x0) * w, zh = Math.abs(z.y1 - z.y0) * h;
    g.save(); g.setLineDash([6, 4]); g.lineWidth = 1.6; g.strokeStyle = r.on === false ? "rgba(255,255,255,0.4)" : acc; g.fillStyle = hexA(acc, 0.1);
    g.fillRect(x, y, zw, zh); g.strokeRect(x, y, zw, zh); g.setLineDash([]);
    g.font = '600 12px "Geist", system-ui, sans-serif'; const label = `Rule ${k + 1}`, tw = g.measureText(label).width + 10;
    g.fillStyle = acc; g.fillRect(x, Math.max(0, y - 18), tw, 18); g.fillStyle = "#fff"; g.fillText(label, x + 5, Math.max(13, y - 5));
    g.restore();
  });
}
function initExpert() {
  const host = $("#expertList");
  $("#expertAdd").addEventListener("click", () => {
    const id = (P.expert || []).reduce((m, r) => Math.max(m, r.id), 0) + 1;
    const r = newRule(id);
    if (SCORE && SCORE.points.length) r.when.point = 1;
    const band = STYLE_BAND[P.style] || []; if (band.length) { r.do.preset = band[0][0]; r.do.role = band[0][1]; }
    P.expert = [...(P.expert || []), r]; renderExpert(); invalidate(LV.MUSIC);
  });
  // a field: data-f="when.point" etc.; numbers stay numbers
  host.addEventListener("change", e => {
    const el = e.target, li = el.closest("li[data-id]"), f = el.dataset.f; if (!li || !f) return;
    const r = P.expert.find(q => q.id === Number(li.dataset.id)); if (!r) return;
    if (f === "on") r.on = el.checked;
    else { const [part, key] = f.split("."), v = el.type === "number" || /^-?\d+(\.\d+)?$/.test(el.value) ? Number(el.value) : el.value; r[part][key] = v;
      // sensible tracks when the action changes: dynamics on every track, silence on one
      if (f === "do.type") { if (v === "dynamics") r.do.layer = "all"; else if (v === "mute" && (!r.do.layer || r.do.layer === "all")) r.do.layer = "perc"; } }
    renderExpert(); invalidate(LV.MUSIC);
  });
  host.addEventListener("click", e => {
    const b = e.target.closest("[data-act]"), li = e.target.closest("li[data-id]"); if (!b || !li) return;
    const id = Number(li.dataset.id), r = P.expert.find(q => q.id === id); if (!r) return;
    if (b.dataset.act === "del") { P.expert = P.expert.filter(q => q.id !== id); if (ZONE && ZONE.id === id) ZONE = null; renderExpert(); invalidate(LV.MUSIC); }
    else if (b.dataset.act === "zone") { ZONE = { id, drawing: false }; flash("Drag on the picture to draw the zone."); renderExpert(); }
    else if (b.dataset.act === "inst") {
      const bandKeys = new Set((STYLE_BAND[P.style] || []).map(([k]) => k)), bandName = `${STYLES[P.style].name} band`;
      const items = Object.entries(LIBRARY).map(([k, v]) => ({ key: k, name: v.name, group: bandKeys.has(k) ? bandName : v.family || (v.type === "sample" ? "Recommended (sampled)" : "Synthesizers") }));
      items.sort((a, b2) => (b2.group === bandName) - (a.group === bandName) || a.group.localeCompare(b2.group));
      openPicker({ title: "Instrument for this rule", items, current: r.do.preset, searchLabel: "Search instruments", note: "It plays only where the rule applies, in the role you choose.",
        onPick: key => { r.do.preset = key; const band = (STYLE_BAND[P.style] || []).find(([k]) => k === key); r.do.role = band ? band[1] : roleFor(key, LIBRARY[key]); renderExpert(); invalidate(LV.MUSIC); },
        onPreview: key => preview(ensureCtx(), "harm", LIBRARY[key]) });
    }
  });
  renderExpert();
}
function renderExpert() {
  const host = $("#expertList"); if (!host) return;
  const rules = P.expert || [], n = SCORE ? SCORE.points.length : 0, spb = SCORE ? 60 / SCORE.bpm : 1;
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${esc(String(k))}"${String(k) === String(cur) ? " selected" : ""}>${esc(v)}</option>`).join("");
  const sel = (f, obj, cur, label) => `<span class="select"><select data-f="${f}" aria-label="${esc(label)}">${opt(obj, cur)}</select></span>`;
  const degs = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, SCORE ? romanOf(d, SCORE.modeIv) : ["I", "II", "III", "IV", "V", "VI", "VII"][d]]));
  host.innerHTML = rules.length ? rules.map((r, k) => {
    const w = r.when, d = r.do;
    const whenCtl = w.type === "point" ? sel("when.point", Object.fromEntries(Array.from({ length: Math.max(1, n) }, (_, i) => [i + 1, `Place ${i + 1}`])), w.point, "Which place")
      : w.type === "section" ? sel("when.section", SECTIONS, w.section, "Which part")
      : w.type === "colour" ? sel("when.colour", COLOURS, w.colour, "Which colour")
      : w.type === "zone" ? `<button type="button" class="btn btn-sm" data-act="zone">${ZONE && ZONE.id === r.id ? "Drag on the picture…" : w.zone ? "Redraw the zone" : "Draw the zone on the picture"}</button>`
      : `<input type="number" class="text-input" data-f="when.from" min="0" step="0.5" value="${w.from ?? 0}" aria-label="From second"> to <input type="number" class="text-input" data-f="when.to" min="0" step="0.5" value="${w.to ?? 5}" aria-label="To second"> s`;
    const doCtl = d.type === "play" ? `<button type="button" class="choose" data-act="inst" aria-haspopup="dialog"><span>${esc((LIBRARY[d.preset] || {}).name || "Choose an instrument")}</span></button>${sel("do.role", Object.fromEntries(Object.entries(ROLES).map(([k2, v]) => [k2, "as " + v.name.toLowerCase()])), d.role, "Its role")}`
      : d.type === "mute" ? sel("do.layer", Object.fromEntries(MAIN_LAYERS()), d.layer, "Which track")
      : d.type === "chord" ? sel("do.degree", degs, d.degree, "Which chord")
      : d.type === "octave" ? sel("do.octave", { "-2": "two octaves down", "-1": "an octave down", "1": "an octave up", "2": "two octaves up" }, d.octave, "How far")
      : `${sel("do.db", { "-12": "−12 dB", "-6": "−6 dB", "-3": "−3 dB", "3": "+3 dB", "6": "+6 dB", "12": "+12 dB" }, d.db, "How much")}${sel("do.layer", { all: "every track", ...Object.fromEntries(MAIN_LAYERS()) }, d.layer || "all", "Which track")}`;
    // where it applies now
    let where = "";
    if (SCORE) {
      if (w.type === "time") where = `Applies from ${w.from ?? 0} s to ${w.to ?? 0} s.`;
      else { const hits = SCORE.points.filter(F => pointMatches(w, F, spb)).map(F => F.idx + 1); where = hits.length ? `Applies at place${hits.length > 1 ? "s" : ""} ${hits.join(", ")}.` : w.type === "zone" && !w.zone ? "Draw the zone to choose the places." : "No place matches it now."; }
    }
    return `<li data-id="${r.id}" class="${r.on === false ? "off" : ""}"><div class="xr-head"><label class="toggle"><input type="checkbox" data-f="on"${r.on === false ? "" : " checked"}><span><b>Rule ${k + 1}</b></span></label>
      <button type="button" class="icon-btn" data-act="del" aria-label="Delete rule ${k + 1}" title="Delete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="xr-row"><span class="xr-k">When</span>${sel("when.type", CONDITIONS, w.type, "Condition")}${whenCtl}</div>
      <div class="xr-row"><span class="xr-k">Do</span>${sel("do.type", ACTIONS, d.type, "Action")}${doCtl}</div>
      <p class="snote">${esc(where)}</p></li>`;
  }).join("") : `<li class="empty">No rules yet. Add one, for example: in the climax, add a choir; at place 3, use chord IV; where it is blue, play softer.</li>`;
  drawStage();
}

/* ============ resizable layout: the panel, the timeline and the layer names ============ */
// Each size is a CSS variable, set by dragging its splitter (or with the arrow keys on it, Shift for
// bigger steps), reset by a double-click, and remembered in this browser. On phones the parts are
// stacked and the splitters are hidden.
const LAYOUT = {
  insp: { css: "--insp-w", def: 360, min: 340, max: () => Math.max(320, Math.min(820, window.innerWidth * 0.6)), axis: "x", sign: -1 },
  lane: { css: "--lane-h", def: 36, min: 24, max: () => 84, axis: "y", sign: -1, perLane: true },
  head: { css: "--head-w", def: 264, min: 230, max: () => Math.max(170, Math.min(520, window.innerWidth * 0.4)), axis: "x", sign: 1 }
};
function setLayout(k, v, save = true) {
  const L = LAYOUT[k], val = Math.round(clamp(v, L.min, L.max()));
  document.documentElement.style.setProperty(L.css, val + "px");
  // a taller timeline may take more of the window than its usual 46%
  if (k === "lane") document.documentElement.style.setProperty("--tl-max", val > 40 ? "70vh" : "46vh");
  if (save) store.set("layout." + k, String(val));
  const el = { insp: "#splitInsp", lane: "#splitTl", head: "#splitHead" }[k];
  const sp = $(el); if (sp) { sp.setAttribute("aria-valuenow", String(val)); sp.setAttribute("aria-valuemin", String(L.min)); sp.setAttribute("aria-valuemax", String(Math.round(L.max()))); }
  drawTimeline();
  return val;
}
function initLayout() {
  for (const k of Object.keys(LAYOUT)) { const v = Number(store.get("layout." + k)); setLayout(k, Number.isFinite(v) && v > 0 ? v : LAYOUT[k].def, false); }
  const bind = (id, k) => {
    const sp = $(id), L = LAYOUT[k]; if (!sp) return;
    const cur = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(L.css)) || L.def;
    // the timeline's splitter moves the whole timeline: its height is shared among the lanes
    const lanes = () => Math.max(1, laneKeys().length);
    let drag = null;
    sp.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      drag = { p0: L.axis === "x" ? e.clientX : e.clientY, v0: cur() };
      sp.setPointerCapture(e.pointerId); sp.classList.add("dragging"); document.body.classList.add("resizing", L.axis === "x" ? "resizing-col" : "resizing-row"); e.preventDefault();
    });
    sp.addEventListener("pointermove", e => {
      if (!drag) return;
      const d = ((L.axis === "x" ? e.clientX : e.clientY) - drag.p0) * L.sign;
      setLayout(k, drag.v0 + (L.perLane ? d / lanes() : d), false);
    });
    const end = () => { if (!drag) return; drag = null; sp.classList.remove("dragging"); document.body.classList.remove("resizing", "resizing-col", "resizing-row"); setLayout(k, cur()); drawAll(); };
    sp.addEventListener("pointerup", end); sp.addEventListener("pointercancel", end);
    sp.addEventListener("dblclick", () => { setLayout(k, L.def); drawAll(); });
    sp.addEventListener("keydown", e => {
      const keys = L.axis === "x" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: 1, ArrowDown: -1 };
      if (!(e.key in keys) && e.key !== "Home") return;
      e.preventDefault();
      if (e.key === "Home") { setLayout(k, L.def); drawAll(); return; }
      // the panel grows to the left; the timeline grows up
      const step = (e.shiftKey ? 64 : 16) / (L.perLane ? lanes() : 1), dir = keys[e.key] * (k === "insp" ? -1 : 1);
      setLayout(k, cur() + dir * step); drawAll();
    });
  };
  bind("#splitInsp", "insp"); bind("#splitTl", "lane"); bind("#splitHead", "head");
  // a smaller window, or another monitor: the saved sizes stay within what fits (without saving)
  window.addEventListener("resize", () => { for (const k of Object.keys(LAYOUT)) { const L = LAYOUT[k], want = Number(store.get("layout." + k)) || L.def; setLayout(k, want, false); } });
  // another monitor with another pixel density: the canvases are redrawn at the new resolution
  const watchDpr = () => { const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); mq.addEventListener("change", () => { drawAll(); watchDpr(); }, { once: true }); };
  watchDpr();
}

/* ============ image info and analysis source ============ */
const fbytes = b => (b >= 1e9 ? nf(b / 1e9, 2) + " GB" : b >= 1e6 ? nf(b / 1e6, 1) + " MB" : Math.round(b / 1e3) + " kB");
function renderImageInfo() {
  if (!INFO) return;
  const i = INFO, parts = [`${i.w} × ${i.h} px`, `${nf(i.mp, i.mp < 10 ? 1 : 0)} MP`, i.format];
  if (i.bytes) parts.push(fbytes(i.bytes));
  const kind = i.kind === "data" ? "Read as measurement data (raw units)" : "Read as a photo (linear light)";
  $("#imgInfo").innerHTML = `<strong title="${esc(i.name)}">${esc(i.name)}</strong><span>${esc(parts.join(" · "))}</span><span>${esc(i.description || "")}${i.pages > 1 ? `, page 1 of ${i.pages}` : ""}</span><span class="kind">${kind}; working copy ${BASE.w} × ${BASE.h}</span>`;
}
function renderRangeNote(range) {
  const el = $("#rangeNote"); if (!el) return;
  if (!range) { el.textContent = ""; return; }
  const f = v => (Math.abs(v) >= 1000 || Number.isInteger(v) ? Math.round(v).toLocaleString("en-US") : Number(v.toPrecision(4)).toString());
  el.textContent = `Mapped range ${f(range.lo)} to ${f(range.hi)} (${range.mode === "percentile" ? `${P.src.lo}th to ${P.src.hi}th percentile` : range.mode === "minmax" ? "minimum to maximum" : "full bit depth"}).`;
}
const SRC_SLIDERS = {
  srcMix: [
    { key: "wr", label: "Red weight", min: 0, max: 2, step: 0.01, def: 1, dec: 2 },
    { key: "wg", label: "Green weight", min: 0, max: 2, step: 0.01, def: 1, dec: 2 },
    { key: "wb", label: "Blue weight", min: 0, max: 2, step: 0.01, def: 1, dec: 2 }
  ],
  srcPct: [
    { key: "lo", label: "Low percentile", min: 0, max: 20, step: 0.1, def: 0.5, unit: "%", dec: 1 },
    { key: "hi", label: "High percentile", min: 80, max: 100, step: 0.1, def: 99.5, unit: "%", dec: 1 }
  ],
  srcTone: [
    { key: "brightness", label: "Brightness", min: -1, max: 1, step: 0.01, def: 0, scale: 100, unit: "%", signed: true },
    { key: "contrast", label: "Contrast", min: -1, max: 1, step: 0.01, def: 0, scale: 100, unit: "%", signed: true },
    { key: "gamma", label: "Gamma", min: 0.2, max: 5, step: 0.01, def: 1, dec: 2, help: "Above 1 brightens mid-tones, below 1 darkens them." }
  ],
  srcCrop: [
    { key: "l", label: "Left", min: 0, max: 0.45, step: 0.005, def: 0, scale: 100, unit: "%", dec: 1 },
    { key: "r", label: "Right", min: 0, max: 0.45, step: 0.005, def: 0, scale: 100, unit: "%", dec: 1 },
    { key: "t", label: "Top", min: 0, max: 0.45, step: 0.005, def: 0, scale: 100, unit: "%", dec: 1 },
    { key: "b", label: "Bottom", min: 0, max: 0.45, step: 0.005, def: 0, scale: 100, unit: "%", dec: 1 }
  ]
};
const SRC_CTL = {};
function initSourceControls() {
  for (const host of Object.keys(SRC_SLIDERS)) {
    const el = $("#" + host), target = host === "srcCrop" ? P.src.crop : P.src;
    for (const d of SRC_SLIDERS[host]) { const sl = makeSlider({ ...d, key: d.key }, target, () => scheduleSource()); SRC_CTL[host + "." + d.key] = sl; el.appendChild(sl.el); }
  }
  // crop sliders share ids with nothing else; make them unique for labels
  SRC_CTL.ch = makeSeg($("#srcCh"), [["color", "Colour"], ["gray", "Greyscale"], ["mix", "Custom mix"]], P.src.channels, v => { P.src.channels = v; $("#srcMix").hidden = v !== "mix"; scheduleSource(); });
  SRC_CTL.range = makeSeg($("#srcRange"), [["auto", "Auto"], ["full", "Full"], ["minmax", "Min-max"], ["percentile", "Percentile"]], P.src.range, v => { P.src.range = v; syncSourceControls(); scheduleSource(); });
  $("#srcInvert").addEventListener("change", e => { P.src.invert = e.target.checked; scheduleSource(); });
  $("#srcReset").addEventListener("click", () => {
    Object.assign(P.src, structuredClone(DEFAULT_SOURCE));
    for (const k of Object.keys(SRC_CTL)) if (SRC_CTL[k].el) { const [host, key] = k.split("."); SRC_CTL[k].set((host === "srcCrop" ? P.src.crop : P.src)[key], false); }
    SRC_CTL.ch.set(P.src.channels); SRC_CTL.range.set(P.src.range); $("#srcInvert").checked = false; $("#srcMix").hidden = true;
    syncSourceControls(); scheduleSource();
  });
}
function syncSourceControls() {
  const data = BASE && BASE.kind === "data";
  $("#srcDataGroup").hidden = !data;
  const mode = P.src.range === "auto" && INFO ? (INFO.bits <= 8 && INFO.sampleFormat !== 3 ? "full" : "percentile") : P.src.range;
  $("#srcPct").hidden = mode !== "percentile";
  $("#srcCh").closest(".field").hidden = !!(BASE && BASE.ch === 1);
  if (data) $("#srcBox").open = true;
  // measurement data needs its intensity range: the analysis source stays visible in Simple too
  $("#srcBox").classList.toggle("adv-only", !data);
}

/* ============ editing focus points ============ */
const plain = q => ({ id: q.id || newId(), x: q.x, y: q.y, r: q.r, w: q.w ?? q.s ?? 0.5, pinned: !!q.pinned || q.source === "manual", index: q.index, ...(q.mood ? { mood: q.mood } : {}), ...(q.accent ? { accent: true } : {}) });
function pushHistory() { HIST.push(JSON.stringify(PATH)); if (HIST.length > 200) HIST.shift(); FUT = []; }
// The first edit of an automatic path turns it into a manual list holding every current point.
function ensureEditable() { if (PATH.mode === "auto") { PATH.mode = "manual"; PATH.points = POINTS.map(q => ({ ...plain(q), pinned: false })); } }
function pathChanged() { invalidate(LV.PATH); syncPathUI(); }
// The editable entry behind SCORE index i (an anchor is created in mixed mode).
function editableAt(i, create) {
  const F = POINTS[i]; if (!F) return null;
  if (PATH.mode === "manual") return PATH.points[i];
  let q = PATH.points.find(p => p.id === F.id);
  if (!q && create) { q = { ...plain(F), index: i }; PATH.points.push(q); }
  return q;
}
function editPoint(i, fn) {
  if (!POINTS[i]) return;
  pushHistory(); ensureEditable();
  const q = editableAt(i, true); fn(q); q.pinned = true; pathChanged();
}
function deletePoint(i) {
  if (!POINTS[i]) return;
  pushHistory();
  if (PATH.mode === "mixed") {
    const F = POINTS[i], k = PATH.points.findIndex(p => p.id === F.id);
    if (k >= 0) PATH.points.splice(k, 1);
    else { PATH.mode = "manual"; PATH.points = POINTS.map(q => plain(q)); PATH.points.splice(i, 1); flash("Switched to Manual: in Mixed mode automatic points would come back."); }
  } else { ensureEditable(); PATH.points.splice(i, 1); }
  SEL = Math.max(0, Math.min(SEL, POINTS.length - 2)); pathChanged();
}
function addPoint(x, y) {
  pushHistory(); ensureEditable();
  const q = { id: newId(), x, y, r: P.radius, w: saliencyAt(A, SAL.map, x, y), pinned: true };
  if (PATH.mode === "manual") { const at = Math.min(PATH.points.length, SEL + 1); PATH.points.splice(at, 0, q); SEL = at; }
  else { q.index = POINTS.length; PATH.points.push(q); SEL = q.index; }
  pathChanged();
}
function movePoint(i, d) {
  const j = i + d; if (!POINTS[i] || !POINTS[j]) return;
  pushHistory();
  if (PATH.mode !== "manual") { PATH.mode = "manual"; PATH.points = POINTS.map(q => plain(q)); }
  const [q] = PATH.points.splice(i, 1); PATH.points.splice(j, 0, q); q.pinned = true; SEL = j; pathChanged();
}
function setMode(m) {
  if (m === PATH.mode) return;
  pushHistory();
  if (m === "manual") PATH.points = POINTS.map(q => plain(q));
  else if (m === "mixed") PATH.points = (PATH.mode === "manual" ? PATH.points.map((q, i) => ({ ...q, index: i })) : PATH.points).filter(q => q.pinned);
  PATH.mode = m; pathChanged();
}
function undo() { if (!HIST.length) return; FUT.push(JSON.stringify(PATH)); Object.assign(PATH, JSON.parse(HIST.pop())); pathChanged(); }
function redo() { if (!FUT.length) return; HIST.push(JSON.stringify(PATH)); Object.assign(PATH, JSON.parse(FUT.pop())); pathChanged(); }
let MODE_SEG = null;
function syncPathUI() {
  if (MODE_SEG) MODE_SEG.set(PATH.mode);
  $("#undoBtn").disabled = !HIST.length; $("#redoBtn").disabled = !FUT.length;
  $("#addBtn").setAttribute("aria-pressed", String(tool === "add"));
  if (SL.count) {
    const manual = PATH.mode === "manual";
    for (const s of [SL.count, SL.returns]) {
      s.el.classList.toggle("disabled", manual);
      s.el.querySelectorAll("input").forEach(el => (el.disabled = manual));
    }
    if (manual && SCORE) SL.count.setNote(`Manual path: ${POINTS.length} focus points. Add or delete them on the stage.`);
  }
}

// Stage pointer handling: drag a point to move it, drag the white handle to resize,
// click to select and listen, click empty space with the Add tool to add a point.
function stagePos(e) { const rc = $("#stage").getBoundingClientRect(); return { x: e.clientX - rc.left, y: e.clientY - rc.top }; }
let HIT_MIN = 10; // at least this many pixels around a point's centre count as a hit (more for a finger)
function hitPoint(p) {
  if (!SCORE) return -1;
  const diag = Math.hypot(stageGeom.w, stageGeom.h); let best = -1, bd = Infinity;
  SCORE.points.forEach((F, i) => { const d = Math.hypot(F.x * stageGeom.w - p.x, F.y * stageGeom.h - p.y), R = Math.max(HIT_MIN, F.r * diag); if (d <= R && d <= bd) { bd = d; best = i; } });
  return best;
}
// tol: how close to the handle counts, wider for a finger
function hitHandle(p, tol = 9) {
  const F = SCORE && SCORE.points[SEL]; if (!F) return false;
  const diag = Math.hypot(stageGeom.w, stageGeom.h), R = Math.max(6, F.r * diag) + 3;
  return Math.hypot(F.x * stageGeom.w + R * Math.SQRT1_2 - p.x, F.y * stageGeom.h - R * Math.SQRT1_2 - p.y) <= tol;
}
let drag = null;
function initStageEditing() {
  const cv = $("#stage");
  cv.addEventListener("pointerdown", e => {
    if (ZONE && SCORE && e.button === 0 && !exportView()) {
      const p = stagePos(e), x = clamp(p.x / stageGeom.w), y = clamp(p.y / stageGeom.h), r = P.expert.find(q => q.id === ZONE.id);
      if (r) { r.when.zone = { x0: x, y0: y, x1: x, y1: y }; ZONE.drawing = true; cv.setPointerCapture(e.pointerId); e.preventDefault(); drawStage(); }
      return;
    }
    if (!SCORE || !showPath || e.button !== 0 || exportView()) return;
    HIT_MIN = e.pointerType === "touch" ? 22 : 10;
    const p = stagePos(e), touch = e.pointerType === "touch" || e.pointerType === "pen";
    if (hitHandle(p, touch ? 20 : 9)) drag = { kind: "radius", i: SEL, started: false, p0: p };
    else {
      const i = hitPoint(p);
      if (i >= 0) drag = { kind: "move", i, started: false, p0: p };
      else if (tool === "add") { addPoint(clamp(p.x / stageGeom.w), clamp(p.y / stageGeom.h)); selectTab("point"); return; }
      else return;
    }
    cv.setPointerCapture(e.pointerId); e.preventDefault();
  });
  cv.addEventListener("pointermove", e => {
    const p = stagePos(e);
    if (ZONE) {
      cv.style.cursor = "crosshair";
      if (ZONE.drawing) { const r = P.expert.find(q => q.id === ZONE.id); if (r && r.when.zone) { r.when.zone.x1 = clamp(p.x / stageGeom.w); r.when.zone.y1 = clamp(p.y / stageGeom.h); drawStage(); } }
      return;
    }
    if (!drag) { cv.style.cursor = !SCORE ? "default" : hitHandle(p) ? "nwse-resize" : hitPoint(p) >= 0 ? "grab" : tool === "add" ? "crosshair" : "default"; return; }
    if (!drag.started) {
      if (Math.hypot(p.x - drag.p0.x, p.y - drag.p0.y) < 3) return;
      drag.started = true; SEL = drag.i; editPoint(drag.i, () => {});
      drag.q = editableAt(drag.i, false);
    }
    const q = drag.q; if (!q) return;
    if (drag.kind === "move") { q.x = clamp(p.x / stageGeom.w); q.y = clamp(p.y / stageGeom.h); }
    else q.r = clamp(Math.hypot(p.x - q.x * stageGeom.w, p.y - q.y * stageGeom.h) / Math.hypot(stageGeom.w, stageGeom.h), 0.01, 0.5);
    invalidate(LV.PATH);
  });
  const end = () => {
    if (ZONE && ZONE.drawing) { ZONE = null; cv.style.cursor = "default"; renderExpert(); invalidate(LV.MUSIC); return; }
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.started && d.kind === "move") { selectTab("point"); audition(d.i); }
  };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  cv.addEventListener("wheel", e => {
    if (!e.altKey || !SCORE) return;
    const i = hitPoint(stagePos(e)); if (i < 0) return;
    e.preventDefault(); SEL = i;
    editPoint(i, q => { q.r = clamp(q.r * (e.deltaY < 0 ? 1.08 : 1 / 1.08), 0.01, 0.5); });
  }, { passive: false });
}

/* ============ project files ============ */
// Copies values into an existing object tree, keeping the objects that controls are bound to.
function mergeInto(dst, src) {
  for (const k of Object.keys(src)) {
    if (Array.isArray(src[k]) && Array.isArray(dst[k])) src[k].forEach((v, i) => { if (dst[k][i] && typeof v === "object") Object.assign(dst[k][i], v); });
    else if (src[k] && typeof src[k] === "object" && dst[k] && typeof dst[k] === "object") mergeInto(dst[k], src[k]);
    else dst[k] = src[k];
  }
}
/* ============ recipe: everything needed to make the same piece again ============ */
// A recipe holds the image (embedded up to 25 MB, or the demo's name), every setting, the gaze
// path, the versions of the app, models and instruments, the neural results that were applied
// (melody, groove, attention map) and a hash of the score. Opening it rebuilds the piece from
// those and reports whether the result is identical.
const RECIPE_MAX_IMAGE = 25e6;
let ORIG = null, RECIPE_CHECK = null;
const toB64 = buf => { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = str => { const s = atob(str), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; };
// The score's identity: every note's layer, time, length, pitch and velocity.
function scoreHash(sc) {
  const rows = sc.notes.map(n => [n.layer, Math.round(n.t * 1e4), Math.round(n.dur * 1e4), n.midi, Math.round(n.vel)]);
  return hashBytes(new TextEncoder().encode(JSON.stringify(rows)));
}
// Resolves when no neural job is running and no recomputation is pending (at most 90 s).
async function settled() {
  for (let i = 0; i < 450 && (STORY.job || GROOVE.job || ATTN.job || raf || dirty); i++) await new Promise(r => setTimeout(r, 200));
}
async function recipeJson(includeImage = true) {
  // the recipe describes the finished piece: wait for running models first
  await settled();
  const image = INFO ? { name: INFO.name, w: INFO.w, h: INFO.h, hash: INFO.hash } : null;
  if (image && ORIG && ORIG.demo) image.demo = ORIG.demo;
  else if (image && ORIG && ORIG.file && includeImage && ORIG.file.size <= RECIPE_MAX_IMAGE) { image.type = ORIG.file.type || "application/octet-stream"; image.file = ORIG.file.name; image.data = toB64(await ORIG.file.arrayBuffer()); }
  const sc = SCORE;
  return {
    app: APP_NAME, kind: "recipe", schema: 2, version: APP_VERSION, created: new Date().toISOString(),
    image, settings: structuredClone(P), path: structuredClone(PATH),
    models: { melody: P.melody, groove: P.groove, placement: P.placement, urls: { story: MODEL_URL, improv: IMPROV_URL, groove: GROOVE_URL, ...PLACEMENT_URLS } },
    instruments: sc ? { samples: P.samples !== false, kit: kitName(), layers: Object.fromEntries(["lead", "harm", "bass", "pad"].map(l => [l, { name: sc.inst[l].name, type: sc.inst[l].type, src: sc.inst[l].src || null }])) } : null,
    neural: {
      melody: sc && sc.storyRef ? sc.storyRef : null,
      groove: sc && sc.grooveRef ? sc.grooveRef : null,
      attention: ATTN.ref || null
    },
    check: sc ? { score: scoreHash(sc), notes: sc.notes.length, bpm: sc.bpm, key: pcName(sc.pc), mode: sc.modeKey } : null
  };
}
async function saveRecipe() {
  if (!DL) return;
  try {
    const name = (INFO ? INFO.name.replace(/\.[^.]+$/, "") : "luxsonora") + ".luxsonora.json";
    await DL.save({ filename: name, data: new Blob([JSON.stringify(await recipeJson(true))], { type: "application/json" }) });
  } catch (e) { /* cancelled */ }
}
function applySettings(j) {
  for (const k of Object.keys(P)) if (k in j.settings && !(k in { src: 1, mix: 1, fx: 1, instruments: 1, video: 1, out: 1 })) P[k] = j.settings[k];
  if (j.settings.video) { mergeInto(P.video, j.settings.video); if (j.settings.video.labelText) P.video.labelText = { ...j.settings.video.labelText }; ensureFont(P.video.font); }
  if (j.settings.out) Object.assign(P.out, j.settings.out);
  // recipes from before the composition rules play with them all on
  P.rules = { ...defaultRules(), ...(j.settings.rules || {}) };
  P.expert = Array.isArray(j.settings.expert) ? j.settings.expert : [];
  // projects from before the generated intro had none, and a one-bar ending
  if (!("intro" in j.settings)) P.intro = "off";
  if (!("circleSize" in j.settings)) P.circleSize = "same";
  if (!("end" in j.settings)) P.end = 1;
  if (EXPORT) EXPORT.sync();
  if (j.settings.src) { const cropRef = P.src.crop, crop = { ...cropRef, ...(j.settings.src.crop || {}) }; Object.assign(P.src, j.settings.src); P.src.crop = Object.assign(cropRef, crop); }
  if (j.settings.mix) for (const l of Object.keys(j.settings.mix)) P.mix[l] = Object.assign(P.mix[l] || { vol: 1, mute: false, solo: false }, j.settings.mix[l]);
  if (j.settings.instruments) P.instruments = j.settings.instruments;
  if (j.settings.fx) mergeInto(P.fx, j.settings.fx);
  PATH.mode = j.path.mode; PATH.points = j.path.points || []; HIST = []; FUT = [];
}
// Opens a recipe (or an older project file, which has no image or results).
async function openProject(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch (e) { j = null; }
  // recipes made before the app was called Lux Sonora say "Sonification"
  if (!j || !APP_NAMES.includes(j.app) || (j.kind !== "project" && j.kind !== "recipe")) { flash("That file isn't a Lux Sonora project."); return; }
  try {
    const img = j.image || null;
    if (img && img.data) {
      const f = new File([fromB64(img.data)], img.file || img.name || "image", { type: img.type || "" });
      await loadFile(f);
    } else if (img && img.demo && DEMOS[img.demo]) { $("#demo").value = img.demo; loadDemo(img.demo); }
    applyProjectState(j);
    RECIPE_CHECK = j.kind === "recipe" && j.check ? { ...j.check, version: j.version } : null;
    if (img && INFO && img.hash !== INFO.hash && !img.data && !img.demo) flash(`This file was made for “${img.name}”. Its focus points were placed by position on the current image.`);
  } catch (e) { flash("The project couldn't be opened: " + (e.message || e)); }
}
// A project's settings, path and neural results, once its picture is loaded.
function applyProjectState(j) {
  applySettings(j);
  // the neural results of the recipe are used as they were, so the rebuild doesn't depend on the GPU or the network
  if (j.neural) {
    if (j.neural.melody) STORY.cache.set(j.neural.melody.key, j.neural.melody.res);
    if (j.neural.groove) GROOVE.cache.set(j.neural.groove.key, j.neural.groove.res);
    if (j.neural.attention) ATTN.cache.set(j.neural.attention.key, j.neural.attention);
  }
  STORY.failed = GROOVE.failed = ATTN.failed = false;
  syncAllControls(); applySource();
}

/* ---- the session, kept in the browser (session.js): saved after each change, restored on load ---- */
let SAVE_T = 0, RESTORING = false;
function sessionNow() {
  if (!INFO || !ORIG || RESTORING) return null;
  const sc = SCORE;
  const image = ORIG.demo ? { hash: INFO.hash, demo: ORIG.demo } : ORIG.file ? { hash: INFO.hash, file: ORIG.file, name: ORIG.file.name || INFO.name, type: ORIG.file.type || "" } : null;
  if (!image) return null;
  let settings; try { settings = structuredClone(P); } catch (e) { return null; }
  return { image, state: { settings, path: structuredClone(PATH), neural: { melody: sc && sc.storyRef ? sc.storyRef : null, groove: sc && sc.grooveRef ? sc.grooveRef : null, attention: ATTN.ref || null } } };
}
function scheduleSave(delay = 1200) {
  clearTimeout(SAVE_T);
  SAVE_T = setTimeout(() => { const s = sessionNow(); if (s) saveSession(s.image, s.state); }, delay);
}
// The last session comes back as it was (true), or there is none (false).
async function restoreSession() {
  const s = await loadSession(); if (!s) return false;
  RESTORING = true;
  try {
    const img = s.image;
    if (img.demo && DEMOS[img.demo]) { $("#demo").value = img.demo; loadDemo(img.demo); }
    else if (img.file) await loadFile(new File([img.file], img.name || "image", { type: img.type || "" }));
    else return false;
    if (!INFO) return false;
    NEW_SONG_PENDING = false;
    applyProjectState({ settings: s.state.settings, path: s.state.path, neural: s.state.neural });
    flash("Your last song is back, as you left it.");
    return true;
  } catch (e) { return false; }
  finally { RESTORING = false; }
}

// After a rebuild settles (no neural job running), compare with the recipe's score.
function checkRecipe() {
  if (!RECIPE_CHECK || !SCORE || STORY.job || GROOVE.job || ATTN.job) return;
  const want = RECIPE_CHECK; RECIPE_CHECK = null;
  const got = scoreHash(SCORE);
  if (got === want.score) flash(`Project loaded: identical (${SCORE.notes.length} notes, ${pcName(SCORE.pc)} ${SCORE.modeKey}, ${nf1(SCORE.bpm)} BPM).`);
  else flash(`Project loaded, but the score differs (${SCORE.notes.length} notes here, ${want.notes} when it was saved${want.version && want.version !== APP_VERSION ? `; it was made with version ${want.version}` : ""}).`);
}

function projectJson() {
  return { app: APP_NAME, kind: "project", schema: 1, image: INFO ? { name: INFO.name, w: INFO.w, h: INFO.h, hash: INFO.hash } : null, settings: P, path: PATH };
}
function saveProject() {
  if (!DL) return;
  const name = (INFO ? INFO.name.replace(/\.[^.]+$/, "") : "luxsonora") + ".luxsonora.json";
  DL.save({ filename: name, data: new Blob([JSON.stringify(projectJson(), null, 2)], { type: "application/json" }) }).catch(() => {});
}

const SCALES = [["auto", "Auto (from the image)"], ["phrygian", "Phrygian"], ["aeolian", "Aeolian (natural minor)"], ["dorian", "Dorian"], ["mixolydian", "Mixolydian"], ["ionian", "Ionian (major)"], ["lydian", "Lydian"], ["majpent", "Major pentatonic"], ["minpent", "Minor pentatonic"]];
function initKeyControls() {
  const host = $("#sMusic");
  host.insertAdjacentHTML("afterbegin", `<div class="field-2">
    <label class="field"><span class="flabel">Key</span><span class="select"><select id="keySel"><option value="auto">Auto</option>${NOTE_SH.map((n, i) => `<option value="${i}">${n}${[1, 3, 6, 8, 10].includes(i) ? " / " + NOTE_FL[i] : ""}</option>`).join("")}</select></span></label>
    <label class="field"><span class="flabel">Scale</span><span class="select"><select id="scaleSel">${SCALES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></span></label></div>`);
  $("#keySel").addEventListener("change", e => { const v = e.target.value; P.keyMode = v === "auto" ? "auto" : "manual"; if (v !== "auto") P.keyPc = Number(v); invalidate(LV.MUSIC); });
  $("#scaleSel").addEventListener("change", e => { P.scale = e.target.value; invalidate(LV.MUSIC); });
}
// Composition rules (core/rules.js): one switch each, all on by default
function initRulesControls() {
  const host = $("#sRules");
  host.innerHTML = Object.entries(RULE_GROUPS).map(([g, gname]) => `<div class="rule-group"><div class="flabel">${esc(gname)}</div>${Object.entries(RULES_INFO).filter(([, r]) => r.group === g).map(([k, r]) => `<div class="rule"><label class="toggle"><input type="checkbox" data-rule="${k}"><span>${esc(r.name)}</span></label><p class="sub">${esc(r.desc)}</p></div>`).join("")}</div>`).join("");
  host.addEventListener("change", e => { const k = e.target.dataset.rule; if (!k) return; P.rules = { ...defaultRules(), ...P.rules, [k]: e.target.checked }; invalidate(LV.MUSIC); });
  $("#rulesAll").addEventListener("click", () => { P.rules = defaultRules(); syncRules(); invalidate(LV.MUSIC); });
  syncRules();
}
function syncRules() { document.querySelectorAll("#sRules [data-rule]").forEach(el => { el.checked = !P.rules || P.rules[el.dataset.rule] !== false; }); }
function syncAllControls() {
  $("#keySel").value = P.keyMode === "manual" ? String(P.keyPc) : "auto"; $("#scaleSel").value = P.scale;
  for (const k of Object.keys(SL)) SL[k].set(P[k], false);
  for (const k of Object.keys(SRC_CTL)) if (SRC_CTL[k].el) { const [host, key] = k.split("."); SRC_CTL[k].set((host === "srcCrop" ? P.src.crop : P.src)[key], false); }
  SRC_CTL.ch.set(P.src.channels); SRC_CTL.range.set(P.src.range); $("#srcInvert").checked = P.src.invert; $("#srcMix").hidden = P.src.channels !== "mix";
  STYLE_SEG.set(P.style); DUR_SEG.set(String(P.duration)); MEL_SEG.set(P.melody); CONNECT_SEG.set(P.connect || "off"); GROOVE_SEG.set(P.groove); CHORD_SEG.set(String(P.chordRate ?? 1)); CIRCLE_SEG.set(P.circleSize || "same"); INTRO_SEG.set(String(P.intro ?? "auto")); END_SEG.set(String(P.end ?? "auto")); $("#placeSel").value = P.placement;
  document.querySelectorAll(".lane").forEach(el => { const l = el.dataset.layer, r = el.querySelector("input[type=range]"); r.value = P.mix[l].vol; r.style.setProperty("--p", ((P.mix[l].vol / 1.5) * 100).toFixed(1) + "%"); });
  syncSourceControls(); syncRules(); renderLanes(); if (SOUND) SOUND.sync();
}
function closeMenus() { document.querySelectorAll(".popover").forEach(p => (p.hidden = true)); document.querySelectorAll("[aria-haspopup]").forEach(b => b.setAttribute("aria-expanded", "false")); }

/* ============ tabs ============ */
const TABS = ["piece", "point", "sound", "export"];
let CIRCLE_SEG = null, INTRO_SEG = null, END_SEG = null, CHORD_SEG = null, STYLE_SEG = null, DUR_SEG = null, MEL_SEG = null, CONNECT_SEG = null, GROOVE_SEG = null, ORCH_SEG = null, UI_SEG = null, SOUND = null;
function selectTab(which) {
  for (const t of TABS) {
    const on = t === which;
    $(`#tab-${t}`).setAttribute("aria-selected", String(on)); $(`#tab-${t}`).tabIndex = on ? 0 : -1;
    $(`#pan-${t}`).hidden = !on;
  }
  // the Export tab turns the stage into the video preview
  document.documentElement.classList.toggle("video-view", which === "export");
  if (SRC) { drawAll(); renderWhy(); }
  if (which === "export" && EXPORT) { refreshLabels(); scheduleAnalysis(); }
}
const exportView = () => $("#tab-export") && $("#tab-export").getAttribute("aria-selected") === "true";

/* ============ sliders ============ */
const SLIDERS = {
  sBasic: [
    { key: "count", label: "Focus points", min: 2, max: 32, step: 1, def: 8, level: LV.PATH, help: "How many spots the eye visits. Each one shows up as a circle on the picture." },
    { key: "returns", label: "Revisits", adv: true, min: 0, max: 12, step: 1, def: 3, level: LV.PATH, help: "How many times the eye can go back to a spot it has already seen. When it does, that spot's tune comes back. At 0 every spot is new." },
    { key: "tempoAdj", label: "Tempo", adv: true, min: -0.3, max: 0.3, step: 0.01, def: 0, scale: 100, unit: "%", signed: true, level: LV.MUSIC },
    { key: "arc", label: "Build-up", adv: true, min: 0, max: 1, step: 0.01, def: 0.7, scale: 100, unit: "%", level: LV.MUSIC, help: "Turns the journey into a story, with a quiet start, a climax and an ending. At 0% the song stays at one level." },
    { key: "smooth", label: "Smoothness", adv: true, min: 0, max: 1, step: 0.01, def: 0.6, scale: 100, unit: "%", level: LV.MUSIC, help: "How gently one part flows into the next. At 0% the changes are sudden." }
  ],
  sGaze: [
    { key: "inhibition", label: "Inhibition radius", min: 0.06, max: 0.4, step: 0.01, def: 0.18, scale: 100, unit: "%", level: LV.PATH, help: "How far the eye has to move away from spots it has already looked at." },
    { key: "memory", label: "Memory", min: 0, max: 0.2, step: 0.005, def: 0.05, scale: 100, unit: "%", dec: 1, level: LV.PATH, help: "How soon a spot the eye has seen becomes interesting again, and so how early it looks back." },
    { key: "radius", label: "Focus radius", min: 0.02, max: 0.3, step: 0.005, def: DEFAULT_RADIUS, scale: 100, unit: "%", dec: 1, level: LV.PATH, help: "The base size of the circles the app places (with From the area, each circle is between 40% and 220% of it). You can resize each one on the picture." },
    { key: "seed", label: "Variation", min: 0, max: 99, step: 1, def: 0, level: LV.PATH, help: "Try a different path for the same picture. Each number always gives the same path, and 0 is the original." }
  ],
  sSal: [
    { key: "wColor", label: "Colour", min: 0, max: 1, step: 0.01, def: 0.7, scale: 100, unit: "%", level: LV.SAL },
    { key: "wTex", label: "Texture", min: 0, max: 1, step: 0.01, def: 0.5, scale: 100, unit: "%", level: LV.SAL }
  ],
  sMusic: [
    { key: "fidelity", label: "Fidelity", min: 0, max: 1, step: 0.01, def: 0.6, scale: 100, unit: "%", level: LV.MUSIC, help: "High values make the melody follow the picture closely. Low values let it move more smoothly." },
    { key: "octave", label: "Melody octave", min: -2, max: 2, step: 1, def: 0, signed: true, level: LV.MUSIC },
    { key: "range", label: "Melodic range", min: 1, max: 3, step: 0.5, def: 2, unit: "oct.", dec: 1, level: LV.MUSIC, help: "How many octaves the picture covers, from bottom to top." }
  ],
  sCompose: [
    { key: "swingAdj", label: "Swing", min: 0, max: 2, step: 0.05, def: 1, scale: 100, unit: "%", level: LV.MUSIC, help: "How far the off-beats lean back, as a share of the style's own swing. Styles without swing stay straight." },
    { key: "buildUp", label: "Layers build up", min: 0, max: 1, step: 0.01, def: 0.5, scale: 100, unit: "%", level: LV.MUSIC, help: "When the extra layers come in. At 0% they all play from the start, at 100% they wait for the climax." },
    { key: "contrastThr", label: "Contrast needed for a far chord", min: 0.1, max: 1, step: 0.01, def: 0.45, scale: 100, unit: "%", level: LV.MUSIC, help: "How different two places must be before the chord jumps further (the Contrast rule). Lower jumps more often." }
  ],
  sPerform: [
    { key: "dynRange", label: "Dynamic range", min: 0, max: 1, step: 0.01, def: PERFORM_DEFAULTS.dynRange, scale: 100, unit: "%", level: LV.MUSIC, help: "How far apart the quiet and the loud places are. At 50% they are as composed." },
    { key: "velDetail", label: "Picture detail in the dynamics", min: 0, max: 1, step: 0.01, def: PERFORM_DEFAULTS.velDetail, scale: 100, unit: "%", level: LV.MUSIC, help: "Each note of a place reads the picture around it: lighter or busier spots are played a little louder." },
    { key: "accent", label: "Accents", min: 0, max: 1, step: 0.01, def: PERFORM_DEFAULTS.accent, scale: 100, unit: "%", level: LV.MUSIC, help: "Louder on the first beat of the bar, a little on the third, softer off the beat." },
    { key: "phrasing", label: "Phrasing", min: 0, max: 1, step: 0.01, def: PERFORM_DEFAULTS.phrasing, scale: 100, unit: "%", level: LV.MUSIC, help: "Every four bars the music rises a little and then relaxes." },
    { key: "ccExpr", label: "Expression (CC11)", min: 0, max: 1, step: 0.01, def: PERFORM_DEFAULTS.ccExpr, scale: 100, unit: "%", level: LV.MUSIC, help: "Each layer swells with the tension of the story and the light of each place. Written to the MIDI file as CC11." },
    { key: "ccMod", label: "Vibrato (CC1)", min: 0, max: 1, step: 0.01, def: PERFORM_DEFAULTS.ccMod, scale: 100, unit: "%", level: LV.MUSIC, help: "Saturated places make held notes sing with more vibrato (on the synthesizers; in the MIDI file as CC1)." },
    { key: "humTime", label: "Humanize timing", min: 0, max: 30, step: 1, def: PERFORM_DEFAULTS.humTime, unit: "ms", level: LV.MUSIC, help: "How far notes drift from the grid, in milliseconds. Notes of one chord move together; drum-machine styles stay tighter." },
    { key: "humLen", label: "Humanize length", min: 0, max: 0.3, step: 0.01, def: PERFORM_DEFAULTS.humLen, scale: 100, unit: "%", level: LV.MUSIC, help: "How much each note's length varies." },
    { key: "humVel", label: "Humanize velocity", min: 0, max: 20, step: 1, def: PERFORM_DEFAULTS.humVel, level: LV.MUSIC, help: "How much each note's velocity varies, out of 127." }
  ],
  sSound: [
    { key: "timbre", label: "Image timbre", min: 0, max: 1, step: 0.01, def: 1, scale: 100, unit: "%", level: LV.MUSIC, help: "How much the picture colours the sound. At 0% you hear the instruments as they are." },
    { key: "reverb", label: "Space", min: 0, max: 1, step: 0.01, def: 0.6, scale: 100, unit: "%", level: LV.AUDIO, help: "How much room the sound has around it." }
  ]
};
function onParam(def) {
  if (def.level === LV.AUDIO) { applyMixLive(); return; }
  invalidate(def.level);
}

/* ============ appearance ============ */
function applyTheme(t) {
  const root = document.documentElement;
  if (t === "light" || t === "dark") root.dataset.theme = t; else delete root.dataset.theme;
  store.set("theme", t); requestAnimationFrame(drawAll);
}
// a preset accent, or "custom" with the user's own colour (its soft and line tints, and black or
// white text on it, whichever reads better)
function applyAccent(a, color) {
  const root = document.documentElement, st = root.style;
  root.dataset.accent = a; store.set("accent", a);
  if (a === "custom") {
    const c = color || store.get("accentColor") || "#6D5DF0"; store.set("accentColor", c);
    const n = parseInt(c.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }, L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    st.setProperty("--accent", c); st.setProperty("--accent-soft", `rgba(${r},${g},${b},.14)`); st.setProperty("--accent-line", `rgba(${r},${g},${b},.5)`);
    st.setProperty("--accent-ink", L > 0.36 ? "#0B0D11" : "#FFFFFF");
  } else for (const k of ["--accent", "--accent-soft", "--accent-line", "--accent-ink"]) st.removeProperty(k);
  requestAnimationFrame(drawAll);
}
function initAppearance() {
  const theme = store.get("theme") || "system", accent = store.get("accent") || "violet";
  makeSeg($("#themeSeg"), [["system", "System"], ["light", "Light"], ["dark", "Dark"]], theme, applyTheme);
  const sw = $("#accentSw");
  const own = store.get("accentColor") || "#6D5DF0";
  sw.innerHTML = ACCENTS.map(([k, c]) => `<button type="button" role="radio" aria-checked="${k === accent}" aria-label="${k[0].toUpperCase() + k.slice(1)}" title="${k[0].toUpperCase() + k.slice(1)}" style="--c:${c}" data-v="${k}"></button>`).join("")
    + `<label class="sw-custom" role="radio" aria-checked="${accent === "custom"}" title="Your own colour" style="--c:${own}"><input type="color" id="accentCustom" value="${own}" aria-label="Your own accent colour"></label>`;
  const mark = el => sw.querySelectorAll("[role=radio]").forEach(x => x.setAttribute("aria-checked", String(x === el)));
  sw.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    mark(b); applyAccent(b.dataset.v);
  });
  const pick = $("#accentCustom");
  pick.addEventListener("input", () => { const l = pick.closest("label"); l.style.setProperty("--c", pick.value); mark(l); applyAccent("custom", pick.value); });
  if (accent === "custom") applyAccent("custom", own);
  for (const [bid, pid] of [["#settingsBtn", "#settings"], ["#helpBtn", "#helpMenu"]]) {
    const btn = $(bid), pop = $(pid);
    btn.addEventListener("click", e => { e.stopPropagation(); const open = pop.hidden; closeMenus(); pop.hidden = !open; btn.setAttribute("aria-expanded", String(open)); });
    document.addEventListener("click", e => { if (!pop.hidden && !pop.contains(e.target)) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); } });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !pop.hidden) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); } });
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => drawAll());
}

/* ============ export ============ */
let DL = null, EXPORT_LOUD = null, EXPORT = null, EXPORT_CANCEL = false;
const r3 = x => Math.round(x * 1000) / 1000;
const timJson = T => ({ instrument: T.name, type: T.type, wave_angle_deg: T.wave ? T.wave.angle : undefined, attack_s: r3(T.a), decay_s: r3(T.d), sustain: r3(T.s), release_s: r3(T.r), cutoff_hz: Math.round(T.cut), q: r3(T.q), colour: r3(T.col) });
function paramsJson() {
  const sc = SCORE, g = A.global, spb = 60 / sc.bpm;
  return {
    app: APP_NAME, schema: SCORE_VERSION, version: APP_VERSION, score_hash: scoreHash(sc), placement: P.placement, style: sc.style, key: pcName(sc.pc), mode: sc.modeKey,
    orchestration: { level: sc.orch, layers: (sc.extra || []).map(L => ({ id: L.id, role: L.role, instrument: L.name })) },
    melody: sc.story ? (P.melody === "improv" ? "improvised (Magenta ImprovRNN chord_pitches_improv)" : "story (Magenta MusicVAE mel_chords)") : "classic", groove: sc.groove ? "human (Magenta GrooVAE groovae_2bar_humanize)" : "straight", arc: sc.arc ? { amount: r3(sc.arc.amount), climax: sc.arc.climax + 1 } : null, path_mode: PATH.mode, coverage_background: r3(sc.bgArea),
    duration_s: sc.seconds, bpm: sc.bpm, bpm_style: r3(sc.bpmStyle), bars: sc.bars, beats_total: sc.total, beats_body: sc.body,
    settings: { ...P, mix: undefined }, mixer: P.mix,
    image: { brightness: r3(g.brightness), warmth: r3(g.warmth01), saturation: r3(g.sat), hue: Math.round(g.hue), entropy: r3(g.entropy), edges: r3(g.edgeN) },
    timbre_reference: { mean: Object.fromEntries(Object.entries(sc.stats.mu).map(([k, v]) => [k, r3(v)])), sd: Object.fromEntries(Object.entries(sc.stats.sd).map(([k, v]) => [k, r3(v)])) },
    semantic: SEM,
    focus_points: sc.points.map(F => ({
      index: F.idx + 1, x: r3(F.x), y: r3(F.y), radius: r3(F.r), source: F.source, revisit_of: F.revisitOf === null || F.revisitOf === undefined ? null : F.revisitOf + 1, saliency: r3(F.s), weight: r3(F.w ?? F.s), time_weight: r3(F.weight),
      start_beat: F.t0, duration_beats: F.dur, start_s: r3(F.t0 * spb), duration_s: r3(F.sec), percent: r3(F.share * 100),
      section: F.section, tension: r3(F.tension ?? 0.6), harmony_pattern: F.harmKind, bass_pattern: F.bassKind, drums: F.drums || [], drum_hits: F.hits || 0,
      family: F.letter, variant: F.variant, chord: romanOf(F.root, sc.modeIv), melody: F.lead, chord_notes: F.chord, bass: F.bass, pan: r3(F.pan), object: F.obj ? F.obj.name : null,
      region: { brightness: r3(F.reg.L), saturation: r3(F.reg.sat), edges: r3(F.reg.edge), sharpness: r3(F.reg.sharp), entropy: r3(F.reg.entropy) },
      modulation: Object.fromEntries(DIMS.map(d => [d, r3(F.tim.m[d])])),
      timbre: { melody: timJson(F.tim.lead), harmony: timJson(F.tim.harm), bass: timJson(F.tim.bass) }
    })),
    intro_beats: sc.intro || 0,
    cadence: sc.cadence ? { start_beat: sc.cadence.t, chord_notes: sc.cadence.chord, melody: sc.cadence.lead, bass: sc.cadence.bass } : null,
    pad: timJson(sc.ptim),
    instruments: Object.fromEntries(["lead", "harm", "bass", "pad"].map(l => [l, { preset: (P.instruments[l] && P.instruments[l].preset) || "style", edits: (P.instruments[l] && P.instruments[l].edits) || {}, type: sc.inst[l].type, name: sc.inst[l].name }])),
    effects: P.fx
  };
}
// The master every export starts from: the finished piece (after the neural models), rendered
// offline, with the loudness gain (−14 LUFS when matching is on, else the peak at 0.9).
// It is kept for the current piece and mix, so the next export (and the video preview's sound
// analysis) does not render again.
let MASTER = null;
const masterKey = () => JSON.stringify([P.mix, P.fx, P.reverb, kitName(), P.samples, SCORE && scoreHash(SCORE)]);
function renderMaster(say = () => {}) {
  const run = async () => {
    say("Waiting for the models"); await settled();
    if (!SCORE) throw new Error("Nothing to export yet.");
    const key = masterKey(), sc = SCORE;
    if (MASTER && MASTER.key === key && MASTER.m) return MASTER.m;
    if (MASTER && MASTER.key === key && MASTER.p) return MASTER.p;
    const p = (async () => {
      const sopts = { specs: sampleSpecs(sc), kit: kitName() };
      say("Rendering audio");
      let buf = await renderOffline(sc, P.reverb, P.mix, effFx(sc), sopts);
      let chs = [buf.getChannelData(0), buf.getChannelData(1)], loud = null, gain = null;
      if (P.fx.loudness === "lufs") {
        loud = loudnessGain(chs, buf.sampleRate, -14, -1);
        // if the true-peak ceiling stops the gain short of −14 LUFS, a second pass drives the
        // master limiter harder (makeup gain before it, at most 12 dB) and measures again
        if (loud.limited && P.fx.limiter.on) {
          say("Rendering audio, second pass for loudness");
          // makeup = distance from the true peak at the limiter input to its ceiling, plus 1.5× the missing loudness
          const tpIn = loud.before.truePeakDB - 20 * Math.log10(0.9) - (P.fx.output || 0);
          const fx2 = structuredClone(effFx(sc)); fx2.makeup = Math.min(12, (P.fx.limiter.ceiling - tpIn) + 1.5 * (-14 - loud.lufs) + 1.5);
          buf = await renderOffline(sc, P.reverb, P.mix, fx2, sopts); chs = [buf.getChannelData(0), buf.getChannelData(1)];
          loud = loudnessGain(chs, buf.sampleRate, -14, -1);
        }
        gain = loud.gain;
      }
      EXPORT_LOUD = loud;
      return { chs, sr: buf.sampleRate, gain: masterGain(chs, gain), loud, sc };
    })();
    MASTER = { key, p };
    try { const m = await p; if (MASTER && MASTER.key === key) MASTER = { key, m }; return m; }
    catch (e) { if (MASTER && MASTER.key === key) MASTER = null; throw e; }
  };
  return run();
}
const loudText = loud => (loud ? `: ${loud.lufs.toFixed(1)} LUFS, true peak ${loud.peakDb.toFixed(1)} dBTP${loud.limited ? " (kept under the ceiling)" : ""}` : "");
const imageTitle = () => (INFO && INFO.name ? INFO.name.replace(/\.[^.]+$/, "") : "Lux Sonora");
const fileBase = () => imageTitle().replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "luxsonora";
// One export at a time; `say(text, fraction)` reports progress in the tab and next to Export.
let EXPORT_BUSY = false;
async function exportJob(kind, fn) {
  if (!DL || !SCORE || EXPORT_BUSY) return;
  EXPORT_BUSY = true; EXPORT_CANCEL = false;
  const st = $("#exportStatus"), btn = $("#saveProject"); btn.disabled = true; st.dataset.busy = "1";
  const say = (text, frac = null) => { st.textContent = text + (frac !== null ? ` ${Math.round(frac * 100)}%` : ""); if (EXPORT) EXPORT.status(text, frac, true, kind); };
  try {
    const done = await fn(say);
    st.textContent = done; if (EXPORT) EXPORT.status(done, null, false);
  } catch (e) {
    const code = e && e.code;
    const msg = code === "cancelled" ? "Export cancelled" : code === "declined" ? "Save cancelled" : code === "rate_limited" ? "Try again in a few seconds" : (e && e.message) || "Export didn't work in this view";
    if (code !== "cancelled" && code !== "declined") console.warn("Export failed:", e);
    st.textContent = msg; if (EXPORT) EXPORT.status(msg, null, false);
  } finally { EXPORT_BUSY = false; btn.disabled = false; delete st.dataset.busy; }
}
function exportAudio() {
  return exportJob("audio", async say => {
    const m = await renderMaster(say), f = P.out.format, F = AUDIO_FORMATS[f], name = `${fileBase()}.${F.ext}`;
    say(`Encoding ${F.name}`);
    const blob = await encodeAudio(f, m.chs, m.sr, m.gain, P.out.kbps, x => say(`Encoding ${F.name}`, x));
    await DL.save({ filename: name, data: blob });
    return `Saved ${name}${loudText(m.loud)}`;
  });
}
function exportMidi() {
  return exportJob("midi", async say => {
    say("Waiting for the models"); await settled();
    const name = `${fileBase()}.mid`;
    await DL.save({ filename: name, data: new Blob([midiFile(SCORE, l => audible(P.mix, l))], { type: "audio/midi" }) });
    return `Saved ${name}`;
  });
}
function doExport() {
  return exportJob("zip", async say => {
    const m = await renderMaster(say);
    const zip = zipStore([
      { name: `${fileBase()}.mid`, data: midiFile(SCORE, l => audible(P.mix, l)) },
      { name: `${fileBase()}.wav`, data: wavEncode(m.chs, m.sr, m.gain, 16) },
      { name: "parameters.json", data: new TextEncoder().encode(JSON.stringify(paramsJson(), null, 2)) },
      { name: `${fileBase()}.luxsonora.json`, data: new TextEncoder().encode(JSON.stringify(await recipeJson(true))) }
    ]);
    await DL.save({ filename: `${fileBase()}.zip`, data: zip });
    return `Archive saved${loudText(m.loud)}`;
  });
}

/* ---- video: scene, sound analysis, labels, grade, preview, exports ---- */
// The image for the video, at most 2.5 × the frame's long side (zooming in stays sharp), graded.
let VSRC = null, VGRADE = null;
function videoSource(longSide, final = false) {
  const max = Math.round(longSide * 2.5), k = Math.min(1, max / Math.max(SRC.width, SRC.height));
  let c = SRC;
  if (k < 1) {
    if (VSRC && VSRC.src === SRC && VSRC.max === max) c = VSRC.c;
    else {
      c = makeCanvas(Math.round(SRC.width * k), Math.round(SRC.height * k)); const g = c.getContext("2d");
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(SRC, 0, 0, c.width, c.height);
      VSRC = { src: SRC, max, c };
    }
  }
  // the image edit (levels, curves, white balance, tones) and the colour grade, once per settings.
  // While they are changing (a slider dragged) the preview gets a quick copy at most 900 px wide,
  // and the full one is made when they have rested for a quarter of a second; an export (final)
  // always gets the full one.
  const o = P.video, key = JSON.stringify([o.edit || null, o.grade, o.gradeAmt]);
  if (VGRADE && VGRADE.from === c && VGRADE.key === key && (VGRADE.full || !final)) return VGRADE.c;
  const full = () => (VGRADE = { from: c, key, full: true, c: editCanvas(c, o.edit, o.grade, o.gradeAmt || 0) }).c;
  if (final || Math.max(c.width, c.height) <= 700) return full();
  const k2 = 700 / Math.max(c.width, c.height), small = makeCanvas(Math.round(c.width * k2), Math.round(c.height * k2));
  small.getContext("2d").drawImage(c, 0, 0, small.width, small.height);
  VGRADE = { from: c, key, full: false, c: editCanvas(small, o.edit, o.grade, o.gradeAmt || 0) };
  // the full one, in slices between frames, once the settings have rested
  clearTimeout(videoSource.t);
  videoSource.t = setTimeout(async () => {
    const alive = () => VGRADE && VGRADE.key === key && VGRADE.from === c && !VGRADE.full;
    const done = await editCanvasAsync(c, o.edit, o.grade, o.gradeAmt || 0, alive);
    if (done && alive()) { VGRADE = { from: c, key, full: true, c: done }; if (exportView()) drawStage(); }
  }, 250);
  return VGRADE.c;
}
const keyName = sc => `${pcName(sc.pc)} ${sc.pent ? (sc.major ? "major pentatonic" : "minor pentatonic") : MODES[sc.modeKey].name.split(" ")[0]}`;
function videoCaption(sc) {
  return {
    get title() { return (P.video.title || "").trim() || imageTitle(); },
    sub: `${STYLES[sc.style].name} · ${keyName(sc)} · ${Math.round(sc.bpm)} BPM`,
    point: i => { const F = sc.points[i]; return `Point ${i + 1} · ${SECTION_NAME[F.section] || "Development"} · chord ${romanOf(F.root, sc.modeIv)}`; }
  };
}
// objects for the labels: the placement's, or a detection run from the Export tab
const LABEL_OBJ = { hash: null, objects: null, job: false };
function labelObjects() { return (ATTN.objects && ATTN.objects.length ? ATTN.objects : null) || (SEM && SEM.objects && SEM.objects.length ? SEM.objects : null) || (LABEL_OBJ.hash === (A && A.hash) ? LABEL_OBJ.objects : null); }
const currentAutoLabels = () => (SCORE ? autoLabels(SCORE, labelObjects()) : []);
async function detectObjects() {
  if (!A || LABEL_OBJ.job) return;
  LABEL_OBJ.job = true; EXPORT && EXPORT.labelNote("Downloading the object detector (about 5 MB, only the first time)…");
  try {
    const r = await objectsMap(SRC, A.W, A.H);
    LABEL_OBJ.hash = A.hash; LABEL_OBJ.objects = r.objects;
    EXPORT && EXPORT.labelNote(r.objects.length ? `Found: ${[...new Set(r.objects.map(o => o.name))].join(", ")}. Spots that aren't on any of them get a colour description.` : "No objects found, so each spot gets a description of its colour.");
  } catch (e) { console.warn("Object detector unavailable:", e); EXPORT && EXPORT.labelNote("The object detector couldn't load, maybe you're offline. Each spot gets a description of its colour instead."); }
  finally { LABEL_OBJ.job = false; VSCENE = null; refreshLabels(); drawStage(); }
}
function refreshLabels() { if (EXPORT && SCORE) EXPORT.renderLabels(currentAutoLabels(), !!labelObjects()); }
// the sound analysis for the preview: from the notes at once, from the rendered audio once the
// piece has been rendered in the background (only when the look reacts to the sound)
let AN = { key: null, an: null, job: false };
function wantsSound() { const o = P.video; return (o.react || 0) > 0 || o.bottom === "spectrum" || o.bottom === "wave"; }
let anT = 0;
function scheduleAnalysis() {
  clearTimeout(anT);
  if (!exportView() || !SCORE || !wantsSound()) return;
  const key = masterKey(); if (AN.key === key || AN.job) return;
  anT = setTimeout(async () => {
    if (!exportView() || AN.job) return;
    AN.job = true; EXPORT && EXPORT.previewNote("Listening to the song so the preview can follow the beat…");
    try {
      const m = await renderMaster(); if (masterKey() !== key) return;
      AN = { key, an: analyzeAudio(m.chs, m.sr, 60), job: false };
      if (VSCENE) VSCENE.an = AN.an;
      EXPORT && EXPORT.previewNote("The preview now follows the real sound.");
      drawStage();
    } catch (e) { console.warn("Sound analysis failed:", e); EXPORT && EXPORT.previewNote(""); }
    finally { AN.job = false; }
  }, 900);
}
let COVER = { img: null, id: 0 };
function sceneFor(sc, src) {
  const an = AN.key === masterKey() ? AN.an : null;
  const S = videoScene(sc, src, P.video, videoCaption(sc), { an: an || undefined, auto: currentAutoLabels(), maps: P.video.patch ? videoMaps() : null });
  S.coverImg = COVER.img; S.coverImgId = COVER.id;
  return S;
}
async function loadCover(file) {
  try {
    const bmp = await createImageBitmap(file), k = Math.min(1, 3840 / Math.max(bmp.width, bmp.height));
    const c = makeCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k)); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    COVER = { img: c, id: COVER.id + 1 }; P.video.cover = "image";
    if (VSCENE) { VSCENE.coverImg = c; VSCENE.coverImgId = COVER.id; }
    if (EXPORT) EXPORT.sync(); if (exportView()) drawStage();
  } catch (e) { flash("That image couldn't be read for the cover."); }
}
// The stage while the Export tab is open: the video frame at the playhead, at the frame's shape.
let VSCENE = null, PV = null;
// Dragging the title (or the chord line) on the preview: it snaps to the centre, the thirds and
// the safe margins, with guides while it moves; the position is kept as a fraction of the frame.
function initVideoDrag() {
  const cv = $("#stage");
  let drag = null;
  const frameAt = e => { const p = stagePos(e); return PV ? { x: (p.x * PV.W) / PV.w, y: (p.y * PV.H) / PV.h } : null; };
  const hitAt = f => { const H = VSCENE && VSCENE.hit; if (!H || !f) return null; for (const k of ["title", "point", "logo", "bar"]) { const b = H[k]; if (b && f.x >= b.x0 && f.x <= b.x1 && f.y >= b.y0 && f.y <= b.y1) return k; } return null; };
  cv.addEventListener("pointerdown", e => {
    if (!exportView() || !VSCENE || e.button !== 0) return;
    const f = frameAt(e), k = hitAt(f); if (!k) return;
    const b = VSCENE.hit[k];
    drag = { k, dx: b.ax - f.x, dy: b.ay - f.y, align: b.align };
    if (k === "title" && !P.video.titleXY) P.video.titleAlign = b.align;
    cv.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
  }, true);
  cv.addEventListener("pointermove", e => {
    if (!exportView() || !VSCENE) return;
    const f = frameAt(e); if (!f) return;
    if (!drag) { cv.style.cursor = hitAt(f) ? "move" : ""; return; }
    const W = PV.W, H = PV.H, s = safeArea(P.video.shape), pad = 44 * (Math.min(W, H) / 1080);
    let x = (f.x + drag.dx) / W, y = (f.y + drag.dy) / H;
    const xs = [0.5, 1 / 3, 2 / 3, Math.max(pad / W, s.left), 1 - Math.max(pad / W, s.right)], ys = [0.5, 1 / 3, 2 / 3, Math.max(pad / H, s.top) + 0.04, 1 - Math.max(pad / H, s.bottom)];
    const guides = [];
    for (const g of xs) if (Math.abs(x - g) < 0.015) { x = g; guides.push({ x: g }); break; }
    for (const g of ys) if (Math.abs(y - g) < 0.015) { y = g; guides.push({ y: g }); break; }
    x = clamp(x, 0.02, 0.98); y = clamp(y, 0.04, 0.98);
    if (drag.k === "title") P.video.titleXY = { x, y }; else if (drag.k === "bar") P.video.barXY = { x, y }; else if (drag.k === "logo") P.video.logoXY = { x, y }; else { P.video.pointXY = { x, y }; P.video.pointAlign = drag.align; }
    VSCENE.guides = guides; drawStage();
  }, true);
  const end = () => { if (!drag) return; drag = null; if (VSCENE) VSCENE.guides = null; drawStage(); if (EXPORT) EXPORT.sync(); };
  cv.addEventListener("pointerup", end, true); cv.addEventListener("pointercancel", end, true);
}
function drawVideoPreview(cv) {
  const wrap = $("#lightbox"), o = P.video, { W, H } = frameSize(o.shape, o.size, SRC.width, SRC.height), ar = H / W;
  const small = window.matchMedia("(max-width: 980px)").matches;
  const cw = wrap.clientWidth - 16, chMax = small ? Math.min(window.innerHeight * 0.6, cw * ar) : wrap.clientHeight - 16;
  let w = cw, h = cw * ar; if (h > chMax) { h = chMax; w = h / ar; }
  if (small) wrap.style.height = h + 16 + "px";
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + "px"; cv.style.height = h + "px"; }
  stageGeom = { w, h }; PV = { w, h, W, H };
  if (EXPORT) EXPORT.sizeNote(`The video will be ${W} × ${H} px${o.size === "original" ? ", the image's own size" : ""}${o.shape !== "image" ? ` (${o.shape === "wide" ? "16:9" : o.shape === "square" ? "1:1" : o.shape === "portrait" ? "4:5" : "9:16"})` : ""}.`);
  const src = videoSource(Math.min(1600, Math.max(w, h) * dpr));
  if (!VSCENE || VSCENE.sc !== SCORE || VSCENE.src !== src || (P.video.patch && !VSCENE.maps)) VSCENE = sceneFor(SCORE, src);
  VSCENE.o = o;
  const g = cv.getContext("2d"), k = (w * dpr) / W; g.setTransform(k, 0, 0, k, 0, 0);
  // stopped at the very start, show the frame at 1 s: the first frame is black (fade in) and the title fades in
  let sec = (Math.min(currentBeat(), SCORE.total) * 60) / SCORE.bpm;
  if (!Player.playing && sec < 0.05) sec = hasCover(VSCENE) ? 0 : Math.min(1, VSCENE.total);
  drawVideoFrame(g, W, H, sec, VSCENE, { preview: true });
}
// scene and audio for an export: the master, its analysis, the fades on the sound
async function videoJob(say, longSide) {
  const m = await renderMaster(say), o = P.video;
  await ensureFont(o.font);
  const S = sceneFor(SCORE, videoSource(longSide, true));
  S.an = AN.key === masterKey() && AN.an ? AN.an : analyzeAudio(m.chs, m.sr, 60);
  const chs = o.fadeSound && (o.fadeIn > 0 || o.fadeOut > 0) ? fadeAudio(m.chs, m.sr, o.fadeIn || 0, o.fadeOut || 0) : m.chs;
  return { S, audio: { chs, sr: m.sr, gain: m.gain } };
}
function exportVideo(container = "mp4") {
  return exportJob("video", async say => {
    const o = P.video, { W, H } = frameSize(o.shape, o.size, SRC.width, SRC.height);
    const { S, audio } = await videoJob(say, Math.max(W, H)), label = container === "webm" ? "WebM" : "video";
    say(`Encoding ${label} ${W}×${H}`);
    const r = await encodeVideo(S, { W, H, fps: o.fps, audio, container, bpp: (QUALITY[o.quality] || QUALITY.high).bpp, onProgress: x => say(`Encoding ${label} ${W}×${H}`, x), cancelled: () => EXPORT_CANCEL });
    const name = `${fileBase()}.${container}`;
    await DL.save({ filename: name, data: r.blob });
    const vc = r.codec.startsWith("avc") ? "H.264" : r.codec.split(".")[0].toUpperCase(), ac = r.audio ? (r.audio.startsWith("mp4a") ? " + AAC" : " + Opus") : ", no sound";
    return `Saved ${name} (${W}×${H}, ${o.fps} fps, ${vc}${ac}, ${(r.blob.size / 1e6).toFixed(1)} MB)`;
  });
}
function exportGif() {
  return exportJob("video", async say => {
    const o = P.video, f = frameSize(o.shape, o.size, SRC.width, SRC.height), W = Math.round(o.gifWidth / 2) * 2, H = Math.round((f.H * W) / f.W / 2) * 2;
    const { S } = await videoJob(say, Math.max(W, H));
    const [from, to] = gifRange(S, o.gifRange);
    say(`Making the GIF ${W}×${H}`);
    const blob = await encodeGif(S, { W, H, fps: o.gifFps, from, to, onProgress: x => say(`Making the GIF ${W}×${H}`, x), cancelled: () => EXPORT_CANCEL });
    const name = `${fileBase()}.gif`;
    await DL.save({ filename: name, data: blob });
    return `Saved ${name} (${W}×${H}, ${(to - from).toFixed(1)} s, ${(blob.size / 1e6).toFixed(1)} MB)`;
  });
}
function exportPoster() {
  return exportJob("poster", async say => {
    const o = P.video, { W, H } = frameSize(o.shape, o.size, SRC.width, SRC.height);
    const { S } = await videoJob(say, Math.max(W, H));
    // the frame at the playhead; at the very start, the moment the eye reaches the climax
    let sec = (Math.min(currentBeat(), SCORE.total) * 60) / SCORE.bpm;
    if (sec < 0.05) { const c = S.tl.find(p => p.section === "climax"); sec = c ? c.t0 + 0.45 : S.total * 0.6; }
    const blob = await posterPng(S, W, H, sec), name = `${fileBase()}_poster.png`;
    await DL.save({ filename: name, data: blob });
    return `Saved ${name} (${W}×${H}, the frame at ${sec.toFixed(1)} s)`;
  });
}

/* ============ wiring ============ */
const typing = el => el && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName));
export function init() {
  // inspection hook for development builds only
  // development hook for the browser checks (not in the production build)
  if (import.meta.env && import.meta.env.DEV) window.__sonification = { P, PATH, get points() { return POINTS; }, get score() { return SCORE; }, recipeJson, openProject, scoreHash: () => SCORE && scoreHash(SCORE), renderMaster, invalidateMusic: () => invalidate(LV.MUSIC) };
  for (const host of Object.keys(SLIDERS)) {
    const el = $("#" + host);
    for (const d of SLIDERS[host]) { const s = makeSlider(d, P, onParam); SL[d.key] = s; if (d.adv) s.el.classList.add("adv-only"); el.appendChild(s.el); }
  }
  initKeyControls();
  initRulesControls();
  initSeek();
  initLayout();
  initExpert();
  // style: a grouped dropdown with what each style is, in a line
  const styleSel = $("#styleSel");
  styleSel.innerHTML = STYLE_GROUPS.map(([g, keys]) => `<optgroup label="${g}">${keys.filter(k => STYLES[k]).map(k => `<option value="${k}">${esc(STYLES[k].name)}</option>`).join("")}</optgroup>`).join("");
  const styleNote = () => { $("#styleNote").textContent = STYLE_DESC[P.style] || ""; renderStyleSuggest(); };
  STYLE_SEG = { set(v) { styleSel.value = v; styleNote(); } };
  STYLE_SEG.set(P.style);
  styleSel.addEventListener("change", () => {
    const v = styleSel.value; P.style = v; styleNote(); SL.reverb.set(STYLES[v].reverb, false); applyMixLive();
    invalidate(LV.MUSIC);
  });
  $("#styleSuggest").addEventListener("click", e => {
    const b = e.target.closest("[data-style]"); if (!b) return;
    styleSel.value = b.dataset.style; styleSel.dispatchEvent(new Event("change"));
  });
  DUR_SEG = makeSeg($("#durSeg"), DURATIONS.map(d => [String(d), `${d} s`]), String(P.duration), v => { P.duration = Number(v); invalidate(LV.MUSIC); });
  MEL_SEG = makeSeg($("#melSeg"), [["classic", "Classic"], ["story", "Story"], ["improv", "Improvise"]], P.melody, v => { P.melody = v; STORY.failed = false; invalidate(LV.MUSIC); });
  const placeSel = $("#placeSel"), groups = {};
  for (const [k, v] of Object.entries(PLACEMENTS)) (groups[v.group] = groups[v.group] || []).push([k, v.name]);
  placeSel.innerHTML = Object.entries(groups).map(([g, items]) => `<optgroup label="${g}">${items.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("")}</optgroup>`).join("");
  placeSel.value = P.placement;
  placeSel.addEventListener("change", () => { P.placement = placeSel.value; ATTN.failed = false; invalidate(LV.SAL); });
  CONNECT_SEG = makeSeg($("#connectSeg"), Object.entries(CONNECT), P.connect, v => { P.connect = v; invalidate(LV.MUSIC); });
  const LEN = [["off", "Off"], ["1", "1 bar"], ["2", "2 bars"], ["auto", "Auto"]], lenVal = v => (v === "1" || v === "2" ? Number(v) : v);
  INTRO_SEG = makeSeg($("#introSeg"), LEN, String(P.intro ?? "auto"), v => { P.intro = lenVal(v); invalidate(LV.MUSIC); });
  END_SEG = makeSeg($("#endSeg"), LEN, String(P.end ?? "auto"), v => { P.end = lenVal(v); invalidate(LV.MUSIC); });
  CIRCLE_SEG = makeSeg($("#circleSeg"), [["area", "From the area"], ["same", "Same for all"]], P.circleSize || "area", v => { P.circleSize = v; invalidate(LV.PATH); });
  CHORD_SEG = makeSeg($("#chordRateSeg"), [["2", "Slower"], ["1", "Style"], ["0.5", "Faster"]], String(P.chordRate ?? 1), v => { P.chordRate = Number(v); invalidate(LV.MUSIC); });
  GROOVE_SEG = makeSeg($("#grooveSeg"), [["straight", "Straight"], ["neural", "Human (GrooVAE)"]], P.groove, v => { P.groove = v; GROOVE.failed = false; invalidate(LV.MUSIC); });
  makeSeg($("#viewSeg"), [["img", "Image"], ["sal", "Eye map"], ["edge", "Edges"], ["reg", "Regions"], ["cov", "Coverage"]], view, v => { view = v; drawStage(); });
  // Simple keeps the image and the eye map; the analysis views are in Advanced
  for (const k of ["edge", "reg", "cov"]) { const b = $(`#viewSeg [data-v="${k}"]`); if (b) b.classList.add("adv-only"); }
  UI_SEG = makeSeg($("#uiModeSeg"), [["simple", "Simple"], ["advanced", "Advanced"], ["expert", "Expert"]], UI.mode, applyUiMode);
  $("#toAdvanced").addEventListener("click", () => applyUiMode("advanced"));
  applyUiMode(UI.mode);
  initAppearance();

  // advanced groups remember their state locally
  document.querySelectorAll("details[data-adv]").forEach(d => {
    const k = "adv." + d.dataset.adv; if (store.get(k) === "1") d.open = true;
    d.addEventListener("toggle", () => store.set(k, d.open ? "1" : "0"));
  });

  for (const t of TABS) $(`#tab-${t}`).addEventListener("click", () => selectTab(t));
  $(".tabs").addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const cur = TABS.findIndex(t => $(`#tab-${t}`).getAttribute("aria-selected") === "true");
    const nxt = TABS[(cur + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
    selectTab(nxt); $(`#tab-${nxt}`).focus();
  });
  initPointEditor();
  $("#pan-point").addEventListener("click", e => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { selectPoint(SEL + Number(nav.dataset.nav)); return; }
    if (e.target.closest("[data-hear]")) audition(SEL);
    const mv = e.target.closest("[data-move]"); if (mv) movePoint(SEL, Number(mv.dataset.move));
    if (e.target.closest("[data-del]")) deletePoint(SEL);
  });
  MODE_SEG = makeSeg($("#modeSeg"), [["auto", "Auto"], ["manual", "Manual"], ["mixed", "Mixed"]], PATH.mode, setMode);
  $("#addBtn").addEventListener("click", () => { tool = tool === "add" ? "select" : "add"; syncPathUI(); });
  $("#undoBtn").addEventListener("click", undo); $("#redoBtn").addEventListener("click", redo);
  $("#saveProject").addEventListener("click", () => { closeMenus(); saveRecipe(); });
  $("#openProject").addEventListener("click", () => { closeMenus(); $("#projectFile").click(); });
  $("#projectFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) openProject(f); });
  initStageEditing();

  $("#showPath").addEventListener("change", e => { showPath = e.target.checked; drawStage(); renderWhy(); });
  $("#play").addEventListener("click", () => togglePlay());
  $("#file").addEventListener("change", e => { loadFile(e.target.files[0]); e.target.value = ""; });
  $("#demo").addEventListener("change", e => { if (e.target.value) loadDemo(e.target.value); });
  $("#loadingCancel").addEventListener("click", () => { cancelIngest(); showLoading(false); });
  const lb = $(".stage");
  ["dragenter", "dragover"].forEach(t => lb.addEventListener(t, e => { e.preventDefault(); $("#lightbox").classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(t => lb.addEventListener(t, e => { e.preventDefault(); $("#lightbox").classList.remove("dragging"); }));
  lb.addEventListener("drop", e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
  $("#roll").addEventListener("click", e => {
    if (!SCORE || !tlGeom) return;
    const rc = e.currentTarget.getBoundingClientRect(), x = e.clientX - rc.left;
    const beat = clamp((x - tlGeom.padL) / (tlGeom.w - tlGeom.padL - tlGeom.padR)) * SCORE.total;
    const i = SCORE.points.findIndex(F => beat >= F.t0 && beat < F.t1);
    if (i >= 0) { SEL = i; renderPoint(); }
    if (Player.playing && !Player.audition) startPlayback(beat); else { stopPlayback(); Player.pausedBeat = beat; drawAll(); }
  });
  document.addEventListener("keydown", e => {
    if (typing(document.activeElement)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "[") selectPoint(SEL - 1);
    else if (e.key === "]") selectPoint(SEL + 1);
    else if (e.key === "Delete" || e.key === "Backspace") { if (SCORE && SCORE.points.length) { e.preventDefault(); deletePoint(SEL); } }
    else if (e.key.toLowerCase() === "a") { tool = tool === "add" ? "select" : "add"; syncPathUI(); }
    else if (e.key === "Escape" && tool === "add") { tool = "select"; syncPathUI(); }
    else if (e.key === "?") showShortcuts();
  });
  $("#aboutBtn").addEventListener("click", () => { closeMenus(); showAbout(); });
  $("#welcomeBtn").addEventListener("click", () => { closeMenus(); showWelcome(); });
  $("#newSong").addEventListener("click", () => openNewSong());
  $("#shortcutsBtn").addEventListener("click", () => { closeMenus(); showShortcuts(); });
  $("#guideBtn").addEventListener("click", () => { closeMenus(); showGuide(true); });
  $("#howBtn").addEventListener("click", () => { closeMenus(); showHowItWorks(); });
  $("#brandLogo").innerHTML = LOGO;
  if (store.get("welcomeDone")) showGuide(); else showWelcome();
  EXPORT = initExport({ P, onLook: () => { if (exportView()) { drawStage(); scheduleAnalysis(); } }, onAudio: exportAudio, onMidi: exportMidi, onZip: doExport,
    onVideo: () => exportVideo("mp4"), onWebm: () => exportVideo("webm"), onGif: exportGif, onPoster: exportPoster, onDetect: detectObjects,
    onFont: k => ensureFont(k).then(() => { if (exportView()) drawStage(); }), onCancel: () => { EXPORT_CANCEL = true; }, onCoverFile: loadCover });
  ensureFont(P.video.font);
  initVideoDrag();
  new ResizeObserver(() => drawAll()).observe($("#lightbox"));
  new ResizeObserver(() => drawTimeline()).observe($("#rollWrap"));
  updatePlayBtn();
  initSourceControls();
  addToLibrary(instrumentCatalog());
  initOrch();
  SOUND = initSound({ P, onMusic: () => invalidate(LV.MUSIC), onFx: () => applyMixLive(), onPreview: (layer, tim, kit) => preview(ensureCtx(), layer, tim, kit || null),
    getExtra: () => ((SCORE && SCORE.extra) || []).map(L => ({ id: L.id, name: ROLES[L.role].name, inst: SCORE.inst[L.id] })), onPickExtra: id => pickLayerInstrument(id) });
  // the last session (a phone may have closed the page in the background), else the first demo
  restoreSession().then(ok => { if (!ok && !INFO) loadDemo("lac"); });
  // save at once when the page is hidden: a phone may close it without warning
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") scheduleSave(0); });
  window.addEventListener("pagehide", () => scheduleSave(0));

  // downloads: a link the browser saves
  DL = { save: async ({ filename, data }) => {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000); return { status: "saved" };
  } };
  $("#saveProject").hidden = false;
}
