// Física da bola: gravidade, arrasto do ar, efeito Magnus, quique e rolar no gramado, traves,
// rede (por dentro e por fora) e choque com luvas e corpos que se mexem (esferas e cápsulas,
// com a velocidade de quem bate contando no rebote). Sem navegador nem Three.js.
//
// Coordenadas em metros: o gol fica na linha z = 0, entre x = -3,66 e x = 3,66, até 2,44 de
// altura; a rede vai para trás (z > 0). O campo fica em z < 0. Os chutes andam para +z.
import { clamp } from './math.js';

export const DT = 1 / 240;
export const G = 9.81;
export const BALL_R = 0.11;
export const GOAL_HW = 3.66;          // meia largura (7,32 m)
export const GOAL_H = 2.44;
export const POST_R = 0.06;
export const NET_D = 1.9;             // fundo da rede
export const DRAG = 0.013;            // a = -DRAG·|v|·v (bola de futebol, ar ao nível do mar)
export const MAGNUS = 0.0042;         // a = MAGNUS·(ω × v)
export const SPIN_DECAY = 0.3;        // por segundo
export const GROUND_E = 0.55;         // quique no gramado
export const ROLL = 1.0;              // freio de rolar no gramado, por segundo
export const GLOVE_R = 0.13;
export const GLOVE_E = 0.45;          // luva é macia: devolve 45% da velocidade
export const PEN_SPOT = [0, BALL_R, -11];

const PX = GOAL_HW + POST_R, PY = GOAL_H + POST_R;
export const POSTS = [
  { a: [-PX, 0, 0], b: [-PX, PY, 0] },
  { a: [PX, 0, 0], b: [PX, PY, 0] },
  { a: [-PX, PY, 0], b: [PX, PY, 0] },
];
const ZERO = [0, 0, 0];

export function newBall(p) {
  return { p: p.slice(), v: [0, 0, 0], w: [0, 0, 0], inGoal: false, outside: false };
}
export function cloneBall(b) {
  return { p: b.p.slice(), v: b.v.slice(), w: b.w.slice(), inGoal: b.inGoal, outside: b.outside };
}

// Um passo da bola. opts: colliders { spheres: [{p, v, r, e, tag}], capsules: [{a, b, r, v, e, tag}],
// eGlove }, ev (lista de eventos), posts, net, spin (false = ignora o efeito, para previsões ingênuas).
export function stepBall(b, dt, opts = {}) {
  const { colliders = null, ev = null, posts = true, net = true, spin = true } = opts;
  const v = b.v, w = spin ? b.w : ZERO, p = b.p;
  const s = Math.hypot(v[0], v[1], v[2]);
  const ax = -DRAG * s * v[0] + MAGNUS * (w[1] * v[2] - w[2] * v[1]);
  const ay = -G - DRAG * s * v[1] + MAGNUS * (w[2] * v[0] - w[0] * v[2]);
  const az = -DRAG * s * v[2] + MAGNUS * (w[0] * v[1] - w[1] * v[0]);
  v[0] += ax * dt; v[1] += ay * dt; v[2] += az * dt;
  const pz0 = p[2];
  p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
  const k = Math.exp(-SPIN_DECAY * dt);
  b.w[0] *= k; b.w[1] *= k; b.w[2] *= k;

  // gramado
  if (p[1] < BALL_R) {
    p[1] = BALL_R;
    if (v[1] < 0) {
      const vin = -v[1];
      if (vin > 0.7) {
        v[1] = vin * GROUND_E;
        v[0] *= 0.88; v[2] *= 0.88;
        b.w[0] *= 0.6; b.w[1] *= 0.8; b.w[2] *= 0.6;
        ev?.push({ type: 'quique', v: vin, p: p.slice() });
      } else v[1] = 0;
    }
  }
  if (p[1] <= BALL_R + 1e-4 && v[1] === 0) {
    const f = Math.max(0, 1 - ROLL * dt), fw = Math.max(0, 1 - 3 * dt);
    v[0] *= f; v[2] *= f;
    b.w[0] *= fw; b.w[1] *= fw; b.w[2] *= fw;
  }

  // linha do gol: entrou pela boca do gol ou por fora
  if (pz0 <= 0 && p[2] > 0) {
    b.inGoal = Math.abs(p[0]) < GOAL_HW && p[1] < GOAL_H;
    b.outside = !b.inGoal;
  } else if (p[2] <= 0) { b.inGoal = false; b.outside = false; }

  if (posts) {
    for (const P of POSTS) {
      const hit = collideCapsule(b, P.a, P.b, POST_R, 0.7, null, 0.9);
      if (hit > 0.3) ev?.push({ type: 'trave', v: hit, p: p.slice() });
    }
  }
  if (net && p[2] > -BALL_R) netCollide(b, ev);
  if (colliders) {
    for (const c of colliders.spheres || []) {
      const hit = collideCapsule(b, c.p, c.p, c.r, colliders.eGlove ?? c.e ?? GLOVE_E, c.v, 0.6);
      if (hit > 0) ev?.push({ type: 'toque', tag: c.tag, v: hit, p: p.slice() });
    }
    for (const c of colliders.capsules || []) {
      const hit = collideCapsule(b, c.a, c.b, c.r, c.e ?? 0.3, c.v, 0.5);
      if (hit > 0) ev?.push({ type: 'toque', tag: c.tag, v: hit, p: p.slice() });
    }
  }
}

// Esfera da bola contra um segmento grosso (cápsula; a == c vira esfera). vel = velocidade de quem
// bate. Devolve a velocidade de impacto (0 se não bateu ou já estava se afastando).
export function collideCapsule(b, a, c, r, e, vel, tang) {
  const p = b.p, v = b.v;
  const abx = c[0] - a[0], aby = c[1] - a[1], abz = c[2] - a[2];
  const L2 = abx * abx + aby * aby + abz * abz;
  let t = L2 > 1e-12 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / L2 : 0;
  t = clamp(t, 0, 1);
  const qx = a[0] + abx * t, qy = a[1] + aby * t, qz = a[2] + abz * t;
  let dx = p[0] - qx, dy = p[1] - qy, dz = p[2] - qz;
  const dl = Math.hypot(dx, dy, dz), min = BALL_R + r;
  if (dl >= min) return 0;
  if (dl > 1e-9) { dx /= dl; dy /= dl; dz /= dl; } else { dx = 0; dy = 0; dz = -1; }
  p[0] = qx + dx * min; p[1] = qy + dy * min; p[2] = qz + dz * min;
  const ux = vel ? vel[0] : 0, uy = vel ? vel[1] : 0, uz = vel ? vel[2] : 0;
  let rx = v[0] - ux, ry = v[1] - uy, rz = v[2] - uz;
  const vn = rx * dx + ry * dy + rz * dz;
  if (vn >= 0) return 0;
  // parte normal volta com a restituição; a tangencial perde um pouco
  const nx = dx * vn, ny = dy * vn, nz = dz * vn;
  const tx = rx - nx, ty = ry - ny, tz = rz - nz;
  rx = -nx * e + tx * tang; ry = -ny * e + ty * tang; rz = -nz * e + tz * tang;
  v[0] = rx + ux; v[1] = ry + uy; v[2] = rz + uz;
  b.w[0] *= 0.5; b.w[1] *= 0.5; b.w[2] *= 0.5;
  return -vn;
}

// Rede: caixa atrás do gol (fundo, teto e lados). Por dentro ela segura a bola; por fora, a bola
// bate e cai (a "rede pelo lado de fora").
function netCollide(b, ev) {
  const p = b.p, v = b.v, R = BALL_R;
  if (p[2] <= 0) return;
  let hit = 0;
  if (b.inGoal) {
    // dentro do gol a rede embola a bola: ela perde força e não volta para o campo
    const f = 0.985;
    v[0] *= f; v[2] *= f;
    if (p[2] > NET_D - R) {
      p[2] = NET_D - R;
      if (v[2] > 0) { hit = v[2]; v[2] = -v[2] * 0.05; v[0] *= 0.35; v[1] *= 0.35; }
    }
    if (Math.abs(p[0]) > GOAL_HW - R) {
      const s = Math.sign(p[0]);
      p[0] = s * (GOAL_HW - R);
      if (v[0] * s > 0) { hit = Math.max(hit, Math.abs(v[0])); v[0] = -v[0] * 0.1; v[2] *= 0.5; v[1] *= 0.6; }
    }
    if (p[1] > GOAL_H - R) {
      p[1] = GOAL_H - R;
      if (v[1] > 0) { hit = Math.max(hit, v[1]); v[1] = -v[1] * 0.1; v[0] *= 0.5; v[2] *= 0.5; }
    }
    if (hit > 0.8) ev?.push({ type: 'rede', v: hit, p: p.slice(), dentro: true });
    return;
  }
  if (p[2] < NET_D + R && Math.abs(p[0]) < GOAL_HW + R && p[1] < GOAL_H + R) {
    const dTop = GOAL_H + R - p[1], dSide = GOAL_HW + R - Math.abs(p[0]), dBack = NET_D + R - p[2];
    if (dTop <= dSide && dTop <= dBack) {
      p[1] = GOAL_H + R;
      if (v[1] < 0) { hit = -v[1]; v[1] = -v[1] * 0.15; v[0] *= 0.5; v[2] *= 0.5; }
    } else if (dSide <= dBack) {
      const s = Math.sign(p[0]);
      p[0] = s * (GOAL_HW + R);
      if (v[0] * s < 0) { hit = Math.abs(v[0]); v[0] = -v[0] * 0.15; v[2] *= 0.4; }
    } else {
      p[2] = NET_D + R;
      if (v[2] < 0) { hit = -v[2]; v[2] = -v[2] * 0.15; }
    }
    if (hit > 0.8) ev?.push({ type: 'rede', v: hit, p: p.slice(), dentro: false });
  }
}

// Onde a bola cruza o plano z = zPlane (andando para +z), sem luvas nem traves. spin: false faz a
// previsão "ingênua" (sem efeito), que é como o goleiro do computador lê o chute.
export function predictCross(ball, zPlane, { spin = true, maxT = 3, dt = 1 / 120 } = {}) {
  const b = cloneBall(ball);
  if (b.p[2] >= zPlane) return null;
  for (let t = 0; t < maxT; t += dt) {
    const p0 = b.p.slice();
    stepBall(b, dt, { posts: false, net: false, spin });
    if (b.p[2] >= zPlane) {
      const f = (zPlane - p0[2]) / Math.max(1e-9, b.p[2] - p0[2]);
      return { x: p0[0] + (b.p[0] - p0[0]) * f, y: p0[1] + (b.p[1] - p0[1]) * f, t: t + dt * f };
    }
    if (b.v[2] <= 0.05 && t > 0.05) return null;
  }
  return null;
}

// Acha a direção de saída para a bola, chutada com essa velocidade e esse efeito, chegar ao
// ponto alvo [x, y, z] (z é o plano de chegada). Devolve { v, w, err, t }.
export function aimShot(from, target, speed, w = ZERO) {
  const dx = target[0] - from[0], dy = target[1] - from[1], dz = target[2] - from[2];
  const horiz = Math.max(0.5, Math.hypot(dx, dz));
  let yaw = Math.atan2(dx, dz);
  const tt = horiz / speed;
  let pitch = Math.atan2(dy + 0.5 * G * tt * tt, horiz);
  let best = null;
  for (let i = 0; i < 40; i++) {
    const v = [speed * Math.cos(pitch) * Math.sin(yaw), speed * Math.sin(pitch), speed * Math.cos(pitch) * Math.cos(yaw)];
    const b = newBall(from);
    b.v = v; b.w = w.slice();
    const r = predictCross(b, target[2], { maxT: 4 });
    if (!r) { pitch += 0.04; continue; }
    const ex = target[0] - r.x, ey = target[1] - r.y;
    const err = Math.hypot(ex, ey);
    if (!best || err < best.err) best = { v: v.slice(), w: w.slice(), err, t: r.t };
    if (err < 0.004) break;
    yaw += ex / horiz;
    pitch += ey / horiz * (1 + 0.3 * r.t);
  }
  return best;
}
