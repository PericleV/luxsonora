// Style suggestion: the three styles that suit a picture best, from the analysis the app already
// does (no model, nothing downloaded). Each style has a profile on five measures of the image,
// each 0-1: lightness, warmth of the colours, saturation, detail (entropy and edges together) and
// contrast (the spread of lightness), plus the colour families it likes. A picture scores each
// style by how close it is to the profile, and gets a short reason in words.
import { clamp } from "./util.js";
import { colourOf } from "./expert.js";
import { HIDDEN_STYLES } from "./theory.js";

// [lightness, warmth, saturation, detail, contrast, colour families]
const PROFILE = {
  ambient: [0.55, 0.5, 0.3, 0.3, 0.35, ["blue", "cyan", "purple"]],
  lofinature: [0.55, 0.55, 0.35, 0.4, 0.35, ["green", "yellow", "orange"]],
  meditation: [0.65, 0.5, 0.2, 0.15, 0.25, ["blue", "cyan", "grey"]],
  neoclassical: [0.4, 0.5, 0.2, 0.3, 0.45, ["grey", "blue"]],
  minimal: [0.6, 0.45, 0.3, 0.55, 0.5, ["grey"]],
  eastasian: [0.55, 0.55, 0.45, 0.35, 0.4, ["red", "magenta", "green"]],
  classical: [0.5, 0.6, 0.35, 0.5, 0.5, ["yellow", "orange"]],
  baroque: [0.45, 0.7, 0.45, 0.7, 0.55, ["orange", "yellow", "red"]],
  movie: [0.45, 0.5, 0.4, 0.45, 0.55, ["orange", "blue"]],
  cinematic: [0.3, 0.4, 0.4, 0.5, 0.7, ["blue", "cyan"]],
  epic: [0.3, 0.45, 0.45, 0.7, 0.75, ["red", "orange", "grey"]],
  jazz: [0.35, 0.65, 0.45, 0.5, 0.5, ["orange", "red", "yellow"]],
  bossa: [0.65, 0.7, 0.5, 0.4, 0.45, ["yellow", "orange", "cyan"]],
  blues: [0.35, 0.55, 0.4, 0.45, 0.55, ["blue", "purple"]],
  funk: [0.55, 0.65, 0.75, 0.7, 0.6, ["orange", "magenta", "yellow"]],
  reggae: [0.65, 0.65, 0.7, 0.5, 0.5, ["green", "yellow", "red"]],
  lofi: [0.4, 0.6, 0.35, 0.45, 0.4, ["orange", "purple", "magenta"]],
  triphop: [0.25, 0.45, 0.3, 0.45, 0.55, ["blue", "purple", "grey"]],
  pop: [0.7, 0.55, 0.75, 0.5, 0.5, ["magenta", "cyan", "yellow", "red"]],
  rock: [0.4, 0.5, 0.5, 0.7, 0.7, ["red", "grey"]],
  postrock: [0.5, 0.4, 0.4, 0.35, 0.55, ["blue", "cyan", "grey"]],
  folk: [0.6, 0.6, 0.45, 0.55, 0.45, ["green", "yellow", "orange"]],
  metal: [0.2, 0.4, 0.3, 0.8, 0.8, ["grey", "red"]],
  electronic: [0.4, 0.4, 0.7, 0.6, 0.6, ["cyan", "magenta", "blue"]],
  techno: [0.25, 0.35, 0.4, 0.65, 0.7, ["grey", "blue"]],
  dnb: [0.3, 0.4, 0.55, 0.8, 0.7, ["cyan", "green", "blue"]],
  synthwave: [0.3, 0.5, 0.75, 0.5, 0.65, ["magenta", "purple", "cyan"]],
  acappella: [0.55, 0.5, 0.2, 0.25, 0.4, ["blue", "grey", "purple"]],
  chiptune: [0.6, 0.5, 0.8, 0.65, 0.7, ["red", "green", "blue", "yellow", "magenta", "cyan"]]
};
const WEIGHT = [1.2, 0.8, 1, 1, 0.8], HUE_BONUS = 0.8, MAX = WEIGHT.reduce((a, b) => a + b, 0) + HUE_BONUS;
// the words for each measure, low and high
const WORDS = [["dark", "bright"], ["cool colours", "warm colours"], ["muted colours", "vivid colours"], ["calm, smooth areas", "lots of detail"], ["soft light", "strong contrast"]];

// The five measures of a picture (A: the analysis), and its main colour family.
export function pictureMeasures(A) {
  const g = A.global;
  let contrast = 0.5;
  if (A.L && A.L.length) {
    const L = A.L, step = Math.max(1, Math.floor(L.length / 20000));
    let s = 0, s2 = 0, n = 0;
    for (let i = 0; i < L.length; i += step) { s += L[i]; s2 += L[i] * L[i]; n++; }
    const mean = s / n; contrast = clamp(Math.sqrt(Math.max(0, s2 / n - mean * mean)) / 0.3);
  }
  const detail = clamp(0.5 * (g.entropy ?? 0.5) + 0.5 * (g.edgeN ?? 0.5));
  return { values: [clamp(g.brightness ?? 0.5), clamp(g.warmth01 ?? 0.5), clamp((g.sat ?? 0.3) / 0.6), detail, contrast], family: colourOf({ hue: g.hue, hueStr: g.hueStr }) };
}

// The best `count` styles for a picture: [{ style, score (0-1), reason }], best first.
export function suggestStyles(A, count = 3, styles = Object.keys(PROFILE).filter(s => !HIDDEN_STYLES.has(s))) {
  const M = pictureMeasures(A), out = [];
  for (const st of styles) {
    const p = PROFILE[st]; if (!p) continue;
    let sc = 0;
    const fits = [];
    for (let k = 0; k < 5; k++) {
      const d = Math.abs(M.values[k] - p[k]), f = 1 - Math.min(1, d * 2);
      sc += WEIGHT[k] * f;
      // a reason: a measure the picture shows clearly (far from the middle) that the style likes
      if (f > 0.7 && Math.abs(M.values[k] - 0.5) > 0.12) fits.push([Math.abs(M.values[k] - 0.5) * f, WORDS[k][M.values[k] > 0.5 ? 1 : 0]]);
    }
    const hueHit = p[5].includes(M.family);
    if (hueHit) sc += HUE_BONUS;
    fits.sort((a, b) => b[0] - a[0]);
    const words = fits.slice(0, 2).map(x => x[1]);
    if (hueHit && M.family !== "grey" && words.length < 2) words.push(`${M.family} tones`);
    out.push({ style: st, score: clamp(sc / MAX), reason: words.length ? words.join(", ") : "a balanced picture" });
  }
  out.sort((a, b) => b.score - a.score || a.style.localeCompare(b.style));
  return out.slice(0, count);
}
export const SUGGEST_PROFILES = PROFILE;

// A fuller explanation, in sentences: the picture's measures in words, then for each suggested style
// where it fits the picture and where it does not.
const NAMES = ["Lightness", "Warmth", "Saturation", "Detail", "Contrast"];
const LEVEL = v => (v < 0.2 ? "very low" : v < 0.4 ? "low" : v < 0.6 ? "medium" : v < 0.8 ? "high" : "very high");
// what a style likes on each measure: low, middle or high
const LIKES = [["darker pictures", "a middle lightness", "brighter pictures"], ["cooler colours", "colours neither warm nor cool", "warmer colours"], ["muted colours", "moderate colour", "vivid colours"], ["calm, smooth pictures", "a moderate amount of detail", "pictures full of detail"], ["soft light", "moderate contrast", "strong contrast"]];
const likeOf = (k, v) => LIKES[k][v < 0.4 ? 0 : v <= 0.6 ? 1 : 2];
export function explainStyles(A, list) {
  const M = pictureMeasures(A);
  const measures = NAMES.map((name, k) => ({ name, value: M.values[k], level: LEVEL(M.values[k]) }));
  const styles = list.map(({ style, score }) => {
    const p = PROFILE[style], fits = [], differs = [];
    for (let k = 0; k < 5; k++) {
      const d = M.values[k] - p[k], like = likeOf(k, p[k]);
      if (Math.abs(d) <= 0.12) fits.push(`${NAMES[k].toLowerCase()} (${LEVEL(M.values[k])}), as it suits ${like}`);
      else if (Math.abs(d) >= 0.25) differs.push(`${NAMES[k].toLowerCase()} is ${d > 0 ? "higher" : "lower"} than it usually has`);
    }
    const colour = p[5].includes(M.family) ? (M.family === "grey" ? "The picture has little colour, which this style likes." : `The main colour, ${M.family}, is one this style likes.`) : `The main colour, ${M.family}, is not one it usually goes with.`;
    const lines = [];
    if (fits.length) lines.push(`It matches the picture's ${fits.join(", ")}.`);
    lines.push(colour);
    if (differs.length) lines.push(`Less close: ${differs.join(", ")}.`);
    return { style, score, lines };
  });
  return { measures, family: M.family, styles };
}
