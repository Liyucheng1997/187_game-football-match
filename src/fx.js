import * as THREE from 'three';

// 进球彩带粒子
export class FX {
  constructor(scene) {
    const N = this.N = 500;
    this.pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.colors = new Float32Array(N * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.mat = new THREE.PointsMaterial({
      size: 0.55, vertexColors: true, transparent: true, opacity: 1,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    this.active = false;
  }

  burst(x, y, z) {
    const palette = [[1, 0.3, 0.3], [1, 0.85, 0.2], [0.3, 0.7, 1], [0.4, 1, 0.5], [1, 0.5, 1], [1, 1, 1]];
    for (let i = 0; i < this.N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 6;
      this.pos[i * 3] = x + Math.cos(a) * r * 0.4;
      this.pos[i * 3 + 1] = y + Math.random() * 2;
      this.pos[i * 3 + 2] = z + Math.sin(a) * r * 0.4;
      const sp = 6 + Math.random() * 14;
      this.vel[i * 3] = Math.cos(a) * sp * 0.55;
      this.vel[i * 3 + 1] = 8 + Math.random() * 13;
      this.vel[i * 3 + 2] = Math.sin(a) * sp * 0.55;
      this.life[i] = 2.2 + Math.random() * 1.4;
      const c = palette[(Math.random() * palette.length) | 0];
      this.colors[i * 3] = c[0]; this.colors[i * 3 + 1] = c[1]; this.colors[i * 3 + 2] = c[2];
    }
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.visible = true;
    this.active = true;
    this.mat.opacity = 1;
  }

  update(dt) {
    if (!this.active) return;
    let alive = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 16 * dt;
      // 飘落阻力
      this.vel[i * 3] *= 1 - 1.2 * dt;
      this.vel[i * 3 + 2] *= 1 - 1.2 * dt;
      if (this.vel[i * 3 + 1] < -3.5) this.vel[i * 3 + 1] = -3.5;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] > 0.05) alive++;
      else this.life[i] = 0;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    if (alive === 0) { this.active = false; this.points.visible = false; }
  }
}
