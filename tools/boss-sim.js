// Boss balance sim (dev tool, not loaded by the game; inject after balance-sim.js - uses simGear). A bot hero of a class at
// level `lvl` (core skills + a tome skill per 2 levels, gear and potions with `items`) walks into a boss's room on the boss
// test floor (EXTRA_FLOORS.bosstest) and fights it to the death. The bot steps off marked (danger) tiles first - a player
// reading the telegraphs - then drinks below 35% HP, casts (aiCast), melees; ranged classes hold at range.
// simBoss(cls, 'Lich', 5, { items: true }) -> { win, hp (share left), turns }. bossSim({ trials, lvls, bosses }) -> win% table.
function simBoss(cls, bossName, lvl, { items = true, pieces, trace = null, floor = null } = {}) { // pieces: gear slots filled (all by default); floor: { depth, testLevel?, side? } (default: the boss test room)
  const g = game, noop = () => {};
  Object.assign(g, { render: noop, log: m => (trace?.push(`${g.turn} ${g.player?.hp}hp: ${m}`), ''), gameOver: () => { g.state = 'over'; } });
  Object.assign(g.fx, { flash: noop, bolt: noop, area: noop, add: noop, puff: noop, float: noop });
  g.start(cls);
  Object.assign(g, { testLevel: EXTRA_FLOORS.bosstest, depth: 3, side: null }, floor && { testLevel: null, side: null, ...floor });
  g.loadLevel();
  const p = g.player;
  p.inv = [];
  while (p.lvl < lvl) p.gainXp(xpToNext(p.lvl) - p.xp, g);
  p.skills.push(...poolPicks(p, lvl >> 1));
  p.skills = p.skills.slice(0, ACTIVE_SKILLS);
  p.gainXp = () => {};
  if (items) simGear(g, p, g.depth, pieces);
  const boss = g.monsters.find(m => m.name === bossName);
  const r = g.map.arenas?.find(a => inRect(a.r, boss))?.r, home = { x: boss.x, y: boss.y };
  const inside = c => (r ? inRect(r, c) : dist(c, home) <= 10); // (no boss room: the 10 tiles round where it started)
  // where to head while the boss is out of sight (under water, in the dark): the walkable tile nearest where it started
  const approach = g.map.cells((x, y) => g.map.walkable(x, y)).sort((a, b) => dist(a, home) - dist(b, home))[0];
  const spot = shuffle(g.map.cells((x, y) => inside({ x, y }) && g.map.walkable(x, y) && !g.occupied(x, y) && dist({ x, y }, boss) >= 5))[0];
  Object.assign(p, spot);
  g.updateView();
  const ranged = cls.ranged || cls.support;
  const danger = () => new Set((g.map.dangers || []).filter(d => d.owner.alive).flatMap(d => d.tiles.map(c => c.x + ',' + c.y)));
  for (let it = 0; it < 1500 && g.state === 'play' && !(boss.hp <= 0 && !boss.underground) && g.turn < 600; it++) {
    const foes = g.monsters.filter(m => m.alive && !m.ally && g.hostile(p, m) && inside(m) && (g.seesMonster(m) || m.rooted && boss.status.phased) && (!m.rooted || m === boss || boss.status.phased))
      .sort((a, b) => (boss.status.phased && (!!b.rooted - !!a.rooted)) || dist(a, p) - dist(b, p)); // (a shielded boss: smash what feeds the shield first)
    const ph = g.monsters.find(m => m.alive && m.name === 'phylactery');
    const foe = foes[0] || (ph && inside(ph) ? ph : null);
    g.act(() => {
      const dz = danger();
      if (dz.has(p.x + ',' + p.y)) { // get off a marked tile - or at least further from whoever marked it
        const owner = (g.map.dangers || []).find(d => d.owner.alive && d.tiles.some(c => c.x === p.x && c.y === p.y))?.owner;
        const steps = shuffle(DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })));
        if (steps.find(c => !dz.has(c.x + ',' + c.y) && g.moveTo(p, c.x, c.y))) return true;
        if (owner && steps.filter(c => dist(c, owner) > dist(p, owner)).find(c => g.moveTo(p, c.x, c.y))) return true;
      }
      if (p.hp < p.maxHp * 0.35 && p.inv.some(i => i.heals) && g.quaff()) return true;
      const runFor = foe && foe.rooted && foe !== boss && boss.status.phased && dist(p, foe) > (ranged ? 5 : 1); // (shielded boss: go and smash what feeds it)
      if (foe && !runFor && aiCast(g, p, foe)) return true;
      if (foe && dist(p, foe) === 1) return (ranged && !foe.rooted && g.stepAway(p, foe)) || (p.attack(foe, g), true);
      if (foe && !runFor && ranged && dist(p, foe) <= 5 && g.map.hasLos(p, foe)) return true;
      const goal = foe || (g.seesMonster(boss) ? boss : approach);
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
function bossSim({ trials = 10, lvls = [3, 5, 7], bosses = SIM_BOSSES, classes = null, items = true, pieces, floor } = {}) {
  const rows = {};
  for (const cls of CLASSES.filter(c => !classes || classes.includes(c.key)))
    for (const b of bosses)
      rows[cls.key + ' ' + b] = lvls.map(l => {
        const res = Array.from({ length: trials }, () => simBoss(cls, b, l, { items, pieces, floor }));
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
// Error fuzz on a floor: every class plays `turns` random turns (moves, skills at the nearest foe, waits) with HP topped up,
// walking toward the floor's monsters - returns { turns, errors: [...] }. floor: as for simBoss.
function fuzzFloor(floor, turns = 300) {
  const g = game, errors = [];
  let n = 0;
  for (const cls of CLASSES) {
    g.start(cls);
    Object.assign(g, { testLevel: null, side: null, ...floor });
    g.loadLevel();
    const p = g.player;
    for (let i = 0; i < turns && g.state === 'play'; i++) {
      try {
        Object.assign(p, { maxHp: 9999, hp: 9999 });
        const foe = g.monsters.filter(m => m.alive && !m.ally && !m.partOf).sort((a, b) => dist(a, p) - dist(b, p))[0];
        if (chance(0.3) && foe) {
          g.useSkill(rand(0, 4));
          if (g.targeting) { g.aim = { x: foe.x, y: foe.y }; g.handleKey({ key: 'Enter', code: 'Enter', preventDefault() {} }); }
          g.targeting = g.menu = null;
          g.act(() => true);
        } else {
          const d = foe && chance(0.7) ? [Math.sign(foe.x - p.x), Math.sign(foe.y - p.y)] : pick(DIRS);
          g.act(() => g.move(d[0], d[1]) || true);
        }
        g.menu = null;
        n++;
      } catch (e) { errors.push(`${cls.key}: ${e.message} ${(e.stack || '').split('\n')[1]}`); break; }
    }
  }
  return { turns: n, errors };
}
