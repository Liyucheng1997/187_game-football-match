import * as THREE from 'three';
import { makeKitTexture, canvas, toTex } from './textures.js';

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
    // 大腿 / 小腿：带肌肉轮廓的旋转体（自膝/踝向上）
    thigh: lathe([[0.0, -0.45], [0.052, -0.44], [0.058, -0.36], [0.07, -0.22], [0.079, -0.1], [0.08, 0.0], [0.05, 0.03]], 12),
    shin: lathe([[0.0, -0.45], [0.04, -0.44], [0.042, -0.36], [0.052, -0.24], [0.063, -0.13], [0.058, -0.03], [0.05, 0.02]], 12),
    knee: new THREE.SphereGeometry(0.062, 10, 8),
    boot: new THREE.CapsuleGeometry(0.052, 0.14, 4, 10),
    toe: new THREE.SphereGeometry(0.054, 10, 8),
    sole: new THREE.BoxGeometry(0.1, 0.02, 0.25),
    sockCuff: new THREE.CylinderGeometry(0.05, 0.046, 0.12, 10),
    cuffRing: new THREE.TorusGeometry(0.05, 0.012, 6, 14),
    delt: new THREE.SphereGeometry(0.076, 12, 10),
    upperArm: new THREE.CapsuleGeometry(0.05, 0.2, 4, 8),
    sleeve: new THREE.CylinderGeometry(0.066, 0.072, 0.15, 12, 1, true),
    forearm: lathe([[0.0, -0.3], [0.034, -0.29], [0.038, -0.2], [0.047, -0.08], [0.045, 0.0], [0.03, 0.03]], 10),
    band: new THREE.CylinderGeometry(0.042, 0.042, 0.05, 10),
    hand: new THREE.SphereGeometry(0.05, 10, 8),
    thumb: new THREE.CapsuleGeometry(0.014, 0.03, 3, 6),
    glove: new THREE.SphereGeometry(0.075, 10, 8),
    neck: new THREE.CylinderGeometry(0.05, 0.058, 0.1, 10),
    head: new THREE.SphereGeometry(0.118, 22, 18),
    jaw: new THREE.SphereGeometry(0.09, 14, 10),
    ear: new THREE.SphereGeometry(0.028, 8, 6),
    nose: new THREE.ConeGeometry(0.02, 0.05, 6),
    eyeW: new THREE.SphereGeometry(0.018, 8, 6),
    eyeP: new THREE.SphereGeometry(0.01, 6, 4),
    brow: new THREE.BoxGeometry(0.038, 0.009, 0.01),
    mouth: new THREE.BoxGeometry(0.044, 0.008, 0.01),
    headband: new THREE.TorusGeometry(0.113, 0.013, 6, 20),
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

// ---------- 球拍（网球 / 羽毛球），沿本地 +y 伸出 ----------
let stringTex = null;
const racketGeo = {};
export function buildRacket(type, color = '#e11d48') {
  const tennis = type === 'tennis';
  if (!stringTex) {
    const [cv, g] = canvas(64, 64);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1;
    for (let i = 4; i < 64; i += 6) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
    stringTex = toTex(cv);
  }
  const hw = tennis ? 0.13 : 0.1, hh = tennis ? 0.17 : 0.125;
  const handleL = tennis ? 0.2 : 0.17, shaftL = tennis ? 0.13 : 0.3;
  const k = type;
  if (!racketGeo[k]) {
    racketGeo[k] = {
      handle: new THREE.CylinderGeometry(tennis ? 0.019 : 0.015, tennis ? 0.021 : 0.017, handleL, 8),
      shaft: new THREE.CylinderGeometry(tennis ? 0.011 : 0.006, tennis ? 0.013 : 0.006, shaftL, 6),
      head: new THREE.TorusGeometry(hw, tennis ? 0.012 : 0.007, 6, 26),
      strings: new THREE.CircleGeometry(hw * 0.97, 22),
      throat: new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5),
    };
  }
  const rg = racketGeo[k];
  const frame = std(color, 0.35, { metalness: 0.35 });
  const grip = std(tennis ? '#f2f2f2' : '#1b1b1b', 0.9);
  const grp = new THREE.Group();
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; grp.add(m); return m; };
  const y0 = -0.06;
  add(rg.handle, grip, y0 + handleL / 2);
  add(rg.shaft, frame, y0 + handleL + shaftL / 2);
  const headY = y0 + handleL + shaftL + hh;
  const head = add(rg.head, frame, headY);
  head.scale.y = hh / hw; head.rotation.y = Math.PI / 2;
  const strings = add(rg.strings, new THREE.MeshBasicMaterial({ map: stringTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9 }), headY);
  strings.castShadow = false;
  strings.scale.y = hh / hw; strings.rotation.y = Math.PI / 2;
  if (tennis) for (const s of [-1, 1]) {
    const t = add(rg.throat, frame, y0 + handleL + shaftL - 0.02);
    t.position.z = s * 0.035; t.rotation.x = s * 0.45;
  }
  grp.userData.headY = headY;
  return grp;
}

export class PlayerModel {
  // opts: { kit, number, name, isKeeper, seed, sport: 'football' | 'basketball' | 'tennis' | 'badminton' }
  constructor(opts) {
    const g = geoms();
    const R = rnd(opts.seed || (Math.random() * 1e9) | 0);
    const pick = arr => arr[Math.floor(R() * arr.length)];
    const kit = opts.kit;
    const sport = opts.sport || 'football';
    const football = sport === 'football';
    const sleeveless = sport === 'basketball';
    const racketSport = sport === 'tennis' || sport === 'badminton';

    this.skin = pick(SKINS);
    this.hairColor = pick(HAIRS);
    this.hairStyle = pick(HAIR_STYLES);
    this.bootColor = pick(BOOTS);
    this.scale = (0.95 + R() * 0.1) * (sleeveless ? 1.05 : 1);
    const accessory = R();
    if (!football) this.bootColor = accessory < 0.5 ? '#f5f5f5' : accessory < 0.8 ? kit.primary : '#16181c';

    const kitTex = makeKitTexture(kit, opts.number, opts.name, opts.isKeeper);
    const shirtMat = new THREE.MeshStandardMaterial({ map: kitTex, roughness: 0.78 });
    this.shirtMat = shirtMat;
    const sleeveMat = std(kit.primary, 0.78);
    const trimMat = std(kit.secondary, 0.7);
    const shortsMat = std(kit.shorts, 0.72);
    const socksMat = std(football ? kit.socks : '#f2f2f2', 0.8);
    const skinMat = std(this.skin, 0.55);
    const hairMat = std(this.hairColor, 0.9);
    const bootMat = std(this.bootColor, 0.35);
    const soleMat = std(football ? '#222222' : '#e9e4d8', 0.6);
    const eyeWMat = std('#f4f4f4', 0.4);
    const eyePMat = std('#1a1a1a', 0.3);
    const lipMat = std('#8a4a40', 0.6);
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
    mesh(g.jaw, skinMat, headJ, 0, 0.035, 0.018).scale.set(0.95, 0.9, 1.02);
    for (const s of [-1, 1]) {
      mesh(g.ear, skinMat, headJ, s * 0.108, 0.075, -0.005).scale.set(0.5, 1, 0.8);
      mesh(g.eyeW, eyeWMat, headJ, s * 0.042, 0.1, 0.1).scale.set(1, 0.8, 0.5);
      mesh(g.eyeP, eyePMat, headJ, s * 0.042, 0.1, 0.109);
      const brow = mesh(g.brow, hairMat, headJ, s * 0.043, 0.128, 0.104);
      brow.rotation.z = s * 0.12;
    }
    const nose = mesh(g.nose, skinMat, headJ, 0, 0.07, 0.118);
    nose.rotation.x = Math.PI / 2 + 0.3;
    mesh(g.mouth, lipMat, headJ, 0, 0.022, 0.109);
    this.buildHair(headJ, hairMat, g, mesh);
    if (!football && accessory > 0.45 && this.hairStyle !== 'afro') {
      const hb = mesh(g.headband, trimMat, headJ, 0, 0.128, 0.004);
      hb.rotation.x = Math.PI / 2 - 0.12; hb.scale.set(0.94, 1, 1);
    }

    // 手臂
    const arm = (sh, s) => {
      mesh(g.delt, sleeveless ? skinMat : sleeveMat, sh, s * 0.004, -0.012, 0).scale.set(0.95, 1, 0.92);
      if (!sleeveless) {
        mesh(g.sleeve, sleeveMat, sh, 0, -0.06, 0);
        const trim = mesh(g.collar, trimMat, sh, 0, -0.135, 0); trim.rotation.x = Math.PI / 2; trim.scale.set(0.95, 0.95, 0.6);
      }
      mesh(g.upperArm, skinMat, sh, 0, -0.15, 0);
      const el = joint(sh, 0, -0.29, 0);
      mesh(g.forearm, opts.isKeeper ? sleeveMat : skinMat, el, 0, 0.03, 0);
      if (!football && (accessory > 0.3 || racketSport)) mesh(g.band, trimMat, el, 0, -0.215, 0);
      if (opts.isKeeper) mesh(g.glove, gloveMat, el, 0, -0.27, 0.01);
      else {
        mesh(g.hand, gloveMat, el, 0, -0.275, 0.008).scale.set(0.62, 1.1, 0.9);
        const th = mesh(g.thumb, gloveMat, el, s * -0.012, -0.262, 0.045); th.rotation.x = 0.9;
      }
      sh.rotation.z = s * 0.08;
      return el;
    };
    const lEl = arm(lSh, 1), rEl = arm(rSh, -1);

    // 腿
    const leg = (hip) => {
      const sl = mesh(g.shortLeg, shortsMat, hip, 0, sleeveless ? -0.12 : -0.07, 0);
      if (sleeveless) sl.scale.y = 1.55;
      mesh(g.thigh, skinMat, hip, 0, 0, 0);
      const knee = joint(hip, 0, -0.44, 0);
      mesh(g.knee, skinMat, knee, 0, 0, 0.01);
      mesh(g.shin, football ? socksMat : skinMat, knee, 0, 0, 0);
      if (football) { const c = mesh(g.cuffRing, trimMat, knee, 0, -0.07, 0); c.rotation.x = Math.PI / 2; c.scale.set(1.12, 1.12, 1); }
      else mesh(g.sockCuff, socksMat, knee, 0, -0.37, 0);
      const ank = joint(knee, 0, -0.44, 0);
      const boot = mesh(g.boot, bootMat, ank, 0, -0.035, 0.05);
      boot.rotation.x = Math.PI / 2;
      mesh(g.toe, bootMat, ank, 0, -0.04, 0.125).scale.set(0.98, 0.8, 1.05);
      if (!football) mesh(g.sockCuff, bootMat, ank, 0, 0.0, 0.0).scale.set(1.15, 0.6, 1.2);
      mesh(g.sole, soleMat, ank, 0, -0.085, 0.05);
      return [knee, ank];
    };
    const [lKnee, lAnk] = leg(lHip);
    const [rKnee, rAnk] = leg(rHip);

    // 球拍（右手）
    if (racketSport) {
      this.racket = buildRacket(sport, kit.secondary === '#ffffff' ? kit.primary : kit.secondary);
      this.racket.position.set(0, -0.275, 0.02);
      this.racket.rotation.x = 2.0;
      rEl.add(this.racket);
    }

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
