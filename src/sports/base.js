import * as THREE from 'three';
import { DIFFS, DEVICE_COLORS } from '../config.js';

const $ = id => document.getElementById(id);

// 三个新运动的公共骨架：队伍 / 真人玩家 / 头顶标签 / 开场 / 结算
export class SportBase {
  constructor(ctx) {
    Object.assign(this, ctx); // scene, stadium, arena, audio, input, hud, fx, cam, save
    this.state = 'idle';
    this.time = 0;
    this.teams = []; this.athletes = []; this.humans = [];
    this.timeScale = 1; this.slowT = 0;
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.objects = [];             // 本场比赛创建的额外 3D 对象（球、标记等），clear 时移除
  }

  get settings() { return this.save.s; }

  begin(cfg, sport) {
    this.clear();
    this.cfg = cfg; this.sport = sport;
    this.diff = DIFFS[cfg.diff] || DIFFS.normal;
    this.skill = { easy: 0.15, normal: 0.45, hard: 0.75, legend: 1 }[this.diff.key] ?? 0.45;
    const mk = (idx, data) => ({ idx, data, kit: data.kit, score: 0, humans: [], stats: {} });
    this.teams = [mk(0, cfg.teamA), mk(1, cfg.teamB)];
    const [a, b] = this.teams;
    if (colorDist(a.kit.primary, b.kit.primary) < 0.25) {
      const k = b.data.kit;
      b.kit = { primary: k.secondary, secondary: k.primary, pattern: k.pattern, shorts: k.primary, socks: k.secondary };
      if (colorDist(b.kit.primary, a.kit.primary) < 0.25) b.kit = { primary: '#f5f5f5', secondary: '#222222', pattern: 'solid', shorts: '#222222', socks: '#f5f5f5' };
    }
    this.C = this.arena.show(sport, { colors: [a.kit.primary, b.kit.primary], time: cfg.time || 'night' });
    this.humans = [];
    cfg.humans.forEach((h, i) => {
      const dev = this.input.get(h.device);
      if (!dev) return;
      const hc = { dev, team: h.team, slot: i, color: DEVICE_COLORS[i % DEVICE_COLORS.length], athlete: null, bar: null, charge: null };
      hc.ring = this.fx.ring(hc.color);
      hc.tag = document.createElement('div');
      hc.tag.className = 'ptag';
      hc.tag.innerHTML = '<div class="pname"></div><div class="pbar"><i></i></div><div class="pcharge hidden"><i></i><b></b></div>';
      hc.tag.style.setProperty('--c', hc.color);
      $('tags').appendChild(hc.tag);
      this.teams[h.team].humans.push(hc);
      this.humans.push(hc);
    });
    this.hud.m = this;
    this.hud.root.classList.add('sport');
    $('spBoard').classList.remove('hidden');
    $('commentary').innerHTML = '';
    this.hud.replayTag(false);
    this.hint(null);
    this.resultShown = false;
    this.time = 0; this.timeScale = 1; this.slowT = 0;
    this.cam.shakeOn = this.settings.shake;
    this.audio.setExcitement(0.3);
  }

  add(obj) { this.scene.add(obj); this.objects.push(obj); return obj; }

  clear() {
    for (const a of this.athletes) a.dispose();
    for (const h of this.humans) {
      h.tag.remove();
      this.scene.remove(h.ring);
      h.ring.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    for (const o of this.objects) {
      this.scene.remove(o);
      o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } });
    }
    this.objects = []; this.athletes = []; this.teams = []; this.humans = [];
    this.state = 'idle';
    this.cam.special = null;
    this.arena.hide();
    this.hud.root.classList.remove('sport');
    $('spBoard').classList.add('hidden');
    $('spBoard').innerHTML = '';
    this.hint(null);
    this.hud.vsCard(null);
  }

  anyPressed(actions = ['pass', 'shoot', 'pause', 'confirm']) {
    for (const d of this.input.list()) for (const a of actions) if (d.pressed(a)) return true;
    return false;
  }

  hint(html) {
    const h = $('spHint');
    if (!html) { h.classList.add('hidden'); return; }
    h.innerHTML = html; h.classList.remove('hidden');
  }

  board(html) { if (this._board !== html) { this._board = html; $('spBoard').innerHTML = html; } }

  slow(scale, dur) { this.timeScale = scale; this.slowT = dur; }

  setCam(pos, look, fov = 40, k = 4, snap = false) {
    this.camPos.copy(pos); this.camLook.copy(look);
    if (!this.cam.special || this.cam.special.type !== 'fixed') this.cam.special = { type: 'fixed', pos: this.camPos, look: this.camLook };
    this.cam.special.fov = fov; this.cam.special.k = k; this.cam.special.snap = snap;
  }

  // ---------- 开场 ----------
  startIntro(center = new THREE.Vector3(0, 1, 0), r = 14) {
    this.state = 'intro';
    this.introT = 0;
    this.introC = center; this.introR = r;
    this.hud.vsCard(this.teams[0].data, this.teams[1].data, this.cfg.title);
    this.audio.cheer(false);
    this.arena.cheer(0.6);
  }

  updIntro(dt) {
    this.introT += dt;
    const a = 1.9 - this.introT * 0.28;
    this.setCam(this._v.set(Math.cos(a) * this.introR, 3.2 + this.introT * 0.5, Math.sin(a) * this.introR).add(this.introC), this.introC, 40, 4, this.introT < 0.1);
    for (const p of this.athletes) { p.move.set(0, 0, 0); p.update(dt, this.time); }
    if (this.introT > 3.4 || (this.introT > 0.7 && this.anyPressed())) {
      this.hud.vsCard(null);
      return true;
    }
    return false;
  }

  // 每帧公共收尾
  tail(dt, rawDt) {
    this.arena.update(dt, this.time);
    this.fx.update(dt);
    this.audio.update(rawDt, true);
    this.cam.update(rawDt, this);
    const W = window.innerWidth, H = window.innerHeight;
    const live = this.state !== 'intro' && this.state !== 'done';
    for (const h of this.humans) {
      const p = h.athlete;
      h.ring.visible = !!p && live;
      h.tag.classList.toggle('hidden', !p || !live);
      if (!p) continue;
      h.ring.position.set(p.pos.x, 0.04, p.pos.z);
      h.ring.rotation.y = Math.atan2(p.facing.x, p.facing.z);
      const v = this._v.set(p.pos.x, p.pos.y + 2.3, p.pos.z).project(this.cam.cam);
      if (v.z > 1) { h.tag.classList.add('hidden'); continue; }
      h.tag.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
      const nm = `P${h.slot + 1} ${p.name}`;
      if (h._nm !== nm) { h._nm = nm; h.tag.querySelector('.pname').textContent = nm; }
      const bar = h.tag.querySelector('.pbar');
      bar.classList.toggle('hidden', h.bar === null);
      if (h.bar !== null) bar.firstChild.style.width = h.bar + '%';
      const ch = h.tag.querySelector('.pcharge');
      ch.classList.toggle('hidden', !h.charge);
      if (h.charge) {
        ch.querySelector('i').style.width = Math.min(1, h.charge.v) * 100 + '%';
        ch.querySelector('i').classList.toggle('over', h.charge.v > (h.charge.hi ?? 2));
        const b = ch.querySelector('b');
        b.style.display = h.charge.lo === undefined ? 'none' : '';
        if (h.charge.lo !== undefined) { b.style.left = h.charge.lo * 100 + '%'; b.style.width = (h.charge.hi - h.charge.lo) * 100 + '%'; }
      }
    }
  }

  // ---------- 结束 ----------
  finish(winner, extra) {
    this.state = 'done';
    this.doneT = 0;
    this.hint(null);
    const res = {
      sport: this.sport, winner, cfg: this.cfg,
      teams: this.teams.map(t => ({ name: t.data.name, abbr: t.data.abbr, kit: t.kit, score: t.score, human: t.humans.length > 0 })),
      scoreA: this.teams[0].score, scoreB: this.teams[1].score,
      ...extra,
    };
    this.result = res;
    const wt = winner >= 0 ? this.teams[winner] : null;
    if (wt) {
      this.fx.confetti(0, 6, 0, [wt.kit.primary, wt.kit.secondary], 700);
      this.audio.cheer(true); this.arena.cheer(1);
    }
    this.audio.whistle('end');
    for (const p of this.athletes) {
      p.manualY = false;
      if (wt && p.team === winner) p.play('celebrate', 30, { style: Math.random() < 0.5 ? 1 : 0, lock: true });
      else if (wt) p.play('sad', 30, { lock: true });
    }
    this.celebTarget = this.athletes.find(p => p.team === (winner >= 0 ? winner : 0));
  }

  updDone(dt) {
    this.doneT += dt;
    for (const p of this.athletes) { p.move.set(0, 0, 0); p.faceLock = null; p.update(dt, this.time); }
    const p = this.celebTarget;
    if (p) {
      const a = this.doneT * 0.3 + 1.2;
      this.setCam(this._v.set(p.pos.x + Math.cos(a) * 6.5, 2.4, p.pos.z + Math.sin(a) * 6.5), new THREE.Vector3(p.pos.x, 1.2, p.pos.z), 40, 2.5);
    }
    if (this.doneT > 2.4 && !this.resultShown) { this.resultShown = true; this.onEnd && this.onEnd(this.result); }
  }
}

export function colorDist(a, b) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return Math.hypot(ca.r - cb.r, ca.g - cb.g, ca.b - cb.b);
}

export function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// 圆形接触阴影
let blobTex = null;
export function makeBlob(size = 0.5) {
  if (!blobTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(cv);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: blobTex.clone(), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02; m.renderOrder = 2;
  return m;
}

// 简易拖尾
export class Trail {
  constructor(n = 20, color = 0xffffff) {
    this.n = n;
    this.arr = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.arr, 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.line.frustumCulled = false;
  }
  reset(p) { for (let i = 0; i < this.n; i++) { this.arr[i * 3] = p.x; this.arr[i * 3 + 1] = p.y; this.arr[i * 3 + 2] = p.z; } }
  push(p, strength) {
    this.arr.copyWithin(3, 0, (this.n - 1) * 3);
    this.arr[0] = p.x; this.arr[1] = p.y; this.arr[2] = p.z;
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.material.opacity += (strength - this.line.material.opacity) * 0.2;
  }
}
