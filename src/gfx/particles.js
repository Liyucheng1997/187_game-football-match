import * as THREE from 'three';

// 通用 CPU 粒子池（Points + 自定义着色器，逐粒子大小/颜色/透明度）
export class Particles {
  constructor(scene, max = 2000, additive = false, square = false) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.life0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.cursor = 0;
    this.alive = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vC; varying float vA; uniform float uScale;
        void main() {
          vC = color; vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: square ? `
        varying vec3 vC; varying float vA;
        void main() { if (vA <= 0.0) discard; gl_FragColor = vec4(vC, vA); }` : `
        varying vec3 vC; varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5; float r = length(d);
          if (r > 0.5 || vA <= 0.0) discard;
          gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.1, r));
        }`,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, { life = 1, size = 0.3, color = [1, 1, 1], alpha = 1, grav = 9, drag = 0.5 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
    this.size[i] = size; this.alpha[i] = alpha;
    this.life[i] = life; this.life0[i] = life;
    this.grav[i] = grav; this.drag[i] = drag;
    this.alive = Math.max(this.alive, 1);
  }

  update(dt) {
    if (!this.alive) return;
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      n++;
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 2] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.2; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6; }
      const u = this.life[i] / this.life0[i];
      this.alpha[i] = Math.min(1, u * 3) * (this.baseAlpha || 1);
      if (this.life[i] <= 0) this.alpha[i] = 0;
    }
    this.alive = n;
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true; g.alpha.needsUpdate = true; g.color.needsUpdate = true; g.size.needsUpdate = true;
  }
}

// 天气：雨线 / 雪花，跟随相机
export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.kind = 'clear';
    const N = this.N = 5000;
    this.p = new Float32Array(N * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaecbe8, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    const sg = new THREE.BufferGeometry();
    this.sp = new Float32Array(N * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sp, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    scene.add(this.snow);
  }

  set(kind) {
    this.kind = kind;
    this.rain.visible = kind === 'rain';
    this.snow.visible = kind === 'snow';
    const R = 60;
    for (let i = 0; i < this.N; i++) {
      const x = (Math.random() - 0.5) * R * 2, y = Math.random() * 40, z = (Math.random() - 0.5) * R * 2;
      this.p.set([x, y, z, x + 0.1, y + 0.9, z], i * 6);
      this.sp.set([x, y, z], i * 3);
    }
  }

  update(dt, cam) {
    if (this.kind === 'rain') {
      const cx = cam.position.x, cz = cam.position.z - 25;
      for (let i = 0; i < this.N; i++) {
        const o = i * 6;
        let y = this.p[o + 1] - 38 * dt;
        let x = this.p[o], z = this.p[o + 2];
        if (y < 0) { y = 40; x = cx + (Math.random() - 0.5) * 120; z = cz + (Math.random() - 0.5) * 100; }
        this.p[o] = x; this.p[o + 1] = y; this.p[o + 2] = z;
        this.p[o + 3] = x + 0.06; this.p[o + 4] = y + 0.9; this.p[o + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    } else if (this.kind === 'snow') {
      const cx = cam.position.x, cz = cam.position.z - 25;
      const t = performance.now() / 1000;
      for (let i = 0; i < this.N; i++) {
        const o = i * 3;
        let y = this.sp[o + 1] - 2.2 * dt;
        let x = this.sp[o] + Math.sin(t * 0.7 + i) * 0.6 * dt, z = this.sp[o + 2] + Math.cos(t * 0.5 + i * 0.3) * 0.4 * dt;
        if (y < 0) { y = 40; x = cx + (Math.random() - 0.5) * 120; z = cz + (Math.random() - 0.5) * 100; }
        this.sp[o] = x; this.sp[o + 1] = y; this.sp[o + 2] = z;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
  }
}
