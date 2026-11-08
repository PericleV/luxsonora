// Deterministically generated demo images.
// Ported from legacy/sonificare.html; logic unchanged.
import { clamp, clampInt, lerp, mulberry32, hashBytes, srgbToLin, labF, boxBlur, entropyOf } from "../core/util.js";

export function drawDemo(kind) {
  const W = 960, H = 640, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), rnd = mulberry32(kind === "lac" ? 42 : 7);
  if (kind === "lac") {
    let gr = g.createLinearGradient(0, 0, 0, H * 0.6);
    gr.addColorStop(0, "#1c2b5e"); gr.addColorStop(0.55, "#c8604a"); gr.addColorStop(1, "#f4c36a");
    g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.6);
    const sx = W * 0.66, sy = H * 0.47;
    const rg = g.createRadialGradient(sx, sy, 10, sx, sy, 170);
    rg.addColorStop(0, "rgba(255,240,200,0.9)"); rg.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = rg; g.fillRect(0, 0, W, H * 0.6);
    g.fillStyle = "#fff3cf"; g.beginPath(); g.arc(sx, sy, 38, 0, Math.PI * 2); g.fill();
    const ridge = (base, amp, color, step) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, H * 0.6);
      for (let x = 0; x <= W; x += step) g.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin(x * 0.006 + base)) * (0.6 + 0.4 * rnd()));
      g.lineTo(W, H * 0.6); g.closePath(); g.fill();
    };
    ridge(H * 0.47, 90, "#5a3a5c", 24); ridge(H * 0.54, 70, "#2d2342", 16);
    gr = g.createLinearGradient(0, H * 0.6, 0, H); gr.addColorStop(0, "#8a4a52"); gr.addColorStop(1, "#141a35");
    g.fillStyle = gr; g.fillRect(0, H * 0.6, W, H * 0.4);
    for (let i = 0; i < 160; i++) {
      const y = H * 0.6 + Math.pow(rnd(), 1.6) * H * 0.4, x = rnd() * W, w = 20 + rnd() * 120;
      g.fillStyle = `rgba(255,${(180 + rnd() * 60) | 0},${(120 + rnd() * 60) | 0},${0.08 + rnd() * 0.18})`; g.fillRect(x, y, w, 1.5);
    }
    for (let i = 0; i < 60; i++) {
      const y = H * 0.6 + rnd() * H * 0.38, w = 10 + rnd() * 60 * (1 - (y - H * 0.6) / (H * 0.4));
      g.fillStyle = `rgba(255,236,190,${0.25 + rnd() * 0.5})`; g.fillRect(sx - w / 2 + (rnd() - 0.5) * 20, y, w, 2);
    }
    g.fillStyle = "#120f22"; g.fillRect(0, H * 0.585, W * 0.3, H * 0.03);
    for (let i = 0; i < 22; i++) {
      const x = (i * W * 0.3) / 22 + rnd() * 8, h = 40 + rnd() * 70, w = 14 + rnd() * 12;
      g.beginPath(); g.moveTo(x, H * 0.6); g.lineTo(x + w / 2, H * 0.6 - h); g.lineTo(x + w, H * 0.6); g.fill();
    }
    const bx = W * 0.3, by = H * 0.76;
    g.fillStyle = "#1a1424"; g.beginPath(); g.moveTo(bx - 46, by); g.lineTo(bx + 46, by); g.lineTo(bx + 32, by + 14); g.lineTo(bx - 32, by + 14); g.closePath(); g.fill();
    g.fillRect(bx - 2, by - 80, 4, 80);
    g.fillStyle = "#d2463c"; g.beginPath(); g.moveTo(bx + 3, by - 78); g.lineTo(bx + 44, by - 8); g.lineTo(bx + 3, by - 8); g.closePath(); g.fill();
    g.strokeStyle = "rgba(20,16,30,0.9)";
    for (let i = 0; i < 140; i++) {
      const x = W * 0.72 + rnd() * W * 0.28, h = 60 + rnd() * 120; g.lineWidth = 1 + rnd() * 1.5;
      g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(x + (rnd() - 0.5) * 20, H - h * 0.5, x + (rnd() - 0.5) * 40, H - h); g.stroke();
    }
  } else {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#04081a"); gr.addColorStop(0.8, "#1b2c55");
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(230,238,255,${0.3 + rnd() * 0.6})`; g.fillRect(rnd() * W, rnd() * H * 0.45, 1.6, 1.6); }
    const mr = g.createRadialGradient(W * 0.82, H * 0.17, 5, W * 0.82, H * 0.17, 90);
    mr.addColorStop(0, "rgba(220,230,255,0.5)"); mr.addColorStop(1, "rgba(220,230,255,0)"); g.fillStyle = mr; g.fillRect(0, 0, W, H);
    g.fillStyle = "#e9eef7"; g.beginPath(); g.arc(W * 0.82, H * 0.17, 26, 0, Math.PI * 2); g.fill();
    let x = -10, bi = 0;
    while (x < W) {
      const w = 50 + rnd() * 90, h = H * (0.25 + rnd() * 0.45), top = H * 0.85 - h, sh = 14 + ((rnd() * 22) | 0);
      g.fillStyle = `rgb(${sh},${sh + 10},${sh + 34})`; g.fillRect(x, top, w, h);
      for (let yy = top + 10; yy < H * 0.85 - 10; yy += 14) for (let xx = x + 7; xx < x + w - 9; xx += 11) {
        const p = rnd(); if (p < 0.42) { g.fillStyle = p < 0.3 ? "#ffd27a" : "#9fd3ff"; g.fillRect(xx, yy, 5, 7); }
      }
      if (bi === 3) {
        g.shadowColor = "#ff4f6d"; g.shadowBlur = 24; g.fillStyle = "#ff4f6d"; g.fillRect(x + 8, top + 18, Math.min(70, w - 16), 16); g.shadowBlur = 0;
      }
      x += w + rnd() * 6; bi++;
    }
    g.fillStyle = "#0a0f22"; g.fillRect(0, H * 0.85, W, H * 0.15);
    for (let i = 0; i < 46; i++) {
      const y = H * 0.875 + rnd() * H * 0.11, x0 = rnd() * W;
      g.strokeStyle = rnd() < 0.5 ? "rgba(255,80,80,0.75)" : "rgba(255,240,220,0.85)"; g.lineWidth = 1 + rnd() * 2;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 80 + rnd() * 240, y); g.stroke();
    }
  }
  return c;
}
