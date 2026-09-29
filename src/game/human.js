import * as THREE from 'three';
import { TUNE } from '../config.js';
import { doPass, doShot, doTackle, doSlide, doSkill, aimFromInput, ballReachable, aerialReachable } from './actions.js';

const V = () => new THREE.Vector3();

// 一个真人玩家（设备）控制一支队伍中的一名球员
export class HumanController {
  constructor(match, team, device, slot) {
    this.m = match;
    this.team = team;
    this.dev = device;
    this.slot = slot;           // 0..3 → 颜色
    this.player = null;
    this.charge = -1;
    this.buffer = null;         // 预输入：{ kind, t }
    this.idleT = 0;
    this.dir = V();
    this.switchLock = 0;
  }

  setPlayer(p) {
    if (this.player === p) return;
    if (this.player && this.player.controller === this) { this.player.controller = null; this.player.sprint = false; }
    if (p && p.controller && p.controller !== this) return;
    this.player = p;
    if (p) { p.controller = this; p.moveInput.set(0, 0, 0); }
    this.switchLock = 0.25;
  }

  readDir() {
    const d = this.dev;
    const yaw = this.m.cam.inputYaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    this.dir.set(d.mx * c + d.mz * s, 0, -d.mx * s + d.mz * c);
    return this.dir;
  }

  update(dt) {
    const m = this.m, p = this.player, d = this.dev;
    this.switchLock = Math.max(0, this.switchLock - dt);
    if (!p) return;
    const dir = this.readDir();
    const ball = m.ball;
    const hasBall = ball.owner === p;

    // 门将抱球：由真人分球
    if (ball.heldBy === p) {
      p.moveInput.set(0, 0, 0);
      if (dir.lengthSq() > 0.05) p.facing.lerp(dir, Math.min(1, dt * 8)).normalize();
      if (d.pressed('pass') || d.pressed('through')) { doPass(m, p, 'ground', dir.lengthSq() > 0.05 ? dir : null); this.afterPass(); }
      else if (d.pressed('lob') || d.pressed('shoot')) { doPass(m, p, 'lob', dir.lengthSq() > 0.05 ? dir : null, null, { long: true }); this.afterPass(); }
      return;
    }

    if (p.canAct) {
      p.moveInput.copy(dir);
      p.sprint = d.held.sprint;
    } else p.sprint = false;
    if (dir.lengthSq() > 0.02 || d.held.sprint) this.idleT = 0; else this.idleT += dt;

    // ---- 射门蓄力（持球或来球前预蓄） ----
    if (d.pressed('shoot')) {
      const carrier = ball.owner && ball.owner.team !== this.team ? ball.owner : null;
      if (!hasBall && carrier && p.pos.distanceTo(carrier.pos) < 4.2 && !ballReachable(m, p)) {
        const to = V().subVectors(ball.pos, p.pos).setY(0).normalize();
        if (dir.lengthSq() < 0.05 || dir.dot(to) > 0.2) p.facing.copy(to);
        doSlide(m, p);
      } else if (!hasBall && !ball.owner && !ballReachable(m, p, 3) && !aerialReachable(m, p) && ball.pos.distanceTo(p.pos) < 3.2 && ball.vel.length() < 6) {
        p.facing.copy(V().subVectors(ball.pos, p.pos).setY(0).normalize());
        doSlide(m, p);
      } else this.charge = 0;
    }
    if (this.charge >= 0) {
      if (d.held.shoot) this.charge += dt / TUNE.shootCharge;
      if (this.charge > 1.25) this.charge = 1.25;
      if (!d.held.shoot) {
        const power = this.charge;
        this.charge = -1;
        this.buffer = { kind: 'shot', power, finesse: d.held.finesse, t: 0.4 };
      }
    }

    if (d.pressed('super') && this.team.fever >= TUNE.feverMax) this.buffer = { kind: 'super', t: 0.4 };
    if (d.pressed('pass')) {
      const carrier = ball.owner && ball.owner.team !== this.team ? ball.owner : null;
      if (!hasBall && carrier && p.pos.distanceTo(carrier.pos) < 2.6) {
        const to = V().subVectors(ball.pos, p.pos).setY(0).normalize();
        p.facing.copy(to);
        doTackle(m, p);
      } else this.buffer = { kind: 'pass', t: 0.35 };
    }
    if (d.pressed('through')) this.buffer = { kind: 'through', t: 0.35 };
    if (d.pressed('lob')) this.buffer = { kind: 'lob', t: 0.35 };
    if (d.pressed('skill') && hasBall) doSkill(m, p, dir);

    // ---- 执行预输入 ----
    if (this.buffer) {
      this.buffer.t -= dt;
      const b = this.buffer;
      const can = p.canAct && (ballReachable(m, p) || (b.kind === 'shot' && aerialReachable(m, p)));
      if (can) {
        const aerial = !ballReachable(m, p) && aerialReachable(m, p);
        if (b.kind === 'shot' || b.kind === 'super') {
          const power = b.kind === 'super' ? 1 : Math.max(0.25, b.power);
          const aim = aimFromInput(m, p, dir, power);
          const perfect = b.power >= TUNE.perfectLo && b.power <= TUNE.perfectHi;
          if (b.kind === 'super') doShot(m, p, 1, aim, { super: true });
          else if (aerial) doShot(m, p, power, aim, { header: ball.pos.y > 1.5, volley: ball.pos.y <= 1.5 });
          else doShot(m, p, power, aim, { finesse: b.finesse, perfect, volley: ball.pos.y > 0.5 });
          if (perfect && b.kind === 'shot') m.hud.flash('完美射门！', '#7dff7a', p);
          m.input.rumble(this.dev.id, 0.3 + power * 0.4, 110);
        } else {
          const kind = b.kind === 'lob' ? ((Math.abs(p.pos.z) > 14 && p.pos.x * p.attackDir > 20) ? 'cross' : 'lob') : b.kind;
          const q = doPass(m, p, kind, dir.lengthSq() > 0.05 ? dir.clone() : null, null, { arriveH: kind === 'cross' ? 1.7 : 0.6 });
          if (q) this.afterPass(q);
        }
        this.buffer = null;
      } else if (b.t <= 0) this.buffer = null;
    }

    // ---- 换人 ----
    if (d.pressed('switch')) this.manualSwitch(dir);
  }

  afterPass(q) {
    if (!q || q.isGK || !this.m.settings.autoSwitch) return;
    // 传球后立刻切到接球人（除非该球员已被其他真人控制）
    this.pendingSwitch = { p: q, t: 0.12 };
  }

  tick(dt) {
    if (this.pendingSwitch) {
      this.pendingSwitch.t -= dt;
      if (this.pendingSwitch.t <= 0) {
        const q = this.pendingSwitch.p;
        this.pendingSwitch = null;
        if (!q.controller && !q.sentOff) this.setPlayer(q);
      }
    }
  }

  manualSwitch(dir) {
    const m = this.m;
    const cands = this.team.active.filter(q => !q.isGK && q !== this.player && !q.controller);
    if (!cands.length) return;
    let best = null, bs = 1e9;
    const hasDir = dir && dir.lengthSq() > 0.2;
    for (const q of cands) {
      const ic = m.icpt.get(q);
      let s = ic ? ic.t * 4 : q.pos.distanceTo(m.ball.pos) / 5;
      s += q.pos.distanceTo(m.ball.pos) * 0.15;
      if (hasDir && this.player) {
        const to = V().subVectors(q.pos, this.player.pos).setY(0).normalize();
        s -= to.dot(dir) * 3;
      }
      if (s < bs) { bs = s; best = q; }
    }
    if (best) { this.setPlayer(best); m.audio.move(); }
  }

  // 自动换人：失球或松球时切到最合适的人
  autoSwitch() {
    const m = this.m, p = this.player;
    if (!m.settings.autoSwitch || this.switchLock > 0 || this.charge >= 0) return;
    const ball = m.ball;
    if (ball.owner && ball.owner.team === this.team) {
      if (ball.owner !== p && !ball.owner.controller && !ball.owner.isGK) this.setPlayer(ball.owner);
      return;
    }
    if (ball.heldBy) {
      if (ball.heldBy.team === this.team && !ball.heldBy.controller) this.setPlayer(ball.heldBy);
      return;
    }
    if (p && p.isGK && !ball.heldBy) {
      this.manualSwitch(null);
      return;
    }
    const exp = m.expected;
    if (exp && exp.team === this.team && exp.player !== p && !exp.player.controller && !exp.player.isGK && ball.kickTime < 0.6) {
      this.setPlayer(exp.player);
      return;
    }
    // 防守：切到离球最近/能最快拦截的人
    if (!p) { this.manualSwitch(null); return; }
    const myIc = m.icpt.get(p);
    let best = null, bt = 1e9;
    for (const q of this.team.active) {
      if (q.isGK || q.controller) continue;
      const ic = m.icpt.get(q);
      const t = ic ? ic.t : q.pos.distanceTo(ball.pos) / 7;
      if (t < bt) { bt = t; best = q; }
    }
    const myT = myIc ? myIc.t : p.pos.distanceTo(ball.pos) / 7;
    if (best && bt < myT - 0.9 && this.idleT > 0.05) this.setPlayer(best);
    else if (best && bt < myT - 1.6) this.setPlayer(best);
  }
}
