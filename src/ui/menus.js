import { TEAMS, overall, starsOf, clubTeam, CUPS, BALLS, PATTERNS, KIT_COLORS } from '../data/teams.js';
import { DIFFS } from '../config.js';
import { ACHIEVEMENTS } from '../core/save.js';
import { CONTROL_HELP } from '../core/input.js';
import { cupUnlocked, startCup, nextOpponent, teamFor, ROUND_NAMES, winnerOf } from '../core/career.js';

const $ = id => document.getElementById(id);

const TIMES = [['day', '白天'], ['sunset', '黄昏'], ['night', '夜场']];
const WEATHERS = [['clear', '晴朗'], ['rain', '下雨'], ['snow', '下雪']];
const DURS = [[180, '3 分钟'], [240, '4 分钟'], [360, '6 分钟'], [480, '8 分钟']];
const RULES = [[false, '标准规则'], [true, '笼式足球']];
const DIFF_KEYS = ['easy', 'normal', 'hard', 'legend'];
const QUAL = [['low', '低'], ['medium', '中'], ['high', '高']];
const CAMS = [['broadcast', '转播'], ['close', '近景'], ['wide', '高空']];

export function crest(team, size = 64) {
  const k = team.kit;
  return `<div class="crest-shield" style="--p:${k.primary};--s:${k.secondary};width:${size}px;height:${size * 1.15}px"><span>${team.abbr}</span></div>`;
}
function stars(r) {
  const s = starsOf(r);
  let h = '';
  for (let i = 1; i <= 5; i++) h += `<i class="${s >= i ? 'f' : s >= i - 0.5 ? 'h' : ''}">★</i>`;
  return `<div class="stars">${h}</div>`;
}
function bars(r) {
  const row = (k, n) => `<div class="rb"><span>${n}</span><div><i style="width:${r[k]}%"></i></div><b>${Math.round(r[k])}</b></div>`;
  return `<div class="rbars">${row('att', '进攻')}${row('pas', '传控')}${row('def', '防守')}${row('spd', '速度')}${row('gk', '门将')}</div>`;
}
const lr = (id, label, value) => `<div class="opt" data-nav data-lr="${id}"><span class="ol">${label}</span><span class="ov"><b class="arr">◀</b><em>${value}</em><b class="arr">▶</b></span></div>`;

export class UI {
  constructor(app) {
    this.app = app;
    this.save = app.save;
    this.audio = app.audio;
    this.root = $('screen');
    this.stack = [];
    this.focus = null;
    this.q = { a: 0, b: 2, diff: 'normal', dur: this.save.s.duration, time: 'night', weather: 'clear', cage: false, mode: 'quick' };
    this.assign = { kb1: 0 };
    app.input.onNav((kind, dev) => this.onNav(kind, dev));
    this.root.addEventListener('mouseover', e => { const t = e.target.closest('[data-nav]'); if (t && t !== this.focus) this.setFocus(t, false); });
  }

  get allTeams() { return [clubTeam(this.save.data.club), ...TEAMS]; }

  // ================= 导航 =================
  go(name, arg, push = true) {
    if (push && this.cur) this.stack.push(this.cur);
    this.cur = { name, arg };
    this.render();
  }
  back() {
    if (this.overlayBack) { this.overlayBack(); return; }
    const scr = this.screens[this.cur?.name];
    if (scr?.onBack) { scr.onBack(); return; }
    if (!this.stack.length) return;
    this.audio.back();
    this.cur = this.stack.pop();
    this.render();
  }
  reset(name) { this.stack = []; this.cur = null; this.go(name, null, false); }

  render(keepFocus = false) {
    const scr = this.screens[this.cur.name];
    const prevIdx = keepFocus && this.focus ? this.focusables().indexOf(this.focus) : -1;
    this.root.innerHTML = `<div class="scr scr-${this.cur.name}">${scr.html(this.cur.arg)}</div>`;
    this.root.classList.remove('hidden');
    scr.bind && scr.bind(this.root, this.cur.arg);
    this.root.querySelectorAll('[data-click]').forEach(e => e.addEventListener('click', () => { this.audio.click(); }));
    this.root.querySelectorAll('[data-lr]').forEach(e => {
      e.querySelectorAll('.arr').forEach((a, i) => a.addEventListener('click', ev => { ev.stopPropagation(); this.lr(e, i === 0 ? -1 : 1); }));
    });
    const f = this.focusables();
    this.setFocus(prevIdx >= 0 && f[prevIdx] ? f[prevIdx] : (this.root.querySelector('[data-focus]') || f[0]), false);
    this.app.onScreen(this.cur.name, this.cur.arg);
  }

  hide() { this.root.classList.add('hidden'); this.root.innerHTML = ''; this.cur = null; this.stack = []; }

  focusables(root = this.overlayRoot || this.root) {
    return [...root.querySelectorAll('[data-nav]')].filter(e => e.offsetParent !== null && !e.classList.contains('disabled-nav'));
  }

  setFocus(el, sound = true) {
    if (this.focus) this.focus.classList.remove('focus');
    this.focus = el;
    if (el) {
      el.classList.add('focus');
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      if (sound) this.audio.move();
    }
  }

  onNav(kind, dev) {
    if (kind === 'escape') kind = this.app.inMatch && (!this.overlayRoot || this.app.paused) ? 'pause' : 'back';
    if (this.app.inMatch && !this.overlayRoot) {
      if (kind === 'pause') this.app.togglePause();
      return;
    }
    if (!this.cur && !this.overlayRoot) return;
    if (kind === 'devices') { if (this.cur?.name === 'controllers') this.render(true); return; }
    if (this.cur?.name === 'controllers' && !this.overlayRoot && (kind === 'left' || kind === 'right') && dev) {
      this.moveDevice(dev, kind === 'left' ? -1 : 1); return;
    }
    if (this.cur?.name === 'title' && !this.overlayRoot) { if (kind !== 'devices') { this.audio.init(); this.audio.click(); this.go('main'); } return; }
    if (kind === 'back') { this.back(); return; }
    if (kind === 'pause' && this.overlayRoot && this.app.inMatch) { this.app.togglePause(); return; }
    if (kind === 'confirm') { if (this.focus) { this.audio.init(); this.focus.click(); } return; }
    if (['up', 'down', 'left', 'right'].includes(kind)) {
      if ((kind === 'left' || kind === 'right') && this.focus && this.focus.dataset.lr !== undefined) { this.lr(this.focus, kind === 'left' ? -1 : 1); return; }
      this.spatial(kind);
    }
  }

  spatial(dir) {
    const f = this.focusables();
    if (!f.length) return;
    if (!this.focus || !f.includes(this.focus)) { this.setFocus(f[0]); return; }
    const r0 = this.focus.getBoundingClientRect();
    const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    let best = null, bs = 1e9;
    for (const e of f) {
      if (e === this.focus) continue;
      const r = e.getBoundingClientRect();
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const dx = c.x - c0.x, dy = c.y - c0.y;
      let main, cross;
      if (dir === 'up') { main = -dy; cross = dx; } else if (dir === 'down') { main = dy; cross = dx; }
      else if (dir === 'left') { main = -dx; cross = dy; } else { main = dx; cross = dy; }
      if (main < 4) continue;
      const s = main + Math.abs(cross) * 2.2;
      if (s < bs) { bs = s; best = e; }
    }
    if (best) this.setFocus(best);
  }

  lr(el, d) {
    const scr = this.overlayRoot ? this.overlayScr : this.screens[this.cur.name];
    if (scr && scr.lr) { this.audio.move(); scr.lr(el.dataset.lr, d, el); }
  }

  // ================= 覆盖层（暂停 / 结算 / 确认） =================
  overlay(html, bind, onBack, scr = null) {
    const o = $('overlay');
    o.innerHTML = html;
    o.classList.remove('hidden');
    this.overlayRoot = o;
    this.overlayBack = onBack;
    this.overlayScr = scr;
    this.savedFocus = this.focus;
    bind && bind(o);
    o.querySelectorAll('[data-lr]').forEach(e => e.querySelectorAll('.arr').forEach((a, i) => a.addEventListener('click', ev => { ev.stopPropagation(); this.lr(e, i === 0 ? -1 : 1); })));
    o.onmouseover = e => { const t = e.target.closest('[data-nav]'); if (t && t !== this.focus) this.setFocus(t, false); };
    this.setFocus(o.querySelector('[data-focus]') || this.focusables(o)[0], false);
  }
  closeOverlay() {
    const o = $('overlay');
    o.classList.add('hidden'); o.innerHTML = '';
    this.overlayRoot = null; this.overlayBack = null; this.overlayScr = null;
    if (this.savedFocus && document.body.contains(this.savedFocus)) this.setFocus(this.savedFocus, false);
  }

  confirm(text, yes) {
    this.overlay(`<div class="dlg"><div class="dlg-t">${text}</div><div class="row"><button class="btn primary" data-nav id="cy">确定</button><button class="btn" data-nav data-focus id="cn">取消</button></div></div>`,
      o => { o.querySelector('#cy').onclick = () => { this.closeOverlay(); yes(); }; o.querySelector('#cn').onclick = () => this.closeOverlay(); },
      () => this.closeOverlay());
  }

  pauseMenu() {
    this.overlay(`<div class="dlg pause"><div class="dlg-t big">比赛暂停</div>
      <button class="btn primary wide" data-nav data-focus id="pr">继续比赛</button>
      <button class="btn wide" data-nav id="pc">按键说明</button>
      <button class="btn wide" data-nav id="prs">重新开始</button>
      <button class="btn wide" data-nav id="pq">退出比赛</button></div>`, o => {
      o.querySelector('#pr').onclick = () => this.app.togglePause();
      o.querySelector('#pc').onclick = () => this.controlsOverlay(() => this.pauseMenu());
      o.querySelector('#prs').onclick = () => { this.closeOverlay(); this.app.restartMatch(); };
      o.querySelector('#pq').onclick = () => this.confirm('确定退出本场比赛吗？（杯赛中将判负）', () => this.app.quitMatch());
    }, () => this.app.togglePause());
  }

  controlsOverlay(onClose) {
    const rows = CONTROL_HELP.map(r => `<tr><td>${r[0]}</td><td><kbd>${r[1]}</kbd></td><td><kbd>${r[2]}</kbd></td><td><kbd>${r[3]}</kbd></td></tr>`).join('');
    this.overlay(`<div class="dlg controls"><div class="dlg-t">操作说明</div>
      <table class="ctab"><tr><th></th><th>键盘 1</th><th>键盘 2</th><th>手柄</th></tr>${rows}</table>
      <div class="tips">💡 按住射门键蓄力，在<b style="color:#7dff7a">绿色区间</b>松开触发「完美射门」 · 传球/射门可提前按下，来球时自动一脚出球 · 冲刺带球会把球趟远，容易被断 · 从背后铲球会吃牌 · 热血槽满后可释放必杀射门</div>
      <button class="btn primary" data-nav data-focus id="cc">知道了</button></div>`,
    o => { o.querySelector('#cc').onclick = () => { this.closeOverlay(); onClose && onClose(); }; },
    () => { this.closeOverlay(); onClose && onClose(); });
  }

  // ================= 各界面 =================
  get screens() {
    const self = this;
    const S = this.save.data;
    return {
      title: {
        html: () => `<div class="title-wrap"><div class="logo"><span class="l1">热血绿茵</span><span class="l2">BLAZING PITCH</span></div>
          <div class="press">按任意键开始</div><div class="ver">v2.0 · 支持键盘与手柄</div></div>`,
        bind: r => { r.querySelector('.title-wrap').onclick = () => { self.audio.init(); self.audio.click(); self.go('main'); }; },
      },

      main: {
        html: () => `<div class="main-wrap">
          <div class="logo small"><span class="l1">热血绿茵</span><span class="l2">BLAZING PITCH</span></div>
          <div class="menu-grid">
            <button class="tile big" data-nav data-focus id="mQuick"><div class="ti-i">⚽</div><div class="ti-t">快速比赛</div><div class="ti-d">单人 / 本地多人对战 · 自选球队与场地</div></button>
            <button class="tile big gold" data-nav id="mCup"><div class="ti-i">🏆</div><div class="ti-t">冠军杯赛</div><div class="ti-d">带领你的俱乐部征战四项杯赛</div></button>
            <button class="tile" data-nav id="mPen"><div class="ti-i">🧤</div><div class="ti-t">点球大战</div></button>
            <button class="tile" data-nav id="mClub"><div class="ti-i">🏟️</div><div class="ti-t">我的俱乐部</div></button>
            <button class="tile" data-nav id="mAch"><div class="ti-i">🎖️</div><div class="ti-t">成就</div></button>
            <button class="tile" data-nav id="mSet"><div class="ti-i">⚙️</div><div class="ti-t">设置</div></button>
          </div>
          <div class="profile"><span>🪙 ${S.coins}</span><span>战绩 ${S.stats.wins}胜 ${S.stats.draws}平 ${S.stats.losses}负</span><span>进球 ${S.stats.goals}</span><span>成就 ${Object.keys(S.achievements).length}/${ACHIEVEMENTS.length}</span></div>
          ${window.steam || window.desktop ? '<button class="btn quit" data-nav id="mExit">退出游戏</button>' : ''}
        </div>`,
        bind: r => {
          r.querySelector('#mQuick').onclick = () => { self.q.mode = 'quick'; self.go('quick'); };
          r.querySelector('#mCup').onclick = () => self.go('cup');
          r.querySelector('#mPen').onclick = () => { self.q.mode = 'shootout'; self.go('quick'); };
          r.querySelector('#mClub').onclick = () => self.go('club');
          r.querySelector('#mAch').onclick = () => self.go('ach');
          r.querySelector('#mSet').onclick = () => self.go('settings');
          const ex = r.querySelector('#mExit'); if (ex) ex.onclick = () => self.confirm('退出游戏？', () => (window.desktop ? window.desktop.quit() : window.close()));
        },
        onBack: () => { self.reset('title'); },
      },

      quick: {
        html: () => {
          const T = self.allTeams, q = self.q;
          const card = (i, side) => {
            const t = T[i];
            return `<div class="team-card" style="--p:${t.kit.primary}">
              <div class="tc-side">${side}</div>
              <div class="tc-sel" data-nav data-lr="team${side}"><b class="arr">◀</b>${crest(t, 76)}<b class="arr">▶</b></div>
              <div class="tc-name">${t.name}${t.isClub ? ' <small>我的俱乐部</small>' : ''}</div>
              ${stars(t.rating)}<div class="tc-ovr">综合 ${overall(t.rating)}</div>${bars(t.rating)}</div>`;
          };
          const shoot = q.mode === 'shootout';
          return `<div class="hdr"><h2>${shoot ? '点球大战' : '快速比赛'}</h2><div class="hint">◀ ▶ 切换 · Esc 返回</div></div>
          <div class="teams-row">${card(q.a, '主队')}<div class="vs-big">VS</div>${card(q.b, '客队')}</div>
          <div class="opts">
            ${lr('diff', '电脑难度', DIFFS[q.diff].label)}
            ${shoot ? '' : lr('dur', '比赛时长', DURS.find(d => d[0] === q.dur)?.[1] || q.dur)}
            ${lr('time', '比赛时间', TIMES.find(d => d[0] === q.time)[1])}
            ${lr('weather', '天气', WEATHERS.find(d => d[0] === q.weather)[1])}
            ${shoot ? '' : lr('cage', '规则', RULES.find(d => d[0] === q.cage)[1])}
          </div>
          <button class="btn primary big" data-nav id="qGo">下一步：选择控制器 ▶</button>`;
        },
        lr: (id, d) => {
          const q = self.q, n = self.allTeams.length;
          if (id === 'team主队') { q.a = (q.a + d + n) % n; if (q.a === q.b) q.a = (q.a + d + n) % n; }
          if (id === 'team客队') { q.b = (q.b + d + n) % n; if (q.a === q.b) q.b = (q.b + d + n) % n; }
          if (id === 'diff') q.diff = cyc(DIFF_KEYS, q.diff, d);
          if (id === 'dur') q.dur = cyc(DURS.map(x => x[0]), q.dur, d);
          if (id === 'time') q.time = cyc(TIMES.map(x => x[0]), q.time, d);
          if (id === 'weather') q.weather = cyc(WEATHERS.map(x => x[0]), q.weather, d);
          if (id === 'cage') q.cage = !q.cage;
          self.render(true);
        },
        bind: r => { r.querySelector('#qGo').onclick = () => self.go('controllers'); },
      },

      controllers: {
        html: () => {
          const devs = self.app.input.list();
          for (const d of devs) if (!(d.id in self.assign)) self.assign[d.id] = -1;
          const T = self.allTeams, q = self.q;
          const a = self.q.mode === 'cup' ? self.cupTeams.a : T[q.a], b = self.q.mode === 'cup' ? self.cupTeams.b : T[q.b];
          const col = side => devs.filter(d => (self.assign[d.id] ?? -1) === side).map(d => `<div class="dev" data-dev="${d.id}"><span>${d.type === 'pad' ? '🎮' : '⌨️'}</span>${d.name}</div>`).join('') || '<div class="dev empty">电脑控制</div>';
          return `<div class="hdr"><h2>选择控制器</h2><div class="hint">用各自设备的 ◀ ▶ 选边 · 鼠标点击也可切换 · 插入手柄后按任意键即可出现</div></div>
            <div class="ctrl-cols">
              <div class="ccol" style="--p:${a.kit.primary}"><div class="cch">${crest(a, 44)}<b>${a.name}</b></div>${col(0)}</div>
              <div class="ccol mid"><div class="cch"><b>不参与</b></div>${col(-1)}</div>
              <div class="ccol" style="--p:${b.kit.primary}"><div class="cch">${crest(b, 44)}<b>${b.name}</b></div>${col(1)}</div>
            </div>
            ${self.q.mode === 'cup' ? '<div class="hint c">杯赛中所有真人玩家都将加入你的俱乐部</div>' : ''}
            <div class="row c"><button class="btn" data-nav id="cHelp">按键说明</button><button class="btn primary big" data-nav data-focus id="cGo">开 始 比 赛</button></div>`;
        },
        bind: r => {
          r.querySelectorAll('.dev[data-dev]').forEach(e => e.onclick = () => self.moveDevice(e.dataset.dev, 1, true));
          r.querySelector('#cGo').onclick = () => self.startFromSetup();
          r.querySelector('#cHelp').onclick = () => self.controlsOverlay();
        },
      },

      cup: {
        html: () => {
          const cp = S.cupProgress;
          if (cp && cp.alive && !cp.champion) return self.bracketHtml(cp);
          return `<div class="hdr"><h2>冠军杯赛</h2><div class="hint">用 ${S.club.name} 出战 · 8 队淘汰制 · 平局直接点球</div></div>
          <div class="cups">${CUPS.map((c, i) => {
            const un = cupUnlocked(self.save, i);
            const won = S.cupsWon[c.id];
            return `<button class="cup-card ${un ? '' : 'locked'} ${won ? 'won' : ''}" data-nav data-cup="${c.id}">
              <div class="cup-i">${won ? '🏆' : un ? '🥅' : '🔒'}</div><div class="cup-n">${c.name}</div>
              <div class="cup-d">${c.desc}</div><div class="cup-m">难度 ${DIFFS[c.diff].label} · 冠军奖金 🪙${c.reward}</div>
              ${won ? `<div class="cup-w">已夺冠 ×${won}</div>` : ''}${un ? '' : '<div class="cup-w">赢得上一项杯赛解锁</div>'}</button>`;
          }).join('')}</div>`;
        },
        bind: r => {
          r.querySelectorAll('[data-cup]').forEach(e => e.onclick = () => {
            const i = CUPS.findIndex(c => c.id === e.dataset.cup);
            if (!cupUnlocked(self.save, i)) { self.audio.back(); return; }
            startCup(self.save, e.dataset.cup);
            self.render();
          });
          const nx = r.querySelector('#cupNext');
          if (nx) nx.onclick = () => self.cupNext();
          const ab = r.querySelector('#cupQuit');
          if (ab) ab.onclick = () => self.confirm('放弃当前杯赛？进度将丢失。', () => { S.cupProgress = null; self.save.write(); self.render(); });
        },
      },

      club: {
        html: () => {
          const c = S.club, t = clubTeam(c);
          const up = (k, n) => {
            const lv = c.upgrades[k], cost = 150 * (lv + 1);
            const max = lv >= 10;
            return `<div class="uprow"><span>${n}</span><div class="lv">${Array.from({ length: 10 }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>
              <button class="btn sm ${max || S.coins < cost ? 'dim' : ''}" data-nav data-up="${k}">${max ? '已满级' : `升级 🪙${cost}`}</button></div>`;
          };
          return `<div class="hdr"><h2>我的俱乐部</h2><div class="coins">🪙 ${S.coins}</div></div>
          <div class="club-wrap">
            <div class="club-l">
              <div class="club-crest">${crest(t, 110)}</div>
              <label class="field">队名<input id="cName" maxlength="8" value="${esc(c.name)}" data-nav></label>
              <label class="field">缩写<input id="cAbbr" maxlength="3" value="${esc(c.abbr)}" data-nav></label>
              ${lr('primary', '主色', `<span class="sw" style="background:${c.kit.primary}"></span>`)}
              ${lr('secondary', '副色', `<span class="sw" style="background:${c.kit.secondary}"></span>`)}
              ${lr('shorts', '短裤', `<span class="sw" style="background:${c.kit.shorts}"></span>`)}
              ${lr('pattern', '球衣图案', PATTERNS.find(p => p.id === c.kit.pattern).label)}
            </div>
            <div class="club-r">
              <div class="sec-t">球队训练（综合 ${overall(t.rating)}）</div>
              ${up('att', '进攻')}${up('pas', '传控')}${up('def', '防守')}${up('spd', '速度')}${up('gk', '门将')}
              <div class="sec-t">比赛用球</div>
              <div class="balls">${BALLS.map(b => {
                const own = S.ownedBalls.includes(b.id), eq = S.ball === b.id;
                return `<button class="ball-card ${eq ? 'eq' : ''}" data-nav data-ball="${b.id}"><div class="bimg" style="--a:${b.hex};--b:${b.pent}"></div><div>${b.name}</div><small>${eq ? '使用中' : own ? '点击装备' : '🪙' + b.price}</small></button>`;
              }).join('')}</div>
            </div>
          </div>`;
        },
        lr: (id, d) => {
          const k = S.club.kit;
          if (id === 'pattern') k.pattern = cyc(PATTERNS.map(p => p.id), k.pattern, d);
          else k[id] = cyc(KIT_COLORS, k[id], d);
          if (id === 'primary') k.socks = k.primary;
          self.save.write();
          self.app.showcase([clubTeam(S.club)]);
          self.render(true);
        },
        bind: r => {
          const nm = r.querySelector('#cName'), ab = r.querySelector('#cAbbr');
          nm.onchange = () => { S.club.name = nm.value.trim() || '我的俱乐部'; self.save.write(); self.render(true); };
          ab.onchange = () => { S.club.abbr = (ab.value.trim() || 'FCM').toUpperCase().slice(0, 3); self.save.write(); self.render(true); };
          nm.onclick = ab.onclick = e => e.target.focus();
          r.querySelectorAll('[data-up]').forEach(e => e.onclick = () => {
            const k = e.dataset.up, lv = S.club.upgrades[k], cost = 150 * (lv + 1);
            if (lv >= 10 || S.coins < cost) { self.audio.back(); return; }
            S.coins -= cost; S.club.upgrades[k]++;
            self.audio.coin();
            if (Object.values(S.club.upgrades).every(v => v >= 10)) self.save.unlock('max_club');
            self.save.write();
            self.render(true);
          });
          r.querySelectorAll('[data-ball]').forEach(e => e.onclick = () => {
            const b = BALLS.find(x => x.id === e.dataset.ball);
            if (!S.ownedBalls.includes(b.id)) {
              if (S.coins < b.price) { self.audio.back(); return; }
              S.coins -= b.price; S.ownedBalls.push(b.id); self.audio.coin();
            }
            S.ball = b.id; self.save.write(); self.render(true);
          });
        },
      },

      ach: {
        html: () => `<div class="hdr"><h2>成就</h2><div class="hint">${Object.keys(S.achievements).length} / ${ACHIEVEMENTS.length}</div></div>
          <div class="ach-grid">${ACHIEVEMENTS.map(a => `<div class="ach ${S.achievements[a.id] ? 'on' : ''}" data-nav><div class="ai">${a.icon}</div><div><b>${a.name}</b><span>${a.desc}</span></div></div>`).join('')}</div>
          <div class="stats-line">比赛 ${S.stats.matches} · 胜 ${S.stats.wins} · 平 ${S.stats.draws} · 负 ${S.stats.losses} · 进球 ${S.stats.goals} · 失球 ${S.stats.conceded} · 抢断 ${S.stats.tackles} · 必杀进球 ${S.stats.superGoals}</div>`,
      },

      settings: {
        html: () => {
          const s = self.save.s;
          const vol = v => '▮'.repeat(Math.round(v * 10)) + '▯'.repeat(10 - Math.round(v * 10));
          const onoff = v => v ? '开' : '关';
          return `<div class="hdr"><h2>设置</h2><div class="hint">◀ ▶ 调整</div></div>
          <div class="opts col">
            ${lr('master', '主音量', vol(s.master))}${lr('music', '音乐', vol(s.music))}${lr('sfx', '音效', vol(s.sfx))}${lr('crowd', '观众', vol(s.crowd))}
            ${lr('quality', '画质', QUAL.find(q => q[0] === s.quality)[1] + '（重启生效）')}
            ${lr('camera', '比赛视角', CAMS.find(q => q[0] === s.camera)[1])}
            ${lr('duration', '默认时长', DURS.find(d => d[0] === s.duration)?.[1] || s.duration)}
            ${lr('replays', '进球回放', onoff(s.replays))}${lr('autoSwitch', '自动换人', onoff(s.autoSwitch))}
            ${lr('commentary', '解说字幕', onoff(s.commentary))}${lr('shake', '镜头震动', onoff(s.shake))}
          </div>
          <div class="row c"><button class="btn" data-nav id="sCtrl">按键说明</button><button class="btn" data-nav id="sFull">全屏切换</button><button class="btn danger" data-nav id="sReset">重置存档</button></div>`;
        },
        lr: (id, d) => {
          const s = self.save.s;
          if (['master', 'music', 'sfx', 'crowd'].includes(id)) s[id] = Math.max(0, Math.min(1, Math.round((s[id] + d * 0.1) * 10) / 10));
          if (id === 'quality') s.quality = cyc(QUAL.map(q => q[0]), s.quality, d);
          if (id === 'camera') s.camera = cyc(CAMS.map(q => q[0]), s.camera, d);
          if (id === 'duration') s.duration = cyc(DURS.map(q => q[0]), s.duration, d);
          if (['replays', 'autoSwitch', 'commentary', 'shake'].includes(id)) s[id] = !s[id];
          self.save.write();
          self.app.applySettings();
          self.render(true);
        },
        bind: r => {
          r.querySelector('#sCtrl').onclick = () => self.controlsOverlay();
          r.querySelector('#sFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };
          r.querySelector('#sReset').onclick = () => self.confirm('确定清空所有存档（金币、俱乐部、成就）？', () => { self.save.reset(); self.app.applySettings(); self.render(); });
        },
      },
    };
  }

  bracketHtml(cp) {
    const cup = CUPS.find(c => c.id === cp.cup);
    const name = id => { const t = teamFor(this.save, id); return t ? t.name : '?'; };
    const abbr = id => teamFor(this.save, id)?.abbr || '';
    const rounds = [0, 1, 2].map(ri => {
      const r = cp.rounds[ri];
      const n = [4, 2, 1][ri];
      let h = '';
      for (let i = 0; i < n; i++) {
        const m = r ? r[i] : null;
        if (!m) { h += `<div class="bm tbd"><div>待定</div><div>待定</div></div>`; continue; }
        const w = winnerOf(m);
        const line = (id, s, p) => `<div class="${w === id ? 'w' : w ? 'l' : ''} ${id === 'club' ? 'me' : ''}"><span>${crest(teamFor(this.save, id), 18)}${name(id)}</span><b>${s ?? ''}${p !== undefined && m.sa === m.sb ? `<small>(${p})</small>` : ''}</b></div>`;
        h += `<div class="bm">${line(m.a, m.sa, m.pa)}${line(m.b, m.sb, m.pb)}</div>`;
      }
      return `<div class="bcol"><div class="bct">${ROUND_NAMES[ri]}</div>${h}</div>`;
    }).join('');
    const opp = nextOpponent(this.save);
    const ot = opp ? teamFor(this.save, opp) : null;
    return `<div class="hdr"><h2>${cup.name} · ${ROUND_NAMES[cp.round]}</h2><div class="hint">难度 ${DIFFS[cup.diff].label} · 冠军奖金 🪙${cup.reward}</div></div>
      <div class="bracket">${rounds}<div class="bcol trophy"><div class="troph">🏆</div></div></div>
      ${ot ? `<div class="next-opp">下一个对手：${crest(ot, 40)}<b>${ot.name}</b>${stars(ot.rating)}<span>综合 ${overall(ot.rating)}</span></div>` : ''}
      <div class="row c"><button class="btn" data-nav id="cupQuit">放弃杯赛</button><button class="btn primary big" data-nav data-focus id="cupNext">进入比赛 ▶</button></div>`;
  }

  cupNext() {
    const S = this.save.data, cp = S.cupProgress;
    const opp = nextOpponent(this.save);
    const cup = CUPS.find(c => c.id === cp.cup);
    this.q.mode = 'cup';
    this.cupTeams = { a: clubTeam(S.club), b: teamFor(this.save, opp), cup, round: cp.round };
    this.go('controllers');
  }

  moveDevice(id, d, cycle = false) {
    const COLS = [0, -1, 1];
    let c = COLS.indexOf(this.assign[id] ?? -1);
    c = cycle ? (c + 1) % 3 : Math.max(0, Math.min(2, c + d));
    let n = COLS[c];
    if (this.q.mode === 'cup' && n === 1) n = -1;
    this.assign[id] = n;
    this.audio.move();
    this.render(true);
  }

  startFromSetup() {
    const devs = this.app.input.list();
    const humans = devs.filter(d => (this.assign[d.id] ?? -1) >= 0).map(d => ({ device: d.id, team: this.assign[d.id] }));
    const q = this.q;
    let cfg;
    if (q.mode === 'cup') {
      const ct = this.cupTeams;
      cfg = { mode: 'cup', teamA: ct.a, teamB: ct.b, diff: ct.cup.diff, duration: this.save.s.duration, time: ['day', 'sunset', 'night'][ct.round], weather: Math.random() < 0.2 ? (Math.random() < 0.5 ? 'rain' : 'snow') : 'clear', cage: false, knockout: true, title: `${ct.cup.name} · ${ROUND_NAMES[ct.round]}`, humans: humans.map(h => ({ ...h, team: 0 })) };
    } else {
      const T = this.allTeams;
      cfg = { mode: q.mode, teamA: T[q.a], teamB: T[q.b], diff: q.diff, duration: q.dur, time: q.time, weather: q.weather, cage: q.cage, humans, title: q.mode === 'shootout' ? '点球大战' : '友谊赛' };
    }
    cfg.ball = this.save.data.ball;
    this.app.startMatch(cfg);
  }

  // ================= 结算 =================
  showResult(res, extra) {
    const [A, B] = res.teams;
    const st = k => [A.stats[k], B.stats[k]];
    const poss = (() => { const a = A.stats.possT, b = B.stats.possT; const t = a + b || 1; return [Math.round(a / t * 100), Math.round(b / t * 100)]; })();
    const row = (n, [a, b], pct = false) => {
      const tot = (a + b) || 1;
      return `<div class="srow"><b>${a}${pct ? '%' : ''}</b><div class="sbar"><i style="width:${a / tot * 100}%;background:${A.kit.primary}"></i><i style="width:${b / tot * 100}%;background:${B.kit.primary}"></i></div><span>${n}</span><div class="sbar r"></div><b>${b}${pct ? '%' : ''}</b></div>`;
    };
    const goals = side => res.goals.filter(g => g.team === side).map(g => `<div>⚽ ${g.scorer}${g.own ? '(乌龙)' : ''} ${g.minute}'</div>`).join('');
    const humanTeam = res.teams.findIndex(t => t.human);
    const title = res.winner === -1 ? '平 局' : humanTeam >= 0 && res.teams.filter(t => t.human).length === 1 ? (res.winner === humanTeam ? '胜 利！' : '失 利') : `${res.teams[res.winner].name} 获胜`;
    const cls = res.winner === -1 ? '' : humanTeam >= 0 && res.winner === humanTeam ? 'win' : humanTeam >= 0 && res.teams.filter(t => t.human).length === 1 ? 'lose' : 'win';
    this.overlay(`<div class="result">
      <div class="res-t ${cls}">${title}</div>
      <div class="res-score"><div class="rs-team">${crest({ ...A, abbr: A.abbr, kit: A.kit }, 60)}<b>${A.name}</b><div class="gl">${goals(0)}</div></div>
        <div class="rs-num">${res.scoreA} : ${res.scoreB}${res.shootout ? `<small>点球 ${res.shootout[0]} : ${res.shootout[1]}</small>` : ''}</div>
        <div class="rs-team">${crest({ ...B, abbr: B.abbr, kit: B.kit }, 60)}<b>${B.name}</b><div class="gl">${goals(1)}</div></div></div>
      <div class="res-stats">${row('控球率', poss, true)}${row('射门', st('shots'))}${row('射正', st('onTarget'))}${row('传球成功', st('passesDone'))}${row('抢断', st('tackles'))}${row('扑救', st('saves'))}${row('犯规', st('fouls'))}${row('角球', st('corners'))}</div>
      <div class="mvp">⭐ 全场最佳：<b>${res.mvp.name}</b> <span>评分 ${res.mvp.rating}</span></div>
      ${extra.coins ? `<div class="reward">🪙 +${extra.coins}${extra.msg ? ' · ' + extra.msg : ''}</div>` : extra.msg ? `<div class="reward">${extra.msg}</div>` : ''}
      <div class="row c">${extra.buttons.map((b, i) => `<button class="btn ${i === 0 ? 'primary big' : ''}" data-nav ${i === 0 ? 'data-focus' : ''} data-i="${i}">${b.label}</button>`).join('')}</div>
    </div>`, o => {
      o.querySelectorAll('[data-i]').forEach(e => e.onclick = () => { this.closeOverlay(); extra.buttons[+e.dataset.i].fn(); });
    }, () => { this.closeOverlay(); extra.buttons[extra.buttons.length - 1].fn(); });
  }
}

function cyc(arr, v, d) { const i = arr.indexOf(v); return arr[((i < 0 ? 0 : i) + d + arr.length) % arr.length]; }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
