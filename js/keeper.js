// Corpos de goleiro. Sem navegador nem Three.js.
//  - KeeperBody: o seu goleiro no PC (e o do robô). As luvas andam num plano em frente ao gol
//    atrás de um alvo (o mouse), com velocidade e alcance de um corpo: os pés andam pela linha,
//    os braços alcançam até um certo ponto e o mergulho é rápido mas cansa (tem recuperação).
//  - CpuKeeper: o goleiro do computador nos seus pênaltis. Escolhe um canto antes do chute, às
//    vezes lê certo, e pula atrás da previsão "ingênua" (sem efeito) da bola.
import { clamp, sign } from './math.js';
import { GLOVE_R, predictCross } from './physics.js';

export const KEEPER_Z = -0.4;   // plano das luvas do seu goleiro
export const CPU_Z = -0.3;      // plano das luvas do goleiro do computador
export const GLOVE_GAP = 0.17;  // meia distância entre as duas luvas

export const KB = {
  speed: 5.5, diveSpeed: 12.5, recoverSpeed: 2.5, diveT: 0.42, recoverT: 0.45,
  reach: 1.45, diveReach: 2.35, bodySpeed: 4.5, bodyDiveSpeed: 8, bodyMax: 3.1,
  minY: 0.14, maxY: 2.5,
};

function glove(tag) { return { p: [0, 1.1, KEEPER_Z], v: [0, 0, 0], r: GLOVE_R, tag }; }

export class KeeperBody {
  constructor() { this.reset(); }

  reset(x = 0) {
    this.b = x;                 // pés (x na linha)
    this.c = [x, 1.1];          // centro das luvas (x, y)
    this.target = [x, 1.1];
    this.dive = 0; this.recover = 0; this.diveDir = 0;
    this.bv = 0;
    this.gloves = [glove('luva0'), glove('luva1')];
    this.place(0);
  }

  get diving() { return this.dive > 0; }

  // Mergulho: por 0,42 s as luvas andam bem mais rápido e alcançam mais longe; depois 0,45 s
  // de recuperação, lenta. Devolve false se ainda está mergulhando ou se levantando.
  startDive() {
    if (this.dive > 0 || this.recover > 0) return false;
    this.dive = KB.diveT;
    this.diveDir = sign(this.target[0] - this.c[0]);
    return true;
  }

  step(dt) {
    const max = this.dive > 0 ? KB.diveSpeed : this.recover > 0 ? KB.recoverSpeed : KB.speed;
    const tx = clamp(this.target[0], -3.9, 3.9), ty = clamp(this.target[1], KB.minY, KB.maxY);
    const dx = tx - this.c[0], dy = ty - this.c[1];
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      const m = Math.min(d, max * dt);
      this.c[0] += dx / d * m; this.c[1] += dy / d * m;
    }
    // os pés seguem as luvas pela linha
    const bs = (this.dive > 0 ? KB.bodyDiveSpeed : KB.bodySpeed) * dt;
    const b0 = this.b;
    this.b = clamp(this.b + clamp(this.c[0] - this.b, -bs, bs), -KB.bodyMax, KB.bodyMax);
    this.bv = (this.b - b0) / Math.max(dt, 1e-6);
    const reach = this.dive > 0 ? KB.diveReach : KB.reach;
    this.c[0] = clamp(this.c[0], this.b - reach, this.b + reach);
    this.c[1] = clamp(this.c[1], KB.minY, KB.maxY);
    if (this.dive > 0) { this.dive -= dt; if (this.dive <= 0) { this.dive = 0; this.recover = KB.recoverT; } }
    else if (this.recover > 0) this.recover = Math.max(0, this.recover - dt);
    this.place(dt);
  }

  place(dt) {
    for (let i = 0; i < 2; i++) {
      const g = this.gloves[i];
      const np = [this.c[0] + (i ? GLOVE_GAP : -GLOVE_GAP), this.c[1], KEEPER_Z];
      g.v = dt > 0 ? [(np[0] - g.p[0]) / dt, (np[1] - g.p[1]) / dt, 0] : [0, 0, 0];
      g.p = np;
    }
  }

  // Quadril e ombros: o tronco aponta do quadril para as luvas (mergulhando, ele deita).
  bodyPoints() {
    const off = Math.abs(this.c[0] - this.b);
    const hipY = 0.95 - 0.55 * clamp((off - 0.9) / 1.4, 0, 1);
    const hip = [this.b, hipY, KEEPER_Z + 0.1];
    let dx = this.c[0] - hip[0], dy = this.c[1] - hip[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const sh = [hip[0] + dx * 0.5, hip[1] + dy * 0.5, hip[2]];
    return { hip, sh, feet: [this.b, 0.1, KEEPER_Z + 0.1] };
  }

  colliders() {
    const { hip, sh, feet } = this.bodyPoints();
    const bv = [this.bv, 0, 0];
    return {
      spheres: this.gloves,
      capsules: [
        { a: hip, b: sh, r: 0.17, v: bv, e: 0.3, tag: 'corpo' },
        { a: feet, b: hip, r: 0.12, v: bv, e: 0.3, tag: 'corpo' },
      ],
      center: this.c.slice(),
    };
  }
}

// Alcance do goleiro do computador: elipse em volta do meio do gol. Os ângulos de cima ficam de
// fora (é onde você faz gol com segurança, se não isolar a bola).
export const CPU_REACH = { ax: 3.0, ay: 1.85, y0: 0.35 };
export function clampCpuReach(x, y) {
  const { ax, ay, y0 } = CPU_REACH;
  y = Math.max(0.15, y);
  const ex = x / ax, ey = (y - y0) / ay;
  const e = Math.hypot(ex, ey);
  if (e <= 1) return [x, y];
  return [x / e, y0 + (y - y0) / e];
}

export class CpuKeeper {
  constructor(rng, { skill = 0.2, speed = 8, react = 0.12 } = {}) {
    this.rng = rng; this.skill = skill; this.speed = speed; this.react = react;
    this.reset();
  }

  reset() {
    this.b = 0; this.c = [0, 1.15]; this.target = [0, 1.15];
    const r = this.rng();
    this.guess = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;  // canto escolhido antes do chute
    this.read = false;
    this.kickT = -1; this.t = 0; this.pr = null; this.n = 0;
    this.bv = 0;
    this.gloves = [0, 1].map(i => ({ p: [(i ? 1 : -1) * GLOVE_GAP, 1.15, CPU_Z], v: [0, 0, 0], r: 0.14, tag: 'cpu' }));
  }

  onKick() { this.kickT = 0; this.read = this.rng() < this.skill; }

  step(dt, ball) {
    this.t += dt;
    let speed = 1.2;
    if (this.kickT >= 0) {
      this.kickT += dt;
      if (this.kickT >= this.react) {
        speed = this.speed;
        if (this.n++ % 6 === 0) this.pr = predictCross(ball, CPU_Z, { spin: false, maxT: 2 }) || this.pr;
        if (this.pr) {
          const pr = this.pr;
          const s = Math.abs(pr.x) < 0.7 ? 0 : sign(pr.x);
          let tx, ty;
          if (this.read || s === this.guess) { tx = pr.x; ty = pr.y; }
          else if (this.guess === 0) { tx = clamp(pr.x, -0.8, 0.8); ty = clamp(pr.y, 0.3, 2.0); }
          else { tx = this.guess * 2.6; ty = 0.75; }
          this.target = clampCpuReach(tx, ty);
        }
      }
    } else {
      this.target = [Math.sin(this.t * 1.7) * 0.3, 1.15 + Math.sin(this.t * 2.3) * 0.05];
    }
    const dx = this.target[0] - this.c[0], dy = this.target[1] - this.c[1];
    const d = Math.hypot(dx, dy);
    if (d > 1e-6) { const m = Math.min(d, speed * dt); this.c[0] += dx / d * m; this.c[1] += dy / d * m; }
    const b0 = this.b;
    this.b = clamp(this.b + clamp(this.c[0] * 0.3 - this.b, -3 * dt, 3 * dt), -0.8, 0.8);
    this.bv = (this.b - b0) / dt;
    for (let i = 0; i < 2; i++) {
      const g = this.gloves[i];
      const np = [this.c[0] + (i ? GLOVE_GAP : -GLOVE_GAP), this.c[1], CPU_Z];
      g.v = [(np[0] - g.p[0]) / dt, (np[1] - g.p[1]) / dt, 0];
      g.p = np;
    }
  }

  get dive() { return clamp(Math.abs(this.c[0] - this.b) / 2.4, 0, 1); }

  bodyPoints() {
    const off = Math.abs(this.c[0] - this.b);
    const hipY = 0.9 - 0.5 * clamp((off - 0.9) / 1.5, 0, 1);
    const hip = [this.b, hipY, CPU_Z + 0.08];
    let dx = this.c[0] - hip[0], dy = this.c[1] - hip[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    return { hip, sh: [hip[0] + dx * 0.5, hip[1] + dy * 0.5, hip[2]], feet: [this.b, 0.1, CPU_Z + 0.08] };
  }

  colliders() {
    const { hip, sh, feet } = this.bodyPoints();
    const bv = [this.bv, 0, 0];
    return {
      spheres: this.gloves,
      capsules: [
        { a: hip, b: sh, r: 0.2, v: bv, e: 0.3, tag: 'cpu' },
        { a: feet, b: hip, r: 0.12, v: bv, e: 0.3, tag: 'cpu' },
      ],
      center: this.c.slice(),
    };
  }
}
