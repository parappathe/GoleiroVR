// Sons sintetizados na hora (sem arquivos): torcida (ambiente contínuo, batucada, "uuuh",
// comemoração e lamento), apito, chute, luva, trave, rede e quique. Só liga depois de um clique
// ou da entrada no VR (regra dos navegadores).
export class Sfx {
  constructor() { this.ctx = null; this.on = true; this.crowd = null; this.excite = 0; this.nextDrum = 0; this.drumOn = true; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 0.8 : 0;
      this.master.connect(this.ctx.destination);
      this.noiseBuf = this.makeNoise(4.5);
      this.startCrowd();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setOn(v) {
    this.on = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  makeNoise(sec) {
    const c = this.ctx;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Torcida de fundo: duas faixas de ruído filtrado com volume que ondula devagar.
  startCrowd() {
    const c = this.ctx;
    const mk = (freq, q, vol) => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.2;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = vol;
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 0.13 + Math.random() * 0.1; lg.gain.value = vol * 0.35;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { f, g, base: vol };
    };
    this.crowd = [mk(520, 0.6, 0.05), mk(1500, 0.5, 0.025)];
  }

  // 0..1: o quanto a torcida está agitada (sobe na corrida do batedor).
  setExcite(v) {
    if (!this.crowd) return;
    const t = this.ctx.currentTime;
    this.excite = v;
    for (const b of this.crowd) b.g.gain.setTargetAtTime(b.base * (1 + v * 1.6), t, 0.4);
  }

  // Batucada de fundo: surdo e caixa marcando, agendados à frente no relógio do áudio.
  update() {
    if (!this.ctx || !this.drumOn) return;
    const t = this.ctx.currentTime;
    if (this.nextDrum < t) this.nextDrum = t + 0.05;
    while (this.nextDrum < t + 0.3) {
      const k = Math.round(this.nextDrum / 0.25) % 8;
      const at = this.nextDrum - t;
      if (k === 0 || k === 4) this.tone(70, 0.28, { vol: 0.09, at, slide: 0.6, attack: 0.004 });
      if (k === 3 || k === 7) this.tone(95, 0.2, { vol: 0.06, at, slide: 0.7, attack: 0.004 });
      if (k % 2 === 1) this.noise(0.05, { vol: 0.018, freq: 3500, q: 1, at });
      this.nextDrum += 0.25;
    }
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, slide = 0, attack = 0.005 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.1, freq = 1200, q = 1, at = 0, type = 'bandpass', attack = 0.003, sweep = 0 } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + at;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noiseBuf;
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * Math.max(0, 4.4 - dur)); src.stop(t + dur + 0.05);
  }

  // Grito de torcida: ruído com "vogal" (dois filtros) e envelope lento.
  crowdShout(dur, { vol = 0.25, f1 = 700, f2 = 1200, sweep = 1, attack = 0.25, at = 0 } = {}) {
    this.noise(dur, { vol, freq: f1, q: 1.2, sweep, attack, at });
    this.noise(dur, { vol: vol * 0.6, freq: f2, q: 1.5, sweep, attack, at });
  }

  whistle(n = 1, long = false) {
    const c = this.ctx;
    if (!c) return;
    for (let k = 0; k < n; k++) {
      const t = c.currentTime + k * 0.32;
      const dur = long ? 0.75 : 0.26;
      const o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
      const lfo = c.createOscillator(), lg = c.createGain();
      o1.type = 'sine'; o1.frequency.value = 2950; o2.type = 'sine'; o2.frequency.value = 3180;
      lfo.type = 'square'; lfo.frequency.value = 26; lg.gain.value = 0.05;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      g.gain.setValueAtTime(0.09, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      lfo.connect(lg); lg.connect(g.gain);
      o1.connect(g); o2.connect(g); g.connect(this.master);
      for (const o of [o1, o2, lfo]) { o.start(t); o.stop(t + dur + 0.02); }
    }
  }

  kick(speed) {
    const s = Math.min(1, speed / 30);
    this.tone(130, 0.16, { vol: 0.35 + 0.3 * s, slide: 0.35 });
    this.noise(0.03, { vol: 0.25 * s + 0.05, freq: 1800, q: 1.5 });
  }
  glove(v) {
    const s = Math.min(1, v / 25);
    this.noise(0.07, { vol: 0.15 + 0.35 * s, freq: 900, q: 0.8 });
    this.tone(160, 0.1, { vol: 0.15 + 0.2 * s, slide: 0.5 });
  }
  body(v) { const s = Math.min(1, v / 25); this.tone(90, 0.18, { vol: 0.2 + 0.3 * s, slide: 0.5 }); this.noise(0.05, { vol: 0.1 * s + 0.03, freq: 500 }); }
  post(v) {
    const s = Math.min(1, v / 20);
    [[523, 0.14, 1.1], [1443, 0.06, 0.7], [2824, 0.035, 0.45], [4100, 0.02, 0.3]].forEach(([f, vol, d]) =>
      this.tone(f, d, { vol: vol * (0.5 + s), type: 'triangle', attack: 0.002 }));
    this.noise(0.03, { vol: 0.2 * s, freq: 3000, q: 2 });
  }
  net(v) { const s = Math.min(1, v / 20); this.noise(0.45, { vol: 0.12 + 0.15 * s, freq: 2400, q: 0.6, type: 'highpass', attack: 0.01 }); }
  bounce(v) { const s = Math.min(1, v / 10); this.tone(110, 0.1, { vol: 0.12 * s + 0.03, slide: 0.6 }); }
  wallHit() { this.body(18); this.crowdShout(0.9, { vol: 0.15, f1: 500, f2: 900, sweep: 0.8, attack: 0.05 }); }
  ooh() { this.crowdShout(1.4, { vol: 0.28, f1: 450, f2: 800, sweep: 1.5, attack: 0.15 }); }
  cheer(big = false) {
    this.crowdShout(big ? 3.6 : 2.4, { vol: big ? 0.5 : 0.38, f1: 900, f2: 1700, sweep: 1.1, attack: 0.12 });
    if (big) [0, 0.25, 0.5, 0.75, 1.0].forEach((a, i) => this.tone(70, 0.3, { vol: 0.16, at: a, slide: 0.6 + (i % 2) * 0.1 }));
  }
  groan() { this.crowdShout(1.8, { vol: 0.3, f1: 600, f2: 1000, sweep: 0.5, attack: 0.1 }); }
  click() { this.tone(880, 0.05, { vol: 0.07, type: 'square' }); }
  charge(p) { this.tone(300 + p * 500, 0.06, { vol: 0.03, type: 'triangle' }); }
}
