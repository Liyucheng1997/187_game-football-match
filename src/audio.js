// 全程序化合成音效：踢球、哨声、人群、进球欢呼、门柱……无需任何音频素材
export class AudioFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.ctx.destination);

    // 白噪声 buffer（共用）
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // 棕噪声更像人群
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }

    this.startCrowd();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.75, this.ctx.currentTime, 0.05);
  }

  startCrowd() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 600;
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    src.connect(lp).connect(this.crowdGain).connect(this.master);
    src.start();
  }

  // 兴奋度 0~1，控制人群音量
  setExcitement(x) {
    if (!this.crowdGain) return;
    this.crowdGain.gain.setTargetAtTime(0.04 + x * 0.1, this.ctx.currentTime, 0.4);
  }

  _noiseBurst(dur, filterType, freq, gain, t0 = 0) {
    const t = this.ctx.currentTime + t0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1 + Math.random() * 0.3;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  kick(power = 0.7) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 低频 thump
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120 + power * 60, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5 + power * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.16);
    // 皮革接触
    this._noiseBurst(0.07, 'lowpass', 900 + power * 1200, 0.35 + power * 0.3);
  }

  thud(v = 0.3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(85, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.12);
  }

  ding() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const f of [1660, 2510]) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.55);
    }
  }

  _blast(t0, dur) {
    const t = this.ctx.currentTime + t0;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(2350, t);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 40;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 120;
    lfo.connect(lfoG).connect(o.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.setValueAtTime(0.12, t + dur - 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
    lfo.start(t); lfo.stop(t + dur + 0.05);
  }

  whistle(kind = 'start') {
    if (!this.ctx) return;
    if (kind === 'start') this._blast(0, 0.55);
    else if (kind === 'goal') this._blast(0, 0.8);
    else if (kind === 'end') { this._blast(0, 0.3); this._blast(0.4, 0.3); this._blast(0.8, 1.0); }
  }

  cheer() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 人群爆发
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1000; bp.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.18);
    g.gain.setTargetAtTime(0.001, t + 1.6, 0.8);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 4.5);
  }

  disappointed() {
    if (!this.ctx) return;
    this._noiseBurst(1.2, 'bandpass', 500, 0.22);
  }

  click() {
    if (!this.ctx) return;
    this._noiseBurst(0.04, 'highpass', 2000, 0.15);
  }
}
