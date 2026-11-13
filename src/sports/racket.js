import * as THREE from 'three';
import { SportBase, hashStr, makeBlob, Trail } from './base.js';
import { Athlete } from './athlete.js';
import { canvas, toTex } from '../gfx/textures.js';

// ================= 网球 / 羽毛球（单打） =================
// 球网在 z=0；sz=+1 的一方在近端（靠镜头），sz=-1 在远端。操作为屏幕相对方向。
const H = 1 / 120;
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const RC = {
  tennis: {
    g: 13, drag: 0.011, vyMax: 32, r: 0.085, e: 0.76, fric: 0.76, reach: 1.8, reachH: 2.75, speed: 7.3, netMargin: 0.16,
    kinds: { pass: 'flat', shoot: 'power', lob: 'lob', through: 'slice' },
    shot: {
      flat: { s: [20, 25], depth: [0.58, 0.9], err: 0.4, name: '' },
      power: { s: [26, 33], depth: [0.66, 0.92], err: 0.85, name: '重击' },
      lob: { s: [10.5, 11.5], depth: [0.78, 0.93], err: 0.6, name: '高吊' },
      slice: { s: [12.5, 14], depth: [0.2, 0.5], err: 0.5, name: '放小球' },
      smash: { s: [34, 40], depth: [0.5, 0.8], err: 0.6, name: '扣杀' },
    },
    hint: '<b>J</b> 平击 · <b>K</b> 重击 · <b>I</b> 高吊 · <b>L</b> 放小球 · 击球瞬间按方向选落点 · 提前按键蓄势更有力',
  },
  badminton: {
    g: 11, drag: 0.12, vyMax: 17, r: 0.06, reach: 1.6, reachH: 2.95, speed: 6.4, netMargin: 0.1,
    kinds: { pass: 'drive', shoot: 'smash', lob: 'clear', through: 'drop' },
    shot: {
      drive: { s: [16, 21], depth: [0.5, 0.85], err: 0.3, name: '' },
      smash: { s: [30, 40], depth: [0.42, 0.78], err: 0.5, name: '杀球' },
      clear: { s: [13, 15], depth: [0.84, 0.95], err: 0.35, name: '高远球' },
      drop: { s: [6, 7], depth: [0.1, 0.26], err: 0.25, name: '吊球' },
    },
    hint: '<b>J</b> 平抽 · <b>K</b> 杀球（球高时）· <b>I</b> 高远球 · <b>L</b> 网前吊球 · 击球瞬间按方向选落点',
  },
};

// 2D 弹道（水平距离 / 高度），与运行时积分一致
function range2D(c, y0, vh, vy, sNet) {
  let s = 0, y = y0, yNet = null, t = 0;
  for (let i = 0; i < 1000; i++) {
    vy -= c.g * H;
    const k = Math.max(0, 1 - c.drag * Math.hypot(vh, vy) * H);
    vh *= k; vy *= k;
    const ps = s, py = y;
    s += vh * H; y += vy * H; t += H;
    if (yNet === null && s >= sNet) yNet = py + (y - py) * ((sNet - ps) / Math.max(1e-6, s - ps));
    if (y <= c.r && vy < 0) break;
  }
  return { s, yNet: yNet === null ? -1 : yNet, t };
}

function solveShot(c, from, tgt, sH) {
  const dx = tgt.x - from.x, dz = tgt.z - from.z, D = Math.hypot(dx, dz) || 1e-3;
  const sNet = Math.abs(dz) > 1e-3 && from.z * tgt.z < 0 ? Math.abs(from.z) * D / Math.abs(dz) : 1e9;
  let lo = -30, hi = c.vyMax;
  if (range2D(c, from.y, sH, hi, sNet).s < D) return null;
  for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; if (range2D(c, from.y, sH, mid, sNet).s < D) lo = mid; else hi = mid; }
  const r = range2D(c, from.y, sH, hi, sNet);
  return { vel: V(dx / D * sH, hi, dz / D * sH), yNet: r.yNet, t: r.t };
}

export class RacketMatch extends SportBase {
  setup(cfg) {
    const sport = cfg.sport;
    this.begin(cfg, sport);
    const c = this.c = RC[sport];
    const C = this.C;
    this.tennis = sport === 'tennis';
    this.netX = C.dblW + (this.tennis ? 0.9 : 0);

    // 近端 = 第一位真人所在队伍
    const near = this.humans.length ? this.humans[0].team : 0;
    this.P = this.teams.map(t => {
      const d = t.data, r = d.rating;
      const si = d.star ?? 4;
      const ath = new Athlete(this.scene, { kit: t.kit, number: [1, 4, 7, 8, 9][si] || 9, name: d.players[si] || d.players[0], seed: hashStr(d.id + si + (d.players[si] || '')), sport, team: t.idx, idx: t.idx });
      this.athletes.push(ath);
      const sz = t.idx === near ? 1 : -1;
      ath.faceLock = V(0, 0, -sz);
      ath.stance = 0.6;
      const human = t.humans[0] || null;
      if (human) { human.athlete = ath; human.swing = null; human.cd = 0; }
      const aiSpd = human ? 1 : [0.8, 0.9, 1.0, 1.07][['easy', 'normal', 'hard', 'legend'].indexOf(this.diff.key)] ?? 0.9;
      ath.speed = c.speed * (0.88 + r.spd / 100 * 0.2) * aiSpd;
      return { team: t.idx, t, ath, sz, human, power: r.att / 100, control: r.pas / 100, ai: { react: 0, spot: V(), spotT: 0, replan: 0, leave: false, serveT: 0 } };
    });

    this.buildBall();
    this.stats = this.teams.map(() => ({ aces: 0, winners: 0, errors: 0, smashes: 0, points: 0 }));
    this.maxRally = 0;
    // 计分
    this.pts = [0, 0]; this.games = [0, 0];
    this.target = cfg.length || (this.tennis ? 3 : 11);
    this.server = 0;
    this.over = null;
    this.acc = 0;
    this.updateBoard();
    this.placeForServe();
    this.startIntro(V(0, 1, 0), this.tennis ? 17 : 11);
  }

  buildBall() {
    const c = this.c;
    const g = new THREE.Group();
    if (this.tennis) {
      const [cv, x] = canvas(128, 64);
      x.fillStyle = '#d9f02b'; x.fillRect(0, 0, 128, 64);
      x.strokeStyle = '#ffffff'; x.lineWidth = 5; x.beginPath();
      for (let i = 0; i <= 128; i++) { const y = 32 + Math.sin(i / 128 * Math.PI * 4) * 16; i ? x.lineTo(i, y) : x.moveTo(i, y); }
      x.stroke();
      const m = new THREE.Mesh(new THREE.SphereGeometry(c.r, 20, 14), new THREE.MeshStandardMaterial({ map: toTex(cv), roughness: 0.85, emissive: '#5c6a00', emissiveIntensity: 0.55 }));
      m.castShadow = true;
      g.add(m);
    } else {
      const cork = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), new THREE.MeshStandardMaterial({ color: '#fffbe8', roughness: 0.6, emissive: '#555555' }));
      cork.position.z = 0.06;
      const [cv, x] = canvas(64, 32);
      x.fillStyle = 'rgba(255,255,255,0.92)'; x.fillRect(0, 0, 64, 32);
      x.strokeStyle = 'rgba(150,160,175,0.9)'; x.lineWidth = 1.5;
      for (let i = 0; i < 64; i += 4) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 32); x.stroke(); }
      x.fillStyle = 'rgba(40,120,220,0.9)'; x.fillRect(0, 0, 64, 4);
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.15, 16, 1, true), new THREE.MeshStandardMaterial({ map: toTex(cv), side: THREE.DoubleSide, roughness: 0.8, emissive: '#666666', emissiveIntensity: 0.5 }));
      skirt.rotation.x = Math.PI / 2; skirt.position.z = -0.03;
      skirt.castShadow = true;
      g.add(cork, skirt);
      g.scale.setScalar(1.5);
    }
    this.add(g);
    const blob = this.add(makeBlob(this.tennis ? 0.5 : 0.42));
    const trail = new Trail(18, this.tennis ? 0xeaff70 : 0xffffff);
    this.add(trail.line);
    // 落点提示圈
    const mark = this.add(new THREE.Mesh(new THREE.RingGeometry(0.32, 0.46, 28), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })));
    mark.rotation.x = -Math.PI / 2; mark.position.y = 0.035; mark.renderOrder = 3; mark.visible = false;
    this.ball = { g, blob, trail, mark, pos: g.position, vel: V(), live: false, lastHit: -1, bounces: 0, isServe: false, t: 0, spin: '', fire: 0, path: [], pathDead: false, netted: false };
  }

  netTop(x) { return this.tennis ? this.C.netH + (Math.abs(x) / this.netX) ** 2 * 0.12 : this.C.netH; }

  // 单步积分；返回事件 'net' | 'ground' | null
  advance(p, v) {
    const c = this.c;
    const pz = p.z, py = p.y, px = p.x;
    v.y -= c.g * H;
    const k = Math.max(0, 1 - c.drag * Math.hypot(v.x, v.y, v.z) * H);
    v.x *= k; v.y *= k; v.z *= k;
    p.x += v.x * H; p.y += v.y * H; p.z += v.z * H;
    if (pz * p.z < 0) {
      const u = pz / (pz - p.z), yc = py + (p.y - py) * u, xc = px + (p.x - px) * u;
      if (yc < this.netTop(xc) + c.r * 0.4 && Math.abs(xc) < this.netX + 0.05) {
        p.set(xc, yc, Math.sign(pz) * 0.05);
        v.z *= -0.1; v.x *= 0.3; v.y = Math.min(v.y, 0) * 0.3;
        return 'net';
      }
    }
    if (p.y <= c.r) { p.y = c.r; return 'ground'; }
    return null;
  }

  bounce(v, spin) {
    const c = this.c;
    const e = spin === 'slice' ? c.e * 0.72 : spin === 'top' ? c.e * 1.04 : c.e;
    const f = spin === 'slice' ? c.fric * 0.8 : spin === 'top' ? Math.min(0.92, c.fric * 1.16) : c.fric;
    v.y = -v.y * e; v.x *= f; v.z *= f;
  }

  // 预测轨迹（供 AI 与落点圈使用）
  predict() {
    const b = this.ball, p = b.pos.clone(), v = b.vel.clone();
    const path = b.path = [];
    b.pathDead = false; b.land = null;
    let t = 0, bn = b.bounces;
    for (let i = 0; i < 1400; i++) {
      const ev = this.advance(p, v);
      t += H;
      if (ev === 'net') { b.pathDead = true; break; }
      if (ev === 'ground') {
        if (!b.land) b.land = { x: p.x, z: p.z, t };
        if (!this.tennis || bn >= 1) break;
        bn++; this.bounce(v, b.spin);
      }
      if (i % 3 === 0) path.push({ t, x: p.x, y: p.y, z: p.z, b: bn, vy: v.y });
    }
    b.t = 0;
  }

  inCourt(x, z, tol = 0.07) { return Math.abs(x) <= this.C.halfW + tol && Math.abs(z) <= this.C.halfL + tol; }

  // ================= 主循环 =================
  update(rawDt) {
    if (this.state === 'idle') return;
    if (this.slowT > 0) { this.slowT -= rawDt; if (this.slowT <= 0) this.timeScale = 1; }
    const dt = rawDt * this.timeScale;
    this.time += dt;
    switch (this.state) {
      case 'intro':
        if (this.updIntro(dt)) { this.cam.snap(); this.startServe(); }
        break;
      case 'serve': this.updServe(dt); break;
      case 'rally': this.updRally(dt); break;
      case 'point': this.updPoint(dt); break;
      case 'done': this.updDone(dt); break;
    }
    if (this.state !== 'intro' && this.state !== 'done') this.updCam(dt);
    this.updBallVisual(dt);
    this.tail(dt, rawDt);
  }

  updCam() {
    const C = this.C, b = this.ball.pos;
    const t = this.tennis;
    const high = Math.max(0, b.y - 4) * 0.25;
    this.setCam(this._v.set(b.x * 0.16, (t ? 9.4 : 5.6) + high, C.halfL + (t ? 13.5 : 8.2) + high), V(b.x * 0.3, t ? 0.6 : 0.9, t ? 2.2 : 1.2), t ? 40 : 42, 3);
  }

  updBallVisual(dt) {
    const b = this.ball;
    b.blob.position.set(b.pos.x, 0.02, b.pos.z);
    const k = clamp(1 - b.pos.y / 9, 0.25, 1);
    b.blob.scale.setScalar(1.6 - k * 0.6); b.blob.material.opacity = k;
    const sp = b.vel.length();
    if (this.tennis) { b.g.rotation.x += sp * dt * 2; b.g.rotation.z += sp * dt; }
    else if (sp > 0.5 && b.live) b.g.lookAt(this._v.copy(b.pos).add(b.vel));
    b.trail.push(b.pos, b.live ? clamp((sp - 12) / 22, 0, 0.75) : 0);
    if (b.fire > 0 && b.live) { b.fire -= dt; this.fx.fireTrail(b.pos, b.vel); }
    b.mark.rotation.z += dt * 2;
    b.mark.scale.setScalar(1 + Math.sin(this.time * 8) * 0.08);
  }

  clampPlayer(P) {
    const C = this.C, p = P.ath.pos;
    p.x = clamp(p.x, -(C.dblW + 3), C.dblW + 3);
    const z = clamp(p.z * P.sz, this.tennis ? 0.7 : 0.5, C.halfL + (this.tennis ? 5 : 1.6));
    p.z = z * P.sz;
  }

  // ---------- 发球 ----------
  placeForServe() {
    const C = this.C, S = this.P[this.server], R = this.P[1 - this.server];
    const even = (this.tennis ? this.pts[0] + this.pts[1] : this.teams[this.server].score) % 2 === 0;
    const side = (even ? 1 : -1) * S.sz;          // 发球方站位的 x 符号（右区 = 面向球网的右手边）
    this.srvSide = side;
    if (this.tennis) {
      S.ath.teleport(side * 1.3, S.sz * (C.halfL + 0.45), 0, -S.sz);
      R.ath.teleport(-side * 2.9, R.sz * (C.halfL + 0.7), 0, -R.sz);
    } else {
      S.ath.teleport(side * 0.9, S.sz * (C.service + 0.9), 0, -S.sz);
      R.ath.teleport(-side * 1.0, R.sz * (C.halfL * 0.5), 0, -R.sz);
    }
  }

  startServe() {
    this.state = 'serve';
    this.placeForServe();
    const S = this.P[this.server];
    this.srv = { t: 0, charge: 0, go: false, kind: 'pass', aimX: 0, done: false };
    const b = this.ball;
    b.live = false; b.vel.set(0, 0, 0); b.mark.visible = false; b.fire = 0;
    b.trail.reset(b.pos);
    S.ai.serveT = 1.1 + Math.random() * 0.6;
    this.rally = 0;
    if (S.human) this.hint(`<span class="spn">发球</span>按住 <b>J</b>/<b>K</b> 蓄力，松开发球 · 左右选落点${this.tennis ? '' : ' · <b>I</b> 发高远球'}`);
    else if (this.humans.length) this.hint(this.c.hint);
    else this.hint(null);
  }

  updServe(dt) {
    const S = this.P[this.server], R = this.P[1 - this.server], b = this.ball, s = this.srv, a = S.ath;
    s.t += dt;
    for (const P of this.P) { P.ath.move.set(0, 0, 0); if (P.human) P.human.charge = null; }
    // 接发球方可以小范围调整站位
    if (R.human) { R.ath.move.set(R.human.dev.mx, 0, R.human.dev.mz); }
    if (!s.go) {
      // 球在手上
      b.pos.set(a.pos.x + S.sz * 0.28, 1.15, a.pos.z - S.sz * 0.3);
      if (S.human) {
        const d = S.human.dev;
        const held = ['pass', 'shoot', 'lob', 'through'].find(k => d.held[k]);
        if (held && s.t > 0.35) { s.kind = held; s.charge = Math.min(1, s.charge + dt / 0.75); s.holding = true; }
        if (s.holding) S.human.charge = { v: s.charge, lo: 0.8, hi: 1 };
        if (s.holding && !held) { s.go = true; s.aimX = d.mx; }
      } else if ((S.ai.serveT -= dt) <= 0) {
        s.go = true; s.charge = 0.45 + Math.random() * 0.3 + this.skill * 0.25; s.aimX = (Math.random() * 2 - 1);
        s.kind = this.tennis ? (Math.random() < 0.35 + this.skill * 0.3 ? 'shoot' : 'pass') : (Math.random() < 0.55 ? 'lob' : 'pass');
      }
      if (s.go) {
        s.t0 = s.t;
        a.play(this.tennis ? 'serve' : 'underhand', this.tennis ? 0.72 : 0.42, { hitAt: this.tennis ? 0.6 : 0.5, lock: true });
        this.hint(this.humans.length ? this.c.hint : null);
      }
    } else if (!s.done) {
      const dur = this.tennis ? 0.72 * 0.6 : 0.42 * 0.5, u = (s.t - s.t0) / dur;
      const hitY = this.tennis ? 2.72 : 1.0;
      if (this.tennis) b.pos.set(a.pos.x + S.sz * 0.2, 1.15 + (hitY - 1.15) * Math.sin(Math.min(1, u) * Math.PI / 2) + Math.sin(Math.min(1, u) * Math.PI) * 0.35, a.pos.z - S.sz * 0.35);
      else b.pos.set(a.pos.x + S.sz * 0.3, 1.15 - 0.15 * u, a.pos.z - S.sz * 0.4);
      if (u >= 1) {
        s.done = true;
        b.pos.y = hitY;
        this.serveHit(S, s);
      }
    }
    for (const P of this.P) { this.clampPlayer(P); P.ath.update(dt, this.time); }
  }

  serveHit(S, s) {
    const C = this.C, c = this.c, b = this.ball;
    const dir = -S.sz;                              // 目标所在半场的 z 符号
    const boxX = -this.srvSide;                     // 对角发球区的 x 符号
    let tgt, sH, name = '';
    const perfect = s.charge >= 0.8;
    if (this.tennis) {
      const fast = s.kind === 'shoot';
      const cx = boxX * C.halfW * 0.5 + clamp(s.aimX, -1, 1) * (C.halfW * 0.5 - 0.55);
      tgt = V(cx, 0, dir * C.service * (fast ? 0.86 : 0.74));
      sH = (fast ? 26 : 21) + s.charge * (fast ? 12 : 8) * (0.8 + S.power * 0.3);
      if (s.kind === 'lob' || s.kind === 'through') { sH = 17; b.spin = 'slice'; } else b.spin = fast ? '' : 'top';
    } else {
      const high = s.kind === 'lob' || s.kind === 'shoot';
      const cx = boxX * C.halfW * 0.5 + clamp(s.aimX, -1, 1) * (C.halfW * 0.5 - 0.35);
      tgt = V(cx, 0, dir * (high ? C.halfL - 0.75 : C.service + 0.35 + (1 - s.charge) * 0.5));
      sH = high ? 14 : 5.5;
      b.spin = '';
    }
    const r = this.aimSolve(b.pos, tgt, sH);
    b.vel.copy(r.vel);
    b.live = true; b.lastHit = S.team; b.bounces = 0; b.isServe = true; b.netted = false; b.touched = false;
    b.fire = this.tennis && perfect && s.kind === 'shoot' ? 0.5 : 0;
    this.audio.racket?.(this.tennis ? 0.6 + s.charge * 0.4 : 0.3, this.tennis);
    if (this.tennis && perfect && s.kind === 'shoot' && S.human) this.hud.flash('大力发球!', '#ffd23f');
    this.predict();
    this.onOpponentHit(this.P[1 - S.team]);
    this.rally = 1;
    this.state = 'rally';
    if (S.human) S.human.charge = null;
  }

  // 解出能过网并落在目标点的初速度
  aimSolve(from, tgt, sH) {
    const c = this.c;
    tgt = tgt.clone();
    let best = null, lowered = false;
    for (let i = 0; i < 18; i++) {
      const r = solveShot(c, from, tgt, sH);
      if (!r) { if (lowered) tgt.z *= 0.9; else sH *= 1.15; continue; }
      best = r;
      if (r.yNet >= 0 && r.yNet < this.netTop(0) + c.r + c.netMargin) { sH *= 0.9; lowered = true; continue; }
      break;
    }
    return best || { vel: V((tgt.x - from.x), 9, (tgt.z - from.z)).multiplyScalar(0.9), t: 1 };
  }

  // ---------- 回合 ----------
  updRally(dt) {
    const b = this.ball;
    for (const P of this.P) {
      if (P.human) this.controlHuman(P, dt); else this.controlAI(P, dt);
      this.clampPlayer(P);
      P.ath.update(dt, this.time);
    }
    this.acc += dt;
    while (this.acc >= H && this.state === 'rally') {
      this.acc -= H;
      b.t += H;
      const ev = this.advance(b.pos, b.vel);
      if (ev === 'net') { b.netted = true; this.arena.netHit(); this.audio.thud(0.25); }
      else if (ev === 'ground') this.onGround();
    }
  }

  onGround() {
    const b = this.ball, C = this.C;
    const sideTeam = this.P.find(P => P.sz === (b.pos.z >= 0 ? 1 : -1)).team;   // 落在谁的半场
    const hitter = b.lastHit, other = 1 - hitter;
    let inb = this.inCourt(b.pos.x, b.pos.z);
    if (b.isServe && b.bounces === 0) {
      const okX = b.pos.x * -this.srvSide > -0.07;
      const az = Math.abs(b.pos.z);
      inb = inb && okX && (this.tennis ? az <= C.service + 0.07 : az >= C.service - 0.07);
    }
    this.audio.bounce(this.tennis ? 0.5 : 0.2);
    if (this.tennis) {
      if (b.bounces === 0) {
        if (sideTeam === hitter) return this.point(other, b.netted ? '下网' : '未过网', 'err');
        if (!inb) return this.point(other, b.isServe ? '发球出界' : '出界', 'err');
        b.bounces = 1;
        this.bounce(b.vel, b.spin);
        this.fx.kickPuff(b.pos.x, b.pos.z, 4);
        b.mark.visible = false;
      } else {
        return this.point(hitter, b.isServe && !b.touched ? 'ACE!' : '制胜分', b.isServe && !b.touched ? 'ace' : 'win');
      }
    } else {
      b.vel.set(0, 0, 0);
      if (sideTeam === hitter) return this.point(other, b.netted ? '下网' : '未过网', 'err');
      if (!inb) return this.point(other, b.isServe ? '发球出界' : '出界', 'err');
      return this.point(hitter, b.isServe && !b.touched ? 'ACE!' : '落地得分', b.isServe && !b.touched ? 'ace' : 'win');
    }
  }

  canHit(P, ext = 1) {
    const b = this.ball, c = this.c;
    if (!b.live || b.lastHit === P.team) return false;
    if (this.tennis && b.isServe && b.bounces === 0) return false;
    if (b.pos.z * P.sz < 0.03 || b.pos.y > c.reachH || b.pos.y < 0.04) return false;
    return Math.hypot(b.pos.x - P.ath.pos.x, b.pos.z - P.ath.pos.z) <= c.reach * ext;
  }

  controlHuman(P, dt) {
    const h = P.human, d = h.dev, a = P.ath;
    a.move.set(d.mx, 0, d.mz);
    h.cd -= dt;
    if (!h.swing && h.cd <= 0 && !a.busy) {
      const key = ['shoot', 'pass', 'lob', 'through'].find(k => d.pressed(k));
      if (key) {
        h.swing = { key, t: 0 };
        a.play(this.strokeType(P), 0.6, { hitAt: 0.55, slow: 0.75 });
      }
    }
    if (h.swing) {
      h.swing.t += dt;
      if (this.canHit(P, 1.35)) {
        const dist = Math.hypot(this.ball.pos.x - a.pos.x, this.ball.pos.z - a.pos.z);
        const stretch = clamp((dist - this.c.reach * 0.6) / (this.c.reach * 0.75), 0, 1);
        const t = h.swing.t;
        const perfect = t > 0.14 && t < 0.34 && stretch < 0.5;
        const power = clamp(0.3 + t / 0.3 * 0.7, 0.3, 1);
        const depth = -d.mz * P.sz;
        this.hit(P, this.c.kinds[h.swing.key], { x: d.mx, depth, power, quality: 1 - stretch * 0.85, perfect, human: true });
        h.swing = null; h.cd = 0.18;
      } else if (h.swing.t > 0.52) { h.swing = null; h.cd = 0.1; this.audio.whoosh(); }
    }
  }

  strokeType(P) {
    const b = this.ball, a = P.ath;
    if (b.pos.y > 2.0 || (!this.tennis && b.vel.y < 0 && b.pos.y > 1.8)) return 'overhead';
    if (!this.tennis && b.pos.y < 0.9) return 'underhand';
    return (b.pos.x - a.pos.x) * P.sz >= -0.15 ? 'forehand' : 'backhand';
  }

  onOpponentHit(R) {
    // 轮到 R 接球：AI 反应时间与取舍；真人显示落点圈
    const b = this.ball;
    R.ai.react = this.diff.react * 0.75 + Math.random() * 0.06;
    R.ai.replan = 0;
    const land = b.land;
    const out = !land || b.pathDead || !this.inCourt(land.x, land.z, 0.25) || land.z * R.sz < 0;
    R.ai.leave = out && Math.random() < 0.55 + this.skill * 0.42;
    b.mark.visible = !!(R.human && land && !b.pathDead);
    if (land) { b.mark.position.set(land.x, 0.035, land.z); b.mark.material.color.set(out ? 0xff5a5a : 0xffe066); }
  }

  planIntercept(P) {
    const b = this.ball, c = this.c, a = P.ath, ai = P.ai;
    let pick = null, last = null;
    const nearNet = Math.abs(a.pos.z) < 4.5;
    for (const q of b.path) {
      if (q.t < b.t + 0.05 || q.z * P.sz < 0.35) continue;
      let ok;
      if (this.tennis) ok = (q.b === 1 && q.y >= 0.45 && q.y <= 1.7 && q.vy <= 1.5) || (q.b === 0 && nearNet && q.y >= 0.8 && q.y <= 2.4 && Math.abs(q.z) < 5);
      else ok = q.y <= 2.7 && q.y >= 0.3;
      if (!ok) continue;
      last = q;
      const need = Math.max(0, Math.hypot(q.x - a.pos.x, q.z - a.pos.z) - c.reach * 0.55) / a.speed;
      if (need <= q.t - b.t) { pick = q; break; }
    }
    pick = pick || last;
    if (!pick) { for (const q of b.path) if (q.t > b.t && q.z * P.sz > 0.35) { pick = q; } }
    if (pick) { ai.spot.set(pick.x - P.sz * 0.42, 0, pick.z + P.sz * 0.15); ai.spotT = pick.t; ai.has = true; } else ai.has = false;
  }

  controlAI(P, dt) {
    const b = this.ball, a = P.ath, ai = P.ai, C = this.C;
    const incoming = b.live && b.lastHit !== P.team && !b.pathDead && !ai.leave;
    let tx, tz;
    if (incoming) {
      ai.react -= dt;
      if ((ai.replan -= dt) <= 0) { this.planIntercept(P); ai.replan = 0.15; }
      if (ai.react > 0 || !ai.has) { tx = a.pos.x; tz = a.pos.z; } else { tx = ai.spot.x; tz = ai.spot.z; }
      if (this.canHit(P, 0.9)) {
        const ready = this.tennis
          ? (b.t >= ai.spotT - 0.04 || (b.bounces >= 1 && b.vel.y < 0 && b.pos.y < 0.85))
          : true;
        if (ready) this.aiHit(P);
      }
    } else {
      tx = 0; tz = P.sz * (this.tennis ? C.halfL + 0.5 : C.halfL * 0.52);
    }
    const dx = tx - a.pos.x, dz = tz - a.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.12) a.move.set(dx / d, 0, dz / d).multiplyScalar(Math.min(1, d / 0.5)); else a.move.set(0, 0, 0);
  }

  aiHit(P) {
    const b = this.ball, C = this.C, O = this.P[1 - P.team], sk = this.skill;
    const dist = Math.hypot(b.pos.x - P.ath.pos.x, b.pos.z - P.ath.pos.z);
    const stretch = clamp((dist - this.c.reach * 0.55) / (this.c.reach * 0.45), 0, 1);
    const away = -Math.sign(O.ath.pos.x || (Math.random() - 0.5));
    let x = Math.random() < 0.45 + sk * 0.5 ? away * (0.35 + Math.random() * 0.6) : Math.random() * 2 - 1;
    let depth = Math.random() * 1.4 - 0.4;
    let kind;
    const oz = Math.abs(O.ath.pos.z);
    if (this.tennis) {
      if (b.pos.y > 1.9 && Math.abs(P.ath.pos.z) < 6) kind = 'power';
      else if (oz < 4.5 && Math.random() < 0.55) kind = 'lob';
      else if (oz > C.halfL - 0.5 && Math.random() < 0.06 + sk * 0.12) kind = 'slice';
      else kind = Math.random() < 0.2 + sk * 0.35 ? 'power' : 'flat';
    } else {
      if (b.pos.y > 2.05) kind = Math.random() < 0.4 + sk * 0.4 ? 'smash' : Math.random() < 0.6 ? 'clear' : 'drop';
      else if (b.pos.y < 1.0) kind = Math.random() < 0.6 ? 'clear' : Math.random() < 0.6 ? 'drop' : 'drive';
      else kind = Math.random() < 0.45 ? 'drive' : Math.random() < 0.5 ? 'clear' : 'drop';
      if (kind === 'drop' && oz < C.halfL * 0.4) kind = 'clear';
    }
    // 失误
    let err = null;
    const pe = this.diff.noise * 0.42 * (1 + stretch * 1.8) + Math.min(0.12, this.rally * 0.004);
    if (Math.random() < pe) err = Math.random() < 0.5 ? 'net' : 'out';
    this.hit(P, kind, { x, depth, power: 0.35 + Math.random() * 0.4 + sk * 0.25, quality: 1 - stretch * 0.8, err, aiErr: this.diff.aimErr * 7 });
  }

  // 击球
  hit(P, kind, o) {
    const b = this.ball, c = this.c, C = this.C, a = P.ath;
    const high = b.pos.y > 2.0;
    if (this.tennis && kind === 'power' && high && Math.abs(b.pos.z) < 7) kind = 'smash';
    if (!this.tennis && kind === 'smash' && b.pos.y < 1.75) kind = 'drive';
    const S = c.shot[kind];
    const pw = clamp(o.power * (0.75 + P.power * 0.35), 0, 1.1) * (o.perfect ? 1.1 : 1);
    let sH = lerp(S.s[0], S.s[1], pw) * (0.7 + o.quality * 0.3);
    const dir = -P.sz;
    const depth = lerp(S.depth[0], S.depth[1], clamp((o.depth + 1) / 2, 0, 1));
    const tgt = V(clamp(o.x, -1, 1) * (C.halfW - (kind === 'power' || kind === 'smash' ? 0.6 : 0.8)), 0, dir * depth * C.halfL);
    // 误差
    let errR = S.err * (1.3 - P.control) * (o.perfect ? 0.45 : 1) + (1 - o.quality) * 1.25 + (o.aiErr || 0);
    if (o.err === 'out') errR += 1.6;
    const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * errR;
    tgt.x += Math.cos(ang) * rr; tgt.z += Math.sin(ang) * rr * 1.2;
    if (o.err === 'out') { if (Math.random() < 0.5) tgt.x = Math.sign(tgt.x || 1) * (C.halfW + 0.3 + Math.random()); else tgt.z = dir * (C.halfL + 0.3 + Math.random() * 1.2); }
    if (tgt.z * dir < 0.6) tgt.z = dir * 0.6;
    b.pos.y = Math.max(b.pos.y, 0.3);
    const r = this.aimSolve(b.pos, tgt, sH);
    b.vel.copy(r.vel);
    if (o.err === 'net') { b.vel.y = b.vel.y * 0.6 - 1.2; }
    b.spin = kind === 'slice' ? 'slice' : kind === 'power' || kind === 'flat' ? 'top' : '';
    b.lastHit = P.team; b.bounces = 0; b.isServe = false; b.netted = false; b.touched = true;
    b.fire = o.perfect && (kind === 'power' || kind === 'smash') ? 0.6 : 0;
    this.rally++;
    this.maxRally = Math.max(this.maxRally, this.rally);
    // 动作
    const type = kind === 'smash' ? 'overhead' : this.strokeType(P);
    const jump = !this.tennis && kind === 'smash' ? 0.55 : 0;
    const an = a.play(type, 0.46, { hitAt: 0.3, slow: 0.55, jump, j0: 0, j1: 0.9 });
    an.t = 0.11;
    if (o.quality < 0.35) a.play('lunge', 0.55, { lock: true, glide: true, side: (b.pos.x - a.pos.x) * P.sz >= 0 ? 1 : -1 });
    // 反馈
    const strong = kind === 'smash' || kind === 'power';
    this.audio.racket?.(strong ? 1 : kind === 'drop' || kind === 'slice' ? 0.25 : 0.55, this.tennis);
    if (strong) { this.cam.shake(kind === 'smash' ? 0.22 : 0.1); this.fx.sparks(b.pos.x, b.pos.y, b.pos.z, kind === 'smash' ? 16 : 8); }
    if (kind === 'smash') { this.stats[P.team].smashes++; this.arena.cheer(0.35); }
    if (o.human) {
      if (o.perfect) this.hud.flash(S.name ? `完美${S.name}!` : '完美击球!', '#7dff7a');
      else if (S.name && strong) this.hud.flash(S.name + '!', '#ffd23f');
      this.input.rumble(P.human.dev.id, strong ? 0.6 : 0.25, 90);
    }
    if (this.rally === 10 || this.rally === 20) { this.hud.flash(`${this.rally} 拍相持!`, '#4dd7ff'); this.arena.cheer(0.5); this.audio.ooh(); }
    this.predict();
    this.onOpponentHit(this.P[1 - P.team]);
  }

  // ---------- 得分 ----------
  point(w, reason, type) {
    const b = this.ball;
    b.live = false; b.mark.visible = false; b.fire = 0;
    this.state = 'point';
    this.stateT = 1.9;
    const l = 1 - w;
    const st = this.stats;
    st[w].points++;
    if (type === 'ace') st[w].aces++; else if (type === 'win') st[w].winners++; else st[l].errors++;
    const wt = this.teams[w];
    let big = null;
    if (this.tennis) {
      this.pts[w]++;
      if (this.pts[w] >= 4 && this.pts[w] - this.pts[l] >= 2) {
        this.games[w]++; wt.score = this.games[w];
        this.pts = [0, 0];
        this.server = 1 - this.server;
        big = this.games[w] >= this.target ? null : `${wt.data.name} 拿下一局`;
        if (this.games[w] >= this.target) this.over = w;
      }
    } else {
      wt.score++;
      this.server = w;
      const s = wt.score, o = this.teams[l].score, cap = this.target + (this.target >= 21 ? 9 : this.target >= 15 ? 6 : 4);
      if ((s >= this.target && s - o >= 2) || s >= cap) this.over = w;
      else if (s >= this.target - 1 && s > o) big = s - o >= 1 && s >= this.target - 1 ? '赛点!' : null;
    }
    this.updateBoard();
    this.hud.flash(reason, type === 'err' ? '#ff9a9a' : '#ffd23f');
    if (big) this.hud.banner(big, 'half');
    if (type === 'err') this.audio.groan(); else { this.audio.cheer(type === 'ace' || this.rally >= 8); this.arena.cheer(type === 'ace' || this.rally >= 8 ? 0.9 : 0.5); }
    this.hud.commentary(this.say(w, reason, type));
    this.P[w].ath.play('fist', 1.2, { lock: true });
    if (this.over === undefined || this.over === null) this.P[l].ath.play('sad', 1.0, { lock: true });
  }

  say(w, reason, type) {
    const n = this.P[w].ath.name, ln = this.P[1 - w].ath.name;
    if (type === 'ace') return `${n} 发球直接得分，漂亮的 ACE！`;
    if (type === 'win') return this.rally >= 10 ? `${this.rally} 拍的精彩相持，${n} 笑到最后！` : `${n} 打出制胜分！`;
    return `${ln} ${reason}，送出一分。`;
  }

  updPoint(dt) {
    this.stateT -= dt;
    const b = this.ball;
    // 球继续自然运动
    this.acc += dt;
    while (this.acc >= H) {
      this.acc -= H;
      const ev = this.advance(b.pos, b.vel);
      if (ev === 'ground') { if (this.tennis) { this.bounce(b.vel, ''); if (Math.abs(b.vel.y) < 1) b.vel.multiplyScalar(0.9); } else b.vel.set(0, 0, 0); }
    }
    for (const P of this.P) { P.ath.move.set(0, 0, 0); P.ath.update(dt, this.time); }
    if (this.stateT <= 0) {
      if (this.over !== undefined && this.over !== null) return this.endMatch(this.over);
      this.hud.fade();
      this.startServe();
    }
  }

  ptLabel(i) {
    const p = this.pts, o = p[1 - i];
    if (p[i] >= 3 && o >= 3) return p[i] === o ? '40' : p[i] > o ? 'AD' : '40';
    return ['0', '15', '30', '40'][Math.min(3, p[i])];
  }

  updateBoard() {
    const row = i => {
      const t = this.teams[i], P = this.P[i];
      return `<div class="spb-row"><b style="--c:${t.kit.primary}">${t.data.abbr}</b><span>${P.ath.name}</span><i class="${this.server === i ? 'on' : ''}"></i>${this.tennis ? `<em>${this.games[i]}</em><em class="pt">${this.ptLabel(i)}</em>` : `<em class="pt">${t.score}</em>`}</div>`;
    };
    this.board(`<div class="spb racket">${row(0)}${row(1)}<div class="spb-foot">${this.tennis ? `抢 ${this.target} 局` : `${this.target} 分制`}</div></div>`);
  }

  endMatch(w) {
    const st = this.stats;
    const rows = [['得分', st[0].points, st[1].points], ['发球 ACE', st[0].aces, st[1].aces], ['制胜分', st[0].winners, st[1].winners], ['失误', st[0].errors, st[1].errors], [this.tennis ? '扣杀' : '杀球', st[0].smashes, st[1].smashes]];
    this.finish(w, {
      rows, note: `最长相持 ${this.maxRally} 拍`,
      mvp: { name: this.P[w].ath.name, text: `${st[w].winners + st[w].aces} 个制胜分` },
      aces: st.map(s => s.aces), smashes: st.map(s => s.smashes), maxRally: this.maxRally,
    });
    this.ball.mark.visible = false;
  }
}
