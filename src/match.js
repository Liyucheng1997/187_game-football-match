import * as THREE from 'three';
import { F } from './stadium.js';
import { Ball, Player } from './entities.js';
import { TeamAI, DIFFS, ALLY_PARAMS } from './ai.js';

const $ = id => document.getElementById(id);

export class Match {
  constructor(world) {
    this.world = world;               // { scene, camera, input, audio, fx, crowd }
    this.ball = new Ball(world.scene);
    this.players = [];
    this.state = 'menu';
    this.scoreA = 0;
    this.scoreB = 0;
    this.timeLeft = 180;
    this.duration = 180;
    this.overtime = false;
    this.diffKey = 'normal';
    this.user = null;
    this.charge = -1;                 // <0 未蓄力
    this.holdTimer = 0;
    this.stateT = 0;
    this.pendingKickTeam = 'A';
    this.shake = 0;

    // 受控球员光圈
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.8, 28),
      new THREE.MeshBasicMaterial({ color: 0xffe74a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    world.scene.add(this.ring);

    this.miniCtx = $('minimap').getContext('2d');
  }

  // ---------- 建队 ----------
  createTeams() {
    for (const p of this.players) this.world.scene.remove(p.mesh);
    this.players = [];
    const mk = (team, role, number, colors, attackDir, homeX, homeZ) => {
      const pl = new Player(this.world.scene, { team, role, number, colors, attackDir, baseSpeed: role === 'GK' ? 9 : 10 });
      pl.home.set(homeX, 0, homeZ);
      this.players.push(pl);
      return pl;
    };
    const A = { shirt: 0xd32f2f, shorts: 0xffffff, socks: 0xd32f2f };
    const AGK = { shirt: 0xffb300, shorts: 0x212121, socks: 0xffb300 };
    const B = { shirt: 0x1e88e5, shorts: 0x102a52, socks: 0x1e88e5 };
    const BGK = { shirt: 0x00c853, shorts: 0x212121, socks: 0x00c853 };

    // 红队（玩家）攻 +x
    mk('A', 'GK', 1, AGK, 1, -47, 0);
    mk('A', 'F', 4, A, 1, -18, -13);
    mk('A', 'F', 7, A, 1, -18, 13);
    this.strikerA = mk('A', 'F', 9, A, 1, -7, 0);
    // 蓝队（电脑）攻 -x
    mk('B', 'GK', 1, BGK, -1, 47, 0);
    mk('B', 'F', 4, B, -1, 18, -13);
    mk('B', 'F', 7, B, -1, 18, 13);
    mk('B', 'F', 9, B, -1, 7, 0);
  }

  startMatch(diffKey, duration) {
    this.diffKey = diffKey;
    const diff = DIFFS[diffKey];
    this.duration = this.timeLeft = duration;
    this.scoreA = 0; this.scoreB = 0;
    this.overtime = false;
    this.createTeams();

    this.aiB = new TeamAI(this, 'B', diff);
    this.aiA = new TeamAI(this, 'A', ALLY_PARAMS);
    for (const pl of this.players) {
      if (pl.team === 'B') pl.speedMul = diff.speed;
      else pl.speedMul = ALLY_PARAMS.speed;
    }

    $('diffTag').textContent = `难度 · ${diff.label}`;
    $('scoreA').textContent = '0';
    $('scoreB').textContent = '0';
    this.resetPositions('A');
    this.beginCountdown(3.6, true);
  }

  resetPositions(kickTeam) {
    this.pendingKickTeam = kickTeam;
    this.ball.reset();
    this.charge = -1;
    for (const pl of this.players) {
      const s = pl.attackDir;
      if (pl.role === 'GK') { pl.teleport(-s * 47.5, 0, s); continue; }
      let x = pl.home.x, z = pl.home.z;
      const isKicker = pl.team === kickTeam && Math.abs(pl.home.z) < 2;
      if (isKicker) { x = -s * 1.4; z = 0.5; }
      else if (Math.abs(pl.home.z) < 2) x = -s * 9;
      pl.teleport(x, z, s);
    }
    const striker = this.players.find(p => p.team === 'A' && p.role !== 'GK' && Math.abs(p.home.z) < 2);
    this.setControlled(striker);
  }

  beginCountdown(t, long = false) {
    this.state = 'countdown';
    this.stateT = t;
    this.cdLong = long;
    this.cdShown = -1;
  }

  setControlled(pl) {
    for (const p of this.players) if (p.team === 'A') {
      p.isUser = false;
      p.speedMul = ALLY_PARAMS.speed;
    }
    if (pl) {
      pl.isUser = true;
      pl.speedMul = 1;
      this.user = pl;
    }
  }

  banner(text, subtle = false) {
    const b = $('banner');
    b.textContent = text;
    b.className = subtle ? 'show subtle' : 'show';
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { b.className = ''; }, 1400);
  }

  // ---------- 主更新 ----------
  update(dt, t) {
    const { audio, fx, crowd, input } = this.world;

    if (this.state === 'menu' || this.state === 'end') return;

    // 倒计时
    if (this.state === 'countdown') {
      this.stateT -= dt;
      if (this.cdLong) {
        const n = Math.ceil(this.stateT - 0.4);
        if (n >= 1 && n <= 3 && n !== this.cdShown) { this.cdShown = n; this.banner(String(n)); audio.click(); }
      }
      if (this.stateT <= 0.4 && this.cdShown !== 0) {
        this.cdShown = 0;
        this.banner('⚽ 开球！', true);
        audio.whistle('start');
      }
      if (this.stateT <= 0) this.state = 'play';
      this.updateCamera(dt);
      this.updateHUD();
      return;
    }

    // 进球暂停（庆祝）
    if (this.state === 'goalPause') {
      this.stateT -= dt;
      this.ball.update(dt, audio);
      for (const pl of this.players) {
        // 庆祝：进球方朝人群跑
        pl.update(dt);
      }
      fx.update(dt);
      crowd.update(t, dt);
      this.updateCamera(dt);
      if (this.stateT <= 0) {
        if (this.overtime && this.scoreA !== this.scoreB) { this.endMatch(); return; }
        this.resetPositions(this.pendingKickTeam);
        this.beginCountdown(1.6);
      }
      return;
    }

    // ===== 正常比赛 =====
    if (!this.overtime) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        if (this.scoreA === this.scoreB) {
          this.overtime = true;
          this.banner('⚡ 金球大战 ⚡', true);
          audio.whistle('start');
        } else { this.endMatch(); return; }
      }
    }

    // 人群兴奋度随战况
    const nearGoal = Math.max(0, (Math.abs(this.ball.pos.x) - 25) / 25);
    audio.setExcitement(Math.min(1, nearGoal));

    this.updatePossession(dt);
    this.humanControl(dt);
    this.aiA.update(dt);
    this.aiB.update(dt);
    this.keeperHold(dt);

    for (const pl of this.players) pl.update(dt);
    this.separatePlayers();
    const ev = this.ball.update(dt, audio);
    if (ev === 'post') this.shake = Math.max(this.shake, 0.5);

    this.checkGoal();
    fx.update(dt);
    crowd.update(t, dt);
    this.updateCamera(dt);
    this.updateHUD();
    this.drawMinimap();
  }

  // ---------- 控球 / 抢断 ----------
  updatePossession(dt) {
    const ball = this.ball;
    if (ball.heldBy) return;
    const diff = DIFFS[this.diffKey];

    // 现有控球者失去范围则丢球
    if (ball.owner) {
      if (ball.owner.distTo(ball.pos) > 2.6) ball.owner = null;
    }

    const reachable = ball.pos.y < 1.35 && ball.vel.length() < 18;

    if (!ball.owner && reachable) {
      // 最近的可控球球员获得球权
      let best = null, bd = 1.5 * 1.5;
      for (const pl of this.players) {
        if (pl.controlCooldown > 0) continue;
        const d = pl.dist2(ball.pos);
        if (d < bd) { bd = d; best = pl; }
      }
      if (best) ball.owner = best;
    } else if (ball.owner) {
      // 抢断判定
      const owner = ball.owner;
      for (const pl of this.players) {
        if (pl.team === owner.team || pl.stealCooldown > 0 || pl.role === 'GK') continue;
        if (pl.dist2(ball.pos) > 1.6 * 1.6) continue;
        const rate = pl.isUser ? 3.2 : (pl.team === 'B' ? diff.stealRate : ALLY_PARAMS.stealRate);
        if (Math.random() < rate * dt) {
          ball.owner = pl;
          owner.controlCooldown = 0.55;
          pl.stealCooldown = 0.4;
          this.world.audio.thud(0.35);
          if (pl.team === 'A' && !pl.isUser) this.setControlled(pl);
          break;
        } else {
          pl.stealCooldown = 0.12; // 每帧不重复掷骰太多
        }
      }
    }

    // 门将扑救 / 拿球
    for (const gk of this.players) {
      if (gk.role !== 'GK' || ball.heldBy || gk.stealCooldown > 0) continue;
      if (ball.owner && ball.owner.team === gk.team) continue;
      const dx = ball.pos.x - gk.pos.x, dz = ball.pos.z - gk.pos.z;
      const spd = ball.vel.length();
      const reach = spd > 14 ? 2.2 : 1.7;
      if (dx * dx + dz * dz > reach * reach || ball.pos.y > 2.9) continue;
      const skill = gk.team === 'B' ? diff.keeper : ALLY_PARAMS.keeper;
      if (spd > 12) {
        // 扑救：一次判定 + 冷却，射得越快越难扑
        const p = skill * (spd > 26 ? 0.6 : spd > 20 ? 0.8 : 0.95);
        if (Math.random() < p) {
          this.catchBall(gk);
        } else if (Math.random() < 0.5) {
          // 扑到但脱手
          ball.vel.x *= -0.35;
          ball.vel.z = (Math.random() - 0.5) * 12;
          ball.vel.y = 3 + Math.random() * 3;
          ball.owner = null;
          this.world.audio.thud(0.5);
          gk.kickAnim = 1;
        }
        // 否则完全扑空，球继续飞
        gk.stealCooldown = 0.7;
      } else {
        this.catchBall(gk);
      }
    }
  }

  catchBall(gk) {
    this.ball.owner = null;
    this.ball.heldBy = gk;
    this.holdTimer = 1.15;
    gk.moveDir.set(0, 0, 0);
    this.world.audio.thud(0.45);
  }

  keeperHold(dt) {
    const gk = this.ball.heldBy;
    if (!gk) return;
    this.holdTimer -= dt;
    // 面向前场
    gk.facingDir.set(gk.attackDir, 0, 0);
    if (this.holdTimer <= 0) {
      // 大脚开给最靠前队友
      const mates = this.players.filter(p => p.team === gk.team && p.role !== 'GK');
      mates.sort((a, b) => (b.pos.x * gk.attackDir) - (a.pos.x * gk.attackDir));
      const target = Math.random() < 0.7 ? mates[0] : mates[1 + (Math.random() * 2 | 0)] || mates[0];
      const dx = target.pos.x - this.ball.pos.x, dz = target.pos.z - this.ball.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const speed = THREE.MathUtils.clamp(d * 0.9 + 10, 16, 30);
      this.ball.heldBy = null;
      this.kickBall(gk, (dx / d) * speed, 4 + d * 0.12, (dz / d) * speed, 0.8);
    }
  }

  // ---------- 玩家操作 ----------
  humanControl(dt) {
    const input = this.world.input;
    const user = this.user;
    if (!user) return;

    user.moveDir.copy(input.dir);
    user.wantSprint = input.sprint;

    const ballNear = user.distTo(this.ball.pos) < 1.95 && this.ball.pos.y < 1.5 && !this.ball.heldBy;
    const hasBall = this.ball.owner === user;

    // 蓄力射门
    if (input.shootDown) {
      if (this.charge < 0 && (hasBall || ballNear)) this.charge = 0;
      if (this.charge >= 0) this.charge = Math.min(1, this.charge + dt / 0.85);
    } else if (this.charge >= 0) {
      // 松开 → 射！
      const power = this.charge;
      this.charge = -1;
      if (hasBall || ballNear) {
        const goalX = user.attackDir * F.L / 2;
        const toGoal = new THREE.Vector3(goalX - this.ball.pos.x, 0, -this.ball.pos.z * 0.55).normalize();
        let aim;
        if (input.dir.lengthSq() > 0.1) aim = input.dir.clone().multiplyScalar(0.75).add(toGoal.multiplyScalar(0.65)).normalize();
        else aim = toGoal;
        const speed = 15 + power * 21;
        this.kickBall(user, aim.x * speed, 2 + power * 6.5, aim.z * speed, 0.4 + power * 0.6);
      }
    }
    // HUD 力度条
    const pw = $('powerWrap');
    if (this.charge >= 0) {
      pw.classList.remove('hidden');
      $('powerBar').style.width = `${this.charge * 100}%`;
    } else pw.classList.add('hidden');

    // 传球
    if (input.consumePass() && (hasBall || ballNear)) {
      const aimDir = input.dir.lengthSq() > 0.1 ? input.dir : user.facingDir;
      let best = null, bs = -1e9;
      for (const mate of this.players) {
        if (mate.team !== 'A' || mate === user || mate.role === 'GK') continue;
        const dx = mate.pos.x - user.pos.x, dz = mate.pos.z - user.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const dot = (dx / d) * aimDir.x + (dz / d) * aimDir.z;
        const score = dot * 22 - d * 0.28 + mate.pos.x * user.attackDir * 0.25;
        if (score > bs) { bs = score; best = mate; }
      }
      if (best) {
        this.passBall(user, best, 0.03);
        this._switchTo = best;
        this._switchT = 0.3;
      }
    }
    // 传球后自动切换到接球者
    if (this._switchT > 0) {
      this._switchT -= dt;
      if (this._switchT <= 0 && this._switchTo) { this.setControlled(this._switchTo); this._switchTo = null; }
    }

    // 手动换人：切换到离球最近的队友
    if (input.consumeSwitch()) {
      let best = null, bd = Infinity;
      for (const mate of this.players) {
        if (mate.team !== 'A' || mate === user || mate.role === 'GK') continue;
        const d = mate.dist2(this.ball.pos);
        if (d < bd) { bd = d; best = mate; }
      }
      if (best) { this.setControlled(best); this.world.audio.click(); }
    }
  }

  passBall(from, mate, err) {
    const dx0 = mate.pos.x - this.ball.pos.x, dz0 = mate.pos.z - this.ball.pos.z;
    const d0 = Math.hypot(dx0, dz0) || 1;
    const speed = THREE.MathUtils.clamp(d0 * 1.15 + 9, 12, 27);
    // 提前量
    const tt = d0 / speed;
    let tx = mate.pos.x + mate.vel.x * tt * 0.7;
    let tz = mate.pos.z + mate.vel.z * tt * 0.7;
    const ang = Math.atan2(tz - this.ball.pos.z, tx - this.ball.pos.x) + (Math.random() - 0.5) * 2 * err;
    const vy = d0 > 22 ? 3.6 : 0.7;
    this.kickBall(from, Math.cos(ang) * speed, vy, Math.sin(ang) * speed, 0.45);
  }

  kickBall(pl, vx, vy, vz, sndPower = 0.6) {
    this.ball.kick(vx, vy, vz, pl);
    pl.kickAnim = 1;
    this.world.audio.kick(sndPower);
  }

  // ---------- 球员之间轻推开 ----------
  separatePlayers() {
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        const a = this.players[i], b = this.players[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 0.64 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = (0.8 - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.pos.x -= nx * push; a.pos.z -= nz * push;
        b.pos.x += nx * push; b.pos.z += nz * push;
      }
    }
  }

  // ---------- 进球 ----------
  checkGoal() {
    if (this.state !== 'play') return;
    const b = this.ball;
    if (Math.abs(b.pos.x) < F.L / 2 + b.r * 0.5) return;
    if (Math.abs(b.pos.z) > F.goalHalfW || b.pos.y > F.goalH) return;

    const scoredRight = b.pos.x > 0;               // 进 +x 球门
    const scorerTeam = scoredRight ? 'A' : 'B';    // 红队攻 +x
    if (scorerTeam === 'A') this.scoreA++; else this.scoreB++;

    const { audio, fx, crowd } = this.world;
    const isPlayerGoal = scorerTeam === 'A';
    const speed = b.vel.length();

    this.state = 'goalPause';
    this.stateT = 3.4;
    this.pendingKickTeam = scorerTeam === 'A' ? 'B' : 'A';
    this.world.timeSlow = 0.9;                     // 短暂慢动作

    fx.burst(b.pos.x, 1.5, b.pos.z);
    crowd.excite = 1;
    audio.whistle('goal');
    if (isPlayerGoal) {
      audio.cheer();
      this.banner(speed > 26 ? '🚀 世界波！！' : '⚽ GOAL！！');
    } else {
      audio.disappointed();
      this.banner('😱 丢球了…', true);
    }
    this.shake = 0.8;

    $('scoreA').textContent = this.scoreA;
    $('scoreB').textContent = this.scoreB;

    // 金球制胜
    if (this.overtime && this.scoreA !== this.scoreB) this.stateT = 2.6;

    // 球速清零防止二次判定
    b.vel.multiplyScalar(0.1);
  }

  endMatch() {
    this.state = 'end';
    const { audio } = this.world;
    audio.whistle('end');
    audio.setExcitement(0.2);

    const win = this.scoreA > this.scoreB;
    const draw = this.scoreA === this.scoreB;
    const title = $('endTitle');
    title.textContent = draw ? '平局' : win ? '🏆 胜利！' : '惜败…';
    title.className = draw ? '' : win ? 'win' : 'lose';
    $('endScore').textContent = `红队 ${this.scoreA} : ${this.scoreB} 蓝队`;
    const diff = DIFFS[this.diffKey];
    const subs = win
      ? { easy: '小试牛刀！去挑战更高难度吧', normal: '打得漂亮！要不要试试困难？', hard: '你战胜了凶狠的对手！传奇在等你', legend: '不可思议！你就是绿茵传奇！👑' }
      : { easy: '再练练，你可以的！', normal: '差一点点，再来一局！', hard: '困难模式名不虚传……', legend: '传奇模式，虽败犹荣！' };
    $('endSub').textContent = draw ? '势均力敌，不分胜负' : subs[this.diffKey];
    if (win) { this.world.fx.burst(0, 6, 0); audio.cheer(); }
    $('endScreen').classList.remove('hidden');
  }

  // ---------- 相机 ----------
  updateCamera(dt) {
    const cam = this.world.camera;
    const b = this.ball.pos;
    const u = this.user ? this.user.pos : b;
    const tx = THREE.MathUtils.clamp(b.x * 0.72 + u.x * 0.28, -38, 38);
    const tz = THREE.MathUtils.clamp(b.z * 0.55 + u.z * 0.2, -14, 14);

    const px = tx * 0.82;
    const py = 25;
    const pz = tz * 0.5 + 35;
    const k = Math.min(1, 3.2 * dt);
    cam.position.x += (px - cam.position.x) * k;
    cam.position.y += (py - cam.position.y) * k;
    cam.position.z += (pz - cam.position.z) * k;

    // 震屏
    if (this.shake > 0.01) {
      this.shake *= Math.max(0, 1 - 6 * dt);
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    }
    cam.lookAt(tx, 0.5, tz * 0.55);

    // 光圈跟随
    if (this.user) {
      this.ring.visible = this.state !== 'menu';
      this.ring.position.set(this.user.pos.x, 0.06, this.user.pos.z);
      const s = 1 + Math.sin(performance.now() * 0.006) * 0.12;
      this.ring.scale.set(s, s, 1);
    }
  }

  // ---------- HUD ----------
  updateHUD() {
    const t = Math.max(0, this.timeLeft);
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    $('clock').textContent = this.overtime ? '金球' : `${mm}:${String(ss).padStart(2, '0')}`;
    if (this.user) {
      const bar = $('staminaBar');
      bar.style.width = `${this.user.stamina}%`;
      bar.className = this.user.tired ? 'tired' : '';
    }
  }

  drawMinimap() {
    const g = this.miniCtx;
    const W = 216, H = 148;
    g.clearRect(0, 0, W, H);
    const sx = (W - 16) / F.L, sy = (H - 16) / F.W;
    const mx = x => W / 2 + x * sx, my = z => H / 2 + z * sy;

    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 1;
    g.strokeRect(mx(-F.L / 2), my(-F.W / 2), F.L * sx, F.W * sy);
    g.beginPath(); g.moveTo(mx(0), my(-F.W / 2)); g.lineTo(mx(0), my(F.W / 2)); g.stroke();
    g.beginPath(); g.arc(mx(0), my(0), 9.15 * sx, 0, Math.PI * 2); g.stroke();
    // 球门
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(mx(-F.L / 2) - 3, my(-F.goalHalfW), 3, F.goalHalfW * 2 * sy);
    g.fillRect(mx(F.L / 2), my(-F.goalHalfW), 3, F.goalHalfW * 2 * sy);

    for (const pl of this.players) {
      g.beginPath();
      g.arc(mx(pl.pos.x), my(pl.pos.z), pl.isUser ? 4.5 : 3.2, 0, Math.PI * 2);
      g.fillStyle = pl.team === 'A' ? (pl.role === 'GK' ? '#ffb300' : '#ff5252') : (pl.role === 'GK' ? '#00e676' : '#448aff');
      g.fill();
      if (pl.isUser) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
    }
    // 球
    g.beginPath();
    g.arc(mx(this.ball.pos.x), my(this.ball.pos.z), 2.6, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.fill();
    g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
  }
}
