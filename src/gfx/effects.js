import * as THREE from 'three';
import { Particles } from './particles.js';

// 高层特效：草屑、彩带、火焰、火花、脚下光圈、定位球瞄准箭头
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.add = new Particles(scene, 2400, true);
    this.norm = new Particles(scene, 3000, false, true);
    this.rings = [];
    this.arrow = this.makeArrow();
  }

  grass(x, z, dir, n = 12) {
    for (let i = 0; i < n; i++) {
      const s = 2 + Math.random() * 4;
      this.norm.emit(x, 0.05, z, dir.x * s + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 3, dir.z * s + (Math.random() - 0.5) * 3,
        { life: 0.6 + Math.random() * 0.5, size: 0.07 + Math.random() * 0.05, color: [0.18 + Math.random() * 0.1, 0.45 + Math.random() * 0.15, 0.12], grav: 12, drag: 1.5 });
    }
  }

  kickPuff(x, z, n = 6) {
    for (let i = 0; i < n; i++) {
      this.norm.emit(x, 0.05, z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3,
        { life: 0.4, size: 0.05, color: [0.25, 0.5, 0.15], grav: 10, drag: 2 });
    }
  }

  confetti(x, y, z, colors, n = 500) {
    const cols = colors.map(c => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; });
    cols.push([1, 1, 1], [1, 0.85, 0.2]);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 10;
      this.norm.emit(x + (Math.random() - 0.5) * 3, y + Math.random() * 2, z + (Math.random() - 0.5) * 3,
        Math.cos(a) * s * 0.6, 7 + Math.random() * 11, Math.sin(a) * s * 0.6,
        { life: 3 + Math.random() * 2, size: 0.12 + Math.random() * 0.08, color: cols[(Math.random() * cols.length) | 0], grav: 5, drag: 1.4 });
    }
  }

  fireTrail(p, v) {
    for (let i = 0; i < 4; i++) {
      const c = Math.random();
      this.add.emit(p.x + (Math.random() - 0.5) * 0.3, p.y + (Math.random() - 0.5) * 0.3, p.z + (Math.random() - 0.5) * 0.3,
        -v.x * 0.05 + (Math.random() - 0.5), 1 + Math.random() * 1.5, -v.z * 0.05 + (Math.random() - 0.5),
        { life: 0.35 + Math.random() * 0.25, size: 0.5 + Math.random() * 0.5, color: [1, 0.35 + c * 0.45, 0.05 + c * 0.1], grav: -2, drag: 2 });
    }
  }

  sparks(x, y, z, n = 25) {
    for (let i = 0; i < n; i++) {
      this.add.emit(x, y, z, (Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9,
        { life: 0.3 + Math.random() * 0.3, size: 0.12, color: [1, 0.9, 0.6], grav: 12, drag: 1 });
    }
  }

  burst(x, y, z, color = [1, 0.7, 0.2], n = 60) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2, s = 4 + Math.random() * 8;
      this.add.emit(x, y, z, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s + 2, Math.sin(a) * Math.cos(b) * s,
        { life: 0.5 + Math.random() * 0.4, size: 0.35, color, grav: 3, drag: 2 });
    }
  }

  makeArrow() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.18, 0); shape.lineTo(0.18, 0); shape.lineTo(0.18, 2.2); shape.lineTo(0.45, 2.2); shape.lineTo(0, 3); shape.lineTo(-0.45, 2.2); shape.lineTo(-0.18, 2.2);
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.75, depthWrite: false }));
    m.visible = false;
    m.renderOrder = 3;
    this.scene.add(m);
    return m;
  }

  showArrow(pos, dir, color = 0xffe066) {
    const a = this.arrow;
    a.visible = true;
    a.material.color.set(color);
    a.position.set(pos.x, 0.05, pos.z);
    a.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
  }
  hideArrow() { this.arrow.visible = false; }

  ring(color) {
    const g = new THREE.Group();
    const r = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    r.rotation.x = -Math.PI / 2;
    g.add(r);
    const tri = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.36, 3), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    tri.rotation.x = Math.PI / 2;
    tri.position.set(0, 0, 1.0);
    g.add(tri);
    g.renderOrder = 3;
    this.scene.add(g);
    return g;
  }

  update(dt) { this.add.update(dt); this.norm.update(dt); }
}
