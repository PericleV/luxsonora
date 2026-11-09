// Validation of a semantic answer (atmosphere, valence, energy, objects with a category). The app no
// longer asks for one; the composer and the saliency map still accept objects, and the equivalence
// test checks the saliency with them against the prototype.
import { clamp } from "./util.js";
import { CAT } from "./theory.js";

export function validateSem(o) {
  if (!o || typeof o !== "object") return null;
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? clamp(v) : d);
  const atm = Array.isArray(o.atmosphere) ? o.atmosphere.filter(a => a && typeof a.label === "string").slice(0, 4).map(a => ({ label: a.label.slice(0, 30), score: num(a.score, 0.5) })) : [];
  const obj = Array.isArray(o.objects) ? o.objects.filter(b => b && typeof b.name === "string" && [b.x, b.y, b.w, b.h].every(v => typeof v === "number" && isFinite(v))).slice(0, 8)
    .map(b => ({ name: b.name.slice(0, 30), category: CAT[b.category] ? b.category : "natural", x: clamp(b.x), y: clamp(b.y), w: clamp(b.w, 0.01, 1), h: clamp(b.h, 0.01, 1), importance: num(b.importance, 0.5) })) : [];
  return { atmosphere: atm, valence: num(o.valence, 0.5), energy: num(o.energy, 0.5), objects: obj };
}
