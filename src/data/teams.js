// 球队数据库（全部虚构）。rating: att 进攻 / pas 传控 / def 防守 / spd 速度 / gk 门将

export const PATTERNS = [
  { id: 'solid', label: '纯色' },
  { id: 'stripes', label: '竖条' },
  { id: 'hoops', label: '横条' },
  { id: 'sash', label: '斜带' },
  { id: 'halves', label: '半色' },
  { id: 'chevron', label: 'V 字' },
];

export const KIT_COLORS = ['#d62828', '#f77f00', '#fcbf49', '#2a9d8f', '#1d4ed8', '#0ea5e9', '#7c3aed', '#db2777',
  '#16a34a', '#84cc16', '#111827', '#ffffff', '#6b7280', '#92400e', '#0f766e', '#e11d48'];

export const TEAMS = [
  { id: 'blaze', name: '赤焰联', abbr: 'BLZ', kit: { primary: '#d62828', secondary: '#ffffff', pattern: 'solid', shorts: '#ffffff', socks: '#d62828' },
    rating: { att: 78, pas: 74, def: 70, spd: 76, gk: 72 }, players: ['韩烈', '邓锋', '孙逸', '高翔', '陈炎'], star: 4 },
  { id: 'ocean', name: '蓝海舰队', abbr: 'OCN', kit: { primary: '#1d4ed8', secondary: '#93c5fd', pattern: 'hoops', shorts: '#0b1f4d', socks: '#1d4ed8' },
    rating: { att: 72, pas: 78, def: 74, spd: 70, gk: 76 }, players: ['林海', '许浪', '周航', '吴帆', '郑洋'], star: 2 },
  { id: 'lions', name: '金狮', abbr: 'LIO', kit: { primary: '#fcbf49', secondary: '#111827', pattern: 'stripes', shorts: '#111827', socks: '#fcbf49' },
    rating: { att: 84, pas: 80, def: 78, spd: 80, gk: 80 }, players: ['狄王', '贺猛', '石坚', '卢冠', '金啸'], star: 4 },
  { id: 'bamboo', name: '翠竹', abbr: 'BAM', kit: { primary: '#16a34a', secondary: '#ffffff', pattern: 'hoops', shorts: '#ffffff', socks: '#16a34a' },
    rating: { att: 66, pas: 72, def: 68, spd: 70, gk: 64 }, players: ['竹青', '柳松', '梅岭', '兰影', '菊风'], star: 3 },
  { id: 'thunder', name: '紫电', abbr: 'THD', kit: { primary: '#7c3aed', secondary: '#fde047', pattern: 'sash', shorts: '#1e1b4b', socks: '#7c3aed' },
    rating: { att: 80, pas: 70, def: 66, spd: 84, gk: 68 }, players: ['雷鸣', '闪亮', '霆锋', '电光', '霹雳'], star: 4 },
  { id: 'crane', name: '白鹤', abbr: 'CRN', kit: { primary: '#ffffff', secondary: '#0b1f4d', pattern: 'chevron', shorts: '#0b1f4d', socks: '#ffffff' },
    rating: { att: 70, pas: 82, def: 76, spd: 68, gk: 74 }, players: ['鹤年', '云飞', '羽清', '白翎', '松涛'], star: 2 },
  { id: 'obsidian', name: '黑曜', abbr: 'OBS', kit: { primary: '#111827', secondary: '#f77f00', pattern: 'halves', shorts: '#111827', socks: '#f77f00' },
    rating: { att: 76, pas: 72, def: 82, spd: 72, gk: 82 }, players: ['墨城', '玄铁', '夜岩', '黑石', '曜辰'], star: 3 },
  { id: 'citrus', name: '橙风', abbr: 'CIT', kit: { primary: '#f77f00', secondary: '#ffffff', pattern: 'solid', shorts: '#111827', socks: '#f77f00' },
    rating: { att: 64, pas: 64, def: 62, spd: 72, gk: 60 }, players: ['橙子', '柚子', '柑橘', '金桔', '橘光'], star: 4 },
  { id: 'glacier', name: '冰川', abbr: 'GLC', kit: { primary: '#0ea5e9', secondary: '#ffffff', pattern: 'stripes', shorts: '#ffffff', socks: '#0ea5e9' },
    rating: { att: 68, pas: 74, def: 72, spd: 66, gk: 70 }, players: ['冰峰', '雪原', '寒冰', '霜天', '冻雨'], star: 1 },
  { id: 'sakura', name: '樱花', abbr: 'SKR', kit: { primary: '#db2777', secondary: '#fbcfe8', pattern: 'sash', shorts: '#ffffff', socks: '#db2777' },
    rating: { att: 74, pas: 76, def: 64, spd: 78, gk: 66 }, players: ['樱井', '花见', '春日', '夜樱', '千本'], star: 3 },
  { id: 'eagles', name: '沙漠之鹰', abbr: 'EGL', kit: { primary: '#92400e', secondary: '#fcd34d', pattern: 'chevron', shorts: '#fcd34d', socks: '#92400e' },
    rating: { att: 70, pas: 66, def: 74, spd: 74, gk: 72 }, players: ['漠北', '鹰眼', '沙丘', '驼铃', '烈日'], star: 1 },
  { id: 'dragons', name: '神龙', abbr: 'DRG', kit: { primary: '#e11d48', secondary: '#fcbf49', pattern: 'halves', shorts: '#fcbf49', socks: '#e11d48' },
    rating: { att: 90, pas: 86, def: 84, spd: 86, gk: 86 }, players: ['龙腾', '敖天', '青鳞', '云霄', '真龙'], star: 4 },
];

export function teamById(id) { return TEAMS.find(t => t.id === id); }

export function overall(r) {
  return Math.round(r.att * 0.26 + r.pas * 0.2 + r.def * 0.22 + r.spd * 0.18 + r.gk * 0.14);
}

export function starsOf(r) {
  const o = overall(r);
  return Math.max(1, Math.min(5, Math.round((o - 55) / 7 * 2) / 2));
}

// 由自建俱乐部存档生成球队
export function clubTeam(club) {
  const base = 60;
  const up = club.upgrades;
  return {
    id: 'club', name: club.name, abbr: club.abbr, kit: { ...club.kit }, isClub: true,
    rating: {
      att: base + up.att * 3.5, pas: base + up.pas * 3.5, def: base + up.def * 3.5,
      spd: base + up.spd * 3.5, gk: base + up.gk * 3.5,
    },
    players: club.players.slice(), star: 4,
  };
}

// 阵型（进攻方向坐标系：x∈[0,1] 从本方底线到对方底线，z∈[-1,1]）
export const ROLES = ['GK', 'DF', 'LM', 'RM', 'FW'];
export const FORMATION = {
  GK: { def: [0.02, 0], att: [0.06, 0] },
  DF: { def: [0.2, 0], att: [0.44, 0] },
  LM: { def: [0.34, -0.5], att: [0.66, -0.66] },
  RM: { def: [0.34, 0.5], att: [0.66, 0.66] },
  FW: { def: [0.5, 0.05], att: [0.86, 0.08] },
};

// 由球队评分派生单个球员能力（0~100）
export function playerStats(team, idx) {
  const r = team.rating;
  const role = ROLES[idx];
  const star = team.star === idx ? 7 : 0;
  const j = n => Math.max(35, Math.min(99, Math.round(n)));
  const noise = seedNoise(team.id + idx);
  const s = {
    spd: r.spd + noise * 4, sht: r.att + noise * 3, pas: r.pas, tck: r.def, sta: 70 + noise * 10, gk: r.gk,
  };
  if (role === 'FW') { s.sht += 6; s.tck -= 10; s.spd += 3; }
  if (role === 'DF') { s.tck += 7; s.sht -= 10; s.spd -= 2; }
  if (role === 'LM' || role === 'RM') { s.pas += 4; s.spd += 2; }
  if (role === 'GK') { s.spd -= 10; s.sht -= 20; }
  for (const k of ['spd', 'sht', 'pas', 'tck']) s[k] += star;
  for (const k in s) s[k] = j(s[k]);
  return s;
}

function seedNoise(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 500 - 1;
}

// 杯赛
export const CUPS = [
  { id: 'rookie', name: '新秀杯', diff: 'easy', reward: 300, pool: [55, 74], desc: '初出茅庐的舞台，拿下它证明自己' },
  { id: 'elite', name: '精英杯', diff: 'normal', reward: 600, pool: [62, 80], desc: '真正的职业对抗，每一场都不轻松' },
  { id: 'champ', name: '冠军杯', diff: 'hard', reward: 1100, pool: [68, 86], desc: '强队云集，只有冠军配得上掌声' },
  { id: 'legend', name: '传奇杯', diff: 'legend', reward: 2200, pool: [72, 99], desc: '神龙在决赛等你。成为传奇吧' },
];

export const BALLS = [
  { id: 'classic', name: '经典黑白', price: 0, pent: '#141414', hex: '#f7f7f7', seam: '#9a9a9a' },
  { id: 'star', name: '星辉', price: 300, pent: '#d62828', hex: '#ffffff', seam: '#1d4ed8' },
  { id: 'winter', name: '冬季橙', price: 300, pent: '#1f2937', hex: '#ff7a00', seam: '#7c2d12' },
  { id: 'neon', name: '霓虹', price: 600, pent: '#7c3aed', hex: '#d9f99d', seam: '#16a34a' },
  { id: 'gold', name: '黄金', price: 1500, pent: '#3b2a05', hex: '#f5c542', seam: '#8a6d1f', metal: 0.6 },
];

export const CELEBRATIONS = ['arms', 'slide', 'plane', 'flip', 'dance'];
