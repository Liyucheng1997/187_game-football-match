import * as THREE from 'three';
import { F } from '../config.js';

const MODES = {
  broadcast: { h: 17, d: 27, fov: 42, lookZ: 0.8, camZ: 0.45 },
  close: { h: 11, d: 17.5, fov: 44, lookZ: 0.85, camZ: 0.55 },
  wide: { h: 30, d: 42, fov: 40, lookZ: 0.7, camZ: 0.35 },
};

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 'broadcast';
    this.special = null;
    this.focus = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, 30, 60);
    this.shakeAmt = 0;
    this.shakeOn = true;
    this.inputYaw = 0;
    this.zoom = 1;
    this.t = 0;
  }

  shake(a) { if (this.shakeOn) this.shakeAmt = Math.max(this.shakeAmt, a); }

  snap() { this.snapNext = true; }

  set(pos, look, k) {
    if (this.snapNext || k >= 1) { this.pos.copy(pos); this.look.copy(look); this.snapNext = false; }
    else { this.pos.lerp(pos, k); this.look.lerp(look, k); }
  }

  update(dt, m) {
    this.t += dt;
    const cam = this.cam;
    const sp = this.special;
    this.inputYaw = 0;
    let fov = MODES[this.mode].fov;

    if (sp && sp.type === 'menu') {
      const a = (sp.orbit === false ? Math.sin(this.t * 0.15) * 0.12 : this.t * 0.07) + (sp.a0 || 0);
      const r = sp.r || 17;
      const p = new THREE.Vector3(Math.cos(a) * r, sp.h || 4.5, Math.sin(a) * r);
      const look = new THREE.Vector3(0, sp.ly || 1.3, 0);
      if (sp.shift) {
        // 让展示球员偏向屏幕右侧，为左侧菜单留出空间
        const fwd = look.clone().sub(p).setY(0).normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        look.addScaledVector(right, -sp.shift);
      }
      this.set(p, look, Math.min(1, dt * 3));
      fov = 40;
    } else if (sp && sp.type === 'intro') {
      const u = Math.min(1, sp.t / sp.dur);
      const e = u * u * (3 - 2 * u);
      const a = -2.2 + e * 1.6;
      const r = 70 - e * 30;
      this.set(new THREE.Vector3(Math.cos(a) * r, 32 - e * 20, Math.sin(a) * r * 0.9 + 10 * e), new THREE.Vector3(0, 2, 0), 1);
      sp.t += dt;
    } else if (sp && sp.type === 'lineup') {
      const u = Math.min(1, sp.t / sp.dur);
      const x = -12 + u * 24;
      this.set(new THREE.Vector3(x, 2.2, 9), new THREE.Vector3(x * 0.9, 1.4, 0), 1);
      fov = 38;
      sp.t += dt;
    } else if (sp && sp.type === 'penalty') {
      const b = m.ball.pos;
      const gx = sp.goalX;
      const dir = Math.sign(gx);
      const tp = new THREE.Vector3(b.x - dir * 7.5, 2.7, b.z * 0.9 + 0.8);
      const tl = new THREE.Vector3(gx, 1.2, 0);
      this.set(tp, tl, Math.min(1, dt * 4));
      const fx = dir, fz = 0;
      this.inputYaw = Math.atan2(-fx, -fz);
      fov = 44;
    } else if (sp && sp.type === 'celebrate') {
      const p = sp.target.pos;
      sp.a = (sp.a ?? Math.atan2(this.pos.z - p.z, this.pos.x - p.x)) + dt * 0.25;
      const tp = new THREE.Vector3(p.x + Math.cos(sp.a) * 7.5, 2.4, p.z + Math.sin(sp.a) * 7.5);
      this.set(tp, new THREE.Vector3(p.x, 1.2, p.z), Math.min(1, dt * 2.5));
      fov = 40;
    } else if (sp && sp.type === 'fixed') {
      this.set(sp.pos, sp.look, sp.snap ? 1 : Math.min(1, dt * 3));
      fov = sp.fov || fov;
    } else if (sp && sp.type === 'setpiece') {
      const b = m.ball.pos;
      const md = MODES[this.mode];
      const tx = THREE.MathUtils.clamp(b.x * 0.85, -F.hl + 10, F.hl - 10);
      this.set(new THREE.Vector3(tx * 0.9, md.h * 0.85, b.z * 0.35 + md.d * 0.85), new THREE.Vector3(tx, 0.5, b.z * md.lookZ), Math.min(1, dt * 3));
    } else {
      // 转播视角
      const md = MODES[this.mode];
      const b = m.ball.pos;
      const bv = m.ball.vel;
      const u = m.focusPlayer ? m.focusPlayer.pos : b;
      const fx = b.x * 0.8 + u.x * 0.2 + THREE.MathUtils.clamp(bv.x * 0.35, -6, 6);
      const fz = b.z * 0.85 + u.z * 0.15;
      this.focus.x += (fx - this.focus.x) * Math.min(1, dt * 2.6);
      this.focus.z += (fz - this.focus.z) * Math.min(1, dt * 2.2);
      const tx = THREE.MathUtils.clamp(this.focus.x, -F.hl + 8, F.hl - 8);
      const tz = THREE.MathUtils.clamp(this.focus.z, -F.hw + 4, F.hw - 4);
      const high = Math.min(1, Math.max(0, b.y - 3) / 10);
      this.zoom += ((1 + high * 0.18) - this.zoom) * Math.min(1, dt * 1.5);
      const h = md.h * this.zoom, d = md.d * this.zoom;
      const tp = new THREE.Vector3(tx * 0.92, h, tz * md.camZ + d);
      const tl = new THREE.Vector3(tx, 0.4, tz * md.lookZ);
      this.set(tp, tl, Math.min(1, dt * 5));
    }

    cam.position.copy(this.pos);
    if (this.shakeAmt > 0.005) {
      this.shakeAmt *= Math.exp(-dt * 7);
      cam.position.x += (Math.random() - 0.5) * this.shakeAmt;
      cam.position.y += (Math.random() - 0.5) * this.shakeAmt * 0.7;
    }
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); }
  }
}
