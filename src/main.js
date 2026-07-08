import * as THREE from 'three';
import { buildStadium } from './stadium.js';
import { Match } from './match.js';
import { AudioFX } from './audio.js';
import { FX } from './fx.js';

const $ = id => document.getElementById(id);

// ---------- 渲染器 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 34, 60);
camera.lookAt(0, 0, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 输入 ----------
const input = {
  keys: new Set(),
  dir: new THREE.Vector3(),
  sprint: false,
  shootDown: false,
  _pass: false,
  _switch: false,
  consumePass() { const v = this._pass; this._pass = false; return v; },
  consumeSwitch() { const v = this._switch; this._switch = false; return v; },
  refresh() {
    let x = 0, z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    this.dir.set(len ? x / len : 0, 0, len ? z / len : 0);
    this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.shootDown = this.keys.has('Space');
  },
};

window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  input.keys.add(e.code);
  if (e.code === 'KeyE' || e.code === 'KeyJ') input._pass = true;
  if (e.code === 'KeyQ') input._switch = true;
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', e => input.keys.delete(e.code));
window.addEventListener('blur', () => { input.keys.clear(); if (match.state === 'play') pauseGame(true); });

// ---------- 世界组装 ----------
const audio = new AudioFX();
const { crowd } = buildStadium(scene);
const fx = new FX(scene);
const world = { scene, camera, renderer, input, audio, fx, crowd, timeSlow: 0 };
const match = new Match(world);

$('loadTip').remove();
$('menu').classList.remove('hidden');

// ---------- 菜单 / UI ----------
let selDiff = 'normal';
let selDur = 180;
let paused = false;

$('diffGrid').addEventListener('click', e => {
  const btn = e.target.closest('.diff-btn');
  if (!btn) return;
  selDiff = btn.dataset.diff;
  document.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('active', b === btn));
  audio.init(); audio.click();
});
$('durRow').addEventListener('click', e => {
  const btn = e.target.closest('.dur-btn');
  if (!btn) return;
  selDur = +btn.dataset.dur;
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.toggle('active', b === btn));
  audio.init(); audio.click();
});

function startGame() {
  audio.init();
  audio.click();
  paused = false;
  $('menu').classList.add('hidden');
  $('endScreen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  match.startMatch(selDiff, selDur);
}
$('startBtn').addEventListener('click', startGame);
$('rematchBtn').addEventListener('click', startGame);
$('backMenuBtn').addEventListener('click', () => {
  $('endScreen').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  match.state = 'menu';
});

function pauseGame(on) {
  paused = on;
  $('pauseMenu').classList.toggle('hidden', !on);
}
function togglePause() {
  if (match.state === 'play' || match.state === 'countdown' || paused) pauseGame(!paused);
}
$('pauseBtn').addEventListener('click', () => togglePause());
$('resumeBtn').addEventListener('click', () => pauseGame(false));
$('quitBtn').addEventListener('click', () => {
  pauseGame(false);
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  match.state = 'menu';
});
$('muteBtn').addEventListener('click', () => {
  audio.init();
  audio.setMuted(!audio.muted);
  $('muteBtn').textContent = audio.muted ? '🔇' : '🔊';
});

// ---------- 主循环 ----------
const clock = new THREE.Clock();
let menuAngle = 0;

function frame(dt, t) {
  input.refresh();

  if (match.state === 'menu') {
    // 菜单：环绕球场展示
    menuAngle += dt * 0.12;
    camera.position.set(Math.cos(menuAngle) * 78, 30 + Math.sin(t * 0.4) * 4, Math.sin(menuAngle) * 78);
    camera.lookAt(0, 2, 0);
  } else if (!paused) {
    // 进球慢动作
    if (world.timeSlow > 0) {
      world.timeSlow -= dt;
      dt *= 0.35;
    }
    match.update(dt, t);
  }

  renderer.render(scene, camera);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.033);
  frame(dt, clock.elapsedTime);
}
animate();

// 调试钩子（预览环境后台标签页 rAF 不触发时可手动驱动）
window.__game = { match, world, step: (dt = 1 / 60, t = performance.now() / 1000) => frame(dt, t) };
