import * as THREE from 'three';
import { F, TUNE } from '../config.js';
import { PlayerModel, J, NJ } from '../gfx/player-model.js';

const O = NJ * 3; // root 通道偏移
const _v = new THREE.Vector3();

export class Player {
  constructor(scene, team, idx, opts) {
    this.team = team;              // Team 对象
    this.idx = idx;
    this.role = opts.role;
    this.isGK = opts.role === 'GK';
    this.stats = opts.stats;
    this.name = opts.name;
    this.number = opts.number;
    this.model = new PlayerModel({ kit: opts.kit, number: opts.number, name: opts.name, isKeeper: this.isGK, seed: opts.seed });
    scene.add(this.model.root);

    this.pos = this.model.root.position;
    this.vel = new THREE.Vector3();
    this.facing = new THREE.Vector3(team.attackDir, 0, 0);
    this.moveInput = new THREE.Vector3();
    this.sprint = false;
    this.stamina = 100;
    this.speedMul = 1;
    this.state = 'run';
    this.stateT = 0;
    this.stateDur = 0;
    this.act = null;               // 动作数据
    this.controlCD = 0;
    this.tackleCD = 0;
    this.phase = Math.random() * 6;
    this.yawRate = 0;
    this.controller = null;        // HumanController
    this.sentOff = false;
    this.yellow = 0;
    this.home = new THREE.Vector3();
    this.aiTarget = new THREE.Vector3();
    this.aiT = Math.random() * 0.4;
    this.celeb = null;
    this.ready = 0;                // 防守预备姿态权重
    this.lookDown = 0;
    this.lock = false;             // 定位球：锁定位置
    this.faceLock = null;          // 侧移时保持朝向（门将）
    this.statsLine = { goals: 0, assists: 0, shots: 0, passes: 0, tackles: 0, saves: 0, rating: 6.0 };
  }

  get attackDir() { return this.team.attackDir; }
  get busy() { return this.state !== 'run'; }
  get canAct() { return this.state === 'run' && !this.sentOff; }
  get grounded() { return this.state === 'fallen' || this.state === 'slide' || this.state === 'dive' || this.state === 'getup'; }

  maxSpeed(hasBall) {
    const st = this.stats;
    let s = TUNE.runSpeed * (0.8 + st.spd / 100 * 0.38);
    if (this.sprint && this.stamina > 3) s *= TUNE.sprintMul * (0.92 + st.spd / 100 * 0.14);
    if (hasBall) s *= TUNE.dribbleMul + (this.stats.pas - 70) * 0.001;
    if (this.stamina < 20) s *= 0.9;
    return s * this.speedMul;
  }

  teleport(x, z, faceX = null, faceZ = 0) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.moveInput.set(0, 0, 0);
    if (faceX !== null) this.facing.set(faceX, 0, faceZ).normalize();
    this.setState('run');
    this.model.root.rotation.y = Math.atan2(this.facing.x, this.facing.z);
  }

  setState(s, dur = 0, act = null) {
    this.state = s;
    this.stateT = 0;
    this.stateDur = dur;
    this.act = act;
  }

  // 踢球动作：在击球时刻调用 act.fn
  startKick(kind, fn, { power = 1, dur = 0.42, strike = 0.36, volley = false } = {}) {
    this.setState('kick', dur, { kind, fn, power, strike, dur, done: false, volley });
    if (strike <= 0) { this.act.done = true; fn(); }
  }

  update(dt, match) {
    this.controlCD = Math.max(0, this.controlCD - dt);
    this.tackleCD = Math.max(0, this.tackleCD - dt);
    this.skillCD = Math.max(0, (this.skillCD || 0) - dt);
    this.touchT = Math.max(0, (this.touchT || 0) - dt);
    this.stateT += dt;
    const hasBall = match.ball.owner === this;

    // ---------- 状态机 ----------
    let steer = true;
    switch (this.state) {
      case 'kick': {
        steer = false;
        const a = this.act;
        if (!a.done && this.stateT >= a.strike * a.dur) { a.done = true; a.fn(); }
        this.damp(dt, 6);
        if (this.stateT >= a.dur) this.setState('run');
        break;
      }
      case 'tackle': {
        steer = false;
        const lunge = this.stateT < 0.2 ? 7.5 : 0;
        if (lunge) this.vel.copy(this.facing).multiplyScalar(Math.max(this.vel.length(), lunge));
        else this.damp(dt, 8);
        if (this.stateT >= this.stateDur) this.setState('run');
        break;
      }
      case 'slide': {
        steer = false;
        const sp = Math.max(0, 11.5 - this.stateT * 13);
        this.vel.copy(this.facing).multiplyScalar(sp);
        if (this.stateT >= this.stateDur) this.setState('getup', 0.45);
        break;
      }
      case 'fallen': {
        steer = false;
        this.damp(dt, 4);
        if (this.stateT >= this.stateDur) this.setState('getup', 0.5);
        break;
      }
      case 'getup': {
        steer = false;
        this.damp(dt, 8);
        if (this.stateT >= this.stateDur) this.setState('run');
        break;
      }
      case 'dive': {
        steer = false;
        const a = this.act;
        const flying = this.stateT > 0.06 && this.stateT < 0.5;
        if (flying) this.vel.copy(a.dir).multiplyScalar(a.speed);
        else this.damp(dt, 10);
        if (this.stateT >= this.stateDur) this.setState('getup', 0.45);
        break;
      }
      case 'catch': case 'throw': case 'header': {
        steer = false;
        if ((this.state === 'header' || this.state === 'throw') && this.act && !this.act.done && this.stateT >= this.act.strike) { this.act.done = true; this.act.fn(); }
        this.damp(dt, this.state === 'header' ? 2 : 8);
        if (this.stateT >= this.stateDur) this.setState('run');
        break;
      }
      case 'skill': {
        const a = this.act;
        this.vel.copy(a.dir).multiplyScalar(a.speed * (1 - this.stateT / this.stateDur * 0.4));
        if (a.dir.lengthSq() > 0) this.facing.lerp(a.dir, Math.min(1, dt * 10)).normalize();
        steer = false;
        if (this.stateT >= this.stateDur) this.setState('run');
        break;
      }
      case 'celebrate': case 'sad': case 'wait':
        break;
    }

    if (steer) {
      const maxS = this.maxSpeed(hasBall);
      const tx = this.moveInput.x * maxS, tz = this.moveInput.z * maxS;
      const dx = tx - this.vel.x, dz = tz - this.vel.z;
      const d = Math.hypot(dx, dz);
      const acc = (this.moveInput.lengthSq() > 0.01 ? TUNE.accel * (hasBall ? 0.8 : 1) : TUNE.decel) * dt;
      if (d > acc) { this.vel.x += dx / d * acc; this.vel.z += dz / d * acc; }
      else { this.vel.x = tx; this.vel.z = tz; }
    }

    if (this.lock) this.vel.set(0, 0, 0);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.clampToPitch(match.cage);

    // 朝向
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const prevYaw = Math.atan2(this.facing.x, this.facing.z);
    if (steer && !this.lock) {
      let fx = 0, fz = 0;
      if (this.faceLock) { fx = this.faceLock.x; fz = this.faceLock.z; }
      else if (sp > 0.6) { fx = this.vel.x / sp; fz = this.vel.z / sp; }
      else if (this.moveInput.lengthSq() > 0.04) { fx = this.moveInput.x; fz = this.moveInput.z; }
      if (fx || fz) {
        const k = Math.min(1, dt * (hasBall ? 11 : 14));
        this.facing.x += (fx - this.facing.x) * k;
        this.facing.z += (fz - this.facing.z) * k;
        if (this.facing.lengthSq() < 1e-4) this.facing.set(fx, 0, fz);
        this.facing.normalize();
      }
    }
    const yaw = Math.atan2(this.facing.x, this.facing.z);
    let dyaw = yaw - prevYaw;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2; if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.yawRate += (dyaw / Math.max(dt, 1e-4) - this.yawRate) * Math.min(1, dt * 8);
    this.model.root.rotation.y = yaw;

    // 体力
    const sprinting = this.sprint && sp > 5;
    const staRate = 0.55 + this.stats.sta / 100 * 0.6;
    if (sprinting) this.stamina = Math.max(0, this.stamina - 11 / staRate * dt);
    else this.stamina = Math.min(100, this.stamina + (sp < 3 ? 9 : 5) * staRate * dt);

    this.animate(dt, match, hasBall, sp);
  }

  damp(dt, k) {
    const f = Math.exp(-k * dt);
    this.vel.x *= f; this.vel.z *= f;
  }

  clampToPitch(cage) {
    const mx = cage ? F.hl + 1.1 : F.hl + 3.5;
    const mz = cage ? F.hw + 0.9 : F.hw + 2.6;
    const p = this.pos;
    if (Math.abs(p.x) > mx) { p.x = Math.sign(p.x) * mx; this.vel.x = 0; }
    if (Math.abs(p.z) > mz) { p.z = Math.sign(p.z) * mz; this.vel.z = 0; }
    // 不能跑进球网
    if (Math.abs(p.x) > F.hl + 0.1 && Math.abs(p.z) < F.goalHalfW + 0.35) {
      if (Math.abs(p.x) < F.hl + F.goalDepth + 0.4) {
        const inside = Math.abs(p.z) < F.goalHalfW - 0.2;
        if (inside) { p.x = Math.sign(p.x) * (F.hl + 0.1); this.vel.x = 0; }
        else { p.z = Math.sign(p.z) * (F.goalHalfW + 0.35); this.vel.z = 0; }
      }
    }
  }

  footPos(out = _v) {
    return out.set(this.pos.x + this.facing.x * 0.45, 0.2, this.pos.z + this.facing.z * 0.45);
  }

  handPos(out = new THREE.Vector3()) {
    if (this.state === 'dive' || this.state === 'catch') {
      const m = this.model;
      m.root.updateMatrixWorld(true);
      const a = m.lEl.localToWorld(new THREE.Vector3(0, -0.27, 0));
      const b = m.rEl.localToWorld(new THREE.Vector3(0, -0.27, 0));
      return out.copy(a).add(b).multiplyScalar(0.5);
    }
    return out.set(this.pos.x + this.facing.x * 0.38, 1.12, this.pos.z + this.facing.z * 0.38);
  }

  // ================= 程序化动画 =================
  animate(dt, match, hasBall, sp) {
    const m = this.model;
    const T = m.target;
    T.fill(0);
    const set = (j, x = 0, y = 0, z = 0) => { T[j * 3] = x; T[j * 3 + 1] = y; T[j * 3 + 2] = z; };
    const add = (j, x = 0, y = 0, z = 0) => { T[j * 3] += x; T[j * 3 + 1] += y; T[j * 3 + 2] += z; };
    const t = this.stateT;
    let rate = 16;

    // 基础：跑动/待机
    const baseLoco = () => {
      const amp = Math.min(1.15, sp / 8.2);
      if (sp > 0.35) this.phase += (2.4 + sp * 1.05) * dt;
      const ph = this.phase;
      if (amp > 0.04) {
        set(J.lHip, -Math.sin(ph) * 0.78 * amp);
        set(J.rHip, Math.sin(ph) * 0.78 * amp);
        set(J.lKnee, amp * (0.18 + 1.25 * Math.max(0, Math.cos(ph + 0.8))));
        set(J.rKnee, amp * (0.18 + 1.25 * Math.max(0, Math.cos(ph + Math.PI + 0.8))));
        set(J.lAnk, -0.25 * amp * Math.sin(ph + 0.5));
        set(J.rAnk, 0.25 * amp * Math.sin(ph + 0.5));
        set(J.lSh, Math.sin(ph) * 0.75 * amp, 0, 0.1);
        set(J.rSh, -Math.sin(ph) * 0.75 * amp, 0, -0.1);
        set(J.lEl, -(0.45 + 0.85 * amp));
        set(J.rEl, -(0.45 + 0.85 * amp));
        set(J.pelvis, 0, Math.sin(ph) * 0.14 * amp, 0);
        set(J.spine, 0.05 + 0.16 * amp + (this.sprint ? 0.08 : 0), -Math.sin(ph) * 0.2 * amp, 0);
        set(J.head, -0.1 * amp, Math.sin(ph) * 0.06 * amp);
        T[O] = -0.035 * amp + 0.06 * amp * Math.abs(Math.cos(ph));
        T[O + 2] = THREE.MathUtils.clamp(-this.yawRate * sp * 0.012, -0.28, 0.28);
      } else {
        const b = Math.sin(match.time * 2.1 + this.idx) * 0.015;
        const r = this.ready;
        set(J.spine, 0.04 + b + r * 0.28);
        set(J.lSh, 0.05, 0, 0.12 + r * 0.25); set(J.rSh, 0.05, 0, -0.12 - r * 0.25);
        set(J.lEl, -0.25 - r * 0.5); set(J.rEl, -0.25 - r * 0.5);
        set(J.lHip, -0.05 - r * 0.35, 0.1, 0.06); set(J.rHip, -0.05 - r * 0.35, -0.1, -0.06);
        set(J.lKnee, 0.1 + r * 0.7); set(J.rKnee, 0.1 + r * 0.7);
        set(J.lAnk, -r * 0.3); set(J.rAnk, -r * 0.3);
        T[O] = -r * 0.16;
      }
      if (hasBall) add(J.head, 0.28);
    };

    switch (this.state) {
      case 'kick': {
        rate = 30;
        const a = this.act;
        const u = t / a.dur, s = a.strike;
        const pw = a.kind === 'pass' || a.kind === 'through' ? 0.6 : 1;
        const side = a.kind === 'pass' ? -0.7 : 0;
        let hip, knee, lean = 0;
        if (u < s) { const e = u / s; hip = 0.95 * e * pw; knee = 1.55 * e; lean = -0.05 * e; }
        else if (u < s + 0.18) { const f = (u - s) / 0.18; hip = 0.95 * pw - 2.35 * pw * f; knee = 1.55 * (1 - f) + 0.05; lean = 0.12 * f; }
        else { const g = (u - s - 0.18) / (1 - s - 0.18); hip = -1.4 * pw * (1 - g); knee = 0.05 + 0.3 * g; lean = 0.12 * (1 - g); }
        if (a.volley) { hip -= 0.5; lean -= 0.35; }
        set(J.rHip, hip, side, a.volley ? -0.4 : 0); set(J.rKnee, knee); set(J.rAnk, 0.3);
        set(J.lHip, -0.25); set(J.lKnee, 0.4); set(J.lAnk, -0.2);
        set(J.spine, lean + 0.08, -0.25 * Math.min(1, u / s), 0);
        set(J.lSh, -0.3, 0, 0.95); set(J.rSh, 0.4, 0, -0.5);
        set(J.lEl, -0.4); set(J.rEl, -0.5);
        set(J.pelvis, 0, 0.25 - 0.45 * Math.min(1, u / (s + 0.1)));
        T[O] = -0.06;
        if (a.volley) { T[O + 2] = 0.3; T[O] = 0.05; }
        break;
      }
      case 'tackle': {
        rate = 26;
        const e = Math.min(1, t / 0.15);
        set(J.rHip, -1.15 * e, -0.3); set(J.rKnee, 0.15); set(J.rAnk, 0.3);
        set(J.lHip, 0.3 * e); set(J.lKnee, 0.9 * e);
        set(J.spine, 0.35 * e); set(J.lSh, -0.3, 0, 0.9); set(J.rSh, 0.3, 0, -0.9);
        set(J.lEl, -0.5); set(J.rEl, -0.5);
        T[O] = -0.28 * e;
        break;
      }
      case 'slide': {
        rate = 20;
        set(J.rHip, -0.35); set(J.rKnee, 0.05); set(J.rAnk, 0.4);
        set(J.lHip, -1.0); set(J.lKnee, 1.6);
        set(J.spine, 0.55); set(J.head, 0.45);
        set(J.lSh, 0.3, 0, 1.0); set(J.rSh, -0.5, 0, -0.5); set(J.lEl, -0.3); set(J.rEl, -0.6);
        T[O] = 0.05; T[O + 1] = -1.22; T[O + 2] = 0.22;
        break;
      }
      case 'fallen': {
        rate = 12;
        const fwd = this.act && this.act.forward;
        T[O] = 0.14; T[O + 1] = fwd ? 1.42 : -1.48; T[O + 2] = 0.1;
        set(J.lSh, fwd ? -1.2 : 0.2, 0, 1.3); set(J.rSh, fwd ? -1.2 : 0.2, 0, -1.1);
        set(J.lEl, -0.4); set(J.rEl, -0.3);
        set(J.lHip, -0.3, 0, 0.2); set(J.rHip, 0.1, 0, -0.15); set(J.lKnee, 0.8); set(J.rKnee, 0.3);
        set(J.head, fwd ? -0.5 : 0.35);
        break;
      }
      case 'getup': {
        rate = 9;
        set(J.lHip, -0.6); set(J.rHip, -0.6); set(J.lKnee, 1.0); set(J.rKnee, 1.0);
        set(J.spine, 0.5); T[O] = -0.25;
        set(J.lSh, -0.4, 0, 0.3); set(J.rSh, -0.4, 0, -0.3);
        break;
      }
      case 'dive': {
        rate = 22;
        const a = this.act;
        const e = Math.min(1, t / 0.28);
        const roll = a.high ? 1.0 : a.low ? 1.45 : 1.3;
        T[O + 2] = -a.side * roll * e;
        const air = Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.05) / 0.5))));
        T[O] = (a.low ? 0.15 : 0.35 + (a.high ? 0.55 : 0.25)) * air + 0.12 * e;
        set(J.lSh, -0.35, 0, 2.85); set(J.rSh, -0.35, 0, -2.85);
        set(J.lEl, -0.15); set(J.rEl, -0.15);
        set(J.lHip, -0.2, 0, 0.25 * a.side); set(J.rHip, -0.4, 0, 0.1); set(J.lKnee, 0.4); set(J.rKnee, 0.8);
        set(J.spine, 0.05, 0, -a.side * 0.2);
        break;
      }
      case 'catch': {
        rate = 24;
        const low = this.act && this.act.low;
        set(J.lSh, low ? -0.9 : -1.4, 0, -0.2); set(J.rSh, low ? -0.9 : -1.4, 0, 0.2);
        set(J.lEl, -0.5); set(J.rEl, -0.5);
        if (low) { set(J.spine, 0.7); set(J.lKnee, 1.1); set(J.rKnee, 1.1); set(J.lHip, -0.6); set(J.rHip, -0.6); T[O] = -0.3; }
        break;
      }
      case 'throw': {
        rate = 22;
        const u = t / this.stateDur;
        const arm = u < 0.45 ? 1.4 * (u / 0.45) : 1.4 - 3.4 * Math.min(1, (u - 0.45) / 0.25);
        set(J.rSh, arm, 0, -0.2); set(J.rEl, -0.2);
        set(J.lSh, -0.8, 0, 0.4); set(J.spine, 0.1 + (u > 0.45 ? 0.25 : -0.1));
        set(J.lHip, -0.4); set(J.lKnee, 0.3); set(J.rHip, 0.3);
        break;
      }
      case 'header': {
        rate = 22;
        const u = t / this.stateDur;
        const jump = this.act.jump ? Math.max(0, Math.sin(Math.PI * Math.min(1, u * 1.15))) * 0.55 : 0;
        T[O] = jump;
        const nod = u < 0.4 ? -0.4 * (u / 0.4) : -0.4 + 1.0 * Math.min(1, (u - 0.4) / 0.2);
        set(J.spine, nod); set(J.head, nod * 0.6);
        set(J.lSh, -0.4, 0, 0.8); set(J.rSh, -0.4, 0, -0.8); set(J.lEl, -0.9); set(J.rEl, -0.9);
        set(J.lKnee, 0.6 * jump / 0.55 + 0.1); set(J.rKnee, 0.9 * jump / 0.55 + 0.1); set(J.rHip, -0.2);
        break;
      }
      case 'skill': {
        baseLoco();
        rate = 30;
        const a = this.act;
        if (a.type === 'roulette') {
          const u = Math.min(1, t / this.stateDur);
          const spin = -Math.PI * 2 * (u * u * (3 - 2 * u)) * a.spinDir;
          m.pose[O + 3] = spin; T[O + 3] = spin;
          set(J.lSh, 0, 0, 0.8); set(J.rSh, 0, 0, -0.8);
        } else {
          set(J.spine, 0.2, 0, -a.side * 0.35);
          T[O + 2] = a.side * 0.35;
          set(a.side > 0 ? J.rHip : J.lHip, -0.5, 0, a.side * 0.5);
        }
        break;
      }
      case 'celebrate': this.animCelebrate(set, add, T, match, sp, baseLoco); rate = 14; break;
      case 'sad': {
        baseLoco();
        set(J.head, 0.6); add(J.spine, 0.2);
        set(J.lSh, -0.6, 0, 2.3); set(J.rSh, -0.6, 0, -2.3); set(J.lEl, -2.1); set(J.rEl, -2.1);
        break;
      }
      default:
        baseLoco();
        if (this.isGK && sp < 1.5) {
          const r = 0.8;
          set(J.spine, 0.28); set(J.lHip, -0.4, 0.15); set(J.rHip, -0.4, -0.15); set(J.lKnee, 0.8); set(J.rKnee, 0.8);
          set(J.lAnk, -0.35); set(J.rAnk, -0.35);
          set(J.lSh, -0.5, 0, 0.55 * r); set(J.rSh, -0.5, 0, -0.55 * r); set(J.lEl, -0.7); set(J.rEl, -0.7);
          T[O] = -0.17;
        }
        if (this.holding) {
          set(J.lSh, -0.9, 0, -0.3); set(J.rSh, -0.9, 0, 0.3); set(J.lEl, -1.3); set(J.rEl, -1.3);
        }
    }

    if (this.state !== 'skill' && Math.abs(m.pose[O + 3]) > 0.001) { m.pose[O + 3] = 0; T[O + 3] = 0; }
    m.apply(dt, rate);
  }

  animCelebrate(set, add, T, match, sp, baseLoco) {
    const c = this.celeb;
    const t = this.stateT;
    baseLoco();
    const type = c ? c.type : 'arms';
    const moving = sp > 1.5;
    switch (type) {
      case 'slide':
        if (!moving || t > (c.slideAt || 1.2)) {
          T[O] = -0.44;
          set(J.lHip, 0.05, 0, 0.1); set(J.rHip, 0.05, 0, -0.1); set(J.lKnee, 1.6); set(J.rKnee, 1.6);
          set(J.lAnk, 0.4); set(J.rAnk, 0.4);
          set(J.spine, -0.45); set(J.head, -0.35);
          set(J.lSh, -0.2, 0, 2.3); set(J.rSh, -0.2, 0, -2.3); set(J.lEl, -0.2); set(J.rEl, -0.2);
          T[O + 2] = 0; T[O + 1] = 0;
        }
        break;
      case 'plane':
        set(J.lSh, 0, 0, 1.55); set(J.rSh, 0, 0, -1.55); set(J.lEl, 0); set(J.rEl, 0);
        T[O + 2] = Math.sin(match.time * 3) * 0.4;
        break;
      case 'flip': {
        const ft = t - (c.flipAt || 1.3);
        if (ft > 0 && ft < 0.8) {
          const u = ft / 0.8;
          T[O] = Math.sin(Math.PI * u) * 1.1;
          T[O + 1] = -Math.PI * 2 * u;
          set(J.lHip, -1.3); set(J.rHip, -1.3); set(J.lKnee, 1.9); set(J.rKnee, 1.9);
          set(J.lSh, -1, 0, 0.6); set(J.rSh, -1, 0, -0.6);
          this.model.pose[O + 1] = T[O + 1];
        } else {
          if (ft >= 0.8) this.model.pose[O + 1] = 0;
          set(J.lSh, 0, 0, 2.6); set(J.rSh, 0, 0, -2.6);
        }
        break;
      }
      case 'dance': {
        const w = match.time * 8;
        if (!moving) {
          set(J.pelvis, 0, Math.sin(w) * 0.45);
          set(J.lSh, 0, 0, 1.6 + Math.sin(w) * 0.9); set(J.rSh, 0, 0, -1.6 + Math.sin(w) * 0.9);
          set(J.lEl, -1.2); set(J.rEl, -1.2);
          set(J.lKnee, 0.4 + 0.3 * Math.sin(w * 2)); set(J.rKnee, 0.4 + 0.3 * Math.sin(w * 2));
          T[O] = -0.08 - 0.06 * Math.sin(w * 2);
        } else { set(J.lSh, 0, 0, 2.5); set(J.rSh, 0, 0, -2.5); }
        break;
      }
      case 'hug':
        set(J.lSh, -1.2, 0, 0.6); set(J.rSh, -1.2, 0, -0.6); set(J.lEl, -0.6); set(J.rEl, -0.6);
        break;
      default:
        set(J.lSh, -0.2, 0, 2.6 + Math.sin(match.time * 9) * 0.2); set(J.rSh, -0.2, 0, -2.6 - Math.sin(match.time * 9 + 1) * 0.2);
        set(J.lEl, -0.3); set(J.rEl, -0.3);
    }
  }

  setVisible(v) { this.model.root.visible = v; }
}
