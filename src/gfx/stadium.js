import * as THREE from 'three';
import { F } from '../config.js';
import { makePitchTexture, makeLEDTexture, makeCrowdAtlas, makeGlowTexture, canvas, toTex } from './textures.js';

// ================= 光照 / 天气预设 =================
const PRESETS = {
  day: { top: '#2d6fd0', hor: '#c4e0f7', sun: '#fff1d6', sunI: 2.7, sunPos: [55, 75, 42], hemiS: '#d6ebff', hemiG: '#3b6b35', hemiI: 0.9, fog: '#cfe3f3', fogN: 170, fogF: 560, exp: 1.0, bloom: 0.22, stars: 0, lights: 0.2, crowdL: 1.0 },
  sunset: { top: '#23306b', hor: '#ff9b5c', sun: '#ffb27a', sunI: 2.3, sunPos: [-85, 26, 38], hemiS: '#ffc9a8', hemiG: '#384a2c', hemiI: 0.62, fog: '#e59a74', fogN: 150, fogF: 520, exp: 1.08, bloom: 0.45, stars: 0.15, lights: 0.7, crowdL: 0.85 },
  night: { top: '#01030a', hor: '#0e1a34', sun: '#eef3ff', sunI: 2.4, sunPos: [18, 95, 34], hemiS: '#a9bde0', hemiG: '#1c2c1c', hemiI: 0.6, fog: '#0a1122', fogN: 150, fogF: 460, exp: 1.08, bloom: 0.75, stars: 1, lights: 1, crowdL: 0.75 },
};

export class Stadium {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.excite = 0;
    this.hype = new THREE.Vector2(0, 0);
    this.wave = 0;

    this.buildLights();
    this.buildSky();
    this.buildGround();
    this.goals = [this.buildGoal(1), this.buildGoal(-1)];
    this.buildBoards();
    this.buildStands();
    this.buildFloodlights();
    this.buildExtras();
    this.buildCage();
    this.setPreset('day', 'clear');
  }

  // ---------- 光照 ----------
  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x335533, 0.8);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = this.quality !== 'low';
    const sz = this.quality === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sz, sz);
    const c = this.sun.shadow.camera;
    c.left = -62; c.right = 62; c.top = 48; c.bottom = -48; c.near = 10; c.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0xbcd0ff, 0);
    this.fill.position.set(-30, 60, -50);
    this.scene.add(this.fill);
  }

  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color() }, hor: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() },
        stars: { value: 0 }, cloud: { value: 1 },
      },
      vertexShader: `varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vd; uniform vec3 top, hor, sunCol, sunDir; uniform float stars, cloud;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        void main(){
          float y = max(vd.y, 0.0);
          vec3 c = mix(hor, top, pow(y, 0.55));
          float s = max(dot(vd, normalize(sunDir)), 0.0);
          c += sunCol * (pow(s, 300.0) * 3.0 + pow(s, 12.0) * 0.25) * (1.0 - stars);
          if (stars > 0.0) {
            vec3 q = floor(vd * 320.0);
            float st = step(0.9975, h(q)) * smoothstep(0.05, 0.3, vd.y);
            c += vec3(st) * stars * (0.6 + 0.4 * h(q + 1.0));
          }
          if (vd.y < 0.0) c = hor * 0.9;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // 云
    const [cv, g] = canvas(256, 128);
    for (let i = 0; i < 18; i++) {
      const x = 40 + Math.random() * 176, y = 50 + Math.random() * 40, r = 20 + Math.random() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    }
    const ct = toTex(cv);
    this.clouds = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, opacity: 0.75, depthWrite: false, fog: false }));
      const a = Math.random() * Math.PI * 2, r = 320 + Math.random() * 250;
      sp.position.set(Math.cos(a) * r, 90 + Math.random() * 90, Math.sin(a) * r);
      sp.scale.set(180 + Math.random() * 160, 70 + Math.random() * 50, 1);
      this.clouds.add(sp);
    }
    this.scene.add(this.clouds);
  }

  buildGround() {
    this.pitchMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    this.pitch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.pitchMat);
    this.pitch.rotation.x = -Math.PI / 2;
    this.pitch.receiveShadow = true;
    this.group.add(this.pitch);

    // 场外地面（深色塑胶 + 草）
    const [cv, g] = canvas(256, 256);
    g.fillStyle = '#2b5e2e'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) { g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)'; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3); }
    this.apronMat = new THREE.MeshStandardMaterial({ map: toTex(cv, { repeat: [30, 24] }), roughness: 0.95 });
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(220, 170), this.apronMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.03;
    apron.receiveShadow = true;
    this.group.add(apron);
  }

  // ---------- 球门（带可形变球网） ----------
  buildGoal(side) {
    const grp = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.3, metalness: 0.2 });
    const gl = F.hl, hw = F.goalHalfW, H = F.goalH, D = F.goalDepth;
    const cyl = (r, len, x, y, z, rx = 0, rz = 0, mat = white) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), mat);
      m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true;
      grp.add(m);
      return m;
    };
    for (const z of [-hw, hw]) cyl(F.postR, H + F.postR, side * gl, (H + F.postR) / 2, z);
    cyl(F.postR, hw * 2 + F.postR * 2, side * gl, H, 0, Math.PI / 2);
    const frame = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5, metalness: 0.3 });
    for (const z of [-hw, hw]) {
      cyl(0.035, H, side * (gl + D), H / 2, z, 0, 0, frame);
      cyl(0.035, D, side * (gl + D / 2), H, z, 0, Math.PI / 2, frame);
      cyl(0.035, D, side * (gl + D / 2), 0.03, z, 0, Math.PI / 2, frame);
    }
    cyl(0.035, hw * 2, side * (gl + D), H, 0, Math.PI / 2, 0, frame);
    cyl(0.035, hw * 2, side * (gl + D), 0.03, 0, Math.PI / 2, 0, frame);

    // 球网：网格点 + 线段，按面片记录法线方向
    const pts = [], normals = [], idx = [];
    const step = 0.22;
    const addPanel = (nu, nv, fn, nrm) => {
      const base = pts.length / 3;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const p = fn(i / nu, j / nv);
        pts.push(p[0], p[1], p[2]);
        normals.push(nrm[0], nrm[1], nrm[2]);
        const k = base + j * (nu + 1) + i;
        if (i < nu) idx.push(k, k + 1);
        if (j < nv) idx.push(k, k + nu + 1);
      }
    };
    const nz = Math.ceil(hw * 2 / step), ny = Math.ceil(H / step), nx = Math.ceil(D / step);
    addPanel(nz, ny, (u, v) => [side * (gl + D), v * H, -hw + u * hw * 2], [side, 0, 0]);
    for (const s of [-1, 1]) addPanel(nx, ny, (u, v) => [side * (gl + u * D), v * H, s * hw], [0, 0, s]);
    addPanel(nx, nz, (u, v) => [side * (gl + u * D), H, -hw + v * hw * 2], [0, 1, 0]);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(pts);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const net = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    net.frustumCulled = false;
    grp.add(net);
    this.group.add(grp);
    return { side, net, rest: new Float32Array(pts), nrm: new Float32Array(normals), disp: new Float32Array(pts.length / 3), dv: new Float32Array(pts.length / 3), active: 0 };
  }

  netHit(x, y, z, strength) {
    const g = this.goals[x > 0 ? 0 : 1];
    const n = g.disp.length;
    const s = Math.min(1.6, strength * 0.09);
    for (let i = 0; i < n; i++) {
      const dx = g.rest[i * 3] - x, dy = g.rest[i * 3 + 1] - y, dz = g.rest[i * 3 + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 4) g.dv[i] += s * Math.exp(-d2 / 0.45) * 6;
    }
    g.active = 3;
  }

  updateNets(dt) {
    for (const g of this.goals) {
      if (g.active <= 0) continue;
      g.active -= dt;
      const pos = g.net.geometry.attributes.position.array;
      const n = g.disp.length;
      for (let i = 0; i < n; i++) {
        g.dv[i] += (-g.disp[i] * 90 - g.dv[i] * 7) * dt;
        g.disp[i] += g.dv[i] * dt;
        const d = Math.max(-0.1, Math.min(0.9, g.disp[i]));
        pos[i * 3] = g.rest[i * 3] + g.nrm[i * 3] * d;
        pos[i * 3 + 1] = g.rest[i * 3 + 1] + g.nrm[i * 3 + 1] * d;
        pos[i * 3 + 2] = g.rest[i * 3 + 2] + g.nrm[i * 3 + 2] * d;
      }
      g.net.geometry.attributes.position.needsUpdate = true;
    }
  }

  // ---------- LED 广告板 ----------
  buildBoards() {
    this.ledTex = makeLEDTexture();
    const mat = new THREE.MeshStandardMaterial({ map: this.ledTex, emissiveMap: this.ledTex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 });
    this.ledMat = mat;
    const back = new THREE.MeshStandardMaterial({ color: 0x1c2229, roughness: 0.8 });
    const H = 0.95;
    const add = (len, x, z, ry, rep) => {
      const geo = new THREE.BoxGeometry(len, H, 0.25);
      const uv = geo.attributes.uv;
      // 只让正面 (+z 面，索引 4) 采样滚动纹理
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep);
      const m = new THREE.Mesh(geo, [back, back, back, back, mat, back]);
      m.position.set(x, H / 2, z); m.rotation.y = ry;
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    };
    const lx = F.boardX * 2, lz = F.boardZ * 2;
    add(lx, 0, -F.boardZ, 0, 3.2);
    add(lx, 0, F.boardZ, Math.PI, 3.2);
    for (const s of [-1, 1]) {
      const seg = (lz - F.goalHalfW * 2 - 10) / 2;
      add(seg, s * F.boardX, -(F.goalHalfW + 5 + seg / 2), -s * Math.PI / 2, 0.9);
      add(seg, s * F.boardX, (F.goalHalfW + 5 + seg / 2), -s * Math.PI / 2, 0.9);
    }
  }

  // ---------- 看台（圆角碗形，近侧开放给转播机位） ----------
  buildStands() {
    const ax = F.boardX + 4, az = F.boardZ + 4, rc = 12;
    // 基准轮廓：圆角矩形（逆时针），每点带外法线
    const path = [];
    const addArc = (cx, cz, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; path.push({ x: cx + Math.cos(a) * rc, z: cz + Math.sin(a) * rc, nx: Math.cos(a), nz: Math.sin(a) }); } };
    const sx = ax - rc, sz = az - rc;
    const side = (x0, z0, x1, z1, nx, nz, n) => { for (let i = 1; i < n; i++) { const u = i / n; path.push({ x: x0 + (x1 - x0) * u, z: z0 + (z1 - z0) * u, nx, nz }); } };
    addArc(sx, sz, 0, Math.PI / 2, 8);
    side(sx, az, -sx, az, 0, 1, 8);
    addArc(-sx, sz, Math.PI / 2, Math.PI, 8);
    side(-ax, sz, -ax, -sz, -1, 0, 6);
    addArc(-sx, -sz, Math.PI, Math.PI * 1.5, 8);
    side(-sx, -az, sx, -az, 0, -1, 8);
    addArc(sx, -sz, Math.PI * 1.5, Math.PI * 2, 8);
    side(ax, -sz, ax, sz, 1, 0, 6);
    this.standPath = path;

    const posArr = [], colArr = [];
    const crowd = [];
    const seatA = new THREE.Color('#23324d'), seatB = new THREE.Color('#8f1d24'), riser = new THREE.Color('#6b7079'), wall = new THREE.Color('#3a3f47');
    const quad = (a, b, c, d, col) => {
      posArr.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let i = 0; i < 6; i++) colArr.push(col.r, col.g, col.b);
    };
    const P = (pt, d, y) => [pt.x + pt.nx * d, y, pt.z + pt.nz * d];
    const density = this.quality === 'low' ? 1.25 : this.quality === 'medium' ? 0.95 : 0.78;

    const tier = ({ d0, h0, rows, depth, rise, rowsAt, seatCol, withCrowd = true, closed = true }) => {
      const n = path.length;
      let top = [];
      for (let j = 0; j < n; j++) {
        const a = path[j], b = path[(j + 1) % n];
        if (!closed && (j === n - 1)) continue;
        const ra = rowsAt(a), rb = rowsAt(b);
        const rr = Math.min(ra, rb);
        if (rr <= 0) continue;
        for (let i = 0; i < rr; i++) {
          const d = d0 + i * depth, h = h0 + i * rise;
          quad(P(a, d, h), P(b, d, h), P(b, d, h + rise), P(a, d, h + rise), riser);
          const sc = seatCol(j, i);
          quad(P(a, d, h + rise), P(b, d, h + rise), P(b, d + depth, h + rise), P(a, d + depth, h + rise), sc);
          if (withCrowd) {
            const ax2 = P(a, d + depth * 0.55, h + rise), bx2 = P(b, d + depth * 0.55, h + rise);
            const len = Math.hypot(bx2[0] - ax2[0], bx2[2] - ax2[2]);
            const cnt = Math.floor(len / density);
            for (let k = 0; k < cnt; k++) {
              if (Math.random() < 0.1) continue;
              const u = (k + 0.5 + (Math.random() - 0.5) * 0.3) / cnt;
              crowd.push([ax2[0] + (bx2[0] - ax2[0]) * u, h + rise, ax2[2] + (bx2[2] - ax2[2]) * u]);
            }
          }
        }
        // 后墙
        const dT = d0 + rr * depth, hT = h0 + rr * rise;
        quad(P(a, dT, hT), P(b, dT, hT), P(b, dT, hT + 3), P(a, dT, hT + 3), wall);
        quad(P(a, dT, 0), P(b, dT, 0), P(b, dT, hT), P(a, dT, hT), wall);
        // 前挡墙
        quad(P(a, d0, 0), P(b, d0, 0), P(b, d0, h0), P(a, d0, h0), wall);
        top.push([j, rr]);
      }
      return top;
    };

    const nearRows = (pt, full) => pt.nz > 0.7 ? 7 : pt.nz > 0.2 ? Math.round(full * 0.7) : full;
    const lowerRows = 16, lowerDepth = 0.95, lowerRise = 0.52;
    tier({
      d0: 0, h0: 1.1, rows: lowerRows, depth: lowerDepth, rise: lowerRise,
      rowsAt: pt => nearRows(pt, lowerRows),
      seatCol: (j, i) => ((Math.floor(j / 4) + (i > 11 ? 1 : 0)) % 5 === 0 ? seatB : seatA),
    });
    const upD0 = lowerRows * lowerDepth + 3, upH0 = 1.1 + lowerRows * lowerRise + 3.2;
    const upperRows = 13, upDepth = 1.0, upRise = 0.72;
    tier({
      d0: upD0, h0: upH0, rows: upperRows, depth: upDepth, rise: upRise,
      rowsAt: pt => pt.nz > 0.2 ? 0 : upperRows,
      seatCol: (j, i) => ((Math.floor(j / 3) + i) % 7 === 0 ? seatB : seatA),
    });
    // 上层看台下方的支撑体（中层包厢带）
    const n = path.length;
    const boxCol = new THREE.Color('#1b2230');
    for (let j = 0; j < n; j++) {
      const a = path[j], b = path[(j + 1) % n];
      if (a.nz > 0.2 || b.nz > 0.2) continue;
      const hL = 1.1 + lowerRows * lowerRise;
      quad(P(a, upD0, hL), P(b, upD0, hL), P(b, upD0, upH0), P(a, upD0, upH0), boxCol);
      quad(P(a, upD0 - 3, hL), P(b, upD0 - 3, hL), P(b, upD0, hL), P(a, upD0, hL), wall);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    geo.computeVertexNormals();
    this.standMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    const stands = new THREE.Mesh(geo, this.standMat);
    stands.receiveShadow = true;
    this.group.add(stands);

    // 包厢玻璃发光带
    const ribbonGeo = [];
    for (let j = 0; j < n; j++) {
      const a = path[j], b = path[(j + 1) % n];
      if (a.nz > 0.2 || b.nz > 0.2) continue;
      const y0 = 1.1 + lowerRows * lowerRise + 0.8, y1 = upH0 - 0.6;
      const p = [P(a, upD0 - 0.05, y0), P(b, upD0 - 0.05, y0), P(b, upD0 - 0.05, y1), P(a, upD0 - 0.05, y1)];
      ribbonGeo.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(ribbonGeo, 3));
    this.ribbonMat = new THREE.MeshBasicMaterial({ color: 0x9fc8ff, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
    this.group.add(new THREE.Mesh(rg, this.ribbonMat));

    // 顶棚
    const roofPos = [], roofCol = [];
    const roofH = upH0 + upperRows * upRise + 6;
    const inner = upD0 - 6, outer = upD0 + upperRows * upDepth + 1;
    const rTop = new THREE.Color('#aeb6c0'), rUnder = new THREE.Color('#4a525c');
    const rq = (a, b, c, d, col) => { roofPos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) roofCol.push(col.r, col.g, col.b); };
    const lightStrip = [];
    for (let j = 0; j < n; j++) {
      const a = path[j], b = path[(j + 1) % n];
      if (a.nz > 0.2 || b.nz > 0.2) continue;
      rq(P(a, inner, roofH + 1.2), P(b, inner, roofH + 1.2), P(b, outer, roofH), P(a, outer, roofH), rTop);
      rq(P(a, inner, roofH - 1.2), P(b, inner, roofH - 1.2), P(b, inner, roofH + 1.2), P(a, inner, roofH + 1.2), rUnder);
      lightStrip.push(...P(a, inner - 0.05, roofH - 1.0), ...P(b, inner - 0.05, roofH - 1.0), ...P(b, inner - 0.05, roofH - 0.3),
        ...P(a, inner - 0.05, roofH - 1.0), ...P(b, inner - 0.05, roofH - 0.3), ...P(a, inner - 0.05, roofH - 0.3));
      // 支撑柱（每隔几个点）
      if (j % 4 === 0) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, roofH, 8), new THREE.MeshStandardMaterial({ color: 0x7c848e, roughness: 0.6, metalness: 0.4 }));
        const pp = P(a, outer + 0.5, roofH / 2);
        c.position.set(pp[0], pp[1], pp[2]);
        this.group.add(c);
      }
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
    rgeo.setAttribute('color', new THREE.Float32BufferAttribute(roofCol, 3));
    rgeo.computeVertexNormals();
    const roof = new THREE.Mesh(rgeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }));
    roof.castShadow = true;
    this.group.add(roof);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lightStrip, 3));
    this.roofLightMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(lg, this.roofLightMat));
    this.roofH = roofH;

    this.buildCrowd(crowd);
  }

  buildCrowd(list) {
    const n = list.length;
    this.crowdN = n;
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const iPos = new Float32Array(n * 3), iCol = new Float32Array(n * 3), iSkin = new Float32Array(n * 3), iVar = new Float32Array(n * 4);
    const skins = ['#f3cfb3', '#e0ac7e', '#c68e5e', '#8d5a3a', '#5e3b26'].map(c => new THREE.Color(c));
    this.crowdList = list;
    for (let i = 0; i < n; i++) {
      const [x, y, z] = list[i];
      iPos.set([x, y, z], i * 3);
      const s = skins[(Math.random() * skins.length) | 0];
      iSkin.set([s.r, s.g, s.b], i * 3);
      iVar.set([Math.random() * 6.28, (Math.random() * 4) | 0, 0.9 + Math.random() * 0.2, x < 0 ? 1 : 0], i * 4);
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    this.crowdColAttr = new THREE.InstancedBufferAttribute(iCol, 3);
    geo.setAttribute('iCol', this.crowdColAttr);
    geo.setAttribute('iSkin', new THREE.InstancedBufferAttribute(iSkin, 3));
    geo.setAttribute('iVar', new THREE.InstancedBufferAttribute(iVar, 4));
    geo.instanceCount = n;

    this.crowdMat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uAtlas: { value: makeCrowdAtlas() }, uTime: { value: 0 }, uHype: { value: new THREE.Vector2() }, uWave: { value: 0 }, uLight: { value: 1 },
      }]),
      vertexShader: `
        attribute vec3 iPos; attribute vec3 iCol; attribute vec3 iSkin; attribute vec4 iVar;
        uniform float uTime; uniform vec2 uHype; uniform float uWave;
        varying vec2 vUv; varying vec3 vCol; varying vec3 vSkin; varying float vShade;
        #include <fog_pars_vertex>
        void main() {
          float hype = mix(uHype.y, uHype.x, iVar.w);
          float ph = iVar.x;
          float ang = atan(iPos.z, iPos.x);
          float wv = uWave * smoothstep(0.75, 1.0, cos(ang - uTime * 1.3));
          float jump = max(0.0, sin(uTime * 9.0 + ph)) * 0.45 * hype + wv * 0.6;
          float armsUp = step(0.5, hype * (0.55 + 0.45 * sin(uTime * 3.0 + ph * 2.0)) + wv);
          vec3 camR = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          float sc = iVar.z;
          vec3 wp = iPos + camR * position.x * 0.62 * sc + vec3(0.0, position.y * 1.12 * sc + jump - 0.05 + sin(uTime * 1.3 + ph) * 0.02, 0.0);
          float col = iVar.y;
          vUv = vec2((uv.x + col) / 4.0, (uv.y + (armsUp > 0.5 ? 0.0 : 1.0)) / 2.0);
          vCol = iCol; vSkin = iSkin;
          vShade = 0.8 + 0.2 * uv.y;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas; uniform float uLight;
        varying vec2 vUv; varying vec3 vCol; varying vec3 vSkin; varying float vShade;
        #include <fog_pars_fragment>
        void main() {
          vec4 t = texture2D(uAtlas, vUv);
          if (t.a < 0.5) discard;
          vec3 c = t.r * vCol + t.g * vSkin + t.b * vec3(0.12, 0.1, 0.1);
          gl_FragColor = vec4(c * vShade * uLight, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.crowd = new THREE.Mesh(geo, this.crowdMat);
    this.crowd.frustumCulled = false;
    this.group.add(this.crowd);
    this.setCrowdColors('#d62828', '#ffffff', '#1d4ed8', '#93c5fd');
  }

  setCrowdColors(homeP, homeS, awayP, awayS) {
    const arr = this.crowdColAttr.array;
    const hp = new THREE.Color(homeP), hs = new THREE.Color(homeS), ap = new THREE.Color(awayP), as = new THREE.Color(awayS);
    const rnd = new THREE.Color();
    for (let i = 0; i < this.crowdN; i++) {
      const [x] = this.crowdList[i];
      const home = x < 0 ? Math.random() < 0.8 : Math.random() < 0.3;
      const r = Math.random();
      let c;
      if (r < 0.62) c = home ? hp : ap;
      else if (r < 0.8) c = home ? hs : as;
      else c = rnd.setHSL(Math.random(), 0.3 + Math.random() * 0.4, 0.25 + Math.random() * 0.5);
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
      this.crowd.geometry.attributes.iVar.array[i * 4 + 3] = home ? 1 : 0;
    }
    this.crowdColAttr.needsUpdate = true;
    this.crowd.geometry.attributes.iVar.needsUpdate = true;
  }

  // ---------- 灯塔 ----------
  buildFloodlights() {
    this.glows = [];
    const glowTex = makeGlowTexture('rgba(255,250,230,1)');
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a9199, roughness: 0.5, metalness: 0.6 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6dd, emissiveIntensity: 1 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const grp = new THREE.Group();
      const H = 52;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, H, 10), poleMat);
      pole.position.y = H / 2;
      grp.add(pole);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.6), new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.6 }));
      panel.position.set(0, H + 1.5, 0.4);
      panel.rotation.x = 0.35;
      grp.add(panel);
      for (let i = 0; i < 12; i++) {
        const b = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12), this.lampMat);
        b.position.set(-3.3 + (i % 4) * 2.2, H + 0.3 + Math.floor(i / 4) * 1.5, 0.75 + Math.floor(i / 4) * -0.5);
        b.rotation.x = 0.35;
        grp.add(b);
      }
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      glow.position.set(0, H + 1.8, 2);
      glow.scale.set(30, 30, 1);
      grp.add(glow);
      this.glows.push(glow);
      grp.position.set(sx * 78, 0, sz * 58);
      grp.lookAt(0, 0, 0);
      this.group.add(grp);
    }
  }

  // ---------- 大屏 / 替补席 / 角旗 ----------
  buildExtras() {
    const [cv, g] = canvas(1024, 384);
    this.jumboCv = cv; this.jumboCtx = g;
    this.jumboTex = toTex(cv);
    const scrMat = new THREE.MeshBasicMaterial({ map: this.jumboTex, toneMapped: false });
    this.jumbos = [];
    for (const s of [-1, 1]) {
      const grp = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 1), new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6 }));
      grp.add(frame);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(20.6, 7.7), scrMat);
      scr.position.z = 0.52;
      grp.add(scr);
      grp.position.set(s * (F.boardX + 30), this.roofH + 6, 0);
      grp.rotation.y = -s * Math.PI / 2;
      this.group.add(grp);
      this.jumbos.push(grp);
    }
    this.setJumbo('热血绿茵', '', 'BLAZING PITCH');

    // 替补席（远侧）
    const dugMat = new THREE.MeshStandardMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.35, roughness: 0.1 });
    const benchMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.7 });
    for (const s of [-1, 1]) {
      const grp = new THREE.Group();
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 8, 16, 1, true, -Math.PI / 2, Math.PI), dugMat);
      roof.rotation.z = Math.PI / 2; roof.position.y = 1.0;
      grp.add(roof);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.5, 0.6), benchMat);
      bench.position.set(0, 0.25, -0.5);
      grp.add(bench);
      grp.position.set(s * 12, 0, -(F.boardZ + 1.8));
      this.group.add(grp);
    }

    // 角旗
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xfff4c2 });
    this.flags = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), poleMat);
      pole.position.set(sx * F.hl, 0.8, sz * F.hw);
      pole.castShadow = true;
      this.group.add(pole);
      const fg = new THREE.PlaneGeometry(0.5, 0.34, 6, 1);
      fg.translate(0.25, 0, 0);
      const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: 0xff4d4d, side: THREE.DoubleSide }));
      flag.position.set(sx * F.hl, 1.42, sz * F.hw);
      this.group.add(flag);
      this.flags.push(flag);
    }
  }

  setJumbo(line1, line2, line3 = '', colA = '#d62828', colB = '#1d4ed8') {
    const g = this.jumboCtx, W = 1024, H = 384;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#0b1020'); gr.addColorStop(1, '#141c33');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = colA; g.fillRect(0, 0, W / 2, 10);
    g.fillStyle = colB; g.fillRect(W / 2, 0, W / 2, 10);
    g.fillStyle = '#fff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 120px "Arial Black", "Microsoft YaHei", sans-serif';
    g.fillText(line1, W / 2, 150);
    g.font = 'bold 56px "Microsoft YaHei", "PingFang SC", sans-serif';
    g.fillStyle = '#ffd23f';
    g.fillText(line2, W / 2, 270);
    g.fillStyle = '#9fb3d9';
    g.font = 'bold 40px "Microsoft YaHei", sans-serif';
    g.fillText(line3, W / 2, 340);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    this.jumboTex.needsUpdate = true;
  }

  // ---------- 笼式挡板 ----------
  buildCage() {
    this.cage = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const frame = new THREE.MeshStandardMaterial({ color: 0x20252b, roughness: 0.5, metalness: 0.5 });
    const H = 3.2;
    const wz = F.hw + 1.4, wx = F.hl + 1.6;
    const wallAt = (len, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), glass);
      m.position.set(x, H / 2, z); m.rotation.y = ry;
      this.cage.add(m);
      const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), frame);
      top.position.set(x, H, z); top.rotation.y = ry;
      this.cage.add(top);
      const bot = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.14), frame);
      bot.position.set(x, 0.25, z); bot.rotation.y = ry;
      this.cage.add(bot);
    };
    wallAt(wx * 2, 0, -wz, 0);
    wallAt(wx * 2, 0, wz, 0);
    for (const s of [-1, 1]) {
      const seg = wz - F.goalHalfW - 0.2;
      wallAt(seg, s * wx, -(F.goalHalfW + 0.2 + seg / 2), Math.PI / 2);
      wallAt(seg, s * wx, (F.goalHalfW + 0.2 + seg / 2), Math.PI / 2);
    }
    for (let i = -12; i <= 12; i++) for (const z of [-wz, wz]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, H, 0.1), frame);
      p.position.set(i * wx / 12, H / 2, z);
      this.cage.add(p);
    }
    this.cage.visible = false;
    this.group.add(this.cage);
  }

  setCage(on) { this.cage.visible = on; }

  setPreset(time, weather) {
    const P = { ...PRESETS[time] };
    this.presetKey = time; this.weather = weather;
    const grey = new THREE.Color(time === 'night' ? '#1a2030' : weather === 'snow' ? '#dfe6ee' : '#9aa5b1');
    const top = new THREE.Color(P.top), hor = new THREE.Color(P.hor), fog = new THREE.Color(P.fog);
    let sunI = P.sunI, hemiI = P.hemiI;
    if (weather !== 'clear') {
      top.lerp(grey, 0.75); hor.lerp(grey, 0.7); fog.lerp(grey, 0.6);
      if (time !== 'night') { sunI *= weather === 'snow' ? 0.6 : 0.55; hemiI *= 1.6; P.exp += 0.1; }
      P.fogN *= 0.6; P.fogF *= 0.55;
    }
    this.skyMat.uniforms.top.value.copy(top);
    this.skyMat.uniforms.hor.value.copy(hor);
    this.skyMat.uniforms.sunCol.value.set(P.sun);
    this.skyMat.uniforms.sunDir.value.set(...P.sunPos).normalize();
    this.skyMat.uniforms.stars.value = weather === 'clear' ? P.stars : 0;
    this.clouds.visible = time !== 'night';
    this.clouds.children.forEach(c => { c.material.color.set(time === 'sunset' ? '#ffc6a0' : weather !== 'clear' ? '#a9b2bc' : '#ffffff'); c.material.opacity = weather !== 'clear' ? 0.95 : 0.7; });
    this.scene.fog = new THREE.Fog(fog, P.fogN, P.fogF);
    this.sun.color.set(P.sun);
    this.sun.intensity = sunI;
    this.sun.position.set(...P.sunPos);
    this.hemi.color.set(P.hemiS);
    this.hemi.groundColor.set(P.hemiG);
    this.hemi.intensity = hemiI;
    this.fill.intensity = time === 'night' ? 0.9 : 0;
    this.exposure = P.exp;
    this.bloom = P.bloom;
    this.crowdMat.uniforms.uLight.value = P.crowdL * (weather !== 'clear' && time !== 'night' ? 0.85 : 1);
    const lights = P.lights;
    this.lampMat.emissiveIntensity = 0.3 + lights * 3.5;
    for (const g of this.glows) { g.visible = lights > 0.5; g.material.opacity = lights; }
    this.roofLightMat.color.setScalar(0.4 + lights * 1.6);
    this.ribbonMat.opacity = 0.3 + lights * 0.4;
    this.ledMat.emissiveIntensity = 0.35 + lights * 0.9;

    const { tex, size } = makePitchTexture(weather, time === 'night' ? 'checker' : 'stripes');
    if (this.pitchMat.map) this.pitchMat.map.dispose();
    this.pitchMat.map = tex;
    this.pitchMat.roughness = weather === 'rain' ? 0.55 : 0.92;
    this.pitchMat.color.set(time === 'night' ? '#e6f0e6' : '#ffffff');
    this.pitchMat.needsUpdate = true;
    this.pitch.scale.set(size[0], size[1], 1);
    this.apronMat.color.set(weather === 'snow' ? '#c9d6c9' : '#ffffff');
  }

  update(dt, t) {
    this.time = t;
    this.ledTex.offset.x = (t * 0.03) % 1;
    const u = this.crowdMat.uniforms;
    u.uTime.value = t;
    u.uHype.value.set(this.hype.x, this.hype.y);
    u.uWave.value = this.wave;
    this.hype.x = Math.max(0, this.hype.x - dt * 0.18);
    this.hype.y = Math.max(0, this.hype.y - dt * 0.18);
    this.updateNets(dt);
    for (let i = 0; i < this.flags.length; i++) {
      const f = this.flags[i];
      f.rotation.y = Math.sin(t * 2.3 + i) * 0.35;
    }
  }
}
