// 本地存档：设置、俱乐部、金币、成就、生涯数据（localStorage）

const KEY = 'blazing-pitch-save-v2';

export const ACHIEVEMENTS = [
  { id: 'first_goal', name: '首开纪录', desc: '打进你的第一个进球', icon: '⚽' },
  { id: 'first_win', name: '初尝胜果', desc: '赢下第一场比赛', icon: '🥇' },
  { id: 'hat_trick', name: '帽子戏法', desc: '单场比赛个人进 3 球', icon: '🎩' },
  { id: 'super_goal', name: '热血之魂', desc: '用热血必杀射门破门', icon: '🔥' },
  { id: 'header_goal', name: '头球大师', desc: '头球或凌空破门', icon: '🦅' },
  { id: 'long_goal', name: '世界波', desc: '在 25 米外远射破门', icon: '🚀' },
  { id: 'fk_goal', name: '任意球专家', desc: '直接任意球破门', icon: '🎯' },
  { id: 'clean_sheet', name: '铜墙铁壁', desc: '零封对手取胜', icon: '🧱' },
  { id: 'comeback', name: '王者归来', desc: '落后情况下逆转取胜', icon: '💪' },
  { id: 'thrash', name: '大屠杀', desc: '净胜 5 球以上', icon: '💥' },
  { id: 'shootout', name: '点球英雄', desc: '赢得一次点球大战', icon: '🧤' },
  { id: 'tackles', name: '铲断机器', desc: '累计成功抢断 50 次', icon: '🦵' },
  { id: 'cup_rookie', name: '新秀冠军', desc: '赢得新秀杯', icon: '🏅' },
  { id: 'cup_elite', name: '精英冠军', desc: '赢得精英杯', icon: '🎖️' },
  { id: 'cup_champ', name: '冠军之冠', desc: '赢得冠军杯', icon: '🏆' },
  { id: 'cup_legend', name: '绿茵传奇', desc: '赢得传奇杯', icon: '👑' },
  { id: 'max_club', name: '豪门崛起', desc: '俱乐部所有属性升到满级', icon: '🏟️' },
  { id: 'veteran', name: '身经百战', desc: '累计完成 25 场比赛', icon: '📅' },
];

const DEFAULT = () => ({
  version: 2,
  coins: 200,
  settings: {
    master: 0.8, music: 0.5, sfx: 0.9, crowd: 0.8,
    quality: 'high', camera: 'broadcast', replays: true, autoSwitch: true, commentary: true, duration: 240, shake: true,
  },
  club: {
    name: '我的俱乐部', abbr: 'FCM',
    kit: { primary: '#e11d48', secondary: '#111827', pattern: 'stripes', shorts: '#111827', socks: '#e11d48' },
    upgrades: { att: 1, pas: 1, def: 1, spd: 1, gk: 1 },
    players: ['门神', '铁卫', '飞翼', '魔术师', '射手'],
  },
  ball: 'classic',
  ownedBalls: ['classic'],
  cupsWon: {},
  cupProgress: null,
  achievements: {},
  stats: { matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, conceded: 0, tackles: 0, superGoals: 0 },
});

export class Save {
  constructor() {
    this.data = DEFAULT();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = deepMerge(DEFAULT(), JSON.parse(raw));
    } catch (e) { /* 隐私模式等场景忽略 */ }
    this.listeners = [];
  }
  get s() { return this.data.settings; }
  write() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
  }
  onUnlock(fn) { this.listeners.push(fn); }
  unlock(id) {
    if (this.data.achievements[id]) return false;
    this.data.achievements[id] = Date.now();
    this.write();
    const a = ACHIEVEMENTS.find(x => x.id === id);
    for (const fn of this.listeners) fn(a);
    // Steam 版：由 desktop/preload 注入 window.steam 以同步 Steam 成就
    try { window.steam?.activateAchievement?.(id); } catch (e) { /* ignore */ }
    return true;
  }
  reset() { this.data = DEFAULT(); this.write(); }
}

function deepMerge(base, over) {
  if (typeof over !== 'object' || over === null || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const k in over) {
    out[k] = (typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}
