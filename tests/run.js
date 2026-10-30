// Testes automáticos: node tests/run.js (ou npm test). Não tocam som nem usam navegador.
import { makeRng, len } from '../js/math.js';
import {
  DT, G, BALL_R, GOAL_HW, GOAL_H, NET_D, PEN_SPOT, newBall, stepBall, aimShot, predictCross,
} from '../js/physics.js';
import { KeeperBody, CpuKeeper, KEEPER_Z, CPU_Z, clampCpuReach } from '../js/keeper.js';
import { Game, Shootout, planShot, swingToVelocity, wallCapsules, clearsWall, MOVE_LIMIT } from '../js/game.js';
import { TEAMS } from '../js/teams.js';
import { makeRobotKeeper, robotKick } from '../js/robot.js';

let fails = 0, count = 0;
function ok(cond, msg) {
  count++;
  if (!cond) { fails++; console.log('  FALHOU:', msg); }
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const f2 = (v) => v.toFixed(2);

// Voa a bola até cruzar z ou o tempo acabar; devolve os eventos.
function fly(b, sec, opts = {}) {
  const ev = [];
  for (let t = 0; t < sec; t += DT) stepBall(b, DT, { ...opts, ev });
  return ev;
}
function ball(p, v, w = [0, 0, 0]) { const b = newBall(p); b.v = v.slice(); b.w = w.slice(); return b; }

// Joga uma partida inteira. keeper: 'robot' | 'parado' | 'nenhum'. hook(g, kb) roda a cada passo.
function playMatch(mi, seed, keeper = 'robot', hook = null) {
  const g = new Game(mi, { seed });
  const kb = new KeeperBody();
  const robot = makeRobotKeeper();
  const kr = makeRng(seed * 31 + 7);
  const log = [];
  for (let steps = 0; g.state === 'playing' && steps < 240 * 600; steps++) {
    g.events = [];
    if (keeper === 'robot') robot(g, kb); else kb.target = [0, 1.1];
    kb.step(DT);
    const col = kb.colliders();
    if (keeper === 'nenhum') { col.spheres = []; col.capsules = []; }
    g.setKeeper(col);
    if (g.lanceKind === 'bater' && g.phase === 'mirar' && g.pt > 0.5) {
      const k = robotKick(kr);
      g.kickAim(k.x, k.y, k.power, k.curve);
    }
    hook?.(g, kb);
    g.step();
    for (const e of g.events) { if (e.type === 'lance') kb.reset(); log.push(e); }
  }
  return { g, log };
}

console.log('Física da bola');
{
  // queda livre sem velocidade: depois de 0,3 s caiu ~g·t²/2
  const b = ball([0, 5, -20], [0, 0, 0]);
  fly(b, 0.3, { posts: false, net: false });
  ok(near(b.p[1], 5 - 0.5 * G * 0.09, 0.02), `queda livre (y = ${f2(b.p[1])})`);
  // arrasto: chute a 30 m/s perde velocidade no ar
  const c = ball([0, 10, -60], [0, 0, 30]);
  fly(c, 0.5, { posts: false, net: false });
  ok(c.v[2] < 28 && c.v[2] > 23, `arrasto do ar freia (30 → ${f2(c.v[2])} m/s em 0,5 s)`);
  // Magnus: efeito em +y curva para +x; topspin (+x) faz cair mais rápido
  const m = ball([0, 1, -20], [0, 0, 25], [0, 60, 0]);
  fly(m, 0.6, { posts: false, net: false });
  ok(m.p[0] > 0.8, `efeito em y curva a bola para +x (${f2(m.p[0])} m em 0,6 s)`);
  const top = ball([0, 3, -30], [0, 4, 25], [40, 0, 0]), flat = ball([0, 3, -30], [0, 4, 25]);
  fly(top, 0.6, { posts: false, net: false }); fly(flat, 0.6, { posts: false, net: false });
  ok(top.p[1] < flat.p[1] - 0.3, `topspin faz a bola cair mais (${f2(top.p[1])} contra ${f2(flat.p[1])})`);
  // quique: bola caindo no gramado sobe menos que caiu
  const q = ball([0, 2, -30], [0, 0, 0]);
  const evq = fly(q, 1.0, { posts: false, net: false });
  ok(evq.some(e => e.type === 'quique'), 'bola quica no gramado');
  ok(q.p[1] < 1.2 && q.p[1] >= BALL_R - 1e-9, `depois do quique não passa da altura (y = ${f2(q.p[1])})`);
  // rolando para sozinha
  const r = ball([0, BALL_R, -40], [0, 0, 6]);
  fly(r, 8, { posts: false, net: false });
  ok(len(r.v) < 0.1, `bola rolando para (v = ${f2(len(r.v))})`);
  ok(r.p[1] >= BALL_R - 1e-9, 'bola não afunda no gramado');
}

console.log('Traves e rede');
{
  // bola na trave volta
  const b = ball([GOAL_HW + 0.06, 1.0, -3], [0, 0, 20]);
  const ev = fly(b, 0.3);
  ok(ev.some(e => e.type === 'trave'), 'bola acerta a trave');
  ok(b.v[2] < 0, `a trave rebate a bola de volta (vz = ${f2(b.v[2])})`);
  // chute no meio do gol: entra e a rede segura
  const g = ball([0.5, 1.0, -3], [0, 0, 25]);
  const evg = fly(g, 1.5);
  ok(g.inGoal, 'bola no meio entra no gol');
  ok(evg.some(e => e.type === 'rede' && e.dentro), 'rede balança por dentro');
  ok(g.p[2] > 0 && g.p[2] <= NET_D && Math.abs(g.p[0]) < GOAL_HW && g.p[1] <= GOAL_H, `rede segura a bola dentro do gol (${g.p.map(f2)})`);
  // por cima do travessão: não é gol, cai em cima da rede ou atrás
  const o = ball([0, 2.9, -3], [0, 0, 18]);
  fly(o, 1.2);
  ok(!o.inGoal && o.outside, 'bola por cima do travessão fica fora');
  // pela linha de fundo ao lado do gol
  const s = ball([5, 0.5, -3], [0, 0, 18]);
  fly(s, 0.5);
  ok(!s.inGoal && s.outside, 'bola ao lado da trave fica fora');
  // rede pelo lado de fora: vindo de lado, não entra
  const lf = ball([GOAL_HW + 1.5, 1.0, 0.8], [-12, 0, 0]);
  const evl = fly(lf, 0.5);
  ok(!lf.inGoal && Math.abs(lf.p[0]) >= GOAL_HW, 'rede pelo lado de fora segura a bola');
  ok(evl.some(e => e.type === 'rede' && !e.dentro), 'evento de rede por fora');
}

console.log('Luvas');
{
  const glove = (p, v = [0, 0, 0]) => ({ spheres: [{ p, v, r: 0.13, tag: 'luva0' }] });
  // luva parada: a bola volta com ~45% da velocidade
  const b = ball([0, 1.2, -3], [0, 0, 25]);
  const ev = fly(b, 0.11, { colliders: glove([0, 1.2, KEEPER_Z]) });
  ok(ev.some(e => e.type === 'toque' && e.tag === 'luva0'), 'bola bate na luva');
  ok(b.v[2] < 0 && len(b.v) > 8 && len(b.v) < 14, `luva parada devolve a bola com ~45% (|v| = ${f2(len(b.v))})`);
  // espalmar: luva indo de encontro à bola devolve mais forte
  const c = ball([0, 1.2, -3], [0, 0, 25]);
  fly(c, 0.11, { colliders: glove([0, 1.2, KEEPER_Z], [0, 0, -4]) });
  ok(len(c.v) > len(b.v) + 3, `luva indo contra a bola espalma mais forte (${f2(len(c.v))} contra ${f2(len(b.v))})`);
  // tapa de lado: luva andando para +x desvia a bola para +x
  const d = ball([0, 1.2, -3], [0, 0, 25]);
  fly(d, 0.3, { colliders: glove([-0.05, 1.2, KEEPER_Z], [6, 0, 0]) });
  ok(d.v[0] > 1.5, `velocidade da mão desvia a bola para o lado (vx = ${f2(d.v[0])})`);
  // bola que bate na luva antes da linha não é gol
  const e = ball([0, 1.0, -4], [0, 0, 28]);
  fly(e, 1.0, { colliders: glove([0, 1.0, KEEPER_Z]) });
  ok(!e.inGoal, 'defesa na luva impede o gol');
  // bola rápida não atravessa a luva (30 m/s, passo de 1/240 s)
  const f = ball([0.1, 1.0, -6], [0, 0, 34]);
  const evf = fly(f, 0.4, { colliders: glove([0.1, 1.0, KEEPER_Z]) });
  ok(evf.some(x => x.type === 'toque'), 'bola a 34 m/s não atravessa a luva');
}

console.log('Mira (chute calculado)');
{
  const cases = [
    [[0, BALL_R, -11], [2.8, 0.4, 0], 24, [0, 0, 0]],
    [[-6, BALL_R, -18], [2.5, 2.0, 0], 23, [0, -55, 0]],
    [[8, BALL_R, -21], [3.0, 2.0, 0], 21, [30, 15, 0]],
    [[0, BALL_R, -11], [0, 1.5, 0], 12.5, [-15, 0, 0]],
  ];
  for (const [from, target, speed, w] of cases) {
    const s = aimShot(from, target, speed, w);
    ok(s && s.err < 0.03, `mira acerta (${target.map(f2)}) a ${speed} m/s com efeito ${w}: erro ${s ? (s.err * 100).toFixed(1) : '?'} cm`);
    const b = ball(from, s.v, s.w);
    const pr = predictCross(b, 0);
    ok(pr && Math.hypot(pr.x - target[0], pr.y - target[1]) < 0.05, 'previsão confere com a mira');
  }
  // curva de verdade: a bola sai para um lado e chega no outro
  const s = aimShot([-6, BALL_R, -18], [2.5, 1.5, 0], 23, [0, -55, 0]);
  const straightX = -6 + s.v[0] / s.v[2] * 18;
  ok(straightX - 2.5 > 1.0, `curva: em linha reta iria para x = ${f2(straightX)}, a curva traz para 2,5`);
}

console.log('Goleiros');
{
  const kb = new KeeperBody();
  kb.target = [3.3, 0.5];
  for (let t = 0; t < 0.3; t += DT) kb.step(DT);
  const walk = kb.c[0];
  kb.reset(); kb.target = [3.3, 0.5]; kb.startDive();
  for (let t = 0; t < 0.3; t += DT) kb.step(DT);
  ok(kb.c[0] > walk + 0.8, `mergulho chega mais longe (${f2(kb.c[0])} contra ${f2(walk)} andando)`);
  ok(!kb.startDive(), 'não dá para mergulhar de novo no meio do mergulho');
  kb.reset(); kb.target = [3.8, 2.4];
  for (let t = 0; t < 3; t += DT) kb.step(DT);
  ok(kb.c[0] - kb.b <= 1.45 + 1e-6, 'braço tem alcance limitado em relação aos pés');
  ok(kb.c[0] > 3.3, `andando, alcança o ângulo (${f2(kb.c[0])})`);
  const col = kb.colliders();
  ok(col.spheres.length === 2 && col.capsules.length === 2 && col.spheres.every(s => s.p[2] === KEEPER_Z), 'duas luvas e o corpo como colisores');

  ok(Math.hypot(...clampCpuReach(3.0, 2.2).map((v, i) => v - [3.0, 2.2][i])) > 0.5, 'goleiro do computador não alcança o ângulo de cima');
  const lowCorner = clampCpuReach(2.8, 0.4);
  ok(near(lowCorner[0], 2.8, 1e-9), 'goleiro do computador alcança o canto de baixo');

  // goleiro do computador: pulou para o lado errado = gol; chute em cima dele = defesa
  const pen = (target, guess, read = false) => {
    const k = new CpuKeeper(makeRng(3));
    k.guess = guess;
    const s = aimShot(PEN_SPOT, target, 22, [0, 0, 0]);
    const b = ball(PEN_SPOT, s.v);
    k.onKick(); k.read = read;
    const ev = [];
    for (let t = 0; t < 1.2; t += DT) { k.step(DT, b); stepBall(b, DT, { colliders: k.colliders(), ev }); }
    return { b, touched: ev.some(e => e.type === 'toque') };
  };
  const a = pen([2.7, 0.5, 0], -1);
  ok(a.b.inGoal && !a.touched, 'goleiro do computador no canto errado: gol');
  const c = pen([2.7, 0.5, 0], 1);
  ok(!c.b.inGoal && c.touched, 'goleiro do computador no canto certo, bola baixa: defesa');
  const d = pen([0.2, 1.0, 0], 0);
  ok(!d.b.inGoal && d.touched, 'chute no meio com o goleiro parado no meio: defesa');
  const e = pen([2.75, 1.95, 0], 1, true);
  ok(e.b.inGoal, 'ângulo de cima: gol mesmo com o goleiro no canto certo');
}

console.log('Pênaltis (regras)');
{
  const run = (seq) => {
    const s = new Shootout();
    for (const scored of seq) { if (s.winner) break; s.record(s.next(), scored); }
    return s;
  };
  ok(new Shootout().next() === 'eles', 'eles começam');
  let s = run([1, 0, 1, 0, 1, 0]);
  ok(s.winner === 'eles' && s.eles.length === 3 && s.nos.length === 3, `3 x 0 depois de 3 cobranças cada acaba (${s.eles.length}/${s.nos.length})`);
  s = run([0, 1, 0, 1, 0, 1, 1]);
  ok(s.winner === 'nos' && s.eles.length === 3 && s.nos.length === 3, 'acaba assim que um lado não alcança mais o outro');
  s = run([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  ok(!s.winner && s.next() === 'eles', 'empate em 5 x 5 vai para a morte súbita');
  s = run([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
  ok(s.winner === 'eles' && s.eles.length === 6, 'morte súbita: errou depois do outro acertar, perdeu');
  s = run([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
  ok(!s.winner && s.next() === 'nos', 'morte súbita: o outro lado sempre bate a sua');
  s = run([1, 0, 1, 1, 1, 1, 0, 1, 1, 1]);
  ok(s.winner === 'nos' || s.winner === 'eles' || !s.winner, 'sequência qualquer não quebra');
  s = run([1, 1, 1, 0, 1, 1, 1, 0]);
  ok(s.winner === 'eles' && s.eles.length === 4 && s.nos.length === 4, `4 x 2 com uma cobrança sobrando para cada já acaba (${s.score.eles} x ${s.score.nos})`);
  s = run([1, 1, 1, 0, 1, 1, 0]);
  ok(!s.winner && s.next() === 'nos', '3 x 2 na quarta rodada ainda não acabou');
}

console.log('Cobrança do jogador');
{
  const v = swingToVelocity([0.9, 0.6, 5]);
  ok(v && v[0] > 0 && v[2] > 15, 'gesto para a frente e para a direita (+x) manda a bola para +x');
  ok(!swingToVelocity([0, 0, 0.3]), 'gesto fraco não chuta');
  ok(!swingToVelocity([0, 2, -3]), 'gesto para trás não chuta');
  const strong = swingToVelocity([0, 0.5, 7]), weak = swingToVelocity([0, 0.5, 3]);
  ok(len(strong) > len(weak) + 8, 'mão mais rápida chuta mais forte');
  const b = ball(PEN_SPOT, swingToVelocity([0.6, 0.4, 5]));
  const pr = predictCross(b, 0);
  ok(pr && pr.x > 0.5 && pr.x < GOAL_HW && pr.y > 0 && pr.y < GOAL_H, `gesto normal acerta o gol (x ${f2(pr?.x ?? 0)}, y ${f2(pr?.y ?? 0)})`);
  // no PC: força demais isola
  const g = new Game(4, { seed: 2 });
  g.stage = 'penaltis'; g.shootout = new Shootout(); g.shootout.record('eles', false);
  g.startLance();
  ok(g.lanceKind === 'bater' && g.plan.from[2] === PEN_SPOT[2], 'depois da cobrança deles, você bate');
  for (let t = 0; t < 2; t += DT) g.step();
  ok(g.phase === 'mirar', 'espera a sua cobrança depois do apito');
  ok(g.kickAim(0, 2.1, 1.0), 'kickAim chuta');
  const p2 = predictCross(g.ball, 0);
  ok(!p2 || p2.y > GOAL_H, `força máxima no alto isola por cima (y ${f2(p2?.y ?? 9)})`);
}

console.log('Estilos dos batedores');
{
  const rng = makeRng(11);
  let curveSum = 0, n = 0, chips = 0, overs = 0, cleared = 0, fk = 0;
  for (let i = 0; i < 40; i++) {
    const c = planShot('curva', rng, TEAMS[1]);
    const s = aimShot(c.from, c.target, c.speed, c.w);
    const straightX = c.from[0] + s.v[0] / s.v[2] * (-c.from[2]);
    curveSum += Math.abs(straightX - c.target[0]); n++;
    const m = planShot('malandro', rng, TEAMS[2]);
    if (m.chip) chips++;
    ok(m.paradinha, 'malandro sempre faz paradinha');
    const f = planShot('falta', rng, TEAMS[4]);
    fk++;
    ok(f.wall.length === 4, 'falta tem barreira de 4');
    const dWall = Math.hypot(f.wall[1].x / 2 + f.wall[2].x / 2 - f.from[0], f.wall[1].z / 2 + f.wall[2].z / 2 - f.from[2]);
    ok(near(dWall, 9.15, 0.05), `barreira a 9,15 m (${f2(dWall)})`);
    if (clearsWall(f.from, f.sol.v, f.sol.w, f.wall)) cleared++;
    if (f.target[1] > 1.7) overs++;
  }
  ok(curveSum / n > 1.0, `curva desvia em média ${f2(curveSum / n)} m da linha reta`);
  ok(chips > 3 && chips < 30, `cavadinha aparece às vezes (${chips} de 40)`);
  ok(cleared >= 32, `a falta passa por cima da barreira na maioria (${cleared} de ${fk})`);
  ok(overs > 5, 'falta às vezes vai no ângulo de cima');
  // barreira pula no chute
  const caps0 = wallCapsules([{ x: 0, z: -10 }], 0), caps1 = wallCapsules([{ x: 0, z: -10 }], 0.35);
  ok(caps1[0].b[1] > caps0[0].b[1] + 0.3, 'barreira pula na hora do chute');
}

console.log('Paradinha (malandro)');
{
  // goleiro que se mexe antes do chute leva no outro canto
  let tested = 0, opposite = 0, waitOk = 0;
  for (let seed = 1; seed <= 8; seed++) {
    let moved = false, kickX = null;
    playMatch(2, seed, 'robot', (g, kb) => {
      if (g.n > 0 || g.lanceKind !== 'defender') return;
      if (g.phase === 'paradinha' && g.pt > 0.2 && !moved) { kb.target = [1.5, 1.0]; kb.c = [1.5, 1.0]; kb.b = 1.0; kb.place(DT); g.setKeeper(kb.colliders()); moved = true; }
      if (g.phase === 'voo' && kickX === null) { kickX = g.plan.target[0]; }
    });
    if (kickX !== null) { tested++; if (kickX < -1.5) opposite++; }
    // robô parado na paradinha: espera o tempo todo e o chute sai normal
    const { log } = playMatch(2, seed, 'robot');
    if (!log.some(e => e.type === 'enganou')) waitOk++;
  }
  ok(tested === 8 && opposite === 8, `quem sai antes leva no outro canto (${opposite} de ${tested})`);
  ok(waitOk === 8, 'quem espera parado não é enganado');
  ok(MOVE_LIMIT > 0.3 && MOVE_LIMIT < 0.7, 'limite de movimento razoável');
}

console.log('Partidas (cada adversário é vencível, e não de graça)');
for (let mi = 0; mi < TEAMS.length; mi++) {
  const def = TEAMS[mi];
  let wins = 0, stillLoss = 0, emptyGoals = 0, emptyShots = 0, rebounds = 0, seconds = 0, pens = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const { g, log } = playMatch(mi, seed, 'robot');
    if (g.state === 'won') wins++;
    const saves = g.saves, goals = g.goals, miss = g.misses;
    ok(saves + goals + miss === def.shots, `${def.name}, semente ${seed}: placar soma ${def.shots} chutes (${saves}+${goals}+${miss})`);
    ok(g.history.length === def.shots, 'histórico com todos os chutes');
    rebounds += log.filter(e => e.type === 'rebote').length;
    seconds += log.filter(e => e.type === 'chute' && e.segundo).length;
    if (def.final) {
      ok(!!g.shootout, `${def.name}: depois das faltas tem pênaltis`);
      if (g.shootout) {
        pens++;
        ok(g.shootout.winner === 'nos', `${def.name}, semente ${seed}: robôs ganham nos pênaltis (${g.shootout.score.nos} x ${g.shootout.score.eles})`);
        ok(log.some(e => e.type === 'lance' && e.kind === 'bater'), 'você bate pênalti na final');
      }
    }
    const still = playMatch(mi, seed, 'parado').g;
    if (still.state === 'lost') stillLoss++;
    const empty = playMatch(mi, seed, 'nenhum');
    emptyGoals += empty.g.goals; emptyShots += empty.g.history.length;
    ok(empty.g.state === 'lost' && empty.g.goals === def.maxGoals + 1, `${def.name}: gol vazio perde assim que passa do limite (${empty.g.goals} gols)`);
  }
  ok(wins === 6, `${def.name} (${def.style}): robô goleiro vence as 6 partidas (${wins})`);
  ok(stillLoss >= 4, `${def.name}: goleiro parado perde a maioria (${stillLoss} de 6)`);
  ok(emptyGoals / emptyShots > 0.75, `${def.name}: sem goleiro, quase todo chute vai no gol (${emptyGoals}/${emptyShots})`);
  if (def.style === 'rebote') {
    ok(rebounds >= 6, `rebote acontece (${rebounds} vezes)`);
    ok(seconds >= 4, `o segundo atacante chuta o rebote (${seconds} vezes)`);
  }
  console.log(`  ${String(mi + 1)}. ${def.name.padEnd(20)} robô ${wins}/6, parado perde ${stillLoss}/6, sem goleiro ${emptyGoals}/${emptyShots} gols${def.style === 'rebote' ? `, rebotes ${rebounds}, segundos chutes ${seconds}` : ''}`);
}

console.log('Regras da partida');
{
  // mesma semente, mesmo jogo
  const a = playMatch(1, 5, 'parado').log.filter(e => e.type === 'chute').map(e => e.speed.toFixed(3)).join();
  const b = playMatch(1, 5, 'parado').log.filter(e => e.type === 'chute').map(e => e.speed.toFixed(3)).join();
  ok(a === b && a.length > 0, 'mesma semente repete os mesmos chutes');
  // série: ganha quem termina os 6 com no máximo 2 gols
  const { g } = playMatch(0, 1, 'robot');
  ok(g.state === 'won' && g.n === 6, 'série termina nos 6 chutes');
  const ev = playMatch(0, 2, 'nenhum').log;
  ok(ev.filter(e => e.type === 'resultado').length === 3 && ev.at(-1).type === 'fim' && !ev.at(-1).won, 'eliminado no terceiro gol, sem chutar o resto');
  // apito antes de cada chute, e o chute só sai depois do apito
  const evs = playMatch(3, 1, 'robot').log;
  let okOrder = true, whistled = false;
  for (const e of evs) {
    if (e.type === 'lance') whistled = false;
    if (e.type === 'apito') whistled = true;
    if (e.type === 'chute' && !whistled) okOrder = false;
  }
  ok(okOrder, 'chute só depois do apito');
}

console.log(fails ? `\n${fails} de ${count} verificações falharam` : `\nTudo certo (${count} verificações)`);
process.exit(fails ? 1 : 0);
