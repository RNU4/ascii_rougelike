// Boss balance sim (dev tool, not loaded by the game; inject after balance-sim.js - uses simGear). A bot hero of a class at
// level `lvl` (core skills + a tome skill per 2 levels, gear and potions with `items`) walks into a boss's room on the boss
// test floor (EXTRA_FLOORS.bosstest) and fights it to the death. The bot steps off marked (danger) tiles first - a player
// reading the telegraphs - then drinks below 35% HP, casts (aiCast), melees; ranged classes hold at range.
// simBoss(cls, 'Lich', 5, { items: true }) -> { win, hp (share left), turns }. bossSim({ trials, lvls, bosses }) -> win% table.
function simBoss(cls, bossName, lvl, { items = true, pieces, trace = null } = {}) { // pieces: gear slots filled (all by default)
  const g = game, noop = () => {};
  Object.assign(g, { render: noop, log: m => (trace?.push(`${g.turn} ${g.player?.hp}hp: ${m}`), ''), gameOver: () => { g.state = 'over'; } });
  Object.assign(g.fx, { flash: noop, bolt: noop, area: noop, add: noop, puff: noop, float: noop });
  g.start(cls);
  Object.assign(g, { testLevel: EXTRA_FLOORS.bosstest, depth: 3, side: null });
  g.loadLevel();
  const p = g.player;
  p.inv = [];
  while (p.lvl < lvl) p.gainXp(xpToNext(p.lvl) - p.xp, g);
  p.skills.push(...poolPicks(p, lvl >> 1));
  p.skills = p.skills.slice(0, ACTIVE_SKILLS);
  p.gainXp = () => {};
  if (items) simGear(g, p, 3, pieces);
  const boss = g.monsters.find(m => m.name === bossName);
  const r = g.map.arenas.find(a => inRect(a.r, boss)).r;
  const inside = c => inRect(r, c);
  const spot = shuffle(g.map.cells((x, y) => inside({ x, y }) && g.map.walkable(x, y) && !g.occupied(x, y) && dist({ x, y }, boss) >= 5))[0];
  Object.assign(p, spot);
  g.updateView();
  const ranged = cls.ranged || cls.support;
  const danger = () => new Set((g.map.dangers || []).filter(d => d.owner.alive).flatMap(d => d.tiles.map(c => c.x + ',' + c.y)));
  for (let it = 0; it < 1500 && g.state === 'play' && !(boss.hp <= 0 && !boss.underground) && g.turn < 600; it++) {
    const foes = g.monsters.filter(m => m.alive && !m.ally && g.hostile(p, m) && inside(m) && g.seesMonster(m) && !m.rooted)
      .sort((a, b) => dist(a, p) - dist(b, p));
    const ph = g.monsters.find(m => m.alive && m.name === 'phylactery');
    const foe = foes[0] || (ph && inside(ph) ? ph : null);
    g.act(() => {
      const dz = danger();
      if (dz.has(p.x + ',' + p.y)) { // get off a marked tile
        const out = shuffle(DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))).find(c => !dz.has(c.x + ',' + c.y) && g.moveTo(p, c.x, c.y));
        if (out) return true;
      }
      if (p.hp < p.maxHp * 0.35 && p.inv.some(i => i.heals) && g.quaff()) return true;
      if (foe && aiCast(g, p, foe)) return true;
      if (foe && dist(p, foe) === 1) return (ranged && g.stepAway(p, foe)) || (p.attack(foe, g), true);
      if (foe && ranged && dist(p, foe) <= 5 && g.map.hasLos(p, foe)) return true;
      const goal = foe || boss;
      const dm = g.map.distanceFrom(goal.x, goal.y, (x, y) => g.map.passable(x, y));
      DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter(c => dm[c.y]?.[c.x] < dm[p.y][p.x] && !dz.has(c.x + ',' + c.y))
        .sort((a, b) => dm[a.y][a.x] - dm[b.y][b.x]).find(c => g.moveTo(p, c.x, c.y));
      return true; // (else it waits)
    });
  }
  const win = g.state === 'play' && !boss.alive && !boss.underground;
  return { win, hp: Math.max(0, p.hp) / p.maxHp, turns: g.turn };
}

const SIM_BOSSES = ['Death Knight', 'Wight', 'Banshee', 'Grave Serpent', 'Lich'];
function bossSim({ trials = 10, lvls = [3, 5, 7], bosses = SIM_BOSSES, classes = null, items = true, pieces } = {}) {
  const rows = {};
  for (const cls of CLASSES.filter(c => !classes || classes.includes(c.key)))
    for (const b of bosses)
      rows[cls.key + ' ' + b] = lvls.map(l => {
        const res = Array.from({ length: trials }, () => simBoss(cls, b, l, { items, pieces }));
        const wins = res.filter(x => x.win);
        return `${Math.round(100 * wins.length / trials)}%` + (wins.length ? `/${Math.round(100 * wins.reduce((a, x) => a + x.hp, 0) / wins.length)}hp` : '');
      }).join(' ');
  return rows;
}
// Runs bossSim a class at a time (so the page stays responsive), writing the table so far to document.body.dataset.st
// ('DONE' first once finished) - poll it from the test harness.
function runBossSims(opts) {
  const out = [], ks = CLASSES.map(c => c.key).filter(k => k !== 'necromancer'); // (undead bosses are kin to a necromancer - never fight it unprovoked)
  let i = 0;
  const step = () => {
    if (i >= ks.length) { document.body.dataset.st = 'DONE\n' + out.join('\n'); return; }
    for (const [k, v] of Object.entries(bossSim({ ...opts, classes: [ks[i++]] }))) out.push(k.padEnd(26) + v);
    document.body.dataset.st = out.join('\n');
    setTimeout(step, 10);
  };
  setTimeout(step, 10);
}
