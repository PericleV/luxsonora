// The gaze path in the video: its shape (straight or curved) and how its line is drawn.
//
// Positions along the path are j + t: segment j (from point j to point j + 1) at fraction t.
// Curved paths are cardinal splines through the points (tension 0.3: they pass through every
// point without loops); the eye, the connection notes and the line all use the same geometry.
import { clamp } from "../core/util.js";

export const LINE_SHAPES = { straight: "Straight", curved: "Curved" };
export const LINE_STYLES = {
  solid: "Solid", glow: "Glow", neon: "Neon", dashed: "Dashed", dotted: "Dotted", marching: "Marching",
  tapered: "Tapered", comet: "Comet", brush: "Brush", arrows: "Arrows", double: "Double"
};

const lerp = (a, b, t) => a + (b - a) * t;

// Geometry of the path through tl's points ({ x, y } in image fractions).
// tension: 0 nearly straight between points, 1 wide curves
export function pathGeometry(tl, curved = false, steps = 18, tension = 0.5) {
  const n = tl.length, P = tl.map(p => [p.x, p.y]);
  const tan = j => {
    const a = P[Math.max(0, j - 1)], b = P[Math.min(n - 1, j + 1)], k = 0.1 + 0.5 * Math.max(0, Math.min(1, tension));
    return [(b[0] - a[0]) * k, (b[1] - a[1]) * k];
  };
  const T = curved && n > 2 ? P.map((_, j) => tan(j)) : null;
  const at = f => {
    if (n === 1) return { x: P[0][0], y: P[0][1] };
    f = clamp(f, 0, n - 1);
    const j = Math.min(n - 2, Math.floor(f)), t = f - j, a = P[j], b = P[j + 1];
    if (!T) return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t) };
    const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    return { x: h00 * a[0] + h10 * T[j][0] + h01 * b[0] + h11 * T[j + 1][0], y: h00 * a[1] + h10 * T[j][1] + h01 * b[1] + h11 * T[j + 1][1] };
  };
  const per = T ? steps : 1;
  // the points of the path from f0 to f1, with the samples of a curve in between
  const range = (f0, f1) => {
    const out = [{ ...at(f0), f: f0 }];
    for (let k = Math.floor(f0 * per) + 1; k / per < f1 - 1e-9; k++) out.push({ ...at(k / per), f: k / per });
    out.push({ ...at(f1), f: f1 });
    return out;
  };
  return { n, curved: !!T, at, range };
}

// deterministic noise in [−1, 1] for the brush strokes
const noise = (k, s) => { const v = Math.sin(k * 12.9898 + s * 78.233) * 43758.5453; return 2 * (v - Math.floor(v)) - 1; };

function stroke(g, pts) { if (pts.length < 2) return; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]); g.stroke(); }

/*
 * Draws the path parts: [{ f0, f1, a, done }] (done: the travelled part, whose end is the eye).
 * X, Y map image fractions to the frame; u is the scale (1 at 1080p); sec the time (for marching).
 */
export function drawPath(g, geo, X, Y, o, u, sec, parts, hexA, colorAt = null) {
  const w = o.lineWidth * u, glow = o.glow ?? 0.6, dl = o.dashLen ?? 3.2, dg = o.dashGap ?? 2.6;
  // a colour along the path: each segment (point to point) in its own colour
  if (colorAt) {
    const split = [];
    for (const p of parts) for (let j = Math.floor(p.f0); j < p.f1 - 1e-9; j++) { const a = Math.max(p.f0, j), b = Math.min(p.f1, j + 1); if (b - a > 1e-6) split.push({ ...p, f0: a, f1: b, col: colorAt(j + 0.5) }); }
    parts = split;
  }
  g.save(); g.lineCap = "round"; g.lineJoin = "round";
  for (const part of parts) {
    if (part.f1 - part.f0 < 1e-6 || part.a <= 0) continue;
    const pts = geo.range(part.f0, part.f1).map(p => [X(p.x), Y(p.y), p.f]);
    const col = part.col || o.pathColor, a = part.a, style = !part.done && (o.line === "comet" || o.line === "tapered") ? "solid" : o.line;
    g.globalAlpha = 1; g.setLineDash([]); g.shadowBlur = 0; g.lineDashOffset = 0;
    g.strokeStyle = hexA(col, 0.92 * a); g.lineWidth = w;
    switch (style) {
      case "glow":
        g.shadowColor = hexA(col, 0.9 * a); g.shadowBlur = 24 * u * glow; stroke(g, pts); break;
      case "neon":
        g.shadowColor = hexA(col, a); g.shadowBlur = 30 * u * glow; g.lineWidth = w * 2.6; g.strokeStyle = hexA(col, 0.38 * a); stroke(g, pts);
        g.shadowBlur = 6 * u; g.lineWidth = Math.max(1, w * 0.7); g.strokeStyle = `rgba(255,255,255,${0.95 * a})`; stroke(g, pts); break;
      case "dashed":
        g.setLineDash([w * dl, w * dg]); stroke(g, pts); break;
      case "dotted":
        g.lineWidth = w * 1.3; g.setLineDash([0.01, w * dg]); stroke(g, pts); break;
      case "marching":
        // dashes that move forward along the path
        g.setLineDash([w * dl, w * dg]); g.lineDashOffset = -sec * 36 * u; stroke(g, pts); break;
      case "double": {
        // two thin parallel lines
        for (const side of [-1, 1]) {
          const off = pts.map((p, k) => {
            const q = pts[Math.min(pts.length - 1, k + 1)], r = pts[Math.max(0, k - 1)], dx = q[0] - r[0], dy = q[1] - r[1], L = Math.hypot(dx, dy) || 1;
            return [p[0] - (dy / L) * w * 0.9 * side, p[1] + (dx / L) * w * 0.9 * side];
          });
          g.lineWidth = Math.max(1, w * 0.45); stroke(g, off);
        }
        break;
      }
      case "tapered": {
        // thin where it started, full width at the eye
        const span = Math.max(1e-6, part.f1 - part.f0);
        for (let k = 1; k < pts.length; k++) { g.lineWidth = w * (0.2 + 1.0 * ((pts[k][2] - part.f0) / span)); stroke(g, [pts[k - 1], pts[k]]); }
        break;
      }
      case "comet": {
        // a tail behind the eye that fades with the distance travelled since
        for (let k = 1; k < pts.length; k++) {
          const e = Math.exp(-(part.f1 - pts[k][2]) / 0.9);
          if (e < 0.02) continue;
          g.lineWidth = w * (0.3 + 1.1 * e); g.strokeStyle = hexA(col, 0.95 * a * e); stroke(g, [pts[k - 1], pts[k]]);
        }
        break;
      }
      case "brush": {
        // three thin strokes with a fixed wobble, like a hand-drawn line
        for (let s = 0; s < 3; s++) {
          const off = pts.map((p, k) => {
            const q = pts[Math.min(pts.length - 1, k + 1)], r = pts[Math.max(0, k - 1)], dx = q[0] - r[0], dy = q[1] - r[1], L = Math.hypot(dx, dy) || 1;
            const j = noise(Math.round(p[2] * 40), s) * w * 0.9;
            return [p[0] - (dy / L) * j, p[1] + (dx / L) * j];
          });
          g.lineWidth = Math.max(1, w * (0.45 + 0.15 * s)); g.strokeStyle = hexA(col, (0.45 + 0.1 * s) * a); stroke(g, off);
        }
        break;
      }
      case "arrows": {
        g.lineWidth = Math.max(1, w * 0.7); stroke(g, pts);
        // a chevron in the middle of every segment, pointing the way the eye went
        g.lineWidth = Math.max(1, w * 0.8);
        for (let j = Math.ceil(part.f0 - 0.5); j + 0.5 <= part.f1; j++) {
          const f = j + 0.5; if (f < part.f0) continue;
          const p = geo.at(f), q = geo.at(Math.min(f + 0.02, geo.n - 1)), px = X(p.x), py = Y(p.y);
          const ang = Math.atan2(Y(q.y) - py, X(q.x) - px), s = w * 3.4;
          g.beginPath();
          g.moveTo(px - Math.cos(ang - 0.6) * s, py - Math.sin(ang - 0.6) * s); g.lineTo(px, py); g.lineTo(px - Math.cos(ang + 0.6) * s, py - Math.sin(ang + 0.6) * s);
          g.stroke();
        }
        break;
      }
      default: stroke(g, pts);
    }
  }
  g.restore();
}
