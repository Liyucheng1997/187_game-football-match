import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import './style.css';

import { Input } from './core/input.js';
import { Save } from './core/save.js';
import { AudioFX } from './core/audio.js';
import { recordCupMatch } from './core/career.js';
import { Stadium } from './gfx/stadium.js';
import { Effects } from './gfx/effects.js';
import { Weather } from './gfx/particles.js';
import { PlayerModel, J, NJ } from './gfx/player-model.js';
import { makeBallMaterial } from './game/ball.js';
import { Match } from './game/match.js';
import { CameraRig } from './game/camera.js';
import { HUD } from './ui/hud.js';
import { UI } from './ui/menus.js';
import { TEAMS, clubTeam, BALLS, CUPS } from './data/teams.js';
import { DIFFS } from './config.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ================= 渲染器 =================
const save = new Save();
const quality = params.get('q') || save.s.quality;
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('autotest') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1500);

const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.3, 0.55, 0.86);
bloom.enabled = quality !== 'low';
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}
window.addEventListener('resize', resize);

// ================= 世界 =================
const input = new Input();
const audio = new AudioFX();
const stadium = new Stadium(scene, quality);
const fx = new Effects(scene);
const weather = new Weather(scene);
const cam = new CameraRig(camera);
const hud = new HUD(camera);
const match = new Match({ scene, stadium, audio, input, hud, fx, cam, save });
match.showBall(false);

// ================= 菜单展示：球员阵容 + 颠球 =================
class Showcase {
  constructor() {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.models = [];
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 20), makeBallMaterial(BALLS[0]));
    this.ball.castShadow = true;
    this.group.add(this.ball);
    this.key = '';
  }
  set(teams) {
    const key = teams.map(t => t.id + JSON.stringify(t.kit)).join('|');
    if (key === this.key) return;
    this.key = key;
    for (const m of this.models) this.group.remove(m.root);
    this.models = [];
    teams.forEach((t, ti) => {
      for (let i = 0; i < 5; i++) {
        const isGK = i === 0;
        const kit = isGK ? { primary: '#f5b700', secondary: '#1a1a1a', pattern: 'solid', shorts: '#1a1a1a', socks: '#f5b700' } : t.kit;
        const m = new PlayerModel({ kit, number: [1, 4, 7, 8, 9][i], name: t.players[i], isKeeper: isGK, seed: hashStr(t.id + i + t.players[i]) });
        const n = teams.length;
        const order = [4, 2, 0, 1, 3][i];
        const off = (order - 2) * 1.35;
        if (n === 1) m.root.position.set(off, 0, -Math.abs(order - 2) * 0.7);
        else m.root.position.set((ti === 0 ? -1 : 1) * (2.2 + order * 1.25), 0, -order * 0.35);
        m.root.rotation.y = n === 1 ? -off * 0.06 : (ti === 0 ? 0.35 : -0.35);
        m.phase = Math.random() * 6;
        m.juggler = n === 1 ? i === 4 : false;
        this.group.add(m.root);
        this.models.push(m);
      }
    });
    this.ball.visible = teams.length === 1;
    const ballDesign = BALLS.find(b => b.id === save.data.ball) || BALLS[0];
    const u = this.ball.material.userData.uniforms;
    u.uPent.value.set(ballDesign.pent); u.uHex.value.set(ballDesign.hex); u.uSeam.value.set(ballDesign.seam);
  }
  update(dt, t) {
    for (const m of this.models) {
      const T = m.target; T.fill(0);
      const b = Math.sin(t * 2 + m.phase) * 0.02;
      const s = (j, x, y = 0, z = 0) => { T[j * 3] = x; T[j * 3 + 1] = y; T[j * 3 + 2] = z; };
      s(J.spine, 0.02 + b); s(J.head, -0.05 + Math.sin(t * 0.7 + m.phase) * 0.08, Math.sin(t * 0.5 + m.phase) * 0.3);
      s(J.lSh, 0.05, 0, 0.12); s(J.rSh, 0.05, 0, -0.12); s(J.lEl, -0.2); s(J.rEl, -0.2);
      s(J.lHip, -0.02, 0.12, 0.08); s(J.rHip, -0.02, -0.12, -0.08); s(J.lKnee, 0.06); s(J.rKnee, 0.06);
      if (!m.juggler && Math.sin(t * 0.3 + m.phase * 3) > 0.7) { s(J.lSh, -0.3, 0, 0.4); s(J.lEl, -2.2); s(J.rSh, -0.3, 0, -0.4); s(J.rEl, -2.2); }
      if (m.juggler) {
        const ph = t * 4.2;
        const up = Math.max(0, Math.cos(ph));
        const foot = Math.floor(ph / (Math.PI * 2)) % 2;
        s(foot ? J.rHip : J.lHip, -0.75 * up, 0, 0); s(foot ? J.rKnee : J.lKnee, 0.5 * up);
        s(J.lSh, 0, 0, 0.5); s(J.rSh, 0, 0, -0.5); s(J.spine, 0.12); s(J.head, 0.35);
        const p = m.root.position;
        const fwd = new THREE.Vector3(Math.sin(m.root.rotation.y), 0, Math.cos(m.root.rotation.y));
        this.ball.position.set(p.x + fwd.x * 0.45 + (foot ? -0.1 : 0.1), 0.35 + Math.abs(Math.sin(ph / 2)) * 1.0, p.z + fwd.z * 0.45);
        this.ball.rotation.x += dt * 5;
      }
      m.apply(dt, 8);
    }
  }
  show(v) { this.group.visible = v; }
}
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const showcase = new Showcase();
const menuLight = new THREE.DirectionalLight(0xfff4e0, 1.6);
menuLight.position.set(4, 6, 12);
scene.add(menuLight);

// ================= 应用 =================
const app = {
  input, save, audio, match,
  inMatch: false,
  paused: false,

  applySettings() {
    const s = save.s;
    audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx, crowd: s.crowd });
    cam.mode = s.camera;
    cam.shakeOn = s.shake;
  },

  showcase(teams) { showcase.set(teams); },

  onScreen(name) {
    if (this.inMatch) return;
    audio.music(true);
    const club = clubTeam(save.data.club);
    if (name === 'quick' || name === 'controllers') {
      const T = [club, ...TEAMS];
      const q = ui.q;
      showcase.set(q.mode === 'cup' && ui.cupTeams ? [ui.cupTeams.a, ui.cupTeams.b] : [T[q.a], T[q.b]]);
      cam.special = { type: 'menu', r: 14, h: 2.6, a0: Math.PI / 2, orbit: false, ly: 3.2 };
    } else {
      showcase.set([name === 'title' ? TEAMS[0] : club]);
      cam.special = name === 'title' ? { type: 'menu', r: 24, h: 7, a0: 1.2 }
        : name === 'club' ? { type: 'menu', r: 8, h: 1.9, a0: Math.PI / 2, orbit: false, shift: -2.6, ly: 1.1 }
        : { type: 'menu', r: 9, h: 2.2, a0: Math.PI / 2 - 0.15, orbit: false, shift: 3.4, ly: 1.2 };
    }
  },

  startMatch(cfg) {
    this.lastCfg = cfg;
    menuLight.visible = false;
    audio.init();
    audio.music(false);
    ui.hide();
    showcase.show(false);
    hud.show(true);
    this.inMatch = true;
    this.paused = false;
    weather.set(cfg.weather);
    match.onEnd = res => this.onMatchEnd(res);
    match.setup(cfg);
    bloom.strength = stadium.bloom;
    renderer.toneMappingExposure = stadium.exposure;
  },

  restartMatch() { this.paused = false; this.startMatch(this.lastCfg); },

  quitMatch() {
    ui.closeOverlay();
    const cfg = this.lastCfg;
    if (cfg.mode === 'cup' && match.state !== 'done') {
      recordCupMatch(save, { scoreA: 0, scoreB: 3, winner: 1 });
    }
    this.toMenu(cfg.mode === 'cup' ? 'cup' : 'main');
  },

  toMenu(screen = 'main') {
    this.inMatch = false;
    this.paused = false;
    match.clear();
    hud.show(false);
    weather.set('clear');
    stadium.setPreset('night', 'clear');
    stadium.setCage(false);
    bloom.strength = stadium.bloom;
    renderer.toneMappingExposure = stadium.exposure;
    showcase.show(true);
    menuLight.visible = true;
    ui.reset('main');
    if (screen !== 'main') ui.go(screen);
  },

  togglePause() {
    if (!this.inMatch || match.state === 'done') return;
    this.paused = !this.paused;
    if (this.paused) ui.pauseMenu(); else ui.closeOverlay();
  },

  onMatchEnd(res) {
    const cfg = res.cfg;
    const S = save.data;
    const humanTeams = res.teams.map((t, i) => t.human ? i : -1).filter(i => i >= 0);
    const extra = { coins: 0, msg: '', buttons: [] };
    const vsCPU = humanTeams.length === 1;
    const h = humanTeams[0];
    if (vsCPU) {
      const won = res.winner === h, lost = res.winner === 1 - h;
      const mine = h === 0 ? res.scoreA : res.scoreB, theirs = h === 0 ? res.scoreB : res.scoreA;
      S.stats.matches++;
      if (won) S.stats.wins++; else if (lost) S.stats.losses++; else S.stats.draws++;
      S.stats.goals += mine; S.stats.conceded += theirs;
      const hg = res.goals.filter(g => g.team === h && !g.own);
      S.stats.superGoals += hg.filter(g => g.super).length;
      // 金币
      const mult = { easy: 1, normal: 1.5, hard: 2.2, legend: 3.2 }[cfg.diff] || 1;
      if (cfg.mode === 'shootout') extra.coins = won ? Math.round(30 * mult) : 5;
      else extra.coins = Math.round((won ? 60 : lost ? 12 : 25) * mult + mine * 10);
      // 成就
      if (hg.length) save.unlock('first_goal');
      if (won) save.unlock('first_win');
      if (res.players.some(p => p.team === h && p.line.goals >= 3)) save.unlock('hat_trick');
      if (hg.some(g => g.super)) save.unlock('super_goal');
      if (hg.some(g => g.header)) save.unlock('header_goal');
      if (hg.some(g => g.dist > 25)) save.unlock('long_goal');
      if (hg.some(g => g.setPiece === 'freekick')) save.unlock('fk_goal');
      if (won && theirs === 0 && cfg.mode !== 'shootout') save.unlock('clean_sheet');
      if (won && res.trailed[h]) save.unlock('comeback');
      if (won && mine - theirs >= 5) save.unlock('thrash');
      if (won && res.shootout) save.unlock('shootout');
      if (S.stats.tackles >= 50) save.unlock('tackles');
      if (S.stats.matches >= 25) save.unlock('veteran');
    } else if (humanTeams.length === 2) extra.coins = 20;

    if (cfg.mode === 'cup') {
      const cup = CUPS.find(c => c.id === S.cupProgress.cup);
      const r = recordCupMatch(save, res);
      if (r.champion) {
        extra.coins += cup.reward;
        S.cupsWon[cup.id] = (S.cupsWon[cup.id] || 0) + 1;
        save.unlock('cup_' + cup.id);
        extra.msg = `🏆 ${cup.name} 冠军！`;
        S.cupProgress = null;
        extra.buttons.push({ label: '返回杯赛', fn: () => this.toMenu('cup') });
      } else if (r.eliminated) {
        extra.msg = '止步于此……下次再战！';
        S.cupProgress = null;
        extra.buttons.push({ label: '返回杯赛', fn: () => this.toMenu('cup') });
      } else {
        extra.coins += Math.round(cup.reward * 0.12);
        extra.msg = '晋级下一轮！';
        extra.buttons.push({ label: '继续杯赛 ▶', fn: () => this.toMenu('cup') });
      }
    } else {
      extra.buttons.push({ label: '再来一局', fn: () => this.startMatch(this.lastCfg) });
    }
    extra.buttons.push({ label: '主菜单', fn: () => this.toMenu('main') });
    S.coins += extra.coins;
    save.write();
    if (extra.coins) audio.coin();
    ui.showResult(res, extra);
  },
};

save.onUnlock(a => { hud.toast(a); audio.unlock(); });

const ui = new UI(app);
app.ui = ui;
app.applySettings();
stadium.setPreset('night', 'clear');
bloom.strength = stadium.bloom;
renderer.toneMappingExposure = stadium.exposure;
$('loadTip').remove();

// 首次交互解锁音频
const unlockAudio = () => { audio.init(); app.applySettings(); if (!app.inMatch) audio.music(true); };
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// ================= 主循环 =================
const clock = new THREE.Clock();
let t = 0;
function frame(dt) {
  t += dt;
  input.poll(t);
  if (app.inMatch) {
    if (!app.paused) {
      match.update(dt);
      weather.update(dt, camera);
    } else cam.update(0, match);
  } else {
    showcase.update(dt, t);
    stadium.update(dt, t);
    fx.update(dt);
    cam.update(dt, match);
  }
  if (!window.__noRender) composer.render(dt);
  input.commit();
}

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  frame(dt);
}

if (params.has('autotest')) {
  // 自动测试：电脑对电脑
  const T = TEAMS;
  ui.hide();
  app.startMatch({ mode: 'quick', teamA: T[0], teamB: T[1], diff: 'hard', duration: +(params.get('dur') || 240), time: params.get('time') || 'night', weather: params.get('weather') || 'clear', cage: params.has('cage'), humans: params.has('human') ? [{ device: 'kb1', team: 0 }] : [], title: '测试赛' });
} else {
  ui.reset('title');
}
loop();

window.__game = { app, match, ui, save, step: (dt = 1 / 60) => frame(dt), renderer, scene, camera, stadium };
