// Liga o núcleo do jogo à tela, ao Quest (controles) e ao mouse.
import * as THREE from '../vendor/three/three.module.js';
import { TEAMS, HOME } from './teams.js';
import { Game, DT, Shootout } from './game.js';
import { KeeperBody, KEEPER_Z } from './keeper.js';
import { makeRobotKeeper, robotKick } from './robot.js';
import { buildScene, buildActors, gloveGripOffset } from './scene.js';
import { Panel, Label, Telao, C } from './ui.js';
import { Sfx } from './audio.js';
import { loadSave, storeSave } from './save.js';
import { makeRng, clamp, len, sign } from './math.js';
import { GLOVE_R } from './physics.js';

const save = loadSave();
const sfx = new Sfx();
sfx.on = save.sound;
const IS_QUEST = /OculusBrowser|Quest/i.test(navigator.userAgent);
const randSeed = () => (Math.random() * 1e9) | 0;

// ---------- Render e cena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_QUEST ? 1 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
document.getElementById('app').appendChild(renderer.domElement);

const world = buildScene(renderer);
const { scene } = world;
const actors = buildActors(world);
const rig = new THREE.Group();
scene.add(rig);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 900);
rig.add(camera);

const panel = new Panel(0.62);
const fpsLabel = new Label(0.12);
fpsLabel.mesh.position.set(0.14, -0.12, -0.55);
fpsLabel.mesh.visible = false;
camera.add(fpsLabel.mesh);
const bigLabel = new Label(3.2, 1024, 256, { bg: null });    // resultado grande no VR
const vrHud = new Label(1.7, 1024, 200);                      // placar e instrução no VR, no chão à frente
vrHud.mesh.rotation.order = 'YXZ';
bigLabel.mesh.visible = vrHud.mesh.visible = false;
scene.add(bigLabel.mesh, vrHud.mesh);
const telao = new Telao(22);
world.telaoGroup.add(telao.mesh);

// ---------- Estado ----------
let app = 'menu';            // 'menu' | 'pre' | 'jogo' | 'pausa' | 'fim'
let game = null;
let mi = 0;                  // partida da copa (0 a 4)
let mode = 'defender';       // 'defender' (você no gol) | 'bater' (você cobra o pênalti)
const kb = new KeeperBody();
let robotK = makeRobotKeeper();
let kickRng = makeRng(77);
let finishTimer = 0, finishWon = false, autoNext = 0;
let msg = null;              // { title, sub, color, t }
let deceived = false;

function newGame(i, seed = randSeed()) {
  game = new Game(i, { seed });
  kb.reset();
  robotK = makeRobotKeeper();
  kickRng = makeRng(seed ^ 0x5bd1e995);
  acc = 0;
  msg = null;
}

// ---------- Câmera do PC ----------
const Y = new THREE.Vector3(0, 1, 0);
function pcCamera() {
  if (renderer.xr.isPresenting) return;
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  if (mode === 'bater') {
    camera.fov = 52;
    camera.position.set(0, 2.0, -15.2);
    camera.lookAt(0, 0.4, -2);
  } else {
    // atrás do gol, vendo as luvas, o gol inteiro e o batedor
    camera.fov = 58;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
    const z = clamp(KEEPER_Z + 4.4 / tanH, 3.6, 7.6);
    camera.position.set(0, 2.05 + (z - 3.6) * 0.12, z);
    camera.lookAt(0, 1.0, -12);
  }
  camera.updateProjectionMatrix();
  if (panel.mesh.parent !== camera) { panel.mesh.parent?.remove(panel.mesh); camera.add(panel.mesh); }
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const visH = 2 * 0.7 * Math.tan(half), visW = visH * aspect;
  panel.mesh.position.set(0, 0, -0.7);
  panel.mesh.quaternion.identity();
  panel.mesh.scale.setScalar(Math.min(1, visW * 0.94 / 0.62, visH * 0.92 / 0.436));
}

function setMode(m) {
  mode = m;
  if (renderer.xr.isPresenting) placeRig(); else pcCamera();
  charge.on = false;
  armed = null;
}

// ---------- VR: rig, recentralizar ----------
const calib = { yaw: 0, head: new THREE.Vector3(0, 1.6, 0) };
let recenterIn = 0;
function recenter() {
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  calib.yaw = e.y;
  calib.head.copy(camera.position);
  placeRig();
}
// Põe a sua cabeça (do jeito que estava ao recentralizar) no lugar certo do campo:
// no gol olhando para o campo, ou atrás da marca do pênalti olhando para o gol.
function placeRig() {
  const want = mode === 'bater' ? Math.PI : 0;
  const ry = want - calib.yaw;
  rig.rotation.set(0, ry, 0);
  const anchor = mode === 'bater' ? [0, -12.4] : [0, -0.12];
  const h = calib.head.clone(); h.y = 0; h.applyAxisAngle(Y, ry);
  rig.position.set(anchor[0] - h.x, 0, anchor[1] - h.z);
  rig.updateMatrixWorld(true);
  if (panel.visible) placePanelVR();
}
renderer.xr.addEventListener('sessionstart', () => {
  recenterIn = 5;
  sfx.unlock();
  if (panel.mesh.parent) panel.mesh.parent.remove(panel.mesh);
  scene.add(panel.mesh);
  panel.mesh.scale.setScalar(1);
  if (panel.visible) placePanelVR();
  updateHint();
});
renderer.xr.addEventListener('sessionend', () => {
  armed = null;
  pcCamera();
  updateHint();
});
function placePanelVR() {
  const head = new THREE.Vector3(), hq = new THREE.Quaternion();
  camera.getWorldPosition(head);
  camera.getWorldQuaternion(hq);
  const yaw = new THREE.Euler().setFromQuaternion(hq, 'YXZ').y;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  panel.mesh.position.copy(head).addScaledVector(fwd, 0.7);
  panel.mesh.position.y = head.y - 0.1;
  panel.mesh.rotation.set(0, yaw, 0);
}

// ---------- Controles do VR ----------
const ctrls = [];
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  rig.add(ctrl, grip);
  const laser = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: C.edge }));
  laser.visible = false;
  ctrl.add(laser);
  const entry = { ctrl, grip, laser, source: null, side: null, prevButtons: [], hoverIndex: -1 };
  ctrls.push(entry);
  ctrl.addEventListener('connected', (e) => { entry.source = e.data; entry.side = e.data.handedness; });
  ctrl.addEventListener('disconnected', () => { entry.source = null; entry.side = null; });
  ctrl.addEventListener('selectstart', () => onPress(entry, true));
  ctrl.addEventListener('selectend', () => releaseKick(entry.side));
  ctrl.addEventListener('squeezestart', () => onPress(entry, false));
  ctrl.addEventListener('squeezeend', () => releaseKick(entry.side));
}
const entryFor = (side) => ctrls.find(e => e.side === side && e.source);
function pulse(side, v, ms) {
  try { entryFor(side)?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(clamp(v, 0, 1), ms); } catch { /* sem vibração */ }
}
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
function handPose(side) {
  const e = entryFor(side);
  if (!e) return null;
  e.grip.getWorldPosition(_v);
  e.grip.getWorldQuaternion(_q);
  if (!Number.isFinite(_v.x) || (_v.x === 0 && _v.y === 0 && _v.z === 0 && !e.grip.visible)) return null;
  return { p: [_v.x, _v.y, _v.z], q: _q.clone() };
}

function onPress(entry, isSelect) {
  sfx.unlock();
  if (panel.visible) {
    if (isSelect && entry.hoverIndex >= 0) {
      const a = panel.actionAt(entry.hoverIndex);
      if (a) { sfx.click(); a(); }
    }
    return;
  }
  if (entry.side) armKick(entry.side);
}

function pollButtons() {
  for (const e of ctrls) {
    const gp = e.source?.gamepad;
    if (!gp || e.source.hand) continue;
    const b = gp.buttons.map(x => x.pressed);
    if (b[4] && !e.prevButtons[4]) { recenter(); sfx.click(); }   // A ou X
    if (b[5] && !e.prevButtons[5]) togglePause();                 // B ou Y
    e.prevButtons = b;
  }
}

// Mãos: posição, velocidade (suavizada) e histórico curto para o gesto de chute.
const hands = { left: { p: null, v: [0, 0, 0], q: null, hist: [] }, right: { p: null, v: [0, 0, 0], q: null, hist: [] } };
function readHands(dt) {
  for (const side of ['left', 'right']) {
    const h = hands[side], pz = handPose(side);
    if (!pz) { h.p = null; h.hist.length = 0; continue; }
    if (h.p && dt > 0) {
      const raw = [(pz.p[0] - h.p[0]) / dt, (pz.p[1] - h.p[1]) / dt, (pz.p[2] - h.p[2]) / dt];
      h.v = h.v.map((v, i) => v * 0.45 + raw[i] * 0.55);
    }
    h.p = pz.p; h.q = pz.q;
    h.hist.push({ t: time, v: h.v.slice() });
    while (h.hist.length && time - h.hist[0].t > 0.25) h.hist.shift();
  }
}

// Luvas do VR: o braço "estica" (alcance maior que o real, para cobrir 7,32 m de gol numa sala)
// e um tranco rápido da mão para o lado vira mergulho, que desloca as luvas por um instante.
const dive = { off: 0, target: 0, t: 0 };
const vrG = { prev: [null, null], cur: [null, null], body: null, dt: 1 / 72 };
const ampX = (d) => sign(d) * (Math.abs(d) < 0.3 ? Math.abs(d) : 0.3 + (Math.abs(d) - 0.3) * 2.6);
const ampY = (y) => clamp(y > 1.45 ? 1.45 + (y - 1.45) * 1.7 : y < 0.7 ? 0.7 - (0.7 - y) * 1.4 : y, 0.08, 2.75);
function updateVrGloves(dt) {
  const head = new THREE.Vector3();
  camera.getWorldPosition(head);
  for (const [i, side] of [[0, 'left'], [1, 'right']]) {
    const h = hands[side];
    if (!h.p) continue;
    const dx = h.p[0] - head.x;
    if (dive.t <= 0 && Math.abs(h.v[0]) > 2.3 && sign(h.v[0]) === sign(dx) && Math.abs(dx) > 0.3) {
      dive.target = sign(dx) * 1.3; dive.t = 0.55;
      pulse(side, 0.3, 30);
    }
  }
  dive.t -= dt;
  if (dive.t <= 0) dive.target = 0;
  const ds = (dive.target ? 9 : 3) * dt;
  dive.off += clamp(dive.target - dive.off, -ds, ds);
  vrG.dt = dt;
  for (const [i, side] of [[0, 'left'], [1, 'right']]) {
    const h = hands[side];
    vrG.prev[i] = vrG.cur[i];
    if (!h.p) { vrG.cur[i] = null; continue; }
    const dx = h.p[0] - head.x;
    vrG.cur[i] = [clamp(head.x + ampX(dx) + dive.off, -4.2, 4.2), ampY(h.p[1]), h.p[2]];
    if (!vrG.prev[i]) vrG.prev[i] = vrG.cur[i];
  }
  vrG.body = { a: [head.x, 0.25, head.z], b: [head.x, Math.max(0.5, head.y - 0.25), head.z] };
}
function vrColliders(f) {
  const spheres = [];
  let cx = 0, cy = 0, n = 0;
  for (let i = 0; i < 2; i++) {
    const a = vrG.prev[i], b = vrG.cur[i];
    if (!b) continue;
    const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    const v = [(b[0] - a[0]) / vrG.dt, (b[1] - a[1]) / vrG.dt, (b[2] - a[2]) / vrG.dt];
    spheres.push({ p, v, r: GLOVE_R + 0.01, tag: `luva${i}` });
    cx += p[0]; cy += p[1]; n++;
  }
  const capsules = vrG.body ? [{ a: vrG.body.a, b: vrG.body.b, r: 0.17, v: [0, 0, 0], e: 0.3, tag: 'corpo' }] : [];
  return { spheres, capsules, center: n ? [cx / n, cy / n] : [vrG.body?.a[0] ?? 0, 1.1] };
}
const gripOff = { left: gloveGripOffset('left'), right: gloveGripOffset('right') };
const FWD_Q = new THREE.Quaternion();
function vrGloveViews(auto) {
  if (auto || mode !== 'defender') {
    if (auto && mode === 'defender') return kb.gloves.map(g => ({ p: g.p, q: FWD_Q }));
    return ['left', 'right'].map(s => hands[s].p ? { p: hands[s].p, q: hands[s].q.clone().multiply(gripOff[s]) } : null);
  }
  return ['left', 'right'].map((s, i) => vrG.cur[i] ? { p: vrG.cur[i], q: hands[s].q.clone().multiply(gripOff[s]) } : null);
}

// Chute no VR: segure o gatilho (ou o aperto), faça o gesto de arremesso e solte.
let armed = null;
function armKick(side) {
  if (app !== 'jogo' || mode !== 'bater' || game.phase !== 'mirar' || dev.autoplay) return;
  armed = side;
  pulse(side, 0.2, 20);
}
function releaseKick(side) {
  if (!side || armed !== side) return;
  armed = null;
  const h = hands[side];
  let best = null;
  for (const s of h.hist) if (time - s.t < 0.15 && (!best || len(s.v) > len(best))) best = s.v;
  if (best && game.kickSwing(best)) pulse(side, 0.9, 70);
  else showMsg('Gesto fraco', 'Puxe a mão para a frente, rápido, e solte o gatilho.', '#ffd25a', 2.2);
}

// ---------- Mouse e teclado (PC) ----------
const mouse = { ndc: new THREE.Vector2(0, -0.1) };
const keys = new Set();
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane();
const hitP = new THREE.Vector3();
const pcTarget = [0, 1.1];
const aim = { x: 0, y: 1.2 };
const charge = { on: false, t: 0, power: 0 };
let curve = 0;
function setMouse(e) {
  mouse.ndc.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
}
// onde o mouse aponta num plano z = cte
function mouseOnPlane(z) {
  raycaster.setFromCamera(mouse.ndc, camera);
  plane.set(new THREE.Vector3(0, 0, 1), -z);
  return raycaster.ray.intersectPlane(plane, hitP) ? [hitP.x, hitP.y] : null;
}
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  setMouse(e);
  if (panel.visible) {
    raycaster.setFromCamera(mouse.ndc, camera);
    const a = panel.actionAt(panel.pick(raycaster.intersectObject(panel.mesh)[0]?.uv));
    if (a) { sfx.click(); a(); }
    return;
  }
  if (app !== 'jogo' || dev.autoplay) return;
  if (mode === 'defender') kb.startDive();
  else if (game.phase === 'mirar') { charge.on = true; charge.t = 0; charge.power = 0; }
});
renderer.domElement.addEventListener('pointermove', setMouse);
window.addEventListener('pointerup', () => {
  if (!charge.on) return;
  charge.on = false;
  const s = swayAt(time, charge.power);
  game.kickAim(aim.x + s[0], aim.y + s[1], charge.power, curve);
});
window.addEventListener('blur', () => { keys.clear(); charge.on = false; });
window.addEventListener('keydown', (e) => {
  sfx.unlock();
  const k = e.key.toLowerCase();
  if (k === 'escape' || k === 'p') { togglePause(); return; }
  if (k === 'f') { save.fps = !save.fps; storeSave(save); return; }
  if (k === ' ') { e.preventDefault(); if (app === 'jogo' && mode === 'defender' && !dev.autoplay) kb.startDive(); return; }
  if (k === 'q') curve = Math.max(-1, curve - 1);
  if (k === 'e') curve = Math.min(1, curve + 1);
});
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  pcCamera();
});
// tremida da mira: cresce com a força (mais força, menos precisão)
function swayAt(t, p) {
  const a = 0.05 + 0.34 * p * p;
  return [(Math.sin(t * 7.3) + Math.sin(t * 3.1 + 1)) * 0.5 * a, (Math.cos(t * 5.9) + Math.sin(t * 2.3)) * 0.5 * a];
}

// ---------- Menus ----------
const statusOf = (i) => {
  const r = save.results[i];
  if (r?.won) return `Venceu (${r.saves} def.)`;
  if (r) return 'Eliminado';
  return i <= save.unlocked ? 'A jogar' : '';
};

function goMenu() {
  app = 'menu';
  newGame(Math.min(save.unlocked, 4));
  showScreen('main');
  updateHint();
}
function showPre(i) {
  mi = clamp(i, 0, 4);
  app = 'pre';
  newGame(mi);
  showScreen('pre');
  updateHint();
}
function startMatch(i) {
  mi = clamp(i, 0, 4);
  newGame(mi);
  app = 'jogo';
  finishTimer = 0; autoNext = 0;
  panel.hide();
  sfx.whistle(1);
  updateHint();
}
function togglePause() {
  if (app === 'jogo') { app = 'pausa'; charge.on = false; showScreen('pause'); }
  else if (app === 'pausa') { app = 'jogo'; panel.hide(); }
  updateHint();
}
function endMatch(won) {
  const prev = save.results[mi];
  save.results[mi] = {
    won: won || !!prev?.won,
    saves: Math.max(game.saves, prev?.saves || 0),
    goals: prev?.won && !won ? prev.goals : game.goals,
  };
  if (won && mi < 4) save.unlocked = Math.max(save.unlocked, mi + 1);
  if (won && mi === 4) save.titles = (save.titles || 0) + 1;
  storeSave(save);
  app = 'fim';
  finishWon = won;
  autoNext = 3;
  showScreen('fim');
  updateHint();
}

function showScreen(name) {
  const vr = renderer.xr.isPresenting;
  if (vr) placePanelVR();
  panel.show((p) => {
    if (name === 'main') {
      p.title('MURALHA', 78, 72);
      p.text('Você é o goleiro do Esperança FC na Copa Noturna.', 512, 142, { size: 28, color: C.dim });
      const next = Math.min(save.unlocked, 4);
      const fresh = !Object.keys(save.results).length;
      p.button(fresh ? 'Começar a copa' : `Continuar: ${TEAMS[next].rodada}`, () => showPre(next), 262, 190, 500, 96, { size: 38, sub: fresh ? null : `contra ${TEAMS[next].name}` });
      p.button('Tabela da copa', () => showScreen('copa'), 262, 304, 500, 78);
      p.button('Como jogar', () => showScreen('help'), 262, 400, 500, 78);
      p.button(`Som: ${save.sound ? 'sim' : 'não'}`, () => { save.sound = !save.sound; sfx.setOn(save.sound); storeSave(save); showScreen('main'); }, 262, 496, 245, 70, { size: 28 });
      p.button(`FPS: ${save.fps ? 'sim' : 'não'}`, () => { save.fps = !save.fps; storeSave(save); showScreen('main'); }, 517, 496, 245, 70, { size: 28 });
      p.text(save.titles ? `Copas ganhas: ${save.titles}` : 'Ainda sem título. Feche o gol!', 512, 612, { size: 26, color: C.gold });
      p.text(vr ? 'Aponte com o controle e aperte o gatilho' : 'No Quest: abra esta página no navegador do óculos e aperte "Entrar em VR"', 512, 668, { size: 22, color: C.dim });
    } else if (name === 'copa') {
      p.title('Copa Noturna', 60, 50);
      TEAMS.forEach((t, i) => {
        p.matchRow(112, 104 + i * 100, 800, 88, {
          round: t.rodada, team: t.name, status: i > save.unlocked ? 'bloqueada' : statusOf(i), color: t.kit.shirt,
          locked: i > save.unlocked, current: i === save.unlocked, action: () => showPre(i),
        });
      });
      p.button('Voltar', () => showScreen('main'), 362, 616, 300, 70, { size: 30 });
    } else if (name === 'pre') {
      const t = TEAMS[mi];
      p.text(t.rodada.toUpperCase(), 512, 52, { size: 26, color: C.dim, bold: true });
      p.title(t.name, 108, 54);
      p.text(`Batedor: ${t.batedor}`, 512, 168, { size: 30, color: C.gold });
      t.desc.forEach((d, i) => p.text(d, 512, 236 + i * 46, { size: 29 }));
      p.text(t.final ? `${t.shots} faltas (pode sofrer até ${t.maxGoals} gols) e depois pênaltis alternados.` : `${t.shots} chutes. Passa de fase quem sofrer no máximo ${t.maxGoals} gols.`, 512, 352, { size: 25, color: C.dim });
      p.text('Olhe o corpo do batedor antes do chute: ele entrega o lado.', 512, 396, { size: 25, color: C.dim });
      p.button('Jogar!', () => startMatch(mi), 262, 446, 500, 100, { size: 42 });
      p.button('Voltar', () => { goMenu(); }, 362, 576, 300, 72, { size: 30 });
    } else if (name === 'help') {
      p.title('Como jogar', 60);
      const rows = vr ? [
        'No gol: as luvas seguem as suas mãos, com braço "esticado".',
        'Estique, abaixe e dê um tranco para o lado: isso é o mergulho.',
        'Bater com a mão indo contra a bola espalma mais forte.',
        'Pênalti: segure o gatilho, faça o gesto de arremesso e solte.',
        'A direção e a força do gesto viram o chute.',
        'A ou X: recentralizar.   B ou Y: pausa.',
        'Antes do chute o corpo do batedor entrega o lado.',
        'Paradinha: espere! Quem se mexe antes leva no outro canto.',
      ] : [
        'No gol: o mouse move as luvas na frente do gol.',
        'Clique ou Espaço: mergulho rápido (depois leva um tempo para levantar).',
        'Pênalti: mire com o mouse, segure o botão para dar força e solte.',
        'Força demais isola a bola. Q/E: efeito para um lado ou outro.',
        'Esc: pausa.   F: mostra o FPS.',
        'Antes do chute o corpo do batedor entrega o lado.',
        'Paradinha: espere! Quem se mexe antes leva no outro canto.',
        'Rebote: depois de espalmar, volte para o meio.',
      ];
      rows.forEach((t, i) => p.text(t, 56, 128 + i * 56, { size: 26, align: 'left' }));
      p.button('Voltar', () => showScreen(app === 'pausa' ? 'pause' : 'main'), 362, 600, 300, 80);
    } else if (name === 'pause') {
      p.title('Pausa', 70);
      p.text(`${TEAMS[mi].rodada}: ${TEAMS[mi].name}`, 512, 135, { size: 30, color: C.dim });
      p.button('Continuar', () => togglePause(), 262, 180, 500, 84);
      p.button('Recomeçar a partida', () => startMatch(mi), 262, 280, 500, 84);
      p.button('Como jogar', () => showScreen('help'), 262, 380, 245, 84, { size: 30 });
      p.button('Recentralizar', () => { recenter(); togglePause(); }, 517, 380, 245, 84, { size: 30, locked: !vr });
      p.button('Menu principal', () => goMenu(), 262, 480, 500, 84);
    } else if (name === 'fim') {
      const t = TEAMS[mi];
      const champ = finishWon && mi === 4;
      p.title(champ ? 'CAMPEÃO!' : finishWon ? 'Classificado!' : 'Eliminado', 74, champ ? 72 : 60);
      if (game.shootout) {
        const s = game.shootout.score;
        p.text(`Pênaltis: ${HOME.name} ${s.nos} x ${s.eles} ${t.name}`, 512, 150, { size: 30 });
        p.text(`Faltas: ${game.saves} defesa(s), ${game.goals} gol(s) sofrido(s)`, 512, 196, { size: 26, color: C.dim });
      } else if (game.def.final) {
        p.text(`Faltas: ${game.saves} defesa(s), ${game.goals} gol(s) sofrido(s)`, 512, 160, { size: 30 });
      } else {
        p.text(`Defesas: ${game.saves}   ·   Gols sofridos: ${game.goals}   ·   Pra fora: ${game.misses}`, 512, 160, { size: 30 });
      }
      p.text(champ ? 'A Esperança FC levanta a taça da Copa Noturna!' : finishWon ? `Próxima: ${TEAMS[mi + 1].rodada} contra ${TEAMS[mi + 1].name}` : `Passa quem sofre no máximo ${t.maxGoals} gols.`, 512, 250, { size: 28, color: champ ? C.gold : C.text });
      if (finishWon && mi < 4) p.button('Próxima partida', () => showPre(mi + 1), 262, 310, 500, 96, { size: 38 });
      else p.button(finishWon ? 'Jogar a final de novo' : 'Tentar de novo', () => startMatch(mi), 262, 310, 500, 96, { size: 36 });
      p.button('Tabela da copa', () => showScreen('copa'), 262, 426, 500, 80);
      p.button('Menu principal', () => goMenu(), 262, 526, 500, 80);
    }
  });
}

// ---------- Eventos do jogo → som, vibração, recados ----------
function showMsg(title, sub = '', color = '#ffffff', t = 2.2) { msg = { title, sub, color, t }; }
function gloveSide(tag) { return tag === 'luva0' ? 'left' : tag === 'luva1' ? 'right' : null; }
function handleEvents() {
  const live = app === 'jogo';
  for (const e of game.events) {
    switch (e.type) {
      case 'lance':
        kb.reset();
        deceived = false;
        if (live) sfx.setExcite(0.15);
        if (live && e.kind === 'bater') showMsg('Sua vez de bater!', renderer.xr.isPresenting ? 'Segure o gatilho, faça o gesto de chute e solte' : 'Mire, segure o botão e solte', '#a6ec5a', 2.2);
        break;
      case 'apito': if (live) { sfx.whistle(1); sfx.setExcite(0.55); } break;
      case 'paradinha': if (live) sfx.setExcite(0.8); break;
      case 'enganou': deceived = true; break;
      case 'chute': if (live) { sfx.kick(e.speed); sfx.setExcite(0.9); } break;
      case 'toque': {
        if (!live) break;
        const side = gloveSide(e.tag);
        if (side) { sfx.glove(e.v); pulse(side, 0.35 + e.v / 30, 40 + e.v * 3); }
        else if (e.tag === 'corpo') { sfx.body(e.v); pulse('left', 0.5, 50); pulse('right', 0.5, 50); }
        else if (e.tag === 'barreira') sfx.wallHit();
        else sfx.glove(e.v);
        break;
      }
      case 'trave': if (live) { sfx.post(e.v); sfx.ooh(); pulse('left', 0.2, 30); pulse('right', 0.2, 30); } break;
      case 'rede': world.net.hit(e.p, e.v); if (live) sfx.net(e.v); break;
      case 'quique': if (live && e.v > 2.5) sfx.bounce(e.v); break;
      case 'rebote': if (live) { sfx.ooh(); showMsg('Rebote!', 'O segundo atacante vem aí', '#ffd25a', 1.2); } break;
      case 'resultado': if (live) resultFeedback(e); break;
      case 'penaltis': if (live) { sfx.whistle(2); showMsg('Decisão por pênaltis!', 'Eles começam. Depois é a sua vez de bater.', '#a6ec5a', 3); } break;
      case 'fim':
        if (live) { sfx.whistle(3, true); finishTimer = 2.4; finishWon = e.won; if (e.won) { sfx.cheer(true); world.crowd.party(1, 5); } }
        break;
    }
  }
}
function resultFeedback(e) {
  sfx.setExcite(0.2);
  const t = game.def;
  if (e.lado === 'eles') {
    if (e.kind === 'gol') { sfx.groan(); showMsg(`Gol do ${t.short}`, deceived ? 'Você se mexeu antes: ele bateu no outro canto.' : '', '#ff6a5a'); }
    else if (e.kind === 'defesa') {
      sfx.cheer(); world.crowd.party(0.7, 2.5);
      showMsg(e.wall && !e.touched ? 'Na barreira!' : 'DEFESA!', e.touched && game.lastTouch?.v > 18 ? 'Que defesaça!' : '', '#a6ec5a');
    } else if (e.kind === 'trave') { sfx.cheer(); showMsg('Na trave!', 'Ufa!', '#ffd25a'); }
    else { sfx.cheer(); showMsg('Pra fora!', '', '#ffd25a'); }
  } else {
    if (e.kind === 'gol') { sfx.cheer(true); world.crowd.party(1, 3); showMsg('GOOOL!', 'Esperança FC!', '#a6ec5a'); }
    else if (e.kind === 'defesa') { sfx.groan(); showMsg('O goleiro pegou!', '', '#ff6a5a'); }
    else if (e.kind === 'trave') { sfx.groan(); showMsg('Na trave!', '', '#ff6a5a'); }
    else { sfx.groan(); showMsg('Pra fora!', game.ball.p[1] > 2.3 ? 'Força demais isola a bola.' : '', '#ff6a5a'); }
  }
}

// ---------- Raios de menu ----------
const rayOrigin = new THREE.Vector3(), rayDir = new THREE.Vector3();
function updateMenuRays() {
  const vr = renderer.xr.isPresenting;
  let hover = -1;
  for (const e of ctrls) {
    e.hoverIndex = -1;
    e.laser.visible = false;
    if (!vr || !e.source || !panel.visible) continue;
    e.ctrl.getWorldPosition(rayOrigin);
    e.ctrl.getWorldQuaternion(_q);
    rayDir.set(0, 0, -1).applyQuaternion(_q);
    raycaster.set(rayOrigin, rayDir);
    const hit = raycaster.intersectObject(panel.mesh)[0];
    e.laser.visible = true;
    e.laser.scale.z = hit ? hit.distance : 1.5;
    e.hoverIndex = panel.pick(hit?.uv);
    if (e.hoverIndex >= 0) hover = e.hoverIndex;
  }
  if (!vr) {
    if (panel.visible) {
      raycaster.setFromCamera(mouse.ndc, camera);
      hover = panel.pick(raycaster.intersectObject(panel.mesh)[0]?.uv);
      renderer.domElement.style.cursor = hover >= 0 && panel.actionAt(hover) ? 'pointer' : 'default';
    } else renderer.domElement.style.cursor = app === 'jogo' ? 'crosshair' : 'default';
  }
  if (panel.visible) panel.setHover(hover);
}

// ---------- HUD ----------
const hintEl = document.getElementById('hint');
const hudEl = document.getElementById('hud');
const bigEl = document.getElementById('big');
const powerEl = document.getElementById('power');
const powerFill = document.getElementById('powerFill');
const fpsEl = document.getElementById('fps');
function updateHint() {
  if (renderer.xr.isPresenting) { hintEl.textContent = ''; return; }
  hintEl.innerHTML = app === 'jogo'
    ? (mode === 'bater'
      ? '<span>Mire com o mouse · Segure o botão para dar força e solte para chutar · Q/E: efeito · Esc: pausa</span>'
      : '<span>Mouse: move as luvas · Clique ou Espaço: mergulho · Esc: pausa</span>')
    : '<span>Clique nas opções do painel</span>';
}
function marks(arr, n) { const m = arr.map(v => (v ? 'good' : 'bad')); while (m.length < n) m.push(null); return m; }
function scoreInfo() {
  const d = game.def;
  if (app === 'menu') return { top: 'COPA NOTURNA', main: 'MURALHA', sub: `${HOME.name} · ${save.titles || 0} título(s)`, rows: [] };
  if (game.stage === 'penaltis') {
    const s = game.shootout, n = Math.max(5, s.eles.length, s.nos.length);
    return {
      top: `${d.rodada.toUpperCase()} · PÊNALTIS`, main: `${HOME.short} ${s.score.nos} x ${s.score.eles} ${d.short}`, sub: '',
      rows: [{ label: HOME.short, marks: marks(s.nos, n) }, { label: d.short, marks: marks(s.eles, n) }],
    };
  }
  const hist = game.history.map(k => (k === 'gol' ? 'bad' : k === 'defesa' ? 'good' : 'neutral'));
  while (hist.length < game.total) hist.push(null);
  return {
    top: `${d.rodada.toUpperCase()} · ${d.name.toUpperCase()}`, main: `DEFESAS ${game.saves}   GOLS ${game.goals}`,
    sub: `${game.lanceLabel} · pode sofrer até ${game.maxGoals}`, rows: [{ label: game.stage === 'faltas' ? 'Faltas' : 'Chutes', marks: hist }],
  };
}
function updateHud(dt) {
  const vr = renderer.xr.isPresenting;
  if (msg) { msg.t -= dt; if (msg.t <= 0) msg = null; }
  const info = scoreInfo();
  telao.set(info);
  const playing = app === 'jogo' || app === 'pausa';
  // mira e força do PC
  const aiming = playing && !vr && mode === 'bater' && game.phase === 'mirar' && !dev.autoplay;
  world.reticle.visible = aiming;
  if (aiming) {
    const s = charge.on ? swayAt(time, charge.power) : [0, 0];
    world.reticle.position.set(aim.x + s[0], aim.y + s[1], -0.06);
    world.reticle.scale.setScalar(1 + charge.power * 0.4);
  }
  powerEl.style.display = aiming ? 'block' : 'none';
  if (aiming) {
    powerFill.style.width = `${Math.round(charge.power * 100)}%`;
    powerFill.style.background = charge.power > 0.85 ? '#ff6a5a' : charge.power > 0.6 ? '#ffd25a' : '#a6ec5a';
    powerEl.dataset.curve = curve ? (curve < 0 ? 'Efeito: ◀' : 'Efeito: ▶') : 'Sem efeito (Q/E)';
  }
  if (!vr) {
    bigLabel.mesh.visible = vrHud.mesh.visible = false;
    hudEl.style.display = playing ? 'block' : 'none';
    if (playing) {
      const d = game.def;
      let html = `<b>${d.rodada} · ${d.name}</b> <em>(batedor: ${d.batedor})</em><br>`;
      if (game.stage === 'penaltis') {
        const s = game.shootout.score;
        html += `Pênaltis: ${HOME.short} ${s.nos} x ${s.eles} ${d.short} · ${mode === 'bater' ? 'você bate' : 'você defende'}`;
      } else html += `${game.lanceLabel} · Defesas <b>${game.saves}</b> · Gols <b>${game.goals}</b> (pode sofrer até ${game.maxGoals})`;
      if (aiming) html += `<br><em>${powerEl.dataset.curve}</em>`;
      if (hudEl.dataset.last !== html) { hudEl.innerHTML = html; hudEl.dataset.last = html; }
    }
    const bh = msg ? `<div style="color:${msg.color}">${msg.title}</div>${msg.sub ? `<small>${msg.sub}</small>` : ''}` : '';
    if (bigEl.dataset.last !== bh) { bigEl.innerHTML = bh; bigEl.dataset.last = bh; }
    return;
  }
  hudEl.style.display = 'none';
  if (bigEl.dataset.last) { bigEl.innerHTML = ''; bigEl.dataset.last = ''; }
  bigLabel.mesh.visible = !!msg && playing;
  if (msg) bigLabel.set([{ text: msg.title, size: 0.55, color: msg.color }, ...(msg.sub ? [{ text: msg.sub, size: 0.25, color: '#ffffff', bold: false }] : [])]);
  vrHud.mesh.visible = playing;
  if (playing) {
    const line2 = mode === 'bater' && game.phase === 'mirar'
      ? 'Segure o gatilho, faça o gesto de chute e solte'
      : info.sub || info.main;
    vrHud.set([{ text: info.main, size: 0.42, color: '#a6ec5a' }, { text: line2, size: 0.3, bold: false }]);
  }
  if (mode === 'bater') {
    bigLabel.mesh.position.set(0, 3.3, -3.2); bigLabel.mesh.rotation.set(0, Math.PI, 0);
    vrHud.mesh.position.set(0, 0.2, -10.4); vrHud.mesh.rotation.set(-0.95, Math.PI, 0);
  } else {
    bigLabel.mesh.position.set(0, 2.5, -5); bigLabel.mesh.rotation.set(0, 0, 0);
    vrHud.mesh.position.set(0, 0.18, -2.3); vrHud.mesh.rotation.set(-0.95, 0, 0);
  }
}

// ---------- Botão de VR ----------
const vrBtn = document.getElementById('vr');
async function setupVR() {
  const ok = navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (!ok) {
    vrBtn.textContent = window.isSecureContext ? 'VR não disponível neste navegador' : 'VR precisa de HTTPS';
    vrBtn.disabled = true;
    return;
  }
  vrBtn.textContent = 'Entrar em VR';
  vrBtn.disabled = false;
  vrBtn.onclick = async () => {
    sfx.unlock();
    if (renderer.xr.isPresenting) { renderer.xr.getSession()?.end(); return; }
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      await renderer.xr.setSession(session);
      vrBtn.textContent = 'Sair do VR';
      session.addEventListener('end', () => { vrBtn.textContent = 'Entrar em VR'; });
    } catch (err) {
      vrBtn.textContent = 'Erro ao entrar em VR';
      console.error(err);
    }
  };
}
setupVR();

// ---------- Laço principal ----------
let acc = 0, lastT = performance.now(), time = 0;
let fpsFrames = 0, fpsTime = 0;

function tick(dt) {
  time += dt;
  const vr = renderer.xr.isPresenting;
  if (recenterIn > 0 && --recenterIn === 0) recenter();
  pollButtons();
  rig.updateMatrixWorld(true);
  const want = game.lanceKind === 'bater' ? 'bater' : 'defender';
  if (want !== mode) { setMode(want); updateHint(); }
  if (vr) readHands(dt);

  const running = app === 'jogo' || app === 'menu' || app === 'pre';
  const auto = app !== 'jogo' || dev.autoplay;
  if (!vr && !auto) {
    if (mode === 'defender') { const t = mouseOnPlane(KEEPER_Z); if (t) { pcTarget[0] = t[0]; pcTarget[1] = t[1]; } }
    else { const t = mouseOnPlane(0); if (t) { aim.x = clamp(t[0], -5, 5); aim.y = clamp(t[1], 0.1, 3.6); } }
  }
  const useVr = vr && !auto && mode === 'defender';
  if (useVr) updateVrGloves(dt);
  if (charge.on) {
    charge.t += dt;
    const p = Math.min(1, charge.t / 1.2);
    if (Math.floor(p * 10) !== Math.floor(charge.power * 10)) sfx.charge(p);
    charge.power = p;
  }

  if (running) {
    acc += dt;
    const n = Math.min(24, Math.floor(acc / DT));
    acc -= n * DT;
    for (let i = 0; i < n; i++) {
      if (game.lanceKind === 'defender') {
        if (useVr) game.setKeeper(vrColliders((i + 1) / n));
        else {
          if (auto) robotK(game, kb); else { kb.target[0] = pcTarget[0]; kb.target[1] = pcTarget[1]; }
          kb.step(DT);
          game.setKeeper(kb.colliders());
        }
      } else if (auto && game.phase === 'mirar' && game.pt > 0.9) {
        const k = robotKick(kickRng);
        game.kickAim(k.x, k.y, k.power, k.curve);
      }
      game.step();
    }
    handleEvents();
  } else acc = 0;
  game.events.length = 0;

  if (finishTimer > 0 && app === 'jogo') { finishTimer -= dt; if (finishTimer <= 0) endMatch(finishWon); }
  if (app === 'fim' && dev.autoplay && autoNext > 0) {
    autoNext -= dt;
    if (autoNext <= 0) { if (finishWon && mi < 4) startMatch(mi + 1); else if (!finishWon) startMatch(mi); }
  }
  // fundo do menu: o robô fica jogando contra o próximo adversário
  if ((app === 'menu' || app === 'pre') && game.state !== 'playing') newGame(game.mi);

  if (app !== 'jogo' && sfx.excite > 0.1) sfx.setExcite(0.1);
  actors.update(game, { vr, kb: vr && !auto ? null : kb, vrGloves: vr ? vrGloveViews(auto) : null, dt, time });
  world.update(dt, time);
  sfx.update();
  updateHud(dt);
  updateMenuRays();

  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    const f = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0; fpsTime = 0;
    fpsEl.style.display = save.fps && !vr ? 'block' : 'none';
    fpsEl.textContent = `${f} FPS`;
    fpsLabel.mesh.visible = save.fps && vr;
    fpsLabel.set(`${f} FPS`);
  }
}

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  tick(dt);
  renderer.render(scene, camera);
}

// ---------- Depuração (console do navegador) ----------
// dev.loadLevel(3)        abre a partida 3 da copa (1 a 5) já valendo
// dev.autoplay = true     o robô joga (defende e bate os pênaltis) e segue para a próxima partida
// dev.advance(20)         avança 20 s de jogo na hora, sem esperar a animação
// dev.state()             resumo: tela, partida, etapa, lance, placar, pênaltis
// dev.shootout()          pula direto para os pênaltis da final
const dev = {
  _auto: false,
  get autoplay() { return this._auto; },
  set autoplay(v) { this._auto = !!v; charge.on = false; armed = null; },
  loadLevel(n) { startMatch(clamp((n | 0) - 1, 0, 4)); return this.state(); },
  advance(sec, step = 1 / 72) {
    const frames = Math.round(sec / step);
    for (let i = 0; i < frames; i++) tick(step);
    lastT = performance.now();
    renderer.render(scene, camera);
    return this.state();
  },
  state() {
    return {
      tela: app, fase: mi + 1, adversario: game.def.name, modo: mode,
      ...game.summary(),
      placar: { defesas: game.saves, gols: game.goals, fora: game.misses, penaltis: game.shootout ? `${HOME.short} ${game.shootout.score.nos} x ${game.shootout.score.eles} ${game.def.short}` : null },
      bola: game.ball.p.map(v => +v.toFixed(2)),
      salvo: { liberadaAte: save.unlocked + 1, titulos: save.titles, resultados: save.results },
    };
  },
  shootout() {
    startMatch(4);
    game.n = game.total;
    game.stage = 'penaltis';
    game.shootout = new Shootout();
    game.startLance();
    return this.state();
  },
  resetSave() { save.unlocked = 0; save.results = {}; save.titles = 0; storeSave(save); return 'progresso apagado'; },
};
window.dev = dev;
window.muralha = { dev, get game() { return game; }, kb, save, startMatch, goMenu, camera, scene, renderer };

pcCamera();
goMenu();
renderer.setAnimationLoop(frame);
