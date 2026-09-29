// 全局常量：场地尺寸、物理参数、玩法调校（1 单位 = 1 米）

export const F = {
  L: 84,              // 球场长（x 方向，球门在 ±L/2）
  W: 54,              // 球场宽（z 方向）
  goalHalfW: 3.9,     // 球门半宽（略大于标准，街机手感）
  goalH: 2.6,         // 横梁高
  goalDepth: 2.0,     // 球网深度
  postR: 0.1,         // 门柱半径
  boxDepth: 14,       // 大禁区深
  boxHalfW: 13.5,     // 大禁区半宽
  smallDepth: 5,      // 小禁区深
  smallHalfW: 7,      // 小禁区半宽
  penSpot: 10,        // 点球点距门线
  centerR: 7.5,       // 中圈半径
  boardX: 46.5,       // 底线外广告板（笼式模式的墙）
  boardZ: 30,         // 边线外广告板
};
F.hl = F.L / 2;
F.hw = F.W / 2;

export const PHYS = {
  g: 13.5,            // 重力（略大于真实，弧线更利落）
  ballR: 0.22,
  airDrag: 0.0032,    // 二次空气阻力系数
  magnus: 0.0068,     // 马格努斯系数（弧线球）
  restitution: 0.56,
  rollC0: 1.15,       // 滚动摩擦常数项
  rollC1: 0.26,       // 滚动摩擦线性项
  spinDecayAir: 0.35,
  spinDecayGround: 4,
};

// 天气对物理的影响
export const WEATHER_PHYS = {
  clear: { roll: 1, bounce: 1 },
  rain: { roll: 0.72, bounce: 0.85 },   // 湿滑：球跑得更远
  snow: { roll: 1.5, bounce: 0.7 },     // 积雪：球滚得更慢
};

export const TUNE = {
  runSpeed: 6.3,       // 基础跑速
  sprintMul: 1.42,
  dribbleMul: 0.93,
  accel: 26,
  decel: 30,
  controlR: 0.78,      // 控球半径
  shootCharge: 0.95,   // 蓄满力所需秒数
  perfectLo: 0.7,      // 完美射门窗口
  perfectHi: 0.86,
  feverMax: 100,
};

export const DIFFS = {
  easy:   { key: 'easy',   label: '新手', react: 0.42, noise: 0.35, aimErr: 0.1,  tackle: 0.55, keeper: 0.55, speed: 0.92, press: 1, reckless: 0.35, skill: 0.1 },
  normal: { key: 'normal', label: '职业', react: 0.26, noise: 0.18, aimErr: 0.06, tackle: 0.9,  keeper: 0.72, speed: 0.98, press: 1, reckless: 0.2,  skill: 0.25 },
  hard:   { key: 'hard',   label: '明星', react: 0.15, noise: 0.08, aimErr: 0.035, tackle: 1.25, keeper: 0.86, speed: 1.02, press: 2, reckless: 0.12, skill: 0.45 },
  legend: { key: 'legend', label: '传奇', react: 0.07, noise: 0.03, aimErr: 0.02, tackle: 1.6,  keeper: 0.95, speed: 1.06, press: 2, reckless: 0.06, skill: 0.65 },
};

// 玩家这一方 AI 队友的水平
export const ALLY_AI = { key: 'ally', react: 0.18, noise: 0.1, aimErr: 0.045, tackle: 1.0, keeper: 0.8, speed: 1, press: 1, reckless: 0.15, skill: 0.3 };

export const DEVICE_COLORS = ['#ffd23f', '#4dd7ff', '#ff6bd6', '#7dff7a'];
