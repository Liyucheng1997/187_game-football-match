import * as THREE from 'three';
import { F } from '../config.js';

export function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')];
}

export function toTex(cv, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = aniso;
  return t;
}

// ---------- 球衣纹理（lathe 躯干 UV：u=0 正面，u=0.5 背面；v 自下而上） ----------
export function makeKitTexture(kit, number, name, isKeeper = false) {
  const W = 512, H = 256;
  const [cv, g] = canvas(W, H);
  const p = kit.primary, s = kit.secondary;
  g.fillStyle = p; g.fillRect(0, 0, W, H);
  g.fillStyle = s;
  switch (kit.pattern) {
    case 'stripes':
      for (let i = 0; i < 16; i += 2) g.fillRect(i * W / 16, 0, W / 16, H);
      break;
    case 'hoops':
      for (let i = 0; i < 7; i += 2) g.fillRect(0, i * H / 7 + 10, W, H / 7);
      break;
    case 'sash': {
      // 正面斜带（u 0.85→0.15 环绕）
      g.save();
      g.beginPath();
      for (const off of [0, W]) {
        g.moveTo(-60 + off - W * 0.12, H); g.lineTo(-10 + off - W * 0.12, H); g.lineTo(80 + off - W * 0.12, 0); g.lineTo(30 + off - W * 0.12, 0);
      }
      g.fill();
      g.restore();
      break;
    }
    case 'halves':
      g.fillRect(W * 0.25, 0, W * 0.5, H);
      break;
    case 'chevron': {
      g.beginPath();
      for (const cx of [0, W]) {
        g.moveTo(cx - 80, H * 0.72); g.lineTo(cx, H * 0.5); g.lineTo(cx + 80, H * 0.72);
        g.lineTo(cx + 80, H * 0.84); g.lineTo(cx, H * 0.62); g.lineTo(cx - 80, H * 0.84);
      }
      g.fill();
      break;
    }
    default: break;
  }
  // 布料细纹
  g.globalAlpha = 0.06;
  g.fillStyle = '#000';
  for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  g.globalAlpha = 1;
  // 袖口 / 下摆暗边
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, H - 8, W, 8);

  const numCol = contrastColor(kit.pattern === 'stripes' || kit.pattern === 'hoops' ? mix(p, s) : p, kit);
  // 背号
  g.font = '900 104px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = numCol === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)';
  g.strokeText(String(number), W * 0.5, H * 0.5);
  g.fillStyle = numCol; g.fillText(String(number), W * 0.5, H * 0.5);
  // 背后名字
  g.font = 'bold 26px "Microsoft YaHei", "PingFang SC", sans-serif';
  g.fillText(name || '', W * 0.5, H * 0.16);
  // 胸前号码 + 队徽
  g.font = '900 40px "Arial Black", Impact, sans-serif';
  g.fillText(String(number), W * 0.94, H * 0.62);
  g.beginPath(); g.arc(W * 0.07, H * 0.64, 16, 0, Math.PI * 2);
  g.fillStyle = s; g.fill(); g.lineWidth = 4; g.strokeStyle = numCol; g.stroke();
  if (isKeeper) { g.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < W; i += 36) g.fillRect(i, 0, 12, H); }
  return toTex(cv);
}

function mix(a, b) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return '#' + ca.lerp(cb, 0.5).getHexString();
}

export function luminance(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function contrastColor(bg) {
  return luminance(bg) > 0.55 ? '#111111' : '#ffffff';
}

// ---------- 草坪（割草条纹 + 草色噪声 + 全部画线） ----------
export function makePitchTexture(weather = 'clear', mowing = 'stripes') {
  const ext = 6; // 场外延伸米数（也画进纹理）
  const TL = F.L + ext * 2, TW = F.W + ext * 2;
  const w = 4096, h = Math.round(w * TW / TL);
  const [cv, g] = canvas(w, h);
  const px = w / TL;
  const X = m => (m + TL / 2) * px, Y = m => (m + TW / 2) * px;

  const base = weather === 'snow' ? ['#5f8f55', '#6c9a60'] : ['#2f7d34', '#3a8c3d'];
  g.fillStyle = base[0]; g.fillRect(0, 0, w, h);
  // 割草纹
  const n = 18;
  for (let i = 0; i < n; i++) {
    const x0 = X(-F.hl + (F.L / n) * i);
    if (i % 2 === 0) continue;
    g.fillStyle = base[1];
    g.fillRect(x0, Y(-F.hw), F.L / n * px + 1, F.W * px);
  }
  if (mowing === 'checker') {
    for (let j = 0; j < 8; j++) if (j % 2) { g.fillStyle = 'rgba(255,255,255,0.045)'; g.fillRect(X(-F.hl), Y(-F.hw + (F.W / 8) * j), F.L * px, F.W / 8 * px); }
  }
  // 细节噪声
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = (Math.random() - 0.5) * 16;
    d[i] += r * 0.6; d[i + 1] += r; d[i + 2] += r * 0.4;
  }
  g.putImageData(img, 0, 0);
  // 大块色斑
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 40 + Math.random() * 140;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() > 0.5;
    gr.addColorStop(0, dark ? 'rgba(20,50,10,0.10)' : 'rgba(170,200,90,0.07)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 门前磨损
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 40; i++) {
      const x = X(sx * (F.hl - 3 - Math.random() * 6)), y = Y((Math.random() - 0.5) * 8), r = 14 + Math.random() * 40;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(120,100,60,0.13)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  if (weather === 'snow') {
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(245,250,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  // 画线
  g.strokeStyle = weather === 'snow' ? 'rgba(40,110,255,0.9)' : 'rgba(255,255,255,0.93)';
  g.fillStyle = g.strokeStyle;
  g.lineWidth = 0.12 * px;
  g.lineCap = 'round';
  const rect = (x0, z0, x1, z1) => g.strokeRect(X(x0), Y(z0), (x1 - x0) * px, (z1 - z0) * px);
  rect(-F.hl, -F.hw, F.hl, F.hw);
  g.beginPath(); g.moveTo(X(0), Y(-F.hw)); g.lineTo(X(0), Y(F.hw)); g.stroke();
  g.beginPath(); g.arc(X(0), Y(0), F.centerR * px, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(X(0), Y(0), 0.25 * px, 0, Math.PI * 2); g.fill();
  for (const s of [-1, 1]) {
    const gx = s * F.hl;
    rect(Math.min(gx, gx - s * F.boxDepth), -F.boxHalfW, Math.max(gx, gx - s * F.boxDepth), F.boxHalfW);
    rect(Math.min(gx, gx - s * F.smallDepth), -F.smallHalfW, Math.max(gx, gx - s * F.smallDepth), F.smallHalfW);
    const ps = gx - s * F.penSpot;
    g.beginPath(); g.arc(X(ps), Y(0), 0.22 * px, 0, Math.PI * 2); g.fill();
    const a = Math.acos((F.boxDepth - F.penSpot) / 7.5);
    g.beginPath();
    if (s > 0) g.arc(X(ps), Y(0), 7.5 * px, Math.PI - a, Math.PI + a);
    else g.arc(X(ps), Y(0), 7.5 * px, -a, a);
    g.stroke();
    for (const zs of [-1, 1]) {
      g.beginPath();
      const cx = X(gx), cy = Y(zs * F.hw);
      const st = s > 0 ? (zs > 0 ? Math.PI : Math.PI / 2) : (zs > 0 ? -Math.PI / 2 : 0);
      g.arc(cx, cy, 1 * px, st, st + Math.PI / 2);
      g.stroke();
    }
    // 门线内的球门区阴影
    g.fillStyle = 'rgba(0,0,0,0.06)';
    g.fillRect(X(s > 0 ? gx : gx - F.goalDepth), Y(-F.goalHalfW), F.goalDepth * px, F.goalHalfW * 2 * px);
    g.fillStyle = g.strokeStyle;
  }
  const tex = toTex(cv, { aniso: 16 });
  tex.generateMipmaps = true;
  return { tex, size: [TL, TW] };
}

// ---------- 广告 LED 板（横向长条，可滚动） ----------
const ADS = [
  ['热血汽水', '#e11d48', '#fff'], ['FABLE 航空', '#1d4ed8', '#fff'], ['超级绿茵联赛', '#111827', '#fcbf49'],
  ['老王牛肉面', '#f59e0b', '#111'], ['三喵宠物', '#7c3aed', '#fff'], ['极速球鞋', '#16a34a', '#fff'],
  ['流星旅行社', '#0ea5e9', '#fff'], ['CLAUDE 可乐', '#d62828', '#fff'],
];
export function makeLEDTexture() {
  const W = 2048, H = 64;
  const [cv, g] = canvas(W, H);
  const seg = W / ADS.length;
  ADS.forEach(([text, bg, fg], i) => {
    g.fillStyle = bg; g.fillRect(i * seg, 0, seg, H);
    g.fillStyle = fg;
    g.font = 'bold 36px "Microsoft YaHei", "PingFang SC", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, i * seg + seg / 2, H / 2 + 2);
  });
  // LED 像素网格
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  const t = toTex(cv);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------- 观众贴图集：R=衣服 G=皮肤 B=头发裤子 A=透明 ----------
export function makeCrowdAtlas() {
  const C = 128, cols = 4, rows = 2;
  const [cv, g] = canvas(C * cols, C * rows);
  g.clearRect(0, 0, cv.width, cv.height);
  const R = 'rgb(255,0,0)', G = 'rgb(0,255,0)', B = 'rgb(0,0,255)';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ox = c * C, oy = r * C;
    const armsUp = r === 1;
    const wide = c % 2 === 1 ? 6 : 0;
    const cx = ox + C / 2;
    // 身体（坐姿上半身 + 腿）
    g.fillStyle = B;
    g.fillRect(cx - 20 - wide / 2, oy + 96, 40 + wide, 32);
    g.fillStyle = R;
    roundRect(g, cx - 22 - wide / 2, oy + 52, 44 + wide, 50, 12); g.fill();
    // 头
    g.fillStyle = G;
    g.beginPath(); g.ellipse(cx, oy + 36, 15, 17, 0, 0, Math.PI * 2); g.fill();
    // 头发 / 帽子
    g.fillStyle = c === 2 ? R : B;
    g.beginPath(); g.ellipse(cx, oy + 26, 16, c === 3 ? 12 : 9, 0, Math.PI, 0); g.fill();
    if (c === 2) g.fillRect(cx - 18, oy + 25, 36, 5);
    // 手臂
    g.strokeStyle = R; g.lineWidth = 11; g.lineCap = 'round';
    g.beginPath();
    if (armsUp) {
      g.moveTo(cx - 20, oy + 60); g.lineTo(cx - 32, oy + 18);
      g.moveTo(cx + 20, oy + 60); g.lineTo(cx + 32, oy + 18);
    } else {
      g.moveTo(cx - 22, oy + 60); g.lineTo(cx - 26, oy + 96);
      g.moveTo(cx + 22, oy + 60); g.lineTo(cx + 26, oy + 96);
    }
    g.stroke();
    g.fillStyle = G;
    for (const s of [-1, 1]) {
      g.beginPath();
      if (armsUp) g.arc(cx + s * 32, oy + 14, 6, 0, Math.PI * 2);
      else g.arc(cx + s * 26, oy + 99, 6, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// 通用径向光晕
export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [cv, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.6)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return toTex(cv);
}
