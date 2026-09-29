import * as THREE from 'three';
import { makeKitTexture } from './textures.js';

// ================= 程序化球员模型：13 关节骨架 + 体块网格 =================
// 关节顺序（姿态数组每关节 3 个欧拉角）
export const J = { pelvis: 0, spine: 1, head: 2, lSh: 3, lEl: 4, rSh: 5, rEl: 6, lHip: 7, lKnee: 8, lAnk: 9, rHip: 10, rKnee: 11, rAnk: 12 };
export const NJ = 13;
export const POSE_N = NJ * 3 + 4; // + root: y 偏移, rx, rz, 额外 yaw

const SKINS = ['#f3cfb3', '#e8b68f', '#d49b6a', '#b27a4f', '#8a5a3a', '#5e3b26'];
const HAIRS = ['#1b1410', '#3a2616', '#5b3a1e', '#8a5a2b', '#d9b36a', '#101010', '#7a2e12'];
const BOOTS = ['#111111', '#f5f5f5', '#ff3b30', '#39ff14', '#00b7ff', '#ffcc00', '#ff5fd2'];
const HAIR_STYLES = ['short', 'buzz', 'mohawk', 'afro', 'long', 'bald', 'bun', 'spiky'];

// 共享几何体
let G = null;
function geoms() {
  if (G) return G;
  const lathe = (pts, seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  G = {
    torso: lathe([[0.135, 0], [0.15, 0.06], [0.16, 0.18], [0.178, 0.3], [0.19, 0.4], [0.175, 0.47], [0.12, 0.52], [0.06, 0.54]], 22),
    shorts: lathe([[0.14, -0.2], [0.16, -0.1], [0.155, 0.0], [0.14, 0.1], [0.135, 0.12]], 18),
    shortLeg: new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12, 1, true),
    thigh: new THREE.CapsuleGeometry(0.068, 0.3, 4, 10),
    shin: new THREE.CapsuleGeometry(0.055, 0.32, 4, 10),
    knee: new THREE.SphereGeometry(0.062, 10, 8),
    boot: new THREE.CapsuleGeometry(0.052, 0.14, 4, 10),
    sole: new THREE.BoxGeometry(0.1, 0.02, 0.25),
    upperArm: new THREE.CapsuleGeometry(0.05, 0.2, 4, 8),
    sleeve: new THREE.CylinderGeometry(0.066, 0.072, 0.15, 12, 1, true),
    forearm: new THREE.CapsuleGeometry(0.043, 0.19, 4, 8),
    hand: new THREE.SphereGeometry(0.05, 10, 8),
    glove: new THREE.SphereGeometry(0.075, 10, 8),
    neck: new THREE.CylinderGeometry(0.05, 0.058, 0.1, 10),
    head: new THREE.SphereGeometry(0.118, 22, 18),
    ear: new THREE.SphereGeometry(0.028, 8, 6),
    nose: new THREE.ConeGeometry(0.02, 0.05, 6),
    eyeW: new THREE.SphereGeometry(0.018, 8, 6),
    eyeP: new THREE.SphereGeometry(0.01, 6, 4),
    brow: new THREE.BoxGeometry(0.038, 0.009, 0.01),
    hairCap: new THREE.SphereGeometry(0.126, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    hairBuzz: new THREE.SphereGeometry(0.121, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45),
    afro: new THREE.SphereGeometry(0.165, 16, 12),
    mohawk: new THREE.BoxGeometry(0.035, 0.07, 0.22),
    spike: new THREE.ConeGeometry(0.03, 0.08, 5),
    bun: new THREE.SphereGeometry(0.05, 10, 8),
    long: new THREE.CylinderGeometry(0.11, 0.1, 0.18, 14, 1, true, Math.PI * 0.5, Math.PI),
    collar: new THREE.TorusGeometry(0.068, 0.017, 6, 18),
  };
  return G;
}

const matCache = new Map();
function std(color, rough = 0.75, extra = {}) {
  const k = color + '|' + rough + JSON.stringify(extra);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra }));
  return matCache.get(k);
}

function rnd(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}

export class PlayerModel {
  // opts: { kit, number, name, isKeeper, seed, gkKit }
  constructor(opts) {
    const g = geoms();
    const R = rnd(opts.seed || (Math.random() * 1e9) | 0);
    const pick = arr => arr[Math.floor(R() * arr.length)];
    const kit = opts.kit;

    this.skin = pick(SKINS);
    this.hairColor = pick(HAIRS);
    this.hairStyle = pick(HAIR_STYLES);
    this.bootColor = pick(BOOTS);
    this.scale = 0.95 + R() * 0.1;

    const kitTex = makeKitTexture(kit, opts.number, opts.name, opts.isKeeper);
    const shirtMat = new THREE.MeshStandardMaterial({ map: kitTex, roughness: 0.78 });
    this.shirtMat = shirtMat;
    const sleeveMat = std(kit.primary, 0.78);
    const trimMat = std(kit.secondary, 0.7);
    const shortsMat = std(kit.shorts, 0.72);
    const socksMat = std(kit.socks, 0.8);
    const skinMat = std(this.skin, 0.55);
    const hairMat = std(this.hairColor, 0.9);
    const bootMat = std(this.bootColor, 0.35);
    const soleMat = std('#222222', 0.6);
    const eyeWMat = std('#f4f4f4', 0.4);
    const eyePMat = std('#1a1a1a', 0.3);
    const gloveMat = std(opts.isKeeper ? '#f5f5f5' : this.skin, 0.6);

    const cast = m => { m.castShadow = true; return m; };
    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = cast(new THREE.Mesh(geo, mat));
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const joint = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };

    // 层级
    this.root = new THREE.Group();          // 世界位置 + 朝向
    this.body = new THREE.Group();          // 姿态根（滑铲/倒地/鱼跃的整体偏移与翻转）
    this.body.scale.setScalar(this.scale);
    this.root.add(this.body);

    const pelvis = joint(this.body, 0, 1.03, 0);
    const spine = joint(pelvis, 0, 0.04, 0);
    const neck = joint(spine, 0, 0.52, 0);
    const lSh = joint(spine, 0.205, 0.44, 0);
    const rSh = joint(spine, -0.205, 0.44, 0);
    const lHip = joint(pelvis, 0.095, -0.06, 0);
    const rHip = joint(pelvis, -0.095, -0.06, 0);

    // 躯干
    const torso = mesh(g.torso, shirtMat, spine, 0, 0, 0);
    torso.scale.set(1, 1, 0.72);
    const collar = mesh(g.collar, trimMat, spine, 0, 0.515, 0.0);
    collar.rotation.x = Math.PI / 2; collar.scale.set(1.15, 0.85, 1);
    // 短裤
    const shorts = mesh(g.shorts, shortsMat, pelvis, 0, 0.02, 0);
    shorts.scale.set(1, 1, 0.78);

    // 头部
    mesh(g.neck, skinMat, neck, 0, 0.03, 0);
    const headJ = joint(neck, 0, 0.08, 0);
    const head = mesh(g.head, skinMat, headJ, 0, 0.08, 0.005);
    head.scale.set(0.92, 1.05, 1);
    for (const s of [-1, 1]) {
      mesh(g.ear, skinMat, headJ, s * 0.108, 0.075, -0.005).scale.set(0.5, 1, 0.8);
      mesh(g.eyeW, eyeWMat, headJ, s * 0.042, 0.1, 0.1).scale.set(1, 0.8, 0.5);
      mesh(g.eyeP, eyePMat, headJ, s * 0.042, 0.1, 0.109);
      const brow = mesh(g.brow, hairMat, headJ, s * 0.043, 0.128, 0.104);
      brow.rotation.z = s * 0.12;
    }
    const nose = mesh(g.nose, skinMat, headJ, 0, 0.07, 0.118);
    nose.rotation.x = Math.PI / 2 + 0.3;
    this.buildHair(headJ, hairMat, g, mesh);

    // 手臂
    const arm = (sh, s) => {
      mesh(g.sleeve, sleeveMat, sh, 0, -0.06, 0);
      const trim = mesh(g.collar, trimMat, sh, 0, -0.135, 0); trim.rotation.x = Math.PI / 2; trim.scale.set(0.95, 0.95, 0.6);
      mesh(g.upperArm, skinMat, sh, 0, -0.15, 0);
      const el = joint(sh, 0, -0.29, 0);
      mesh(g.forearm, opts.isKeeper ? sleeveMat : skinMat, el, 0, -0.12, 0);
      mesh(opts.isKeeper ? g.glove : g.hand, gloveMat, el, 0, -0.27, 0.01);
      sh.rotation.z = s * 0.08;
      return el;
    };
    const lEl = arm(lSh, 1), rEl = arm(rSh, -1);

    // 腿
    const leg = (hip) => {
      mesh(g.shortLeg, shortsMat, hip, 0, -0.07, 0);
      mesh(g.thigh, skinMat, hip, 0, -0.22, 0);
      const knee = joint(hip, 0, -0.44, 0);
      mesh(g.knee, skinMat, knee, 0, 0, 0.01);
      mesh(g.shin, socksMat, knee, 0, -0.22, 0);
      const ank = joint(knee, 0, -0.44, 0);
      const boot = mesh(g.boot, bootMat, ank, 0, -0.035, 0.05);
      boot.rotation.x = Math.PI / 2;
      mesh(g.sole, soleMat, ank, 0, -0.085, 0.05);
      return [knee, ank];
    };
    const [lKnee, lAnk] = leg(lHip);
    const [rKnee, rAnk] = leg(rHip);

    this.joints = [pelvis, spine, headJ, lSh, lEl, rSh, rEl, lHip, lKnee, lAnk, rHip, rKnee, rAnk];
    this.rest = this.joints.map(j => j.rotation.clone());
    this.pose = new Float32Array(POSE_N);
    this.target = new Float32Array(POSE_N);
    this.rEl = rEl; this.lEl = lEl;
  }

  buildHair(headJ, hairMat, g, mesh) {
    const st = this.hairStyle;
    if (st === 'bald') return;
    if (st === 'afro') { const a = mesh(g.afro, hairMat, headJ, 0, 0.13, -0.02); a.scale.set(1, 0.85, 1); return; }
    const cap = mesh(st === 'buzz' ? g.hairBuzz : g.hairCap, hairMat, headJ, 0, 0.085, -0.008);
    cap.rotation.x = -0.25;
    if (st === 'mohawk') mesh(g.mohawk, hairMat, headJ, 0, 0.215, -0.01);
    if (st === 'spiky') for (let i = 0; i < 7; i++) {
      const s = mesh(g.spike, hairMat, headJ, (i % 3 - 1) * 0.05, 0.2, -0.04 + Math.floor(i / 3) * 0.05);
      s.rotation.set(-0.3 + Math.random() * 0.2, 0, (i % 3 - 1) * 0.35);
    }
    if (st === 'bun') mesh(g.bun, hairMat, headJ, 0, 0.14, -0.12);
    if (st === 'long') { const l = mesh(g.long, hairMat, headJ, 0, 0.02, -0.01); l.scale.set(1.08, 1, 1.05); }
  }

  // 平滑过渡到 target 姿态
  apply(dt, rate = 16) {
    const k = rate >= 999 ? 1 : 1 - Math.exp(-rate * dt);
    const p = this.pose, t = this.target;
    for (let i = 0; i < POSE_N; i++) p[i] += (t[i] - p[i]) * k;
    this.write(p);
  }

  write(p) {
    for (let j = 0; j < NJ; j++) {
      const r = this.rest[j];
      this.joints[j].rotation.set(r.x + p[j * 3], r.y + p[j * 3 + 1], r.z + p[j * 3 + 2]);
    }
    const o = NJ * 3;
    this.body.position.y = p[o];
    this.body.rotation.set(p[o + 1], p[o + 3], p[o + 2], 'YXZ');
  }

  setKitMap(tex) { this.shirtMat.map = tex; this.shirtMat.needsUpdate = true; }

  // 释放本模型独占的资源（球衣纹理与材质；几何体与其他材质共享，不释放）
  dispose() {
    if (this.shirtMat.map) this.shirtMat.map.dispose();
    this.shirtMat.dispose();
    this.root.removeFromParent();
  }

  // 右脚 / 手 的世界坐标
  worldOf(obj, out, y = 0) { return obj.localToWorld(out.set(0, y, 0)); }
}
