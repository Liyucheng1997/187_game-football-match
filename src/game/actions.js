import * as THREE from 'three';
import { F, PHYS, TUNE } from '../config.js';
import { solveKick, groundPassSpeed } from './ball.js';

const up = new THREE.Vector3(0, 1, 0);
const randn = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

// 球是否在该球员脚下可踢范围
export function ballReachable(m, p, extra = 0) {
  const b = m.ball;
  if (b.heldBy) return false;
  if (b.owner === p) return true;
  if (b.owner && b.owner !== p) return false;
  const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
  return Math.hypot(dx, dz) < 1.25 + extra && b.pos.y < 1.0;
}

export function aerialReachable(m, p) {
  const b = m.ball;
  if (b.owner || b.heldBy) return false;
  const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z;
  return Math.hypot(dx, dz) < 1.5 && b.pos.y >= 0.9 && b.pos.y < 2.7;
}

// ---------- 传球目标选择（方向锥 + 空位 + 线路安全） ----------
export function pickReceiver(m, p, dir, kind = 'ground') {
  let best = null, bs = -1e9;
  const d0 = dir.lengthSq() > 0.01 ? dir.clone().normalize() : p.facing.clone();
  for (const q of p.team.active) {
    if (q === p) continue;
    if (q.isGK && kind !== 'back') { /* 仍允许回传门将，但降低权重 */ }
    const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 2.5) continue;
    const dot = (dx * d0.x + dz * d0.z) / d;
    if (dot < 0.2 && dir.lengthSq() > 0.01) continue;
    const open = m.openness(q.pos, p.team);
    const lane = m.laneSafety(p.pos, q.pos, p.team);
    let score = dot * 26 - d * (kind === 'lob' ? 0.1 : 0.32) + open * 1.2 + lane * 6;
    if (q.isGK) score -= 14;
    if (kind === 'through') score += (q.pos.x - p.pos.x) * p.attackDir * 0.4;
    if (score > bs) { bs = score; best = q; }
  }
  return best;
}

// ---------- 传球 ----------
export function doPass(m, p, kind = 'ground', dir = null, receiver = null, opts = {}) {
  const d = dir || p.facing;
  const q = receiver || pickReceiver(m, p, d, kind);
  const isGKThrow = p === m.ball.heldBy;
  const team = p.team;
  const skill = p.stats.pas / 100;
  const errScale = opts.err ?? 1;

  // 计算目标点
  const tgt = new THREE.Vector3();
  let target = q;
  if (q) {
    const lead = kind === 'through' ? 0 : 1;
    const dist = q.pos.distanceTo(p.pos);
    const tt = dist / (kind === 'lob' ? 16 : 18);
    tgt.set(q.pos.x + q.vel.x * tt * lead * 0.8, 0, q.pos.z + q.vel.z * tt * lead * 0.8);
    if (kind === 'through') {
      // 直塞：打到接球人身前空当
      const run = new THREE.Vector3(p.attackDir, 0, -q.pos.z * 0.02);
      if (q.vel.lengthSq() > 4) run.add(q.vel.clone().normalize().multiplyScalar(0.8));
      run.normalize();
      tgt.copy(q.pos).addScaledVector(run, 6 + Math.min(6, dist * 0.15));
    }
  } else {
    // 没有队友：往方向上开大脚
    tgt.copy(p.pos).addScaledVector(d.clone().normalize(), kind === 'lob' ? 28 : 14);
  }
  tgt.x = THREE.MathUtils.clamp(tgt.x, -F.hl + 1, F.hl - 1);
  tgt.z = THREE.MathUtils.clamp(tgt.z, -F.hw + 1, F.hw - 1);

  const exec = () => {
    const b = m.ball;
    if (!isGKThrow && !ballReachable(m, p, 0.3)) return false;
    if (isGKThrow) { b.heldBy = null; p.holding = false; }
    const from = b.pos.clone();
    const D = Math.hypot(tgt.x - from.x, tgt.z - from.z);
    const err = ((1 - skill) * 0.11 + 0.012) * errScale * (1 + D / 40);
    const ang = randn() * err;
    const t2 = tgt.clone().sub(from).applyAxisAngle(up, ang).add(from);
    let v;
    if (kind === 'lob' || kind === 'cross' || kind === 'clear' || (isGKThrow && opts.long)) {
      const h = opts.arriveH ?? (kind === 'cross' ? 1.6 : 0.6);
      const hs = THREE.MathUtils.clamp(8 + D * 0.42, 11, 26);
      t2.y = h;
      v = solveKick(from, t2, hs, new THREE.Vector3(), b.env);
      if (v.y < 3) v.y = 3 + D * 0.12;
    } else if (isGKThrow) {
      const dx = t2.x - from.x, dz = t2.z - from.z;
      const s = THREE.MathUtils.clamp(9 + D * 0.5, 10, 20);
      v = new THREE.Vector3(dx / D * s, 2 + D * 0.08, dz / D * s);
    } else {
      const arrive = kind === 'through' ? 4.5 : 7 + D * 0.12;
      const s = THREE.MathUtils.clamp(groundPassSpeed(D, arrive, b.env), 7, 28) * (0.97 + Math.random() * 0.06);
      const dx = t2.x - from.x, dz = t2.z - from.z;
      v = new THREE.Vector3(dx / D * s, 0.15, dz / D * s);
    }
    b.kick(v, new THREE.Vector3(), p, kind, { pass: true, team: team.idx, to: target, from: p });
    m.onPass(p, target, kind);
    m.audio.kick(Math.min(1, v.length() / 30));
    return true;
  };

  if (isGKThrow) {
    if (opts.long) p.startKick('lob', exec, { dur: 0.5, strike: 0.4 });
    else p.setState('throw', 0.55, { fn: exec, strike: 0.3, done: false });
  } else {
    const firstTime = m.ball.owner !== p;
    p.startKick(kind === 'lob' || kind === 'cross' || kind === 'clear' ? 'lob' : kind, exec, { dur: firstTime ? 0.34 : 0.4, strike: firstTime ? 0.25 : 0.34 });
  }
  if (q) m.expectReceiver(q, team);
  return q;
}

// ---------- 射门 ----------
// aim: { tz, ty } 目标在对方门线上的位置；或 null 让系统自动选择
export function doShot(m, p, power, aim = null, opts = {}) {
  const team = p.team;
  const gx = team.attackDir * F.hl;
  const kind = opts.super ? 'super' : opts.header ? 'header' : 'shot';
  const exec = () => {
    const b = m.ball;
    const head = kind === 'header';
    if (head ? !(b.pos.distanceTo(p.pos.clone().setY(b.pos.y)) < 1.7 && b.pos.y > 0.7 && b.pos.y < 3.1) : !ballReachable(m, p, 0.35)) return false;
    const from = b.pos.clone();
    const D = Math.hypot(gx - from.x, 0 - from.z);
    let tz, ty;
    if (aim) { tz = aim.tz; ty = aim.ty; }
    else {
      const gk = m.teams[1 - team.idx].keeper;
      const side = gk ? (gk.pos.z > 0 ? -1 : 1) : (Math.random() < 0.5 ? -1 : 1);
      tz = side * (F.goalHalfW - 0.6); ty = 0.4 + Math.random() * 1.3;
    }
    const sk = p.stats.sht / 100;
    let speed = head ? 13 + sk * 7 : (14 + power * 21) * (0.84 + sk * 0.24);
    if (opts.finesse) speed *= 0.8;
    if (opts.perfect) speed *= 1.07;
    if (kind === 'super') speed = 37;
    // 误差
    let err = (1 - sk) * 0.075 + 0.012;
    if (power > 1) err += (power - 1) * 0.5;
    if (opts.perfect) err *= 0.35;
    if (opts.volley) err *= 1.4;
    if (head) err *= 1.3;
    const pressure = m.nearestOpponentDist(p);
    if (pressure < 1.6) err += 0.025;
    err *= opts.errMul ?? 1;
    if (kind === 'super') err = 0.01;
    tz += randn() * err * D;
    ty += randn() * err * D * 0.5 + (power > 1 ? (power - 1) * 8 : 0);
    ty = Math.max(0.25, ty);
    // 旋转
    const dir = new THREE.Vector3(gx - from.x, 0, tz - from.z).normalize();
    const spin = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(head ? 0 : 6 + power * 6); // 上旋下坠
    if (opts.finesse) spin.y = Math.sign(tz || 1) * Math.sign(dir.x) * 26;
    if (kind === 'super') spin.y = (Math.random() < 0.5 ? -1 : 1) * 14;
    const v = solveKick(from, new THREE.Vector3(gx, ty, tz), speed, spin, b.env);
    b.kick(v, spin, p, kind, { shot: true, team: team.idx, shooter: p, dist: D, header: head, volley: !!opts.volley, setPiece: opts.setPiece || null, super: kind === 'super' });
    m.onShot(p, kind, D);
    m.audio.kick(Math.min(1, speed / 30));
    if (kind === 'super') m.onSuperShot(p);
    return true;
  };
  if (opts.header) {
    p.setState('header', 0.6, { fn: exec, strike: 0.18, done: false, jump: m.ball.pos.y > 1.7 });
  } else {
    const first = m.ball.owner !== p;
    p.startKick(kind, exec, { dur: kind === 'super' ? 0.6 : first ? 0.36 : 0.44, strike: kind === 'super' ? 0.5 : first ? 0.3 : 0.36, volley: !!opts.volley });
  }
  if (kind === 'super') { team.fever = 0; m.superCharge(p); }
}

// 人类射门：根据摇杆方向换算门内落点
export function aimFromInput(m, p, dir, power) {
  const gx = p.attackDir * F.hl;
  const b = m.ball.pos;
  let tz;
  if (dir && dir.lengthSq() > 0.05) {
    const d = dir.clone().normalize();
    const along = d.x * p.attackDir;
    // 摇杆横向分量 → 近/远角
    const lat = d.z;
    if (along > -0.2) tz = THREE.MathUtils.clamp(lat * 1.35, -1, 1) * (F.goalHalfW - 0.45);
    else tz = THREE.MathUtils.clamp(b.z * 0.2, -2, 2);
    // 如果摇杆几乎只朝前，瞄向远角
    if (Math.abs(lat) < 0.25) tz = -Math.sign(b.z || 1) * (F.goalHalfW - 1.2) * Math.min(1, Math.abs(b.z) / 10);
  } else {
    tz = -Math.sign(b.z || 1) * (F.goalHalfW - 1.0) * Math.min(1, Math.abs(b.z) / 8);
  }
  const ty = 0.35 + Math.min(1, power) * 1.65;
  return { tz, ty, gx };
}

// ---------- 抢断 / 铲球 / 花式 ----------
export function doTackle(m, p) {
  if (!p.canAct || p.tackleCD > 0) return false;
  p.setState('tackle', 0.42, { resolved: false, slide: false });
  p.tackleCD = 0.75;
  return true;
}

export function doSlide(m, p) {
  if (!p.canAct || p.tackleCD > 0) return false;
  p.setState('slide', 0.8, { resolved: false, slide: true, fouled: false });
  p.tackleCD = 1.4;
  p.stamina = Math.max(0, p.stamina - 8);
  m.audio.slide();
  m.fx.grass(p.pos.x, p.pos.z, p.facing, 20);
  return true;
}

export function doSkill(m, p, dir) {
  if (!p.canAct || m.ball.owner !== p || p.skillCD > 0) return false;
  const f = p.facing;
  let type = 'roulette', side = 1, d = f.clone();
  if (dir && dir.lengthSq() > 0.1) {
    const n = dir.clone().normalize();
    const cross = f.x * n.z - f.z * n.x;
    const dot = f.x * n.x + f.z * n.z;
    if (Math.abs(cross) > 0.45 && dot > -0.3) { type = 'cut'; side = Math.sign(cross); d = n; }
    else d = n;
  }
  const speed = type === 'cut' ? 8.5 : 5.5;
  p.setState('skill', type === 'cut' ? 0.32 : 0.46, { type, side, dir: d, speed, spinDir: Math.random() < 0.5 ? 1 : -1 });
  p.skillCD = 1.1;
  p.stamina = Math.max(0, p.stamina - 6);
  m.onSkill(p);
  return true;
}

export { TUNE, PHYS };
