// Whole-run playthrough bot (dev tool, not loaded by the game). Inject after the game scripts, then
// `playRun('warrior')` -> { won, turns, floors: [...], bosses: [...], deathBy, log }. It plays a run start to finish
// through the real game (Game.move / act / takeStairs): explores each floor (walking to the nearest unseen tile, item
// worth having, captive, or a side-floor's way down - side-floors are visited when found, explored, and left by their
// upstairs), fights what it sees (aiCast, else melee), steps off marked (danger) tiles, drinks below 35% HP in a fight,
// rests to 90% out of combat below 55%, picks up and wears better gear, reads tomes (first offer). When a floor is
// explored it takes the way on: the stairs, or on the last floor the Crystal of Ages.
// It knows the map's layout (where walkable tiles are) but only goes for things it has seen. A bot, not a player:
// read the result as one plausible run.
function playRun(clsKey = 'warrior', { maxTurns = 40000, floorTurns = 5000, quiet = true } = {}) {
  const g = game, cls = CLASSES.find(c => c.key === clsKey), noop = () => {};
  const out = { cls: cls.title, floors: [], bosses: [], potions: 0, log: [] };
  const logIt = m => { const t = String(m).replace(/<[^>]+>/g, ''); out.log.push(`${g.turn} L${g.player?.lvl} ${g.player?.hp}hp: ${t}`); if (out.log.length > 400) out.log.shift(); };
  if (quiet) { g.render = noop; Object.assign(g.fx, { flash: noop, bolt: noop, area: noop, add: noop, puff: noop, float: noop }); }
  const log0 = g.log.bind(g);
  g.log = (m, c) => (logIt(m), log0(m, c));
  g.start(cls);
  const p = () => g.player;
  const od = g.onDeath.bind(g);
  g.onDeath = (v, k) => { if (isBoss(v) || v.boss || /chief/.test(v.name)) out.bosses.push({ name: v.name, turn: g.turn, lvl: p().lvl, hp: `${p().hp}/${p().maxHp}`, floor: g.level.name }); return od(v, k); };
  const ui0 = g.useItem.bind(g);
  g.useItem = it => { if (it.heals) out.potions++; return ui0(it); };

  const weight = cls.caster ? { atk: 1, int: 3 } : { atk: 3, int: 0.5 };
  const score = it => !it ? 0 : Object.entries(it.stats || {}).reduce((s, [k, v]) => s + v * ({ def: 3, hp: 0.4, mp: 0.1, crit: 0.3, dodge: 0.4, venom: 1, thorns: 1 }[k] ?? weight[k] ?? 0.2), 0);
  const better = it => it.kind === 'gear' && canWear(p(), it) && score(it) > score(p().gear[it.slot]);
  const STAIRS = ['stairs', 'upstairs', ...HUB_STAIRS];
  let floorKey = null, floorStart = 0, floor = null, ignore = new Set(), stuck = 0, chase = new Map(), visitedSides = new Set();
  const newFloor = () => {
    floorKey = g.floorKey() + (g.side ? '' : '|' + g.level.name); floorStart = g.turn; ignore = new Set(); chase = new Map();
    floor = { name: g.level.name, enterTurn: g.turn, lvl: p().lvl, hp: `${p().hp}/${p().maxHp}`, kills: 0, potions: out.potions };
    out.floors.push(floor);
  };
  newFloor();
  const od2 = g.onDeath;
  g.onDeath = (v, k) => { if (!v.ally && !v.partOf && floor) floor.kills++; return od2(v, k); };

  const hasKey = id => p().inv.some(i => i.kind === 'key' && i.id === id);
  const pass = (x, y) => { const t = TILES[g.map.get(x, y)]; return g.map.passable(x, y) && !(t.locked && !hasKey(t.key)) || (t.locked && hasKey(t.key)); };
  const noStairs = goal => (x, y) => pass(x, y) && (!STAIRS.includes(g.map.get(x, y)) || (x === goal.x && y === goal.y));
  const stepToward = (goal) => { // one step downhill on a distance map from the goal (stairs tiles kept out unless they're it)
    const d = g.map.distanceFrom(goal.x, goal.y, noStairs(goal)), q = p();
    const c = DIRS.map(([dx, dy]) => ({ dx, dy, x: q.x + dx, y: q.y + dy })).filter(c => d[c.y]?.[c.x] < d[q.y][q.x])
      .sort((a, b) => d[a.y][a.x] - d[b.y][b.x] || (a.dx && a.dy) - (b.dx && b.dy));
    for (const s of c) if (g.move(s.dx, s.dy) !== false) return true;
    return false;
  };
  const danger = () => new Set((g.map.dangers || []).filter(d => d.owner.alive).flatMap(d => d.tiles.map(c => c.x + ',' + c.y)));

  let lastTurn = -1, idle = 0, lastHp = 0, darkFoe = null;
  for (let it = 0; g.state === 'play' && g.turn < maxTurns && it < maxTurns * 3; it++) {
    if (g.turn === lastTurn && ++idle > 5) { g.act(() => true); idle = 0; } // (nothing it tried took a turn: wait one)
    if (g.turn !== lastTurn) { lastTurn = g.turn; idle = 0; }
    if (g.menu) { const row = g.menu.lines.find(l => l.run); if (/TOME/.test(g.menu.title) && row) row.run(); g.menu = null; continue; }
    const key = g.floorKey() + (g.side ? '' : '|' + g.level.name);
    if (key !== floorKey) { newFloor(); if (g.side) visitedSides.add(g.side === 'ossuary' ? 'bonestair' : 'hivestair'); }
    const q = p();
    for (const i of [...q.inv]) if (better(i)) g.equip(i); // wear upgrades (no turn in the bot's book)
    const dist0 = g.map.distanceFrom(q.x, q.y, pass);
    const foes = g.monsters.filter(m => m.alive && !m.ally && !m.captive && !m.partOf && g.hostile(q, m) && g.seesMonster(m) && g.map.visible[m.y]?.[m.x])
      .filter(m => dist(m, q) <= 1 || (dist0[m.y][m.x] <= 14 && (chase.get(m)?.n || 0) < 30) || m.shot && g.map.hasLos(q, m))
      .sort((a, b) => dist0[a.y][a.x] - dist0[b.y][b.x]);
    // hurt with nothing in sight (archers in the dark): head for the nearest hostile with a line on you, as a player would
    const hurt = q.hp < lastHp; lastHp = q.hp;
    const foe = foes[0] || (hurt ? g.monsters.filter(m => m.alive && !m.ally && !m.captive && !m.partOf && g.hostile(q, m) && dist(m, q) <= 10 && g.map.hasLos(m, q) && dist0[m.y][m.x] < Infinity)
      .sort((a, b) => dist(a, q) - dist(b, q))[0] : null) || (darkFoe?.alive && dist(darkFoe, q) <= 10 ? darkFoe : null);
    darkFoe = !foes[0] && foe ? foe : null;
    let acted = false;
    g.act(() => {
      const dz = danger();
      if (dz.has(q.x + ',' + q.y)) {
        const steps = shuffle(DIRS.map(([dx, dy]) => ({ dx, dy, x: q.x + dx, y: q.y + dy })));
        for (const s of steps) if (!dz.has(s.x + ',' + s.y) && pass(s.x, s.y) && !g.occupied(s.x, s.y) && !STAIRS.includes(g.map.get(s.x, s.y)) && g.moveTo(q, s.x, s.y)) return (acted = true);
      }
      const threatened = foe || g.monsters.some(m => m.alive && !m.ally && g.hostile(q, m) && g.seesMonster(m) && dist(m, q) <= 8);
      if (threatened && q.hp < q.maxHp * 0.35 && q.inv.some(i => i.heals) && g.quaff()) return (acted = true);
      if (foe) {
        const c = chase.get(foe) || { n: 0, d: dist0[foe.y][foe.x] };
        c.n = dist0[foe.y][foe.x] < c.d ? 0 : c.n + 1; c.d = dist0[foe.y][foe.x]; chase.set(foe, c);
        if (aiCast(g, q, foe)) return (acted = true);
        if (dist(q, foe) === 1 && g.map.canStep(q.x, q.y, foe.x, foe.y)) { q.attack(foe, g); c.n = 0; return (acted = true); }
        return (acted = stepToward(foe));
      }
      return false;
    });
    if (acted || g.state !== 'play') { stuck = 0; continue; }
    // Out of combat (or a foe it can't get at): rest, else explore / move on.
    if (!foe && q.hp < q.maxHp * 0.55 && !foes.length) { for (let r = 0; r < 400 && q.hp < q.maxHp * 0.9 && g.state === 'play' && !g.monsters.some(m => m.alive && !m.ally && g.hostile(q, m) && g.seesMonster(m) && g.map.visible[m.y]?.[m.x]); r++) g.act(() => true); continue; }
    const here = g.itemsAt(q.x, q.y).find(i => better(i) && q.inv.length < PACK_SIZE);
    if (here) { g.act(() => g.takeItem(here)); continue; }
    const seenAt = c => g.map.seen[c.y][c.x], reach = c => dist0[c.y]?.[c.x] < Infinity && !ignore.has(c.x + ',' + c.y);
    const exploring = g.turn - floorStart < floorTurns;
    let goals = [];
    if (exploring) {
      // a way down to a side-floor you haven't been to: go now (levels you up for the bosses)
      goals = g.side ? [] : g.map.cells((x, y) => HUB_STAIRS.includes(g.map.get(x, y)) && seenAt({ x, y }) && !visitedSides.has(g.map.get(x, y))).filter(reach);
      if (!goals.length) goals = [
        ...g.items.filter(i => seenAt(i) && i.kind !== 'crystal' && (['consumable', 'key', 'book'].includes(i.kind) || better(i))),
        ...g.monsters.filter(m => m.alive && m.captive && seenAt(m)),
        ...g.map.cells((x, y) => !g.map.seen[y][x] && pass(x, y)),
      ].filter(reach);
    }
    if (!goals.length) { // done here: the way on
      const t = g.side ? 'upstairs' : 'stairs';
      goals = [...g.items.filter(i => i.kind === 'crystal'), ...g.map.cells((x, y) => g.map.get(x, y) === t)].filter(reach);
    }
    // nothing left but no way on (the Lich re-forming while its phylactery stands in the dark): hunt what's left
    if (!goals.length) goals = g.monsters.filter(m => m.alive && !m.ally && !m.captive && !m.partOf && g.hostile(q, m)).filter(reach);
    const goal = goals.sort((a, b) => dist0[a.y][a.x] - dist0[b.y][b.x])[0];
    if (!goal) { // nothing it can get to: forget what it gave up on, wait, and try again (a while, then it's stuck)
      if (ignore.size) { ignore.clear(); continue; }
      g.act(() => true); if (++stuck > 200) { out.stuck = `${g.level.name}: nowhere left to go`; break; } continue;
    }
    let moved = false;
    g.act(() => (moved = stepToward(goal)));
    if (!moved) { ignore.add(goal.x + ',' + goal.y); if (++stuck > 300) { out.stuck = `${g.level.name}: stuck at ${q.x},${q.y}`; break; } }
    if (g.turn % 50 === 0) ignore.clear(); // (give-ups are only for a while: a monster in the way moves on)
    else stuck = 0;
  }
  out.won = g.state === 'over' && !g.dead;
  out.died = g.dead;
  out.turns = g.turn;
  out.end = { floor: g.level.name, lvl: p().lvl, hp: `${p().hp}/${p().maxHp}`, skills: p().skills.map(id => SKILLS[id].name),
    gear: Object.fromEntries(SLOTS.map(s => [s, p().gear[s] ? itemName(p().gear[s]).replace(/<[^>]+>/g, '') : null])) };
  if (g.dead) out.deathBy = out.log.slice(-12);
  g.log = log0;
  return out;
}
