import * as THREE from 'three';
import { F } from '../config.js';
import { FORMATION } from '../data/teams.js';
import { doPass, doShot, doTackle, doSlide, doSkill, ballReachable, aerialReachable } from './actions.js';

const V = () => new THREE.Vector3();
const tmp = V(), tmp2 = V();

export class TeamAI {
  constructor(match, team, params) {
    this.m = match;
    this.team = team;
    this.p = params;
    this.markT = 0;
    this.marks = new Map();
  }

  // 阵型点（世界坐标）
  slot(pl, phase) {
    const m = this.m, t = this.team, ball = m.ball.pos;
    const f = FORMATION[pl.role];
    const att = phase === 'att' ? 1 : phase === 'def' ? 0 : 0.5;
    let sx = f.def[0] + (f.att[0] - f.def[0]) * att;
    let sz = f.def[1] + (f.att[1] - f.def[1]) * att;
    const bx = (ball.x * t.attackDir + F.hl) / F.L;
    const bz = ball.z * t.attackDir / F.hw;
    sx += (bx - 0.5) * (pl.role === 'FW' ? 0.25 : 0.42);
    sz = sz * 0.85 + bz * 0.3;
    sx = THREE.MathUtils.clamp(sx, 0.05, 0.93);
    sz = THREE.MathUtils.clamp(sz, -0.85, 0.85);
    return tmp2.set((sx * F.L - F.hl) * t.attackDir, 0, sz * F.hw * t.attackDir).clone();
  }

  update(dt) {
    const m = this.m, t = this.team, ball = m.ball;
    const opp = m.teams[1 - t.idx];
    const poss = m.possTeam;
    const phase = poss === t.idx ? 'att' : poss === opp.idx ? 'def' : 'loose';
    const mine = t.active.filter(p => !p.controller);
    const ownGoal = V().set(-t.attackDir * F.hl, 0, 0);

    // 追球者（松球 / 传球飞行中可截断）
    let chasers = new Set();
    if (!ball.owner && !ball.heldBy) {
      const best = m.bestInterceptor(t, true);
      const bestHuman = t.active.filter(p => p.controller && !p.isGK).map(p => m.icpt.get(p)).filter(Boolean).sort((a, b) => a.t - b.t)[0];
      const oppBest = m.bestInterceptor(opp, false);
      const expected = m.expected && m.expected.team === t ? m.expected.player : null;
      if (expected && !expected.controller) chasers.add(expected);
      else if (best && best.p && !best.p.isGK) {
        const ic = m.icpt.get(best.p);
        const humanBetter = bestHuman && bestHuman.t < ic.t - 0.15;
        const worth = !oppBest || ic.t < (m.icpt.get(oppBest.p)?.t ?? 99) + 0.6 || phase !== 'att';
        if (!humanBetter && worth) chasers.add(best.p);
      }
    }

    // 逼抢者
    const pressers = new Set();
    if (phase === 'def' && ball.owner) {
      const carrier = ball.owner;
      let n = this.p.press;
      const humanNear = t.active.some(p => p.controller && p.pos.distanceTo(carrier.pos) < 5);
      if (humanNear) n -= 1;
      const cand = mine.filter(p => !p.isGK).sort((a, b) => a.pos.distanceTo(carrier.pos) - b.pos.distanceTo(carrier.pos));
      for (let i = 0; i < Math.max(0, n) && i < cand.length; i++) pressers.add(cand[i]);
      // 离得太远的第二逼抢者不去
      if (pressers.size === 2) { const s = cand[1]; if (s.pos.distanceTo(carrier.pos) > 14) pressers.delete(s); }
    }

    // 盯人分配（每 0.6 秒）
    this.markT -= dt;
    if (phase === 'def' && this.markT <= 0) {
      this.markT = 0.6;
      this.marks.clear();
      const targets = opp.active.filter(o => !o.isGK && o !== ball.owner);
      const free = mine.filter(p => !p.isGK && !pressers.has(p));
      for (const o of targets.sort((a, b) => Math.abs(a.pos.x - ownGoal.x) - Math.abs(b.pos.x - ownGoal.x))) {
        let bestP = null, bd = 1e9;
        for (const p of free) {
          if ([...this.marks.values()].includes(p)) continue;
          const d = p.pos.distanceTo(o.pos) + this.slot(p, 'def').distanceTo(o.pos) * 0.5;
          if (d < bd) { bd = d; bestP = p; }
        }
        if (bestP) this.marks.set(o, bestP);
      }
    }

    for (const p of mine) {
      if (!p.canAct && p.state !== 'run') continue;
      if (p.isGK) { this.keeper(p, dt); continue; }
      p.aiT -= dt;
      if (ball.owner === p) { this.carrier(p, dt); continue; }
      p.ready = 0;
      if (chasers.has(p)) { this.chase(p, dt); continue; }
      if (phase === 'att') { this.support(p, dt); continue; }
      if (pressers.has(p)) { this.press(p, dt); continue; }
      if (phase === 'def') {
        let target = null;
        for (const [o, q] of this.marks) if (q === p) target = o;
        if (target) {
          tmp.copy(ownGoal).sub(target.pos).normalize();
          const bx = ball.pos.x - target.pos.x, bz = ball.pos.z - target.pos.z, bl = Math.hypot(bx, bz) || 1;
          const mx = target.pos.x + tmp.x * 2.2 + bx / bl * 0.9;
          const mz = target.pos.z + tmp.z * 2.2 + bz / bl * 0.9;
          this.moveTo(p, mx, mz, p.pos.distanceTo(tmp2.set(mx, 0, mz)) > 6);
        } else {
          const s = this.slot(p, 'def');
          this.moveTo(p, s.x, s.z, p.pos.distanceTo(s) > 8);
        }
        this.tryAerial(p);
        continue;
      }
      // 松球时的站位
      const s = this.slot(p, 'mid');
      this.moveTo(p, s.x, s.z, false);
      this.tryAerial(p);
    }
  }

  moveTo(p, x, z, sprint = false, stopR = 0.7) {
    const dx = x - p.pos.x, dz = z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < stopR) { p.moveInput.set(0, 0, 0); p.sprint = false; return d; }
    const k = Math.min(1, d / 2.5);
    p.moveInput.set(dx / d * k, 0, dz / d * k);
    p.sprint = sprint && d > 3 && p.stamina > 15;
    return d;
  }

  chase(p, dt) {
    const m = this.m;
    const ic = m.icpt.get(p);
    const ball = m.ball;
    if (ic) this.moveTo(p, ic.x, ic.z, true, 0.05);
    else this.moveTo(p, ball.pos.x, ball.pos.z, true, 0.05);
    // 一脚出球：迎球直接射门 / 解围
    this.tryAerial(p);
    if (!ball.owner && ballReachable(m, p, -0.3) && ball.vel.length() > 6 && p.canAct) {
      const goalD = Math.hypot(p.attackDir * F.hl - p.pos.x, p.pos.z);
      if (goalD < 16 && this.firstTimeOk(p)) doShot(m, p, 0.85, null, { errMul: 1 + this.p.aimErr * 5, volley: ball.pos.y > 0.5 });
      else if (m.inOwnBox(p.team, p.pos) && m.nearestOpponentDist(p) < 3) this.clear(p);
    }
  }

  firstTimeOk(p) { return p.aiT <= 0 && Math.random() < 0.5 + (1 - this.p.noise); }

  // 高球争顶
  tryAerial(p) {
    const m = this.m, ball = m.ball;
    if (!p.canAct || !aerialReachable(m, p)) return;
    const b = ball.pos;
    const inAttBox = Math.abs(b.x - p.attackDir * F.hl) < F.boxDepth + 2 && Math.abs(b.z) < F.boxHalfW + 2;
    const inOwnBox = m.inOwnBox(p.team, b);
    if (inAttBox && Math.random() < 0.7) {
      const gk = m.teams[1 - p.team.idx].keeper;
      const side = gk && gk.pos.z > 0 ? -1 : 1;
      doShot(m, p, 0.7, { tz: side * (F.goalHalfW - 0.8), ty: 0.4 }, { header: b.y > 1.5, volley: b.y <= 1.5, errMul: 1 + this.p.aimErr * 5 });
    } else if (inOwnBox || m.nearestOpponentDist(p) < 2) {
      this.clear(p, b.y > 1.4);
    }
  }

  clear(p, header = false) {
    const m = this.m;
    const dir = V().set(p.attackDir, 0, Math.sign(p.pos.z || 1) * 0.8).normalize();
    if (header) {
      p.setState('header', 0.55, { fn: () => {
        const b = m.ball;
        if (b.pos.distanceTo(p.pos.clone().setY(b.pos.y)) > 1.8) return;
        b.kick(V().set(dir.x * 15, 6, dir.z * 15), V(), p, 'clear', { team: p.team.idx });
        m.audio.thud(0.5);
      }, strike: 0.15, done: false, jump: m.ball.pos.y > 1.7 });
    } else doPass(m, p, 'clear', dir, null, { arriveH: 0.5 });
  }

  support(p, dt) {
    const m = this.m, t = this.team, ball = m.ball;
    const carrier = ball.owner && ball.owner.team === t ? ball.owner : null;
    if (p.aiT <= 0 || !p.supportPt) {
      p.aiT = 0.45 + Math.random() * 0.3;
      const base = this.slot(p, 'att');
      let best = base, bs = -1e9;
      const from = carrier ? carrier.pos : ball.pos;
      for (let i = 0; i < 13; i++) {
        const a = i / 12 * Math.PI * 2, r = i === 12 ? 0 : (i % 2 ? 5 : 9);
        const c = V().set(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r);
        c.x = THREE.MathUtils.clamp(c.x, -F.hl + 3, F.hl - 3);
        c.z = THREE.MathUtils.clamp(c.z, -F.hw + 2, F.hw - 2);
        const open = m.openness(c, t);
        const lane = m.laneSafety(from, c, t);
        const d = c.distanceTo(from);
        const prog = c.x * t.attackDir;
        let s = open * 1.1 + lane * 5 + prog * 0.12 - Math.abs(d - 14) * 0.18 - c.distanceTo(base) * 0.15;
        if (p.role === 'FW') s += prog * 0.12;
        if (s > bs) { bs = s; best = c; }
      }
      // 前锋前插：持球人面朝前方时跑向身后空当
      if (p.role === 'FW' && carrier && carrier.facing.x * t.attackDir > 0.4 && Math.random() < 0.55) {
        const lastDef = Math.max(...m.teams[1 - t.idx].active.filter(o => !o.isGK).map(o => o.pos.x * t.attackDir));
        const rx = Math.min(F.hl - 6, lastDef + 5) * t.attackDir;
        best = V().set(rx, 0, THREE.MathUtils.clamp(p.pos.z * 0.6, -10, 10));
        p.running = 1.5;
      }
      p.supportPt = best;
    }
    p.running = Math.max(0, (p.running || 0) - dt);
    this.moveTo(p, p.supportPt.x, p.supportPt.z, p.running > 0 || p.pos.distanceTo(p.supportPt) > 7);
    this.tryAerial(p);
  }

  press(p, dt) {
    const m = this.m, t = this.team;
    const c = m.ball.owner;
    if (!c) return;
    const own = V().set(-t.attackDir * F.hl, 0, 0);
    const toGoal = own.clone().sub(c.pos).normalize();
    const d = p.pos.distanceTo(c.pos);
    const stand = d > 3 ? 0.9 : 1.1;
    const tx = c.pos.x + toGoal.x * stand + c.vel.x * 0.25, tz = c.pos.z + toGoal.z * stand + c.vel.z * 0.25;
    this.moveTo(p, tx, tz, d > 3.5, 0.2);
    p.ready = d < 4 ? 1 : 0;
    // 抢断决策
    if (p.canAct && p.tackleCD <= 0 && p.aiT <= 0) {
      p.aiT = this.p.react * 0.6 + 0.08;
      const b = m.ball.pos;
      const db = Math.hypot(b.x - p.pos.x, b.z - p.pos.z);
      const toBall = V().set(b.x - p.pos.x, 0, b.z - p.pos.z).normalize();
      const facingBall = p.facing.dot(toBall) > 0.55;
      const exposed = c.pos.distanceTo(b) > 0.95;
      const rate = this.p.tackle * (exposed ? 3.2 : 1);
      if (db < 1.55 && facingBall && Math.random() < rate * 0.25) {
        p.facing.copy(toBall);
        doTackle(m, p);
      } else if (db > 1.8 && db < 3.6 && facingBall && Math.random() < this.p.tackle * 0.05 + (exposed ? 0.08 : 0)) {
        // 从背后铲球：高难度 AI 更谨慎
        const behind = c.facing.dot(toBall) > 0.4;
        if (!behind || Math.random() < this.p.reckless) { p.facing.copy(toBall); doSlide(m, p); }
      }
    }
  }

  // ---------- 持球人决策 ----------
  carrier(p, dt) {
    const m = this.m, t = this.team;
    const gx = t.attackDir * F.hl;
    const goal = V().set(gx, 0, 0);
    const dGoal = p.pos.distanceTo(goal);
    const pressure = m.nearestOpponentDist(p);

    // 自身禁区遇险：解围
    if (m.inOwnBox(t, p.pos) && pressure < 2.2 && p.aiT <= 0) { p.aiT = 0.3; this.clear(p); return; }

    if (p.aiT <= 0 && p.canAct) {
      p.aiT = this.p.react + 0.12 + Math.random() * 0.15;
      const noise = () => (Math.random() - 0.5) * this.p.noise;
      const curVal = m.posValue(p.pos, t);
      // 射门
      const xg = m.xg(p.pos, t) * (1 - m.shotBlockers(p, t) * 0.22);
      let shootScore = xg * 1.9 + noise();
      if (dGoal < 10) shootScore += 0.35;
      if (dGoal < 25 && xg > 0.12 && Math.random() < 0.12 + this.p.skill * 0.15) shootScore += 0.25;
      if (t.fever >= 100 && dGoal < 30 && xg > 0.08) {
        doShot(m, p, 1, this.aimCorner(p), { super: true });
        return;
      }
      // 前方空间
      const goalDir = V().set(gx - p.pos.x, 0, -p.pos.z).normalize();
      let ahead = 99;
      for (const o of m.teams[1 - t.idx].active) {
        const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, d = Math.hypot(dx, dz);
        if (d < 9 && (dx * goalDir.x + dz * goalDir.z) / (d || 1) > 0.35) ahead = Math.min(ahead, d);
      }
      // 传球
      let bestPass = null, bestPassScore = -1e9, bestKind = 'ground';
      for (const q of t.active) {
        if (q === p || q.isGK) continue;
        const d = q.pos.distanceTo(p.pos);
        if (d < 4 || d > 38) continue;
        const safety = m.laneSafety(p.pos, q.pos, t);
        const val = m.posValue(q.pos, t) + Math.min(8, m.openness(q.pos, t)) * 0.025;
        let s = (val - curVal) * 2.4 + (safety - 0.72) * 0.9 - d * 0.004 + noise();
        let kind = 'ground';
        // 直塞
        if (q.running > 0 || (q.role === 'FW' && q.vel.x * t.attackDir > 3)) {
          const tp = V().set(q.pos.x + t.attackDir * 7, 0, q.pos.z * 0.9);
          const ts = m.laneSafety(p.pos, tp, t) * Math.min(1, m.openness(tp, t) / 5);
          const s2 = (m.posValue(tp, t) - curVal) * 2.4 + (ts - 0.72) * 1.1 + noise();
          if (s2 > s) { s = s2; kind = 'through'; }
        }
        // 传中：边路 + 队友在禁区
        const wide = Math.abs(p.pos.z) > F.boxHalfW - 2 && (p.pos.x * t.attackDir) > F.hl - 22;
        const qInBox = Math.abs(q.pos.x - gx) < F.boxDepth && Math.abs(q.pos.z) < F.boxHalfW - 3;
        if (wide && qInBox) { s += 0.3; kind = 'cross'; }
        if (safety < 0.35 && kind === 'ground') { s -= 0.25; if (d > 12) { kind = 'lob'; s += 0.12; } }
        if (s > bestPassScore) { bestPassScore = s; bestPass = q; bestKind = kind; }
      }
      const dribbleScore = 0.04 + (ahead > 7 ? 0.22 : ahead > 4 ? 0.08 : -0.06) - (pressure < 1.8 ? 0.14 : 0) + noise();
      const threshold = 0.42;
      if (shootScore > threshold && shootScore > bestPassScore - 0.05 && dGoal < 32) {
        const power = THREE.MathUtils.clamp(0.55 + dGoal / 40, 0.6, 0.97);
        doShot(m, p, power, this.aimCorner(p), { finesse: Math.random() < 0.25 && dGoal > 14, errMul: 1 + this.p.aimErr * 6 });
        return;
      }
      if (bestPass && bestPassScore > dribbleScore) {
        doPass(m, p, bestKind, bestPass.pos.clone().sub(p.pos), bestPass, { err: 1 + this.p.aimErr * 4, arriveH: bestKind === 'cross' ? 1.7 : 0.6 });
        return;
      }
      // 花式过人
      if (pressure < 2.2 && Math.random() < this.p.skill * 0.5) {
        const opp = m.nearestOpponent(p);
        const away = V().set(p.pos.x - opp.pos.x, 0, p.pos.z - opp.pos.z).normalize();
        const side = V().set(-p.facing.z, 0, p.facing.x);
        if (side.dot(away) < 0) side.negate();
        side.add(V().set(t.attackDir * 0.6, 0, 0)).normalize();
        doSkill(m, p, side);
        return;
      }
    }

    // 盘带方向：势场
    const dir = V().set(gx - p.pos.x, 0, -p.pos.z * 0.5).normalize();
    for (const o of m.teams[1 - t.idx].active) {
      const dx = p.pos.x - o.pos.x, dz = p.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 8 || d < 0.01) continue;
      const ahead = (o.pos.x - p.pos.x) * t.attackDir > -1;
      const w = (ahead ? 2.4 : 0.8) / (d * d) * 6;
      dir.x += dx / d * w * 0.3; dir.z += dz / d * w * 0.5;
    }
    if (Math.abs(p.pos.z) > F.hw - 4) dir.z -= Math.sign(p.pos.z) * 0.8;
    dir.normalize();
    p.moveInput.copy(dir);
    p.sprint = pressure > 3 && p.stamina > 25 && dGoal > 12;
  }

  aimCorner(p) {
    const gk = this.m.teams[1 - p.team.idx].keeper;
    let side = gk ? (gk.pos.z > p.pos.z * 0.1 ? -1 : 1) : (Math.random() < 0.5 ? 1 : -1);
    if (Math.random() < 0.2) side = -side;
    return { tz: side * (F.goalHalfW - 0.5 - Math.random() * 0.6), ty: Math.random() < 0.5 ? 0.35 : 0.8 + Math.random() * 1.2 };
  }

  // ================= 门将 =================
  keeper(gk, dt) {
    const m = this.m, t = this.team, ball = m.ball;
    if (ball.heldBy === gk) return;
    const side = -t.attackDir;               // 本方球门所在 x 符号
    const gx = side * F.hl;
    const skill = this.p.keeper * (0.75 + gk.stats.gk / 100 * 0.35);
    // 门将默认面向来球方向横移
    const fb = V().set(ball.pos.x - gk.pos.x, 0, ball.pos.z - gk.pos.z);
    if (fb.lengthSq() < 0.01 || fb.x * t.attackDir < 0.3) fb.set(t.attackDir, 0, fb.z * 0.3);
    gk.faceLock = (gk.faceLock || V()).copy(fb.normalize());

    // 射门扑救：读球 → 横移 → 在来球前 0.4 秒起跳
    if (!ball.owner && !ball.heldBy && ball.vel.x * side > 4) {
      if (ball.kickId !== gk.readKick) { gk.readKick = ball.kickId; gk.reactLeft = Math.max(0.03, 0.2 - skill * 0.16) + (ball.kickType === 'super' ? 0.08 : 0); gk.plan = null; }
      gk.reactLeft -= dt;
      if (!gk.plan && gk.reactLeft <= 0 && gk.canAct) {
        const pr = m.predictCross(gk.pos.x);
        const onTarget = m.predictCross(gx);
        const threat = onTarget && Math.abs(onTarget.z) < F.goalHalfW + 0.4 && onTarget.y < F.goalH + 0.25;
        if (pr && pr.t < 1.8 && threat) {
          const adz = Math.abs(pr.z - gk.pos.z);
          const sp = ball.vel.length();
          const isSuper = ball.kickType === 'super';
          let reach = 2.3 + skill * 1.5 + Math.min(0.6, pr.t * 0.5);
          if (isSuper) reach *= 0.62;
          const hi = pr.y > 1.8;
          if (hi && adz > 1.5) reach -= 0.3;
          let pSave = 0.5 + skill * 0.45 - Math.max(0, sp - 26) * 0.018 - (isSuper ? 0.5 : 0) - (hi && adz > 2.2 ? 0.12 : 0) + (adz < 1.2 ? 0.2 : 0) + Math.max(0, pr.t - 0.45) * 0.4;
          gk.plan = { willSave: adz <= reach && Math.random() < pSave, kick: ball.kickId };
        }
      }
      if (gk.plan && gk.canAct) {
        const pr = m.predictCross(gk.pos.x);
        if (!pr) gk.plan = null;
        else {
          const dz = pr.z - gk.pos.z, adz = Math.abs(dz);
          const hi = pr.y > 1.8, low = pr.y < 0.6;
          if (adz < 0.8 && pr.y < 2.35) {
            if (pr.t < 0.32) { gk.setState('catch', 0.6, { low: pr.y < 0.8, willSave: gk.plan.willSave || Math.random() < 0.8 }); gk.plan = null; }
            else this.moveTo(gk, gk.pos.x, pr.z, false, 0.05);
            return;
          }
          if (pr.t <= 0.42) {
            const need = Math.max(0, adz - 1.75);
            const dsp = THREE.MathUtils.clamp(need / Math.max(0.16, pr.t - 0.04), 0.5, 7.5) * (gk.plan.willSave ? 1 : 0.55);
            const dir = V().set(0, 0, Math.sign(dz));
            const left = V().set(gk.facing.z, 0, -gk.facing.x);
            gk.setState('dive', 0.95, { dir, speed: dsp, side: Math.sign(dir.dot(left)) || 1, high: hi, low, willSave: gk.plan.willSave });
            gk.plan = null;
            m.audio.whoosh();
            return;
          }
          // 横移封角
          gk.moveInput.set(0, 0, THREE.MathUtils.clamp(dz, -1, 1));
          gk.sprint = adz > 2;
          gk.ready = 1;
          return;
        }
      }
    } else if (ball.owner || ball.heldBy) gk.plan = null;

    if (!gk.canAct) return;
    const inBox = m.inOwnBox(t, ball.pos);
    const bdGoal = Math.hypot(ball.pos.x - gx, ball.pos.z);

    // 出击：松球 / 单刀
    const ic = m.icpt.get(gk);
    const oppIc = m.bestInterceptor(m.teams[1 - t.idx], false);
    if (!ball.owner && ic && m.inOwnBox(t, V().set(ic.x, 0, ic.z)) && (!oppIc || ic.t < (m.icpt.get(oppIc.p)?.t ?? 99) + 0.1) && ball.vel.length() < 16) {
      this.moveTo(gk, ic.x, ic.z, true, 0.05);
      gk.ready = 0;
      gk.faceLock = null;
      return;
    }
    if (ball.owner && ball.owner.team !== t && inBox && bdGoal < 13) {
      const c = ball.owner;
      const d = gk.pos.distanceTo(c.pos);
      const defendersCloser = t.active.some(q => !q.isGK && q.pos.distanceTo(c.pos) < Math.min(d, 3));
      if (!defendersCloser) {
        this.moveTo(gk, c.pos.x + c.facing.x * 0.8, c.pos.z + c.facing.z * 0.8, true, 0.1);
        gk.faceLock = null;
        if (d < 2.2 && gk.canAct && Math.random() < dt * (2 + skill * 4)) {
          const dir = V().set(ball.pos.x - gk.pos.x, 0, ball.pos.z - gk.pos.z).normalize();
          const left = V().set(gk.facing.z, 0, -gk.facing.x);
          gk.setState('dive', 0.9, { dir, speed: 4.5, side: Math.sign(dir.dot(left)) || 1, low: true, willSave: Math.random() < 0.45 + skill * 0.4, smother: true });
        }
        return;
      }
    }

    // 站位：球与球门中心连线上
    const bx = ball.pos.x, bz = ball.pos.z;
    const toBall = V().set(bx - gx, 0, bz).normalize();
    const dOff = THREE.MathUtils.clamp(0.8 + bdGoal * 0.075, 0.8, 4.2);
    let tx = gx + toBall.x * dOff, tz = toBall.z * dOff;
    tz = THREE.MathUtils.clamp(tz, -F.goalHalfW + 0.5, F.goalHalfW - 0.5);
    if (bdGoal > 50) { tx = gx - side * 6; tz = 0; }
    this.moveTo(gk, tx, tz, bdGoal < 20 && gk.pos.distanceTo(tmp.set(tx, 0, tz)) > 2, 0.25);
    gk.ready = bdGoal < 28 ? 1 : 0.3;
  }
}
