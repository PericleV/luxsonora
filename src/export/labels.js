// Labels on the places in the video: what the eye is looking at.
//
// Detected: the name of the object under the point (COCO-SSD or Claude's objects, the smallest
// box that contains it, else the nearest box centre within 12% of the image); without one, a
// short description of the region's colour and light ("warm highlight", "deep blue shadow").
// Custom: the user's own text for each point (an empty text shows no label).
export const LABEL_MODES = { off: "Off", auto: "Detected", custom: "My own" };

const HUES = [[15, "red"], [40, "orange"], [65, "golden"], [160, "green"], [195, "teal"], [255, "blue"], [290, "violet"], [335, "pink"], [360, "red"]];
export function hueName(h) { for (const [lim, name] of HUES) if (h < lim) return name; return "red"; }

// reg: the region's features ({ L, sat, hue, edge }) in [0, 1] (hue in degrees)
export function colourLabel(reg) {
  if (!reg) return "";
  const L = reg.L ?? 0.5, sat = reg.sat ?? 0, light = L > 0.72 ? "bright" : L < 0.22 ? "deep" : L < 0.4 ? "dark" : "";
  const what = L > 0.7 ? "highlight" : L < 0.3 ? "shadow" : (reg.edge ?? 0) > 0.5 ? "detail" : "tone";
  if (sat < 0.12) return [L > 0.6 ? "pale" : L < 0.3 ? "dark" : "grey", what === "tone" ? "area" : what].join(" ");
  const h = hueName(reg.hue ?? 0), warm = ["red", "orange", "golden", "pink"].includes(h);
  return [light, light === "bright" && warm ? "warm" : h, what].filter(Boolean).join(" ").replace("warm highlight", "warm light");
}

// the object at point (x, y) among [{ name, x, y, w, h }]
export function objectAt(objects, x, y) {
  if (!objects || !objects.length) return null;
  let best = null, area = Infinity;
  for (const o of objects) if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h && o.w * o.h < area) { best = o; area = o.w * o.h; }
  if (best) return best;
  let near = null, d = 0.12;
  for (const o of objects) { const e = Math.hypot(o.x + o.w / 2 - x, o.y + o.h / 2 - y); if (e < d) { near = o; d = e; } }
  return near;
}

// The automatic label of each point of a score (array, by point index).
export function autoLabels(sc, objects) {
  return sc.points.map(F => {
    const o = objectAt(objects, F.x, F.y);
    if (o) return o.name.charAt(0).toUpperCase() + o.name.slice(1);
    const c = colourLabel(F.reg);
    return c ? c.charAt(0).toUpperCase() + c.slice(1) : `Point ${F.idx + 1}`;
  });
}
// The label shown for point i (0-based): custom text by point number, or the automatic one.
export function labelFor(mode, i, auto, custom) {
  if (mode === "custom") return ((custom && custom[String(i + 1)]) || "").trim();
  if (mode === "auto") return (auto && auto[i]) || "";
  return "";
}
