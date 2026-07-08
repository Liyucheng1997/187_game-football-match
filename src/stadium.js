import * as THREE from 'three';

// 场地常量（1 单位 ≈ 1 米）
export const F = {
  L: 100,          // 球场长（x 方向，球门在 ±50）
  W: 64,           // 球场宽（z 方向）
  goalHalfW: 6,    // 球门半宽
  goalH: 3.4,      // 横梁高
  goalDepth: 2.3,  // 球网深度
  wallX: 52,       // 底线外弹墙
  wallZ: 34,       // 边线外弹墙
  postR: 0.14,     // 门柱半径
};

// ---------- 草坪纹理（条纹 + 噪点 + 全部球场画线） ----------
function makePitchTexture() {
  const w = 2048, h = Math.round(2048 * (F.W / F.L)); // 2048 x ~1310
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const px = w / F.L; // 每米像素

  // 条纹草皮
  const stripes = 14;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#2e7d32' : '#388e3c';
    g.fillRect((w / stripes) * i, 0, w / stripes + 1, h);
  }
  // 噪点，让草更真实
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,40,0,0.05)';
    g.fillRect(x, y, 2.5, 2.5);
  }

  // 球场画线
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = Math.max(3, 0.14 * px);
  const line = g.lineWidth;
  const X = m => m * px, Y = m => m * (h / F.W);

  // 边界
  g.strokeRect(line, line, w - 2 * line, h - 2 * line);
  // 中线、中圈、中点
  g.beginPath(); g.moveTo(w / 2, line); g.lineTo(w / 2, h - line); g.stroke();
  g.beginPath(); g.arc(w / 2, h / 2, X(9.15), 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(w / 2, h / 2, X(0.35), 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();

  // 两侧禁区/小禁区/点球点/弧顶
  for (const side of [0, 1]) {
    const sx = side === 0 ? 0 : w;
    const dir = side === 0 ? 1 : -1;
    const rect = (depth, halfW) => {
      const x0 = side === 0 ? line : w - X(depth) - line;
      g.strokeRect(x0, h / 2 - Y(halfW), X(depth), Y(halfW * 2));
    };
    rect(16.5, 20.15);  // 大禁区
    rect(5.5, 9.16);    // 小禁区
    // 点球点
    g.beginPath(); g.arc(sx + dir * X(11), h / 2, X(0.3), 0, Math.PI * 2); g.fill();
    // 弧顶
    g.beginPath();
    const a = Math.acos((16.5 - 11) / 9.15);
    if (side === 0) g.arc(X(11), h / 2, X(9.15), -a, a);
    else g.arc(w - X(11), h / 2, X(9.15), Math.PI - a, Math.PI + a);
    g.stroke();
    // 角旗弧
    g.beginPath(); g.arc(sx + dir * line, line, X(1), 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(sx + dir * line, h - line, X(1), 0, Math.PI * 2); g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- 场外草皮（无线条，深一号） ----------
function makeApronTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#2a6e2e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,30,0,0.05)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(18, 14);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- 球网纹理 ----------
function makeNetTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  for (let i = 0; i <= 64; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ---------- 广告牌 ----------
const ADS = ['CLAUDE 可乐', 'FABLE 航空', '超级绿茵联赛', '老王牛肉面', '三喵宠物用品', '极速运动装备', '热血汽水', '流星旅行社'];
const AD_COLORS = [['#d32f2f', '#fff'], ['#1565c0', '#fff'], ['#f9a825', '#222'], ['#00838f', '#fff'], ['#6a1b9a', '#fff'], ['#2e7d32', '#fff']];
function makeAdTexture(text, ci) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 64;
  const g = cv.getContext('2d');
  const [bg, fg] = AD_COLORS[ci % AD_COLORS.length];
  g.fillStyle = bg; g.fillRect(0, 0, 512, 64);
  g.fillStyle = fg;
  g.font = 'bold 38px "Microsoft YaHei", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- 天空 ----------
function makeSky(scene) {
  const geo = new THREE.SphereGeometry(420, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#3a7bd5') },
      mid: { value: new THREE.Color('#9ec9f0') },
      bot: { value: new THREE.Color('#e8f4d8') },
    },
    vertexShader: `varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vp; uniform vec3 top, mid, bot;
      void main(){
        float t = clamp(vp.y / 260.0, 0.0, 1.0);
        vec3 c = t < 0.25 ? mix(bot, mid, t/0.25) : mix(mid, top, (t-0.25)/0.75);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geo, mat));

  // 云朵
  const cloudCv = document.createElement('canvas');
  cloudCv.width = cloudCv.height = 128;
  const cg = cloudCv.getContext('2d');
  const grad = cg.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  cg.fillStyle = grad; cg.fillRect(0, 0, 128, 128);
  const cloudTex = new THREE.CanvasTexture(cloudCv);
  for (let i = 0; i < 10; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.8, depthWrite: false }));
    const a = Math.random() * Math.PI * 2, r = 150 + Math.random() * 160;
    sp.position.set(Math.cos(a) * r, 60 + Math.random() * 60, Math.sin(a) * r);
    sp.scale.set(60 + Math.random() * 70, 26 + Math.random() * 22, 1);
    scene.add(sp);
  }
}

// ---------- 球门 ----------
function makeGoal(side) { // side: +1 → x=+50 球门
  const grp = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.35, metalness: 0.3 });
  const post = new THREE.CylinderGeometry(F.postR, F.postR, F.goalH, 10);

  for (const z of [-F.goalHalfW, F.goalHalfW]) {
    const p = new THREE.Mesh(post, white);
    p.position.set(0, F.goalH / 2, z);
    p.castShadow = true;
    grp.add(p);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(F.postR, F.postR, F.goalHalfW * 2 + F.postR * 2, 10), white);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0, F.goalH, 0);
  bar.castShadow = true;
  grp.add(bar);

  // 后支撑杆
  for (const z of [-F.goalHalfW, F.goalHalfW]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, Math.hypot(F.goalDepth, F.goalH), 8), white);
    st.position.set(side * F.goalDepth / 2, F.goalH / 2, z);
    st.rotation.z = -side * Math.atan2(F.goalDepth, F.goalH);
    grp.add(st);
  }

  // 球网：后 + 两侧 + 顶
  const netTex = makeNetTexture();
  const netMat = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9 });
  const mkNet = (wd, ht, rx, ry) => {
    const t = netTex.clone(); t.needsUpdate = true; t.repeat.set(rx, ry);
    return new THREE.Mesh(new THREE.PlaneGeometry(wd, ht), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.85 }));
  };
  const back = mkNet(F.goalHalfW * 2, F.goalH, 8, 3);
  back.rotation.y = Math.PI / 2;
  back.position.set(side * F.goalDepth, F.goalH / 2, 0);
  grp.add(back);
  for (const z of [-F.goalHalfW, F.goalHalfW]) {
    const sideNet = mkNet(F.goalDepth, F.goalH, 2, 3);
    sideNet.position.set(side * F.goalDepth / 2, F.goalH / 2, z);
    grp.add(sideNet);
  }
  const top = mkNet(F.goalDepth, F.goalHalfW * 2, 2, 8);
  top.rotation.x = Math.PI / 2;
  top.rotation.z = Math.PI / 2;
  top.position.set(side * F.goalDepth / 2, F.goalH, 0);
  grp.add(top);

  grp.position.x = side * F.L / 2;
  return grp;
}

// ---------- 看台 + 观众 ----------
function makeStands(scene) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.9 });
  const concreteDark = new THREE.MeshStandardMaterial({ color: 0x7d838a, roughness: 0.9 });
  const crowdInfo = { positions: [], baseY: [] };
  const standGroup = new THREE.Group();

  const ROWS = 11, STEP_H = 1.05, STEP_D = 2.1;

  // 四面看台：两长边（沿 x），两短边（沿 z，后面留出球门）
  const sides = [
    { axis: 'z', sign: -1, len: 124, start: 38 },
    { axis: 'z', sign: +1, len: 124, start: 38 },
    { axis: 'x', sign: -1, len: 82, start: 57 },
    { axis: 'x', sign: +1, len: 82, start: 57 },
  ];

  for (const s of sides) {
    const rows = s.axis === 'z' ? ROWS : 8;
    for (let i = 0; i < rows; i++) {
      const box = new THREE.BoxGeometry(
        s.axis === 'z' ? s.len : STEP_D,
        STEP_H,
        s.axis === 'z' ? STEP_D : s.len
      );
      const m = new THREE.Mesh(box, i % 2 ? concrete : concreteDark);
      const off = s.sign * (s.start + i * STEP_D + STEP_D / 2);
      m.position.set(
        s.axis === 'z' ? 0 : off,
        i * STEP_H + STEP_H / 2,
        s.axis === 'z' ? off : 0
      );
      m.receiveShadow = true;
      standGroup.add(m);

      // 每级台阶上放观众
      const seatSpacing = 1.35;
      const count = Math.floor(s.len * 0.92 / seatSpacing);
      for (let k = 0; k < count; k++) {
        if (Math.random() < 0.18) continue; // 空座
        const along = -s.len * 0.46 + k * seatSpacing + (Math.random() - 0.5) * 0.4;
        const seatOff = s.sign * (s.start + i * STEP_D + STEP_D * 0.72);
        const y = i * STEP_H + STEP_H + 0.42;
        crowdInfo.positions.push(
          s.axis === 'z' ? [along, y, seatOff] : [seatOff, y, along]
        );
        crowdInfo.baseY.push(y);
      }
    }
    // 看台顶棚（近侧 z+ 不加，避免挡住比赛镜头 — 那里是"主转播看台"）
    if (s.axis === 'z' && s.sign > 0) continue;
    const roofLen = s.len + 4;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(s.axis === 'z' ? roofLen : STEP_D * rows + 6, 0.6, s.axis === 'z' ? STEP_D * ROWS + 6 : roofLen),
      new THREE.MeshStandardMaterial({ color: 0x607d8b, roughness: 0.55, metalness: 0.35, emissive: 0x1c262b })
    );
    const roofOff = s.sign * (s.start + rows * STEP_D / 2);
    roof.position.set(
      s.axis === 'z' ? 0 : roofOff,
      rows * STEP_H + 7.5,
      s.axis === 'z' ? roofOff : 0
    );
    standGroup.add(roof);
    // 顶棚立柱
    for (const t of [-0.42, 0.42]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, rows * STEP_H + 7.5, 8), concreteDark);
      const backOff = s.sign * (s.start + rows * STEP_D - 0.5);
      col.position.set(
        s.axis === 'z' ? t * s.len : backOff,
        (rows * STEP_H + 7.5) / 2,
        s.axis === 'z' ? backOff : t * s.len
      );
      standGroup.add(col);
    }
  }
  scene.add(standGroup);

  // 观众 InstancedMesh
  const n = crowdInfo.positions.length;
  const geo = new THREE.CapsuleGeometry(0.26, 0.55, 1, 5);
  const mat = new THREE.MeshLambertMaterial();
  const crowd = new THREE.InstancedMesh(geo, mat, n);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = [0xe53935, 0xe53935, 0x1e88e5, 0x1e88e5, 0xfdd835, 0xffffff, 0x8e24aa, 0x43a047, 0xff7043, 0xeeeeee, 0x3949ab, 0x212121];
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = crowdInfo.positions[i];
    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * 0.6 - 0.3;
    dummy.updateMatrix();
    crowd.setMatrixAt(i, dummy.matrix);
    color.setHex(palette[(Math.random() * palette.length) | 0]);
    color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);
    crowd.setColorAt(i, color);
    phase[i] = Math.random() * Math.PI * 2;
  }
  crowd.instanceMatrix.needsUpdate = true;
  scene.add(crowd);

  // 庆祝时观众跳跃
  const api = {
    mesh: crowd,
    excite: 0, // 0~1
    update(t, dt) {
      if (this.excite <= 0.01) return;
      this.excite = Math.max(0, this.excite - dt * 0.25);
      for (let i = 0; i < n; i += 1) {
        const [x, y, z] = crowdInfo.positions[i];
        dummy.position.set(x, y + Math.max(0, Math.sin(t * 9 + phase[i])) * 0.55 * this.excite, z);
        dummy.rotation.y = 0;
        dummy.updateMatrix();
        crowd.setMatrixAt(i, dummy.matrix);
      }
      crowd.instanceMatrix.needsUpdate = true;
    },
  };
  return api;
}

// ---------- 灯塔 ----------
function makeFloodlights(scene) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a9199, roughness: 0.5, metalness: 0.6 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8d0, emissiveIntensity: 2.2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 30, 8), poleMat);
    pole.position.y = 15;
    grp.add(pole);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5.5, 3.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x333a40 }));
    panel.position.y = 30.5;
    grp.add(panel);
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), bulbMat);
      b.position.set(-1.9 + (i % 4) * 1.27, 29.8 + Math.floor(i / 4) * 1.4, 0.3);
      grp.add(b);
    }
    grp.position.set(sx * 62, 0, sz * 44);
    grp.lookAt(0, 0, 0);
    grp.position.y = 0;
    scene.add(grp);
  }
}

// ---------- 角旗 ----------
function makeCornerFlags(scene) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xffe082 });
  const flagMat = new THREE.MeshBasicMaterial({ color: 0xff5252, side: THREE.DoubleSide });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), poleMat);
    pole.position.set(sx * F.L / 2, 0.8, sz * F.W / 2);
    scene.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.35), flagMat);
    flag.position.set(sx * F.L / 2 - sx * 0.28, 1.42, sz * F.W / 2);
    scene.add(flag);
  }
}

// ---------- 总装 ----------
export function buildStadium(scene) {
  // 光照
  scene.fog = new THREE.Fog(0xc8e0f0, 180, 420);
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x2f5e33, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
  sun.position.set(65, 52, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -75; sun.shadow.camera.right = 75;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 240;
  sun.shadow.bias = -0.0006;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);

  makeSky(scene);

  // 球场
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(F.L, F.W),
    new THREE.MeshStandardMaterial({ map: makePitchTexture(), roughness: 0.95 })
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  scene.add(pitch);

  // 场外草皮
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 110),
    new THREE.MeshStandardMaterial({ map: makeApronTexture(), roughness: 0.95 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  apron.receiveShadow = true;
  scene.add(apron);

  // 球门
  scene.add(makeGoal(1));
  scene.add(makeGoal(-1));

  // 广告牌
  let adIdx = 0;
  const addBoard = (x, z, rotY) => {
    const tex = makeAdTexture(ADS[adIdx % ADS.length], adIdx);
    adIdx++;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(10, 1.1, 0.18),
      [null, null, null, null, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x263238 })]
        .map(m => m || new THREE.MeshStandardMaterial({ color: 0x263238 }))
    );
    board.position.set(x, 0.58, z);
    board.rotation.y = rotY;
    board.castShadow = true;
    scene.add(board);
  };
  for (let i = -4; i <= 4; i++) {
    addBoard(i * 11.5, F.wallZ + 0.6, 0);
    addBoard(i * 11.5, -(F.wallZ + 0.6), Math.PI);
  }
  for (let i = -2; i <= 2; i++) {
    addBoard(F.wallX + 0.9, i * 11.5, -Math.PI / 2);
    addBoard(-(F.wallX + 0.9), i * 11.5, Math.PI / 2);
  }

  makeFloodlights(scene);
  makeCornerFlags(scene);
  const crowd = makeStands(scene);

  return { crowd };
}
