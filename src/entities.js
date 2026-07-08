import * as THREE from 'three';
import { F } from './stadium.js';

// ================= 足球 =================

// 经典黑白足球纹理：在等距圆柱投影上，把正二十面体 12 个顶点方向画成黑斑
function makeBallTexture() {
  const w = 512, h = 256;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#f8f8f8'; g.fillRect(0, 0, w, h);

  // 缝线的浅灰网格
  g.strokeStyle = 'rgba(120,120,120,0.25)';
  g.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    g.beginPath(); g.moveTo((w / 12) * i, 0); g.lineTo((w / 12) * i, h); g.stroke();
  }

  const phi = (1 + Math.sqrt(5)) / 2;
  const verts = [];
  for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
    verts.push([0, s1, s2 * phi], [s1, s2 * phi, 0], [s2 * phi, 0, s1]);
  }
  g.fillStyle = '#111';
  for (const v of verts) {
    const len = Math.hypot(...v);
    const [x, y, z] = v.map(c => c / len);
    const u = 0.5 + Math.atan2(z, x) / (Math.PI * 2);
    const vv = 0.5 - Math.asin(y) / Math.PI;
    const lat = Math.abs(y) > 0.999 ? 0.999 : Math.asin(y);
    const rx = 21 / Math.max(0.25, Math.cos(lat));
    for (const dx of [-w, 0, w]) {
      g.beginPath();
      g.ellipse(u * w + dx, vv * h, Math.min(rx, 70), 21, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Ball {
  constructor(scene) {
    this.r = 0.42;
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.r, 24, 18),
      new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.4 })
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    this.pos = this.mesh.position;
    this.vel = new THREE.Vector3();
    this.owner = null;      // 控球球员
    this.heldBy = null;     // 门将抱球
    this.lastKicker = null;

    // 高速轨迹
    const N = this.trailN = 24;
    const trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(N * 3);
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailMat = new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.trail = new THREE.Line(trailGeo, this.trailMat);
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this.reset();
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, this.r, z);
    this.vel.set(0, 0, 0);
    this.owner = null;
    this.heldBy = null;
    for (let i = 0; i < this.trailN; i++) this.pos.toArray(this.trailPos, i * 3);
    this.trail.geometry.attributes.position.needsUpdate = true;
  }

  kick(vx, vy, vz, kicker = null) {
    this.owner = null;
    this.vel.set(vx, vy, vz);
    if (kicker) { this.lastKicker = kicker; kicker.controlCooldown = 0.4; }
  }

  // 返回事件: null | 'bounce' | 'post'
  update(dt, audio) {
    let event = null;

    if (this.heldBy) {
      const k = this.heldBy;
      const f = k.facingDir;
      this.pos.set(k.pos.x + f.x * 0.55, 1.05, k.pos.z + f.z * 0.55);
      this.vel.set(0, 0, 0);
      return null;
    }

    if (this.owner) {
      // 带球：球贴在脚下前方
      const o = this.owner;
      const f = o.facingDir;
      const lead = 0.9 + o.vel.length() * 0.055;
      const tx = o.pos.x + f.x * lead;
      const tz = o.pos.z + f.z * lead;
      this.pos.x += (tx - this.pos.x) * Math.min(1, 14 * dt);
      this.pos.z += (tz - this.pos.z) * Math.min(1, 14 * dt);
      this.pos.y = this.r;
      this.vel.copy(o.vel);
    } else {
      // 自由运动
      this.vel.y -= 20 * dt;
      this.pos.addScaledVector(this.vel, dt);

      // 地面
      if (this.pos.y < this.r) {
        this.pos.y = this.r;
        if (this.vel.y < -1.2) {
          this.vel.y *= -0.55;
          if (Math.abs(this.vel.y) > 2 && audio) audio.thud(0.25);
        } else this.vel.y = 0;
        // 滚动摩擦
        const f = Math.max(0, 1 - 1.4 * dt);
        this.vel.x *= f; this.vel.z *= f;
      } else {
        // 空气阻力
        const f = Math.max(0, 1 - 0.12 * dt);
        this.vel.x *= f; this.vel.z *= f;
      }

      event = this.collide(audio);
    }

    // 滚转
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.05) {
      const axis = new THREE.Vector3(this.vel.z, 0, -this.vel.x).normalize();
      this.mesh.rotateOnWorldAxis(axis, (sp * dt) / this.r);
    }

    // 轨迹
    for (let i = this.trailN - 1; i > 0; i--) {
      this.trailPos[i * 3] = this.trailPos[(i - 1) * 3];
      this.trailPos[i * 3 + 1] = this.trailPos[(i - 1) * 3 + 1];
      this.trailPos[i * 3 + 2] = this.trailPos[(i - 1) * 3 + 2];
    }
    this.pos.toArray(this.trailPos, 0);
    this.trail.geometry.attributes.position.needsUpdate = true;
    const spd = this.vel.length();
    this.trailMat.opacity += ((spd > 17 ? 0.75 : 0) - this.trailMat.opacity) * Math.min(1, 8 * dt);

    return event;
  }

  collide(audio) {
    let event = null;
    const r = this.r;
    const insideGoalMouth = Math.abs(this.pos.z) < F.goalHalfW - 0.1 && this.pos.y < F.goalH - 0.05;

    // 边线弹墙
    if (Math.abs(this.pos.z) > F.wallZ - r) {
      this.pos.z = Math.sign(this.pos.z) * (F.wallZ - r);
      this.vel.z *= -0.65;
      event = 'bounce';
    }

    // 底线区域
    const ax = Math.abs(this.pos.x);
    if (ax > F.L / 2) {
      if (insideGoalMouth || Math.abs(this.pos.z) < F.goalHalfW + 0.4) {
        // 球门内：网兜住
        const backX = F.L / 2 + F.goalDepth - 0.25;
        if (ax > backX - r) {
          this.pos.x = Math.sign(this.pos.x) * (backX - r);
          this.vel.x *= -0.18; this.vel.z *= 0.4;
        }
        if (Math.abs(this.pos.z) > F.goalHalfW - r && ax > F.L / 2 + 0.1) {
          this.pos.z = Math.sign(this.pos.z) * (F.goalHalfW - r);
          this.vel.z *= -0.18;
        }
        if (this.pos.y > F.goalH - r && ax > F.L / 2 + 0.1) {
          this.pos.y = F.goalH - r;
          this.vel.y *= -0.18;
        }
      } else if (ax > F.wallX - r) {
        this.pos.x = Math.sign(this.pos.x) * (F.wallX - r);
        this.vel.x *= -0.65;
        event = 'bounce';
      }
    }

    // 门柱 & 横梁
    for (const sx of [-1, 1]) {
      const gx = sx * F.L / 2;
      for (const gz of [-F.goalHalfW, F.goalHalfW]) {
        const dx = this.pos.x - gx, dz = this.pos.z - gz;
        const d = Math.hypot(dx, dz);
        if (d < r + F.postR && this.pos.y < F.goalH + 0.2) {
          const nx = dx / (d || 1), nz = dz / (d || 1);
          this.pos.x = gx + nx * (r + F.postR);
          this.pos.z = gz + nz * (r + F.postR);
          const dot = this.vel.x * nx + this.vel.z * nz;
          if (dot < 0) {
            this.vel.x -= 1.7 * dot * nx;
            this.vel.z -= 1.7 * dot * nz;
            if (audio && Math.abs(dot) > 6) { audio.ding(); event = 'post'; }
          }
        }
      }
      // 横梁
      const dxB = this.pos.x - gx, dyB = this.pos.y - F.goalH;
      const dB = Math.hypot(dxB, dyB);
      if (dB < r + F.postR && Math.abs(this.pos.z) < F.goalHalfW + 0.2) {
        const nx = dxB / (dB || 1), ny = dyB / (dB || 1);
        this.pos.x = gx + nx * (r + F.postR);
        this.pos.y = F.goalH + ny * (r + F.postR);
        const dot = this.vel.x * nx + this.vel.y * ny;
        if (dot < 0) {
          this.vel.x -= 1.7 * dot * nx;
          this.vel.y -= 1.7 * dot * ny;
          if (audio && Math.abs(dot) > 6) { audio.ding(); event = 'post'; }
        }
      }
    }
    return event;
  }
}

// ================= 球员 =================

function makeNumberTexture(num, color = '#ffffff') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = color;
  g.font = 'bold 96px "Arial Black", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SKINS = [0xf5c9a6, 0xe0ac7e, 0xc68e5e, 0x8d5a3a];
const HAIRS = [0x241a12, 0x3b2a18, 0x101010, 0x5b4423, 0xcfa54a];

export function makePlayerMesh({ shirt, shorts, socks, number, isKeeper = false }) {
  const grp = new THREE.Group();
  const skin = SKINS[(Math.random() * SKINS.length) | 0];
  const hairC = HAIRS[(Math.random() * HAIRS.length) | 0];

  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.7 });
  const shortsMat = new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.7 });
  const socksMat = new THREE.MeshStandardMaterial({ color: socks, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairC, roughness: 0.85 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });

  const cast = m => { m.castShadow = true; return m; };

  // 躯干（上半身微收腰）
  const torso = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.58, 10), shirtMat));
  torso.position.y = 1.27;
  torso.scale.z = 0.72;
  grp.add(torso);

  // 短裤
  const hips = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.27, 0.26, 10), shortsMat));
  hips.position.y = 0.9;
  hips.scale.z = 0.75;
  grp.add(hips);

  // 号码（背后）
  const numPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.34),
    new THREE.MeshBasicMaterial({ map: makeNumberTexture(number, isKeeper ? '#222222' : '#ffffff'), transparent: true })
  );
  numPlane.position.set(0, 1.3, -0.2);
  numPlane.rotation.y = Math.PI;
  grp.add(numPlane);

  // 头 + 头发 + 眼睛
  const head = cast(new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), skinMat));
  head.position.y = 1.76;
  grp.add(head);
  const hair = cast(new THREE.Mesh(new THREE.SphereGeometry(0.215, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat));
  hair.position.y = 1.775;
  grp.add(hair);
  const eyeGeo = new THREE.SphereGeometry(0.028, 6, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(s * 0.075, 1.79, 0.17);
    grp.add(eye);
  }

  // 手臂（肩部为轴）
  const arms = [];
  for (const s of [-1, 1]) {
    const armGrp = new THREE.Group();
    armGrp.position.set(s * 0.32, 1.48, 0);
    const arm = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.52, 8), shirtMat));
    arm.position.y = -0.26;
    armGrp.add(arm);
    const hand = cast(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), isKeeper ? new THREE.MeshStandardMaterial({ color: 0xffffff }) : skinMat));
    hand.position.y = -0.55;
    armGrp.add(hand);
    armGrp.rotation.z = s * 0.12;
    grp.add(armGrp);
    arms.push(armGrp);
  }

  // 腿（髋部为轴）
  const legs = [];
  for (const s of [-1, 1]) {
    const legGrp = new THREE.Group();
    legGrp.position.set(s * 0.13, 0.95, 0);
    const thigh = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.08, 0.42, 8), skinMat));
    thigh.position.y = -0.2;
    legGrp.add(thigh);
    const shin = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.42, 8), socksMat));
    shin.position.y = -0.6;
    legGrp.add(shin);
    const shoe = cast(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.11, 0.3), shoeMat));
    shoe.position.set(0, -0.85, 0.06);
    legGrp.add(shoe);
    grp.add(legGrp);
    legs.push(legGrp);
  }

  return { grp, arms, legs, torso, head };
}

export class Player {
  constructor(scene, opts) {
    // opts: { team:'A'|'B', role:'GK'|'F', number, colors, attackDir }
    Object.assign(this, opts);
    const parts = makePlayerMesh({ ...opts.colors, number: opts.number, isKeeper: opts.role === 'GK' });
    this.parts = parts;
    this.mesh = parts.grp;
    scene.add(this.mesh);

    this.pos = this.mesh.position;
    this.vel = new THREE.Vector3();
    this.facingDir = new THREE.Vector3(opts.attackDir, 0, 0);
    this.moveDir = new THREE.Vector3();   // 期望移动方向（单位向量或 0）
    this.wantSprint = false;
    this.baseSpeed = opts.baseSpeed || 10;
    this.speedMul = 1;

    this.controlCooldown = 0;  // 踢球后短暂无法再控球
    this.stealCooldown = 0;
    this.kickAnim = 0;
    this.runPhase = Math.random() * 6;
    this.home = new THREE.Vector3();
    this.decideT = 0;
    this.isUser = false;
    this.stamina = 100;
    this.tired = false;
  }

  get maxSpeed() {
    const sprint = this.wantSprint && !this.tired ? 1.48 : 1;
    return this.baseSpeed * sprint * this.speedMul;
  }

  teleport(x, z, faceDir) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.moveDir.set(0, 0, 0);
    if (faceDir) this.facingDir.set(faceDir, 0, 0);
    this.mesh.rotation.y = Math.atan2(this.facingDir.x, this.facingDir.z);
  }

  update(dt) {
    this.controlCooldown = Math.max(0, this.controlCooldown - dt);
    this.stealCooldown = Math.max(0, this.stealCooldown - dt);
    this.kickAnim = Math.max(0, this.kickAnim - dt * 4.5);

    // 体力（仅玩家操控者消耗显示，AI 也用但恢复快）
    const sprinting = this.wantSprint && this.moveDir.lengthSq() > 0.1 && !this.tired;
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - 20 * dt);
      if (this.stamina <= 1) this.tired = true;
    } else {
      this.stamina = Math.min(100, this.stamina + 13 * dt);
      if (this.stamina > 25) this.tired = false;
    }

    // 速度趋近期望
    const target = this.moveDir.clone().multiplyScalar(this.maxSpeed);
    this.vel.x += (target.x - this.vel.x) * Math.min(1, 9 * dt);
    this.vel.z += (target.z - this.vel.z) * Math.min(1, 9 * dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // 场地范围
    const mX = this.role === 'GK' ? F.L / 2 + 1.6 : F.L / 2 + 0.8;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -mX, mX);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -(F.W / 2 + 0.8), F.W / 2 + 0.8);

    // 朝向
    const sp = this.vel.length();
    if (sp > 0.8) {
      const t = Math.min(1, 12 * dt);
      this.facingDir.x += (this.vel.x / sp - this.facingDir.x) * t;
      this.facingDir.z += (this.vel.z / sp - this.facingDir.z) * t;
      this.facingDir.normalize();
    }
    this.mesh.rotation.y = Math.atan2(this.facingDir.x, this.facingDir.z);

    // 跑步动画
    this.runPhase += sp * dt * 1.35;
    const swing = Math.min(1, sp / 10) * 0.85;
    const s0 = Math.sin(this.runPhase) * swing;
    this.parts.legs[0].rotation.x = s0;
    this.parts.legs[1].rotation.x = -s0;
    this.parts.arms[0].rotation.x = -s0 * 0.8;
    this.parts.arms[1].rotation.x = s0 * 0.8;
    // 踢球动画覆盖右腿
    if (this.kickAnim > 0) {
      this.parts.legs[1].rotation.x = -this.kickAnim * 1.5;
      this.parts.arms[0].rotation.x = this.kickAnim * 0.9;
    }
    // 身体前倾 & 上下起伏
    this.mesh.rotation.x = Math.min(0.22, sp * 0.014);
    this.pos.y = Math.abs(Math.sin(this.runPhase)) * Math.min(1, sp / 10) * 0.05;
  }

  dist2(p) {
    const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
    return dx * dx + dz * dz;
  }
  distTo(p) { return Math.sqrt(this.dist2(p)); }
}
