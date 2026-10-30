// Estádio à noite: gramado listrado com as linhas do campo, arquibancadas com torcida animada,
// refletores, placas de LED, telão, gol com rede que balança, bola com rastro e os jogadores
// (montados com peças simples e animados por código). As medidas do gol e da bola vêm de
// physics.js, então o que se vê é o que colide.
import * as THREE from '../vendor/three/three.module.js';
import { BALL_R, GOAL_HW, GOAL_H, POST_R, NET_D } from './physics.js';
import { KEEPER_Z, CPU_Z } from './keeper.js';
import { wallJump } from './game.js';

const HW = GOAL_HW, GH = GOAL_H;

// ---------- utilidades ----------
function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// Junta várias geometrias numa só, com cor por vértice (uma chamada de desenho por material).
class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; }
  add(geo, m, color = '#ffffff') {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv?.array;
    const col = new THREE.Color(color);
    for (let i = 0; i < pa.length / 3; i++) {
      this.p.push(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
      this.n.push(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]);
      this.c.push(col.r, col.g, col.b);
      this.uv.push(ua ? ua[i * 2] : 0, ua ? ua[i * 2 + 1] : 0);
    }
    g.dispose();
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
const BOX = new THREE.BoxGeometry(1, 1, 1);

// textura de brilho redondo (refletores, rastro da bola) e de sombra
function radial(stops) {
  return canvas(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

// ---------- estádio ----------
export function buildScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03060d');
  scene.fog = new THREE.Fog('#070c18', 110, 320);

  // céu com degradê e estrelas
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#010309') }, mid: { value: new THREE.Color('#0b1430') }, glow: { value: new THREE.Color('#2a2440') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 glow; varying vec3 vP;
      void main(){ float h = clamp(vP.y, -0.1, 1.0); vec3 c = mix(mid, top, smoothstep(0.02, 0.55, h));
      c = mix(c, glow, smoothstep(0.18, 0.0, abs(h - 0.02)) * 0.6); gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky);
  {
    const n = 500, pos = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, y = 0.15 + Math.random() * 0.85, r = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * r * 400, y * 400, Math.sin(a) * r * 400);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#c8d4ff', size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false })));
  }

  // luzes: poucas e sem sombra (o Quest agradece)
  scene.add(new THREE.HemisphereLight('#7f90c4', '#1c2c14', 0.9));
  const sun = new THREE.DirectionalLight('#fff3df', 2.3);
  sun.position.set(30, 45, 25); sun.target.position.set(0, 0, -25);
  scene.add(sun, sun.target);
  const back = new THREE.DirectionalLight('#d6e2ff', 1.0);
  back.position.set(-35, 40, -70); back.target.position.set(0, 0, -10);
  scene.add(back, back.target);

  const mats = {
    vc: new THREE.MeshLambertMaterial({ vertexColors: true }),
    white: new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#3a3a3a' }),
  };

  // gramado listrado
  const grassTex = canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#2f7a2c'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#2a6c27'; g.fillRect(0, h / 2, w, h / 2);
    for (let i = 0; i < 9000; i++) {
      const l = 30 + Math.random() * 30;
      g.fillStyle = `hsla(${100 + Math.random() * 25}, 50%, ${l}%, 0.18)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 3 + Math.random() * 4);
    }
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(150 / 12, 170 / 12);
  grassTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(150, 170), new THREE.MeshLambertMaterial({ map: grassTex }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, 0, -52.5);
  scene.add(grass);

  // linhas do campo (uma geometria só)
  {
    const L = new Builder();
    const line = (x1, z1, x2, z2, w = 0.12) => {
      const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz);
      L.add(BOX, M((x1 + x2) / 2, 0.012, (z1 + z2) / 2, 0, Math.atan2(-dz, dx), 0, l + w * 0.5, 0.01, w));
    };
    const arc = (cx, cz, r, a0, a1, n = 40, keep = () => true) => {
      for (let i = 0; i < n; i++) {
        const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
        const x1 = cx + Math.cos(t0) * r, z1 = cz + Math.sin(t0) * r, x2 = cx + Math.cos(t1) * r, z2 = cz + Math.sin(t1) * r;
        if (keep((x1 + x2) / 2, (z1 + z2) / 2)) line(x1, z1, x2, z2);
      }
    };
    line(-34, 0, 34, 0); line(-34, -105, 34, -105);
    line(-34, 0, -34, -105); line(34, 0, 34, -105);
    line(-34, -52.5, 34, -52.5);
    arc(0, -52.5, 9.15, 0, Math.PI * 2, 64);
    for (const [z0, s] of [[0, -1], [-105, 1]]) {
      line(-20.16, z0 + s * 16.5, 20.16, z0 + s * 16.5); line(-20.16, z0, -20.16, z0 + s * 16.5); line(20.16, z0, 20.16, z0 + s * 16.5);
      line(-9.16, z0 + s * 5.5, 9.16, z0 + s * 5.5); line(-9.16, z0, -9.16, z0 + s * 5.5); line(9.16, z0, 9.16, z0 + s * 5.5);
      arc(0, z0 + s * 11, 9.15, 0, Math.PI * 2, 60, (x, z) => (s < 0 ? z < z0 - 16.5 : z > z0 + 16.5));
      arc(0, z0 + s * 11, 0.13, 0, Math.PI * 2, 10);
    }
    for (const [cx, cz, a0] of [[-34, 0, -Math.PI / 2], [34, 0, Math.PI], [-34, -105, 0], [34, -105, Math.PI / 2]]) arc(cx, cz, 1, a0, a0 + Math.PI / 2, 8);
    scene.add(new THREE.Mesh(L.geometry(), new THREE.MeshBasicMaterial({ color: '#d9e4d6' })));
  }

  // gol: traves e travessão brancos, armação de trás cinza
  {
    const P = new Builder();
    const cyl = new THREE.CylinderGeometry(POST_R, POST_R, 1, 16);
    const ph = GH + POST_R * 2;
    P.add(cyl, M(-HW - POST_R, ph / 2, 0, 0, 0, 0, 1, ph, 1));
    P.add(cyl, M(HW + POST_R, ph / 2, 0, 0, 0, 0, 1, ph, 1));
    P.add(cyl, M(0, GH + POST_R, 0, 0, 0, Math.PI / 2, 1, 2 * (HW + POST_R * 2), 1));
    scene.add(new THREE.Mesh(P.geometry(), mats.white));
    const F = new Builder();
    const thin = new THREE.CylinderGeometry(0.025, 0.025, 1, 8);
    const bar = (a, b) => {
      const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      F.add(thin, new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, d.length(), 1)), '#9aa0a8');
    };
    for (const s of [-1, 1]) {
      bar([s * HW, 0, NET_D], [s * HW, GH, NET_D]);
      bar([s * HW, GH, 0.05], [s * HW, GH, NET_D]);
      bar([s * HW, 0.02, 0.05], [s * HW, 0.02, NET_D]);
    }
    bar([-HW, GH, NET_D], [HW, GH, NET_D]);
    bar([-HW, 0.02, NET_D], [HW, 0.02, NET_D]);
    scene.add(new THREE.Mesh(F.geometry(), mats.vc));
  }
  const net = buildNet();
  scene.add(net.mesh);

  // arquibancadas + torcida
  const crowd = buildStands(scene, mats);

  // placas de LED em volta
  const ads = buildAds(scene, mats);

  // refletores: torres nos cantos, painel de lâmpadas e brilho
  const glowTex = radial([[0, 'rgba(255,250,230,1)'], [0.18, 'rgba(255,240,200,0.55)'], [0.5, 'rgba(255,230,180,0.12)'], [1, 'rgba(255,230,180,0)']]);
  const lampTex = canvas(256, 128, (g, w, h) => {
    g.fillStyle = '#20242c'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
      const gr = g.createRadialGradient(16 + x * 32, 16 + y * 32, 0, 16 + x * 32, 16 + y * 32, 14);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#fff4d8'); gr.addColorStop(1, '#5a5440');
      g.fillStyle = gr; g.beginPath(); g.arc(16 + x * 32, 16 + y * 32, 13, 0, Math.PI * 2); g.fill();
    }
  });
  const towers = [[-50, 16], [50, 16], [-50, -121], [50, -121]];
  {
    const T = new Builder();
    const lampMat = new THREE.MeshBasicMaterial({ map: lampTex, toneMapped: false, fog: false });
    for (const [x, z] of towers) {
      T.add(BOX, M(x, 21, z, 0, 0, 0, 1.4, 42, 1.4), '#3a3f48');
      T.add(BOX, M(x + Math.sign(-x) * 0.6, 8, z + Math.sign(-z - 50) * 0.6, 0, 0, 0, 0.5, 16, 0.5), '#30343c');
      const head = new THREE.Group();
      head.position.set(x, 44, z);
      head.lookAt(0, 0, -52);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(13, 6.5, 0.8), new THREE.MeshLambertMaterial({ color: '#2b2f37' }));
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(12.2, 5.8), lampMat);
      panel.position.z = 0.42;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#fff2d0', blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.85 }));
      glow.scale.set(34, 34, 1);
      glow.position.z = 2;
      head.add(frame, panel, glow);
      scene.add(head);
    }
    scene.add(new THREE.Mesh(T.geometry(), mats.vc));
  }

  // bandeirinhas de escanteio
  {
    const B = new Builder();
    for (const [x, z] of [[-34, 0], [34, 0], [-34, -105], [34, -105]]) {
      B.add(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 6), M(x, 0.75, z), '#f0f0f0');
      B.add(BOX, M(x + 0.2, 1.3, z, 0, 0, 0, 0.38, 0.28, 0.01), '#ff7a1a');
    }
    scene.add(new THREE.Mesh(B.geometry(), mats.vc));
  }

  // telão no canto da frente, virado para o gol
  const telaoGroup = new THREE.Group();
  telaoGroup.position.set(-27, 13, -74);
  telaoGroup.lookAt(0, 3, 0);
  {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(23.4, 9.4, 0.8), new THREE.MeshLambertMaterial({ color: '#1c2028' }));
    fr.position.z = -0.45;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 13, 1.2), new THREE.MeshLambertMaterial({ color: '#2a2e36' }));
    leg.position.set(0, -10, -0.8);
    telaoGroup.add(fr, leg);
  }
  scene.add(telaoGroup);

  // bola: textura de gomos, rastro de luz e sombras dos 4 refletores
  const ballTex = canvas(512, 256, (g, w, h) => {
    g.fillStyle = '#f6f6f2'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 4; k++) {
      g.strokeStyle = k % 2 ? '#ff7a1a' : '#1b2a5a'; g.lineWidth = 16;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = h / 2 + Math.sin(x / w * Math.PI * 4 + k * 1.6) * 70 * (k % 2 ? 0.6 : 1);
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    g.fillStyle = '#1b2a5a';
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(40 + k * 86, k % 2 ? 40 : 216, 18, 0, Math.PI * 2); g.fill(); }
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 18), new THREE.MeshLambertMaterial({ map: ballTex, emissive: '#3a3a3a' }));
  scene.add(ball);
  const trailN = 16;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(trailN * 3).fill(0), 3));
  const trailMat = new THREE.PointsMaterial({ size: 0.2, map: glowTex, color: '#fff0c8', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
  const trail = new THREE.Points(trailGeo, trailMat);
  trail.frustumCulled = false;
  scene.add(trail);
  const shadowTex = radial([[0, 'rgba(0,0,0,0.85)'], [0.55, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']]);
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mkShadow = (op) => {
    const m = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: op }));
    m.renderOrder = 1;
    scene.add(m);
    return m;
  };
  const ballShadows = towers.map(() => mkShadow(0.22));

  // mira do PC na hora de bater
  const reticle = new THREE.Group();
  {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffd25a', side: THREE.DoubleSide, depthTest: false, transparent: true, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.23, 32), mat);
    const h = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.03), mat), v = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.5), mat);
    reticle.add(ring, h, v);
    reticle.children.forEach(c => { c.renderOrder = 12; });
    reticle.visible = false;
    scene.add(reticle);
  }

  return {
    scene, mats, net, crowd, ads, ball, trail, trailN, ballShadows, towers, reticle, telaoGroup, mkShadow, glowTex,
    update(dt, time) {
      net.update(dt, time);
      crowd.update(dt, time);
      ads.update(dt);
    },
  };
}

// Rede: quatro superfícies em grade (fundo, teto, lados) que se deformam onde a bola bate.
function buildNet() {
  const tex = canvas(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 2); g.lineTo(w, 2); g.moveTo(2, 0); g.lineTo(2, h); g.stroke();
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  const cell = 0.14;
  const surfaces = [
    { o: [-HW, 0, NET_D], u: [2 * HW, 0, 0], v: [0, GH, 0], n: [0, 0, 1] },
    { o: [-HW, GH, 0.02], u: [2 * HW, 0, 0], v: [0, 0, NET_D - 0.02], n: [0, 1, 0] },
    { o: [-HW, 0, 0.02], u: [0, 0, NET_D - 0.02], v: [0, GH, 0], n: [-1, 0, 0] },
    { o: [HW, 0, 0.02], u: [0, 0, NET_D - 0.02], v: [0, GH, 0], n: [1, 0, 0] },
  ];
  const pos = [], uv = [], idx = [], nor = [], wt = [];
  for (const S of surfaces) {
    const lu = Math.hypot(...S.u), lv = Math.hypot(...S.v);
    const nu = Math.ceil(lu / 0.25), nv = Math.ceil(lv / 0.25);
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const a = i / nu, b = j / nv;
      pos.push(S.o[0] + S.u[0] * a + S.v[0] * b, S.o[1] + S.u[1] * a + S.v[1] * b, S.o[2] + S.u[2] * a + S.v[2] * b);
      uv.push(a * lu / cell, b * lv / cell);
      nor.push(...S.n);
      wt.push(Math.sin(Math.PI * a) * Math.sin(Math.PI * b));
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = base + j * (nu + 1) + i;
      idx.push(k, k + 1, k + nu + 1, k + 1, k + nu + 2, k + nu + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const basePos = Float32Array.from(pos);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: '#e6ebf0', transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, opacity: 0.9 }));
  mesh.frustumCulled = false;
  const bulges = [];
  return {
    mesh,
    hit(p, v) {
      bulges.push({ p: p.slice(), amp: Math.min(0.5, 0.025 * v), t: 0 });
      if (bulges.length > 4) bulges.shift();
    },
    update(dt, time) {
      for (const b of bulges) b.t += dt;
      while (bulges.length && bulges[0].t > 3) bulges.shift();
      const arr = geo.attributes.position.array;
      for (let i = 0; i < arr.length / 3; i++) {
        const x = basePos[i * 3], y = basePos[i * 3 + 1], z = basePos[i * 3 + 2];
        let d = 0.012 * Math.sin(time * 1.3 + x * 1.7 + y * 0.9 + z);
        for (const b of bulges) {
          const dd = (x - b.p[0]) ** 2 + (y - b.p[1]) ** 2 + (z - b.p[2]) ** 2;
          d += b.amp * Math.exp(-dd / 0.45) * Math.exp(-2.2 * b.t) * Math.cos(10 * b.t);
        }
        d *= wt[i];
        arr[i * 3] = x + nor[i * 3] * d; arr[i * 3 + 1] = y + nor[i * 3 + 1] * d; arr[i * 3 + 2] = z + nor[i * 3 + 2] * d;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// Arquibancadas em degraus com a torcida em faixas (shader: pulam quando o estádio vibra).
function buildStands(scene, mats) {
  const crowdTex = canvas(1024, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const shirts = ['#ff7a1a', '#ff7a1a', '#ff7a1a', '#151515', '#151515', '#f2f2f2', '#ffb04a', '#2a4fa0', '#c83030', '#3aa04a', '#e8d020'];
    const skins = ['#f1c9a5', '#d9a77e', '#b97a4e', '#8a5a3a', '#5e3b24'];
    for (let i = 0; i < 74; i++) {
      const x = 7 + i * 13.7 + (Math.random() - 0.5) * 4;
      const top = 44 + Math.random() * 14;
      const shirt = shirts[Math.floor(Math.random() * shirts.length)];
      g.fillStyle = shirt;
      g.beginPath(); g.ellipse(x, top + 50, 8, 40, 0, 0, Math.PI * 2); g.fill();
      if (Math.random() < 0.3) { g.strokeStyle = shirt; g.lineWidth = 4; g.beginPath(); g.moveTo(x - 6, top + 22); g.lineTo(x - 12, top - 14); g.moveTo(x + 6, top + 22); g.lineTo(x + 12, top - 14); g.stroke(); }
      g.fillStyle = skins[Math.floor(Math.random() * skins.length)];
      g.beginPath(); g.arc(x, top, 7, 0, Math.PI * 2); g.fill();
      if (Math.random() < 0.05) { g.fillStyle = Math.random() < 0.5 ? '#ff7a1a' : '#f2f2f2'; g.fillRect(x - 2, top - 44, 26, 16); g.fillStyle = '#ccc'; g.fillRect(x - 3, top - 44, 2, 40); }
    }
  });
  crowdTex.wrapS = THREE.RepeatWrapping;
  const S = new Builder(), Lgt = new Builder();
  const cp = [], cuv = [], cseed = [], cidx = [];
  const stands = [
    { a: [-44, 8], b: [44, 8], o: [0, 1] },
    { a: [-42, 7], b: [-42, -112], o: [-1, 0] },
    { a: [42, 7], b: [42, -112], o: [1, 0] },
    { a: [-44, -114], b: [44, -114], o: [0, -1] },
  ];
  const rows = 18, depth = 1.15, rise = 0.62, base = 2.2;
  for (const st of stands) {
    const dx = st.b[0] - st.a[0], dz = st.b[1] - st.a[1], L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, ox = st.o[0], oz = st.o[1];
    const yaw = Math.atan2(-uz, ux);
    const mid = [(st.a[0] + st.b[0]) / 2, (st.a[1] + st.b[1]) / 2];
    // muro da frente
    S.add(BOX, M(mid[0] - ox * 0.2, base / 2, mid[1] - oz * 0.2, 0, yaw, 0, L, base, 0.4), '#262b36');
    for (let k = 0; k < rows; k++) {
      const y = base + k * rise;
      const off = k * depth + depth / 2;
      S.add(BOX, M(mid[0] + ox * off, y / 2, mid[1] + oz * off, 0, yaw, 0, L, y, depth), k % 2 ? '#3c4352' : '#343a48');
      // torcida: pedaços de ~8 m com corredores
      const segs = Math.floor(L / 8.6);
      for (let s = 0; s < segs; s++) {
        if (Math.random() < 0.06) continue;
        const t0 = s * 8.6 + 0.6, t1 = t0 + 8.0;
        const fx = st.a[0] + ux * t0 + ox * (k * depth + 0.45), fz = st.a[1] + uz * t0 + oz * (k * depth + 0.45);
        const gx = st.a[0] + ux * t1 + ox * (k * depth + 0.45), gz = st.a[1] + uz * t1 + oz * (k * depth + 0.45);
        const i0 = cp.length / 3, seed = Math.random(), u0 = Math.random() * 10;
        cp.push(fx, y, fz, gx, y, gz, gx, y + 0.95, gz, fx, y + 0.95, fz);
        cuv.push(u0, 0, u0 + 0.8, 0, u0 + 0.8, 1, u0, 1);
        cseed.push(seed, seed, seed, seed);
        cidx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      }
    }
    // paredão do fundo, cobertura e faixa de luz embaixo da cobertura
    const top = base + rows * rise, back = rows * depth;
    S.add(BOX, M(mid[0] + ox * (back + 0.3), (top + 4) / 2, mid[1] + oz * (back + 0.3), 0, yaw, 0, L, top + 4, 0.6), '#1d2129');
    S.add(BOX, M(mid[0] + ox * (back - 6), top + 6, mid[1] + oz * (back - 6), 0, yaw, 0, L + 2, 0.5, 14), '#171a21');
    Lgt.add(BOX, M(mid[0] + ox * (back - 12.6), top + 5.6, mid[1] + oz * (back - 12.6), 0, yaw, 0, L, 0.25, 0.5), '#fff6e0');
  }
  scene.add(new THREE.Mesh(S.geometry(), mats.vc));
  scene.add(new THREE.Mesh(Lgt.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(cseed, 1));
  geo.setIndex(cidx);
  geo.computeBoundingSphere();
  const uniforms = { map: { value: crowdTex }, uTime: { value: 0 }, uAmp: { value: 0.15 }, uBright: { value: 0.85 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.DoubleSide,
    vertexShader: `uniform float uTime; uniform float uAmp; attribute float aSeed; varying vec2 vUv; varying float vShade;
      void main(){ vUv = uv; vec3 p = position;
        float j = max(0.0, sin(uTime * (7.0 + aSeed * 4.0) + aSeed * 40.0));
        p.y += uAmp * j * 0.35 + 0.03 * sin(uTime * 1.7 + aSeed * 20.0);
        vShade = 0.7 + 0.3 * fract(aSeed * 7.13);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float uBright; varying vec2 vUv; varying float vShade;
      void main(){ vec4 c = texture2D(map, vUv); if (c.a < 0.45) discard; gl_FragColor = vec4(c.rgb * vShade * uBright, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  let amp = 0.15, target = 0.15;
  return {
    // nível de festa: 0 = sentados, 1 = pulando
    party(v, dur = 2.5) { target = 0.15 + v; this.until = dur; },
    until: 0,
    update(dt, time) {
      uniforms.uTime.value = time;
      if (this.until > 0) { this.until -= dt; if (this.until <= 0) target = 0.15; }
      amp += (target - amp) * Math.min(1, dt * 4);
      uniforms.uAmp.value = amp;
    },
  };
}

// Placas de LED atrás do gol e dos lados (marcas inventadas), com a imagem correndo.
function buildAds(scene, mats) {
  const brands = [
    ['CAFÉ SERRANO', '#3a1d0e', '#ffcf7a'], ['PNEUS TATU', '#111111', '#ffd400'], ['MURALHA', '#0b1a10', '#a6ec5a'],
    ['SUCO DE MANGABA', '#ff7a1a', '#1a1a1a'], ['ESPERANÇA FC', '#151515', '#ff7a1a'], ['RÁDIO ARQUIBANCADA', '#14306a', '#ffffff'],
    ['GELADINHO DA VILA', '#d0204a', '#ffffff'], ['FARINHA BOA', '#f2f2f2', '#2a6a2a'],
  ];
  const tex = canvas(2048, 64, (g, w, h) => {
    const bw = w / brands.length;
    brands.forEach(([t, bg, fg], i) => {
      g.fillStyle = bg; g.fillRect(i * bw, 0, bw, h);
      g.fillStyle = fg; g.font = 'bold 38px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(t, i * bw + bw / 2, h / 2 + 2);
    });
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const B = new Builder();
  const boards = [
    { x: 0, z: 3.4, len: 60, yaw: Math.PI },          // atrás do gol (de frente para o campo)
    { x: -36.5, z: -22, len: 44, yaw: Math.PI / 2 },
    { x: 36.5, z: -22, len: 44, yaw: -Math.PI / 2 },
    { x: 0, z: -108.5, len: 60, yaw: 0 },
  ];
  const back = new Builder();
  for (const b of boards) {
    const g = new THREE.PlaneGeometry(b.len, 0.9);
    const uvs = g.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) * b.len / 30);
    B.add(g, M(b.x, 0.5, b.z, 0, b.yaw, 0));
    back.add(BOX, M(b.x - Math.sin(b.yaw) * 0.08, 0.5, b.z - Math.cos(b.yaw) * 0.08, 0, b.yaw, 0, b.len, 1.0, 0.12), '#15181e');
  }
  const geo = B.geometry();
  geo.deleteAttribute('color');
  scene.add(new THREE.Mesh(geo, mat));
  scene.add(new THREE.Mesh(back.geometry(), mats.vc));
  return { update(dt) { tex.offset.x = (tex.offset.x + dt * 0.02) % 1; } };
}

// ---------- jogadores ----------
// Cada parte é uma malha com cor por vértice; as juntas são grupos. O jogador olha para +z.
const geoCache = new Map();
function partGeo(key, build) {
  if (!geoCache.has(key)) geoCache.set(key, build());
  return geoCache.get(key);
}
const playerMat = new THREE.MeshLambertMaterial({ vertexColors: true });
// o seu goleiro no PC fica meio transparente, para você ver a bola e as luvas através dele
const ghostMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false });
const myGloveMat = new THREE.MeshLambertMaterial({ vertexColors: true });

export function makePlayer(kit, { keeper = false, ghost = false } = {}) {
  const k = `${kit.shirt}|${kit.shorts}|${kit.socks}|${kit.skin}|${kit.hair}|${kit.trim}|${keeper}`;
  const cyl = (rt, rb, h) => new THREE.CylinderGeometry(rt, rb, h, 10);
  const sph = (r) => new THREE.SphereGeometry(r, 14, 10);
  const pelvis = partGeo(k + 'pel', () => new Builder().add(BOX, M(0, 0, 0, 0, 0, 0, 0.34, 0.22, 0.22), kit.shorts).geometry());
  const chest = partGeo(k + 'che', () => new Builder()
    .add(BOX, M(0, 0.3, 0, 0, 0, 0, 0.42, 0.52, 0.24), kit.shirt)
    .add(BOX, M(0, 0.57, 0, 0, 0, 0, 0.2, 0.04, 0.2), kit.trim)
    .add(BOX, M(0, 0.06, 0, 0, 0, 0, 0.43, 0.06, 0.25), kit.trim)
    .add(sph(0.075), M(0.21, 0.5, 0), kit.shirt).add(sph(0.075), M(-0.21, 0.5, 0), kit.shirt).geometry());
  const head = partGeo(k + 'hea', () => new Builder()
    .add(cyl(0.05, 0.055, 0.12), M(0, 0.04, 0), kit.skin)
    .add(sph(0.115), M(0, 0.18, 0.01, 0, 0, 0, 1, 1.08, 1), kit.skin)
    .add(sph(0.12), M(0, 0.235, -0.015, 0, 0, 0, 1, 0.62, 1.02), kit.hair).geometry());
  const upper = partGeo(k + 'upp', () => new Builder()
    .add(cyl(0.065, 0.06, 0.15), M(0, -0.07, 0), kit.shirt)
    .add(cyl(0.048, 0.044, 0.17), M(0, -0.21, 0), keeper ? kit.shirt : kit.skin).geometry());
  const fore = partGeo(k + 'for', () => new Builder()
    .add(cyl(0.043, 0.036, 0.25), M(0, -0.125, 0), keeper ? kit.shirt : kit.skin)
    .add(sph(0.05), M(0, -0.29, 0, 0, 0, 0, 0.9, 1.2, 0.6), keeper ? '#b6f23a' : kit.skin).geometry());
  const thigh = partGeo(k + 'thi', () => new Builder()
    .add(cyl(0.09, 0.08, 0.22), M(0, -0.1, 0), kit.shorts)
    .add(cyl(0.07, 0.06, 0.24), M(0, -0.32, 0), kit.skin).geometry());
  const shin = partGeo(k + 'shi', () => new Builder()
    .add(cyl(0.062, 0.045, 0.42), M(0, -0.2, 0), kit.socks)
    .add(BOX, M(0, -0.44, 0.045, 0, 0, 0, 0.1, 0.08, 0.26), '#141414').geometry());

  const mat = ghost ? ghostMat : playerMat;
  const root = new THREE.Group();
  const tilt = new THREE.Group(); tilt.position.y = 0.93;
  const hips = new THREE.Group();
  hips.add(new THREE.Mesh(pelvis, mat));
  const torso = new THREE.Group();
  torso.add(new THREE.Mesh(chest, mat));
  const neck = new THREE.Group(); neck.position.y = 0.6;
  neck.add(new THREE.Mesh(head, mat));
  torso.add(neck);
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * 0.25, 0.5, 0);
    sh.add(new THREE.Mesh(upper, mat));
    const el = new THREE.Group(); el.position.y = -0.29;
    el.add(new THREE.Mesh(fore, mat));
    sh.add(el); torso.add(sh);
    return [sh, el];
  };
  const leg = (s) => {
    const hp = new THREE.Group(); hp.position.set(s * 0.1, -0.06, 0);
    hp.add(new THREE.Mesh(thigh, mat));
    const kn = new THREE.Group(); kn.position.y = -0.44;
    kn.add(new THREE.Mesh(shin, mat));
    hp.add(kn); hips.add(hp);
    return [hp, kn];
  };
  const [armL, elbowL] = arm(1), [armR, elbowR] = arm(-1);
  const [legL, kneeL] = leg(1), [legR, kneeR] = leg(-1);
  hips.add(torso);
  tilt.add(hips);
  root.add(tilt);
  return { root, tilt, hips, torso, neck, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR };
}

// Aplica uma pose (ângulos em radianos; frente = -x nas pernas/braços).
export function pose(P, o) {
  P.tilt.position.y = 0.93 + (o.hipY || 0);
  P.tilt.rotation.set(0, 0, o.roll || 0);
  P.hips.rotation.set(0, o.hipYaw || 0, 0);
  P.torso.rotation.set(o.lean || 0, o.twist || 0, 0);
  P.neck.rotation.set(o.nod || 0, o.look || 0, 0);
  P.armL.rotation.set(o.aLx || 0, 0, o.aLz ?? 0.12); P.armL.scale.set(1, 1, 1);
  P.armR.rotation.set(o.aRx || 0, 0, o.aRz ?? -0.12); P.armR.scale.set(1, 1, 1);
  P.elbowL.rotation.set(o.eL ?? -0.2, 0, 0);
  P.elbowR.rotation.set(o.eR ?? -0.2, 0, 0);
  P.legL.rotation.set(o.lL || 0, 0, o.lLz || 0);
  P.legR.rotation.set(o.lR || 0, 0, o.lRz || 0);
  P.kneeL.rotation.set(o.kL || 0, 0, 0);
  P.kneeR.rotation.set(o.kR || 0, 0, 0);
}

export function runPose(ph, amp = 1) {
  const s = Math.sin(ph);
  return {
    lL: -s * 0.85 * amp, lR: s * 0.85 * amp,
    kL: Math.max(0, Math.sin(ph + 1.7)) * 1.4 * amp + 0.1, kR: Math.max(0, Math.sin(ph + 1.7 + Math.PI)) * 1.4 * amp + 0.1,
    aLx: s * 0.8 * amp, aRx: -s * 0.8 * amp, eL: -1.3, eR: -1.3,
    lean: 0.22 * amp, hipY: -Math.abs(Math.cos(ph)) * 0.05 * amp,
  };
}

// Braço que aponta para um ponto do mundo (goleiros: mãos nas luvas).
const _a = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
export function aimArm(arm, elbow, target) {
  arm.parent.updateWorldMatrix(true, false);
  arm.getWorldPosition(_a);
  _d.set(target[0] - _a.x, target[1] - _a.y, target[2] - _a.z);
  const L = _d.length();
  arm.parent.getWorldQuaternion(_q).invert();
  _d.applyQuaternion(_q).normalize();
  arm.quaternion.setFromUnitVectors(DOWN, _d);
  elbow.rotation.set(0, 0, 0);
  arm.scale.set(1, Math.max(0.6, Math.min(1.9, (L - 0.05) / 0.6)), 1);
}

// Luva de goleiro: dedos para +y, palma para -z. thumb: lado do polegar (+1/-1).
export function makeGlove(thumb = 1, color = '#b6f23a', mat = playerMat) {
  const B = new Builder();
  B.add(new THREE.SphereGeometry(0.075, 14, 10), M(0, 0, 0, 0, 0, 0, 1, 1.05, 0.5), color);
  B.add(BOX, M(0, -0.02, 0.03, 0, 0, 0, 0.12, 0.1, 0.03), '#141414');
  for (let i = 0; i < 4; i++) B.add(BOX, M(-0.045 + i * 0.03, 0.105 + (i === 1 || i === 2 ? 0.012 : 0), 0, 0, 0, 0, 0.027, 0.09, 0.04), color);
  B.add(BOX, M(thumb * 0.075, 0.01, -0.01, 0, 0, -thumb * 0.7, 0.03, 0.08, 0.04), color);
  B.add(new THREE.CylinderGeometry(0.052, 0.055, 0.07, 12), M(0, -0.095, 0), '#141414');
  const m = new THREE.Mesh(B.geometry(), mat);
  m.renderOrder = 5;
  return m;
}
// Rotação fixa para a luva seguir o controle do VR (dedos para a frente, palma para dentro).
export function gloveGripOffset(side) {
  const m = new THREE.Matrix4();
  if (side === 'right') m.makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
  else m.makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// ---------- atores da partida (sincroniza com o estado do jogo a cada quadro) ----------
export function buildActors(world) {
  const { scene } = world;
  const shadowOf = () => world.mkShadow(0.5);
  let set = null;
  const keeperKit = { shirt: '#1d2b4a', trim: '#b6f23a', shorts: '#1d2b4a', socks: '#1d2b4a', skin: '#c99068', hair: '#20140c' };
  const me = makePlayer(keeperKit, { keeper: true, ghost: true });
  me.root.traverse(o => { if (o.isMesh) o.renderOrder = 4; });
  me.shadow = shadowOf();
  scene.add(me.root);
  const myGloves = [makeGlove(1, '#b6f23a', myGloveMat), makeGlove(-1, '#b6f23a', myGloveMat)];
  const cpuGloves = [makeGlove(1, '#ff4fa0'), makeGlove(-1, '#ff4fa0')];
  scene.add(...myGloves, ...cpuGloves);

  function setTeam(def) {
    if (set) for (const p of set.all) { scene.remove(p.root); scene.remove(p.shadow); }
    const kit = def.kit;
    const cpuKit = { shirt: '#3a3a44', trim: '#ff4fa0', shorts: '#3a3a44', socks: '#3a3a44', skin: kit.skin, hair: kit.hair };
    const mk = (k, o) => { const p = makePlayer(k, o); p.shadow = shadowOf(); scene.add(p.root); return p; };
    const kit2 = { ...kit, skin: '#8a5a3a', hair: '#111' };
    set = { shooter: mk(kit), shooter2: mk(kit2), wall: [0, 1, 2, 3].map(i => mk({ ...kit, skin: ['#d9a77e', '#8a5a3a', '#b97a4e', '#f1c9a5'][i] })), cpu: mk(cpuKit, { keeper: true }) };
    set.all = [set.shooter, set.shooter2, ...set.wall, set.cpu];
  }

  const place = (P, x, z, yaw, y = 0) => {
    P.root.visible = true;
    P.root.position.set(x, y, z);
    P.root.rotation.set(0, yaw, 0);
    P.shadow.visible = true;
    P.shadow.position.set(x, 0.014, z);
    P.shadow.scale.setScalar(0.9 - Math.min(0.4, y));
  };
  const hide = (P) => { P.root.visible = false; P.shadow.visible = false; };

  // pose do batedor conforme a fase do lance (com a "dica" do corpo antes do chute)
  function shooterPose(P, S, game, isMain) {
    const tell = isMain ? game.plan.tell || 0 : 0;
    const ph = S.dist * Math.PI / 1.05;
    let o;
    if (S.anim === 'run') {
      o = runPose(ph, 1);
      if (isMain && game.phase === 'corrida') {
        const u = game.pt / 1.15;
        const k = Math.max(0, (u - 0.55) / 0.45);
        o.twist = tell * 0.22 * k; o.look = tell * 0.3 * k; o.hipYaw = tell * 0.12 * k;
        if (u > 0.78 && !game.plan.paradinha) { const b = (u - 0.78) / 0.22; o.lR = 0.9 * b; o.kR = 1.5 * b; o.aLz = 0.7 * b; o.aRz = -0.5 * b; }
      }
    } else if (S.anim === 'stop') {
      const t = S.at;
      o = { lL: -0.15, lR: 0.25, kL: 0.25, kR: 0.4, aLz: 0.45, aRz: -0.35, lean: 0.1 + 0.04 * Math.sin(t * 6), look: tell * 0.25, twist: tell * 0.12 * Math.sin(t * 3) };
    } else if (S.anim === 'kick') {
      const u = Math.min(1, S.at / 0.5);
      const sw = u < 0.25 ? u / 0.25 : 1;
      o = { lR: 0.9 - 2.4 * sw + (u > 0.6 ? (u - 0.6) * 2 : 0), kR: 1.5 * (1 - sw) + 0.1, lL: -0.1, kL: 0.3, aLz: 0.8, aRz: -0.6, aRx: -0.5 * sw, lean: -0.15 * sw, twist: tell * 0.15 };
    } else if (S.anim === 'celebrate') {
      const t = S.at;
      o = { aLz: 2.6, aRz: -2.6, eL: -0.3, eR: -0.3, lL: -0.2, kL: 0.4, hipY: 0, look: Math.sin(t * 4) * 0.3 };
      return { o, y: Math.abs(Math.sin(t * 7)) * 0.22 };
    } else if (S.anim === 'sad') {
      o = { aLx: -2.7, aRx: -2.7, eL: -1.6, eR: -1.6, aLz: 0.5, aRz: -0.5, lean: 0.25, nod: 0.3 };
    } else {
      const t = S.at;
      o = { aLz: 0.15, aRz: -0.15, lean: 0.04 * Math.sin(t * 2), look: 0, lL: 0.05, lR: -0.05 };
    }
    return { o, y: 0 };
  }

  const tmpTrail = [];
  let trailT = 0;

  return {
    setTeam,
    // view: { vr, kb (corpo do PC/robô ou null), vrGloves ([{p, q}] ou null), dt, time }
    update(game, view) {
      if (!set || set.team !== game.def) { setTeam(game.def); set.team = game.def; }
      const { dt, time } = view;
      // bola
      const b = game.ball;
      world.ball.position.set(b.p[0], b.p[1], b.p[2]);
      const ground = b.p[1] <= BALL_R + 0.002;
      const wx = b.w[0] + (ground ? b.v[2] / BALL_R : 0), wy = b.w[1], wz = b.w[2] + (ground ? -b.v[0] / BALL_R : 0);
      const wl = Math.hypot(wx, wy, wz);
      if (wl > 1e-3) world.ball.rotateOnWorldAxis(_a.set(wx / wl, wy / wl, wz / wl), Math.min(wl * dt, 1));
      // rastro
      const sp = Math.hypot(...b.v);
      trailT += dt;
      if (trailT > 1 / 60) {
        trailT = 0;
        tmpTrail.unshift(b.p.slice());
        if (tmpTrail.length > world.trailN) tmpTrail.pop();
      }
      const arr = world.trail.geometry.attributes.position.array;
      for (let i = 0; i < world.trailN; i++) { const p = tmpTrail[i] || b.p; arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2]; }
      world.trail.geometry.attributes.position.needsUpdate = true;
      world.trail.material.opacity = Math.max(0, Math.min(0.55, (sp - 9) / 25));
      // sombras da bola, uma por refletor
      const h = b.p[1] - BALL_R;
      world.towers.forEach(([tx, tz], i) => {
        const dx = b.p[0] - tx, dz = b.p[2] - tz, l = Math.hypot(dx, dz) || 1;
        const s = world.ballShadows[i];
        s.position.set(b.p[0] + dx / l * h * 0.9, 0.013 + i * 0.0005, b.p[2] + dz / l * h * 0.9);
        s.scale.setScalar(0.3 + h * 0.15);
        s.material.opacity = 0.24 / (1 + h * 0.6);
      });

      // batedor e segundo atacante
      if (game.shooter && game.lanceKind === 'defender') {
        const S = game.shooter;
        const { o, y } = shooterPose(set.shooter, S, game, true);
        place(set.shooter, S.p[0], S.p[1], S.yaw, y);
        pose(set.shooter, o);
      } else hide(set.shooter);
      if (game.shooter2) {
        const S = game.shooter2;
        const { o, y } = shooterPose(set.shooter2, S, game, false);
        place(set.shooter2, S.p[0], S.p[1], S.yaw, y);
        pose(set.shooter2, o);
      } else hide(set.shooter2);

      // barreira: olha para a bola, mãos protegendo, pula no chute
      set.wall.forEach((P, i) => {
        const m = game.wall[i];
        if (!m) return hide(P);
        const j = game.since >= 0 ? wallJump(game.since) : 0;
        const yaw = Math.atan2(game.plan.from[0] - m.x, game.plan.from[2] - m.z);
        place(P, m.x, m.z, yaw, j);
        pose(P, { aLx: -0.35, aRx: -0.35, aLz: -0.3, aRz: 0.3, eL: -0.7, eR: -0.7, lL: j > 0.05 ? -0.3 : 0, lR: j > 0.05 ? -0.3 : 0, kL: j > 0.05 ? 0.7 : 0.05, kR: j > 0.05 ? 0.7 : 0.05, look: Math.sin(time * 2 + i) * 0.1, nod: 0.1 });
      });

      // goleiro do computador (nas suas cobranças)
      if (game.cpu) {
        const K = game.cpu, bp = K.bodyPoints();
        place(set.cpu, bp.hip[0], CPU_Z + 0.08, Math.PI, 0);
        const roll = Math.atan2(K.c[0] - bp.hip[0], 0.9 + Math.max(0, K.c[1] - bp.hip[1]));
        pose(set.cpu, { hipY: bp.hip[1] - 0.93, roll, kL: 0.5 - K.dive * 0.4, kR: 0.5 - K.dive * 0.4, lL: -0.35, lR: -0.35, lLz: 0.15, lRz: -0.15, lean: 0.15 * (1 - K.dive) });
        aimArm(set.cpu.armL, set.cpu.elbowL, K.gloves[0].p);
        aimArm(set.cpu.armR, set.cpu.elbowR, K.gloves[1].p);
        K.gloves.forEach((g, i) => { const m = cpuGloves[i]; m.visible = true; m.position.set(...g.p); m.rotation.set(0, 0, -roll * 0.6); });
      } else { hide(set.cpu); cpuGloves.forEach(m => { m.visible = false; }); }

      // seu goleiro: no PC aparece de corpo inteiro; no VR só as luvas (nas suas mãos)
      const kb = view.kb;
      myGloveMat.depthTest = !!view.vr;   // no PC as luvas aparecem por cima do corpo
      world.net.mesh.material.opacity = !view.vr && game.lanceKind === 'defender' ? 0.32 : 0.9;
      if (kb && game.lanceKind === 'defender' && !view.vr) {
        const bp = kb.bodyPoints();
        place(me, bp.hip[0], KEEPER_Z + 0.1, Math.PI, 0);
        const roll = Math.atan2(kb.c[0] - bp.hip[0], 0.9 + Math.max(0, kb.c[1] - bp.hip[1]));
        const crouch = kb.c[1] < 0.8 ? (0.8 - kb.c[1]) * 0.5 : 0;
        const dv = Math.min(1, Math.abs(kb.c[0] - kb.b) / 2.2);
        pose(me, { hipY: bp.hip[1] - 0.93 - crouch * (1 - dv), roll, kL: 0.45 + crouch - dv * 0.4, kR: 0.45 + crouch - dv * 0.4, lL: -0.3 - crouch, lR: -0.3 - crouch, lLz: 0.18, lRz: -0.18, lean: 0.12 * (1 - dv) });
        aimArm(me.armL, me.elbowL, kb.gloves[0].p);
        aimArm(me.armR, me.elbowR, kb.gloves[1].p);
        kb.gloves.forEach((g, i) => { const m = myGloves[i]; m.visible = true; m.position.set(...g.p); m.rotation.set(0, 0, -roll * 0.6); });
      } else {
        hide(me);
        if (view.vrGloves) {
          view.vrGloves.forEach((g, i) => {
            const m = myGloves[i];
            m.visible = !!g;
            if (g) { m.position.set(...g.p); m.quaternion.copy(g.q); }
          });
        } else myGloves.forEach(m => { m.visible = false; });
      }
    },
  };
}
