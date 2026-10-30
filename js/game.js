// Regras de uma partida da copa: série de chutes do adversário (cada time com seu jeito de
// bater), placar de defesas, eliminação e, na final, faltas com barreira seguidas de pênaltis
// alternados (você também bate). Passo fixo de 1/240 s. Sem navegador nem Three.js.
//
// Entrada a cada passo: setKeeper(colisores das suas luvas e do seu corpo), e nas suas
// cobranças kickAim(...) (PC/robô) ou kickSwing(velocidade da mão) (VR).
import { makeRng, range, side, clamp, sign, len } from './math.js';
import { DT, BALL_R, PEN_SPOT, newBall, stepBall, aimShot, cloneBall } from './physics.js';
import { CpuKeeper } from './keeper.js';
import { TEAMS } from './teams.js';

export { DT };
export const PREP_T = 1.8;        // bola parada até o apito
export const PREP_FALTA_T = 2.4;
export const RUN_T = 1.15;        // corrida do batedor
export const WAIT_T = 1.3;        // paradinha: quanto ele espera você se mexer
export const MOVE_LIMIT = 0.45;   // quanto você pode se mexer antes do chute sem ser "lido"
export const RESULT_T = 2.4;
export const WALL_DIST = 9.15;

// ---------- Pênaltis ----------
// 5 cobranças para cada lado, alternadas (eles começam); acaba antes se um lado não puder mais
// alcançar o outro; empatou, morte súbita em pares.
export class Shootout {
  constructor() { this.eles = []; this.nos = []; }
  next() {
    if (this.winner) return null;
    return this.eles.length <= this.nos.length ? 'eles' : 'nos';
  }
  record(lado, scored) { this[lado].push(!!scored); }
  get score() { return { eles: this.eles.filter(Boolean).length, nos: this.nos.filter(Boolean).length }; }
  get winner() {
    const a = this.eles, b = this.nos;
    const { eles: ga, nos: gb } = this.score;
    if (a.length <= 5 && b.length <= 5) {
      const ra = 5 - a.length, rb = 5 - b.length;
      if (ga > gb + rb) return 'eles';
      if (gb > ga + ra) return 'nos';
      return null;
    }
    if (a.length === b.length && ga !== gb) return ga > gb ? 'eles' : 'nos';
    return null;
  }
}

// ---------- Plano de cada chute ----------
// Devolve de onde sai, para onde vai, força, efeito, como o batedor corre e o que o corpo entrega.
export function planShot(style, rng, team = {}) {
  const tellAmt = team.tell ?? 0.8;
  const mkTell = (s) => s * tellAmt * (rng() < (team.fake ?? 0) ? -1 : 1);
  let P;
  if (style === 'forte') {
    const from = [range(rng, -7, 7), BALL_R, -range(rng, 15, 19)];
    const s = side(rng);
    P = {
      from, target: [s * range(rng, 0.7, 2.9), range(rng, 0.35, 1.9), 0], speed: range(rng, 26, 30),
      w: [range(rng, -4, 4), range(rng, -5, 5), 0],
    };
  } else if (style === 'curva') {
    const fs = side(rng);
    const from = [fs * range(rng, 3, 9), BALL_R, -range(rng, 17, 21)];
    const s = rng() < 0.7 ? -fs : fs;        // quase sempre fecha no segundo pau
    const tx = s * range(rng, 1.8, 3.0);
    P = {
      from, target: [tx, range(rng, 0.7, 2.0), 0], speed: range(rng, 22, 25),
      w: [range(rng, 0, 12), -sign(tx) * range(rng, 48, 66), 0],
    };
  } else if (style === 'malandro' || style === 'penalti') {
    const s = side(rng);
    const chip = style === 'malandro' && rng() < 0.35;
    P = chip
      ? { from: PEN_SPOT.slice(), target: [range(rng, -0.4, 0.4), range(rng, 1.3, 1.7), 0], speed: 12.5, w: [-15, 0, 0], chip: true }
      : { from: PEN_SPOT.slice(), target: [s * range(rng, 1.4, 3.0), range(rng, 0.3, 1.8), 0], speed: range(rng, 20, 25), w: [0, range(rng, -6, 6), 0] };
    P.paradinha = style === 'malandro' || rng() < 0.15;
    if (style === 'penalti') P.target[1] = range(rng, 0.3, 1.5);
  } else if (style === 'rebote') {
    const from = [range(rng, -5, 5), BALL_R, -range(rng, 13, 16)];
    const s = side(rng);
    P = {
      from, target: [s * range(rng, 0.3, 1.6), range(rng, 0.5, 1.5), 0], speed: range(rng, 26, 29),
      w: [range(rng, -6, 6), range(rng, -6, 6), 0], venenoso: true,
      second: [-sign(from[0] || 1) * range(rng, 3, 6), -range(rng, 8, 10)],
    };
  } else if (style === 'falta') {
    P = planFreeKick(rng);
  } else throw new Error(`estilo desconhecido: ${style}`);
  // corrida: de trás da bola, vindo um pouco da esquerda do batedor (destro)
  const dir = dirToGoal(P.from);
  const left = [dir[1], -dir[0]];   // esquerda de quem olha para o gol (+z): +x
  const back = P.wall ? 3.4 : 2.8;
  P.run = { start: [P.from[0] - dir[0] * back + left[0] * 1.3, P.from[2] - dir[1] * back + left[1] * 1.3] };
  P.tell = mkTell(Math.abs(P.target[0]) < 0.6 ? 0 : sign(P.target[0]));
  return P;
}

export function dirToGoal(from) {
  const dx = -from[0] * 0.85, dz = -from[2];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

// Falta: bola a 19-23 m, barreira de 4 a 9,15 m cobrindo o primeiro pau. O batedor procura uma
// trajetória que passe por cima da barreira (que pula) e caia no canto.
function planFreeKick(rng) {
  const fs = side(rng);
  const from = [fs * range(rng, 2.5, 9), BALL_R, -range(rng, 19, 23)];
  const near = [fs * 1.8, 0];
  let dx = near[0] - from[0], dz = near[1] - from[2];
  const l = Math.hypot(dx, dz);
  dx /= l; dz /= l;
  const cx = from[0] + dx * WALL_DIST, cz = from[2] + dz * WALL_DIST;
  const px = -dz, pz = dx;
  const wall = [0, 1, 2, 3].map(i => ({ x: cx + px * (i - 1.5) * 0.58, z: cz + pz * (i - 1.5) * 0.58 }));
  const over = rng() < 0.55;
  const target = over
    ? [fs * range(rng, 2.3, 3.1), range(rng, 1.75, 2.1), 0]
    : [-fs * range(rng, 2.0, 3.0), range(rng, 0.9, 1.9), 0];
  const w = over ? [range(rng, 25, 40), fs * range(rng, 8, 20), 0] : [range(rng, 10, 25), fs * range(rng, 35, 50), 0];
  let speed = range(rng, 21, 24);
  let sol = null;
  for (let k = 0; k < 7; k++) {
    sol = aimShot(from, target, speed, w);
    if (sol && clearsWall(from, sol.v, sol.w, wall)) break;
    speed -= 0.8;
    target[1] = Math.min(2.25, target[1] + 0.08);
  }
  return { from, target, speed, w, wall, sol };
}

export const WALL_JUMP = { delay: 0.08, time: 0.55, height: 0.42 };
export function wallJump(since) {
  if (since < WALL_JUMP.delay) return 0;
  const u = (since - WALL_JUMP.delay) / WALL_JUMP.time;
  return u >= 1 ? 0 : WALL_JUMP.height * Math.sin(Math.PI * u);
}
export function wallCapsules(wall, since) {
  const j = since >= 0 ? wallJump(since) : 0;
  return wall.map(m => ({ a: [m.x, 0.2 + j, m.z], b: [m.x, 1.55 + j, m.z], r: 0.26, v: [0, 0, 0], e: 0.25, tag: 'barreira' }));
}
export function clearsWall(from, v, w, wall) {
  const b = newBall(from);
  b.v = v.slice(); b.w = w.slice();
  const ev = [];
  const dt = 1 / 120;
  for (let t = 0; t < 2.5 && b.p[2] < -0.5; t += dt) {
    stepBall(b, dt, { colliders: { capsules: wallCapsules(wall, t) }, ev, posts: false, net: false });
    if (ev.some(e => e.type === 'toque')) return false;
  }
  return true;
}

// Chute do VR: a velocidade da mão no fim do movimento (tipo arremesso) vira direção e força.
export function swingToVelocity(hv) {
  const [vx, vy, vz] = hv;
  const s = Math.hypot(vx, vy, vz), h = Math.hypot(vx, vz);
  if (vz < 0.8 || s < 1.5) return null;
  const yaw = clamp(Math.atan2(vx, vz) * 0.8, -0.42, 0.42);
  const pitch = clamp(0.04 + Math.atan2(vy, h) * 0.5, -0.04, 0.5);
  const speed = clamp(8 + s * 3.3, 11, 33);
  return [speed * Math.cos(pitch) * Math.sin(yaw), speed * Math.sin(pitch), speed * Math.cos(pitch) * Math.cos(yaw)];
}
// Chute do PC (e do robô): mira no gol, força de 0 a 1. Força demais levanta a bola.
export const kickSpeed = (power) => 14 + 18 * clamp(power, 0, 1);
export const kickLift = (power) => Math.max(0, clamp(power, 0, 1) - 0.85) * 6;

// ---------- Partida ----------
export class Game {
  constructor(mi, { seed = 1 } = {}) {
    this.mi = mi;
    this.def = TEAMS[mi];
    this.seed = seed;
    this.rng = makeRng(seed * 7919 + mi * 104729 + 13);
    this.stage = this.def.final ? 'faltas' : 'serie';    // 'serie' | 'faltas' | 'penaltis'
    this.total = this.def.shots;
    this.maxGoals = this.def.maxGoals;
    this.n = 0;                 // chutes já terminados nesta etapa
    this.goals = 0; this.saves = 0; this.misses = 0;
    this.history = [];          // resultado de cada chute da série: 'gol' | 'defesa' | 'fora' | 'trave'
    this.shootout = null;
    this.state = 'playing';     // 'playing' | 'won' | 'lost'
    this.events = [];
    this.t = 0;
    this.keeper = { spheres: [], capsules: [], center: [0, 1.1] };
    this.startLance();
  }

  setKeeper(col) { this.keeper = col; }

  startLance() {
    this.lanceKind = 'defender';
    let style = this.def.style;
    if (this.stage === 'faltas') style = 'falta';
    if (this.stage === 'penaltis') {
      style = 'penalti';
      if (this.shootout.next() === 'nos') this.lanceKind = 'bater';
    }
    this.style = style;
    this.plan = this.lanceKind === 'bater' ? { from: PEN_SPOT.slice(), tell: 0 } : planShot(style, this.rng, this.def);
    this.ball = newBall(this.plan.from);
    this.touched = false; this.hitPost = false; this.hitWall = false; this.second = false;
    this.result = null; this.kickT = -1; this.refC = null; this.lastTouch = null;
    this.wall = this.plan.wall || [];
    this.cpu = this.lanceKind === 'bater' ? new CpuKeeper(this.rng) : null;
    if (this.lanceKind === 'defender') {
      const st = this.plan.run.start, dir = dirToGoal(this.plan.from);
      this.shooter = { p: st.slice(), yaw: Math.atan2(dir[0], dir[1]), anim: 'idle', at: 0, dist: 0 };
    } else this.shooter = null;
    this.shooter2 = this.plan.second
      ? { p: this.plan.second.slice(), yaw: Math.atan2(-this.plan.second[0], -this.plan.second[1]), anim: 'idle', at: 0, dist: 0 }
      : null;
    this.prepT = style === 'falta' ? PREP_FALTA_T : PREP_T;
    this.setPhase('preparo');
    this.events.push({ type: 'lance', kind: this.lanceKind, style });
  }

  setPhase(ph) { this.phase = ph; this.pt = 0; }
  get since() { return this.kickT >= 0 ? this.t - this.kickT : -1; }
  get lanceLabel() {
    if (this.stage === 'penaltis') return 'Pênaltis';
    return `${this.stage === 'faltas' ? 'Falta' : 'Chute'} ${Math.min(this.n + 1, this.total)} de ${this.total}`;
  }

  step() {
    this.t += DT; this.pt += DT;
    if (this.state !== 'playing') { stepBall(this.ball, DT, {}); return; }
    this.cpu?.step(DT, this.ball);
    const sh = this.shooter;
    if (sh) sh.at += DT;
    if (this.shooter2) this.shooter2.at += DT;
    switch (this.phase) {
      case 'preparo':
        if (this.pt >= this.prepT) {
          this.events.push({ type: 'apito' });
          if (this.lanceKind === 'bater') this.setPhase('mirar');
          else { this.setPhase('corrida'); this.refC = this.keeper.center.slice(); sh.anim = 'run'; sh.at = 0; }
        }
        break;
      case 'corrida': {
        const u = Math.min(1, this.pt / RUN_T);
        const end = this.contactPoint(this.plan.paradinha ? 0.85 : 0.42);
        const st = this.plan.run.start;
        const np = [st[0] + (end[0] - st[0]) * u, st[1] + (end[1] - st[1]) * u];
        sh.dist += Math.hypot(np[0] - sh.p[0], np[1] - sh.p[1]);
        sh.p = np;
        if (this.pt >= RUN_T) {
          if (this.plan.paradinha) { this.setPhase('paradinha'); sh.anim = 'stop'; sh.at = 0; this.events.push({ type: 'paradinha' }); }
          else this.kick();
        }
        break;
      }
      case 'paradinha': {
        const moved = this.keeper.center[0] - this.refC[0];
        if (Math.abs(moved) > MOVE_LIMIT) this.kick({ opposite: -sign(moved) });
        else if (this.pt >= WAIT_T) this.kick();
        break;
      }
      case 'mirar':
        break;
      case 'voo':
      case 'rebote':
        this.flight();
        if (this.phase === 'rebote') this.chaseRebound();
        if (this.phase !== 'resultado') this.checkOutcome();
        break;
      case 'resultado':
        this.flight();
        if (this.pt >= RESULT_T) this.endLance();
        break;
    }
  }

  contactPoint(back) {
    const dir = dirToGoal(this.ball.p);
    const left = [dir[1], -dir[0]];
    return [this.ball.p[0] - dir[0] * back + left[0] * 0.22, this.ball.p[2] - dir[1] * back + left[1] * 0.22];
  }

  kick(opt = {}) {
    const P = this.plan;
    let sol;
    if (opt.opposite) {
      // pegou o goleiro saindo antes: bate no outro canto, rasteiro
      P.target = [opt.opposite * range(this.rng, 2.3, 2.9), range(this.rng, 0.3, 0.9), 0];
      P.speed = range(this.rng, 18, 20);
      P.w = [0, 0, 0];
      P.chip = false;
      sol = aimShot(this.ball.p, P.target, P.speed, P.w);
      this.events.push({ type: 'enganou' });
    } else sol = P.sol || aimShot(this.ball.p, P.target, P.speed, P.w);
    if (this.shooter) { this.shooter.p = this.contactPoint(0.42); this.shooter.anim = 'kick'; this.shooter.at = 0; }
    if (!sol) { this.kickT = this.t; this.setResult('fora'); return; }
    this.launch(sol.v, sol.w);
  }

  launch(v, w) {
    this.ball.v = v.slice(); this.ball.w = w.slice();
    this.kickT = this.t;
    this.setPhase('voo');
    this.cpu?.onKick();
    this.events.push({ type: 'chute', speed: len(v), segundo: this.second });
  }

  // Sua cobrança no PC (ou do robô): mira x/y no gol, força 0..1, efeito -1..1.
  kickAim(x, y, power, curve = 0) {
    if (this.lanceKind !== 'bater' || this.phase !== 'mirar') return false;
    const w = [0, -clamp(curve, -1, 1) * 40, 0];
    const sol = aimShot(this.ball.p, [x, y + kickLift(power), 0], kickSpeed(power), w);
    if (!sol) return false;
    this.launch(sol.v, sol.w);
    return true;
  }

  // Sua cobrança no VR: velocidade da mão (m/s, no mundo) no fim do gesto.
  kickSwing(handVel) {
    if (this.lanceKind !== 'bater' || this.phase !== 'mirar') return false;
    const v = swingToVelocity(handVel);
    if (!v) return false;
    this.launch(v, [0, 0, 0]);
    return true;
  }

  colliders() {
    if (this.lanceKind === 'bater') return this.cpu.colliders();
    const k = this.keeper;
    const caps = this.wall.length ? k.capsules.concat(wallCapsules(this.wall, this.since)) : k.capsules;
    return { spheres: k.spheres, capsules: caps, eGlove: this.plan.venenoso && !this.second ? 0.62 : undefined };
  }

  flight() {
    const ev = [];
    const live = this.phase !== 'resultado' || this.result !== 'gol';
    stepBall(this.ball, DT, { colliders: live ? this.colliders() : null, ev });
    for (const e of ev) {
      if (e.type === 'toque') {
        if (e.tag === 'barreira') this.hitWall = true;
        else this.touched = true;
        this.lastTouch = e;
      } else if (e.type === 'trave') this.hitPost = true;
      this.events.push(e);
    }
  }

  canRebound() { return this.plan.venenoso && !this.second && this.lanceKind === 'defender'; }

  checkOutcome() {
    const b = this.ball, since = this.since, sp = len(b.v);
    const saved = this.touched || this.hitWall;
    const deflected = saved || this.hitPost;
    if (b.inGoal && b.p[2] > BALL_R) return this.setResult('gol');
    if (b.outside && b.p[2] > BALL_R) return this.setResult(saved ? 'defesa' : this.hitPost ? 'trave' : 'fora');
    if (Math.abs(b.p[0]) > 36 || b.p[2] < -45) return this.setResult(saved ? 'defesa' : 'fora');
    if (this.phase === 'voo') {
      if (deflected && this.canRebound()) {
        if (b.p[2] < -5 && b.p[2] > -17 && Math.abs(b.p[0]) < 11 && b.v[2] < 1) { this.setPhase('rebote'); this.events.push({ type: 'rebote' }); return; }
      } else if (deflected && b.p[2] < -6 && b.v[2] < 0) return this.setResult(saved ? 'defesa' : 'trave');
      if (sp < 1.0 && since > 0.6 && b.p[2] < 0) return this.setResult(this.hitPost && !saved ? 'trave' : 'defesa');
    }
    if (since > 4.5) this.setResult(saved ? 'defesa' : this.hitPost ? 'trave' : 'fora');
  }

  // Rebote: o segundo atacante corre até a bola e chuta de primeira no canto longe do goleiro.
  chaseRebound() {
    const s2 = this.shooter2, b = this.ball;
    if (!s2) { this.setResult('defesa'); return; }
    const dx = b.p[0] - s2.p[0], dz = b.p[2] - s2.p[1];
    const d = Math.hypot(dx, dz);
    s2.anim = 'run';
    s2.yaw = Math.atan2(dx, dz);
    if (d > 1e-6) {
      const m = Math.min(d, 7.5 * DT);
      s2.p = [s2.p[0] + dx / d * m, s2.p[1] + dz / d * m];
      s2.dist += m;
    }
    if (d < 0.6 && b.p[1] < 0.9) return this.secondKick();
    if (b.p[2] > -4.5 && len(b.v) < 5) return this.setResult('defesa');      // o goleiro ficou com ela
    if (this.pt > 3.2) this.setResult('defesa');
  }

  secondKick() {
    const cx = this.keeper.center[0];
    const s = Math.abs(cx) < 0.3 ? side(this.rng) : -sign(cx);
    const target = [s * range(this.rng, 1.3, 2.6), range(this.rng, 0.35, 1.3), 0];
    const sol = aimShot(this.ball.p, target, range(this.rng, 18.5, 20.5), [0, 0, 0]);
    this.second = true; this.touched = false; this.hitPost = false; this.hitWall = false;
    this.plan.target = target;
    const s2 = this.shooter2;
    s2.anim = 'kick'; s2.at = 0;
    s2.yaw = Math.atan2(-this.ball.p[0] * 0.9, -this.ball.p[2]);
    if (sol) this.launch(sol.v, sol.w);
    else this.setResult('defesa');
  }

  setResult(kind) {
    this.result = kind;
    const lado = this.lanceKind === 'defender' ? 'eles' : 'nos';
    if (this.stage === 'penaltis') this.shootout.record(lado, kind === 'gol');
    else {
      this.history.push(kind);
      if (kind === 'gol') this.goals++;
      else if (kind === 'defesa') this.saves++;
      else this.misses++;
    }
    if (this.shooter) { this.shooter.anim = kind === 'gol' ? 'celebrate' : 'sad'; this.shooter.at = 0; }
    if (this.shooter2 && this.second) { this.shooter2.anim = kind === 'gol' ? 'celebrate' : 'sad'; this.shooter2.at = 0; }
    this.setPhase('resultado');
    this.events.push({ type: 'resultado', kind, lado, touched: this.touched, wall: this.hitWall, post: this.hitPost });
  }

  endLance() {
    if (this.stage === 'penaltis') {
      const w = this.shootout.winner;
      if (w) return this.finish(w === 'nos');
    } else {
      this.n++;
      if (this.goals > this.maxGoals) return this.finish(false);
      if (this.n >= this.total) {
        if (this.def.final) {
          this.stage = 'penaltis';
          this.shootout = new Shootout();
          this.events.push({ type: 'penaltis' });
        } else return this.finish(true);
      }
    }
    this.startLance();
  }

  finish(won) {
    this.state = won ? 'won' : 'lost';
    this.events.push({ type: 'fim', won });
  }

  // Fotografia do placar (para a tela e para o dev.state()).
  summary() {
    const s = {
      etapa: this.stage, lance: this.phase, tipo: this.lanceKind, estilo: this.style,
      chute: this.stage === 'penaltis' ? null : `${Math.min(this.n + 1, this.total)}/${this.total}`,
      defesas: this.saves, gols: this.goals, fora: this.misses, podeSofrer: this.maxGoals,
      historico: this.history.slice(), estado: this.state, resultado: this.result,
    };
    if (this.shootout) s.penaltis = { nos: this.shootout.nos.slice(), eles: this.shootout.eles.slice(), placar: this.shootout.score };
    return s;
  }

  ballCopy() { return cloneBall(this.ball); }
}
