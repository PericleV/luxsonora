// Reusable controls: slider with an editable numeric value, segmented group.
import { clamp } from "../core/util.js";

const fmtNum = (v, dec) => (dec ? v.toFixed(dec) : String(Math.round(v)));

/*
 * def: { key, label, min, max, step, def, scale = 1, unit = "", dec = 0, help, signed }
 * The internal value lives in P[def.key]; the numeric field shows value × scale.
 * Double-clicking the label restores the default.
 */
export function makeSlider(def, P, onChange) {
  const id = "s_" + def.key, scale = def.scale || 1, dec = def.dec || 0;
  const wrap = document.createElement("div");
  wrap.className = "slider";
  wrap.innerHTML = `<div class="srow"><label for="${id}" title="Double-click to reset">${def.label}</label>
    <span class="sval"><input class="num" type="number" inputmode="decimal" aria-label="${def.label} value" step="${def.step * scale}" min="${def.min * scale}" max="${def.max * scale}">${def.unit ? `<span class="unit">${def.unit}</span>` : ""}</span></div>
    <input type="range" id="${id}" min="${def.min}" max="${def.max}" step="${def.step}">
    ${def.help ? `<p class="snote">${def.help}</p>` : ""}<p class="snote" data-note hidden></p>`;
  const range = wrap.querySelector("input[type=range]"), num = wrap.querySelector(".num"), note = wrap.querySelector("[data-note]");
  const show = v => {
    range.value = v;
    range.style.setProperty("--p", (((v - def.min) / (def.max - def.min)) * 100).toFixed(2) + "%");
    const d = v * scale;
    num.value = fmtNum(d, dec);
    range.setAttribute("aria-valuetext", (def.signed && d > 0 ? "+" : "") + fmtNum(d, dec) + (def.unit ? " " + def.unit : ""));
  };
  const set = (v, emit = true) => {
    v = clamp(Number(v), def.min, def.max);
    v = +(Math.round(v / def.step) * def.step).toFixed(6);
    const changed = v !== P[def.key];
    P[def.key] = v; show(v);
    if (emit && changed) onChange(def, v);
  };
  range.addEventListener("input", () => set(range.value));
  num.addEventListener("change", () => { const x = parseFloat(String(num.value).replace(",", ".")); if (isFinite(x)) set(x / scale); else show(P[def.key]); });
  num.addEventListener("keydown", e => { if (e.key === "Enter") num.blur(); });
  wrap.querySelector("label").addEventListener("dblclick", () => set(def.def));
  show(P[def.key]);
  return {
    el: wrap, set,
    setNote(text) { note.hidden = !text; note.textContent = text || ""; },
    setMax(max) { def.max = max; range.max = max; num.max = max * scale; if (P[def.key] > max) set(max, false); else show(P[def.key]); }
  };
}

// Single-choice button group (role=radiogroup), navigable with the arrow keys.
export function makeSeg(host, items, current, onPick) {
  host.innerHTML = items.map(([v, label]) => `<button type="button" role="radio" aria-checked="${v === current}" tabindex="${v === current ? 0 : -1}" data-v="${v}">${label}</button>`).join("");
  const btns = [...host.querySelectorAll("button")];
  const pick = (b, emit = true) => {
    btns.forEach(x => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; });
    if (emit) onPick(b.dataset.v);
  };
  host.addEventListener("click", e => { const b = e.target.closest("button"); if (b) pick(b); });
  host.addEventListener("keydown", e => {
    const i = btns.indexOf(document.activeElement); if (i < 0) return;
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return; e.preventDefault();
    const b = btns[(i + d + btns.length) % btns.length]; b.focus(); pick(b);
  });
  return { set(v) { const b = btns.find(x => x.dataset.v === String(v)); if (b) pick(b, false); } };
}
