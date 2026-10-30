// Painel de menu flutuante (o mesmo no PC e no VR): desenhado num canvas e mostrado num plano
// 3D. No VR se aponta com o controle; no PC se clica com o mouse. Também: placas de texto e o
// telão do estádio.
import * as THREE from '../vendor/three/three.module.js';

const W = 1024, H = 720;
export const C = {
  bg: 'rgba(7,14,28,0.95)', edge: '#a6ec5a', text: '#eef4ff', dim: '#9fb0c8',
  btn: '#15304f', btnHover: '#22507e', btnOn: '#a6ec5a', btnOnText: '#0b1a10', lock: '#101c2e',
  gold: '#ffd25a', red: '#ff6a5a', green: '#7fe07a',
};
const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';

export class Panel {
  constructor(width = 1.0) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * H / W),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, fog: false }));
    this.mesh.renderOrder = 10;
    this.buttons = [];
    this.hover = -1;
    this.drawFn = null;
    this.mesh.visible = false;
  }

  show(drawFn) { this.drawFn = drawFn; this.hover = -1; this.mesh.visible = true; this.redraw(); }
  hide() { this.mesh.visible = false; this.drawFn = null; }
  get visible() { return this.mesh.visible; }

  redraw() {
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg; roundRect(g, 4, 4, W - 8, H - 8, 28); g.fill();
    g.strokeStyle = C.edge; g.lineWidth = 4; g.stroke();
    this.buttons = [];
    this.drawFn?.(this);
    this.tex.needsUpdate = true;
  }

  title(text, y = 70, size = 56) {
    const g = this.ctx;
    g.fillStyle = C.edge; g.font = `bold ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, y);
  }
  text(text, x, y, { size = 32, color = C.text, align = 'center', bold = false } = {}) {
    const g = this.ctx;
    g.fillStyle = color; g.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(text, x, y);
  }
  button(label, action, x, y, w, h, { on = false, locked = false, size = 34, sub = null } = {}) {
    const g = this.ctx;
    const i = this.buttons.length;
    this.buttons.push({ x, y, w, h, action: locked ? null : action });
    g.fillStyle = locked ? C.lock : on ? C.btnOn : (i === this.hover ? C.btnHover : C.btn);
    roundRect(g, x, y, w, h, 16); g.fill();
    if (i === this.hover && !locked) { g.strokeStyle = C.edge; g.lineWidth = 3; g.stroke(); }
    g.fillStyle = on ? C.btnOnText : locked ? C.dim : C.text;
    g.font = `bold ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2 - (sub ? 14 : 0));
    if (sub) { g.font = `22px ${FONT}`; g.fillStyle = on ? C.btnOnText : C.dim; g.fillText(sub, x + w / 2, y + h / 2 + 20); }
  }
  // Linha da tabela da copa: rodada, time, situação.
  matchRow(x, y, w, h, { round, team, status, color, locked, current, action }) {
    const g = this.ctx;
    const i = this.buttons.length;
    this.buttons.push({ x, y, w, h, action: locked ? null : action });
    g.fillStyle = locked ? C.lock : (i === this.hover ? C.btnHover : C.btn);
    roundRect(g, x, y, w, h, 14); g.fill();
    if (current && !locked) { g.strokeStyle = C.edge; g.lineWidth = 3; g.stroke(); }
    if (i === this.hover && !locked) { g.strokeStyle = C.text; g.lineWidth = 3; roundRect(g, x, y, w, h, 14); g.stroke(); }
    g.fillStyle = color; roundRect(g, x + 14, y + 14, 16, h - 28, 6); g.fill();
    this.text(round, x + 46, y + h / 2 - 15, { size: 20, align: 'left', color: C.dim });
    this.text(locked ? '???' : team, x + 46, y + h / 2 + 15, { size: 30, align: 'left', bold: true, color: locked ? C.dim : C.text });
    this.text(status, x + w - 20, y + h / 2, { size: 24, align: 'right', color: status.startsWith('Venceu') ? C.green : status.startsWith('Elim') ? C.red : C.dim });
  }

  pick(uv) {
    if (!uv) return -1;
    const x = uv.x * W, y = (1 - uv.y) * H;
    return this.buttons.findIndex(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  }
  setHover(i) { if (i !== this.hover) { this.hover = i; this.redraw(); } }
  actionAt(i) { return i >= 0 ? this.buttons[i]?.action : null; }
}

function fit(g, text, maxW, font) {
  g.font = font;
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Placa de texto (resultado grande, dicas no VR, FPS). Várias linhas.
export class Label {
  constructor(width = 0.16, px = 256, py = 64, { bg = 'rgba(6,12,24,0.72)' } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px; this.canvas.height = py;
    this.ctx = this.canvas.getContext('2d');
    this.bg = bg;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * py / px),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, fog: false }));
    this.mesh.renderOrder = 11;
    this.last = null;
  }
  // lines: texto ou [{ text, size (fração da altura), color, bold }]
  set(lines) {
    const key = JSON.stringify(lines);
    if (key === this.last) return;
    this.last = key;
    if (typeof lines === 'string') lines = [{ text: lines }];
    const g = this.ctx, w = this.canvas.width, h = this.canvas.height;
    g.clearRect(0, 0, w, h);
    if (!lines.length) { this.tex.needsUpdate = true; return; }
    if (this.bg) { g.fillStyle = this.bg; roundRect(g, 0, 0, w, h, Math.min(24, h / 4)); g.fill(); }
    const total = lines.reduce((s, l) => s + (l.size ?? 0.55 / lines.length), 0);
    let y = (h - total * h) / 2;
    for (const l of lines) {
      const sz = (l.size ?? 0.55 / lines.length) * h;
      g.fillStyle = l.color || '#eef4ff';
      const font = `${l.bold === false ? '' : 'bold '}${Math.round(sz * 0.8)}px ${FONT}`;
      const txt = fit(g, l.text, w - 24, font);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (!this.bg) { g.lineWidth = Math.max(4, sz * 0.12); g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText(txt, w / 2, y + sz / 2); }
      g.fillText(txt, w / 2, y + sz / 2);
      y += sz;
    }
    this.tex.needsUpdate = true;
  }
}

// Telão do estádio: nomes dos times, placar de defesas e as bolinhas de cada chute (ou dos
// pênaltis). info vem de drawInfo() em main.js.
export class Telao {
  constructor(width = 22) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 384;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 384 / 1024),
      new THREE.MeshBasicMaterial({ map: this.tex, fog: false, toneMapped: false }));
    this.last = null;
  }
  set(info) {
    const key = JSON.stringify(info);
    if (key === this.last) return;
    this.last = key;
    const g = this.ctx, w = 1024, h = 384;
    g.fillStyle = '#04070d'; g.fillRect(0, 0, w, h);
    // grade de LED
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 2, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#a6ec5a'; g.font = `bold 40px ${FONT}`;
    g.fillText(info.top, w / 2, 42);
    g.fillStyle = '#ffffff'; g.font = `bold 64px ${FONT}`;
    g.fillText(info.main, w / 2, 122);
    g.fillStyle = '#c8d4e8'; g.font = `32px ${FONT}`;
    g.fillText(info.sub || '', w / 2, 182);
    const rows = info.rows || [];
    rows.forEach((r, ri) => {
      const y = 250 + ri * 74 - (rows.length === 1 ? -20 : 0);
      g.textAlign = 'left'; g.fillStyle = '#ffffff'; g.font = `bold 30px ${FONT}`;
      g.fillText(r.label, 40, y);
      const n = r.marks.length, size = 46;
      const x0 = 260;
      for (let i = 0; i < n; i++) {
        const m = r.marks[i], cx = x0 + i * (size + 14) + size / 2;
        g.beginPath(); g.arc(cx, y, size / 2, 0, Math.PI * 2);
        if (m === null) { g.strokeStyle = '#3a4a62'; g.lineWidth = 4; g.stroke(); continue; }
        g.fillStyle = m === 'good' ? '#5fd35a' : m === 'bad' ? '#e8483a' : '#8a96a8';
        g.fill();
      }
    });
    this.tex.needsUpdate = true;
  }
}
