// The Export tab: audio files (WAV, MP3, M4A), MIDI, the ZIP, and the video (MP4, WebM, GIF,
// a PNG poster) with everything about its look. The look lives in P.video; changing it only
// redraws the stage, which previews the video while this tab is open.
import { makeSlider, makeSeg } from "./controls.js";
import { AUDIO_FORMATS, aacSupported } from "../export/audio.js";
import { SHAPES, VIDEO_THEMES, PATH_MODES, POINT_MODES, EFFECTS, EYES, CAPTIONS, TITLE_POS, TITLE_WHEN, SUBTITLES, BOTTOMS, BAR_ORIENT, BAR_DIR, EASES, GIF_RANGES, COVERS, BOTTOM_FILLS, PATH_FILLS, PLACE_STYLES, NUMBER_STYLES, TEXT_STYLES, TITLE_ANIMS, ALIGNS, videoSupported, defaultVideo } from "../export/video.js";
import { LINE_SHAPES, LINE_STYLES } from "../export/paths.js";
import { GRADES, FONTS, QUALITY, LOOKS, pickLook, defaultEdit, curveLUT, CURVE_X } from "../export/look.js";
import { LABEL_MODES } from "../export/labels.js";

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ICON_DL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
const ICON_FILM = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9.5 5 2.5-5 2.5z"/></svg>';
const LOOK_STORE = "sonification.looks";
const readLooks = () => { try { return JSON.parse(localStorage.getItem(LOOK_STORE) || "{}") || {}; } catch (e) { return {}; } };
const writeLooks = v => { try { localStorage.setItem(LOOK_STORE, JSON.stringify(v)); return true; } catch (e) { return false; } };

export function initExport({ P, onLook, onAudio, onMidi, onZip, onVideo, onWebm, onGif, onPoster, onDetect, onFont, onCancel, onCoverFile = () => {} }) {
  const V = P.video, host = document.querySelector("#pan-export");
  if (V.eye === true) V.eye = "dot"; else if (V.eye === false) V.eye = "off";
  const seg = (id, label, cls = "") => `<div class="field ${cls}" id="f_${id}"><div class="flabel" id="lbl_${id}">${label}</div><div class="seg seg-sm" id="${id}" role="radiogroup" aria-labelledby="lbl_${id}"></div></div>`;
  const sel = (id, label, items) => `<div class="field" id="f_${id}"><label class="flabel" for="${id}">${label}</label><span class="select"><select id="${id}">${items}</select></span></div>`;
  const opts = obj => Object.entries(obj).map(([k, v]) => `<option value="${k}">${esc(typeof v === "string" ? v : v.name)}</option>`).join("");
  const tog = (id, label) => `<label class="toggle"><input type="checkbox" id="${id}"><span>${label}</span></label>`;
  const box = id => `<div id="${id}" class="sliders"></div>`;
  const col = (id, label) => `<label id="l_${id}"><input type="color" id="${id}"><span>${label}</span></label>`;
  const group = (id, title, body, open = false) => `<details class="adv xgroup" data-x="${id}"${open ? " open" : ""}><summary>${title}</summary>${body}</details>`;
  host.innerHTML = `
    <section class="card" aria-labelledby="hAudioOut"><h3 id="hAudioOut">Audio</h3>
      <div class="field"><label class="flabel" for="xFmt">Format</label><span class="select"><select id="xFmt">${Object.entries(AUDIO_FORMATS).map(([k, f]) => `<option value="${k}">${esc(f.name)}</option>`).join("")}</select></span><p class="snote" id="xFmtNote"></p></div>
      <div id="xRateBox">${seg("xRate", "Bit rate")}</div>
      <div class="xrow">
        <button type="button" class="btn btn-primary" id="xAudio">${ICON_DL}Download audio</button>
        <button type="button" class="btn" id="xMidi" title="For your DAW">MIDI for a DAW</button>
        <button type="button" class="btn" id="xZip">Everything (ZIP)</button>
      </div>
      <p class="snote">If an AI model is still working, the export waits for it to finish. The ZIP has a WAV, the MIDI, the settings and the project file.</p>
      <p class="snote">The MIDI file opens in any DAW: one track per layer, named after its instrument and set to the nearest General MIDI sound, with the tempo, the key (and the modulation), a marker at every place, the performed velocities and timing, and the expression (CC11), vibrato (CC1) and timbre curves.</p>
    </section>
    <section class="card" aria-labelledby="hVideoOut"><h3 id="hVideoOut">Video</h3>
      <p class="snote">While you're on this tab, the picture shows the video. Press play to see exactly what you'll get.</p>
      ${seg("xSize", "Size")}
      <p class="snote" id="xSizeNote"></p>
      ${seg("xCover", "Cover")}
      <div id="xCoverBox">${box("xCoverTime")}
        <div id="xCoverPickBox"><button type="button" class="btn" id="xCoverPick">Choose an image</button> <span class="snote" id="xCoverName"></span><input type="file" id="xCoverFile" class="visually-hidden" accept="image/*"></div>
        <div class="vtoggles" id="xCoverCleanBox">${tog("xCoverClean", "Just the picture (no path, places or text)")}</div>
        ${box("xCoverHold")}</div>
      <p class="snote">Apps like WhatsApp show the first frame as the video's preview. The cover is that frame: without one it would be black, because the video fades in.</p>
      <div class="adv-only">${seg("xShape", "Shape")}<div class="vtoggles" id="xSafeBox">${tog("xSafe", "Show the safe area (preview only)")}</div>${seg("xQuality", "Quality")}${seg("xFps", "Frames per second")}</div>
      <div class="xrow">
        <button type="button" class="btn btn-primary" id="xVideo">${ICON_FILM}Export video (MP4)</button>
        <button type="button" class="btn" id="xCancel" hidden>Cancel</button>
      </div>
      <div class="xrow xrow-sm">
        <button type="button" class="btn" id="xWebm" title="VP9 and Opus, for the web">WebM</button>
        <button type="button" class="btn" id="xGif" title="Silent and looping">GIF</button>
        <button type="button" class="btn" id="xPoster" title="The frame at the playhead">Poster (PNG)</button>
      </div>
      <div class="loadbar xbar" id="xBar" hidden><span></span></div>
      <p class="snote" id="xStatus" role="status"></p>
      <p class="snote" id="xPreviewNote" role="status"></p>
      ${group("gif", "GIF", `${seg("xGifW", "Width")}${seg("xGifFps", "Frames per second")}${seg("xGifRange", "Part")}<p class="snote">GIFs loop and have no sound.</p>`)}
    </section>
    ${group("look", "Look", `
      ${sel("xLook", "Start from a look", `<option value="">Choose…</option><optgroup label="Built in">${Object.entries(LOOKS).map(([k, l]) => `<option value="b:${k}">${esc(l.name)}</option>`).join("")}</optgroup><optgroup label="My looks" id="xMyLooks"></optgroup>`)}
      <div class="xrow xrow-sm"><input type="text" id="xLookName" class="text-input" maxlength="40" placeholder="Name this look"><button type="button" class="btn" id="xLookSave">Save look</button><button type="button" class="btn" id="xLookDel" hidden>Delete</button></div>
      <p class="snote" id="xLookNote">A look keeps all the style choices below, so you can reuse them on other pictures. Saved looks stay in this browser.</p>
      <div class="field"><div class="flabel" id="lblTheme2">Colours</div>
        <div class="vthemes" id="xTheme" role="radiogroup" aria-labelledby="lblTheme2">${Object.entries(VIDEO_THEMES).map(([k, t]) => `<button type="button" role="radio" aria-checked="false" data-v="${k}" title="${esc(t.name)}"><span style="background:${t.path}"></span><span style="background:${t.point}"></span><em>${esc(t.name)}</em></button>`).join("")}</div>
        <div class="vcolors"><label><input type="color" id="xPathCol">Path</label><label><input type="color" id="xPointCol">Places and effects</label></div></div>`, true)}
    ${group("edit", "Image edit *", `
      <p class="snote">* Only the picture in the video changes. The music always reads the original image.</p>
      <div class="field"><div class="flabel">Light and colour</div><div id="xEdBasic" class="sliders sliders-2"></div></div>
      <div class="field"><div class="flabel">Levels</div><div id="xEdLevels" class="sliders sliders-2"></div></div>
      <div class="field"><div class="srow"><div class="flabel" id="lbl_xCurveCh">Curves</div><button type="button" class="linkbtn" id="xCurveReset">Reset curve</button></div>
        <div class="seg seg-sm" id="xCurveCh" role="radiogroup" aria-labelledby="lbl_xCurveCh"></div>
        <svg id="xCurve" class="xcurve" viewBox="0 0 200 200" role="img" aria-label="Tone curve: drag the points up or down"></svg>
        <p class="snote">Drag a point up to brighten that part of the tones, down to darken it. The ends set the darkest and the brightest.</p></div>
      ${sel("xGrade", "Colour grade", opts(GRADES))}
      ${box("xGradeAmt")}${box("xVignette")}
      <div class="vcolors">${col("xVigCol", "Vignette colour")}${col("xTintCol", "Tint")}</div>
      ${box("xTint")}${box("xGrain")}${box("xDim")}
      <button type="button" class="btn" id="xEditReset">Reset the edit</button>`)}
    ${group("camera", "Camera", `
      ${seg("xCamera", "Camera")}
      <div id="xCamBox">${box("xZoom")}${seg("xEase", "Motion")}${box("xCamMove")}</div>
      ${box("xDrift")}
      ${seg("xFit", "Framing")}`)}
    ${group("path", "Path and places", `
      ${seg("xPath", "Path")}
      <div id="xPathOps" class="sliders sliders-2"></div>
      ${seg("xLineShape", "Shape")}
      ${box("xCurve")}
      ${sel("xLine", "Line style", opts(LINE_STYLES))}
      ${box("xWidth")}
      <div id="xDashBox" class="sliders sliders-2"></div>
      ${box("xGlow")}
      ${seg("xPathFill", "Line colour")}
      <div class="vcolors" id="xPathCols">${col("xPathColA", "First colour")}${col("xPathCol2", "Second colour")}</div>
      ${seg("xPoints", "Places")}
      <div id="xPlaceOps" class="sliders sliders-2"></div>
      ${seg("xPlaceStyle", "Circles")}
      ${box("xPlaceSize")}
      ${seg("xNumberStyle", "Numbers")}
      <div class="vtoggles">${tog("xPassages", "Connection notes")}${tog("xClimaxOwn", "Climax in its own colour")}</div>
      <div class="vcolors" id="xClimaxCols">${col("xClimaxCol", "Climax colour")}</div>
      ${seg("xEye", "The eye")}
      <div class="vcolors">${col("xEyeCol", "Eye colour")}</div>`)}
    ${group("labels", "Labels on places", `
      ${seg("xLabels", "Labels")}
      <div id="xLabelAuto"><button type="button" class="btn" id="xDetect">Detect objects</button><p class="snote" id="xLabelNote">Each spot gets the name of the object under it. Spots that aren't on an object get a short description of their colour.</p></div>
      <div id="xLabelCustom"><p class="snote">Write a label for each spot, or leave it empty. <button type="button" class="linkbtn" id="xLabelFill">Fill in the detected names</button></p><ol class="xlabels" id="xLabelList"></ol></div>
      <div class="vcolors">${col("xLabelCol", "Text")}${col("xLabelBg", "Background")}</div>
      <div class="vtoggles">${tog("xLabelKeep", "Keep labels after the eye leaves")}</div>`)}
    ${group("fx", "Effects and sound", `
      <div class="field"><div class="flabel">When the eye arrives</div><div class="vtoggles" id="xFx">${Object.entries(EFFECTS).map(([k, n]) => tog("xFx_" + k, n)).join("")}</div></div>
      <div class="vcolors">${col("xSpotCol", "Spotlight colour")}</div>
      ${box("xStrength")}${box("xReact")}
      ${seg("xBottom", "Sound display")}
      <div id="xBarBox">${seg("xBarOrient", "Orientation")}${seg("xBarDir", "Which way it grows")}
        <p class="snote">Drag it on the preview to place it anywhere. <button type="button" class="linkbtn" id="xBarReset" hidden>Put it back</button></p>
        <div id="xBarOps" class="sliders sliders-2"></div></div>
      <div id="xBottomCols">${seg("xBottomFill", "Bottom colour")}<div class="vcolors">${col("xBotA", "Colour")}${col("xBotB", "Second colour")}</div></div>`)}
    ${group("logo", "Logo", `
      <div class="vtoggles">${tog("xLogo", "Show the Lux Sonora logo")}</div>
      <div id="xLogoBox">
        <div class="vtoggles">${tog("xLogoAnim", "Its waves move with the music")}</div>
        <div class="vcolors">${col("xLogoCol", "Colour")}</div>
        <div id="xLogoOps" class="sliders sliders-2"></div>
        <p class="snote">Drag it on the preview to place it anywhere. <button type="button" class="linkbtn" id="xLogoReset" hidden>Put it back</button></p>
      </div>`)}
    ${group("text", "Text and timing", `
      ${seg("xCaption", "Text")}
      <div id="xTextBox">
        <div class="field"><label class="flabel" for="xTitle">Title</label><input type="text" id="xTitle" class="text-input" maxlength="80" placeholder="The image name"></div>
        ${sel("xFont", "Font", opts(FONTS))}
        <div class="vcolors">${col("xTitleCol", "Title colour")}${col("xSubCol", "Line under it")}</div>
        ${seg("xSubtitle", "Line under the title")}
        <div class="field" id="xSubTextBox"><label class="flabel" for="xSubText">Your line</label><input type="text" id="xSubText" class="text-input" maxlength="90" placeholder="A walk through the sunset"></div>
        ${seg("xTitlePos", "Position")}
        <p class="snote">Or drag the title (and the chord line) on the preview, anywhere you like. <button type="button" class="linkbtn" id="xPosReset" hidden>Reset position</button></p>
        ${seg("xTitleAlign", "Alignment")}
        ${seg("xTextStyle", "Text style")}
        <div class="vcolors" id="xBoxCols">${col("xBoxCol", "Box or outline")}</div>
        <div class="vtoggles">${tog("xCaps", "Capitals")}</div>
        ${box("xSpacing")}
        ${seg("xTitleAnim", "How it comes in")}
        ${seg("xTitleWhen", "Show the title")}${box("xTitleSecs")}${box("xTextSize")}
      </div>
      <div class="vtoggles">${tog("xEndCard", "End card (the last 3 s)")}</div>
      <div class="field" id="xCreditBox"><label class="flabel" for="xCredit">End card credit</label><input type="text" id="xCredit" class="text-input" maxlength="60"></div>
      <div class="sliders sliders-2" id="xFades"></div>
      <div class="vtoggles">${tog("xFadeSound", "Fade the sound with the picture")}</div>`)}`;
  const $ = s => host.querySelector(s);
  const look = () => onLook();

  // ---- audio
  const fmt = $("#xFmt");
  const showFmt = () => {
    const F = AUDIO_FORMATS[P.out.format]; fmt.value = P.out.format;
    $("#xFmtNote").textContent = F.note; $("#xRateBox").hidden = !F.rates;
    if (F.rates) {
      if (!F.rates.includes(P.out.kbps)) P.out.kbps = F.rates[0];
      const old = $("#xRate"), fresh = old.cloneNode(false); old.replaceWith(fresh); // drops the previous listeners
      makeSeg(fresh, F.rates.map(r => [String(r), `${r} kbps`]), String(P.out.kbps), v => { P.out.kbps = Number(v); });
    }
  };
  fmt.addEventListener("change", () => { P.out.format = fmt.value; showFmt(); });
  aacSupported().then(ok => { if (!ok) { const o = fmt.querySelector('option[value="m4a"]'); o.disabled = true; o.textContent += " (not in this browser)"; if (P.out.format === "m4a") { P.out.format = "mp3"; showFmt(); } } }).catch(() => {});
  $("#xAudio").addEventListener("click", () => onAudio());
  $("#xMidi").addEventListener("click", () => onMidi());
  $("#xZip").addEventListener("click", () => onZip());

  // ---- segmented choices on P.video: [id, key, items, number?, after]
  const SEGS = [
    ["xShape", "shape", Object.entries(SHAPES), false, () => vis()],
    ["xCover", "cover", Object.entries(COVERS), false, () => vis()],
    ["xSize", "size", [["original", "Like the image"], ["720", "720p"], ["1080", "1080p"], ["1440", "1440p"], ["2160", "4K"]], "size"],
    ["xQuality", "quality", Object.entries(QUALITY).map(([k, q]) => [k, q.name])],
    ["xFps", "fps", [["24", "24"], ["30", "30"], ["60", "60"]], true],
    ["xGifW", "gifWidth", [["360", "360 px"], ["480", "480 px"], ["640", "640 px"]], true],
    ["xGifFps", "gifFps", [["10", "10"], ["12", "12"], ["15", "15"]], true],
    ["xGifRange", "gifRange", Object.entries(GIF_RANGES)],
    ["xCamera", "camera", [["still", "Still"], ["follow", "Follow the eye"]], false, () => vis()],
    ["xEase", "camEase", Object.entries(EASES).map(([k, e]) => [k, e.name])],
    ["xFit", "fit", [["fill", "Fill the frame"], ["fit", "Whole image"]]],
    ["xPath", "path", Object.entries(PATH_MODES), false, () => vis()],
    ["xLineShape", "lineShape", Object.entries(LINE_SHAPES), false, () => vis()],
    ["xPathFill", "pathFill", Object.entries(PATH_FILLS), false, () => vis()],
    ["xPlaceStyle", "placeStyle", Object.entries(PLACE_STYLES)],
    ["xNumberStyle", "numberStyle", Object.entries(NUMBER_STYLES), false, () => { V.numbers = V.numberStyle !== "none"; }],
    ["xTitleAlign", "titleAlign", Object.entries(ALIGNS), false, () => { V.pointAlign = V.titleAlign === "auto" ? "left" : V.titleAlign; }],
    ["xTextStyle", "textStyle", Object.entries(TEXT_STYLES), false, () => vis()],
    ["xTitleAnim", "titleAnim", Object.entries(TITLE_ANIMS)],
    ["xPoints", "points", Object.entries(POINT_MODES), false, () => vis()],
    ["xEye", "eye", Object.entries(EYES)],
    ["xLabels", "labels", Object.entries(LABEL_MODES), false, () => vis()],
    ["xBottom", "bottom", Object.entries(BOTTOMS), false, () => vis()],
    ["xBarOrient", "barOrient", Object.entries(BAR_ORIENT), false, () => { V.barXY = null; vis(); }],
    ["xBarDir", "barDir", Object.entries(BAR_DIR)],
    ["xBottomFill", "bottomFill", Object.entries(BOTTOM_FILLS), false, () => vis()],
    ["xCaption", "caption", Object.entries(CAPTIONS), false, () => vis()],
    ["xTitlePos", "titlePos", Object.entries(TITLE_POS), false, () => { V.titleXY = null; V.pointXY = null; vis(); }],
    ["xTitleWhen", "titleWhen", Object.entries(TITLE_WHEN), false, () => vis()],
    ["xSubtitle", "subtitle", Object.entries(SUBTITLES), false, () => vis()]
  ];
  const segs = {};
  for (const [id, key, items, num, after] of SEGS) segs[id] = makeSeg($("#" + id), items, String(V[key]), v => { V[key] = num === "size" ? (v === "original" ? v : Number(v)) : num ? Number(v) : v; if (after) after(); look(); });
  // ---- selects
  const SELS = [["xLine", "line"], ["xGrade", "grade"], ["xFont", "font", k => onFont(k)]];
  for (const [id, key, after] of SELS) $("#" + id).addEventListener("change", e => { V[key] = e.target.value; if (after) after(V[key]); vis(); look(); });
  // ---- sliders on P.video: [host, definition]
  const pct = (key, label, def, max = 1, help) => ({ key, label, min: 0, max, step: 0.05, def, scale: 100, unit: "%", help });
  const SLD = [
    ["#xZoom", pct("zoom", "Zoom", 0.35, 1, "How close the camera gets. It pulls back out at the end.")],
    ["#xCamMove", { key: "camMove", label: "Move time", min: 0.4, max: 4, step: 0.1, def: 1.6, unit: "s", dec: 1, help: "How long the camera takes to move from one spot to the next." }],
    ["#xCamMove", pct("camSmooth", "Smoothing", 0.45, 1, "Higher values turn the camera moves into one long, smooth glide.")],
    ["#xDrift", { key: "drift", label: "Slow push-in", min: 0, max: 0.3, step: 0.01, def: 0, scale: 100, unit: "%", help: "A slow zoom in over the whole song." }],
    ["#xPathOps", pct("pathDone", "Travelled", 1)],
    ["#xPathOps", pct("pathAhead", "Still ahead", 0.25)],
    ["#xCoverTime", { key: "coverTime", label: "Which second", min: 0, max: 60, step: 0.5, def: 5, unit: "s", dec: 1, help: "The frame at this moment becomes the cover." }],
    ["#xCoverHold", { key: "coverHold", label: "Cover stays for", min: 0, max: 3, step: 0.1, def: 0.5, unit: "s", dec: 1, help: "Then it blends into the video." }],
    ["#xCurve", pct("curve", "How much it curves", 0.3)],
    ["#xDashBox", { key: "dashLen", label: "Dash length", min: 0.5, max: 10, step: 0.1, def: 3.2, dec: 1, unit: "×" }],
    ["#xDashBox", { key: "dashGap", label: "Gap", min: 1, max: 10, step: 0.1, def: 2.6, dec: 1, unit: "×" }],
    ["#xGlow", pct("glow", "Glow", 0.6)],
    ["#xPlaceSize", { key: "placeSize", label: "Circle size", min: 0.4, max: 2, step: 0.05, def: 1, scale: 100, unit: "%" }],
    ["#xTint", pct("tintAmt", "Tint amount", 0, 0.6)],
    ["#xSpacing", { key: "letterSpace", label: "Letter spacing", min: -0.05, max: 0.4, step: 0.01, def: 0, scale: 100, unit: "%" }],
    ["#xWidth", { key: "lineWidth", label: "Line width", min: 1, max: 12, step: 0.5, def: 3, unit: "px", dec: 1 }],
    ["#xPlaceOps", pct("placeDone", "Visited", 0.7)],
    ["#xPlaceOps", pct("placeAhead", "Still ahead", 0.35)],
    ["#xStrength", pct("strength", "Effect strength", 0.6, 1, "How strong the effects are. They're a bit stronger at the climax.")],
    ["#xReact", pct("react", "React to the sound", 0.4, 1, "Makes the line and the circles pulse with the beat.")],
    ["#xGradeAmt", pct("gradeAmt", "Grade amount", 0.6)],
    ["#xVignette", pct("vignette", "Vignette", 0.25)],
    ["#xGrain", pct("grain", "Film grain", 0)],
    ["#xDim", { key: "dim", label: "Darken the image", min: 0, max: 0.6, step: 0.02, def: 0.1, scale: 100, unit: "%" }],
    ["#xTitleSecs", { key: "titleSecs", label: "For how long", min: 1, max: 15, step: 0.5, def: 4.5, unit: "s", dec: 1, help: "Then it fades out in a second." }],
    ["#xTextSize", { key: "textSize", label: "Text size", min: 0.6, max: 1.8, step: 0.05, def: 1, scale: 100, unit: "%" }],
    ["#xLogoOps", { key: "logoSize", label: "Size", min: 0.4, max: 3, step: 0.05, def: 1, scale: 100, unit: "%" }],
    ["#xLogoOps", pct("logoOpacity", "Opacity", 0.85)],
    ["#xBarOps", { key: "barSize", label: "Height", min: 0.3, max: 3, step: 0.05, def: 1, scale: 100, unit: "%" }],
    ["#xBarOps", { key: "barLength", label: "Length", min: 0.1, max: 1, step: 0.01, def: 1, scale: 100, unit: "%" }],
    ["#xBarOps", pct("barOpacity", "Opacity", 1)],
    ["#xFades", { key: "fadeIn", label: "Fade in", min: 0, max: 3, step: 0.1, def: 0.6, unit: "s", dec: 1 }],
    ["#xFades", { key: "fadeOut", label: "Fade out", min: 0, max: 4, step: 0.1, def: 1.5, unit: "s", dec: 1 }]
  ];
  const sl = {};
  for (const [hostId, d] of SLD) { const x = makeSlider(d, V, look); sl[d.key] = x; $(hostId).appendChild(x.el); }
  // ---- image edit (P.video.edit)
  if (!V.edit) V.edit = defaultEdit();
  const ED = new Proxy({}, { get: (_, k) => (V.edit || (V.edit = defaultEdit()))[k], set: (_, k, v) => { (V.edit || (V.edit = defaultEdit()))[k] = v; return true; } });
  const sgn = (key, label, help, max = 1) => ({ key, label, min: -max, max, step: 0.01, def: 0, scale: 100, unit: "%", signed: true, help });
  const EDS = [
    ["#xEdBasic", { key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.05, def: 0, unit: "EV", dec: 2, signed: true }],
    ["#xEdBasic", sgn("contrast", "Contrast")],
    ["#xEdBasic", sgn("highlights", "Highlights", "Down brings back the bright areas, up makes them glow.")],
    ["#xEdBasic", sgn("shadows", "Shadows", "Up opens the dark areas, down deepens them.")],
    ["#xEdBasic", sgn("temp", "Temperature", "White balance: warmer (to the right) or cooler.")],
    ["#xEdBasic", sgn("tint", "Tint", "White balance: toward magenta (right) or green.")],
    ["#xEdBasic", sgn("saturation", "Saturation")],
    ["#xEdBasic", sgn("vibrance", "Vibrance", "Like saturation, but mostly on the duller colours.")],
    ["#xEdLevels", { key: "black", label: "Black point", min: 0, max: 0.5, step: 0.005, def: 0, scale: 100, unit: "%", dec: 1 }],
    ["#xEdLevels", { key: "white", label: "White point", min: 0.5, max: 1, step: 0.005, def: 1, scale: 100, unit: "%", dec: 1 }],
    ["#xEdLevels", { key: "gamma", label: "Midtones", min: 0.3, max: 3, step: 0.01, def: 1, dec: 2, help: "Above 1 brightens the middle tones, below 1 darkens them." }]
  ];
  const esl = {};
  for (const [hostId, d] of EDS) { const x = makeSlider(d, ED, look); esl[d.key] = x; $(hostId).appendChild(x.el); }
  let curveCh = "l";
  const CH = { l: ["Luminance", "currentColor"], r: ["Red", "#e5484d"], g: ["Green", "#30a46c"], b: ["Blue", "#3e63dd"] };
  const curveSeg = makeSeg($("#xCurveCh"), Object.entries(CH).map(([k, v]) => [k, v[0]]), curveCh, v => { curveCh = v; drawCurve(); });
  const curveOf = ch => { const e = V.edit || (V.edit = defaultEdit()); e.curves = e.curves || {}; return (e.curves[ch] = e.curves[ch] || CURVE_X.slice()); };
  function drawCurve() {
    const svg = $("#xCurve"), ys = curveOf(curveCh), lut = curveLUT(ys), c = CH[curveCh][1];
    const P2 = (x, y) => `${(8 + x * 184).toFixed(1)},${(192 - y * 184).toFixed(1)}`;
    let path = ""; for (let k = 0; k < 256; k += 3) path += (k ? "L" : "M") + P2(k / 255, lut[k]);
    path += "L" + P2(1, lut[255]);
    svg.innerHTML = `<rect x="8" y="8" width="184" height="184" class="xc-bg"/>${[0.25, 0.5, 0.75].map(t => `<line x1="${8 + t * 184}" y1="8" x2="${8 + t * 184}" y2="192" class="xc-grid"/><line x1="8" y1="${8 + t * 184}" x2="192" y2="${8 + t * 184}" class="xc-grid"/>`).join("")}
      <line x1="8" y1="192" x2="192" y2="8" class="xc-diag"/><path d="${path}" fill="none" stroke="${c}" stroke-width="2"/>
      ${ys.map((y, i) => `<circle cx="${8 + CURVE_X[i] * 184}" cy="${192 - y * 184}" r="6" data-i="${i}" class="xc-pt" style="stroke:${c}" tabindex="0" role="slider" aria-label="${CH[curveCh][0]} at ${Math.round(CURVE_X[i] * 100)}%" aria-valuenow="${Math.round(y * 100)}" aria-valuemin="0" aria-valuemax="100"/>`).join("")}`;
  }
  {
    const svg = $("#xCurve"); let drag = -1;
    const yAt = e => { const r = svg.getBoundingClientRect(); return Math.max(0, Math.min(1, (192 - ((e.clientY - r.top) / r.height) * 200) / 184)); };
    svg.addEventListener("pointerdown", e => { const p = e.target.closest(".xc-pt"); if (!p) return; drag = Number(p.dataset.i); svg.setPointerCapture(e.pointerId); e.preventDefault(); });
    svg.addEventListener("pointermove", e => { if (drag < 0) return; curveOf(curveCh)[drag] = Math.round(yAt(e) * 1000) / 1000; drawCurve(); look(); });
    const up = () => { drag = -1; }; svg.addEventListener("pointerup", up); svg.addEventListener("pointercancel", up);
    svg.addEventListener("keydown", e => {
      const p = e.target.closest(".xc-pt"); if (!p || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const i = Number(p.dataset.i), ys = curveOf(curveCh); ys[i] = Math.max(0, Math.min(1, ys[i] + (e.key === "ArrowUp" ? 0.01 : -0.01))); e.preventDefault();
      drawCurve(); look(); const q = $("#xCurve").querySelector(`[data-i="${i}"]`); if (q) q.focus();
    });
  }
  $("#xLogoReset").addEventListener("click", () => { V.logoXY = null; vis(); look(); });
  $("#xBarReset").addEventListener("click", () => { V.barXY = null; vis(); look(); });
  $("#xCurveReset").addEventListener("click", () => { curveOf(curveCh).splice(0, 5, ...CURVE_X); drawCurve(); look(); });
  $("#xEditReset").addEventListener("click", () => { const D = defaultVideo(); V.edit = defaultEdit(); for (const k of ["grade", "gradeAmt", "vignette", "vigColor", "tintColor", "tintAmt", "grain", "dim"]) V[k] = D[k]; sync(); look(); });
  function syncEdit() { for (const [, d] of EDS) esl[d.key].set(ED[d.key] ?? d.def, false); curveSeg.set(curveCh); drawCurve(); }
  // ---- toggles: [id, object, key]
  const checks = [["#xPassages", () => V, "passages"], ["#xClimaxOwn", () => V, "climaxOwn"], ["#xCaps", () => V, "caps"], ["#xSafe", () => V, "safe"], ["#xLabelKeep", () => V, "labelKeep"],
    ["#xEndCard", () => V, "endCard"], ["#xCoverClean", () => V, "coverClean"], ["#xLogo", () => V, "logo"], ["#xLogoAnim", () => V, "logoAnim"], ["#xFadeSound", () => V, "fadeSound"], ...Object.keys(EFFECTS).map(k => ["#xFx_" + k, () => V.fx, k])];
  for (const [id, obj, key] of checks) $(id).addEventListener("change", e => { obj()[key] = e.target.checked; vis(); look(); });
  // ---- colours
  const themeBtns = [...host.querySelectorAll("#xTheme button")];
  const showTheme = () => themeBtns.forEach(b => b.setAttribute("aria-checked", String(b.dataset.v === V.theme)));
  $("#xTheme").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const t = VIDEO_THEMES[b.dataset.v]; V.theme = b.dataset.v; V.pathColor = t.path; V.pointColor = t.point; V.bottomColor = t.point; V.bottomColor2 = t.path;
    syncColors(); showTheme(); look();
  });
  // every colour picker on P.video: [input, key, part of the theme]
  const COLS = [["#xPathCol", "pathColor", true], ["#xPointCol", "pointColor", true], ["#xTitleCol", "titleColor"], ["#xSubCol", "subColor"], ["#xEyeCol", "eyeColor"],
    ["#xLabelCol", "labelColor"], ["#xLabelBg", "labelBg"], ["#xBotA", "bottomColor"], ["#xBotB", "bottomColor2"], ["#xLogoCol", "logoColor"],
    ["#xPathColA", "pathColor", true], ["#xPathCol2", "pathColor2"], ["#xClimaxCol", "climaxColor"], ["#xVigCol", "vigColor"], ["#xTintCol", "tintColor"], ["#xSpotCol", "spotColor"], ["#xBoxCol", "boxColor"]];
  const syncColors = () => { for (const [id, key] of COLS) $(id).value = V[key] || "#ffffff"; };
  for (const [id, key, theme] of COLS) $(id).addEventListener("input", e => { V[key] = e.target.value; if (theme) { V.theme = "custom"; showTheme(); } look(); });
  // ---- text
  $("#xTitle").addEventListener("input", e => { V.title = e.target.value; look(); });
  $("#xCredit").addEventListener("input", e => { V.credit = e.target.value; look(); });
  $("#xSubText").addEventListener("input", e => { V.subText = e.target.value; look(); });
  $("#xCoverPick").addEventListener("click", () => $("#xCoverFile").click());
  $("#xCoverFile").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; $("#xCoverName").textContent = f.name; onCoverFile(f); });
  $("#xPosReset").addEventListener("click", () => { V.titleXY = null; V.pointXY = null; vis(); look(); });
  // ---- labels
  let AUTO = [];
  $("#xDetect").addEventListener("click", () => onDetect());
  $("#xLabelFill").addEventListener("click", () => { V.labelText = {}; AUTO.forEach((t, i) => { V.labelText[String(i + 1)] = t; }); renderLabels(AUTO); look(); });
  $("#xLabelList").addEventListener("input", e => {
    const inp = e.target.closest("input[data-i]"); if (!inp) return;
    V.labelText = { ...(V.labelText || {}), [inp.dataset.i]: inp.value }; look();
  });
  function renderLabels(auto, detected = false) {
    AUTO = auto || [];
    const list = $("#xLabelList"), focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.i : null;
    list.innerHTML = AUTO.map((t, i) => `<li><span class="mono">${i + 1}</span><input type="text" class="text-input" data-i="${i + 1}" maxlength="40" placeholder="${esc(t)}" value="${esc((V.labelText || {})[String(i + 1)] || "")}" aria-label="Label of place ${i + 1}"></li>`).join("");
    if (focus) { const el = list.querySelector(`input[data-i="${focus}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
    $("#xDetect").textContent = detected ? "Detect again" : "Detect objects";
  }
  // ---- looks: built in and saved in this browser
  const lookSel = $("#xLook");
  const renderMyLooks = () => {
    const mine = readLooks();
    $("#xMyLooks").innerHTML = Object.keys(mine).sort().map(n => `<option value="m:${esc(n)}">${esc(n)}</option>`).join("") || '<option disabled value="">None saved yet</option>';
  };
  lookSel.addEventListener("change", () => {
    const v = lookSel.value; $("#xLookDel").hidden = !v.startsWith("m:");
    if (!v) return;
    const src = v.startsWith("b:") ? LOOKS[v.slice(2)] : readLooks()[v.slice(2)];
    if (!src) return;
    const l = structuredClone(src); delete l.name;
    if (l.fx) { V.fx = { ...V.fx, ...l.fx }; delete l.fx; }
    Object.assign(V, l);
    if (!("bottomColor" in l) && l.pointColor) V.bottomColor = l.pointColor;
    if (!("bottomColor2" in l) && l.pathColor) V.bottomColor2 = l.pathColor;
    if (v.startsWith("m:")) $("#xLookName").value = v.slice(2);
    onFont(V.font); sync(); look();
    $("#xLookNote").textContent = `Look “${v.startsWith("b:") ? LOOKS[v.slice(2)].name : v.slice(2)}” applied; change anything you like.`;
  });
  $("#xLookSave").addEventListener("click", () => {
    const name = $("#xLookName").value.trim(); if (!name) { $("#xLookName").focus(); return; }
    const mine = readLooks(); mine[name] = pickLook(V);
    $("#xLookNote").textContent = writeLooks(mine) ? `Saved “${name}” in this browser.` : "This browser doesn't allow saving here.";
    renderMyLooks(); lookSel.value = "m:" + name; $("#xLookDel").hidden = false;
  });
  $("#xLookDel").addEventListener("click", () => {
    const v = lookSel.value; if (!v.startsWith("m:")) return;
    const mine = readLooks(); delete mine[v.slice(2)]; writeLooks(mine); renderMyLooks();
    lookSel.value = ""; $("#xLookDel").hidden = true; $("#xLookNote").textContent = `Deleted “${v.slice(2)}”.`;
  });
  renderMyLooks();
  // ---- exports
  if (!videoSupported()) { $("#xVideo").disabled = true; $("#xWebm").disabled = true; $("#xStatus").textContent = "This browser can't encode video (the GIF and the poster still work). Chrome, Edge and Safari 17 or newer can."; }
  $("#xVideo").addEventListener("click", () => onVideo());
  $("#xWebm").addEventListener("click", () => onWebm());
  $("#xGif").addEventListener("click", () => onGif());
  $("#xPoster").addEventListener("click", () => onPoster());
  $("#xCancel").addEventListener("click", () => onCancel());

  // controls that only matter for some choices
  function vis() {
    $("#xCamBox").hidden = V.camera !== "follow";
    $("#xSafeBox").hidden = !(V.shape === "vertical" || V.shape === "portrait");
    sl.pathDone.el.hidden = V.path === "off"; sl.pathAhead.el.hidden = V.path !== "all";
    sl.placeDone.el.hidden = V.points === "off" || V.points === "current"; sl.placeAhead.el.hidden = V.points !== "all";
    sl.gradeAmt.el.hidden = V.grade === "none";
    $("#xLabelAuto").hidden = V.labels !== "auto"; $("#xLabelCustom").hidden = V.labels !== "custom";
    $("#xTextBox").hidden = V.caption === "none"; $("#xCreditBox").hidden = !V.endCard;
    $("#xSubTextBox").hidden = V.subtitle !== "custom"; sl.titleSecs.el.hidden = V.titleWhen !== "intro";
    $("#l_xSubCol").hidden = V.subtitle === "none" && V.caption !== "points";
    // the bottom's colours: one, or two named after what they do
    $("#xBottomCols").hidden = V.bottom === "none";
    const fill = V.bottomFill || "solid";
    $("#l_xBotB").hidden = fill === "solid";
    $("#l_xBotA span").textContent = fill === "gradient" ? "Left" : fill === "reactive" ? "Quiet" : "Colour";
    $("#l_xBotB span").textContent = fill === "gradient" ? "Right" : "Loud";
    const ln = V.line || "glow";
    sl.curve.el.hidden = V.lineShape !== "curved";
    $("#xDashBox").hidden = !["dashed", "dotted", "marching"].includes(ln); sl.dashLen.el.hidden = ln === "dotted";
    sl.glow.el.hidden = !["glow", "neon"].includes(ln);
    $("#l_xPathCol2").hidden = (V.pathFill || "solid") === "solid";
    $("#l_xPathColA span").textContent = V.pathFill === "gradient" ? "Start" : V.pathFill === "story" ? "Calm" : "Colour";
    $("#l_xPathCol2 span").textContent = V.pathFill === "gradient" ? "End" : "Tense";
    $("#xClimaxCols").hidden = !V.climaxOwn;
    $("#xBoxCols").hidden = !["box", "outline"].includes(V.textStyle || "shadow");
    $("#xPosReset").hidden = !(V.titleXY || V.pointXY);
    $("#xLogoBox").hidden = !V.logo; $("#xLogoReset").hidden = !V.logoXY;
    $("#xBarBox").hidden = V.bottom === "none"; $("#xBarReset").hidden = !V.barXY; $("#xCoverCleanBox").hidden = V.cover === "image";
    $("#xCoverBox").hidden = V.cover === "off"; sl.coverTime.el.hidden = V.cover !== "time"; $("#xCoverPickBox").hidden = V.cover !== "image";
  }
  // every control from P (after a recipe or a look)
  function sync() {
    if (V.numbers === false && V.numberStyle !== "none") V.numberStyle = "none";
    showFmt();
    for (const [id, key] of SEGS) segs[id].set(String(V[key]));
    for (const [id, key] of SELS) $("#" + id).value = V[key];
    for (const [, d] of SLD) sl[d.key].set(V[d.key] ?? d.def, false);
    for (const [id, obj, key] of checks) $(id).checked = !!obj()[key];
    syncColors(); showTheme();
    $("#xTitle").value = V.title || ""; $("#xCredit").value = V.credit || ""; $("#xSubText").value = V.subText || "";
    renderLabels(AUTO); syncEdit(); vis();
  }
  sync();
  // busy state: which job runs, a line of text and a progress fraction (null: no bar)
  function status(text, frac = null, busy = false, kind = "") {
    $("#xStatus").textContent = text || "";
    const bar = $("#xBar"); bar.hidden = frac === null; if (frac !== null) bar.firstElementChild.style.width = Math.round(frac * 100) + "%";
    for (const id of ["#xAudio", "#xMidi", "#xZip", "#xGif", "#xPoster"]) $(id).disabled = busy;
    for (const id of ["#xVideo", "#xWebm"]) $(id).disabled = busy || !videoSupported();
    $("#xCancel").hidden = !(busy && kind === "video");
  }
  return {
    sync, status, renderLabels,
    labelNote: t => { $("#xLabelNote").textContent = t; },
    previewNote: t => { $("#xPreviewNote").textContent = t; },
    sizeNote: t => { if ($("#xSizeNote").textContent !== t) $("#xSizeNote").textContent = t; }
  };
}
