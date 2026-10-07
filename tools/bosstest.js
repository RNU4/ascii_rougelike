// Scratch test (not loaded by the game): fights each crypt boss with a tough hero and records what its pattern did.
function bossTest(name, turns = 200, kite) {
  const g = game, out = { name, events: {}, errors: [], turns: 0 };
  let boss;
  for (let k = 0; k < 10 && !boss; k++) { g.start(CLASSES[0]); boss = g.monsters.find(m => m.name === name); }
  if (!boss) return { name, missing: true };
  const p = g.player;
  Object.assign(p, { maxHp: 99999, hp: 99999 });
  const spot = g.map.cells((x, y) => g.map.walkable(x, y) && !g.occupied(x, y) && dist({ x, y }, boss) === 3 && g.map.hasLos(boss, { x, y }))[0];
  Object.assign(p, spot);
  g.updateView?.();
  const log = g.log; g.log = function (msg, c) { const k = String(msg).replace(/\d+/g, '#').slice(0, 60); out.events[k] = (out.events[k] || 0) + 1; return log.call(this, msg, c); };
  for (let i = 0; i < turns && boss.alive !== false && g.state === 'play'; i++) {
    out.turns = i;
    try {
      const d = dist(p, boss);
      const away = [Math.sign(p.x - boss.x), Math.sign(p.y - boss.y)];
      const step = kite ? (d < 3 && boss.alive ? away : chance(0.5) ? [0, 0] : pick(DIRS)) : d <= 1 && boss.alive ? [Math.sign(boss.x - p.x), Math.sign(boss.y - p.y)]
        : boss.alive && chance(0.7) ? [Math.sign(boss.x - p.x), Math.sign(boss.y - p.y)] : pick(DIRS);
      g.act(() => (step[0] || step[1] ? g.move(step[0], step[1]) : true) || true);
      p.hp = p.maxHp;
    } catch (e) { out.errors.push(e.message + ' ' + (e.stack || '').split('\n')[1]); break; }
  }
  g.log = log;
  out.bossHp = boss.hp + '/' + boss.maxHp; out.alive = boss.alive;
  out.minions = g.monsters.filter(m => m.alive && m.raisedBy === boss).length;
  return out;
}
