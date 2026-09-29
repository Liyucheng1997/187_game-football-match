import * as THREE from 'three';
import { F, TUNE } from '../config.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };

// 比赛内 HUD（DOM 覆盖层）
export class HUD {
  constructor(camera) {
    this.camera = camera;
    this.root = $('hud');
    this.mini = $('radar').getContext('2d');
    this.tags = new Map();
    this.comT = 0;
    this._v = new THREE.Vector3();
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  setupMatch(m) {
    this.m = m;
    const [a, b] = m.teams;
    $('sbA').textContent = a.data.abbr; $('sbB').textContent = b.data.abbr;
    $('sbA').style.setProperty('--c', a.kit.primary); $('sbB').style.setProperty('--c', b.kit.primary);
    $('feverA').style.setProperty('--c', a.kit.primary); $('feverB').style.setProperty('--c', b.kit.primary);
    this.setScore(0, 0);
    for (const t of this.tags.values()) t.remove();
    this.tags.clear();
    for (const h of m.humans) {
      const t = el('div', 'ptag', `<div class="pname"></div><div class="pbar"><i></i></div><div class="pcharge hidden"><i></i><b></b></div>`);
      t.style.setProperty('--c', h.color);
      $('tags').appendChild(t);
      this.tags.set(h, t);
    }
    $('shootoutBox').classList.add('hidden');
    $('commentary').innerHTML = '';
    this.replayTag(false);
    this.setPieceHint(null);
    $('clock').textContent = "0'";
  }

  setScore(a, b) {
    $('scA').textContent = a; $('scB').textContent = b;
    for (const id of ['scA', 'scB']) { $(id).classList.remove('bump'); void $(id).offsetWidth; $(id).classList.add('bump'); }
  }

  update(m, dt) {
    if (!m.teams.length) return;
    const st = m.state;
    const inPlay = st === 'play' || st === 'setpiece' || st === 'stoppage' || st === 'pwatch' || st === 'pwait';
    $('scoreboard').classList.toggle('hidden', st === 'intro' || st === 'idle');
    $('clock').textContent = m.so ? '点球' : m.minute() + "'";
    $('clock').classList.toggle('added', !!m.halfDue);
    $('feverA').style.width = m.teams[0].fever + '%';
    $('feverB').style.width = m.teams[1].fever + '%';
    $('feverA').classList.toggle('full', m.teams[0].fever >= 100);
    $('feverB').classList.toggle('full', m.teams[1].fever >= 100);
    $('radarWrap').classList.toggle('hidden', !inPlay || !!m.so);

    // 球员标签
    const W = window.innerWidth, H = window.innerHeight;
    for (const [h, tag] of this.tags) {
      const p = h.player;
      const vis = p && inPlay && !p.sentOff;
      tag.classList.toggle('hidden', !vis);
      if (!vis) continue;
      const v = this._v.set(p.pos.x, 2.25, p.pos.z).project(this.camera);
      if (v.z > 1) { tag.classList.add('hidden'); continue; }
      tag.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
      tag.querySelector('.pname').textContent = `P${h.slot + 1} ${p.name}`;
      tag.querySelector('.pbar i').style.width = p.stamina + '%';
      const ch = tag.querySelector('.pcharge');
      const charging = h.charge >= 0;
      ch.classList.toggle('hidden', !charging);
      if (charging) {
        const c = Math.min(1.25, h.charge) / 1.25;
        ch.querySelector('i').style.width = c * 100 + '%';
        ch.querySelector('i').classList.toggle('over', h.charge > 1);
        const lo = TUNE.perfectLo / 1.25 * 100, hi = TUNE.perfectHi / 1.25 * 100;
        ch.querySelector('b').style.left = lo + '%'; ch.querySelector('b').style.width = (hi - lo) + '%';
      }
    }
    if (inPlay && !m.so) this.drawRadar(m);
    this.comT -= dt;
  }

  drawRadar(m) {
    const g = this.mini, W = 220, H = 142;
    g.clearRect(0, 0, W, H);
    const sx = (W - 14) / F.L, sy = (H - 14) / F.W;
    const X = x => W / 2 + x * sx, Y = z => H / 2 + z * sy;
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
    g.strokeRect(X(-F.hl), Y(-F.hw), F.L * sx, F.W * sy);
    g.beginPath(); g.moveTo(X(0), Y(-F.hw)); g.lineTo(X(0), Y(F.hw)); g.stroke();
    g.beginPath(); g.arc(X(0), Y(0), F.centerR * sx, 0, Math.PI * 2); g.stroke();
    for (const s of [-1, 1]) {
      g.strokeRect(Math.min(X(s * F.hl), X(s * (F.hl - F.boxDepth))), Y(-F.boxHalfW), F.boxDepth * sx, F.boxHalfW * 2 * sy);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(X(s * F.hl) + (s > 0 ? 0 : -3), Y(-F.goalHalfW), 3, F.goalHalfW * 2 * sy);
    }
    for (const t of m.teams) {
      for (const p of t.active) {
        g.beginPath();
        g.arc(X(p.pos.x), Y(p.pos.z), p.controller ? 4.2 : 3.2, 0, Math.PI * 2);
        g.fillStyle = t.kit.primary;
        g.fill();
        g.lineWidth = p.controller ? 2 : 1;
        g.strokeStyle = p.controller ? p.controller.color : 'rgba(0,0,0,0.6)';
        g.stroke();
      }
    }
    g.beginPath(); g.arc(X(m.ball.pos.x), Y(m.ball.pos.z), 2.6, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
  }

  commentary(text) {
    if (!text || !this.m?.settings.commentary) return;
    const box = $('commentary');
    const line = el('div', 'com', text);
    box.prepend(line);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => line.classList.add('fade'), 3800);
    setTimeout(() => line.remove(), 4600);
  }

  banner(text, style = '', sub = '') {
    const b = $('banner');
    b.innerHTML = `<div class="bt">${text}</div>${sub ? `<div class="bs">${sub}</div>` : ''}`;
    b.className = 'show ' + style;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { b.className = ''; }, style === 'goal' ? 2600 : 1900);
  }

  goal(team, scorer, own, key) {
    const big = { superGoal: '🔥 热血必杀破门！', headerGoal: '头球破门！', longGoal: '世界波！', fkGoal: '任意球破门！', penGoal: '点球命中！', ownGoal: '乌龙球！' }[key];
    this.banner('GOAL!', 'goal', `${big ? big + ' · ' : ''}${scorer ? scorer.name : ''} · ${team.data.name}`);
    const b = $('banner');
    b.style.setProperty('--c', team.kit.primary);
  }

  flash(text, color = '#fff', p = null) {
    const f = el('div', 'flash', text);
    f.style.color = color;
    $('flashes').appendChild(f);
    setTimeout(() => f.remove(), 1500);
  }

  card(kind, p, team) {
    const c = el('div', 'cardpop ' + kind, `<div class="cardimg"></div><div><b>${p.name}</b><span>${team.data.name}</span></div>`);
    $('flashes').appendChild(c);
    setTimeout(() => c.remove(), 2600);
  }

  vsCard(a, b, title) {
    const v = $('vsCard');
    if (!a) { v.classList.add('hidden'); return; }
    v.classList.remove('hidden');
    v.innerHTML = `<div class="vs-team" style="--c:${a.kit.primary}"><div class="crest">${a.abbr}</div><div class="vn">${a.name}</div></div>
      <div class="vs-mid"><div class="vs">VS</div><div class="vt">${title || ''}</div><div class="vhint">按任意键跳过</div></div>
      <div class="vs-team" style="--c:${b.kit.primary}"><div class="crest">${b.abbr}</div><div class="vn">${b.name}</div></div>`;
  }

  replayTag(on) { $('replayTag').classList.toggle('hidden', !on); }

  fade() {
    const f = $('fader');
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }

  setPieceHint(type, attackerHuman = false, keeperHuman = false) {
    const h = $('spHint');
    if (!type || (!attackerHuman && !keeperHuman)) { h.classList.add('hidden'); return; }
    const names = { kickoff: '开球', kickin: '界外球', corner: '角球', goalkick: '球门球', freekick: '任意球', penalty: '点球' };
    let tips = '摇杆/WASD 瞄准 · <b>J</b> 短传 · <b>I</b> 高球 · <b>K</b> 按住蓄力射门';
    if (type === 'corner') tips = '摇杆瞄准 · <b>I</b> 传中 · <b>J</b> 短传';
    if (type === 'penalty') tips = attackerHuman ? '左右选角度 · <b>K</b> 按住蓄力决定高度 · 小心打飞！' : '对方主罚：射门瞬间按住 左/右 扑救';
    if (type === 'freekick') tips = '摇杆瞄准 · <b>K</b> 蓄力弧线射门 · <b>J</b> 短传 · <b>I</b> 高球';
    h.innerHTML = `<span class="spn">${names[type]}</span>${tips}`;
    h.classList.remove('hidden');
  }

  shootout(so, done = false) {
    const box = $('shootoutBox');
    box.classList.remove('hidden');
    const row = (i) => {
      const k = so.kicks[i];
      const n = Math.max(5, k.length, so.kicks[1 - i].length);
      let s = '';
      for (let j = 0; j < n; j++) s += `<i class="${j < k.length ? (k[j] ? 'in' : 'out') : ''}"></i>`;
      return s;
    };
    const [a, b] = this.m.teams;
    box.innerHTML = `<div class="sor"><span>${a.data.abbr}</span>${row(0)}</div><div class="sor"><span>${b.data.abbr}</span>${row(1)}</div>`;
    if (done) setTimeout(() => box.classList.add('hidden'), 3000);
  }

  toast(a) {
    const t = el('div', 'toast', `<div class="ti">${a.icon}</div><div><b>成就解锁</b><span>${a.name} · ${a.desc}</span></div>`);
    $('toasts').appendChild(t);
    setTimeout(() => t.classList.add('fade'), 3600);
    setTimeout(() => t.remove(), 4200);
  }
}
