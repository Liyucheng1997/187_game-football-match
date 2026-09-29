import * as THREE from 'three';
import { POSE_N } from '../gfx/player-model.js';

// 进球回放：环形缓冲记录每帧全部球员姿态与足球状态
const PER_PLAYER = 4 + POSE_N;
const BALL = 8;

export class Replay {
  constructor(maxFrames = 720) {
    this.max = maxFrames;
    this.players = [];
    this.frames = 0;
    this.head = 0;
    this.active = false;
  }

  bind(players) {
    this.players = players;
    this.stride = BALL + 1 + players.length * PER_PLAYER;
    this.buf = new Float32Array(this.max * this.stride);
    this.frames = 0; this.head = 0;
  }

  clear() { this.frames = 0; this.head = 0; }

  record(dt, ball) {
    if (!this.buf) return;
    const o = this.head * this.stride;
    const b = this.buf;
    b[o] = dt;
    b[o + 1] = ball.pos.x; b[o + 2] = ball.pos.y; b[o + 3] = ball.pos.z;
    const q = ball.mesh.quaternion;
    b[o + 4] = q.x; b[o + 5] = q.y; b[o + 6] = q.z; b[o + 7] = q.w;
    b[o + 8] = ball.fire;
    let k = o + BALL + 1;
    for (const p of this.players) {
      b[k] = p.pos.x; b[k + 1] = p.pos.z; b[k + 2] = p.model.root.rotation.y; b[k + 3] = p.model.root.visible ? 1 : 0;
      b.set(p.model.pose, k + 4);
      k += PER_PLAYER;
    }
    this.head = (this.head + 1) % this.max;
    this.frames = Math.min(this.max, this.frames + 1);
  }

  // 开始回放最近 seconds 秒（结束于 endOffset 秒前）
  start(seconds, tailSeconds = 1.2) {
    if (this.frames < 30) return false;
    // 从最新帧往回找
    let acc = 0, n = 0;
    const idx = i => ((this.head - 1 - i) % this.max + this.max) % this.max;
    let tailN = 0;
    while (tailN < this.frames - 1 && acc < tailSeconds) { acc += this.buf[idx(tailN) * this.stride]; tailN++; }
    // 我们希望回放在进球后 tail 秒结束：但进球后才开始录制尾巴，所以 tail 已包含
    acc = 0; n = 0;
    while (n < this.frames - 1 && acc < seconds) { acc += this.buf[idx(n) * this.stride]; n++; }
    this.seq = [];
    for (let i = n; i >= 0; i--) this.seq.push(idx(i));
    this.pos = 0;
    this.active = true;
    this.duration = acc;
    this.elapsed = 0;
    return true;
  }

  // 返回 false 表示结束
  play(dt, ball, rate = 1) {
    if (!this.active) return false;
    this.elapsed += dt * rate;
    let t = 0, i = 0;
    // 找到对应帧
    while (i < this.seq.length - 1) {
      const fdt = this.buf[this.seq[i + 1] * this.stride];
      if (t + fdt > this.elapsed) break;
      t += fdt; i++;
    }
    if (i >= this.seq.length - 1) { this.active = false; return false; }
    const fdt = this.buf[this.seq[i + 1] * this.stride] || 1 / 60;
    const u = Math.min(1, (this.elapsed - t) / fdt);
    this.apply(this.seq[i], this.seq[i + 1], u, ball);
    this.progress = this.elapsed / this.duration;
    return true;
  }

  apply(fa, fb, u, ball) {
    const b = this.buf, sa = fa * this.stride, sb = fb * this.stride;
    const L = (k) => b[sa + k] + (b[sb + k] - b[sa + k]) * u;
    ball.pos.set(L(1), L(2), L(3));
    const qa = new THREE.Quaternion(b[sa + 4], b[sa + 5], b[sa + 6], b[sa + 7]);
    const qb = new THREE.Quaternion(b[sb + 4], b[sb + 5], b[sb + 6], b[sb + 7]);
    ball.mesh.quaternion.slerpQuaternions(qa, qb, u);
    ball.mat.userData.uniforms.uFire.value = L(8);
    ball.blob.position.set(ball.pos.x, 0.015, ball.pos.z);
    ball.trailMat.opacity = 0;
    let k = BALL + 1;
    const tmp = this.tmpPose || (this.tmpPose = new Float32Array(POSE_N));
    for (const p of this.players) {
      const x = L(k), z = L(k + 1);
      let ya = b[sa + k + 2], yb = b[sb + k + 2];
      let dy = yb - ya; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      p.model.root.position.set(x, 0, z);
      p.model.root.rotation.y = ya + dy * u;
      p.model.root.visible = b[sa + k + 3] > 0.5;
      for (let j = 0; j < POSE_N; j++) tmp[j] = L(k + 4 + j);
      p.model.write(tmp);
      k += PER_PLAYER;
    }
  }

  ballAt(frac) {
    const i = Math.min(this.seq.length - 1, Math.max(0, Math.floor(frac * (this.seq.length - 1))));
    const o = this.seq[i] * this.stride;
    return new THREE.Vector3(this.buf[o + 1], this.buf[o + 2], this.buf[o + 3]);
  }
}
