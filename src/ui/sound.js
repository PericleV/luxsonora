// Sound tab: a channel strip for the master and each layer. A layer has an instrument
// (preset and editable parameters), a parametric EQ, drive and sends; the master has the
// EQ, reverb, delay, chorus, compressor, limiter, output and the export loudness.
import { LIBRARY, PARAMS, TYPE_NAME, resolveInstruments, styleDefault } from "../core/instruments.js";
import { STYLES, LAYER_NAME, PERC_NAME } from "../core/theory.js";
import { EQ_BANDS, DELAY_TIMES, defaultEq } from "../audio/fx.js";
import { KITS, STYLE_KIT, kitCatalog } from "../audio/samples.js";
import { openPicker } from "./picker.js";
import { makeSlider, makeSeg } from "./controls.js";

const $ = s => document.querySelector(s);
const CH_NAME = { master: "Master", ...LAYER_NAME };
const F_MIN = 20, F_MAX = 20000, G_MAX = 18;
const fmtHz = f => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + " kHz" : Math.round(f) + " Hz");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Frequency control on a logarithmic scale, with an editable value in Hz.
function makeFreqSlider(label, get, set) {
  const el = document.createElement("div"); el.className = "slider";
  const id = "f_" + Math.random().toString(36).slice(2, 8);
  el.innerHTML = `<div class="srow"><label for="${id}">${label}</label><span class="sval"><input class="num" type="number" min="${F_MIN}" max="${F_MAX}" aria-label="${label} in hertz"><span class="unit">Hz</span></span></div>
    <input type="range" id="${id}" min="${Math.log10(F_MIN)}" max="${Math.log10(F_MAX)}" step="0.001">`;
  const range = el.querySelector("input[type=range]"), num = el.querySelector(".num");
  const show = () => { const f = get(), lf = Math.log10(f); range.value = lf; range.style.setProperty("--p", (((lf - Math.log10(F_MIN)) / 3) * 100).toFixed(1) + "%"); num.value = Math.round(f); };
  range.addEventListener("input", () => { set(Math.pow(10, Number(range.value))); show(); });
  num.addEventListener("change", () => { const f = Number(num.value); if (isFinite(f)) set(Math.min(F_MAX, Math.max(F_MIN, f))); show(); });
  show();
  return { el, show };
}

// getExtra: the score's extra layers [{ id, name, inst }]; onPickExtra(id): change an extra layer's instrument.
export function initSound({ P, onMusic, onFx, onPreview = async () => {}, getExtra = () => [], onPickExtra = () => {} }) {
  let chan = "master", band = 2;
  const host = $("#pan-sound");
  host.insertAdjacentHTML("afterbegin", `
    <div class="field"><div class="flabel" id="lblChan">Channel</div><div class="seg seg-wrap" id="chanSeg" role="radiogroup" aria-labelledby="lblChan"></div></div>
    <section class="sbox" id="kitBox" hidden>
      <div class="flabel">Drum kit</div>
      <button type="button" class="choose" id="kitChoose" aria-haspopup="dialog"></button>
      <p class="snote">Sampled kits are downloaded when first used; the synthesized kit plays until they are ready.</p>
    </section>
    <section class="sbox" id="instBox">
      <div class="flabel">Instrument</div>
      <button type="button" class="choose" id="instChoose" aria-haspopup="dialog"></button>
      <p class="snote" id="instType"></p>
      <details class="adv" data-adv="instedit" id="instEdit"><summary>Edit instrument</summary>
        <div id="instParams" class="sliders sliders-2"></div>
        <button type="button" class="btn" id="instReset">Reset to preset</button>
      </details>
    </section>
    <section class="sbox adv-only">
      <div class="srow"><div class="flabel">Equalizer</div><button type="button" class="linkbtn" id="eqFlat">Flat</button></div>
      <svg id="eqSvg" class="eq" viewBox="0 0 320 140" role="img" aria-label="Equalizer response"></svg>
      <div class="seg seg-sm seg-wrap6" id="bandSeg" role="radiogroup" aria-label="EQ band"></div>
      <div id="bandCtl" class="sliders"></div>
    </section>
    <section class="sbox adv-only" id="layerFx"><div class="flabel">Channel effects</div><div id="layerFxCtl" class="sliders"></div></section>
    <section class="sbox" id="masterFx">
      <div class="flabel">Master</div>
      <div id="masterTop" class="sliders"></div>
      <details class="adv adv-only" data-adv="reverb"><summary>Reverb</summary><div id="revCtl" class="sliders"></div></details>
      <details class="adv adv-only" data-adv="delay"><summary>Delay</summary><div class="field"><div class="flabel" id="lblDt">Time</div><div class="seg seg-sm" id="dlyTime" role="radiogroup" aria-labelledby="lblDt"></div></div><div id="dlyCtl" class="sliders"></div></details>
      <details class="adv adv-only" data-adv="chorus"><summary>Chorus</summary><div id="chCtl" class="sliders"></div></details>
      <details class="adv adv-only" data-adv="dyn"><summary>Compressor and limiter</summary><div id="dynCtl" class="sliders"></div><label class="toggle"><input type="checkbox" id="limOn"><span>Limiter</span></label></details>
      <div class="field adv-only"><div class="flabel" id="lblLoud">Export loudness</div><div class="seg seg-sm" id="loudSeg" role="radiogroup" aria-labelledby="lblLoud"></div>
        <p class="snote">−14 LUFS is the level streaming and social platforms normalize to (ITU-R BS.1770-4, true peak kept under −1 dBTP).</p></div>
    </section>`);
  // the existing Image timbre and Space sliders move into the master section
  $("#masterTop").appendChild($("#sSound"));
  $("#masterTop").insertAdjacentHTML("afterbegin", `<label class="toggle"><input type="checkbox" id="samplesOn"><span>Sampled instruments</span></label>
    <p class="snote">Real instruments (piano, strings, brass, choir, drum machines), downloaded when first used. Off: the synthesizers only.</p>`);
  const samplesOn = $("#samplesOn"); samplesOn.checked = P.samples !== false;
  samplesOn.addEventListener("change", () => { P.samples = samplesOn.checked; onMusic(); });

  /* ---- channel selector ---- */
  // the channel list follows the score's layers (extra layers included)
  let chanSeg = null, chanSig = "";
  const chanItems = () => [...Object.entries(CH_NAME), ...getExtra().map(L => [L.id, L.name])];
  function buildChan() {
    const items = chanItems(), sig = items.map(i => i.join(":")).join("|");
    if (sig === chanSig) return;
    chanSig = sig;
    if (!items.some(([k]) => k === chan)) chan = "master";
    const old = $("#chanSeg"), fresh = old.cloneNode(false); old.replaceWith(fresh);
    chanSeg = makeSeg(fresh, items, chan, v => { chan = v; render(); });
  }
  const isExtra = c => getExtra().some(L => L.id === c);
  buildChan();

  /* ---- instrument ---- */
  // instrument and kit pickers: searchable dialogs with families and a Listen button
  const groupOf = (k, v) => v.family || (v.type === "sample" ? "Recommended (sampled)" : "Synthesizers");
  const kitGroupOf = v => v.group || "Built in";
  $("#instChoose").addEventListener("click", () => pickInstrument(chan));
  // also opened from the track list in Piece (Advanced)
  function pickInstrument(c) {
    if (isExtra(c)) { onPickExtra(c); return; }
    const def = styleDefault(P.style, c, P.melody, P.samples);
    const items = [{ key: "", name: "Style default: " + def.name, group: "Style default", sub: TYPE_NAME[def.type] }]
      .concat(Object.entries(LIBRARY).map(([k, v]) => ({ key: k, name: v.name, group: groupOf(k, v), sub: groupOf(k, v) + (v.type === "sample" ? "" : " · " + TYPE_NAME[v.type]) })));
    const order = ["Style default", "Recommended (sampled)", "Synthesizers"];
    items.sort((a, b) => ((order.indexOf(a.group) + 1 || 99) - (order.indexOf(b.group) + 1 || 99)) || a.group.localeCompare(b.group));
    openPicker({
      title: `${CH_NAME[c]} instrument`, items, current: (P.instruments[c] && P.instruments[c].preset) || "",
      searchLabel: "Search instruments", note: `${items.length - 1} instruments. Sampled ones download when first used; their synthesized version plays until then.`,
      onPick: key => { P.instruments[c] = { preset: key || null, edits: {} }; renderInstrument(); onMusic(); },
      onPreview: key => onPreview(c, key ? LIBRARY[key] : def)
    });
  }
  $("#kitChoose").addEventListener("click", () => pickKit());
  function pickKit() {
    const all = kitCatalog(), def = KITS[STYLE_KIT[P.style]] || KITS.synth;
    const items = [{ key: "style", name: "Style default: " + def.name, group: "Style default" }].concat(Object.entries(all).map(([k, v]) => ({ key: k, name: v.name, group: kitGroupOf(v) })));
    openPicker({
      title: "Drum kit", items, current: P.kit || "style", searchLabel: "Search drum kits",
      note: `${items.length - 1} kits, from the built-in ones to 220 vintage drum machines. Kits download when first used.`,
      onPick: key => { P.kit = key; renderKit(); onMusic(); },
      onPreview: key => onPreview("perc", null, key === "style" ? STYLE_KIT[P.style] : key)
    });
  }
  function renderKit() {
    $("#kitBox").hidden = chan !== "perc";
    if (chan !== "perc") return;
    const k = P.kit && P.kit !== "style" ? P.kit : null, all = kitCatalog(), v = k ? all[k] : KITS[STYLE_KIT[P.style]] || KITS.synth;
    $("#kitChoose").innerHTML = `<span>${esc(k ? v.name : "Style default: " + v.name)}</span><small>Change…</small>`;
  }
  $("#instReset").addEventListener("click", () => { if (P.instruments[chan]) P.instruments[chan].edits = {}; renderInstrument(); onMusic(); });
  function renderInstrument() {
    const box = $("#instBox"); box.hidden = chan === "master" || chan === "perc";
    renderKit();
    if (box.hidden) return;
    const X = getExtra().find(L => L.id === chan);
    $("#instEdit").hidden = !!X;
    if (X) {
      $("#instChoose").innerHTML = `<span>${esc(X.inst.name)}</span><small>Change…</small>`;
      $("#instType").textContent = `${X.inst.family || TYPE_NAME[X.inst.type]}. An extra layer (${X.name}); the image modulates it like the harmony.`;
      return;
    }
    const choice = P.instruments[chan] || { preset: null, edits: {} };
    const inst = resolveInstruments(P.style, P.instruments, P.melody, P.samples)[chan];
    $("#instChoose").innerHTML = `<span>${esc(choice.preset ? inst.name : "Style default: " + inst.name)}</span><small>Change…</small>`;
    const edited = Object.keys(choice.edits || {}).length;
    $("#instType").textContent = `${inst.family || TYPE_NAME[inst.type]}${edited ? `, ${edited} edited parameter${edited > 1 ? "s" : ""}` : ""}. The image modulates it around these values${inst.type === "sample" ? " (filter, release and loudness for samples)" : ""}.`;
    const wrap = $("#instParams"); wrap.innerHTML = "";
    const vals = { ...inst };
    for (const [key, label, min, max, step, scale, unit, dec] of [...PARAMS.common, ...(PARAMS[inst.type] || [])]) {
      const sl = makeSlider({ key, label, min, max, step, def: (choice.preset ? LIBRARY[choice.preset] : styleDefault(P.style, chan, P.melody, P.samples))[key] ?? min, scale, unit, dec }, vals, (d, v) => {
        const c = P.instruments[chan] = P.instruments[chan] || { preset: null, edits: {} };
        c.edits = { ...(c.edits || {}), [key]: v }; onMusic();
        const n = Object.keys(c.edits).length; $("#instType").textContent = `${TYPE_NAME[inst.type]}, ${n} edited parameter${n > 1 ? "s" : ""}. The image modulates it around these values.`;
      });
      wrap.appendChild(sl.el);
    }
  }

  /* ---- EQ ---- */
  const svg = $("#eqSvg"), H = 140, PADY = 10;
  let W = 320; // follows the rendered width so dots and text are never stretched
  const fx2x = f => (Math.log10(f / F_MIN) / 3) * W, x2f = x => F_MIN * Math.pow(10, (x / W) * 3);
  const g2y = g => H / 2 - (g / G_MAX) * (H / 2 - PADY), y2g = y => ((H / 2 - y) / (H / 2 - PADY)) * G_MAX;
  let probe = null;
  const freqs = Float32Array.from({ length: 160 }, (_, i) => F_MIN * Math.pow(10, (i / 159) * 3));
  function response(bands) {
    if (!probe) { const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext; const c = new OAC(1, 128, 44100); probe = EQ_BANDS.map(() => c.createBiquadFilter()); }
    const total = new Float32Array(freqs.length), mag = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
    bands.forEach((b, k) => {
      const n = probe[k]; n.type = b.type; n.frequency.value = b.f; n.Q.value = b.q || 0.707; n.gain.value = b.g || 0;
      n.getFrequencyResponse(freqs, mag, ph);
      for (let i = 0; i < freqs.length; i++) total[i] += 20 * Math.log10(Math.max(1e-6, mag[i]));
    });
    return total;
  }
  function drawEq() {
    W = Math.max(240, Math.round(svg.getBoundingClientRect().width || 320)); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const bands = P.fx.eq[chan], resp = response(bands);
    const grid = [100, 1000, 10000].map(f => `<line x1="${fx2x(f)}" x2="${fx2x(f)}" y1="0" y2="${H}" class="eqgrid"/><text x="${fx2x(f) + 3}" y="${H - 4}" class="eqlabel">${fmtHz(f)}</text>`).join("")
      + [-12, 0, 12].map(g => `<line x1="0" x2="${W}" y1="${g2y(g)}" y2="${g2y(g)}" class="${g ? "eqgrid" : "eqzero"}"/>`).join("");
    const d = Array.from(resp, (v, i) => `${i ? "L" : "M"}${fx2x(freqs[i]).toFixed(1)} ${Math.min(H, Math.max(0, g2y(Math.max(-G_MAX * 1.2, Math.min(G_MAX * 1.2, v))))).toFixed(1)}`).join(" ");
    const dots = bands.map((b, k) => { const cx = fx2x(b.f), cy = "gain" in EQ_BANDS[k] || EQ_BANDS[k].g !== undefined ? g2y(b.g) : g2y(0); return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${k === band ? 6.5 : 5}" class="eqdot${k === band ? " on" : ""}" data-band="${k}"><title>${EQ_BANDS[k].label}</title></circle>`; }).join("");
    svg.innerHTML = grid + `<path d="${d} L${W} ${H / 2} L0 ${H / 2} Z" class="eqfill"/><path d="${d}" class="eqline"/>` + dots;
  }
  const hasGain = k => EQ_BANDS[k].g !== undefined, hasQ = k => EQ_BANDS[k].q !== undefined && EQ_BANDS[k].type === "peaking" || EQ_BANDS[k].type === "highpass" || EQ_BANDS[k].type === "lowpass";
  const bandSeg = makeSeg($("#bandSeg"), EQ_BANDS.map((b, k) => [String(k), b.label]), String(band), v => { band = Number(v); renderBand(); drawEq(); });
  function eqChanged() { drawEq(); onFx(); }
  function renderBand() {
    const wrap = $("#bandCtl"), b = P.fx.eq[chan][band]; wrap.innerHTML = "";
    const fs = makeFreqSlider("Frequency", () => b.f, f => { b.f = f; eqChanged(); }); wrap.appendChild(fs.el);
    if (hasGain(band)) wrap.appendChild(makeSlider({ key: "g", label: "Gain", min: -G_MAX, max: G_MAX, step: 0.5, def: 0, unit: "dB", dec: 1, signed: true }, b, () => eqChanged()).el);
    if (hasQ(band)) wrap.appendChild(makeSlider({ key: "q", label: band === 0 || band === 5 ? "Resonance (Q)" : "Width (Q)", min: 0.3, max: 10, step: 0.05, def: band === 0 || band === 5 ? 0.707 : 1, dec: 2 }, b, () => eqChanged()).el);
    BAND_UI.freq = fs;
  }
  const BAND_UI = {};
  let dragBand = -1;
  svg.addEventListener("pointerdown", e => {
    const k = e.target.dataset && e.target.dataset.band; if (k === undefined) return;
    dragBand = Number(k); band = dragBand; bandSeg.set(String(band)); renderBand(); drawEq();
    svg.setPointerCapture(e.pointerId); e.preventDefault();
  });
  svg.addEventListener("pointermove", e => {
    if (dragBand < 0) return;
    const rc = svg.getBoundingClientRect(), x = ((e.clientX - rc.left) / rc.width) * W, y = ((e.clientY - rc.top) / rc.height) * H;
    const b = P.fx.eq[chan][dragBand];
    b.f = Math.min(F_MAX, Math.max(F_MIN, x2f(x)));
    if (hasGain(dragBand)) b.g = Math.round(Math.max(-G_MAX, Math.min(G_MAX, y2g(y))) * 2) / 2;
    renderBand(); eqChanged();
  });
  const endDrag = () => { dragBand = -1; };
  svg.addEventListener("pointerup", endDrag); svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("wheel", e => {
    const k = e.target.dataset && e.target.dataset.band; if (k === undefined || !hasQ(Number(k))) return;
    e.preventDefault(); const b = P.fx.eq[chan][Number(k)]; b.q = Math.min(10, Math.max(0.3, b.q * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); renderBand(); eqChanged();
  }, { passive: false });
  $("#eqFlat").addEventListener("click", () => { P.fx.eq[chan] = defaultEq(); renderBand(); eqChanged(); });

  /* ---- channel and master effects ---- */
  const fxSlider = (host, obj, def) => { const sl = makeSlider(def, obj, () => onFx()); $(host).appendChild(sl.el); return sl; };
  function renderLayerFx() {
    const box = $("#layerFx"); box.hidden = chan === "master"; if (box.hidden) return;
    const L = P.fx.layer[chan] || (P.fx.layer[chan] = { drive: 0, rev: 0.45, dly: 0.1 }), w = $("#layerFxCtl"); w.innerHTML = "";
    fxSlider("#layerFxCtl", L, { key: "drive", label: "Drive", min: 0, max: 1, step: 0.01, def: 0, scale: 100, unit: "%", help: "Adds warmth and a bit of grit." });
    fxSlider("#layerFxCtl", L, { key: "rev", label: "Reverb send", min: 0, max: 1.5, step: 0.01, def: 0.5, scale: 100, unit: "%" });
    fxSlider("#layerFxCtl", L, { key: "dly", label: "Delay send", min: 0, max: 1, step: 0.01, def: 0, scale: 100, unit: "%" });
  }
  const R = P.fx.reverb, D = P.fx.delay, C = P.fx.chorus, K = P.fx.comp, LM = P.fx.limiter;
  const masterSliders = [
    fxSlider("#revCtl", R, { key: "size", label: "Size", min: 0.5, max: 8, step: 0.1, def: 3.4, unit: "s", dec: 1, help: "How big the room sounds." }),
    fxSlider("#revCtl", R, { key: "predelay", label: "Pre-delay", min: 0, max: 0.15, step: 0.001, def: 0, scale: 1000, unit: "ms" }),
    makeFreqSlider("Damping", () => R.damping, f => { R.damping = f; onFx(); }),
    fxSlider("#dlyCtl", D, { key: "mix", label: "Return level", min: 0, max: 1, step: 0.01, def: 0, scale: 100, unit: "%", help: "Each layer sends to the delay with its own Delay send." }),
    fxSlider("#dlyCtl", D, { key: "feedback", label: "Feedback", min: 0, max: 0.9, step: 0.01, def: 0.35, scale: 100, unit: "%" }),
    makeFreqSlider("Tone", () => D.tone, f => { D.tone = f; onFx(); }),
    fxSlider("#chCtl", C, { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, def: 0, scale: 100, unit: "%" }),
    fxSlider("#chCtl", C, { key: "rate", label: "Rate", min: 0.05, max: 3, step: 0.01, def: 0.6, unit: "Hz", dec: 2 }),
    fxSlider("#chCtl", C, { key: "depth", label: "Depth", min: 0, max: 0.008, step: 0.0001, def: 0.004, scale: 1000, unit: "ms", dec: 1 }),
    fxSlider("#dynCtl", K, { key: "threshold", label: "Threshold", min: -40, max: 0, step: 0.5, def: -16, unit: "dB", dec: 1 }),
    fxSlider("#dynCtl", K, { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.1, def: 3.5, unit: ": 1", dec: 1 }),
    fxSlider("#dynCtl", LM, { key: "ceiling", label: "Limiter ceiling", min: -12, max: 0, step: 0.1, def: -1, unit: "dB", dec: 1 }),
    fxSlider("#dynCtl", P.fx, { key: "output", label: "Output gain", min: -12, max: 6, step: 0.5, def: 0, unit: "dB", dec: 1, signed: true })
  ];
  $("#revCtl").appendChild(masterSliders[2].el); $("#dlyCtl").appendChild(masterSliders[5].el);
  const dlySeg = makeSeg($("#dlyTime"), Object.keys(DELAY_TIMES).map(k => [k, k]), D.time, v => { D.time = v; onFx(); });
  $("#limOn").checked = LM.on; $("#limOn").addEventListener("change", e => { LM.on = e.target.checked; onFx(); });
  const loudSeg = makeSeg($("#loudSeg"), [["lufs", "−14 LUFS"], ["peak", "Peak 0.9"]], P.fx.loudness, v => { P.fx.loudness = v; });

  function render() {
    buildChan();
    samplesOn.checked = P.samples !== false;
    renderInstrument(); renderLayerFx(); renderBand(); drawEq();
    $("#masterFx").hidden = chan !== "master";
  }
  // after a project is opened: every bound object may have been replaced
  function sync() {
    chanSeg.set(chan); dlySeg.set(P.fx.delay.time); loudSeg.set(P.fx.loudness); $("#limOn").checked = P.fx.limiter.on;
    render();
  }
  render();
  new ResizeObserver(() => drawEq()).observe(svg);
  return { render, sync, pickInstrument, pickKit, get channel() { return chan; } };
}
