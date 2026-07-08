import * as THREE from 'three';
import { F } from './stadium.js';

// 难度参数
export const DIFFS = {
  easy:   { label: '简单', speed: 0.78, react: 0.5,  aimErr: 0.3,  stealRate: 0.8, keeper: 0.5,  passIQ: 0.5,  pressers: 1 },
  normal: { label: '普通', speed: 0.92, react: 0.28, aimErr: 0.17, stealRate: 1.5, keeper: 0.72, passIQ: 0.75, pressers: 1 },
  hard:   { label: '困难', speed: 1.03, react: 0.13, aimErr: 0.09, stealRate: 2.4, keeper: 0.88, passIQ: 0.9,  pressers: 2 },
  legend: { label: '传奇', speed: 1.12, react: 0.05, aimErr: 0.04, stealRate: 3.2, keeper: 0.96, passIQ: 0.98, pressers: 2 },
};

// 玩家队友 AI 固定水平（不随难度变化）
export const ALLY_PARAMS = { speed: 0.95, react: 0.2, aimErr: 0.14, stealRate: 1.7, keeper: 0.8, passIQ: 0.8, pressers: 1 };

const tmpV = new THREE.Vector3();

export class TeamAI {
  constructor(match, teamKey, params) {
    this.match = match;
    this.team = teamKey;
    this.p = params;
    this.decideTimer = 0;
  }

  get players() { return this.match.players.filter(pl => pl.team === this.team); }
  get opponents() { return this.match.players.filter(pl => pl.team !== this.team); }

  update(dt) {
    const m = this.match;
    const ball = m.ball;
    const mine = this.players;
    const attackDir = mine[0].attackDir;
    const enemyGoal = new THREE.Vector3(attackDir * F.L / 2, 0, 0);
    const ownGoal = new THREE.Vector3(-attackDir * F.L / 2, 0, 0);

    // 我方是否控球
    const ourBall = ball.owner && ball.owner.team === this.team;
    const theirBall = (ball.owner && ball.owner.team !== this.team) || (ball.heldBy && ball.heldBy.team !== this.team);

    // 反应延迟：追一个稍旧/带噪声的球位置
    const reactPos = tmpV.set(
      ball.pos.x - ball.vel.x * this.p.react * 0.5,
      0,
      ball.pos.z - ball.vel.z * this.p.react * 0.5
    ).clone();

    // 选出追球者（离球最近的非门将，困难以上双人逼抢）
    const outfield = mine.filter(pl => pl.role !== 'GK' && !pl.isUser);
    const sorted = [...outfield].sort((a, b) => a.dist2(ball.pos) - b.dist2(ball.pos));
    const chasers = new Set();
    if (!ourBall) {
      for (let i = 0; i < Math.min(this.p.pressers, sorted.length); i++) chasers.add(sorted[i]);
    }

    for (const pl of mine) {
      if (pl.isUser) continue;         // 玩家操控者跳过
      if (ball.heldBy === pl) continue; // 抱球门将由 match 处理

      if (pl.role === 'GK') {
        this.keeperLogic(pl, dt, ownGoal, attackDir);
        continue;
      }

      pl.decideT -= dt;

      if (ball.owner === pl) {
        this.carrierLogic(pl, enemyGoal, dt);
      } else if (chasers.has(pl)) {
        // 追球 / 逼抢
        this.seek(pl, reactPos.x, reactPos.z, true);
      } else {
        // 跑位：以阵型基准点随球移动
        const shiftX = THREE.MathUtils.clamp(ball.pos.x * 0.42, -26, 26);
        const shiftZ = THREE.MathUtils.clamp(ball.pos.z * 0.3, -10, 10);
        let hx = pl.home.x + shiftX;
        let hz = pl.home.z + shiftZ;
        if (theirBall) {
          // 防守：回收到球与本方球门之间
          hx = (pl.home.x * 0.5) + (ball.pos.x + ownGoal.x) * 0.32;
          hz = pl.home.z * 0.55 + ball.pos.z * 0.35;
        } else if (ourBall) {
          // 进攻：前插
          hx += attackDir * 8;
        }
        hx = THREE.MathUtils.clamp(hx, -F.L / 2 + 3, F.L / 2 - 3);
        hz = THREE.MathUtils.clamp(hz, -F.W / 2 + 2, F.W / 2 - 2);
        this.seek(pl, hx, hz, theirBall);
      }
    }
  }

  seek(pl, x, z, sprint = false) {
    const dx = x - pl.pos.x, dz = z - pl.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) {
      pl.moveDir.set(0, 0, 0);
      pl.wantSprint = false;
      return;
    }
    pl.moveDir.set(dx / d, 0, dz / d);
    pl.wantSprint = sprint && d > 4;
  }

  // 带球者决策
  carrierLogic(pl, enemyGoal, dt) {
    const m = this.match;
    const distGoal = pl.distTo(enemyGoal);
    const nearestOpp = this.nearestOpponent(pl.pos);
    const oppDist = nearestOpp ? nearestOpp.distTo(pl.pos) : 99;

    // 射门时机
    if (distGoal < 27 && Math.abs(pl.pos.z) < 22) {
      if (pl.decideT <= 0) {
        pl.decideT = 0.25 + this.p.react;
        const shootChance = distGoal < 14 ? 0.95 : distGoal < 20 ? 0.6 : 0.3;
        if (Math.random() < shootChance) {
          this.shoot(pl, enemyGoal);
          return;
        }
      }
    }

    // 被逼抢 → 传球
    if (oppDist < 3.8 && Math.random() < this.p.passIQ * dt * 6) {
      const mate = this.bestPassTarget(pl, enemyGoal);
      if (mate) { m.passBall(pl, mate, this.p.aimErr); return; }
    }

    // 盘带推进：朝球门，避开最近防守者
    const dir = tmpV.set(enemyGoal.x - pl.pos.x, 0, enemyGoal.z * 0.3 + (Math.abs(pl.pos.z) > 18 ? -Math.sign(pl.pos.z) * 8 : 0) - pl.pos.z).normalize();
    if (nearestOpp && oppDist < 6) {
      const ox = pl.pos.x - nearestOpp.pos.x, oz = pl.pos.z - nearestOpp.pos.z;
      const od = Math.hypot(ox, oz) || 1;
      dir.x += (ox / od) * 0.8;
      dir.z += (oz / od) * 0.8;
      dir.normalize();
    }
    pl.moveDir.copy(dir);
    pl.wantSprint = oppDist > 3;
  }

  shoot(pl, enemyGoal) {
    const m = this.match;
    // 瞄准球门内随机点 + 难度误差
    const aimZ = (Math.random() - 0.5) * (F.goalHalfW * 2 - 1.6);
    const err = (Math.random() - 0.5) * 2 * this.p.aimErr;
    const target = tmpV.set(enemyGoal.x, 0, aimZ);
    const dx = target.x - m.ball.pos.x, dz = target.z - m.ball.pos.z;
    const d = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx) + err;
    const speed = THREE.MathUtils.clamp(d * 1.05 + 13, 17, 33);
    const vy = 1.8 + d * 0.09 + Math.random() * 1.5;
    m.kickBall(pl, Math.cos(angle) * speed, Math.min(vy, 8.5), Math.sin(angle) * speed, speed / 33);
  }

  bestPassTarget(pl, enemyGoal) {
    let best = null, bestScore = -1e9;
    for (const mate of this.players) {
      if (mate === pl || mate.role === 'GK') continue;
      const d = mate.distTo(pl.pos);
      if (d < 4 || d > 42) continue;
      // 越靠前越好、越无人盯防越好
      const opp = this.nearestOpponent(mate.pos);
      const openness = opp ? Math.min(10, opp.distTo(mate.pos)) : 10;
      const forward = -mate.distTo(enemyGoal);
      const score = openness * 2.2 + forward * 0.8 - d * 0.25;
      if (score > bestScore) { bestScore = score; best = mate; }
    }
    return best;
  }

  nearestOpponent(pos) {
    let best = null, bd = Infinity;
    for (const o of this.opponents) {
      const d = o.dist2(pos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  keeperLogic(pl, dt, ownGoal, attackDir) {
    const m = this.match;
    const ball = m.ball;
    const gx = ownGoal.x;
    const side = Math.sign(gx); // 球门在 ±50

    // 预测球到达门线时的 z
    let targetZ = ball.pos.z;
    const towardGoal = ball.vel.x * side > 4;
    if (towardGoal && Math.abs(ball.pos.x - gx) < 34) {
      const t = (gx - ball.pos.x) / ball.vel.x;
      if (t > 0 && t < 2.5) targetZ = ball.pos.z + ball.vel.z * t;
    }
    targetZ = THREE.MathUtils.clamp(targetZ * (0.55 + this.p.keeper * 0.45), -F.goalHalfW + 0.7, F.goalHalfW - 0.7);

    // 站位 x：球近时稍微出击
    const ballDist = Math.abs(ball.pos.x - gx);
    let standX = gx - side * 1.6;
    if (ballDist < 17 && Math.abs(ball.pos.z) < 14) standX = gx - side * (2.5 + this.p.keeper * 3.5);

    // 球在禁区且慢 → 冲出去拿球
    const inBox = Math.abs(ball.pos.x - gx) < 15 && Math.abs(ball.pos.z) < 19;
    const ballSlow = ball.vel.length() < 9;
    if (inBox && ballSlow && !ball.owner && !ball.heldBy) {
      this.seek(pl, ball.pos.x, ball.pos.z, true);
      pl.speedMul = 0.85 + this.p.keeper * 0.35;
      return;
    }

    pl.speedMul = 0.62 + this.p.keeper * 0.4;
    this.seek(pl, standX, targetZ, towardGoal);
  }
}
