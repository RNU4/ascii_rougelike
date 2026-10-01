// Class balance sim (dev tool, not loaded by the game). Each trial: a bot-played hero of a class, levelled to a
// typical level for the depth with its core + a few tome skills (no companions; gear and potions only with
// `items: true` - see simGear), fights waves of that
// depth's monsters (3 at a time, the next wave once one is cleared, no rest) in an open cave arena under that level's
// rules (fov...), until it dies. Score = kills (endurance: damage, defence and sustain in one number).
// The bot casts with aiCast (the companion/enemy priorities), else melees; ranged classes back off and hold at range.
// Run on index.html (after the game scripts): inject this file, then `balanceSim({ trials: 30 })` -> rows per class.
// ponytail: a bot, not a player - it undervalues positioning tricks (jaunt, shadowstep, roll); read results relatively.
const SIM_LEVELS = [1, 3, 5, 6, 7, 8]; // hero level per depth (rough XP curve)
const SIM_WAVE = 3, SIM_MAX_KILLS = 120, SIM_MAX_TURNS = 3000;

// items mode: a gear set like one picked up by this depth - per slot, a random item from the dungeon's loot roll for the
// depth that this class can wear (casters-only gear goes to casters) - plus healing potions the bot drinks below 35% HP.
function simGear(g, p, depth) {
  for (const slot of SLOTS)
    for (let i = 0; i < 60; i++) { const it = makeGear(depth); if (it.slot === slot && canWear(p, it)) { p.gear[slot] = it; break; } }
  p.recalc(); p.hp = p.maxHp; p.mp = p.maxMp;
  g.addItem({ ...makeConsumable(CONSUMABLES[0]), count: 2 });
  if (depth >= 2) g.addItem({ ...makeConsumable(CONSUMABLES.find(c => c.name === 'Greater Healing')), count: 1 });
}

function simTrial(cls, depth, { boss = false, trace = null, items = false } = {}) { // trace: array that collects the game log
  const g = game, noop = () => {};
  Object.assign(g, { render: noop, log: m => (trace?.push(`${g.turn} ${game.player?.hp}hp: ${m}`), ''), gameOver: () => { g.state = 'over'; } });
  Object.assign(g.fx, { flash: noop, bolt: noop, area: noop, add: noop, puff: noop });
  g.state = 'play'; g.depth = depth; g.turn = 0; g.messages = []; g.floors = {}; g.allyStance = 'aggressive'; g.alliesHold = false;
  g.orb = g.coil = g.targeting = g.menu = null; g.items = []; g.monsters = []; g.sprouts = 0;
  const p = g.player = new Player(cls, 0, 0);
  while (p.lvl < SIM_LEVELS[depth]) p.gainXp(p.lvl * 20 - p.xp, g);
  p.skills.push(...poolPicks(p, depth + 1)); // roughly a tome per floor so far
  p.skills = p.skills.slice(0, ACTIVE_SKILLS);
  p.gainXp = () => {}; // no level-ups mid-fight
  if (items) simGear(g, p, depth);

  g.map = keepLargestRegion(genCaves(50, 26, { fill: 0.4 }), 'wall');
  g.map.computeLights();
  const floors = g.map.cells((x, y) => g.map.walkable(x, y));
  Object.assign(p, pick(floors));
  const d = g.map.distanceFrom(p.x, p.y, (x, y) => g.map.passable(x, y));
  const def = LEVELS[depth];
  const foesLeft = () => g.monsters.filter(m => m.alive && !m.ally && g.hostile(p, m));
  let kills = 0, spawned = 0;
  const wave = () => { // fresh monsters 6-10 steps away
    const dm = g.map.distanceFrom(p.x, p.y, (x, y) => g.map.passable(x, y));
    const spots = shuffle(floors.filter(c => dm[c.y][c.x] >= 6 && dm[c.y][c.x] <= 10 && !g.occupied(c.x, c.y)));
    const kinds = boss && !spawned ? [def.boss, pick(def.monsters)] : Array.from({ length: SIM_WAVE }, () => pick(def.monsters));
    kinds.forEach((k, i) => { if (!spots[i]) return; g.spawn(MONSTERS[k], spots[i]); spawned++; Object.assign(g.monsters[g.monsters.length - 1], { awake: true, provoked: true, home: spots[i] }); });
  };
  wave();
  g.updateView();

  const ranged = cls.ranged || cls.support;
  while (g.state === 'play' && spawned - foesLeft().length < SIM_MAX_KILLS && g.turn < SIM_MAX_TURNS) {
    if (!foesLeft().length) wave();
    const seen = foesLeft().filter(m => g.seesMonster(m)).sort((a, b) => dist(a, p) - dist(b, p)), foe = seen[0];
    g.act(() => {
      if (p.hp < p.maxHp * 0.35 && p.inv.some(i => i.heals)) return g.quaff(); // (only has potions in items mode)
      if (foe && aiCast(g, p, foe)) return true;
      if (foe && dist(p, foe) === 1) return (ranged && g.stepAway(p, foe)) || (p.attack(foe, g), true);
      if (foe && ranged && dist(p, foe) <= 5 && g.map.hasLos(p, foe)) return true; // hold at range
      const goal = foe || foesLeft().sort((a, b) => dist(a, p) - dist(b, p))[0];
      const dm = g.map.distanceFrom(goal.x, goal.y, (x, y) => g.map.passable(x, y));
      const step = DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter(c => dm[c.y]?.[c.x] < dm[p.y][p.x])
        .sort((a, b) => dm[a.y][a.x] - dm[b.y][b.x]).find(c => g.moveTo(p, c.x, c.y));
      return true;
    });
  }
  return { kills: spawned - foesLeft().length, turns: g.turn };
}

// Median kills per class and depth (median: a lucky capped run doesn't swamp the rest).
function balanceSim({ trials = 30, depths = [0, 1, 2, 3, 4, 5], boss = false, classes = null, items = false } = {}) { // classes: keys
  const rows = {};
  for (const cls of CLASSES.filter(c => !classes || classes.includes(c.key))) {
    rows[cls.key] = depths.map(depth => {
      const k = Array.from({ length: trials }, () => simTrial(cls, depth, { boss, items }).kills).sort((a, b) => a - b);
      return k[trials >> 1];
    });
  }
  return rows;
}
