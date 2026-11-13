import * as THREE from 'three';
import { SportBase, hashStr, makeBlob } from './base.js';
import { Athlete } from './athlete.js';
import { canvas, toTex } from '../gfx/textures.js';
import { ALLY_AI } from '../config.js';

// ================= 3v3 全场街机篮球 =================
// 队伍 0 进攻 +x 方向的篮筐，队伍 1 进攻 -x。镜头在 +z 一侧的转播机位。
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const G = 17, BALL_R = 0.14;
const ROLES = [{ role: 'PG', src: 3, num: 8 }, { role: 'SF', src: 2, num: 7 }, { role: 'C', src: 4, num: 9 }];
const SPOTS = [[7.7, 0], [5.4, -5.5], [5.4, 5.5], [1.3, -6.3], [1.3, 6.3], [3.0, -2.6], [3.0, 2.6]];
const HINT = '<span class="spn">进攻</span><b>J</b> 传球 · <b>K</b> 按住投篮（绿区松手）· 篮下 <b>K</b> 上篮 / 冲刺中 <b>K</b> 扣篮 · <b>空格</b> 变向　<span class="spn">防守</span><b>J</b> 抢断 · <b>K</b> 封盖/抢板 · <b>Q</b> 换人';

export class BasketballMatch extends SportBase {
  setup(cfg) {
    this.begin(cfg, 'basketball');
    const C = this.C;
    const aiMul = [0.9, 0.96, 1.0, 1.05][['easy', 'normal', 'hard', 'legend'].indexOf(this.diff.key)] ?? 0.96;
    for (const t of this.teams) {
      t.dir = t.idx === 0 ? 1 : -1;
      t.hoop = V(t.dir * C.hoopX, C.rimY, 0);
      t.players = [];
      t.ai = t.humans.length ? ALLY_AI : this.diff;
      t.skill = t.humans.length ? 0.5 : this.skill;
      t.stats = { fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0, stl: 0, blk: 0, dunk: 0 };
      const r = t.data.rating;
      ROLES.forEach((R, i) => {
        const a = new Athlete(this.scene, { kit: t.kit, number: R.num, name: t.data.players[R.src], seed: hashStr(t.data.id + R.src + t.data.players[R.src]), sport: 'basketball', team: t.idx, idx: i + t.idx * 3 });
        const star = t.data.star === R.src ? 6 : 0;
        a.slot = i; a.role = R.role; a.dir = t.dir;
        a.sht = r.att + star + (i === 1 ? 3 : 0); a.pas = r.pas; a.def = r.def + (i === 2 ? 5 : 0); a.spd = r.spd + star * 0.5 + (i === 0 ? 4 : -i);
        a.baseSpeed = 5.7 * (0.82 + a.spd / 100 * 0.3) * (t.humans.length ? 1 : aiMul);
        a.line = { pts: 0, reb: 0, stl: 0, blk: 0 };
        a.ai = { think: Math.random() * 0.3, spotT: 0, spot: V(), hold: 0, cut: 0, contest: -1 };
        a.cd = { steal: 0, jump: 0, skill: 0 };
        a.controller = null; a.fin = null;
        t.players.push(a); this.athletes.push(a);
      });
      t.humans.forEach((h, i) => { h.turbo = 100; h.bar = 100; h.shot = null; this.control(h, t.players[i % 3]); });
    }
    this.buildBall();
    this.total = cfg.duration || 180;
    this.half = 1; this.clock = this.total / 2; this.shotClock = 24; this.ot = false; this.buzzer = false;
    this.poss = 0; this.shotId = 0;
    this.hintT = this.humans.length ? 9 : 0;
    this.arrange(0, true);
    this.updateBoard();
    this.startIntro(V(0, 1.2, 0), 15);
  }

  buildBall() {
    const [cv, g] = canvas(256, 128);
    g.fillStyle = '#d9641c'; g.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 1500; i++) { g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'; g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2); }
    g.strokeStyle = '#1b1109'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
    for (const x of [0, 128, 255]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    for (const x of [64, 192]) { g.beginPath(); g.ellipse(x, 64, 44, 60, 0, 0, Math.PI * 2); g.stroke(); }
    const mesh = this.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 20), new THREE.MeshStandardMaterial({ map: toTex(cv), roughness: 0.7 })));
    mesh.castShadow = true;
    const blob = this.add(makeBlob(0.6));
    this.ball = { mesh, blob, pos: mesh.position, vel: V(), state: 'held', owner: null, lastTeam: 0, t: 0, fromShot: false, fire: 0, drib: 0 };
  }

  control(h, p) {
    if (!p || (p.controller && p.controller !== h)) return;
    if (h.athlete) h.athlete.controller = null;
    h.athlete = p; p.controller = h;
    h.shot = null; h.charge = null;
  }

  team(p) { return this.teams[p.team]; }
  hoopDist(p) { const t = this.team(p); return Math.hypot(p.pos.x - t.hoop.x, p.pos.z); }
  nearestOpp(p, from = p.pos) {
    let best = null, bd = 1e9;
    for (const o of this.teams[1 - p.team].players) { const d = d2(o.pos, from); if (d < bd) { bd = d; best = o; } }
    return { o: best, d: bd };
  }
  // 线段 a→b 附近（宽度 w 内）是否有对方球员
  laneBlocked(p, a, b, w = 1.1) {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-6;
    for (const o of this.teams[1 - p.team].players) {
      if (o.stun > 0) continue;
      const u = clamp(((o.pos.x - a.x) * dx + (o.pos.z - a.z) * dz) / L2, 0.08, 0.95);
      if (Math.hypot(a.x + dx * u - o.pos.x, a.z + dz * u - o.pos.z) < w) return o;
    }
    return null;
  }

  // ---------- 站位（开球 / 进球后发球） ----------
  arrange(teamIdx, first = false) {
    const C = this.C, t = this.teams[teamIdx], o = this.teams[1 - teamIdx], d = t.dir;
    const off = [[-(C.halfL - 2.2), 0], [-5, -4.6], [-2.5, 3.8]], def = [[2.5, 0], [5.5, -3.6], [8.2, 2.6]];
    t.players.forEach((p, i) => p.teleport(d * off[i][0], off[i][1], d, 0));
    o.players.forEach((p, i) => p.teleport(d * def[i][0], def[i][1], -d, 0));
    for (const p of this.athletes) { p.manualY = false; p.fin = null; p.faceLock = null; p.pos.y = 0; p.ai.hold = 0; p.ai.spotT = 0; }
    this.give(t.players[0], true);
    this.shotClock = 24;
    this.state = 'ready'; this.stateT = first ? 0.2 : 0.9;
    // 真人：进攻方控制持球人，防守方控制对位者
    t.humans.forEach((h, i) => this.control(h, t.players[i % 3]));
    o.humans.forEach((h, i) => this.control(h, o.players[i % 3]));
  }

  give(p, silent = false) {
    const b = this.ball;
    const changed = this.poss !== p.team;
    b.state = 'held'; b.owner = p; b.lastTeam = p.team; b.vel.set(0, 0, 0); b.fire = 0;
    this.poss = p.team;
    if (changed) { this.shotClock = 24; for (const a of this.athletes) { a.ai.spotT = 0; a.ai.hold = 0; } }
    p.ai.hold = 0; p.ai.think = 0.25;
    if (!silent) {
      const hs = this.team(p).humans;
      if (hs.length && !p.controller) this.control(hs[0], p);
      // 防守方：自动切到离球最近的人
      if (changed && this.settings.autoSwitch) for (const dh of this.teams[1 - p.team].humans) this.switchNearest(dh);
    }
  }

  switchNearest(h) {
    const t = this.teams[h.team];
    const ref = this.ball.pos;
    let best = null, bd = 1e9;
    for (const p of t.players) { if (p.controller && p.controller !== h) continue; const d = d2(p.pos, ref); if (d < bd) { bd = d; best = p; } }
    if (best) this.control(h, best);
  }

  // ================= 主循环 =================
  update(rawDt) {
    if (this.state === 'idle') return;
    if (this.slowT > 0) { this.slowT -= rawDt; if (this.slowT <= 0) this.timeScale = 1; }
    const dt = rawDt * this.timeScale;
    this.time += dt;
    switch (this.state) {
      case 'intro':
        this.syncBall(dt);
        if (this.updIntro(dt)) { this.cam.snap(); this.audio.whistle('short'); this.state = 'ready'; this.stateT = 0.6; if (this.hintT > 0) this.hint(HINT); }
        break;
      case 'ready':
        for (const p of this.athletes) { p.move.set(0, 0, 0); this.pose(p); p.update(dt, this.time); }
        this.syncBall(dt);
        if ((this.stateT -= dt) <= 0) this.state = 'play';
        break;
      case 'play': this.updPlay(dt); break;
      case 'dead':
        this.updPlayers(dt, false); this.syncBall(dt);
        if ((this.stateT -= dt) <= 0) this.deadFn();
        break;
      case 'done': this.syncBall(dt); this.updDone(dt); break;
    }
    if (this.state !== 'intro' && this.state !== 'done') {
      const b = this.ball.pos;
      const zoom = this.dunkT > 0 ? 0.8 : 1;
      this.dunkT = Math.max(0, (this.dunkT || 0) - dt);
      this.setCam(this._v.set(b.x * 0.74, 8.6 * zoom + Math.max(0, b.y - 5) * 0.3, 17.2 * zoom + 1), V(b.x * 0.88, 1.4, 1.1), 35, 4);
      if (this.hintT > 0 && (this.hintT -= dt) <= 0) this.hint(null);
    }
    this.updateBoard();
    this.tail(dt, rawDt);
  }

  updPlay(dt) {
    const b = this.ball;
    // 计时
    if (!this.ot) {
      this.clock -= dt;
      if (this.clock <= 0 && !this.buzzer) { this.clock = 0; this.buzzer = true; this.audio.buzzer?.(); }
    }
    if (b.state === 'held' || b.state === 'pass') {
      this.shotClock -= dt;
      if (this.shotClock <= 0 && !this.buzzer) return this.violation('24 秒违例');
    }
    this.updPlayers(dt, true);
    this.syncBall(dt);
    if (this.buzzer && b.state !== 'shot' && this.state === 'play') this.endPeriod();
  }

  updPlayers(dt, live) {
    const b = this.ball;
    for (const h of this.humans) { h.turbo = Math.min(100, h.turbo + 15 * dt); h.bar = h.turbo; if (!h.shot) h.charge = null; }
    for (const p of this.athletes) {
      for (const k in p.cd) p.cd[k] = Math.max(0, p.cd[k] - dt);
      p.sprint = false; p.faceLock = null;
      if (p.fin) { this.updFinish(p, dt); }
      else if (!live) { p.move.set(0, 0, 0); if (p.controller) p.move.set(p.controller.dev.mx, 0, p.controller.dev.mz); }
      else if (p.controller) this.human(p, p.controller, dt);
      else this.aiPlayer(p, dt);
      this.pose(p);
      const hasBall = b.owner === p;
      p.speed = p.baseSpeed * (hasBall ? 0.94 : 1);
    }
    this.separate();
    for (const p of this.athletes) {
      const C = this.C, m = b.owner === p ? 0.25 : -0.7;
      if (!p.manualY) { p.pos.x = clamp(p.pos.x, -C.halfL + m, C.halfL - m); p.pos.z = clamp(p.pos.z, -C.halfW + m, C.halfW - m); }
      p.update(dt, this.time);
    }
    if (live) this.aiRelease(dt);
  }

  pose(p) {
    const b = this.ball, has = b.owner === p;
    const defending = this.poss !== p.team && (b.state === 'held' || b.state === 'pass');
    p.stance += ((defending ? 0.9 : has ? 0.35 : 0.15) - p.stance) * 0.15;
    p.dribble += ((has && !p.anim ? 1 : 0) - p.dribble) * 0.25;
  }

  separate() {
    const A = this.athletes;
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
      const a = A[i], c = A[j];
      if (a.manualY || c.manualY) continue;
      const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.78 && d > 1e-4) {
        const push = (0.78 - d) / 2, nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push; c.pos.x += nx * push; c.pos.z += nz * push;
      }
    }
  }

  // ---------- 球 ----------
  syncBall(dt) {
    const b = this.ball, C = this.C;
    b.t += dt;
    if (b.state === 'held' && b.owner) {
      const p = b.owner, f = p.facing;
      if (p.anim && (p.is('shoot') || p.is('layup') || p.is('dunk') || p.is('pass'))) {
        p.handPos(b.pos); b.pos.y += 0.1;
      } else {
        const ph = this.time * 9.5 + p.idx;
        const s = Math.abs(Math.sin(ph));
        b.pos.set(p.pos.x + f.x * 0.36 - f.z * 0.24, 0.16 + s * 0.78, p.pos.z + f.z * 0.36 + f.x * 0.24);
        const fl = Math.floor(ph / Math.PI);
        if (fl !== b.drib && this.state === 'play') { b.drib = fl; this.audio.bounce(0.22); }
      }
    } else if (b.state === 'pass') {
      const q = b.pass;
      q.t += dt;
      const u = Math.min(1, q.t / q.T);
      const tx = q.to.pos.x, tz = q.to.pos.z;
      b.pos.set(lerp(q.p0.x, tx, u), lerp(q.p0.y, 1.25, u) + Math.sin(Math.PI * u) * q.h, lerp(q.p0.z, tz, u));
      // 拦截
      if (u > 0.18 && u < 0.92) for (const o of this.teams[1 - q.from.team].players) {
        if (o.stun > 0 || q.tried.has(o)) continue;
        if (d2(o.pos, b.pos) < 0.8 && b.pos.y < (o.jumpY > 0.2 ? 3.1 : 2.25)) {
          q.tried.add(o);
          const pr = 0.3 + (o.def - 70) * 0.006 + (o.controller ? 0.3 : (this.team(o).ai.tackle - 0.9) * 0.2);
          if (Math.random() < pr) { this.steal(o, '抢断传球!'); return; }
        }
      }
      if (u >= 1) this.give(q.to);
    } else if (b.state === 'shot') {
      const s = b.shot;
      s.t += dt;
      const u = Math.min(1, s.t / s.T);
      b.pos.set(lerp(s.p0.x, s.p1.x, u), lerp(s.p0.y, s.p1.y, u) + 4 * s.h * u * (1 - u), lerp(s.p0.z, s.p1.z, u));
      if (b.fire > 0) this.fx.fireTrail(b.pos, this._v.set(s.p1.x - s.p0.x, 0, s.p1.z - s.p0.z));
      if (u >= 1) this.shotLands(s);
    } else if (b.state === 'loose' || b.state === 'drop') {
      b.vel.y -= G * dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y < BALL_R) {
        b.pos.y = BALL_R;
        if (b.vel.y < -1.2) this.audio.bounce(Math.min(0.6, -b.vel.y * 0.07));
        b.vel.y = -b.vel.y * 0.68; b.vel.x *= 0.86; b.vel.z *= 0.86;
        if (Math.abs(b.vel.y) < 0.7) b.vel.y = 0;
      }
      if (b.state === 'loose' && this.state === 'play') {
        // 篮板 / 地板球
        if (b.t > 0.22) {
          let best = null, bd = 1e9;
          for (const p of this.athletes) {
            if (p.stun > 0 || p.fin) continue;
            const d = d2(p.pos, b.pos);
            const reach = p.jumpY > 0.15 ? 2.25 + p.jumpY * 1.15 : 1.95;
            if (d < 0.95 && b.pos.y < reach && d < bd) { bd = d; best = p; }
          }
          if (best) {
            if (b.fromShot) { best.line.reb++; this.team(best).stats.reb++; if (best.team === this.poss) this.shotClock = Math.max(this.shotClock, 14); if (best.controller) this.hud.flash('篮板!', '#4dd7ff'); }
            b.fromShot = false;
            this.give(best);
            return;
          }
        }
        if (Math.abs(b.pos.x) > C.halfL + 0.4 || Math.abs(b.pos.z) > C.halfW + 0.4) this.violation('出界', 1 - b.lastTeam);
      }
    }
    b.mesh.rotation.x += dt * 6; b.mesh.rotation.z += dt * 3;
    b.blob.position.set(b.pos.x, 0.02, b.pos.z);
    b.blob.material.opacity = clamp(1 - b.pos.y / 7, 0.25, 1);
  }

  startPass(p, to, lob = false) {
    const b = this.ball;
    if (b.owner !== p || !to || to === p) return;
    const D = d2(p.pos, to.pos);
    p.play('pass', 0.3, { slow: 0.6 });
    b.state = 'pass'; b.owner = null;
    b.pass = { from: p, to, t: 0, T: Math.max(0.16, D / (lob ? 11.5 : 17.5)), p0: V(p.pos.x + p.facing.x * 0.4, 1.3, p.pos.z + p.facing.z * 0.4), h: lob ? 1.6 + D * 0.14 : 0.12 + D * 0.015, tried: new Set() };
    b.pos.copy(b.pass.p0);
    this.audio.touch();
    // 真人传球后立即控制接球人
    const hs = this.team(p).humans;
    if (p.controller && !to.controller) this.control(p.controller, to);
    else if (!to.controller && hs.length && !hs.some(h => h.athlete === p)) this.control(hs[0], to);
  }

  steal(o, text = '抢断!') {
    o.line.stl++; this.team(o).stats.stl++;
    this.hud.flash(text, '#4dd7ff');
    this.audio.thud(0.3); this.arena.cheer(0.45);
    this.hud.commentary(`${o.name} 完成抢断！`);
    this.give(o);
  }

  attemptSteal(p) {
    if (p.cd.steal > 0 || p.busy) return;
    p.cd.steal = 0.85;
    p.play('steal', 0.36, { lock: true, glide: true });
    const b = this.ball, o = b.owner;
    if (b.state !== 'held' || !o || o.team === p.team || o.fin) return;
    const d = d2(p.pos, o.pos);
    if (d > 1.5) return;
    const t = this.team(p);
    let pr = 0.15 + (p.def - 70) * 0.004 + (o.sprint ? 0.07 : 0) + (o.is('cross') ? -0.3 : 0) + (o.stun > 0 ? 0.5 : 0) + (d < 1 ? 0.06 : 0);
    pr *= p.controller ? 1.25 : clamp(t.ai.tackle, 0.5, 1.5);
    if (o.controller) pr *= 0.8;
    if (Math.random() < pr) this.steal(p);
    else p.stun = Math.max(p.stun, 0.12);
  }

  jump(p) {
    if (p.cd.jump > 0 || p.busy) return;
    p.cd.jump = 0.9;
    p.play('block', 0.62, { jump: 0.82 + (p.slot === 2 ? 0.08 : 0), lock: true, glide: true });
  }

  cross(p, side) {
    if (p.cd.skill > 0 || p.busy) return;
    p.cd.skill = 1.3;
    p.play('cross', 0.3, { side, slow: 1.25 });
    const f = p.facing;
    p.vel.x += f.z * side * 6.5 + f.x * 2; p.vel.z += -f.x * side * 6.5 + f.z * 2;
    const { o, d } = this.nearestOpp(p);
    if (o && d < 1.9 && o.stun <= 0) {
      const pr = 0.4 + (p.spd - o.def) * 0.012 + (p.controller ? 0.1 : 0) - (o.controller ? 0.15 : 0);
      if (Math.random() < pr) {
        o.stun = 0.6;
        if (p.controller || o.controller) { this.hud.flash('晃倒!', '#ffd23f'); this.audio.ooh(); }
      }
    }
    this.audio.slide();
  }

  // 投篮出手
  beginShot(p) {
    if (p.busy || this.ball.owner !== p) return false;
    this.shotId++;
    p.shotId = this.shotId;
    p.play('shoot', 1.05, { lock: true, jump: 0.42, j0: 0.28, j1: 0.98, glide: true });
    p.faceLock = null;
    const t = this.team(p);
    p.facing.set(t.hoop.x - p.pos.x, 0, -p.pos.z).normalize();
    return true;
  }

  release(p, timing) {
    const b = this.ball, t = this.team(p), a = p.anim;
    if (b.owner !== p) return;
    if (a && a.type === 'shoot') { a.released = true; a.relT = a.t; }
    const d = this.hoopDist(p);
    const three = d > this.C.three;
    this.launch(p, d, three ? 3 : 2, timing, 0.5 + d * 0.068, 0.9 + d * 0.21);
  }

  // timing: { mul, perfect }
  launch(p, d, pts, timing, T, h, layup = false) {
    const b = this.ball, t = this.team(p), C = this.C;
    let base;
    if (layup) base = 0.84;
    else if (d < 1.8) base = 0.78; else if (d < 4.5) base = lerp(0.62, 0.54, (d - 1.8) / 2.7); else if (d < 6.75) base = lerp(0.54, 0.47, (d - 4.5) / 2.25);
    else if (d < 8.5) base = lerp(0.42, 0.33, (d - 6.75) / 1.75); else if (d < 12) base = lerp(0.33, 0.08, (d - 8.5) / 3.5); else base = 0.03;
    let pm = base * (0.72 + p.sht / 100 * 0.4) * timing.mul;
    const { o, d: od } = this.nearestOpp(p);
    if (o && od < 2.2 && o.stun <= 0) {
      let f = Math.min(1, 0.55 + 0.2 * od);
      if (o.is('block') && od < 1.75) {
        const bp = 0.3 + (o.def - 70) * 0.005 + (o.controller ? 0.15 : 0) - (pts === 3 ? 0.08 : 0) - (timing.perfect ? 0.12 : 0);
        if (Math.random() < bp) return this.blocked(p, o);
        f *= 0.7;
      }
      pm *= f;
    }
    const made = Math.random() < clamp(pm, 0.02, 0.97);
    t.stats.fga++; if (pts === 3) t.stats.tpa++;
    const hoop = t.hoop;
    const p0 = p.handPos(V()); p0.y += 0.15;
    const p1 = V(hoop.x, hoop.y + 0.02, 0);
    if (!made) { const a = Math.random() * Math.PI * 2, r = C.rimR * (0.95 + Math.random() * 0.5); p1.x += Math.cos(a) * r; p1.z += Math.sin(a) * r; }
    b.state = 'shot'; b.owner = null; b.lastTeam = p.team;
    b.shot = { p, made, pts, t: 0, T, h, p0, p1, layup, perfect: timing.perfect };
    b.fire = timing.perfect && !layup ? 1 : 0;
    this.audio.touch();
    if (timing.perfect && p.controller) this.hud.flash('完美出手!', '#7dff7a');
  }

  blocked(p, o) {
    const b = this.ball;
    o.line.blk++; this.team(o).stats.blk++;
    this.team(p).stats.fga++;
    b.state = 'loose'; b.owner = null; b.t = 0; b.fromShot = false; b.lastTeam = o.team;
    p.handPos(b.pos);
    b.vel.set(-p.dir * (3 + Math.random() * 3), 3.5, (Math.random() - 0.5) * 6);
    this.hud.flash('盖帽!!', '#ff6b6b');
    this.hud.commentary(`${o.name} 送出一记大帽！`);
    this.audio.thud(0.5); this.audio.ooh(); this.arena.cheer(0.7); this.cam.shake(0.3);
    if (p.anim) { p.anim.released = true; p.anim.relT = p.anim.t; }
  }

  shotLands(s) {
    const b = this.ball, t = this.team(s.p), C = this.C;
    if (s.made) {
      t.stats.fgm++; if (s.pts === 3) t.stats.tpm++;
      this.arena.swish(t.dir, false);
      this.audio.swish?.();
      this.scored(s.p, s.pts, s.layup ? 'layup' : s.pts === 3 ? 'three' : 'two');
    } else {
      b.state = 'loose'; b.t = 0; b.fromShot = true; b.fire = 0;
      const a = (Math.random() - 0.5) * 2.4, sp = 2.2 + Math.random() * 3.6;
      b.vel.set(-t.dir * Math.cos(a) * sp, 3.2 + Math.random() * 3, Math.sin(a) * sp);
      this.audio.rim?.(); this.arena.rimShake(t.dir, 0.5);
      if (!this.buzzer) this.shotClock = Math.max(this.shotClock, 14);
    }
  }

  scored(p, pts, kind) {
    const b = this.ball, t = this.team(p);
    t.score += pts; p.line.pts += pts;
    b.state = 'drop'; b.owner = null; b.fire = 0;
    b.pos.set(t.hoop.x, t.hoop.y - 0.25, 0); b.vel.set(0, -4, 0);
    const txt = kind === 'dunk' ? '暴 扣 !!' : kind === 'three' ? '三分命中!' : kind === 'layup' ? '上篮得手' : '命中 2 分';
    if (kind === 'dunk' || kind === 'three') this.hud.banner(txt, kind === 'dunk' ? 'fire' : 'half', `${p.name} · ${t.data.name}`);
    else this.hud.flash(`${txt} · ${p.name}`, '#ffd23f');
    this.hud.commentary(kind === 'dunk' ? `${p.name} 飞身暴扣，全场沸腾！` : kind === 'three' ? `${p.name} 外线出手——三分穿针！` : `${p.name} 得到 ${pts} 分。`);
    this.audio.cheer(kind !== 'two' && kind !== 'layup'); this.arena.cheer(kind === 'dunk' ? 1 : kind === 'three' ? 0.85 : 0.5);
    if (p.controller) this.input.rumble(p.controller.dev.id, 0.7, 160);
    if (!p.fin && !p.busy) p.play('fist', 1, {});
    this.updateBoard();
    if (this.ot) { this.state = 'dead'; this.stateT = 1.6; this.deadFn = () => this.endGame(); return; }
    if (this.buzzer) { this.hud.flash('压哨球!!', '#ff6b6b'); this.state = 'dead'; this.stateT = 1.8; this.deadFn = () => this.endPeriod(); return; }
    this.state = 'dead'; this.stateT = 1.5;
    this.deadFn = () => { this.hud.fade(); this.arrange(1 - p.team); };
  }

  violation(text, toTeam = 1 - this.poss) {
    this.hud.flash(text, '#ff9a9a');
    this.audio.whistle('short');
    this.state = 'dead'; this.stateT = 1.0;
    this.ball.state = 'drop';
    this.deadFn = () => { this.hud.fade(); this.arrange(toTeam); };
  }

  // ---------- 上篮 / 扣篮 ----------
  startFinish(p, dunk) {
    if (p.busy || this.ball.owner !== p) return;
    const t = this.team(p);
    const dur = dunk ? 0.9 : 0.78;
    p.play(dunk ? 'dunk' : 'layup', dur, { lock: true });
    p.manualY = true;
    const off = dunk ? 0.5 : 1.05;
    const zc = clamp(p.pos.z, -0.9, 0.9) * (dunk ? 0.3 : 1);
    p.fin = { t: 0, dur, dunk, from: p.pos.clone(), to: V(t.hoop.x - t.dir * off, 0, zc), peak: dunk ? 1.22 : 0.72, done: false };
    p.facing.set(t.dir, 0, 0);
    if (dunk) { this.dunkT = 1.1; this.audio.whoosh(); }
  }

  updFinish(p, dt) {
    const f = p.fin, t = this.team(p), b = this.ball;
    f.t += dt;
    const u = f.t / f.dur;
    const e = smooth(Math.min(1, u / 0.55));
    p.pos.x = lerp(f.from.x, f.to.x, e); p.pos.z = lerp(f.from.z, f.to.z, e);
    p.pos.y = f.peak * Math.sin(Math.PI * Math.pow(clamp(u, 0, 1), 0.82));
    p.jumpY = p.pos.y;
    p.move.set(0, 0, 0);
    if (!f.done && u >= 0.5 && b.owner === p) {
      f.done = true;
      const { o, d } = this.nearestOpp(p);
      if (f.dunk) {
        if (o && d < 1.5 && o.is('block') && Math.random() < 0.28 + (o.controller ? 0.12 : 0)) this.blocked(p, o);
        else if (Math.random() < 0.95) {
          t.stats.fga++; t.stats.fgm++; t.stats.dunk++;
          this.arena.swish(t.dir, true); this.cam.shake(0.55); this.slow(0.3, 0.4);
          this.audio.dunk?.(); this.fx.sparks(t.hoop.x, t.hoop.y, 0, 30);
          this.scored(p, 2, 'dunk');
        } else {
          t.stats.fga++;
          b.state = 'loose'; b.owner = null; b.t = 0; b.fromShot = true; b.pos.set(t.hoop.x - t.dir * 0.2, t.hoop.y + 0.2, 0);
          b.vel.set(-t.dir * 4, 5, (Math.random() - 0.5) * 4);
          this.audio.rim?.(); this.arena.rimShake(t.dir, 1); this.hud.flash('扣飞了!', '#ff9a9a');
        }
      } else {
        this.launch(p, 1, 2, { mul: p.controller ? 1.05 : lerp(0.88, 1.1, t.skill) }, 0.32, 0.3, true);
      }
    }
    if (u >= 1) { p.fin = null; p.manualY = false; p.pos.y = 0; p.jumpY = 0; }
  }

  // ================= 真人操作 =================
  human(p, h, dt) {
    const d = h.dev, b = this.ball, t = this.team(p);
    const has = b.owner === p;
    p.move.set(d.mx, 0, d.mz);
    const moving = d.moveLen > 0.2;
    if (d.held.sprint && h.turbo > 2 && moving && !h.shot) { p.sprint = true; h.turbo = Math.max(0, h.turbo - 42 * dt); }

    if (h.shot) {
      // 投篮蓄力中
      h.shot.t += dt;
      const v = h.shot.t / 0.86;
      h.charge = { v, lo: 0.6, hi: 0.76 };
      p.move.set(0, 0, 0);
      if (b.owner !== p) { h.shot = null; return; }
      if (!d.held.shoot || v >= 1.08) {
        const perfect = v >= 0.6 && v <= 0.76;
        const off = perfect ? 0 : Math.min(Math.abs(v - 0.6), Math.abs(v - 0.76));
        const mul = perfect ? 1.42 : off < 0.1 ? 1.08 : off < 0.22 ? 0.8 : 0.5;
        if (!perfect && v < 0.3) this.hud.flash('出手太急', '#ff9a9a');
        this.release(p, { mul, perfect });
        h.shot = null; h.charge = null;
      }
      return;
    }
    if (p.busy) return;

    if (has) {
      const dist = this.hoopDist(p);
      if (d.pressed('shoot')) {
        const front = (t.hoop.x - p.pos.x) * t.dir > -0.2;
        if (dist < 3.0 && front) this.startFinish(p, d.held.sprint || dist < 1.4 && Math.hypot(p.vel.x, p.vel.z) > 5);
        else if (this.beginShot(p)) h.shot = { t: 0 };
        return;
      }
      const mates = t.players.filter(m => m !== p);
      if (d.pressed('pass') || d.pressed('lob')) {
        const ix = moving ? d.mx : p.facing.x, iz = moving ? d.mz : p.facing.z, il = Math.hypot(ix, iz) || 1;
        let best = mates[0], bs = -9;
        for (const m of mates) {
          const dx = m.pos.x - p.pos.x, dz = m.pos.z - p.pos.z, D = Math.hypot(dx, dz) || 1;
          const s = (dx * ix + dz * iz) / (D * il) - D * 0.01;
          if (s > bs) { bs = s; best = m; }
        }
        this.startPass(p, best, d.pressed('lob'));
        return;
      }
      if (d.pressed('through')) {
        const m = mates.slice().sort((x, y) => this.hoopDist(x) - this.hoopDist(y))[0];
        this.startPass(p, m, !!this.laneBlocked(p, p.pos, m.pos, 0.9));
        return;
      }
      if (d.pressed('skill')) {
        const f = p.facing;
        const s = moving ? Math.sign(d.mx * f.z - d.mz * f.x) || 1 : (Math.random() < 0.5 ? 1 : -1);
        this.cross(p, s);
      }
    } else {
      const offense = this.poss === p.team && (b.state === 'held' || b.state === 'pass');
      if (offense) {
        // 无球：J 要球
        if (d.pressed('pass') && b.state === 'held' && b.owner && b.owner.team === p.team && !b.owner.controller) this.startPass(b.owner, p, false);
      } else {
        if (b.state === 'held' && b.owner) p.faceLock = this._v.set(b.owner.pos.x - p.pos.x, 0, b.owner.pos.z - p.pos.z).normalize().clone();
        if (d.pressed('pass')) this.attemptSteal(p);
      }
      if (d.pressed('shoot')) this.jump(p);
      if (d.pressed('switch')) this.switchNearest2(h);
    }
  }

  // 切换到离球最近、且不是当前控制的队友
  switchNearest2(h) {
    const t = this.teams[h.team], ref = this.ball.pos;
    const c = t.players.filter(p => !p.controller).sort((a, b) => d2(a.pos, ref) - d2(b.pos, ref))[0];
    if (c) { this.control(h, c); this.audio.move(); }
  }

  // ================= AI =================
  aiPlayer(p, dt) {
    const b = this.ball, t = this.team(p), ai = p.ai, C = this.C;
    if (p.busy) { p.move.set(0, 0, 0); return; }
    let tx = p.pos.x, tz = p.pos.z, sprint = false;
    const go = (x, z, sp = false) => { tx = x; tz = z; sprint = sp; };

    if (b.state === 'loose') {
      // 最近的两人去抢
      const order = t.players.slice().sort((x, y) => d2(x.pos, b.pos) - d2(y.pos, b.pos));
      const rank = order.indexOf(p);
      if (rank < 2) {
        go(b.pos.x + b.vel.x * 0.25, b.pos.z + b.vel.z * 0.25, true);
        if (d2(p.pos, b.pos) < 1.3 && b.pos.y > 2.0 && b.pos.y < 3.6 && b.vel.y < 1 && Math.random() < 0.2) this.jump(p);
      } else go(-t.dir * 4, p.slot * 3 - 3);
    } else if (b.state === 'shot') {
      const sh = this.teams[b.shot.p.team];
      if (b.shot.p === p) go(p.pos.x, p.pos.z);
      else go(sh.hoop.x - sh.dir * (1.5 + p.slot * 0.7), (p.slot - 1) * 1.5 * (p.team === sh.idx ? 1 : -1), true);
    } else if (this.poss === p.team) {
      if (b.owner === p) return this.aiHandler(p, dt);
      // 无球跑位
      ai.spotT -= dt;
      if (ai.spotT <= 0) {
        ai.spotT = 2.5 + Math.random() * 3;
        if (Math.random() < 0.22) { ai.spot.set(t.hoop.x - t.dir * 1.6, 0, (Math.random() - 0.5) * 2); ai.spotT = 1.3; }
        else {
          let best = null, bs = -1e9;
          for (const s of SPOTS) {
            const x = t.hoop.x - t.dir * s[0], z = s[1];
            let sc = Math.random() * 2.5;
            for (const m of t.players) if (m !== p) sc += Math.min(5, Math.hypot((m === b.owner ? m.pos.x : m.ai.spot.x) - x, (m === b.owner ? m.pos.z : m.ai.spot.z) - z));
            if (sc > bs) { bs = sc; best = [x, z]; }
          }
          ai.spot.set(best[0], 0, best[1]);
        }
      }
      go(ai.spot.x, ai.spot.z, d2(p.pos, ai.spot) > 5);
    } else {
      // 盯人防守
      const o = this.teams[1 - p.team], man = o.players[p.slot];
      const own = V(-t.dir * C.hoopX, 0, 0);
      const onBall = b.owner === man;
      const dx = own.x - man.pos.x, dz = own.z - man.pos.z, D = Math.hypot(dx, dz) || 1;
      let gap = onBall ? 1.2 : Math.min(D * 0.45, 2.3);
      let gx = man.pos.x + dx / D * gap, gz = man.pos.z + dz / D * gap;
      if (!onBall && b.owner) { gx = lerp(gx, b.owner.pos.x, 0.18); gz = lerp(gz, b.owner.pos.z, 0.18); }
      go(gx, gz, d2(p.pos, { x: gx, z: gz }) > 3);
      const look = b.owner || man;
      p.faceLock = V(look.pos.x - p.pos.x, 0, look.pos.z - p.pos.z).normalize();
      if (onBall) {
        const d = d2(p.pos, man.pos);
        if (d < 1.4 && !man.fin && Math.random() < 0.34 * t.ai.tackle * dt) this.attemptSteal(p);
        if ((man.is('shoot') || man.fin) && ai.contest !== man.shotId + (man.fin ? 1000 : 0) && d < 2.5) {
          ai.contest = man.shotId + (man.fin ? 1000 : 0);
          if (Math.random() < 0.22 + t.skill * 0.6) this.jump(p);
        }
      }
    }
    const dx = tx - p.pos.x, dz = tz - p.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.2) p.move.set(dx / d, 0, dz / d).multiplyScalar(Math.min(1, d / 0.6)); else p.move.set(0, 0, 0);
    p.sprint = sprint && d > 1.5;
  }

  aiHandler(p, dt) {
    const t = this.team(p), ai = p.ai, hoop = t.hoop;
    ai.hold += dt;
    const d = this.hoopDist(p);
    const { o: def, d: open } = this.nearestOpp(p);
    const sk = t.skill;
    const front = p.pos.x * t.dir > 0.5;
    let tx = hoop.x - t.dir * 1.2, tz = 0, sprint = false;

    if ((ai.think -= dt) <= 0) {
      ai.think = 0.22 + Math.random() * 0.12;
      const hurry = this.shotClock < 2.6 || (!this.ot && this.clock < 1.6);
      // 篮下终结
      if (d < 2.4) { this.startFinish(p, p.spd + p.sht > 150 + Math.random() * 30 || Math.random() < 0.3); return; }
      if (hurry && d < 11) { if (this.beginShot(p)) ai.rel = 0.5 + Math.random() * 0.25; return; }
      // 投篮
      if (front && d < 8.2) {
        const three = d > this.C.three;
        const need = 1.5 + (1 - sk) * 0.5;
        let rate = d < 4.5 ? 0.5 : three ? 0.24 * (p.sht / 78) : 0.3;
        if (ai.hold > 5) rate += 0.3;
        if (three && d > 7.6) rate *= 0.4;
        if ((open > need || ai.hold > 6.5) && Math.random() < rate) { if (this.beginShot(p)) ai.rel = 0.55 + Math.random() * 0.2; return; }
      }
      // 传球
      const mine = Math.min(open, 4) + (9 - Math.min(9, d)) * 0.32;
      let best = null, bs = mine + 0.9 - Math.min(1.5, ai.hold * 0.25);
      for (const m of t.players) {
        if (m === p) continue;
        const mo = this.nearestOpp(m).d, md = this.hoopDist(m);
        let sc = Math.min(mo, 4) + (9 - Math.min(9, md)) * 0.32 + Math.random() * 0.8;
        if (this.laneBlocked(p, p.pos, m.pos, 1.0)) sc -= 5;
        if (d2(p.pos, m.pos) < 2) sc -= 2;
        if (sc > bs) { bs = sc; best = m; }
      }
      if (best && Math.random() < 0.7) { this.startPass(p, best, false); return; }
      // 变向
      if (def && open < 1.7 && front && Math.random() < 0.1 + sk * 0.22) { this.cross(p, Math.random() < 0.5 ? 1 : -1); }
      ai.side = def ? Math.sign((def.pos.z - p.pos.z) * t.dir || 1) : 1;
    }
    if (p.is('shoot')) return;
    if (!front) { tx = t.dir * 2.5; tz = p.pos.z * 0.6; sprint = open > 2.5; }
    else {
      const blocker = this.laneBlocked(p, p.pos, { x: hoop.x - t.dir * 1.2, z: 0 }, 1.2);
      if (blocker && d2(blocker.pos, p.pos) < 3.2) {
        // 绕开防守人
        const s = Math.sign(p.pos.z - blocker.pos.z || ai.side || 1);
        tx = blocker.pos.x + t.dir * 0.6; tz = blocker.pos.z + s * 2.2;
        if (d < 4.2 && ai.hold > 2.2) { tx = p.pos.x; tz = p.pos.z; }
      } else sprint = d > 3;
    }
    const dx = tx - p.pos.x, dz = tz - p.pos.z, dd = Math.hypot(dx, dz);
    if (dd > 0.25) p.move.set(dx / dd, 0, dz / dd); else p.move.set(0, 0, 0);
    p.sprint = sprint;
  }

  // AI 投篮的出手时机
  aiRelease(dt) {
    for (const p of this.athletes) {
      if (p.controller || !p.is('shoot') || p.anim.released || this.ball.owner !== p) continue;
      if (p.anim.t >= (p.ai.rel || 0.6)) {
        const t = this.team(p);
        const perfect = Math.random() < 0.1 + t.skill * 0.3;
        this.release(p, { mul: perfect ? 1.3 : lerp(0.8, 1.08, t.skill) + (Math.random() - 0.5) * 0.15, perfect });
      }
    }
  }

  // ---------- 节次 ----------
  endPeriod() {
    this.buzzer = false;
    const [a, b] = this.teams;
    if (this.half === 1) {
      this.half = 2; this.clock = this.total / 2;
      this.hud.banner('中场休息', 'half', `${a.data.abbr} ${a.score} : ${b.score} ${b.data.abbr}`);
      this.audio.whistle('half');
      this.state = 'dead'; this.stateT = 2.4; this.ball.state = 'drop';
      this.deadFn = () => { this.hud.fade(); this.arrange(1); };
    } else if (a.score === b.score) {
      this.ot = true;
      this.hud.banner('加时赛', 'fire', '先得分者获胜！');
      this.audio.whistle('half');
      this.state = 'dead'; this.stateT = 2.4; this.ball.state = 'drop';
      this.deadFn = () => { this.hud.fade(); this.arrange(Math.random() < 0.5 ? 0 : 1); };
    } else this.endGame();
  }

  endGame() {
    const [a, b] = this.teams, w = a.score > b.score ? 0 : 1;
    const pct = (m, n) => `${m}/${n}`;
    const rows = [['投篮', pct(a.stats.fgm, a.stats.fga), pct(b.stats.fgm, b.stats.fga)], ['三分', pct(a.stats.tpm, a.stats.tpa), pct(b.stats.tpm, b.stats.tpa)],
      ['篮板', a.stats.reb, b.stats.reb], ['抢断', a.stats.stl, b.stats.stl], ['盖帽', a.stats.blk, b.stats.blk], ['扣篮', a.stats.dunk, b.stats.dunk]];
    const top = this.athletes.slice().sort((x, y) => (y.line.pts + y.line.reb * 0.7 + y.line.stl + y.line.blk) - (x.line.pts + x.line.reb * 0.7 + x.line.stl + x.line.blk))[0];
    for (const p of this.athletes) { p.fin = null; p.pos.y = 0; }
    this.ball.state = 'drop';
    this.finish(w, {
      rows, mvp: { name: top.name, text: `${top.line.pts} 分 ${top.line.reb} 篮板 ${top.line.stl} 抢断` },
      dunks: this.teams.map(t => t.stats.dunk), threes: this.teams.map(t => t.stats.tpm), ot: this.ot,
      topScorer: this.athletes.map(p => ({ team: p.team, pts: p.line.pts })),
    });
  }

  updateBoard() {
    const [a, b] = this.teams;
    const c = Math.max(0, Math.ceil(this.clock));
    const clk = this.ot ? '加时' : `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
    const sc = Math.max(0, Math.ceil(this.shotClock));
    this.board(`<div class="spb hoops"><b style="--c:${a.kit.primary}">${a.data.abbr}</b><em>${a.score}</em>
      <div class="mid"><span>${this.ot ? '决胜球' : this.half === 1 ? '上半场' : '下半场'}</span><strong>${clk}</strong></div>
      <em>${b.score}</em><b style="--c:${b.kit.primary}">${b.data.abbr}</b><i class="sc ${sc <= 5 ? 'low' : ''}">${sc}</i></div>`);
  }
}
