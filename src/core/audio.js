// 全程序化音频：踢球 / 哨声 / 门柱 / 球网 / 人群氛围与助威 / 欢呼 / 叹息 / 嘘声 / 菜单音乐
// 零音频素材，全部 WebAudio 实时合成

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.vol = { master: 0.8, music: 0.5, sfx: 0.9, crowd: 0.8 };
    this.excite = 0;
    this.musicOn = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.crowdBus = ctx.createGain(); this.crowdBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);

    // 共用噪声
    const len = ctx.sampleRate * 3;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    this.applyVolumes();
    this._startCrowd();
  }

  setVolumes(v) { Object.assign(this.vol, v); this.applyVolumes(); }
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.crowdBus.gain.setTargetAtTime(this.vol.crowd, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.55, t, 0.05);
  }

  get t() { return this.ctx.currentTime; }

  _src(buf, loop = false, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = loop; s.playbackRate.value = rate;
    return s;
  }

  _env(gainNode, t, a, peak, d) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.linearRampToValueAtTime(peak, t + a);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _noise(dur, type, freq, gain, { t0 = 0, q = 0.8, bus = this.sfxBus, buf = this.white, attack = 0.004, sweep = 0 } = {}) {
    const t = this.t + t0;
    const s = this._src(buf, false, 0.9 + Math.random() * 0.25);
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, attack, gain, dur);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + attack + 0.05);
  }

  _tone(type, f0, f1, dur, gain, { t0 = 0, bus = this.sfxBus, attack = 0.003 } = {}) {
    const t = this.t + t0;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, attack, gain, dur);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + dur + attack + 0.05);
  }

  // ---------- 比赛音效 ----------
  kick(power = 0.6) {
    if (!this.ctx) return;
    this._tone('sine', 110 + power * 70, 42, 0.13, 0.45 + power * 0.5);
    this._noise(0.06, 'lowpass', 900 + power * 1800, 0.3 + power * 0.35);
    if (power > 0.85) this._noise(0.25, 'bandpass', 600, 0.25, { t0: 0.01, sweep: 0.4 });
  }
  touch() { if (this.ctx) { this._tone('sine', 95, 50, 0.07, 0.18); this._noise(0.03, 'lowpass', 700, 0.08); } }
  thud(v = 0.35) { if (this.ctx) { this._tone('sine', 80, 40, 0.1, v); this._noise(0.08, 'lowpass', 400, v * 0.6); } }
  bounce(v = 0.3) { if (this.ctx) this._tone('sine', 70, 38, 0.09, v * 0.7); }
  post() {
    if (!this.ctx) return;
    for (const [f, g] of [[1480, 0.22], [2230, 0.14], [3310, 0.08], [760, 0.12]]) this._tone('triangle', f, f * 0.995, 1.1, g);
    this._noise(0.05, 'highpass', 3000, 0.25);
  }
  net() { if (this.ctx) { this._noise(0.35, 'bandpass', 1800, 0.3, { q: 0.6, sweep: 0.5, attack: 0.01 }); this._tone('sine', 90, 50, 0.2, 0.2); } }
  whoosh() { if (this.ctx) this._noise(0.35, 'bandpass', 500, 0.3, { q: 2, sweep: 4, attack: 0.08 }); }
  slide() { if (this.ctx) this._noise(0.5, 'bandpass', 1200, 0.18, { q: 0.7, sweep: 0.4, attack: 0.02 }); }
  fire() {
    if (!this.ctx) return;
    this._noise(1.2, 'lowpass', 1800, 0.5, { buf: this.brown, sweep: 0.3, attack: 0.02 });
    this._tone('sawtooth', 220, 55, 0.6, 0.18);
    this._tone('sine', 60, 30, 0.8, 0.5);
  }

  whistle(kind = 'short') {
    if (!this.ctx) return;
    const blast = (t0, dur, g = 0.12) => {
      const t = this.t + t0;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(2750, t);
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 32;
      const lg = this.ctx.createGain(); lg.gain.value = 180;
      lfo.connect(lg).connect(o.frequency);
      const gg = this.ctx.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.linearRampToValueAtTime(g, t + 0.015);
      gg.gain.setValueAtTime(g, t + dur - 0.04);
      gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gg).connect(this.sfxBus);
      o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
    };
    if (kind === 'short') blast(0, 0.28);
    else if (kind === 'long') blast(0, 0.75);
    else if (kind === 'foul') { blast(0, 0.22, 0.14); blast(0.28, 0.45, 0.14); }
    else if (kind === 'half') { blast(0, 0.3); blast(0.4, 0.8); }
    else if (kind === 'end') { blast(0, 0.3); blast(0.42, 0.3); blast(0.84, 1.1); }
  }

  // ---------- 人群 ----------
  _startCrowd() {
    const ctx = this.ctx;
    // 底噪（多层滤波棕噪声）
    const s = this._src(this.brown, true);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    this.crowdBed = ctx.createGain(); this.crowdBed.gain.value = 0.06;
    s.connect(lp).connect(this.crowdBed).connect(this.crowdBus);
    s.start();
    // 人声嘈杂（带通白噪 + 慢调制）
    const s2 = this._src(this.white, true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.9;
    this.crowdMurmur = ctx.createGain(); this.crowdMurmur.gain.value = 0.02;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.23;
    const lfoG = ctx.createGain(); lfoG.gain.value = 250;
    lfo.connect(lfoG).connect(bp.frequency); lfo.start();
    s2.connect(bp).connect(this.crowdMurmur).connect(this.crowdBus);
    s2.start();
    this.chantT = 0;
  }

  setExcitement(x) {
    if (!this.ctx) return;
    this.excite = x;
    const t = this.t;
    this.crowdBed.gain.setTargetAtTime(0.05 + x * 0.1, t, 0.5);
    this.crowdMurmur.gain.setTargetAtTime(0.015 + x * 0.05, t, 0.5);
  }

  // 每帧调用：节奏助威（鼓点+拍手）
  update(dt, active) {
    if (!this.ctx || !active) return;
    this.chantT -= dt;
    if (this.chantT <= 0) {
      this.chantT = 0.52;
      this.beat = ((this.beat || 0) + 1) % 8;
      const pattern = [1, 0, 1, 0, 1, 1, 1, 0];
      if (pattern[this.beat]) {
        const g = 0.06 + this.excite * 0.08;
        this._tone('sine', 72, 45, 0.18, g * 1.8, { bus: this.crowdBus });
        this._noise(0.09, 'bandpass', 1500, g, { bus: this.crowdBus, q: 0.5 });
      }
    }
  }

  cheer(big = true) {
    if (!this.ctx) return;
    const t = this.t;
    const s = this._src(this.white, true);
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.45;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(big ? 0.55 : 0.3, t + 0.2);
    g.gain.setTargetAtTime(0.0001, t + (big ? 2.4 : 1), big ? 1.1 : 0.5);
    s.connect(bp).connect(g).connect(this.crowdBus);
    s.start(t, Math.random()); s.stop(t + 7);
    // 高频口哨声
    if (big) for (let i = 0; i < 6; i++) {
      const f = 1800 + Math.random() * 1400;
      this._tone('sine', f, f * (0.9 + Math.random() * 0.3), 0.5 + Math.random() * 0.5, 0.025, { t0: Math.random() * 1.5, bus: this.crowdBus, attack: 0.05 });
    }
  }
  ooh() { if (this.ctx) this._noise(1.4, 'bandpass', 420, 0.35, { bus: this.crowdBus, q: 3, sweep: 1.6, attack: 0.25, buf: this.brown }); }
  groan() { if (this.ctx) this._noise(1.4, 'bandpass', 520, 0.3, { bus: this.crowdBus, q: 2.5, sweep: 0.6, attack: 0.15, buf: this.brown }); }
  boo() { if (this.ctx) this._noise(1.6, 'bandpass', 260, 0.35, { bus: this.crowdBus, q: 4, attack: 0.2, buf: this.brown }); }

  // ---------- UI ----------
  click() { if (this.ctx) { this._tone('triangle', 880, 1320, 0.05, 0.08); } }
  move() { if (this.ctx) this._tone('sine', 660, 700, 0.04, 0.05); }
  back() { if (this.ctx) this._tone('triangle', 660, 440, 0.07, 0.07); }
  coin() { if (this.ctx) { this._tone('square', 988, 988, 0.08, 0.05); this._tone('square', 1319, 1319, 0.22, 0.05, { t0: 0.08 }); } }
  unlock() { if (this.ctx) [523, 659, 784, 1047].forEach((f, i) => this._tone('triangle', f, f, 0.25, 0.09, { t0: i * 0.09 })); }
  sting() { if (this.ctx) [392, 523, 659, 784, 1047].forEach((f, i) => this._tone('sawtooth', f, f, 0.3, 0.05, { t0: i * 0.06, bus: this.musicBus })); }

  // ---------- 菜单音乐（程序化小节循环） ----------
  music(on) {
    if (!this.ctx || on === this.musicOn) return;
    this.musicOn = on;
    if (on) {
      this.step = 0;
      this.nextT = this.t + 0.1;
      const tick = () => {
        if (!this.musicOn) return;
        while (this.nextT < this.t + 0.25) { this._musicStep(this.nextT); this.nextT += 60 / 118 / 4; this.step++; }
        this._mt = setTimeout(tick, 60);
      };
      tick();
    } else clearTimeout(this._mt);
  }

  _musicStep(t) {
    const st = this.step % 64;
    const bar = Math.floor(st / 16);
    const s16 = st % 16;
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    const ch = chords[bar];
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    const bus = this.musicBus;
    const at = t - this.t;
    if (at < 0) return;
    // 鼓
    if (s16 % 4 === 0) this._tone('sine', 140, 40, 0.16, 0.5, { t0: at, bus });
    if (s16 === 4 || s16 === 12) this._noise(0.12, 'bandpass', 1800, 0.22, { t0: at, bus, q: 0.7 });
    if (s16 % 2 === 0) this._noise(0.03, 'highpass', 7000, 0.06, { t0: at, bus });
    // 贝斯
    if ([0, 3, 6, 8, 10, 14].includes(s16)) this._tone('triangle', mtof(ch[0] - 24), mtof(ch[0] - 24), 0.18, 0.22, { t0: at, bus });
    // 琶音
    const arp = [0, 1, 2, 1, 2, 0, 1, 2];
    if (s16 % 2 === 0) {
      const n = ch[arp[(s16 / 2) % 8]] + 12;
      this._tone('square', mtof(n), mtof(n), 0.1, 0.028, { t0: at, bus });
    }
    // 铺底和弦
    if (s16 === 0) for (const n of ch) this._tone('sawtooth', mtof(n), mtof(n), 1.9, 0.018, { t0: at, bus, attack: 0.3 });
  }
}
