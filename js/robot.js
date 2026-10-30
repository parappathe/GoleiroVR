// Robôs: o goleiro que defende todo chute alcançável (prevê onde a bola cruza o plano das luvas
// e vai até lá, mergulhando quando precisa) e o batedor de pênalti (ângulo de cima, força média).
// Usados pelos testes e pelo dev.autoplay. Sem navegador nem Three.js.
import { clamp, range, side } from './math.js';
import { GOAL_HW, GOAL_H, predictCross } from './physics.js';
import { KEEPER_Z } from './keeper.js';

export function makeRobotKeeper() {
  let k = 0, pr = null, lastKick = -2;
  return function robotKeeper(game, kb) {
    if (game.lanceKind !== 'defender') { kb.target = [0, 1.1]; return; }
    const b = game.ball, ph = game.phase;
    if (ph === 'voo' && b.v[2] > 0.5 && b.p[2] < KEEPER_Z) {
      if (game.kickT !== lastKick) { lastKick = game.kickT; k = 0; pr = null; }
      if (k++ % 4 === 0) pr = predictCross(b, KEEPER_Z, { maxT: 3 });
      if (pr && Math.abs(pr.x) < GOAL_HW + 0.35 && pr.y < GOAL_H + 0.3) {
        kb.target = [pr.x, clamp(pr.y, 0.14, 2.5)];
        const d = Math.hypot(pr.x - kb.c[0], pr.y - kb.c[1]);
        if (d > 0.45 && d / Math.max(0.05, pr.t) > 3.5) kb.startDive();
        return;
      }
      kb.target = [clamp(b.p[0] * 0.15, -1.2, 1.2), 1.0];
      return;
    }
    if (ph === 'rebote' || ph === 'voo') { kb.target = [clamp(b.p[0] * 0.3, -2.4, 2.4), 0.9]; return; }
    // antes do chute: fecha o ângulo e fica parado (não cai na paradinha)
    kb.target = [clamp(game.plan.from[0] * 0.12, -1.0, 1.0), 1.05];
  };
}

// Batedor: escolhe um ângulo de cima, onde o goleiro do computador não alcança.
export function robotKick(rng) {
  const s = side(rng);
  return { x: s * range(rng, 2.6, 2.9), y: range(rng, 1.85, 2.05), power: 0.62, curve: 0 };
}
