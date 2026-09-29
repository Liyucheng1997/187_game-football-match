import { TEAMS, CUPS, overall, teamById, clubTeam } from '../data/teams.js';

// 杯赛生涯：8 队淘汰赛（1/4 决赛 → 半决赛 → 决赛）
export const ROUND_NAMES = ['1/4 决赛', '半决赛', '决赛'];

export function cupUnlocked(save, idx) {
  if (idx === 0) return true;
  return !!save.data.cupsWon[CUPS[idx - 1].id];
}

export function startCup(save, cupId) {
  const cup = CUPS.find(c => c.id === cupId);
  let pool = TEAMS.filter(t => { const o = overall(t.rating); return o >= cup.pool[0] && o <= cup.pool[1]; });
  if (pool.length < 7) pool = TEAMS.slice().sort((a, b) => Math.abs(overall(a.rating) - cup.pool[1]) - Math.abs(overall(b.rating) - cup.pool[1])).slice(0, 7);
  pool = shuffle(pool.slice()).slice(0, 7);
  if (cup.id === 'legend' && !pool.find(t => t.id === 'dragons')) pool[6] = teamById('dragons');
  const ids = ['club', ...pool.map(t => t.id)];
  // 保证最强队在另一半区
  const order = [ids[0], ids[1], ids[2], ids[3], ids[4], ids[5], ids[6], ids[7]];
  const round0 = [];
  for (let i = 0; i < 8; i += 2) round0.push({ a: order[i], b: order[i + 1], sa: null, sb: null });
  save.data.cupProgress = { cup: cup.id, round: 0, rounds: [round0], alive: true, champion: false };
  save.write();
  return save.data.cupProgress;
}

export function nextOpponent(save) {
  const cp = save.data.cupProgress;
  if (!cp || !cp.alive || cp.champion) return null;
  const m = cp.rounds[cp.round].find(x => x.a === 'club' || x.b === 'club');
  return m ? (m.a === 'club' ? m.b : m.a) : null;
}

export function teamFor(save, id) {
  return id === 'club' ? clubTeam(save.data.club) : teamById(id);
}

// 记录玩家比赛结果，模拟其他比赛，推进轮次
export function recordCupMatch(save, res) {
  const cp = save.data.cupProgress;
  const round = cp.rounds[cp.round];
  const mine = round.find(x => x.a === 'club' || x.b === 'club');
  const clubIsA = mine.a === 'club';
  mine.sa = clubIsA ? res.scoreA : res.scoreB;
  mine.sb = clubIsA ? res.scoreB : res.scoreA;
  if (res.shootout) { mine.pa = clubIsA ? res.shootout[0] : res.shootout[1]; mine.pb = clubIsA ? res.shootout[1] : res.shootout[0]; }
  const clubWon = (clubIsA ? 0 : 1) === res.winner;
  for (const m of round) if (m !== mine) simulate(save, m);
  if (!clubWon) { cp.alive = false; save.write(); return { eliminated: true }; }
  if (cp.round === 2) { cp.champion = true; save.write(); return { champion: true }; }
  const winners = round.map(winnerOf);
  const next = [];
  for (let i = 0; i < winners.length; i += 2) next.push({ a: winners[i], b: winners[i + 1], sa: null, sb: null });
  cp.rounds.push(next);
  cp.round++;
  save.write();
  return { advanced: true };
}

export function winnerOf(m) {
  if (m.sa === null) return null;
  if (m.sa !== m.sb) return m.sa > m.sb ? m.a : m.b;
  return (m.pa ?? 0) > (m.pb ?? 0) ? m.a : m.b;
}

function simulate(save, m) {
  const ra = overall(teamFor(save, m.a).rating), rb = overall(teamFor(save, m.b).rating);
  const la = 1.4 * Math.pow(ra / rb, 2.2), lb = 1.4 * Math.pow(rb / ra, 2.2);
  m.sa = poisson(la); m.sb = poisson(lb);
  if (m.sa === m.sb) { m.pa = 3 + (Math.random() * 3 | 0); m.pb = m.pa + (Math.random() < ra / (ra + rb) ? -1 : 1); if (m.pb < 0) m.pb = 0; }
}

function poisson(l) {
  let L = Math.exp(-l), k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return Math.min(7, k - 1);
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

export { CUPS };
