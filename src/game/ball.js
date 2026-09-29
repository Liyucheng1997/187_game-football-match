import * as THREE from 'three';
import { F, PHYS } from '../config.js';

// ================= 足球模型：着色器实时绘制截角二十面体（12 五边形 + 20 六边形） =================

function polyDirs() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const ico = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) ico.push([0, a, b * phi], [a, b * phi, 0], [b * phi, 0, a]);
  const dod = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) dod.push([a, b, c]);
  const ip = 1 / phi;
  for (const a of [-1, 1]) for (const b of [-1, 1]) dod.push([0, a * ip, b * phi], [a * ip, b * phi, 0], [b * phi, 0, a * ip]);
  const n = v => new THREE.Vector3(...v).normalize();
  return [...ico.map(n), ...dod.map(n)];
}
const DIRS = polyDirs();

export function makeBallMaterial(design) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: design.metal || 0, color: 0xffffff });
  mat.userData.uniforms = {
    uPent: { value: new THREE.Color(design.pent) },
    uHex: { value: new THREE.Color(design.hex) },
    uSeam: { value: new THREE.Color(design.seam) },
    uFire: { value: 0 },
  };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, mat.userData.uniforms, { uDirs: { value: DIRS } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjN = normalize(position);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjN; uniform vec3 uDirs[32]; uniform vec3 uPent; uniform vec3 uHex; uniform vec3 uSeam; uniform float uFire;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 nn = normalize(vObjN);
          float d1 = -2.0, d2 = -2.0; int i1 = 0;
          for (int i = 0; i < 32; i++) {
            float d = dot(nn, uDirs[i]);
            if (d > d1) { d2 = d1; d1 = d; i1 = i; } else if (d > d2) { d2 = d; }
          }
          vec3 c = i1 < 12 ? uPent : uHex;
          float seam = smoothstep(0.004, 0.018, d1 - d2);
          c = mix(uSeam, c, seam);
          c = mix(c, vec3(1.0, 0.55, 0.1), uFire * 0.6);
          diffuseColor.rgb = c;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.45, 0.05) * uFire * 2.2;`);
  };
  return mat;
}

// ================= 足球物理 =================

const _tmp = new THREE.Vector3();

// 无碰撞单步积分（供预测 / 射门求解使用）
export function stepFree(p, v, w, dt, env) {
  const r = PHYS.ballR;
  const onGround = p.y <= r + 0.01 && Math.abs(v.y) < 0.6;
  if (!onGround) {
    const sp = v.length();
    // 马格努斯：a = k (ω × v)
    const mx = w.y * v.z - w.z * v.y, my = w.z * v.x - w.x * v.z, mz = w.x * v.y - w.y * v.x;
    v.x += (mx * PHYS.magnus - v.x * sp * PHYS.airDrag) * dt;
    v.y += (my * PHYS.magnus - v.y * sp * PHYS.airDrag - PHYS.g) * dt;
    v.z += (mz * PHYS.magnus - v.z * sp * PHYS.airDrag) * dt;
    const k = Math.exp(-PHYS.spinDecayAir * dt);
    w.multiplyScalar(k);
  } else {
    v.y = 0; p.y = r;
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.0001) {
      const dec = (PHYS.rollC0 + PHYS.rollC1 * sp) * env.roll * dt;
      const ns = Math.max(0, sp - dec);
      v.x *= ns / sp; v.z *= ns / sp;
    }
    w.multiplyScalar(Math.exp(-PHYS.spinDecayGround * dt));
  }
  p.addScaledVector(v, dt);
  if (p.y < r) {
    p.y = r;
    if (v.y < -1.4) {
      v.y = -v.y * PHYS.restitution * env.bounce;
      // 触地摩擦：水平速度损失 + 旋转转化
      v.x *= 0.86; v.z *= 0.86;
      w.multiplyScalar(0.6);
    } else v.y = 0;
  }
}

export class Ball {
  constructor(scene, design) {
    this.r = PHYS.ballR;
    this.mat = makeBallMaterial(design);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(this.r, 40, 28), this.mat);
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    // 圆形接触阴影（始终可见，帮助判断高度）
    const shCv = document.createElement('canvas'); shCv.width = shCv.height = 64;
    const g = shCv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shCv), transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 2;
    scene.add(this.blob);

    // 拖尾
    const N = this.trailN = 28;
    this.trailPos = new Float32Array(N * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailMat = new THREE.LineBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.trail = new THREE.Line(tg, this.trailMat);
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this.pos = this.mesh.position;
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.env = { roll: 1, bounce: 1 };
    this.cage = false;
    this.reset(0, 0);
  }

  setDesign(d) {
    const u = this.mat.userData.uniforms;
    u.uPent.value.set(d.pent); u.uHex.value.set(d.hex); u.uSeam.value.set(d.seam);
    this.mat.metalness = d.metal || 0;
  }

  reset(x = 0, z = 0, y = PHYS.ballR) {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.owner = null;
    this.heldBy = null;
    this.lastTouch = null;
    this.kickId = (this.kickId || 0) + 1;
    this.fire = 0;
    this.inNet = false;
    this.kickType = null;
    this.kickTime = 0;
    for (let i = 0; i < this.trailN; i++) this.pos.toArray(this.trailPos, i * 3);
  }

  // 踢球：kind = pass/through/lob/shot/clear/super/header
  kick(vel, spin, player, kind, meta = {}) {
    this.owner = null;
    this.heldBy = null;
    this.vel.copy(vel);
    this.spin.copy(spin || _tmp.set(0, 0, 0));
    this.lastTouch = player;
    this.kicker = player;
    if (player) player.controlCD = Math.max(player.controlCD, 0.3);
    this.kickType = kind;
    this.kickMeta = meta;
    this.kickId++;
    this.kickTime = 0;
    this.fire = kind === 'super' ? 1 : 0;
  }

  // 返回事件数组
  update(dt, audio) {
    const events = [];
    this.prevPos.copy(this.pos);
    this.kickTime += dt;

    if (this.heldBy) {
      const k = this.heldBy;
      const hand = k.handPos();
      this.pos.copy(hand);
      this.vel.set(0, 0, 0);
      this.spin.set(0, 0, 0);
    } else if (!this.owner) {
      const sub = 4;
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        const vyBefore = this.vel.y;
        stepFree(this.pos, this.vel, this.spin, h, this.env);
        if (vyBefore < -3 && this.vel.y > 0 && this.pos.y <= this.r + 0.05) events.push({ type: 'bounce', v: -vyBefore });
        this.collide(events);
      }
    }

    // 视觉旋转
    const onGround = this.pos.y < this.r + 0.02;
    if (onGround || this.owner) {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0.05) {
        _tmp.set(this.vel.z, 0, -this.vel.x).normalize();
        this.mesh.rotateOnWorldAxis(_tmp, (sp * dt) / this.r);
      }
    } else {
      const ws = this.spin.length();
      if (ws > 0.1) {
        _tmp.copy(this.spin).divideScalar(ws);
        this.mesh.rotateOnWorldAxis(_tmp, ws * dt);
      }
      // 普通飞行也给点翻滚
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 1) { _tmp.set(this.vel.z, 0, -this.vel.x).normalize(); this.mesh.rotateOnWorldAxis(_tmp, sp * dt * 0.8); }
    }

    // 阴影 & 拖尾
    this.blob.position.set(this.pos.x, 0.015, this.pos.z);
    const s = 0.6 + Math.min(1.2, this.pos.y * 0.25);
    this.blob.scale.set(s, s, s);
    this.blob.material.opacity = Math.max(0.15, 1 - this.pos.y * 0.12);
    for (let i = this.trailN - 1; i > 0; i--) {
      this.trailPos[i * 3] = this.trailPos[(i - 1) * 3];
      this.trailPos[i * 3 + 1] = this.trailPos[(i - 1) * 3 + 1];
      this.trailPos[i * 3 + 2] = this.trailPos[(i - 1) * 3 + 2];
    }
    this.pos.toArray(this.trailPos, 0);
    this.trail.geometry.attributes.position.needsUpdate = true;
    const spd = this.vel.length();
    const want = this.fire > 0 ? 0 : spd > 20 ? 0.6 : 0;
    this.trailMat.opacity += (want - this.trailMat.opacity) * Math.min(1, 10 * dt);
    this.fire = Math.max(0, this.fire - dt * (spd < 8 ? 2 : 0.15));
    this.mat.userData.uniforms.uFire.value = this.fire;
    return events;
  }

  collide(events) {
    const r = this.r, p = this.pos, v = this.vel;
    const ax = Math.abs(p.x), sx = Math.sign(p.x) || 1;
    const gl = F.hl;

    // 门柱（竖）
    for (const gz of [-F.goalHalfW, F.goalHalfW]) {
      const dx = p.x - sx * gl, dz = p.z - gz;
      const d = Math.hypot(dx, dz);
      const rr = r + F.postR;
      if (d < rr && p.y < F.goalH + F.postR) {
        const nx = dx / (d || 1), nz = dz / (d || 1);
        p.x = sx * gl + nx * rr; p.z = gz + nz * rr;
        const dot = v.x * nx + v.z * nz;
        if (dot < 0) {
          v.x -= 1.75 * dot * nx; v.z -= 1.75 * dot * nz;
          this.spin.multiplyScalar(0.3);
          if (-dot > 4) events.push({ type: 'post', v: -dot });
        }
      }
    }
    // 横梁
    {
      const dx = p.x - sx * gl, dy = p.y - F.goalH;
      const d = Math.hypot(dx, dy);
      const rr = r + F.postR;
      if (d < rr && Math.abs(p.z) < F.goalHalfW + F.postR) {
        const nx = dx / (d || 1), ny = dy / (d || 1);
        p.x = sx * gl + nx * rr; p.y = F.goalH + ny * rr;
        const dot = v.x * nx + v.y * ny;
        if (dot < 0) {
          v.x -= 1.7 * dot * nx; v.y -= 1.7 * dot * ny;
          this.spin.multiplyScalar(0.3);
          if (-dot > 4) events.push({ type: 'post', v: -dot, bar: true });
        }
      }
    }

    // 球网内部
    const inMouthZ = Math.abs(p.z) < F.goalHalfW;
    if (ax > gl && (this.inNet || (inMouthZ && p.y < F.goalH))) {
      if (!this.inNet && this.prevPos && Math.abs(this.prevPos.x) <= gl + r) this.inNet = true;
      if (this.inNet) {
        const back = gl + F.goalDepth - r;
        if (ax > back) {
          events.push({ type: 'net', x: sx * (gl + F.goalDepth), y: p.y, z: p.z, v: Math.abs(v.x) });
          p.x = sx * back; v.x *= -0.12; v.z *= 0.45; v.y *= 0.5; this.spin.set(0, 0, 0);
        }
        const hwIn = F.goalHalfW - r;
        if (Math.abs(p.z) > hwIn) {
          if (Math.abs(v.z) > 3) events.push({ type: 'net', x: p.x, y: p.y, z: Math.sign(p.z) * F.goalHalfW, v: Math.abs(v.z), side: true });
          p.z = Math.sign(p.z) * hwIn; v.z *= -0.12; v.x *= 0.6;
        }
        if (p.y > F.goalH - r) {
          if (v.y > 3) events.push({ type: 'net', x: p.x, y: F.goalH, z: p.z, v: v.y, top: true });
          p.y = F.goalH - r; v.y *= -0.1;
        }
        return;
      }
    } else if (ax < gl) this.inNet = false;

    // 从外侧打到侧网 / 顶网
    if (ax > gl && ax < gl + F.goalDepth + r && !this.inNet) {
      if (Math.abs(p.z) < F.goalHalfW + r && Math.abs(p.z) > F.goalHalfW - r && p.y < F.goalH) {
        const s = Math.sign(p.z);
        p.z = s * (F.goalHalfW + r); if (v.z * s < 0) { v.z *= -0.15; events.push({ type: 'net', x: p.x, y: p.y, z: s * F.goalHalfW, v: Math.abs(v.z) + 3, side: true, outside: true }); }
      }
      if (inMouthZ && p.y < F.goalH + r && p.y > F.goalH - 0.3 && ax > gl + 0.2) {
        p.y = F.goalH + r; if (v.y < 0) v.y *= -0.2;
      }
      if (inMouthZ && ax > gl + F.goalDepth - 0.2 && p.y < F.goalH) {
        p.x = sx * (gl + F.goalDepth + r); if (v.x * sx < 0) v.x *= -0.2;
      }
    }

    // 场地边缘挡板（笼式模式挡板在线外 1.5 米；标准模式挡在广告板）
    const bz = this.cage ? F.hw + 1.4 : F.boardZ;
    const bx = this.cage ? F.hl + 1.6 : F.boardX;
    const boardH = this.cage ? 3.2 : 1.0;
    if (Math.abs(p.z) > bz - r && p.y < boardH) {
      p.z = Math.sign(p.z) * (bz - r); v.z *= -0.6; v.x *= 0.9;
      events.push({ type: 'wall', v: Math.abs(v.z) });
    }
    if (ax > bx - r && p.y < boardH && !(inMouthZ && this.inNet)) {
      p.x = sx * (bx - r); v.x *= -0.6;
      events.push({ type: 'wall', v: Math.abs(v.x) });
    }
    if (p.y > 40) v.y = Math.min(v.y, 0);
  }
}

// 预测：返回 n 个样本（每 dt 一个）的位置数组
export function predictPath(ball, n, dt, out) {
  const p = ball.pos.clone(), v = ball.vel.clone(), w = ball.spin.clone();
  for (let i = 0; i < n; i++) {
    const sub = 3;
    for (let k = 0; k < sub; k++) stepFree(p, v, w, dt / sub, ball.env);
    if (!out[i]) out[i] = new THREE.Vector3();
    out[i].copy(p);
    if (!out.vel) out.vel = [];
    if (!out.vel[i]) out.vel[i] = new THREE.Vector3();
    out.vel[i].copy(v);
  }
  return out;
}

// 求解：从 from 出发以水平速度 speed、给定旋转 spin，在到达 target（x,z）时高度为 target.y 的初速度
export function solveKick(from, target, speed, spin, env) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const D = Math.hypot(dx, dz) || 0.001;
  let ang = Math.atan2(dz, dx);
  const T0 = D / speed;
  let vy = (target.y - from.y) / T0 + 0.5 * PHYS.g * T0;
  const p = new THREE.Vector3(), v = new THREE.Vector3(), w = new THREE.Vector3();
  const ux = dx / D, uz = dz / D;
  for (let it = 0; it < 5; it++) {
    p.copy(from); v.set(Math.cos(ang) * speed, vy, Math.sin(ang) * speed); w.copy(spin);
    let t = 0, lat = 0, hy = 0, arrived = false;
    const h = 1 / 120;
    while (t < 4) {
      stepFree(p, v, w, h, env);
      t += h;
      const along = (p.x - from.x) * ux + (p.z - from.z) * uz;
      if (along >= D) {
        lat = -(p.x - from.x) * uz + (p.z - from.z) * ux;
        hy = p.y; arrived = true; break;
      }
      if (Math.hypot(v.x, v.z) < 0.3) break;
    }
    if (!arrived) { vy += 1; continue; }
    ang -= Math.atan2(lat, D);
    if (target.y > 0.3 || vy > 0.5) vy += (target.y - hy) / Math.max(0.25, t) * 0.9;
    if (Math.abs(lat) < 0.05 && Math.abs(target.y - hy) < 0.08) break;
  }
  return new THREE.Vector3(Math.cos(ang) * speed, Math.max(0, vy), Math.sin(ang) * speed);
}

// 地面传球：需要多大初速才能让球在 D 米处还剩 arrive m/s
export function groundPassSpeed(D, arrive, env) {
  // 解析近似：dv/dx = -(c0 + c1 v)/v … 数值积分
  let v = arrive, x = 0;
  const c0 = PHYS.rollC0 * env.roll, c1 = PHYS.rollC1 * env.roll;
  const h = 0.25;
  while (x < D) { v += (c0 + c1 * v) / v * h; x += h; }
  return v;
}
