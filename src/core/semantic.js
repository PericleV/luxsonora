// Prompt and validation for the semantic analysis (only available inside a claude.ai artifact).
import { clamp } from "./util.js";
import { CAT } from "./theory.js";

export const SEM_PROMPT = `You are analysing a photograph for an application that turns it into music.
Reply ONLY with a JSON object, no other text, exactly in this shape:
{"atmosphere":[{"label":"calm","score":0.8}],"valence":0.6,"energy":0.3,"objects":[{"name":"boat","category":"artificial","x":0.4,"y":0.6,"w":0.1,"h":0.08,"importance":0.7}]}
Rules:
- "atmosphere": 2-4 short English labels (one or two words), "score" between 0 and 1.
- "valence": 0 = gloomy or sad, 1 = bright or happy. "energy": 0 = calm and still, 1 = agitated and dynamic.
- "objects": at most 8 visible objects with short English names. "category" is "living", "natural" or "artificial".
- x, y = top-left corner; w, h = width and height; all as fractions between 0 and 1 of the image size.
- "importance": between 0 and 1, how strongly the object draws the eye.`;

export function validateSem(o) {
  if (!o || typeof o !== "object") return null;
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? clamp(v) : d);
  const atm = Array.isArray(o.atmosphere) ? o.atmosphere.filter(a => a && typeof a.label === "string").slice(0, 4).map(a => ({ label: a.label.slice(0, 30), score: num(a.score, 0.5) })) : [];
  const obj = Array.isArray(o.objects) ? o.objects.filter(b => b && typeof b.name === "string" && [b.x, b.y, b.w, b.h].every(v => typeof v === "number" && isFinite(v))).slice(0, 8)
    .map(b => ({ name: b.name.slice(0, 30), category: CAT[b.category] ? b.category : "natural", x: clamp(b.x), y: clamp(b.y), w: clamp(b.w, 0.01, 1), h: clamp(b.h, 0.01, 1), importance: num(b.importance, 0.5) })) : [];
  return { atmosphere: atm, valence: num(o.valence, 0.5), energy: num(o.energy, 0.5), objects: obj };
}
