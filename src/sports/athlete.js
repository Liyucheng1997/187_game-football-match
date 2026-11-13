import * as THREE from 'three';
import { PlayerModel, J, NJ } from '../gfx/player-model.js';

// 篮球 / 网球 / 羽毛球共用的运动员：移动 + 程序化动作库
const O = NJ * 3;
const clamp = THREE.MathUtils.clamp;
const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

export class Athlete {
  constructor(scene, o) {
    this.model = new PlayerModel({ kit: o.kit, number: o.number, name: o.name, seed: o.seed, sport: o.sport });
    scene.add(this.model.root);
    this.pos = this.model.root.position;
    this.vel = new THREE.Vector3();
    this.move = new THREE.Vector3();
    this.facing = new THREE.Vector3(0, 0, 1);
    this.faceLock = null;          // 始终面向的方向（球拍类面向球网，防守面向持球人）
    this.name = o.name; this.number = o.number;
    this.team = o.team; this.idx = o.idx || 0;
    this.speed = o.speed || 6;
    this.accel = o.accel || 34;
    this.sprint = false;
    this.phase = Math.random() * 6;
    this.yawRate = 0;
    this.anim = null;              // { type, t, dur, lock, jump, ... }
    this.stance = 0;               // 0 站立 → 1 压低重心的预备姿态
    this.dribble = 0;              // 运球手部动作权重（篮球）
    this.carry = 0;                // 双手持球
    this.stun = 0;
    this.jumpY = 0;
    this.manualY = false;          // 由玩法逻辑直接控制高度（扣篮）
  }

  play(type, dur, data = {}) { this.anim = { type, t: 0, dur, ...data }; return this.anim; }
  get busy() { return !!(this.anim && this.anim.lock); }
  is(type) { return this.anim && this.anim.type === type; }

  teleport(x, z, fx = null, fz = 0) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.move.set(0, 0, 0);
    this.anim = null; this.jumpY = 0; this.stun = 0;
    if (fx !== null) this.facing.set(fx, 0, fz).normalize();
    this.model.root.rotation.y = Math.atan2(this.facing.x, this.facing.z);
  }

  update(dt, time) {
    this.stun = Math.max(0, this.stun - dt);
    const a = this.anim;
    if (a) { a.t += dt; if (a.t >= a.dur) { this.anim = null; a.onEnd && a.onEnd(); } }
    const locked = (this.anim && this.anim.lock) || this.stun > 0;
    const maxS = this.speed * (this.sprint ? 1.32 : 1) * (this.anim && this.anim.slow ? this.anim.slow : 1);
    if (locked) {
      const f = Math.exp(-(this.anim && this.anim.glide ? 2.5 : 9) * dt);
      this.vel.x *= f; this.vel.z *= f;
    } else {
      const tx = this.move.x * maxS, tz = this.move.z * maxS;
      const dx = tx - this.vel.x, dz = tz - this.vel.z, d = Math.hypot(dx, dz);
      const acc = this.accel * dt;
      if (d > acc) { this.vel.x += dx / d * acc; this.vel.z += dz / d * acc; } else { this.vel.x = tx; this.vel.z = tz; }
    }
    if (!this.manualY) {
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);

    // 朝向
    const prevYaw = Math.atan2(this.facing.x, this.facing.z);
    let fx = 0, fz = 0;
    if (this.faceLock) { fx = this.faceLock.x; fz = this.faceLock.z; }
    else if (sp > 0.6 && !locked) { fx = this.vel.x / sp; fz = this.vel.z / sp; }
    if (fx || fz) {
      const k = Math.min(1, dt * 12);
      this.facing.x += (fx - this.facing.x) * k; this.facing.z += (fz - this.facing.z) * k;
      if (this.facing.lengthSq() < 1e-4) this.facing.set(fx, 0, fz);
      this.facing.normalize();
    }
    const yaw = Math.atan2(this.facing.x, this.facing.z);
    let dy = yaw - prevYaw;
    if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
    this.yawRate += (dy / Math.max(dt, 1e-4) - this.yawRate) * Math.min(1, dt * 8);
    this.model.root.rotation.y = yaw;

    this.animate(dt, time, sp);
  }

  animate(dt, time, sp) {
    const m = this.model, T = m.target;
    T.fill(0);
    const set = (j, x = 0, y = 0, z = 0) => { T[j * 3] = x; T[j * 3 + 1] = y; T[j * 3 + 2] = z; };
    const add = (j, x = 0, y = 0, z = 0) => { T[j * 3] += x; T[j * 3 + 1] += y; T[j * 3 + 2] += z; };
    let rate = 16;

    // ---------- 基础：跑动 / 侧滑步 / 待机 ----------
    const amp = Math.min(1.15, sp / 7.6);
    if (sp > 0.35) this.phase += (2.6 + sp * 1.1) * dt;
    const ph = this.phase;
    // 速度方向与朝向的夹角：侧向移动时用滑步
    const along = sp > 0.2 ? (this.vel.x * this.facing.x + this.vel.z * this.facing.z) / sp : 1;
    const side = sp > 0.2 ? (this.vel.x * this.facing.z - this.vel.z * this.facing.x) / sp : 0;
    const r = this.stance;
    if (amp > 0.04) {
      const fw = Math.abs(along), sd = Math.abs(side);
      const sw = Math.sin(ph) * 0.78 * amp * fw * Math.sign(along || 1);
      set(J.lHip, -sw - r * 0.3, 0, sd * amp * (0.25 + 0.3 * Math.sin(ph)));
      set(J.rHip, sw - r * 0.3, 0, -sd * amp * (0.25 - 0.3 * Math.sin(ph)));
      set(J.lKnee, amp * (0.18 + 1.2 * Math.max(0, Math.cos(ph + 0.8))) * (0.4 + 0.6 * fw) + r * 0.5);
      set(J.rKnee, amp * (0.18 + 1.2 * Math.max(0, Math.cos(ph + Math.PI + 0.8))) * (0.4 + 0.6 * fw) + r * 0.5);
      set(J.lAnk, -0.25 * amp * Math.sin(ph + 0.5)); set(J.rAnk, 0.25 * amp * Math.sin(ph + 0.5));
      set(J.lSh, Math.sin(ph) * 0.7 * amp * fw, 0, 0.1 + r * 0.2); set(J.rSh, -Math.sin(ph) * 0.7 * amp * fw, 0, -0.1 - r * 0.2);
      set(J.lEl, -(0.45 + 0.8 * amp)); set(J.rEl, -(0.45 + 0.8 * amp));
      set(J.pelvis, 0, Math.sin(ph) * 0.13 * amp * fw, 0);
      set(J.spine, 0.05 + 0.15 * amp * fw + r * 0.2 + (this.sprint ? 0.07 : 0), -Math.sin(ph) * 0.18 * amp * fw, 0);
      set(J.head, -0.1 * amp * fw - r * 0.15, Math.sin(ph) * 0.05 * amp);
      T[O] = -0.035 * amp + 0.06 * amp * Math.abs(Math.cos(ph)) - r * 0.1;
      T[O + 2] = clamp(-this.yawRate * sp * 0.012 + side * amp * 0.12, -0.28, 0.28);
    } else {
      const b = Math.sin(time * 2.1 + this.idx * 1.7) * 0.015;
      const bounce = r * Math.abs(Math.sin(time * 5 + this.idx)) * 0.03;
      set(J.spine, 0.04 + b + r * 0.3);
      set(J.lSh, 0.05, 0, 0.12 + r * 0.3); set(J.rSh, 0.05, 0, -0.12 - r * 0.3);
      set(J.lEl, -0.25 - r * 0.7); set(J.rEl, -0.25 - r * 0.7);
      set(J.lHip, -0.05 - r * 0.4, 0.1, 0.06 + r * 0.12); set(J.rHip, -0.05 - r * 0.4, -0.1, -0.06 - r * 0.12);
      set(J.lKnee, 0.1 + r * 0.75); set(J.rKnee, 0.1 + r * 0.75);
      set(J.lAnk, -r * 0.3); set(J.rAnk, -r * 0.3);
      set(J.head, -r * 0.2);
      T[O] = -r * 0.15 + bounce;
    }
    // 持拍预备：拍子举在身前
    if (m.racket && !this.anim) { set(J.rSh, -0.55 - r * 0.2, 0, -0.15); set(J.rEl, -1.25); set(J.lSh, -0.5, 0, 0.1); set(J.lEl, -1.2); }
    // 运球：右手拍球
    if (this.dribble > 0.01) {
      const d = this.dribble, w = Math.sin(time * 9.5 + this.idx);
      set(J.rSh, (-0.35 + w * 0.22) * d, 0, -0.3 * d); set(J.rEl, (-0.75 - w * 0.4) * d);
      add(J.spine, 0.12 * d); add(J.head, -0.1 * d);
      if (amp < 0.04) set(J.lSh, -0.3 * d, 0, 0.5 * d);
    }
    if (this.carry > 0.01) {
      const c = this.carry;
      set(J.lSh, -0.9 * c, 0, -0.25 * c); set(J.rSh, -0.9 * c, 0, 0.25 * c); set(J.lEl, -1.2 * c); set(J.rEl, -1.2 * c);
    }
    if (this.stun > 0) { add(J.spine, 0.3, 0.3); set(J.lSh, 0, 0, 1.1); set(J.rSh, 0, 0, -1.1); T[O] -= 0.12; T[O + 2] = 0.2; }

    // ---------- 动作 ----------
    const a = this.anim;
    let jump = 0;
    if (a) {
      const u = a.t / a.dur;
      rate = 28;
      const hit = a.hitAt ?? 0.45;                           // 击球时刻（归一化）
      const pre = clamp(u / hit, 0, 1), post = clamp((u - hit) / (1 - hit), 0, 1);
      if (a.jump) jump = a.jump * Math.sin(Math.PI * clamp((u - (a.j0 ?? 0)) / ((a.j1 ?? 1) - (a.j0 ?? 0)), 0, 1));
      switch (a.type) {
        case 'forehand': {
          const tw = -0.85 * pre + 1.55 * smooth(post * 1.6);
          set(J.spine, 0.12, tw, 0); set(J.pelvis, 0, tw * 0.35);
          set(J.rSh, 0.55 * pre - 1.9 * smooth(post * 1.5), 0, -1.0 + 0.9 * smooth(post * 1.4));
          set(J.rEl, -0.35 - 0.7 * post);
          set(J.lSh, -0.6 + 0.5 * post, 0, 0.5); set(J.lEl, -0.5);
          set(J.lHip, -0.35, 0.2); set(J.lKnee, 0.5); set(J.rHip, 0.15, -0.2); set(J.rKnee, 0.35);
          T[O] = -0.1;
          break;
        }
        case 'backhand': {
          const tw = 0.9 * pre - 1.4 * smooth(post * 1.6);
          set(J.spine, 0.14, tw, 0); set(J.pelvis, 0, tw * 0.3);
          set(J.rSh, -0.7 - 0.3 * post, 0, 0.75 * pre - 1.9 * smooth(post * 1.5));
          set(J.rEl, -1.1 + 0.9 * smooth(post * 1.5));
          set(J.lSh, -0.6, 0, 0.1 + 0.7 * post); set(J.lEl, -1.0 + 0.6 * post);
          set(J.rHip, -0.35, -0.2); set(J.rKnee, 0.5); set(J.lHip, 0.15, 0.2); set(J.lKnee, 0.35);
          T[O] = -0.1;
          break;
        }
        case 'overhead': case 'serve': {
          const sw = smooth(post * 1.7);
          set(J.spine, -0.28 * pre + 0.62 * sw, -0.35 * pre + 0.6 * sw, 0);
          set(J.rSh, 0.75 * pre - 1.5 * sw, 0, -2.75 + 1.3 * smooth(post * 1.3));
          set(J.rEl, -1.5 * pre * (1 - sw) - 0.15);
          set(J.lSh, -0.3 + 0.8 * post, 0, 2.4 * pre * (1 - sw) + 0.2); set(J.lEl, -0.2);
          set(J.lKnee, 0.5 * pre * (1 - post) + 0.1); set(J.rKnee, 0.6 * pre * (1 - post) + 0.3 * post); set(J.rHip, 0.25 * pre - 0.5 * post); set(J.lHip, -0.2);
          set(J.head, -0.35 * (1 - post));
          break;
        }
        case 'underhand': {                                   // 羽毛球发球 / 挑球
          const sw = smooth(post * 1.6);
          set(J.spine, 0.2, -0.4 * pre + 0.5 * sw);
          set(J.rSh, 0.7 * pre - 1.7 * sw, 0, -0.45); set(J.rEl, -0.3 - 0.5 * sw);
          set(J.lSh, -0.9 * (1 - sw), 0, 0.2); set(J.lEl, -0.8);
          set(J.lHip, -0.4); set(J.lKnee, 0.45); set(J.rHip, 0.2); set(J.rKnee, 0.3);
          T[O] = -0.08;
          break;
        }
        case 'lunge': {                                       // 鱼跃救球
          const e = smooth(u * 2.2);
          const s = a.side || 1;
          T[O + 2] = -s * 0.9 * e * (1 - smooth((u - 0.6) / 0.4)); T[O] = -0.25 * e;
          set(J.rSh, -0.8, 0, -2.2 * e); set(J.rEl, -0.1); set(J.lSh, 0.2, 0, 1.2 * e);
          set(s > 0 ? J.rHip : J.lHip, -0.9 * e, 0, -s * 0.5 * e); set(s > 0 ? J.rKnee : J.lKnee, 0.9 * e);
          set(s > 0 ? J.lHip : J.rHip, 0.5 * e); set(s > 0 ? J.lKnee : J.rKnee, 0.3);
          break;
        }
        case 'shoot': {                                       // 跳投：收球 → 举球 → 压腕
          const rise = smooth(u / 0.5), rel = a.released ? smooth((a.t - a.relT) / 0.18) : 0;
          set(J.rSh, -2.5 * rise - 0.35 * rel, 0, -0.15); set(J.rEl, -1.7 * rise * (1 - rel) - 0.1);
          set(J.lSh, -2.3 * rise + 0.6 * rel, 0, 0.3 * rise); set(J.lEl, -1.5 * rise * (1 - rel * 0.6));
          set(J.spine, 0.1 * (1 - rise) - 0.1 * rise); set(J.head, -0.25 * rise);
          const crouch = Math.sin(Math.PI * clamp(u / 0.3, 0, 1));
          set(J.lKnee, 0.7 * crouch + 0.15); set(J.rKnee, 0.7 * crouch + 0.15); set(J.lHip, -0.35 * crouch); set(J.rHip, -0.35 * crouch);
          T[O] = -0.14 * crouch;
          break;
        }
        case 'layup': case 'dunk': {
          const up = smooth(u / 0.55), down = smooth((u - 0.62) / 0.3);
          const dk = a.type === 'dunk';
          set(J.rSh, -2.9 * up + (dk ? 1.3 : 0.8) * down, 0, -0.2); set(J.rEl, dk ? -0.9 * (1 - up) - 0.9 * down : -0.6 * (1 - up));
          set(J.lSh, dk ? -2.7 * up + 1.2 * down : -0.6 * up, 0, 0.3); set(J.lEl, dk ? -0.8 * (1 - up) - 0.8 * down : -0.9);
          set(J.rHip, 0.25 * up); set(J.rKnee, 0.5 * up); set(J.lHip, -1.1 * up * (1 - down)); set(J.lKnee, 1.5 * up * (1 - down));
          set(J.spine, -0.15 * up + (dk ? 0.5 : 0.1) * down); set(J.head, -0.35 * up);
          break;
        }
        case 'block': {                                       // 起跳封盖 / 抢板
          const up = smooth(u / 0.3);
          set(J.lSh, -0.3, 0, 2.75 * up); set(J.rSh, -0.3, 0, -2.75 * up); set(J.lEl, -0.15); set(J.rEl, -0.15);
          const crouch = Math.sin(Math.PI * clamp(u / 0.25, 0, 1));
          set(J.lKnee, 0.6 * crouch + 0.1); set(J.rKnee, 0.6 * crouch + 0.1); set(J.spine, -0.08); set(J.head, -0.3);
          break;
        }
        case 'steal': {
          const e = Math.sin(Math.PI * clamp(u * 1.3, 0, 1));
          set(J.rSh, -1.5 * e, 0, 0.5 * e - 0.3); set(J.rEl, -0.3); set(J.spine, 0.45 * e, 0.35 * e);
          set(J.lSh, 0, 0, 0.7); set(J.lHip, -0.6 * e); set(J.lKnee, 0.7 * e); set(J.rKnee, 0.4); T[O] = -0.2 * e;
          break;
        }
        case 'pass': {
          const e = smooth(u / 0.4), f = smooth((u - 0.4) / 0.3);
          set(J.lSh, -1.0 * e - 0.5 * f, 0, -0.2 + 0.3 * f); set(J.rSh, -1.0 * e - 0.5 * f, 0, 0.2 - 0.3 * f);
          set(J.lEl, -1.5 * e * (1 - f) - 0.1); set(J.rEl, -1.5 * e * (1 - f) - 0.1);
          set(J.spine, 0.2 * f); set(J.lHip, -0.4 * f); set(J.lKnee, 0.3 * f);
          break;
        }
        case 'cross': {                                       // 变向过人
          const s = a.side || 1, e = Math.sin(Math.PI * u);
          T[O + 2] = -s * 0.4 * e; T[O] = -0.2 * e;
          set(J.spine, 0.35, 0, s * 0.3 * e);
          set(s > 0 ? J.rHip : J.lHip, -0.4, 0, -s * 0.6 * e); set(J.lKnee, 0.7); set(J.rKnee, 0.7);
          set(J.rSh, -0.5, 0, -0.5 + s * 0.6 * e); set(J.rEl, -0.9); set(J.lSh, -0.4, 0, 0.6);
          break;
        }
        case 'celebrate': {
          rate = 14;
          const w = time * 8 + this.idx;
          if (a.style === 1) {
            set(J.pelvis, 0, Math.sin(w) * 0.4);
            set(J.lSh, 0, 0, 1.6 + Math.sin(w) * 0.8); set(J.rSh, 0, 0, -1.6 + Math.sin(w) * 0.8); set(J.lEl, -1.2); set(J.rEl, -1.2);
            set(J.lKnee, 0.4 + 0.3 * Math.sin(w * 2)); set(J.rKnee, 0.4 + 0.3 * Math.sin(w * 2)); T[O] = -0.08 - 0.06 * Math.sin(w * 2);
          } else {
            set(J.lSh, -0.2, 0, 2.6 + Math.sin(w) * 0.2); set(J.rSh, -0.2, 0, -2.6 - Math.sin(w + 1) * 0.2); set(J.lEl, -0.3); set(J.rEl, -0.3);
            T[O] = Math.max(0, Math.sin(w * 0.9)) * 0.3; set(J.lKnee, 0.2); set(J.rKnee, 0.2); set(J.head, -0.3);
          }
          break;
        }
        case 'fist': {                                        // 握拳庆祝（得分后短暂）
          const e = Math.sin(Math.PI * clamp(u * 1.4, 0, 1));
          set(J.rSh, -1.3 * e, 0, -0.4 * e); set(J.rEl, -2.0 * e); set(J.spine, 0.15 * e, 0.2 * e); set(J.lSh, 0.2, 0, 0.3);
          set(J.lKnee, 0.3 * e); set(J.rKnee, 0.3 * e); T[O] = -0.06 * e;
          break;
        }
        case 'sad': {
          rate = 10;
          set(J.head, 0.6); add(J.spine, 0.25);
          set(J.lSh, -0.1, 0, 0.25); set(J.rSh, -0.1, 0, -0.25); set(J.lEl, -0.2); set(J.rEl, -0.2);
          break;
        }
      }
    }
    if (!this.manualY) {
      this.jumpY = jump;
      this.pos.y = jump;
    }
    m.apply(dt, rate);
  }

  // 右手（握拍 / 持球）世界坐标
  handPos(out, left = false) {
    this.model.root.updateMatrixWorld(true);
    return (left ? this.model.lEl : this.model.rEl).localToWorld(out.set(0, -0.3, 0.02));
  }

  dispose() { this.model.dispose(); }
}
