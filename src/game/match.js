import * as THREE from 'three';
import { F, TUNE, DIFFS, ALLY_AI, WEATHER_PHYS, DEVICE_COLORS } from '../config.js';
import { ROLES, playerStats, BALLS, CELEBRATIONS } from '../data/teams.js';
import { Ball, predictPath } from './ball.js';
import { Player } from './player.js';
import { TeamAI } from './ai.js';
import { HumanController } from './human.js';
import { doPass, doShot, pickReceiver, aimFromInput } from './actions.js';
import { Replay } from './replay.js';
import { say } from './commentary.js';

const V = () => new THREE.Vector3();
const tmp = V();

class Team {
  constructor(idx, data, attackDir) {
    this.idx = idx;
    this.data = data;
    this.attackDir = attackDir;
    this.players = [];
    this.score = 0;
    this.fever = 0;
    this.humans = [];
    this.stats = { shots: 0, onTarget: 0, passes: 0, passesDone: 0, tackles: 0, fouls: 0, saves: 0, possT: 0, corners: 0, yellow: 0, red: 0 };
  }
  get active() { return this.players.filter(p => !p.sentOff); }
  get keeper() { return this.players.find(p => p.isGK && !p.sentOff); }
  get ownGoalX() { return -this.attackDir * F.hl; }
}

export class Match {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, stadium, audio, input, hud, fx, cam, save
    this.ball = new Ball(this.scene, BALLS[0]);
    this.teams = [];
    this.players = [];
    this.state = 'idle';
    this.time = 0;
    this.replay = new Replay();
    this.path = [];
    this.icpt = new Map();
    this.timeScale = 1;
    this.slowT = 0;
    this.rings = [];
  }

  get settings() { return this.save.s; }

  // ================= 初始化 =================
  setup(cfg) {
    this.cfg = cfg;
    this.clear();
    this.showBall(true);
    const diff = DIFFS[cfg.diff] || DIFFS.normal;
    this.teams = [new Team(0, cfg.teamA, 1), new Team(1, cfg.teamB, -1)];
    const kitClash = (a, b) => colorDist(a.kit.primary, b.kit.primary) < 0.25;
    for (const t of this.teams) {
      let kit = t.data.kit;
      if (t.idx === 1 && kitClash(this.teams[0].data, t.data)) {
        kit = { primary: t.data.kit.secondary, secondary: t.data.kit.primary, pattern: t.data.kit.pattern, shorts: t.data.kit.primary, socks: t.data.kit.secondary };
        if (colorDist(kit.primary, this.teams[0].data.kit.primary) < 0.25) kit = { primary: '#f5f5f5', secondary: '#222222', pattern: 'solid', shorts: '#222222', socks: '#f5f5f5' };
      }
      t.kit = kit;
      const gkKit = t.idx === 0 ? { primary: '#f5b700', secondary: '#1a1a1a', pattern: 'solid', shorts: '#1a1a1a', socks: '#f5b700' }
        : { primary: '#18c964', secondary: '#0a0a0a', pattern: 'solid', shorts: '#0a0a0a', socks: '#18c964' };
      ROLES.forEach((role, i) => {
        const p = new Player(this.scene, t, i, {
          role, stats: playerStats(t.data, i), name: t.data.players[i], number: [1, 4, 7, 8, 9][i],
          kit: role === 'GK' ? gkKit : kit, seed: hash(t.data.id + i + t.data.players[i]),
        });
        t.players.push(p);
        this.players.push(p);
      });
    }
    // AI
    const humanTeams = new Set(cfg.humans.map(h => h.team));
    this.ai = this.teams.map(t => new TeamAI(this, t, humanTeams.has(t.idx) ? ALLY_AI : diff));
    for (const t of this.teams) {
      const sm = humanTeams.has(t.idx) ? 1 : diff.speed;
      for (const p of t.players) p.speedMul = sm;
    }
    // 真人
    this.humans = [];
    cfg.humans.forEach((h, i) => {
      const dev = this.input.get(h.device);
      if (!dev) return;
      const hc = new HumanController(this, this.teams[h.team], dev, i);
      hc.color = DEVICE_COLORS[i % DEVICE_COLORS.length];
      this.teams[h.team].humans.push(hc);
      this.humans.push(hc);
      const ring = this.fx.ring(hc.color);
      this.rings.push({ hc, ring });
    });

    // 环境
    const wp = WEATHER_PHYS[cfg.weather] || WEATHER_PHYS.clear;
    this.ball.env = { roll: wp.roll, bounce: wp.bounce };
    this.ball.cage = !!cfg.cage;
    this.cage = !!cfg.cage;
    const design = BALLS.find(b => b.id === cfg.ball) || BALLS[0];
    this.ball.setDesign(cfg.weather === 'snow' && design.id === 'classic' ? BALLS.find(b => b.id === 'winter') : design);
    this.stadium.setPreset(cfg.time, cfg.weather);
    this.stadium.setCage(this.cage);
    const a = this.teams[0].kit, b = this.teams[1].kit;
    this.stadium.setCrowdColors(a.primary, a.secondary, b.primary, b.secondary);
    this.stadium.setJumbo(`${this.teams[0].data.abbr}  0 - 0  ${this.teams[1].data.abbr}`, `${this.teams[0].data.name} vs ${this.teams[1].data.name}`, cfg.title || '');

    this.duration = cfg.duration || 240;
    this.elapsed = 0;
    this.half = 1;
    this.halfDue = false;
    this.events = [];
    this.goalsLog = [];
    this.trailed = false;
    this.replay.bind(this.players);
    this.hud.setupMatch(this);
    this.cam.mode = this.settings.camera;
    this.cam.shakeOn = this.settings.shake;
    this.kickoffTeam = 0;

    if (cfg.mode === 'shootout') { this.startShootout(); return; }
    this.startIntro();
  }

  showBall(v) { this.ball.mesh.visible = v; this.ball.blob.visible = v; this.ball.trail.visible = v; }

  clear() {
    this.showBall(false);
    for (const p of this.players) p.model.dispose();
    for (const r of this.rings) { this.scene.remove(r.ring); r.ring.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    this.players = []; this.teams = []; this.humans = []; this.rings = [];
    this.ball.reset(0, 0);
    this.fx.hideArrow();
    this.state = 'idle';
    this.cam.special = null;
    this.so = null;
  }

  otherTeam(t) { return this.teams[1 - t.idx]; }

  // ================= 主循环 =================
  update(rawDt) {
    if (this.state === 'idle') return;
    if (this.slowT > 0) { this.slowT -= rawDt; if (this.slowT <= 0) this.timeScale = 1; }
    const dt = rawDt * this.timeScale;
    this.time += dt;

    switch (this.state) {
      case 'intro': this.updIntro(dt, rawDt); break;
      case 'play': this.updPlay(dt); break;
      case 'stoppage': this.updStoppage(dt); break;
      case 'setpiece': this.updSetPiece(dt); break;
      case 'goal': this.updGoal(dt); break;
      case 'replay': this.updReplay(rawDt); break;
      case 'halftime': case 'fulltime': this.updBreak(dt); break;
      case 'pwatch': this.updPenaltyWatch(dt); break;
      case 'done': this.updDone(dt); break;
      case 'pwait':
        for (const p of this.players) if (!p.sentOff) { p.moveInput.set(0, 0, 0); p.update(dt, this); }
        this.ball.update(dt, this.audio);
        if (this.waitFn && (this.waitT -= dt) <= 0) { const fn = this.waitFn; this.waitFn = null; fn(); }
        break;
    }

    this.stadium.update(dt, this.time);
    this.fx.update(dt);
    if (this.ball.fire > 0.3 && this.state !== 'replay') this.fx.fireTrail(this.ball.pos, this.ball.vel);
    this.audio.update(rawDt, this.state !== 'replay');
    this.cam.update(rawDt, this);
    this.updateRings();
    this.hud.update(this, rawDt);
  }

  anyPressed(actions = ['pass', 'shoot', 'pause', 'confirm']) {
    for (const d of this.input.list()) for (const a of actions) if (d.pressed(a)) return true;
    return false;
  }

  // ---------- 开场 ----------
  startIntro() {
    this.state = 'intro';
    this.stateT = 4.2;
    this.teams.forEach(t => t.players.forEach((p, i) => {
      const x = (t.idx === 0 ? -1 : 1) * (2 + i * 1.6);
      p.teleport(x, 1.5, 0, 1);
      p.facing.set(0, 0, 1);
      p.model.root.rotation.y = 0;
    }));
    this.ball.reset(0, 0);
    this.cam.special = { type: 'lineup', t: 0, dur: 4.2 };
    this.hud.vsCard(this.teams[0].data, this.teams[1].data, this.cfg.title);
    this.audio.cheer(false);
    this.stadium.hype.set(0.5, 0.5);
  }

  updIntro(dt) {
    this.stateT -= dt;
    for (const p of this.players) { p.moveInput.set(0, 0, 0); p.update(dt, this); }
    if (this.stateT <= 0 || (this.stateT < 3.6 && this.anyPressed())) {
      this.hud.vsCard(null);
      this.cam.special = null;
      this.cam.snap();
      this.setPiece('kickoff', this.kickoffTeam, V());
    }
  }

  // ---------- 比赛进行 ----------
  updPlay(dt) {
    const ball = this.ball;
    // 计时
    this.elapsed += dt;
    const halfLen = this.duration / 2;
    if (!this.golden && this.elapsed >= halfLen * this.half && !this.halfDue) this.halfDue = true;
    if (this.halfDue) {
      this.halfExtra = (this.halfExtra || 0) + dt;
      const calm = !ball.kickMeta?.shot || ball.kickTime > 2;
      const safe = Math.abs(ball.pos.x) < F.hl - 22 && calm;
      if ((safe && this.halfExtra > 1) || this.halfExtra > 8) { this.halfExtra = 0; this.endHalf(); return; }
    }

    this.computePoss(dt);
    this.predict();

    // 真人输入
    for (const h of this.humans) { h.tick(dt); h.autoSwitch(); if (!h.player) h.manualSwitch(null); h.update(dt); }
    for (const ai of this.ai) ai.update(dt);
    for (const p of this.players) if (!p.sentOff) p.update(dt, this);
    this.separate();
    this.dribble(dt);

    const events = ball.update(dt, this.audio);
    this.handleBallEvents(events);
    this.bodyBlocks();
    this.keeperContact();
    this.resolveTackles();
    this.pickup();
    this.gkHold(dt);
    this.checkGoalOrOut();
    this.fever(dt);

    // 氛围：平静时偶尔来一波人浪
    this.waveT = (this.waveT ?? 25 + Math.random() * 20) - dt;
    if (this.waveT <= 0) { this.waveT = 45 + Math.random() * 40; this.stadium.wave = 1; this.waveOff = 9; }
    if (this.waveOff > 0 && (this.waveOff -= dt) <= 0) this.stadium.wave = 0;
    const danger = Math.max(0, 1 - Math.abs(Math.abs(ball.pos.x) - F.hl) / 25);
    this.audio.setExcitement(Math.min(1, danger * 0.9 + (ball.kickMeta?.shot && ball.kickTime < 1.5 ? 0.4 : 0)));
    this.focusPlayer = this.humans[0]?.player || null;
    this.replay.record(dt, ball);
  }

  // ================= 球权 / 预测 =================
  computePoss(dt) {
    const b = this.ball;
    let t = -1;
    if (b.owner) t = b.owner.team.idx;
    else if (b.heldBy) t = b.heldBy.team.idx;
    else if (b.kickMeta && b.kickMeta.pass && b.kickTime < 2.5) t = b.kickMeta.team;
    else if (b.kickMeta && b.kickMeta.team !== undefined && b.kickTime < 0.6) t = b.kickMeta.team;
    this.possTeam = t;
    if (b.owner || b.heldBy) this.teams[t].stats.possT += dt;
    if (this.expected && (b.owner || b.heldBy || b.kickTime > 3.5)) this.expected = null;
  }

  predict() {
    const b = this.ball;
    predictPath(b, 45, 0.07, this.path);
    this.icpt.clear();
    for (const p of this.players) {
      if (p.sentOff) continue;
      if (b.owner || b.heldBy) { this.icpt.set(p, { t: p.pos.distanceTo(b.pos) / 7, x: b.pos.x, z: b.pos.z }); continue; }
      const sp = p.maxSpeed(false) * (p.stamina > 10 ? TUNE.sprintMul : 1);
      const delay = p.canAct ? 0.1 : Math.max(0.3, p.stateDur - p.stateT + 0.1);
      let best = null;
      for (let i = 0; i < this.path.length; i++) {
        const q = this.path[i];
        const lim = p.isGK && this.inOwnBox(p.team, q) ? 2.5 : 1.05;
        if (q.y > lim) continue;
        const d = Math.max(0, Math.hypot(q.x - p.pos.x, q.z - p.pos.z) - 0.7);
        const tr = d / sp + delay;
        const t = (i + 1) * 0.07;
        if (tr <= t) { best = { t, x: q.x, z: q.z }; break; }
      }
      if (!best) {
        const q = this.path[this.path.length - 1];
        const d = Math.max(0, Math.hypot(q.x - p.pos.x, q.z - p.pos.z) - 0.7);
        best = { t: Math.max(3.15, d / sp + delay), x: q.x, z: q.z };
      }
      this.icpt.set(p, best);
    }
  }

  bestInterceptor(team, aiOnly) {
    let best = null;
    for (const p of team.active) {
      if (p.isGK) continue;
      if (aiOnly && p.controller) continue;
      const ic = this.icpt.get(p);
      if (ic && (!best || ic.t < best.t)) best = { p, t: ic.t };
    }
    return best;
  }

  predictCross(x) {
    const b = this.ball;
    let px = b.pos.x, py = b.pos.y, pz = b.pos.z, pt = 0;
    const s0 = Math.sign(x - px);
    for (let i = 0; i < this.path.length; i++) {
      const q = this.path[i], t = (i + 1) * 0.07;
      if (Math.sign(x - q.x) !== s0) {
        const u = (x - px) / ((q.x - px) || 1e-6);
        return { t: pt + (t - pt) * u, y: py + (q.y - py) * u, z: pz + (q.z - pz) * u };
      }
      px = q.x; py = q.y; pz = q.z; pt = t;
    }
    return null;
  }

  expectReceiver(q, team) { this.expected = { player: q, team }; }

  // ================= 空间评估 =================
  openness(pos, team) {
    let m = 10;
    for (const o of this.teams[1 - team.idx].active) {
      const d = Math.hypot(o.pos.x - pos.x, o.pos.z - pos.z);
      if (d < m) m = d;
    }
    return m;
  }

  laneSafety(from, to, team) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const L = Math.hypot(dx, dz) || 1;
    let s = 1;
    for (const o of this.teams[1 - team.idx].active) {
      const u = ((o.pos.x - from.x) * dx + (o.pos.z - from.z) * dz) / (L * L);
      if (u < 0 || u > 1.08) continue;
      const px = from.x + dx * u, pz = from.z + dz * u;
      const d = Math.hypot(o.pos.x - px, o.pos.z - pz);
      const reach = 1.5 + (u * L / 19) * 4.5;
      s = Math.min(s, THREE.MathUtils.clamp((d - reach) / 3 + 0.5, 0, 1));
    }
    return s;
  }

  xg(pos, team) {
    const gx = team.attackDir * F.hl;
    const dx = gx - pos.x;
    if (dx * team.attackDir <= 0.2) return 0;
    const a1 = Math.atan2(F.goalHalfW - pos.z, Math.abs(dx)), a2 = Math.atan2(-F.goalHalfW - pos.z, Math.abs(dx));
    const th = Math.abs(a1 - a2);
    const d = Math.hypot(dx, pos.z);
    let xg = Math.pow(th, 1.6) * 1.1;
    if (d > 28) xg *= 0.4;
    return Math.min(0.9, xg);
  }

  posValue(pos, team) {
    const prog = (pos.x * team.attackDir + F.hl) / F.L;
    return this.xg(pos, team) * 1.1 + prog * 0.35;
  }

  shotBlockers(p, team) {
    const gx = team.attackDir * F.hl;
    let n = 0;
    for (const o of this.teams[1 - team.idx].active) {
      if (o.isGK) continue;
      const dx = gx - p.pos.x, dz = -p.pos.z, L = Math.hypot(dx, dz);
      const u = ((o.pos.x - p.pos.x) * dx + (o.pos.z - p.pos.z) * dz) / (L * L);
      if (u < 0.02 || u > 1) continue;
      const d = Math.hypot(o.pos.x - (p.pos.x + dx * u), o.pos.z - (p.pos.z + dz * u));
      if (d < 1.3) n++;
    }
    return n;
  }

  nearestOpponent(p) {
    let best = null, bd = 1e9;
    for (const o of this.teams[1 - p.team.idx].active) {
      const d = o.pos.distanceTo(p.pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  nearestOpponentDist(p) { const o = this.nearestOpponent(p); return o ? o.pos.distanceTo(p.pos) : 99; }

  inOwnBox(team, pos) {
    const gx = team.ownGoalX;
    return Math.abs(pos.x - gx) < F.boxDepth && Math.abs(pos.x) <= F.hl + 0.5 && Math.abs(pos.z) < F.boxHalfW;
  }

  // ================= 物理交互 =================
  separate() {
    const P = this.players;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (a.sentOff || a.state === 'fallen') continue;
      for (let j = i + 1; j < P.length; j++) {
        const b = P[j];
        if (b.sentOff || b.state === 'fallen') continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        const R = 0.72;
        if (d2 > R * R || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (R - d) / 2, nx = dx / d, nz = dz / d;
        // 持球人更"重"
        const wa = this.ball.owner === a ? 0.35 : 1, wb = this.ball.owner === b ? 0.35 : 1;
        const s = wa + wb;
        if (!a.lock) { a.pos.x -= nx * push * 2 * wa / s; a.pos.z -= nz * push * 2 * wa / s; }
        if (!b.lock) { b.pos.x += nx * push * 2 * wb / s; b.pos.z += nz * push * 2 * wb / s; }
        // 身体对抗：高速冲撞持球人可能挤掉球
        const own = this.ball.owner;
        if (own && (own === a || own === b)) {
          const other = own === a ? b : a;
          if (other.team !== own.team && other.sprint && other.vel.length() > 7 && Math.random() < 0.03) this.looseBall(own, 3);
        }
      }
    }
  }

  dribble(dt) {
    const b = this.ball, p = b.owner;
    if (!p) return;
    if (p.sentOff || (p.state !== 'run' && p.state !== 'skill' && p.state !== 'kick' && p.state !== 'wait')) { this.looseBall(p, 1.5); return; }
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const lead = 0.5 + sp * 0.055;
    const tx = p.pos.x + p.facing.x * lead, tz = p.pos.z + p.facing.z * lead;
    const k = Math.min(1, dt * (p.state === 'skill' ? 22 : 16));
    b.pos.x += (tx - b.pos.x) * k;
    b.pos.z += (tz - b.pos.z) * k;
    b.pos.y += (b.r - b.pos.y) * Math.min(1, dt * 20);
    b.vel.set(p.vel.x, 0, p.vel.z);
    b.spin.set(0, 0, 0);
    b.lastTouch = p;
    // 冲刺趟球：球被推远，可以被抢
    if (p.sprint && sp > 7 && p.touchT <= 0 && p.state === 'run') {
      p.touchT = 0.62;
      b.owner = null;
      b.vel.set(p.facing.x * sp * 1.32, 0.3, p.facing.z * sp * 1.32);
      b.kickMeta = { team: p.team.idx, touch: true };
      b.kickTime = 0;
      p.controlCD = 0.16;
      this.audio.touch();
    }
  }

  looseBall(p, speed = 2) {
    const b = this.ball;
    if (b.owner !== p) return;
    b.owner = null;
    const a = Math.random() * Math.PI * 2;
    b.vel.set(p.vel.x * 0.5 + Math.cos(a) * speed, 0.5, p.vel.z * 0.5 + Math.sin(a) * speed);
    p.controlCD = 0.4;
    b.kickMeta = { team: -1 };
  }

  handleBallEvents(events) {
    for (const e of events) {
      if (e.type === 'post') {
        this.audio.post();
        this.fx.sparks(this.ball.pos.x, this.ball.pos.y, this.ball.pos.z);
        this.cam.shake(0.45);
        if (this.ball.kickMeta?.shot) { this.hud.commentary(say(e.bar ? 'bar' : 'post')); this.audio.ooh(); }
      } else if (e.type === 'net') {
        this.stadium.netHit(e.x, e.y, e.z, e.v);
        if (!e.outside) this.audio.net();
      } else if (e.type === 'bounce') {
        if (e.v > 4) this.audio.bounce(Math.min(0.5, e.v * 0.05));
      } else if (e.type === 'wall') {
        if (e.v > 3) this.audio.thud(Math.min(0.5, e.v * 0.04));
      }
    }
  }

  bodyBlocks() {
    const b = this.ball;
    if (b.owner || b.heldBy) return;
    const sp = b.vel.length();
    if (sp < 8 || b.pos.y > 1.9) return;
    for (const p of this.players) {
      if (p.sentOff || (p === b.kicker && b.kickTime < 0.3) || p.grounded) continue;
      if (b.kickMeta?.team === p.team.idx && b.kickTime < 0.15) continue;
      const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.42) continue;
      const nx = dx / (d || 1), nz = dz / (d || 1);
      const dot = b.vel.x * nx + b.vel.z * nz;
      if (dot > 0) continue;
      if (p.isGK && this.inOwnBox(p.team, b.pos) && sp < 24 && Math.random() < 0.6) { this.catchBall(p, true); return; }
      b.vel.x -= 1.6 * dot * nx; b.vel.z -= 1.6 * dot * nz;
      b.vel.multiplyScalar(0.42);
      b.vel.y = Math.abs(b.vel.y) * 0.5 + 1.2;
      b.pos.x = p.pos.x + nx * 0.43; b.pos.z = p.pos.z + nz * 0.43;
      const wasShot = b.kickMeta?.shot && b.kickMeta.team !== p.team.idx;
      b.lastTouch = p;
      b.kickMeta = { team: p.team.idx, deflect: true };
      p.controlCD = 0.25;
      this.audio.thud(0.4);
      if (wasShot) { this.hud.commentary(say('block', { p: p.name })); if (p.isGK) this.onSave(p); }
      return;
    }
  }

  keeperContact() {
    const b = this.ball;
    if (b.owner || b.heldBy) return;
    for (const t of this.teams) {
      const gk = t.keeper;
      if (!gk || (gk.state !== 'dive' && gk.state !== 'catch')) continue;
      const act = gk.act;
      if (!act || act.contacted) continue;
      const A = V().set(gk.pos.x, 0.35, gk.pos.z);
      const B = gk.handPos();
      const AB = V().subVectors(B, A), AP = V().subVectors(b.pos, A);
      const u = THREE.MathUtils.clamp(AP.dot(AB) / (AB.lengthSq() || 1), 0, 1.15);
      const cp = A.clone().addScaledVector(AB, u);
      const d = cp.distanceTo(b.pos);
      if (d > (gk.state === 'catch' ? 0.62 : 0.55)) continue;
      act.contacted = true;
      if (act.smother) {
        if (act.willSave) this.catchBall(gk, true);
        continue;
      }
      if (!act.willSave) continue;
      const sp = b.vel.length();
      if (sp < 21 && b.kickType !== 'super' && Math.random() < 0.6) { this.catchBall(gk, true); this.onSave(gk); continue; }
      // 扑出
      const away = t.attackDir;
      const lateral = Math.sign(b.pos.z - gk.pos.z) || (Math.random() < 0.5 ? 1 : -1);
      if (b.kickType === 'super' && Math.random() < 0.45) {
        // 必杀球：门将被冲开，球继续前进
        b.vel.multiplyScalar(0.8); b.vel.z += lateral * 2;
        gk.setState('fallen', 1.2, { forward: false });
        this.fx.burst(b.pos.x, b.pos.y, b.pos.z, [1, 0.5, 0.1], 80);
        this.cam.shake(0.8);
        continue;
      }
      b.vel.set(away * (3 + Math.random() * 5), 2.5 + Math.random() * 4.5, lateral * (4 + Math.random() * 6));
      b.spin.set(0, 0, 0);
      b.fire = 0;
      b.lastTouch = gk;
      b.kickMeta = { team: t.idx, parry: true };
      b.kickTime = 0;
      this.audio.thud(0.6);
      this.fx.sparks(b.pos.x, b.pos.y, b.pos.z, 12);
      this.onSave(gk);
    }
  }

  catchBall(gk, fromSave = false) {
    const b = this.ball;
    const wasShot = b.kickMeta?.shot && b.kickMeta.team !== gk.team.idx;
    b.owner = null;
    b.heldBy = gk;
    b.vel.set(0, 0, 0); b.spin.set(0, 0, 0); b.fire = 0;
    b.lastTouch = gk;
    b.kickMeta = { team: gk.team.idx };
    gk.holding = true;
    gk.holdT = 0;
    this.audio.thud(0.5);
    if (wasShot && !fromSave) this.onSave(gk);
    this.onPossession(gk);
  }

  gkHold(dt) {
    const b = this.ball, gk = b.heldBy;
    if (!gk) return;
    gk.faceLock = null;
    gk.holding = true;
    gk.holdT = (gk.holdT || 0) + dt;
    if (gk.state === 'dive' || gk.state === 'catch' || gk.state === 'getup') return;
    gk.moveInput.set(0, 0, 0);
    const human = gk.controller;
    if (human && gk.holdT < 5) return;
    if (!human && gk.holdT < 1.3) {
      gk.facing.lerp(V().set(gk.attackDir, 0, 0), Math.min(1, dt * 4)).normalize();
      return;
    }
    if (gk.state !== 'run') return;
    // AI 分球
    const t = gk.team;
    let best = null, bs = -1e9, long = false;
    for (const q of t.active) {
      if (q === gk) continue;
      const safe = this.laneSafety(gk.pos, q.pos, t);
      const d = q.pos.distanceTo(gk.pos);
      const s = safe * 2 + this.openness(q.pos, t) * 0.15 - Math.abs(d - 18) * 0.03;
      if (s > bs) { bs = s; best = q; long = d > 26; }
    }
    if (bs < 1.4 && Math.random() < 0.6) {
      const fw = t.active.find(q => q.role === 'FW') || best;
      best = fw; long = true;
    }
    doPass(this, gk, long ? 'lob' : 'ground', best.pos.clone().sub(gk.pos), best, { long });
  }

  resolveTackles() {
    const b = this.ball;
    for (const p of this.players) {
      if (p.state !== 'tackle' && p.state !== 'slide') continue;
      const act = p.act;
      const slide = p.state === 'slide';
      const t = p.stateT;
      const inWin = slide ? t > 0.04 && t < 0.62 : t > 0.07 && t < 0.3;
      if (!inWin) continue;
      const foot = V().set(p.pos.x + p.facing.x * (slide ? 0.7 : 0.85), 0, p.pos.z + p.facing.z * (slide ? 0.7 : 0.85));
      // 球
      if (!act.resolved && !b.heldBy && b.pos.y < 0.9 && Math.hypot(b.pos.x - foot.x, b.pos.z - foot.z) < (slide ? 1.0 : 0.85)) {
        act.resolved = true;
        const owner = b.owner;
        if (owner && owner.team === p.team) continue;
        let ok = true;
        if (owner) {
          const dribble = (owner.stats.pas + owner.stats.spd) / 2;
          let prob = (slide ? 0.64 : 0.52) + (p.stats.tck - dribble) / 180 + (p.controller ? 0.08 : 0);
          if (owner.state === 'skill') prob *= 0.3;
          if (b.pos.distanceTo(owner.pos) > 0.95) prob += 0.2;
          ok = Math.random() < prob;
        }
        if (ok) {
          act.won = true;
          p.team.stats.tackles++;
          p.statsLine.tackles++;
          p.team.fever = Math.min(100, p.team.fever + 7);
          this.audio.thud(0.5);
          if (owner) { owner.controlCD = 0.6; this.hud.commentary(say('tackle', { p: p.name })); }
          if (slide) {
            b.owner = null;
            b.kick(V().set(p.facing.x * 7 + (Math.random() - 0.5) * 4, 0.6, p.facing.z * 7 + (Math.random() - 0.5) * 4), V(), p, 'tackle', { team: p.team.idx });
            if (owner && owner.pos.distanceTo(p.pos) < 1.3 && Math.random() < 0.5) owner.setState('fallen', 0.9, { forward: true });
          } else if (Math.random() < 0.6) {
            b.owner = p; this.onPossession(p);
          } else {
            b.owner = null;
            b.kick(V().set(p.facing.x * 3.5, 0.3, p.facing.z * 3.5), V(), p, 'tackle', { team: p.team.idx });
          }
          if (p.controller) { this.save.data.stats.tackles++; this.input.rumble(p.controller.dev.id, 0.4, 90); }
        } else act.failed = true;
      }
      // 犯规判定
      if (act.fouled || this.state !== 'play') continue;
      for (const o of this.teams[1 - p.team.idx].active) {
        if (o.grounded || o === b.heldBy) continue;
        const d = Math.hypot(o.pos.x - foot.x, o.pos.z - foot.z);
        if (d > (slide ? 0.7 : 0.55)) continue;
        const behind = o.facing.dot(p.facing) > 0.35;
        if (slide && !act.won) { act.fouled = true; this.foul(p, o, behind); return; }
        if (!slide && act.failed && behind && Math.random() < 0.35) { act.fouled = true; this.foul(p, o, false); return; }
        if (slide && act.won && d < 0.5 && o.state === 'run') o.setState('fallen', 0.8, { forward: true });
      }
    }
  }

  pickup() {
    const b = this.ball;
    if (b.owner || b.heldBy) return;
    const sp = b.vel.length();
    let best = null, bd = 1e9;
    for (const p of this.players) {
      if (p.sentOff || p.controlCD > 0) continue;
      if (!(p.state === 'run' || p.state === 'wait' || p.state === 'skill')) continue;
      const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      // 门将：禁区内可以手接
      if (p.isGK && this.inOwnBox(p.team, b.pos) && d < 1.25 && b.pos.y < 2.5 && !(b.kicker === p && b.kickTime < 0.5)) {
        const backPass = b.kickMeta?.pass && b.kickMeta.team === p.team.idx && b.kickTime < 3;
        if (!backPass) { this.catchBall(p); return; }
      }
      const chest = b.vel.y < 0 && sp < 14 && b.pos.y < 1.55;
      if (b.pos.y > (chest ? 1.55 : 0.95)) continue;
      const r = TUNE.controlR + (sp < 3 ? 0.3 : 0);
      if (d < r && d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    const p = best;
    const rel = Math.hypot(b.vel.x - p.vel.x, b.vel.z - p.vel.z);
    if (rel > 19 && !(b.kickMeta?.pass && b.kickMeta.team === p.team.idx)) {
      // 高速球打在身上弹开
      const a = Math.atan2(b.vel.z, b.vel.x) + Math.PI + (Math.random() - 0.5) * 1.6;
      b.vel.set(Math.cos(a) * rel * 0.3, 1 + Math.random() * 2, Math.sin(a) * rel * 0.3);
      b.lastTouch = p;
      p.controlCD = 0.3;
      this.audio.thud(0.35);
      return;
    }
    const opponentPass = b.kickMeta?.pass && b.kickMeta.team !== p.team.idx;
    if (opponentPass && rel > 8 && Math.random() > 0.3 + p.stats.tck / 100 * 0.35) {
      // 截球只碰到一下：球被挡偏
      const a = Math.atan2(b.vel.z, b.vel.x) + (Math.random() - 0.5) * 2.2;
      const sp2 = rel * (0.25 + Math.random() * 0.25);
      b.vel.set(Math.cos(a) * sp2, 0.5 + Math.random() * 1.5, Math.sin(a) * sp2);
      b.lastTouch = p;
      b.kickMeta = { team: p.team.idx, deflect: true };
      p.controlCD = 0.35;
      this.audio.touch();
      return;
    }
    if (rel > 12 && Math.random() > 0.5 + p.stats.pas / 100 * 0.45) {
      // 停球失误
      b.vel.multiplyScalar(0.3);
      b.vel.x += p.facing.x * 3 + (Math.random() - 0.5) * 3;
      b.vel.z += p.facing.z * 3 + (Math.random() - 0.5) * 3;
      b.lastTouch = p;
      p.controlCD = 0.28;
      this.audio.touch();
      return;
    }
    b.owner = p;
    b.lastTouch = p;
    p.touchT = 0.35;
    if (sp > 6) this.audio.touch();
    this.onPossession(p);
  }

  onPossession(p) {
    const b = this.ball;
    const km = b.kickMeta;
    if (km && km.pass && km.from && km.from !== p) {
      if (km.team === p.team.idx) {
        p.team.stats.passesDone++;
        km.from.statsLine.passes++;
        p.team.fever = Math.min(100, p.team.fever + 2.5);
        this.lastPass = { from: km.from, to: p, t: this.time };
      } else {
        this.hud.commentary(say('intercept', { p: p.name }));
      }
      km.pass = false;
    }
    if (km && km.shot && km.team === p.team.idx) km.shot = false;
    this.expected = null;
    for (const h of p.team.humans) if (!h.player || h.player === p || this.settings.autoSwitch) { /* autoSwitch 在下一帧处理 */ }
  }

  onPass(p, target, kind) {
    p.team.stats.passes++;
  }

  onShot(p, kind, dist) {
    p.team.stats.shots++;
    p.statsLine.shots++;
    this.lastShot = { p, time: this.time };
  }

  onSave(gk) {
    const t = gk.team;
    t.stats.saves++;
    gk.statsLine.saves++;
    t.fever = Math.min(100, t.fever + 10);
    const opp = this.teams[1 - t.idx];
    opp.stats.onTarget++;
    this.hud.commentary(say('save', { p: gk.name }));
    this.audio.ooh();
    this.stadium.hype.setComponent(t.idx, 0.4);
  }

  onSkill(p) {
    p.team.fever = Math.min(100, p.team.fever + 3);
    if (Math.random() < 0.3) this.hud.commentary(say('skill', { p: p.name }));
    this.audio.whoosh();
  }

  onSuperShot(p) {
    this.audio.fire();
    this.cam.shake(1);
    this.slow(0.35, 0.7);
    this.fx.burst(this.ball.pos.x, this.ball.pos.y, this.ball.pos.z, [1, 0.45, 0.05], 120);
    this.hud.banner('🔥 热血必杀 🔥', 'fire');
  }
  superCharge() {}

  slow(scale, dur) { this.timeScale = scale; this.slowT = dur; }

  fever(dt) {
    for (const t of this.teams) {
      if (this.possTeam === t.idx) t.fever = Math.min(100, t.fever + dt * 0.45);
      if (t.fever >= 100 && !t.feverAnnounced) { t.feverAnnounced = true; if (t.humans.length) this.hud.flash('热血必杀就绪！按 E / RB+B', '#ff8a3d'); }
      if (t.fever < 100) t.feverAnnounced = false;
    }
  }

  // ================= 犯规 =================
  foul(off, victim, fromBehind) {
    const t = off.team;
    t.stats.fouls++;
    victim.setState('fallen', 1.3, { forward: true });
    this.audio.whistle('foul');
    this.audio.boo();
    this.hud.commentary(say('foul', { p: off.name }));
    let card = null;
    if (fromBehind && Math.random() < 0.55) card = 'yellow';
    else if (Math.random() < 0.06) card = 'yellow';
    if (card === 'yellow') {
      off.yellow++;
      t.stats.yellow++;
      if (off.yellow >= 2) card = 'red';
    }
    if (card) {
      this.hud.card(card, off, t);
      this.hud.commentary(say(card, { p: off.name }));
      if (card === 'red') { t.stats.red++; this.pendingRed = off; }
    }
    const spot = victim.pos.clone();
    spot.x = THREE.MathUtils.clamp(spot.x, -F.hl + 1, F.hl - 1);
    spot.z = THREE.MathUtils.clamp(spot.z, -F.hw + 1, F.hw - 1);
    const vt = victim.team;
    if (this.inOwnBox(t, spot)) this.setPiece('penalty', vt.idx, V().set(vt.attackDir * (F.hl - F.penSpot), 0, 0));
    else this.setPiece('freekick', vt.idx, spot);
  }

  // ================= 进球 / 出界 =================
  checkGoalOrOut() {
    const b = this.ball;
    if (b.heldBy || b.owner) return;
    const ax = Math.abs(b.pos.x);
    if (ax > F.hl + b.r && Math.abs(b.pos.z) < F.goalHalfW && b.pos.y < F.goalH) {
      const side = Math.sign(b.pos.x);
      const scorer = this.teams.find(t => t.attackDir === side);
      this.goal(scorer);
      return;
    }
    if (this.cage) return;
    if (Math.abs(b.pos.z) > F.hw + b.r) {
      const lt = b.lastTouch ? b.lastTouch.team : this.teams[0];
      const x = THREE.MathUtils.clamp(b.pos.x, -F.hl + 1, F.hl - 1);
      this.setPiece('kickin', 1 - lt.idx, V().set(x, 0, Math.sign(b.pos.z) * F.hw));
      this.missCheck();
      return;
    }
    if (ax > F.hl + b.r) {
      const side = Math.sign(b.pos.x);
      const defending = this.teams.find(t => Math.sign(t.ownGoalX) === side);
      const attacking = this.otherTeam(defending);
      this.missCheck();
      const lt = b.lastTouch ? b.lastTouch.team : attacking;
      if (lt === defending) {
        attacking.stats.corners++;
        this.setPiece('corner', attacking.idx, V().set(side * (F.hl - 0.4), 0, Math.sign(b.pos.z || 1) * (F.hw - 0.4)));
      } else {
        this.setPiece('goalkick', defending.idx, V().set(side * (F.hl - 4.5), 0, Math.sign(b.pos.z || 1) * 3));
      }
    }
  }

  missCheck() {
    const b = this.ball;
    if (b.kickMeta?.shot) {
      this.hud.commentary(say('miss'));
      if (Math.abs(b.pos.z) < F.goalHalfW + 2.5) this.audio.ooh(); else this.audio.groan();
    }
  }

  goal(team) {
    const b = this.ball;
    if (this.so) {
      this.audio.cheer(true);
      this.audio.whistle('short');
      this.stadium.hype.setComponent(team.idx, 1);
      this.fx.confetti(b.pos.x, 2, b.pos.z, [team.kit.primary, team.kit.secondary], 200);
      this.hud.flash('球进了！', '#7dff7a');
      this.soResult(true);
      return;
    }
    const km = b.kickMeta || {};
    const own = b.lastTouch && b.lastTouch.team !== team;
    const scorer = own ? b.lastTouch : (km.shooter && km.shooter.team === team ? km.shooter : b.lastTouch && b.lastTouch.team === team ? b.lastTouch : null);
    team.score++;
    if (!own) team.stats.onTarget++;
    const human = team.humans.length > 0;
    const opp = this.otherTeam(team);
    let assist = null;
    if (!own && this.lastPass && this.lastPass.to === scorer && this.time - this.lastPass.t < 8) assist = this.lastPass.from;
    if (scorer && !own) scorer.statsLine.goals++;
    if (assist) assist.statsLine.assists++;
    const minute = this.minute();
    const info = { team: team.idx, scorer: scorer ? scorer.name : '?', own, minute, super: km.super, header: km.header || km.volley, dist: km.dist || 0, setPiece: km.setPiece, human };
    this.goalsLog.push(info);
    this.events.push({ type: 'goal', ...info, humanTeam: human, scorerPlayer: scorer });

    // 解说
    const key = own ? 'ownGoal' : km.super ? 'superGoal' : km.setPiece === 'penalty' ? 'penGoal' : km.setPiece === 'freekick' ? 'fkGoal' : (km.header || km.volley) ? 'headerGoal' : (km.dist > 25 ? 'longGoal' : 'goal');
    this.hud.commentary(say(key, { p: scorer ? scorer.name : '' }));
    this.hud.goal(team, scorer, own, key);
    this.hud.setScore(this.teams[0].score, this.teams[1].score);
    this.stadium.setJumbo(`${this.teams[0].data.abbr}  ${this.teams[0].score} - ${this.teams[1].score}  ${this.teams[1].data.abbr}`, `⚽ ${scorer ? scorer.name : ''} ${minute}'`, team.data.name);
    this.audio.whistle('long');
    this.audio.cheer(true);
    this.stadium.hype.setComponent(team.idx, 1);
    this.cam.shake(0.7);
    this.slow(0.3, 0.9);
    this.fx.confetti(b.pos.x - team.attackDir * 1, 2, b.pos.z, [team.kit.primary, team.kit.secondary], 400);
    for (const h of team.humans) this.input.rumble(h.dev.id, 0.8, 350);

    for (const t of this.teams) if (t.score < this.otherTeam(t).score) t.trailed = true;

    this.state = 'goal';
    this.stateT = 4.2;
    this.kickoffTeam = opp.idx;
    this.goalScorer = scorer;
    this.goalTeam = team;
    this.fx.hideArrow();
    // 庆祝
    const celebType = CELEBRATIONS[(Math.random() * CELEBRATIONS.length) | 0];
    const target = V().set(team.attackDir * (F.hl - 10), 0, (scorer && scorer.pos.z > 0 ? 1 : -1) * (F.hw - 5));
    if (Math.random() < 0.5) target.set(scorer ? scorer.pos.x * 0.6 : 0, 0, F.hw - 3);
    for (const p of this.players) {
      if (p.sentOff) continue;
      if (p.controller) p.controller.charge = -1;
      if (p === scorer && !own) { p.setState('celebrate'); p.celeb = { type: celebType, target, slideAt: 1.2, flipAt: 1.4 }; }
      else if (p.team === team && !p.isGK) { p.setState('celebrate'); p.celeb = { type: 'hug', follow: scorer }; }
      else if (p.team !== team) { p.setState('sad'); }
    }
    this.golden && (this.stateT = 3.4);
  }

  updGoal(dt) {
    this.stateT -= dt;
    const b = this.ball;
    const ev = b.update(dt, this.audio);
    this.handleBallEvents(ev);
    for (const p of this.players) {
      if (p.sentOff) continue;
      if (p.state === 'celebrate' && p.celeb) {
        const c = p.celeb;
        const tgt = c.follow ? c.follow.pos : c.target;
        const d = Math.hypot(tgt.x - p.pos.x, tgt.z - p.pos.z);
        const stopR = c.follow ? 1.6 : 1.5;
        if (d > stopR && !(c.type === 'slide' && p.stateT > c.slideAt)) {
          p.moveInput.set((tgt.x - p.pos.x) / d, 0, (tgt.z - p.pos.z) / d);
          p.sprint = !c.follow || d > 5;
        } else p.moveInput.set(0, 0, 0);
        if (c.type === 'slide' && p.stateT > c.slideAt) { p.moveInput.set(0, 0, 0); p.damp(dt, 1.6); }
        // 手动推进位置（celebrate 状态不走 steer 分支）
        const maxS = p.maxSpeed(false);
        p.vel.x += (p.moveInput.x * maxS - p.vel.x) * Math.min(1, dt * 5);
        p.vel.z += (p.moveInput.z * maxS - p.vel.z) * Math.min(1, dt * 5);
        if (p.vel.lengthSq() > 1) p.facing.lerp(V().copy(p.vel).setY(0).normalize(), Math.min(1, dt * 8)).normalize();
      } else if (p.state === 'sad') {
        p.vel.multiplyScalar(Math.exp(-dt * 2));
      } else p.moveInput.set(0, 0, 0);
      p.update(dt, this);
    }
    if (this.stateT < 3.4 && this.goalScorer && !this.cam.special) this.cam.special = { type: 'celebrate', target: this.goalScorer };
    this.replay.record(dt, b);
    if (this.stateT <= 0 || (this.stateT < 2.6 && this.anyPressed(['pass', 'confirm']))) {
      this.cam.special = null;
      if (this.settings.replays && this.replay.start(6.5)) {
        this.state = 'replay';
        this.replayAngle = Math.random() < 0.5 ? 0 : 1;
        this.hud.replayTag(true);
        this.ball.trail.visible = false;
      } else this.afterGoal();
    }
  }

  updReplay(dt) {
    const rp = this.replay;
    const frac = rp.progress || 0;
    const rate = frac > 0.55 && frac < 0.85 ? 0.45 : 0.85;
    const alive = rp.play(dt, this.ball, rate);
    // 回放机位
    const b = this.ball.pos;
    const side = this.goalTeam.attackDir;
    let pos, look;
    if (this.replayAngle === 0) {
      pos = V().set(side * (F.hl + 9), 3.2, b.z * 0.4 + side * 0);
      look = b.clone();
    } else {
      pos = V().set(b.x - side * 7, 2.4, b.z + 10);
      look = b.clone();
    }
    this.cam.special = { type: 'fixed', pos, look, snap: !this._replayCamInit, fov: 42 };
    this._replayCamInit = true;
    for (const p of this.players) p.model.root.updateMatrixWorld();
    if (!alive || (rp.elapsed > 0.6 && this.anyPressed(['pass', 'shoot', 'confirm']))) {
      rp.active = false;
      this._replayCamInit = false;
      this.hud.replayTag(false);
      this.ball.trail.visible = true;
      this.cam.special = null;
      this.cam.snap();
      this.afterGoal();
    }
  }

  afterGoal() {
    this.replay.clear();
    if (this.golden) { this.finish(); return; }
    if (this.halfDue) { this.endHalf(); return; }
    this.setPiece('kickoff', this.kickoffTeam, V());
  }

  minute() {
    const m = Math.floor(this.elapsed / this.duration * 90);
    return Math.min(this.half === 1 ? 45 : 90, m) + (this.halfDue ? '+' : '');
  }

  // ================= 半场 / 终场 =================
  endHalf() {
    this.halfDue = false;
    if (this.half === 1) {
      this.state = 'halftime';
      this.stateT = 4;
      this.audio.whistle('half');
      this.hud.banner('中场休息', 'half', `${this.teams[0].score} : ${this.teams[1].score}`);
      this.hud.commentary(say('half', { s: `${this.teams[0].score}:${this.teams[1].score}` }));
    } else {
      if (this.teams[0].score === this.teams[1].score && this.cfg.knockout && !this.golden) {
        this.state = 'fulltime';
        this.stateT = 3;
        this.audio.whistle('end');
        this.hud.banner('常规时间结束', 'half', '进入点球大战');
        this.toShootout = true;
        return;
      }
      this.state = 'fulltime';
      this.stateT = 3.5;
      this.audio.whistle('end');
      this.hud.banner('全场结束', 'half', `${this.teams[0].score} : ${this.teams[1].score}`);
      this.hud.commentary(say('full'));
    }
    this.fx.hideArrow();
  }

  updBreak(dt) {
    this.stateT -= dt;
    for (const p of this.players) { if (!p.sentOff) { p.moveInput.set(0, 0, 0); p.update(dt, this); } }
    this.ball.update(dt, this.audio);
    if (this.stateT > 0) return;
    if (this.state === 'halftime') {
      this.half = 2;
      for (const t of this.teams) t.attackDir *= -1;
      this.setPiece('kickoff', 1 - this.firstKick, V());
    } else if (this.toShootout) {
      this.toShootout = false;
      this.startShootout();
    } else this.finish();
  }

  finish() {
    this.state = 'done';
    this.stateT = 0;
    this.fx.hideArrow();
    const [a, b] = this.teams;
    const res = {
      scoreA: a.score, scoreB: b.score, shootout: this.soScore || null,
      winner: this.soScore ? (this.soScore[0] > this.soScore[1] ? 0 : 1) : a.score > b.score ? 0 : b.score > a.score ? 1 : -1,
      teams: this.teams.map(t => ({ name: t.data.name, abbr: t.data.abbr, kit: t.kit, stats: { ...t.stats }, score: t.score, human: t.humans.length > 0 })),
      goals: this.goalsLog.slice(),
      events: this.events.slice(),
      players: this.players.map(p => ({ name: p.name, team: p.team.idx, line: { ...p.statsLine }, rating: this.rate(p) })),
      trailed: this.teams.map(t => !!t.trailed),
      cfg: this.cfg,
    };
    const winnerTeam = res.winner >= 0 ? this.teams[res.winner] : null;
    if (winnerTeam) { this.fx.confetti(0, 8, 0, [winnerTeam.kit.primary, winnerTeam.kit.secondary], 900); this.audio.cheer(true); this.stadium.hype.setComponent(winnerTeam.idx, 1); }
    res.mvp = res.players.slice().sort((x, y) => y.rating - x.rating)[0];
    for (const p of this.players) {
      if (p.sentOff) continue;
      p.setState(winnerTeam && p.team === winnerTeam ? 'celebrate' : winnerTeam ? 'sad' : 'run');
      if (winnerTeam && p.team === winnerTeam) p.celeb = { type: Math.random() < 0.5 ? 'dance' : 'arms', target: p.pos.clone() };
    }
    this.cam.special = { type: 'celebrate', target: this.players.find(p => winnerTeam ? p.team === winnerTeam && !p.isGK : !p.isGK) };
    this.result = res;
    this.doneT = 0;
  }

  updDone(dt) {
    this.doneT += dt;
    for (const p of this.players) { if (!p.sentOff) { p.moveInput.set(0, 0, 0); p.update(dt, this); } }
    this.ball.update(dt, this.audio);
    if (this.doneT > 2.2 && !this.resultShown) { this.resultShown = true; this.onEnd && this.onEnd(this.result); }
  }

  rate(p) {
    const s = p.statsLine;
    let r = 6.2 + s.goals * 1.1 + s.assists * 0.6 + s.tackles * 0.2 + s.saves * 0.45 + s.passes * 0.04 + s.shots * 0.08 - p.yellow * 0.4 - (p.sentOff ? 1.5 : 0);
    const t = p.team, o = this.teams[1 - t.idx];
    if (t.score > o.score) r += 0.5;
    if (p.isGK && o.score === 0) r += 0.8;
    return Math.round(Math.min(10, r) * 10) / 10;
  }

  // ================= 定位球 =================
  setPiece(type, teamIdx, spot) {
    this.sp = { type, team: this.teams[teamIdx], spot: spot.clone(), t: 0 };
    if (type === 'kickoff' && this.half === 1 && this.elapsed === 0) this.firstKick = teamIdx;
    this.state = 'stoppage';
    this.stateT = type === 'kickoff' ? 0.01 : type === 'penalty' || type === 'freekick' ? 1.6 : 1.1;
    if (type !== 'kickoff' && type !== 'penalty' && type !== 'freekick') this.audio.whistle('short');
    this.fx.hideArrow();
    for (const h of this.humans) h.charge = -1;
    const t = this.teams[teamIdx];
    if (type === 'corner') this.hud.commentary(say('corner', { t: t.data.name }));
    if (type === 'freekick') this.hud.commentary(say('freekick', { t: t.data.name }));
    if (type === 'penalty' && !this.so) { this.hud.commentary(say('penalty', { t: t.data.name })); this.hud.banner('点 球', 'half'); }
  }

  updStoppage(dt) {
    this.stateT -= dt;
    // 球员放慢脚步
    for (const p of this.players) {
      if (p.sentOff) continue;
      if (p.state === 'run') { p.moveInput.multiplyScalar(0.9); p.sprint = false; }
      p.update(dt, this);
    }
    const b = this.ball;
    if (!b.owner && !b.heldBy) { const ev = b.update(dt, this.audio); this.handleBallEvents(ev); }
    if (b.owner) b.owner = null;
    if (this.stateT <= 0) {
      if (this.pendingRed) {
        const p = this.pendingRed;
        this.pendingRed = null;
        p.sentOff = true; p.setVisible(false);
        if (p.controller) { const h = p.controller; h.setPlayer(null); p.controller = null; h.manualSwitch(null); }
        p.pos.set(0, -50, 0);
      }
      this.hud.fade();
      this.arrange();
    }
  }

  arrange() {
    const sp = this.sp, T = sp.team, D = this.otherTeam(T), b = this.ball;
    const type = sp.type;
    const spot = sp.spot;
    b.reset(spot.x, spot.z);
    for (const p of this.players) {
      if (p.sentOff) continue;
      p.setState('run'); p.vel.set(0, 0, 0); p.holding = false; p.lock = true; p.faceLock = null; p.moveInput.set(0, 0, 0); p.sprint = false;
    }
    const goalX = T.attackDir * F.hl;
    const toGoal = V().set(goalX - spot.x, 0, -spot.z).normalize();
    const outfield = t => t.active.filter(p => !p.isGK);
    let taker;
    if (type === 'goalkick') taker = T.keeper || outfield(T)[0];
    else if (type === 'penalty') taker = outfield(T).sort((a, c) => c.stats.sht - a.stats.sht)[this.so ? (this.so.kicks[T.idx].length % Math.max(1, outfield(T).length)) : 0];
    else if (type === 'kickoff') taker = outfield(T).find(p => p.role === 'FW') || outfield(T)[0];
    else taker = outfield(T).sort((a, c) => a.pos.distanceTo(spot) - c.pos.distanceTo(spot))[0];
    if (this.so && type === 'penalty') {
      const order = outfield(T).sort((a, c) => c.stats.sht - a.stats.sht);
      taker = order[this.so.kicks[T.idx].length % order.length];
    }
    sp.taker = taker;

    // 放置函数
    const place = (p, x, z, fx = null, fz = 0) => { p.teleport(x, z, fx ?? p.attackDir, fz); p.lock = true; };
    const keepAway = (p, r) => {
      const d = p.pos.distanceTo(spot);
      if (d < r) { const dir = V().subVectors(p.pos, spot).setY(0); if (dir.lengthSq() < 0.01) dir.set(-T.attackDir, 0, 0.3); dir.normalize(); p.pos.copy(spot).addScaledVector(dir, r); }
      p.pos.x = THREE.MathUtils.clamp(p.pos.x, -F.hl - 1, F.hl + 1); p.pos.z = THREE.MathUtils.clamp(p.pos.z, -F.hw - 1, F.hw + 1);
    };
    const slotOf = (p, phase) => this.ai[p.team.idx].slot(p, phase);

    if (type === 'kickoff') {
      b.reset(0, 0);
      for (const t of this.teams) for (const p of t.active) {
        if (p.isGK) { place(p, t.ownGoalX + t.attackDir * 1.2, 0); continue; }
        const s = slotOf(p, 'def');
        let x = s.x, z = s.z;
        if (x * t.attackDir > -1) x = -t.attackDir * 1.5;
        if (t !== T && Math.hypot(x, z) < F.centerR + 0.5) { const k = (F.centerR + 0.8) / (Math.hypot(x, z) || 1); x *= k; z *= k; }
        place(p, x, z);
      }
      place(taker, -T.attackDir * 0.55, 0.15);
      const mate = outfield(T).filter(p => p !== taker).sort((a, c) => Math.abs(a.pos.x) - Math.abs(c.pos.x))[0];
      if (mate) place(mate, -T.attackDir * 1.2, 3.5);
      this.audio.whistle('short');
      this.hud.commentary(say('kickoff'));
    } else if (type === 'penalty') {
      const gx = goalX;
      for (const t of this.teams) for (const p of t.active) {
        if (p === taker) continue;
        if (p === D.keeper) { place(p, gx - T.attackDir * 0.3, 0, -T.attackDir); continue; }
        if (this.so) { const k = t.players.indexOf(p); place(p, (t.idx ? 1.5 : -1.5) + (k - 2) * 0.1, -6 + k * 1.2, 0, 1); continue; }
        if (p.isGK) { place(p, t.ownGoalX + t.attackDir * 1, 0); continue; }
        const k = t.players.indexOf(p);
        place(p, gx - T.attackDir * (F.boxDepth + 1.5 + (k % 2) * 2), (k - 2.5) * 4);
      }
      place(taker, spot.x - toGoal.x * 1.4, spot.z - toGoal.z * 1.4, toGoal.x, toGoal.z);
      this.cam.special = { type: 'penalty', goalX: gx };
      this.cam.snap();
    } else if (type === 'corner') {
      const sgn = Math.sign(spot.z);
      const att = outfield(T).filter(p => p !== taker);
      const spots = [[5.5, -sgn * 2.5 * -1], [9.5, 0], [6, -sgn * 3.5], [16, -sgn * 6]];
      att.forEach((p, i) => { const s = spots[i % spots.length]; place(p, goalX - T.attackDir * s[0], s[1] + (Math.random() - 0.5)); });
      const def = outfield(D);
      def.forEach((p, i) => { const tgt = att[i % Math.max(1, att.length)]; if (tgt) place(p, tgt.pos.x + T.attackDir * 0.9, tgt.pos.z + (Math.random() - 0.5) * 0.6, -T.attackDir); });
      if (D.keeper) place(D.keeper, goalX - T.attackDir * 0.6, sgn * 1.2, -T.attackDir);
      if (T.keeper) place(T.keeper, T.ownGoalX + T.attackDir * 12, 0);
      const toBox = V().set(goalX - T.attackDir * 10 - spot.x, 0, -spot.z).normalize();
      place(taker, spot.x - toBox.x * 1.2, spot.z - toBox.z * 1.2, toBox.x, toBox.z);
    } else if (type === 'freekick') {
      const dGoal = Math.hypot(goalX - spot.x, spot.z);
      const direct = dGoal < 32 && Math.abs(spot.z) < 22 && (spot.x * T.attackDir) > 0;
      sp.direct = direct;
      for (const p of D.active) { if (!p.isGK) keepAway(p, 8.5); p.teleport(p.pos.x, p.pos.z, -T.attackDir); p.lock = true; }
      for (const p of T.active) { if (p !== taker) { p.teleport(p.pos.x, p.pos.z, T.attackDir); p.lock = true; } }
      if (direct) {
        const wall = outfield(D).sort((a, c) => a.pos.distanceTo(spot) - c.pos.distanceTo(spot)).slice(0, dGoal < 22 ? 3 : 2);
        const perp = V().set(-toGoal.z, 0, toGoal.x);
        wall.forEach((p, i) => { const off = (i - (wall.length - 1) / 2) * 0.72; place(p, spot.x + toGoal.x * 8.5 + perp.x * off, spot.z + toGoal.z * 8.5 + perp.z * off, -toGoal.x, -toGoal.z); });
        if (D.keeper) place(D.keeper, goalX - T.attackDir * 0.8, THREE.MathUtils.clamp(-spot.z * 0.12, -1.5, 1.5), -T.attackDir);
      }
      place(taker, spot.x - toGoal.x * 1.3, spot.z - toGoal.z * 1.3, direct ? toGoal.x : T.attackDir, direct ? toGoal.z : 0);
    } else if (type === 'kickin') {
      for (const p of D.active) { if (!p.isGK) keepAway(p, 5); p.teleport(p.pos.x, p.pos.z); p.lock = true; }
      for (const p of T.active) if (p !== taker) { p.teleport(p.pos.x, p.pos.z); p.lock = true; }
      const inward = -Math.sign(spot.z);
      place(taker, spot.x, spot.z - inward * 0.9, T.attackDir * 0.5, inward);
    } else if (type === 'goalkick') {
      for (const p of D.active) {
        if (p.isGK) continue;
        if (this.inOwnBox(T, p.pos)) p.pos.x = T.ownGoalX + T.attackDir * (F.boxDepth + 2);
        p.teleport(p.pos.x, p.pos.z); p.lock = true;
      }
      for (const p of T.active) if (p !== taker) { const s = slotOf(p, 'mid'); p.teleport(s.x, s.z); p.lock = true; }
      place(taker, spot.x - T.attackDir * 1.2, spot.z, T.attackDir);
    }
    for (const p of this.players) if (!p.sentOff) p.model.root.rotation.y = Math.atan2(p.facing.x, p.facing.z);

    // 真人控制分配
    for (const h of T.humans) h.setPlayer(null);
    for (const h of D.humans) h.setPlayer(null);
    if (T.humans.length) T.humans[0].setPlayer(taker);
    for (const h of T.humans.slice(1)) h.manualSwitch(null);
    if (D.humans.length) {
      if (type === 'penalty' && D.keeper) D.humans[0].setPlayer(D.keeper);
      else D.humans[0].manualSwitch(null);
      for (const h of D.humans.slice(1)) h.manualSwitch(null);
    }
    sp.aiDelay = type === 'kickoff' ? 0.9 : type === 'penalty' ? 1.6 : 1.1 + Math.random() * 0.6;
    sp.kickId = b.kickId;
    sp.humanT = 0;
    if (type !== 'penalty') { this.cam.special = { type: 'setpiece' }; }
    this.state = 'setpiece';
    this.hud.setPieceHint(type, T.humans.length > 0, D.humans.length > 0 && type === 'penalty');
    this.replay.clear();
  }

  updSetPiece(dt) {
    const sp = this.sp, T = sp.team, D = this.otherTeam(T), taker = sp.taker, b = this.ball;
    sp.t += dt;
    b.vel.set(0, 0, 0);
    if (taker.state === 'run') { b.pos.set(sp.spot.x, b.r, sp.spot.z); }
    const human = taker.controller;
    // 真人主罚
    if (human && taker.state === 'run') {
      const dir = human.readDir();
      const d = human.dev;
      sp.humanT += dt;
      if (dir.lengthSq() > 0.05) {
        const want = dir.clone().normalize();
        taker.facing.lerp(want, Math.min(1, dt * 7)).normalize();
      }
      // 瞄准时身位绕球旋转
      taker.pos.set(sp.spot.x - taker.facing.x * 1.1, 0, sp.spot.z - taker.facing.z * 1.1);
      taker.model.root.rotation.y = Math.atan2(taker.facing.x, taker.facing.z);
      this.fx.showArrow(sp.spot, taker.facing, human.color);
      if (d.pressed('shoot')) human.charge = 0;
      if (human.charge >= 0) {
        if (d.held.shoot) human.charge = Math.min(1.25, human.charge + dt / TUNE.shootCharge);
        else {
          const power = human.charge; human.charge = -1;
          taker.lock = false;
          const aim = sp.type === 'penalty' ? this.penaltyAim(taker, dir, power) : aimFromInput(this, taker, taker.facing, power);
          if (sp.type === 'freekick') aim.tz = THREE.MathUtils.clamp(this.aimAlong(taker), -F.goalHalfW - 1.5, F.goalHalfW + 1.5);
          const perfect = power >= TUNE.perfectLo && power <= TUNE.perfectHi;
          doShot(this, taker, Math.max(0.35, power), aim, { finesse: d.held.finesse || sp.type === 'freekick', perfect, setPiece: sp.type });
        }
      } else if (d.pressed('pass') || d.pressed('through')) { taker.lock = false; doPass(this, taker, d.pressed('through') ? 'through' : 'ground', taker.facing.clone()); }
      else if (d.pressed('lob')) { taker.lock = false; doPass(this, taker, sp.type === 'corner' ? 'cross' : 'lob', taker.facing.clone(), null, { arriveH: sp.type === 'corner' ? 1.7 : 0.6 }); }
      else if (sp.humanT > 12 && sp.type !== 'penalty') { taker.lock = false; doPass(this, taker, 'ground', taker.facing.clone()); }
    } else if (!human && taker.state === 'run' && sp.t > sp.aiDelay) {
      taker.lock = false;
      this.aiSetPiece(sp, taker);
    }

    // 点球：门将真人扑救方向
    if (sp.type === 'penalty' && D.keeper) {
      const gk = D.keeper;
      if (taker.state === 'kick' && !sp.gkDecided && taker.stateT > 0.06) {
        sp.gkDecided = true;
        gk.lock = false;
        let side = 0;
        const gh = gk.controller;
        if (gh) {
          const dir = gh.readDir();
          side = Math.abs(dir.z) > 0.3 ? Math.sign(dir.z) : 0;
        } else {
          const skill = (this.ai[D.idx].p.keeper || 0.7);
          const r = Math.random();
          side = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
          sp.gkGuess = side; sp.gkSkill = skill;
        }
        sp.gkSide = side;
      }
    }

    for (const p of this.players) {
      if (p.sentOff) continue;
      if (p !== taker) p.moveInput.set(0, 0, 0);
      p.update(dt, this);
    }
    if (b.kickId !== sp.kickId) {
      // 球已踢出
      this.fx.hideArrow();
      for (const p of this.players) p.lock = false;
      taker.controlCD = 0.35;
      if (sp.type === 'penalty' && D.keeper) this.penaltyDive(D.keeper, sp);
      this.hud.setPieceHint(null);
      if (this.so) { this.state = 'pwatch'; this.pwT = 0; return; }
      this.state = 'play';
      this.cam.special = null;
      if (sp.type === 'penalty') this.cam.snap();
      return;
    }
    const ev = b.update(dt, this.audio);
    this.handleBallEvents(ev);
  }

  aimAlong(p) {
    // 射线与门线交点
    const gx = p.attackDir * F.hl;
    const f = p.facing;
    if (Math.abs(f.x) < 0.05) return 0;
    const t = (gx - this.ball.pos.x) / f.x;
    return this.ball.pos.z + f.z * t;
  }

  penaltyAim(p, dir, power) {
    // 点球：摇杆左右 → 左右角，力度 → 高度
    const lat = dir.lengthSq() > 0.05 ? THREE.MathUtils.clamp(dir.z * 1.25, -1.2, 1.2) : 0;
    return { tz: lat * (F.goalHalfW - 0.3), ty: 0.3 + Math.min(1, power) * 1.9 };
  }

  penaltyDive(gk, sp) {
    const side = sp.gkSide ?? 0;
    const left = V().set(gk.facing.z, 0, -gk.facing.x);
    const b = this.ball;
    // AI 高手有概率读出方向
    if (!gk.controller && sp.gkSkill) {
      const pr = this.predictCross(gk.pos.x);
      if (pr && Math.random() < sp.gkSkill * 0.35) sp.gkSide = Math.abs(pr.z) < 1 ? 0 : Math.sign(pr.z);
    }
    const s = sp.gkSide ?? side;
    if (s === 0) { gk.setState('catch', 0.7, { low: false, willSave: Math.random() < 0.85 }); return; }
    const dir = V().set(0, 0, s);
    const pr = this.predictCross(gk.pos.x);
    const high = pr ? pr.y > 1.7 : false;
    gk.setState('dive', 1.0, { dir, speed: 4.2, side: Math.sign(dir.dot(left)) || 1, high, low: pr ? pr.y < 0.6 : false, willSave: Math.random() < 0.78 });
    this.audio.whoosh();
  }

  aiSetPiece(sp, taker) {
    const T = sp.team;
    const params = this.ai[T.idx].p;
    const errMul = 1 + params.aimErr * 5;
    switch (sp.type) {
      case 'kickoff': {
        const q = T.active.filter(p => p !== taker && !p.isGK).sort((a, c) => a.pos.distanceTo(taker.pos) - c.pos.distanceTo(taker.pos))[0];
        doPass(this, taker, 'ground', q.pos.clone().sub(taker.pos), q);
        break;
      }
      case 'penalty': {
        const side = Math.random() < 0.5 ? -1 : 1;
        const aim = { tz: side * (F.goalHalfW - 0.6 - Math.random() * 1.2), ty: 0.3 + Math.random() * 1.6 };
        taker.facing.set(T.attackDir, 0, 0);
        doShot(this, taker, 0.8, aim, { errMul, setPiece: 'penalty' });
        break;
      }
      case 'freekick': {
        if (sp.direct && Math.random() < 0.7) {
          const side = Math.random() < 0.5 ? -1 : 1;
          doShot(this, taker, 0.82, { tz: side * (F.goalHalfW - 0.7), ty: 1.5 + Math.random() * 0.6 }, { finesse: true, errMul, setPiece: 'freekick' });
        } else {
          const q = pickReceiver(this, taker, V().set(T.attackDir, 0, 0), 'ground');
          doPass(this, taker, q && q.pos.distanceTo(taker.pos) > 20 ? 'lob' : 'ground', q ? q.pos.clone().sub(taker.pos) : null, q);
        }
        break;
      }
      case 'corner': {
        const box = T.active.filter(p => p !== taker && !p.isGK && Math.abs(p.pos.x - T.attackDir * F.hl) < F.boxDepth);
        if (box.length && Math.random() < 0.8) {
          const q = box[(Math.random() * box.length) | 0];
          doPass(this, taker, 'cross', q.pos.clone().sub(taker.pos), q, { arriveH: 1.7 });
        } else {
          const q = pickReceiver(this, taker, V().set(0, 0, -Math.sign(taker.pos.z)), 'ground');
          doPass(this, taker, 'ground', q ? q.pos.clone().sub(taker.pos) : null, q);
        }
        break;
      }
      case 'goalkick': {
        const fw = T.active.filter(p => !p.isGK).sort((a, c) => c.pos.x * T.attackDir - a.pos.x * T.attackDir)[Math.random() < 0.6 ? 0 : 1];
        const short = T.active.find(p => p.role === 'DF');
        if (short && Math.random() < 0.35 && this.laneSafety(taker.pos, short.pos, T) > 0.6) doPass(this, taker, 'ground', short.pos.clone().sub(taker.pos), short);
        else doPass(this, taker, 'lob', fw.pos.clone().sub(taker.pos), fw);
        break;
      }
      default: {
        const q = pickReceiver(this, taker, V().set(T.attackDir, 0, -Math.sign(taker.pos.z) * 0.8), 'ground');
        doPass(this, taker, q && q.pos.distanceTo(taker.pos) > 18 ? 'lob' : 'ground', q ? q.pos.clone().sub(taker.pos) : null, q);
      }
    }
  }

  // ================= 点球大战 =================
  startShootout() {
    this.so = { kicks: [[], []], turn: 0, next: 0 };
    this.soScore = [0, 0];
    this.hud.shootout(this.so);
    this.hud.banner('点球大战', 'half');
    this.soSavedAttack = this.teams.map(t => t.attackDir);
    this.state = 'pwait';
    this.after(1.2, () => this.soNextKick());
  }

  soNextKick() {
    const so = this.so;
    const T = this.teams[so.turn], D = this.teams[1 - so.turn];
    T.attackDir = 1; D.attackDir = -1;
    this.setPiece('penalty', T.idx, V().set(F.hl - F.penSpot, 0, 0));
    this.stateT = 0.6;
  }

  updPenaltyWatch(dt) {
    this.pwT += dt;
    const b = this.ball;
    const ev = b.update(dt, this.audio);
    this.handleBallEvents(ev);
    this.keeperContact();
    this.bodyBlocks();
    for (const p of this.players) if (!p.sentOff) { if (p.state === 'run') p.moveInput.set(0, 0, 0); p.update(dt, this); }
    if (this.soDone) return;
    const ax = Math.abs(b.pos.x);
    if (ax > F.hl + b.r && Math.abs(b.pos.z) < F.goalHalfW && b.pos.y < F.goalH) {
      this.soDone = true;
      this.goal(this.teams[this.so.turn]);
      return;
    }
    const dead = b.heldBy || (b.vel.length() < 1 && this.pwT > 1) || ax > F.hl + 1 || this.pwT > 3.5 || (b.vel.x < -2 && this.pwT > 0.5);
    if (dead) { this.soDone = true; this.soResult(false); }
  }

  soResult(scored) {
    const so = this.so;
    const T = this.teams[so.turn];
    so.kicks[so.turn].push(scored);
    if (scored) this.soScore[so.turn]++;
    else { this.audio.groan(); this.hud.flash(so.kicks[so.turn].length ? '没进！' : '', '#ff6b6b'); }
    this.hud.shootout(so);
    this.state = 'pwait';
    const k0 = so.kicks[0].length, k1 = so.kicks[1].length;
    const [a, bb] = this.soScore;
    let decided = false;
    if (k0 <= 5 && k1 <= 5) {
      if (a > bb + (5 - k1) || bb > a + (5 - k0)) decided = true;
    }
    if (k0 === k1 && k0 >= 5 && a !== bb) decided = true;
    this.after(scored ? 2.2 : 1.5, () => {
      this.soDone = false;
      this.cam.special = null;
      if (decided) {
        this.teams.forEach((t, i) => { t.attackDir = this.soSavedAttack[i]; });
        this.hud.shootout(so, true);
        this.finish();
      } else {
        so.turn = 1 - so.turn;
        this.soNextKick();
      }
    });
  }

  after(t, fn) { this.state = 'pwait'; this.waitT = t; this.waitFn = fn; }

  // ================= 圈圈 / 标记 =================
  updateRings() {
    for (const { hc, ring } of this.rings) {
      const p = hc.player;
      ring.visible = !!p && this.state !== 'replay' && this.state !== 'intro' && this.state !== 'done';
      if (!p) continue;
      ring.position.set(p.pos.x, 0.04, p.pos.z);
      ring.rotation.y = Math.atan2(p.facing.x, p.facing.z);
      const s = 1 + Math.sin(this.time * 6) * 0.06;
      ring.scale.set(s, 1, s);
    }
  }
}

function colorDist(a, b) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b);
}

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
