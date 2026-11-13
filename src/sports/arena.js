import * as THREE from 'three';
import { canvas, toTex } from '../gfx/textures.js';

// 篮球馆 / 网球场 / 羽毛球馆：程序化场地、球网与篮架、看台与观众
// 坐标：篮球场沿 x 轴（篮筐在 ±x），网球 / 羽毛球场沿 z 轴（球网在 z=0，近端 +z 朝向镜头）
export const COURTS = {
  basketball: { halfL: 14, halfW: 7.5, hoopX: 12.425, rimY: 3.05, rimR: 0.23, three: 6.75, indoor: true, standX: 17.5, standZ: 10.5 },
  tennis: { halfL: 11.885, halfW: 4.115, dblW: 5.485, service: 6.4, netH: 0.95, indoor: false, standX: 10.5, standZ: 18.5 },
  badminton: { halfL: 6.7, halfW: 2.59, dblW: 3.05, service: 1.98, netH: 1.55, indoor: true, standX: 7.2, standZ: 10.5 },
};

const std = (color, roughness = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

export class Arena {
  constructor(scene, stadium, quality = 'medium') {
    this.scene = scene; this.stadium = stadium; this.quality = quality;
    this.venues = {};
    this.cur = null;
    this.hype = 0;
    this.t = 0;
    this._m = new THREE.Matrix4();
  }

  // ---------- 切换场馆 ----------
  show(type, { colors = ['#d62828', '#1d4ed8'], time = 'night' } = {}) {
    this.hide();
    const st = this.stadium, C = COURTS[type];
    if (!this.venues[type]) this.venues[type] = this.build(type);
    const v = this.cur = this.venues[type];
    this.type = type;
    v.group.visible = true;
    st.group.visible = false;
    st.setPreset(C.indoor ? 'night' : time, 'clear');
    const sc = st.sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 320; sc.updateProjectionMatrix();
    if (C.indoor) {
      st.sky.visible = false; st.clouds.visible = false;
      this.scene.background = new THREE.Color('#0a0e17');
      this.scene.fog = new THREE.Fog('#0a0e17', 70, 190);
      st.sun.position.set(7, 34, 13); st.sun.intensity = 2.3; st.sun.color.set('#fff7ea');
      st.hemi.color.set('#d5dcff'); st.hemi.groundColor.set(type === 'basketball' ? '#6b4a2a' : '#2c5a44'); st.hemi.intensity = 0.95;
      st.fill.intensity = 0.7;
      st.exposure = 1.05; st.bloom = 0.32;
    } else {
      st.fill.intensity = time === 'night' ? 1.1 : 0.15;
      if (time === 'night') { st.sun.position.set(10, 60, 22); st.hemi.intensity = 0.8; }
      v.lampMat.emissiveIntensity = time === 'night' ? 4 : time === 'sunset' ? 1.2 : 0.1;
    }
    this.paintCrowd(v, colors);
    this.hype = 0;
    return C;
  }

  hide() {
    if (!this.cur) return;
    this.cur.group.visible = false;
    this.cur = null;
    const st = this.stadium;
    st.group.visible = true; st.sky.visible = true;
    this.scene.background = null;
    const sc = st.sun.shadow.camera;
    sc.left = -62; sc.right = 62; sc.top = 48; sc.bottom = -48; sc.near = 10; sc.far = 300; sc.updateProjectionMatrix();
  }

  // ---------- 构建 ----------
  build(type) {
    const C = COURTS[type];
    const group = new THREE.Group();
    group.visible = false;
    this.scene.add(group);
    const v = { group, type, C };

    // 地面
    const fl = type === 'basketball' ? this.floorBasketball(C) : type === 'tennis' ? this.floorTennis(C) : this.floorBadminton(C);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(fl.w, fl.h), std('#ffffff', fl.rough, { map: fl.tex, metalness: fl.metal || 0 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    group.add(floor);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), std(fl.apron, 0.9));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; apron.receiveShadow = true;
    group.add(apron);

    v.lampMat = std('#ffffff', 0.4, { emissive: '#fff4d6', emissiveIntensity: 3 });
    if (C.indoor) this.buildHall(v, C);
    else this.buildPoles(v, C);
    this.buildStands(v, C);
    this.buildBoards(v, C, type);

    if (type === 'basketball') { v.hoops = [this.buildHoop(v, 1, C), this.buildHoop(v, -1, C)]; this.buildBench(v, C); }
    else { this.buildNet(v, C, type); this.buildChair(v, C); }
    return v;
  }

  floorBasketball(C) {
    const S = 64, W = 32, H = 19;
    const [cv, g] = canvas(W * S, H * S);
    const X = x => (x + W / 2) * S, Y = z => (z + H / 2) * S;
    // 木地板
    g.fillStyle = '#c38d52'; g.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < cv.height; y += 8) {
      const off = (y / 8 % 2) * 60;
      for (let x = -off; x < cv.width; x += 120) {
        const l = 0.5 + Math.random() * 0.14;
        g.fillStyle = `hsla(${28 + Math.random() * 6}, 48%, ${l * 100}%, 0.55)`;
        g.fillRect(x, y, 119, 7);
      }
    }
    // 场外深色
    g.fillStyle = 'rgba(20,40,90,0.82)';
    g.fillRect(0, 0, cv.width, Y(-C.halfW)); g.fillRect(0, Y(C.halfW), cv.width, cv.height);
    g.fillRect(0, 0, X(-C.halfL), cv.height); g.fillRect(X(C.halfL), 0, cv.width, cv.height);
    const line = (w = 4) => { g.strokeStyle = '#ffffff'; g.lineWidth = w; };
    for (const s of [-1, 1]) {
      // 油漆区
      g.fillStyle = s > 0 ? 'rgba(190,40,40,0.78)' : 'rgba(30,70,170,0.78)';
      const x0 = Math.min(X(s * C.halfL), X(s * (C.halfL - 5.8)));
      g.fillRect(x0, Y(-2.45), 5.8 * S, 4.9 * S);
      line(); g.strokeRect(x0, Y(-2.45), 5.8 * S, 4.9 * S);
      g.beginPath(); g.arc(X(s * (C.halfL - 5.8)), Y(0), 1.8 * S, 0, Math.PI * 2); g.stroke();
      // 三分线
      const cx = s * C.hoopX, a0 = Math.asin(6.6 / C.three);
      g.beginPath();
      g.moveTo(X(s * C.halfL), Y(-6.6));
      for (let i = 0; i <= 40; i++) { const a = -a0 + 2 * a0 * i / 40; g.lineTo(X(cx - s * C.three * Math.cos(a)), Y(C.three * Math.sin(a))); }
      g.lineTo(X(s * C.halfL), Y(6.6));
      g.stroke();
      // 合理冲撞区
      g.beginPath(); g.arc(X(cx), Y(0), 1.25 * S, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? Math.PI * 1.5 : Math.PI / 2); g.stroke();
    }
    line(5); g.strokeRect(X(-C.halfL), Y(-C.halfW), C.halfL * 2 * S, C.halfW * 2 * S);
    g.beginPath(); g.moveTo(X(0), Y(-C.halfW)); g.lineTo(X(0), Y(C.halfW)); g.stroke();
    g.fillStyle = 'rgba(255,190,40,0.85)'; g.beginPath(); g.arc(X(0), Y(0), 1.8 * S, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#7a1414'; g.font = '900 54px "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('BLAZE', X(0), Y(0));
    return { tex: toTex(cv), w: W, h: H, rough: 0.32, metal: 0.05, apron: '#141c2c' };
  }

  floorTennis(C) {
    const S = 46, W = 22, H = 38;
    const [cv, g] = canvas(W * S, H * S);
    const X = x => (x + W / 2) * S, Y = z => (z + H / 2) * S;
    g.fillStyle = '#2e7d52'; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#2a5fb0'; g.fillRect(X(-C.dblW), Y(-C.halfL), C.dblW * 2 * S, C.halfL * 2 * S);
    for (let i = 0; i < 9000; i++) { g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)'; g.fillRect(Math.random() * cv.width, Math.random() * cv.height, 3, 3); }
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.strokeRect(X(-C.dblW), Y(-C.halfL), C.dblW * 2 * S, C.halfL * 2 * S);
    const ln = (x0, z0, x1, z1) => { g.beginPath(); g.moveTo(X(x0), Y(z0)); g.lineTo(X(x1), Y(z1)); g.stroke(); };
    for (const s of [-1, 1]) {
      ln(s * C.halfW, -C.halfL, s * C.halfW, C.halfL);
      ln(-C.halfW, s * C.service, C.halfW, s * C.service);
      ln(0, s * C.halfL, 0, s * (C.halfL - 0.25));
    }
    ln(0, -C.service, 0, C.service);
    return { tex: toTex(cv), w: W, h: H, rough: 0.85, apron: '#27623f' };
  }

  floorBadminton(C) {
    const S = 80, W = 12, H = 19;
    const [cv, g] = canvas(W * S, H * S);
    const X = x => (x + W / 2) * S, Y = z => (z + H / 2) * S;
    g.fillStyle = '#b98850'; g.fillRect(0, 0, cv.width, cv.height);
    for (let x = 0; x < cv.width; x += 10) { g.fillStyle = `hsla(30, 45%, ${44 + Math.random() * 12}%, 0.5)`; g.fillRect(x, 0, 9, cv.height); }
    g.fillStyle = '#1c8a5c'; g.fillRect(X(-C.dblW - 0.9), Y(-C.halfL - 1.2), (C.dblW + 0.9) * 2 * S, (C.halfL + 1.2) * 2 * S);
    g.fillStyle = '#23a06b'; g.fillRect(X(-C.dblW), Y(-C.halfL), C.dblW * 2 * S, C.halfL * 2 * S);
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.strokeRect(X(-C.dblW), Y(-C.halfL), C.dblW * 2 * S, C.halfL * 2 * S);
    const ln = (x0, z0, x1, z1) => { g.beginPath(); g.moveTo(X(x0), Y(z0)); g.lineTo(X(x1), Y(z1)); g.stroke(); };
    for (const s of [-1, 1]) {
      ln(s * C.halfW, -C.halfL, s * C.halfW, C.halfL);
      ln(-C.dblW, s * C.service, C.dblW, s * C.service);
      ln(-C.dblW, s * (C.halfL - 0.76), C.dblW, s * (C.halfL - 0.76));
      ln(0, s * C.service, 0, s * C.halfL);
    }
    return { tex: toTex(cv), w: W, h: H, rough: 0.5, apron: '#3a2c1e' };
  }

  buildHall(v, C) {
    const hall = new THREE.Mesh(new THREE.BoxGeometry(110, 30, 110), new THREE.MeshStandardMaterial({ color: '#141a28', roughness: 0.95, side: THREE.BackSide }));
    hall.position.y = 14.9;
    v.group.add(hall);
    // 顶棚桁架灯
    const truss = std('#2a3140', 0.6, { metalness: 0.5 });
    const n = 4;
    for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
      const L = v.type === 'basketball';
      const u = (i - (n - 1) / 2) / ((n - 1) / 2);
      const x = L ? u * 11 : s * 4.5, z = L ? s * 5 : u * (C.halfL + 1);
      const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 1.4), truss);
      box.position.set(x, 15, z);
      const lamp = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 1.1), v.lampMat);
      lamp.rotation.x = Math.PI / 2; lamp.position.set(x, 14.86, z);
      v.group.add(box, lamp);
    }
  }

  buildPoles(v, C) {
    const pole = std('#8a9199', 0.5, { metalness: 0.6 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 16, 8), pole);
      p.position.set(sx * (C.standX + 9), 8, sz * (C.halfL + 3));
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 3.2), v.lampMat);
      head.position.set(sx * (C.standX + 8.7), 16.4, sz * (C.halfL + 3));
      head.rotation.z = sx * 0.4;
      v.group.add(p, head);
    }
  }

  // 三面看台（+z 一侧留给镜头）
  buildStands(v, C) {
    const rows = this.quality === 'low' ? 6 : 9, depth = 0.85, rise = 0.46;
    const seatMat = std('#24304a', 0.9), wallMat = std('#3b4252', 0.85);
    const spots = [];
    const addRow = (len, x, z, ry, i) => {
      const h = 0.75 + i * rise;
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, depth), i % 4 === 3 ? wallMat : seatMat);
      m.position.set(x, h / 2, z); m.rotation.y = ry; m.receiveShadow = true;
      v.group.add(m);
      const n = Math.floor(len / 0.64);
      for (let k = 0; k < n; k++) {
        if (Math.random() < 0.1) continue;
        const u = (k + 0.5) / n - 0.5;
        const px = x + Math.cos(ry) * u * len, pz = z - Math.sin(ry) * u * len;
        spots.push([px, h, pz, ry]);
      }
    };
    for (let i = 0; i < rows; i++) {
      const d = i * depth;
      addRow((C.standX + d) * 2 + depth, 0, -(C.standZ + d), 0, i);
      for (const s of [-1, 1]) addRow(C.standZ * 2 + d, s * (C.standX + d), d / 2 * -1 + 0, s * Math.PI / 2, i);
    }
    // 观众：身体 + 头，实例化
    const n = spots.length;
    const bodyGeo = new THREE.BoxGeometry(0.44, 0.56, 0.3); bodyGeo.translate(0, 0.3, 0);
    const headGeo = new THREE.SphereGeometry(0.13, 8, 6); headGeo.translate(0, 0.72, 0);
    v.bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    v.heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), n);
    const skins = ['#f3cfb3', '#e0ac7e', '#c68e5e', '#8d5a3a', '#5e3b26'].map(c => new THREE.Color(c));
    v.spots = spots; v.phase = new Float32Array(n);
    const m = this._m;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = spots[i];
      m.makeTranslation(x, y, z);
      v.bodies.setMatrixAt(i, m); v.heads.setMatrixAt(i, m);
      v.heads.setColorAt(i, skins[(Math.random() * skins.length) | 0]);
      v.phase[i] = Math.random() * 6.28;
    }
    v.bodies.frustumCulled = v.heads.frustumCulled = false;
    v.group.add(v.bodies, v.heads);
  }

  paintCrowd(v, colors) {
    const a = new THREE.Color(colors[0]), b = new THREE.Color(colors[1]), c = new THREE.Color();
    const axis = v.type === 'basketball' ? 0 : 0;
    for (let i = 0; i < v.spots.length; i++) {
      const home = v.spots[i][axis] < 0 ? Math.random() < 0.75 : Math.random() < 0.25;
      const r = Math.random();
      if (r < 0.6) c.copy(home ? a : b); else if (r < 0.72) c.set('#f1f1f1'); else c.setHSL(Math.random(), 0.35, 0.3 + Math.random() * 0.35);
      v.bodies.setColorAt(i, c);
    }
    v.bodies.instanceColor.needsUpdate = true;
  }

  buildBoards(v, C, type) {
    const [cv, g] = canvas(1024, 64);
    const words = type === 'basketball' ? ['热血篮球', 'BLAZING HOOPS', '绝杀时刻', 'SLAM DUNK'] : type === 'tennis' ? ['热血网球', 'GRAND SLAM', 'ACE!', 'BLAZING OPEN'] : ['热血羽毛球', 'SMASH!', '杀球时刻', 'BLAZING OPEN'];
    const cols = ['#0e7c3a', '#b5121b', '#1d4ed8', '#c2410c'];
    for (let i = 0; i < 4; i++) {
      g.fillStyle = cols[i]; g.fillRect(i * 256, 0, 256, 64);
      g.fillStyle = '#fff'; g.font = '900 30px "Microsoft YaHei", "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(words[i], i * 256 + 128, 34);
    }
    const tex = toTex(cv, { repeat: [1, 1] });
    v.boardTex = tex;
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.6, roughness: 0.5 });
    const H = 0.75;
    const add = (len, x, z, ry) => {
      const geo = new THREE.BoxGeometry(len, H, 0.12);
      const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 14);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, H / 2, z); m.rotation.y = ry; m.castShadow = true;
      v.group.add(m);
    };
    const bx = C.standX - 0.7, bz = C.standZ - 0.7;
    add(bx * 2, 0, -bz, 0);
    for (const s of [-1, 1]) add(bz * 2, s * bx, 0, -s * Math.PI / 2);
  }

  buildHoop(v, side, C) {
    const grp = new THREE.Group();
    const x = side * C.hoopX, bx = side * (C.hoopX + 0.38);
    const steel = std('#20242c', 0.5, { metalness: 0.6 });
    const pad = std(side > 0 ? '#b5121b' : '#1d4ed8', 0.8);
    // 底座与支臂
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.3), pad); base.position.set(side * (C.halfL + 1.9), 0.5, 0);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.3, 0.28), steel); post.position.set(side * (C.halfL + 1.9), 2.1, 0);
    const armLen = C.halfL + 1.9 - Math.abs(bx);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen + 0.3, 0.22, 0.22), steel);
    arm.position.set(side * (Math.abs(bx) + armLen / 2), 3.35, 0); arm.rotation.z = side * -0.12;
    grp.add(base, post, arm);
    // 篮板
    const [cv, g] = canvas(256, 150);
    g.fillStyle = 'rgba(220,235,255,0.22)'; g.fillRect(0, 0, 256, 150);
    g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 144);
    g.strokeRect(86, 78, 84, 62);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 1.8), new THREE.MeshStandardMaterial({ map: toTex(cv), transparent: true, roughness: 0.15, metalness: 0.1 }));
    board.position.set(bx, 3.42, 0);
    grp.add(board);
    // 篮筐
    const rimG = new THREE.Group();
    rimG.position.set(x, C.rimY, 0);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(C.rimR, 0.018, 8, 28), std('#ff5a1f', 0.4, { metalness: 0.4 }));
    rim.rotation.x = Math.PI / 2; rim.castShadow = true;
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.1), std('#ff5a1f', 0.4));
    neck.position.x = side * (C.rimR + 0.07);
    rimG.add(rim, neck);
    // 球网
    const pts = [], N = 14, R0 = C.rimR, R1 = 0.13, Hn = 0.42;
    for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, am = (a0 + a1) / 2;
      for (let k = 0; k < 3; k++) {
        const y0 = -k * Hn / 3, y1 = -(k + 1) * Hn / 3, r0 = R0 + (R1 - R0) * k / 3, r1 = R0 + (R1 - R0) * (k + 1) / 3;
        const p = k % 2 === 0 ? [a0, am, a1] : [am, a1, am + (a1 - a0)];
        pts.push(Math.cos(p[0]) * r0, y0, Math.sin(p[0]) * r0, Math.cos(p[1]) * r1, y1, Math.sin(p[1]) * r1);
        pts.push(Math.cos(p[2]) * r0, y0, Math.sin(p[2]) * r0, Math.cos(p[1]) * r1, y1, Math.sin(p[1]) * r1);
      }
    }
    const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const net = new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    rimG.add(net);
    grp.add(rimG);
    v.group.add(grp);
    return { side, x, rimG, net, swish: 0, shake: 0 };
  }

  buildBench(v, C) {
    const table = new THREE.Mesh(new THREE.BoxGeometry(7, 0.8, 0.7), std('#12161f', 0.6));
    table.position.set(0, 0.4, -(C.halfW + 1.6));
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 0.5), new THREE.MeshBasicMaterial({ map: v.boardTex }));
    strip.position.set(0, 0.42, -(C.halfW + 1.24));
    v.group.add(table, strip);
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(5, 0.45, 0.5), std(s < 0 ? '#1d4ed8' : '#b5121b', 0.7));
      b.position.set(s * 8, 0.23, -(C.halfW + 1.7));
      v.group.add(b);
    }
  }

  buildNet(v, C, type) {
    const tennis = type === 'tennis';
    const px = C.dblW + (tennis ? 0.9 : 0.02), top = tennis ? 1.07 : 1.55, bottom = tennis ? 0 : 0.79;
    const postMat = std(tennis ? '#1c1f24' : '#e8e8e8', 0.5, { metalness: 0.4 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, top + 0.03, 10), postMat);
      p.position.set(s * px, (top + 0.03) / 2, 0); p.castShadow = true;
      v.group.add(p);
      if (!tennis) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.6), postMat); b.position.set(s * px, 0.03, 0); v.group.add(b); }
    }
    const [cv, g] = canvas(64, 64);
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = tennis ? 'rgba(20,20,20,0.9)' : 'rgba(90,50,30,0.9)'; g.lineWidth = 2;
    for (let i = 0; i <= 64; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
    const h = (tennis ? C.netH : top) - bottom;
    const tex = toTex(cv, { repeat: [px * 2 / 0.3, h / 0.3] });
    const net = new THREE.Mesh(new THREE.PlaneGeometry(px * 2, h, 24, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.2 }));
    net.position.set(0, bottom + h / 2, 0);
    // 网球网中间略低
    if (tennis) { const pos = net.geometry.attributes.position; for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) + (Math.abs(pos.getX(i)) / px) ** 2 * (1.07 - C.netH)); }
    const tape = new THREE.Mesh(new THREE.BoxGeometry(px * 2, tennis ? 0.07 : 0.045, 0.02), std('#f5f5f5', 0.7));
    tape.position.set(0, tennis ? C.netH + 0.02 : top - 0.02, 0);
    v.group.add(net, tape);
    v.net = net; v.netShake = 0;
  }

  buildChair(v, C) {
    const x = -(C.dblW + 1.9), m = std('#e7e2d4', 0.7);
    const g = new THREE.Group();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), m);
      leg.position.set(sx * 0.3, 0.95, sz * 0.3); leg.rotation.z = -sx * 0.08; leg.rotation.x = sz * 0.08;
      g.add(leg);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), std('#1d4ed8', 0.7)); seat.position.y = 1.9;
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.6), std('#1d4ed8', 0.7)); back.position.set(-0.28, 2.2, 0);
    g.add(seat, back);
    g.position.set(x, 0, 0);
    v.group.add(g);
  }

  // ---------- 事件 ----------
  swish(side, strong = false) {
    const h = this.cur?.hoops?.find(h => h.side === side);
    if (h) { h.swish = 1; if (strong) h.shake = 1; }
  }
  rimShake(side, amt = 0.6) { const h = this.cur?.hoops?.find(h => h.side === side); if (h) h.shake = Math.max(h.shake, amt); }
  netHit() { if (this.cur) this.cur.netShake = 1; }
  cheer(amt = 1) { this.hype = Math.max(this.hype, amt); }

  update(dt, t) {
    const v = this.cur;
    if (!v) return;
    this.t = t;
    v.boardTex.offset.x = (t * 0.04) % 1;
    if (v.hoops) for (const h of v.hoops) {
      if (h.swish > 0.001 || h.shake > 0.001) {
        h.swish *= Math.exp(-dt * 4); h.shake *= Math.exp(-dt * 5);
        h.net.scale.set(1 + Math.sin(t * 30) * 0.12 * h.swish, 1 + Math.sin(t * 22) * 0.3 * h.swish, 1 + Math.cos(t * 30) * 0.12 * h.swish);
        h.rimG.rotation.z = h.side * -Math.abs(Math.sin(t * 34)) * 0.16 * h.shake;
      }
    }
    if (v.net && v.netShake > 0.001) {
      v.netShake *= Math.exp(-dt * 5);
      v.net.position.z = Math.sin(t * 40) * 0.06 * v.netShake;
    }
    // 观众起伏
    this.hype = Math.max(0, this.hype - dt * 0.28);
    const active = this.hype > 0.02;
    if (active || v.crowdDirty) {
      const m = this._m, n = v.spots.length;
      for (let i = 0; i < n; i++) {
        const s = v.spots[i];
        const j = active ? Math.max(0, Math.sin(t * 9 + v.phase[i])) * 0.38 * this.hype : 0;
        m.makeTranslation(s[0], s[1] + j, s[2]);
        v.bodies.setMatrixAt(i, m); v.heads.setMatrixAt(i, m);
      }
      v.bodies.instanceMatrix.needsUpdate = true; v.heads.instanceMatrix.needsUpdate = true;
      v.crowdDirty = active;
    }
  }
}
