// 输入层：键盘 ×2 套键位 + 最多 4 个手柄，统一为「动作」接口；同时提供菜单导航事件

const ACTIONS = ['pass', 'shoot', 'through', 'lob', 'switch', 'skill', 'super', 'finesse', 'sprint', 'pause', 'confirm', 'back'];

export const KB_LAYOUTS = {
  kb1: {
    name: '键盘 · 左手区',
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    sprint: ['ShiftLeft'], pass: ['KeyJ'], shoot: ['KeyK'], through: ['KeyL'], lob: ['KeyI'],
    switch: ['KeyQ'], skill: ['Space'], super: ['KeyE'], finesse: ['KeyU'], pause: ['Escape', 'KeyP'],
  },
  kb2: {
    name: '键盘 · 方向键区',
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    sprint: ['ShiftRight', 'Numpad0'], pass: ['Numpad1', 'Comma'], shoot: ['Numpad2', 'Period'], through: ['Numpad3', 'Slash'],
    lob: ['Numpad5', 'Semicolon'], switch: ['Numpad4', 'KeyM'], skill: ['Numpad6', 'Quote'], super: ['Numpad9', 'BracketRight'],
    finesse: ['Numpad7', 'KeyN'], pause: ['NumpadEnter'],
  },
};

// 显示用键位说明
export const CONTROL_HELP = [
  ['移动', 'W A S D', '方向键', '左摇杆'],
  ['冲刺', 'Shift', '右 Shift / 小键盘0', 'RT'],
  ['短传 / 抢断', 'J', ', / 小键盘1', 'A'],
  ['射门(按住蓄力) / 铲球', 'K', '. / 小键盘2', 'B'],
  ['直塞球', 'L', '/ / 小键盘3', 'Y'],
  ['高吊 / 传中', 'I', '; / 小键盘5', 'X'],
  ['切换球员', 'Q', 'M / 小键盘4', 'LB'],
  ['花式过人', '空格', "' / 小键盘6", 'RB'],
  ['热血必杀射门', 'E', '] / 小键盘9', 'RB + B'],
  ['弧线射门(按住)', 'U', 'N / 小键盘7', 'LT'],
  ['暂停', 'Esc / P', '小键盘 Enter', 'Start'],
];

class Device {
  constructor(id, type, name) {
    this.id = id;
    this.type = type;
    this.name = name;
    this.mx = 0; this.mz = 0;
    this.held = {}; this.prev = {};
    for (const a of ACTIONS) { this.held[a] = false; this.prev[a] = false; }
    this.connected = true;
    this.lastActive = 0;
  }
  pressed(a) { return this.held[a] && !this.prev[a]; }
  released(a) { return !this.held[a] && this.prev[a]; }
  get moveLen() { return Math.hypot(this.mx, this.mz); }
  _commit() { for (const a of ACTIONS) this.prev[a] = this.held[a]; }
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.devices = {
      kb1: new Device('kb1', 'kb', '键盘 1'),
      kb2: new Device('kb2', 'kb', '键盘 2'),
    };
    this.navListeners = [];
    this.anyListeners = [];
    this.padState = {};
    this.lastNavT = 0;

    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        this._kbNav(e.code);
        for (const fn of this.anyListeners) fn('kb');
      }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onNav(fn) { this.navListeners.push(fn); }
  onAny(fn) { this.anyListeners.push(fn); }
  _emitNav(kind, dev) { for (const fn of this.navListeners) fn(kind, dev); }

  _kbNav(code) {
    const map = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
      Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', KeyJ: 'confirm',
      Escape: 'escape', Backspace: 'back', KeyK: 'back', KeyP: 'pause',
      Tab: 'tab',
    };
    if (map[code]) this._emitNav(map[code], code.startsWith('Arrow') || code === 'Numpad' ? 'kb2' : 'kb1');
  }

  list() { return Object.values(this.devices).filter(d => d.connected); }
  get(id) { return this.devices[id]; }

  poll(now) {
    // 键盘
    for (const id of ['kb1', 'kb2']) {
      const d = this.devices[id];
      const L = KB_LAYOUTS[id];
      const has = arr => arr.some(k => this.keys.has(k));
      let x = 0, z = 0;
      if (has(L.up)) z -= 1;
      if (has(L.down)) z += 1;
      if (has(L.left)) x -= 1;
      if (has(L.right)) x += 1;
      const len = Math.hypot(x, z) || 1;
      d.mx = x / len; d.mz = z / len;
      for (const a of ACTIONS) if (L[a]) d.held[a] = has(L[a]);
      if (x || z || ACTIONS.some(a => d.held[a])) d.lastActive = now;
    }

    // 手柄
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const seen = new Set();
    for (const gp of pads) {
      if (!gp) continue;
      const id = 'pad' + gp.index;
      seen.add(id);
      let d = this.devices[id];
      if (!d) {
        d = this.devices[id] = new Device(id, 'pad', `手柄 ${gp.index + 1}`);
        this._emitNav('devices');
      }
      d.connected = true;
      const b = i => (gp.buttons[i] ? gp.buttons[i].value > 0.4 || gp.buttons[i].pressed : false);
      let ax = gp.axes[0] || 0, az = gp.axes[1] || 0;
      const mag = Math.hypot(ax, az);
      if (mag < 0.22) { ax = 0; az = 0; }
      else { const k = Math.min(1, (mag - 0.22) / 0.7) / mag; ax *= k; az *= k; }
      if (b(12)) az = -1; if (b(13)) az = 1; if (b(14)) ax = -1; if (b(15)) ax = 1;
      d.mx = ax; d.mz = az;
      const rs = Math.hypot(gp.axes[2] || 0, gp.axes[3] || 0);
      d.held.pass = b(0);
      d.held.shoot = b(1) || (b(5) && false);
      d.held.lob = b(2);
      d.held.through = b(3);
      d.held.switch = b(4);
      d.held.super = b(5) && b(1);
      d.held.skill = (b(5) && !b(1)) || b(11) || rs > 0.75;
      d.held.finesse = b(6);
      d.held.sprint = b(7);
      d.held.pause = b(9);
      d.held.confirm = b(0);
      d.held.back = b(1);
      if (mag > 0.3 || gp.buttons.some(x => x && x.pressed)) d.lastActive = now;

      // 菜单导航（带重复）
      const st = this.padState[id] || (this.padState[id] = { dir: null, t: 0 });
      let dir = null;
      if (az < -0.55) dir = 'up'; else if (az > 0.55) dir = 'down'; else if (ax < -0.55) dir = 'left'; else if (ax > 0.55) dir = 'right';
      if (dir && (dir !== st.dir || now - st.t > 0.22)) { this._emitNav(dir, id); st.t = dir !== st.dir ? now + 0.2 : now; }
      st.dir = dir;
      if (d.pressed('confirm')) this._emitNav('confirm', id);
      if (d.held.back && !d.prev.back) this._emitNav('back', id);
      if (d.pressed('pause')) this._emitNav('pause', id);
      if (b(4) && !st.lb) this._emitNav('tabPrev', id);
      if (b(5) && !st.rb) this._emitNav('tab', id);
      st.lb = b(4); st.rb = b(5);
      if (gp.buttons.some(x => x && x.pressed)) for (const fn of this.anyListeners) fn(id);
    }
    for (const id in this.devices) {
      if (id.startsWith('pad') && !seen.has(id) && this.devices[id].connected) {
        this.devices[id].connected = false;
        this._emitNav('devices');
      }
    }
  }

  // 帧末调用：记录上一帧按键状态用于边沿检测
  commit() { for (const d of Object.values(this.devices)) d._commit(); }

  rumble(devId, strong = 0.5, ms = 120) {
    if (!devId || !devId.startsWith('pad')) return;
    const gp = navigator.getGamepads?.()[+devId.slice(3)];
    const act = gp?.vibrationActuator;
    if (act?.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: strong * 0.6 }).catch(() => {});
  }
}
