// Multi-tile creatures (ai 'multibody': the Bone Colossus, snakes...): a core plus body parts (`part` template, each
// `partOf` the core; they share its HP - see Entity.hurt). Template: size (tiles at full HP), part, form ('mass' | 'chain'),
// remains (tile a lost part leaves, default bones), shedMsg. Helpers: its living parts (in chain order); how many it
// should have (size x HP share, the core counting as one); a free tile for a new part (next to the tail for a chain,
// anywhere on the mass otherwise); shedding parts when it has more than its HP allows (tail first for a chain, else the
// farthest from the core), each leaving its remains.
const bodyParts = m => (m.body ||= []).filter(s => s.alive);
const bodySize = m => Math.max(0, Math.ceil(m.size * m.hp / m.maxHp) - 1);
// Rigid form (spiders): every leg has a home slot in BODY_LAYOUTS[m.layout] (an offset from the core). A leg's glyph
// comes from where it is relative to the part it joins (the body, or an outer leg's inner leg): \ / │, or - when level
// with it - a flat line along the edge its joint is on: an upper leg's overline (top), a lower leg's underscore (bottom),
// meeting the body where the diagonal legs do. up: it's an upper leg (its slot is above the body).
function legGlyph(o, up) {
  return o.dx === 0 ? '│' : o.dy === 0 ? (up ? '‾' : '_') : o.dx * o.dy > 0 ? '\\' : '/';
}
// Where a leg part may go, best first: `first` (if given), its home, then every tile touching `anchor`, nearest home first.
const legSpots = (home, anchor, first) => [...(first ? [first] : []), home,
  ...DIRS.map(([dx, dy]) => ({ x: anchor.x + dx, y: anchor.y + dy })).sort((a, b) => dist(a, home) - dist(b, home))];
// The walk, modelled on a real spider. Each leg is a foot (its last part) planted on the ground, plus - for long legs -
// a knee between the body and the foot. Feet stay where they are while the body travels over them; the legs move in
// two alternating sets (diagonal pairs, a leg on each side - a trot): on each walking turn one set swings its feet
// forward to new footholds (as far ahead as fits near its slot, at the leg's full reach from the body) while the other
// set holds. A foot also steps whenever it can't hold (out of reach, its tile taken). Knees are worked out each turn:
// the free tile touching both body and foot, nearest the middle of the leg - so legs bend and straighten as the body
// passes over its feet. The body only advances if its new tile is free; it can pause a turn while legs reposition.
// A leg with nowhere to stand folds away (removed quietly; assembleBody grows it back once there's room) - a spider
// squeezing down a passage shows only the legs that fit. all: every foot re-plants (after a pounce), swept back along
// `trail` (the way it leapt) where it can.
function placeLegs(m, g, dir = { x: 0, y: 0 }, all = false, trail = { x: 0, y: 0 }) {
  const L = BODY_LAYOUTS[m.layout], parts = bodyParts(m), bySlot = i => parts.find(q => q.slot === i);
  const other = (x, y) => (g.player.x === x && g.player.y === y) || g.monsters.some(o => o.alive && o.x === x && o.y === y && o !== m && o.partOf !== m);
  const ahead = { x: m.x + dir.x, y: m.y + dir.y }, moved = !!(dir.x || dir.y) && g.map.walkable(ahead.x, ahead.y) && !other(ahead.x, ahead.y)
    && g.map.canStep(m.x, m.y, ahead.x, ahead.y);
  if (moved) { Object.assign(m, ahead); m.gait = !m.gait; }
  const taken = [], free = c => g.map.walkable(c.x, c.y) && !other(c.x, c.y) && !(c.x === m.x && c.y === m.y) && !taken.some(t => t.x === c.x && t.y === c.y);
  const fwd = c => (c.x - m.x) * dir.x + (c.y - m.y) * dir.y;
  // legs: a root slot (no `from`) and the slots growing out of it, one after another (a chain: root, knees, foot) - as many of them as are alive
  // from the root out; a leg that's lost its outer part is a shorter leg (the last part alive is its foot)
  const legs = L.map((o, i) => ({ o, i })).filter(({ o }) => o.from === undefined).map(({ o, i }) => {
    const chain = [i];
    for (let n; (n = L.findIndex(f => f.from === chain.at(-1))) >= 0;) chain.push(n);
    const segs = []; let gap = false;
    for (const k of chain) { const q = bySlot(k); if (!q) gap = true; else if (gap) q.hp = 0; else segs.push(q); } // every part beyond a gap folds too (the leg regrows from the body out)
    const fo = L[chain[segs.length - 1]] || o;
    return { o, segs, foot: segs.at(-1), knees: segs.slice(0, -1), reach: Math.max(Math.abs(fo.dx), Math.abs(fo.dy)), home: { x: m.x + fo.dx, y: m.y + fo.dy }, set: o.dx * o.dy > 0 };
  }).filter(l => l.foot);
  // the knees of a leg standing on f: [] (no knee), or the free tiles joining body to foot in a chain (touching the body, each other and the foot), nearest
  // the leg's straight line - so a long leg is straight at full reach and bends as the body passes over its foot. null: nowhere to put them.
  const kneesFor = (l, f) => {
    if (!l.knees.length) return [];
    const at = (c, x, y) => c.x === x && c.y === y, spots = DIRS.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }));
    if (l.knees.length === 1) {
      const k = spots.filter(c => dist(c, f) === 1 && !at(c, f.x, f.y) && free(c))
        .sort((a, b) => Math.hypot(a.x - (m.x + f.x) / 2, a.y - (m.y + f.y) / 2) - Math.hypot(b.x - (m.x + f.x) / 2, b.y - (m.y + f.y) / 2)
          || dist(a, { x: m.x + Math.sign(l.o.dx), y: m.y + Math.sign(l.o.dy) }) - dist(b, { x: m.x + Math.sign(l.o.dx), y: m.y + Math.sign(l.o.dy) }))[0];
      return k ? [k] : null;
    }
    const on = n => ({ x: m.x + (f.x - m.x) * n / 3, y: m.y + (f.y - m.y) * n / 3 }), i1 = on(1), i2 = on(2); // (two knees: a three-part leg)
    let best = null;
    for (const k1 of spots.filter(free)) for (const [dx, dy] of DIRS) {
      const k2 = { x: k1.x + dx, y: k1.y + dy };
      if (!free(k2) || at(k2, m.x, m.y) || at(k2, f.x, f.y) || dist(k2, f) !== 1 || at(k1, f.x, f.y)) continue;
      const cost = Math.hypot(k1.x - i1.x, k1.y - i1.y) + Math.hypot(k2.x - i2.x, k2.y - i2.y);
      if (!best || cost < best.cost) best = { cost, ks: [k1, k2] };
    }
    return best ? best.ks : null;
  };
  // a new foothold is at the leg's full reach; a planted foot holds bent in too (the body passing close over it)
  const stands = (l, f, planted) => free(f) && (dist(f, m) === l.reach || (planted && l.knees.length && dist(f, m) === l.reach - 1)) && kneesFor(l, f);
  const place = (l, f) => {
    const ks = kneesFor(l, f);
    taken.push(f, ...ks);
    Object.assign(l.foot, { x: f.x, y: f.y });
    let from = m; // (each part's glyph comes from where it is relative to the joint before it)
    l.knees.forEach((q, i) => { Object.assign(q, { x: ks[i].x, y: ks[i].y }); q.ch = legGlyph({ dx: ks[i].x - from.x, dy: ks[i].y - from.y }, l.o.dy < 0); from = ks[i]; });
    l.foot.ch = legGlyph({ dx: f.x - from.x, dy: f.y - from.y }, l.o.dy < 0);
  };
  // which feet hold: not re-planting, and (walking) not this set's turn to swing - unless it's fallen behind its slot
  const swings = l => all || (moved && l.set === m.gait && fwd(l.home) - fwd(l.foot) >= 2) || (moved && fwd(l.home) - fwd(l.foot) >= 3);
  const stepping = legs.filter(swings);
  for (const l of legs.filter(l => !swings(l))) stands(l, l.foot, true) ? place(l, l.foot) : stepping.push(l); // (checked as each is placed)
  for (const l of stepping) { // a new foothold at full reach, near its slot: furthest forward (walking), else nearest the slot
    const lead = all ? { x: l.home.x - trail.x, y: l.home.y - trail.y } : l.home;
    const spots = g.map.cells((x, y) => Math.abs(x - m.x) <= l.reach && Math.abs(y - m.y) <= l.reach && dist({ x, y }, lead) <= 2 && stands(l, { x, y }));
    const best = spots.sort((a, b) => (moved && !all ? fwd(b) - fwd(a) : 0) || dist(a, lead) - dist(b, lead) || dist(a, l.foot) - dist(b, l.foot))[0]
      || (stands(l, l.foot, true) ? l.foot : null);
    if (best) place(l, best);
    else l.segs.forEach(q => { q.hp = 0; }); // nowhere to stand: the leg folds away
  }
}
function bodyFrontier(g, m) {
  const parts = bodyParts(m), chain = m.form === 'chain';
  if (m.form === 'rigid') { // a missing leg grows back at its slot, or beside it if that's taken (by you, say) - still
    // joined on (touching the part it grows from) and no farther out than its slot
    const L = BODY_LAYOUTS[m.layout];
    for (const [i, o] of L.entries()) {
      if (parts.some(q => q.slot === i)) continue;
      const anchor = o.from === undefined ? m : parts.find(q => q.slot === o.from); // (an outer part can only grow from the part before it)
      if (!anchor) continue;
      const home = { x: m.x + o.dx, y: m.y + o.dy };
      const c = [...(anchor !== m ? [{ x: 2 * anchor.x - m.x, y: 2 * anchor.y - m.y }] : []), ...legSpots(home, anchor)].find(c => g.map.walkable(c.x, c.y) && !g.occupied(c.x, c.y)
        && dist(c, anchor) === 1 && dist(c, m) <= Math.max(Math.abs(o.dx), Math.abs(o.dy)) && (anchor === m || dist(c, m) > dist(anchor, m)));
      if (c) return { ...c, slot: i };
    }
    return null;
  }
  const from = chain ? [parts.at(-1) || m] : [m, ...parts];
  const cells = from.flatMap(p => DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))).filter(c => g.map.walkable(c.x, c.y) && !g.occupied(c.x, c.y));
  // a chain grows away from its prey (or its head), so its body trails behind instead of blocking the head's way
  const away = m.target || m;
  return chain ? cells.sort((a, b) => dist(b, away) - dist(a, away))[0] : cells[0];
}
// Mass form (Bone Colossus): how far a part may fall toward the core in one turn (see AI.multibody).
const MASS_REACH = 2;
// Mass form: the parts nearest the core fall in against it first, so the ones behind have room to fall in too (up to MASS_REACH tiles each),
// always against a part already placed (`placed`, starting with the core) - the body packs itself into a blob round the core and never splits.
// dm: steps to the core round the walls, so a part in a room corner finds the doorway; one with no way to join the body yet just closes in.
function packMass(m, g, parts, placed = [m]) {
  const near = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1, dm = g.map.distanceFrom(m.x, m.y, (x, y) => g.map.walkable(x, y));
  for (const q of [...parts].sort((a, b) => dm[a.y][a.x] - dm[b.y][b.x] || dist(a, m) - dist(b, m))) {
    for (let k = 0; k < MASS_REACH; k++) {
      const d2 = c => (c.x - m.x) ** 2 + (c.y - m.y) ** 2, nearer = c => dm[c.y][c.x] < dm[q.y][q.x] || (dm[c.y][c.x] === dm[q.y][q.x] && d2(c) < d2(q));
      const moves = DIRS.map(([dx, dy]) => ({ x: q.x + dx, y: q.y + dy })).filter(c => g.map.walkable(c.x, c.y) && !g.occupied(c.x, c.y) && g.map.canStep(q.x, q.y, c.x, c.y) && nearer(c));
      const joined = moves.filter(c => placed.some(p => near(p, c)));
      const c = (joined.length ? joined : moves).sort((x, y) => dm[x.y][x.x] - dm[y.y][y.x] || d2(x) - d2(y))[0];
      if (!c) break;
      Object.assign(q, c);
    }
    placed.push(q);
  }
}
// Surrounding (template `surround: { bonus }`, mass form): once a part touches its prey and the core is within 2 of it (so the body can't be
// stretched into a string after a runner) the body stops packing round the core and spreads round the prey instead - every part heads (up to MASS_REACH tiles a turn, round its mates) for a free tile touching it. Each part touching
// the prey past the first adds `bonus` to the damage of the Colossus's bite (see the end of AI.multibody).
function surroundTarget(m, g, t, body) {
  const mine = new Set([m, ...body]), free = (x, y) => !g.occupied(x, y) || mine.has(g.monsterAt(x, y)), at = (q, c) => q.x === c.x && q.y === c.y;
  const ring = DIRS.map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy })).filter(c => g.map.walkable(c.x, c.y) && g.map.canStep(c.x, c.y, t.x, t.y) && free(c.x, c.y));
  const open = ring.filter(c => ![m, ...body].some(q => at(q, c)));
  const spare = []; // parts with no free tile left round the prey (a corner, a wall): they pack in toward the core instead of standing about
  for (const q of body.filter(q => !ring.some(c => at(q, c))).sort((a, b) => dist(a, t) - dist(b, t))) { // the parts not touching it yet, nearest first
    const goal = open.reduce((a, b) => (!a || dist(b, q) < dist(a, q) ? b : a), null);
    if (!goal) { spare.push(q); continue; }
    const d = g.map.distanceFrom(goal.x, goal.y, (x, y) => g.map.walkable(x, y) && free(x, y)); // (round the other parts)
    if (d[q.y][q.x] > 4) { spare.push(q); continue; } // no short way to it (the far side of a prey in a passage, round a wall): it packs in instead of wandering off
    open.splice(open.indexOf(goal), 1);
    for (let k = 0; k < MASS_REACH && !at(q, goal); k++) {
      const c = DIRS.map(([dx, dy]) => ({ x: q.x + dx, y: q.y + dy })).filter(c => g.map.walkable(c.x, c.y) && !g.occupied(c.x, c.y) && g.map.canStep(q.x, q.y, c.x, c.y))
        .sort((x, y) => d[x.y][x.x] - d[y.y][y.x])[0];
      if (!c || d[c.y][c.x] >= d[q.y][q.x]) break;
      Object.assign(q, c);
    }
  }
  packMass(m, g, spare, [m, ...body.filter(q => !spare.includes(q))]);
}
// Grow the body back up to bodySize; returns the new parts.
function assembleBody(m, g) {
  const grown = [];
  for (let spot; bodyParts(m).length < bodySize(m) && (spot = bodyFrontier(g, m));) {
    g.spawn({ ...MONSTERS[m.part], def: m.def }, spot);
    const q = Object.assign(g.monsters.at(-1), { partOf: m, awake: true, provoked: m.provoked });
    if (spot.slot !== undefined) Object.assign(q, { slot: spot.slot, ch: legGlyph(BODY_LAYOUTS[m.layout][spot.slot]) });
    m.body.push(q); grown.push(q);
  }
  return grown;
}
// A snake whose head is boxed in (by walls and its own body) turns round: the head takes the tail's place and every
// part swaps with its mirror, so the old tail end leads (the parts look alike - only the head seems to jump ends).
function reverseChain(m) {
  const pieces = [m, ...bodyParts(m)], at = pieces.map(q => ({ x: q.x, y: q.y })).reverse();
  pieces.forEach((q, i) => Object.assign(q, at[i]));
  m.heading = null;
}
function shedBody(m, g) {
  let shed = 0;
  for (let parts = bodyParts(m); parts.length > bodySize(m); parts = bodyParts(m), shed++) {
    const s = m.form === 'chain' ? parts.at(-1) : parts.reduce((a, b) => (dist(b, m) > dist(a, m) ? b : a));
    if (s !== m) s.hp = 0;
    if (g.map.walkable(s.x, s.y) && !['stairs', 'upstairs'].includes(g.map.get(s.x, s.y))) g.map.set(s.x, s.y, m.remains || 'bones');
  }
  if (shed && g.map.visible[m.y]?.[m.x]) g.log(m.shedMsg ? `${m.shedMsg}` : `Pieces fall off ${m.obj}!`, m.color);
}

// Burrowing (monster field `burrow`, the bone worm): hurt since its last turn while its head is on or beside bones, it
// may dive in (50%, not again for 8 turns after it comes up) - its body sinks away, and it's out of play (Monster.alive)
// in map.under for 4-6 turns, then bursts up out of bones 2-4 tiles from you and reassembles.
function tryBurrow(m, g) {
  const hurt = m.hp < (m.hpSeen ?? m.hp);
  m.hpSeen = m.hp;
  if (m.burrowCd > 0) m.burrowCd--;
  const onBones = [[0, 0], ...DIRS].some(([dx, dy]) => g.map.get(m.x + dx, m.y + dy) === 'bones');
  if (!m.burrow || !hurt || m.burrowCd || !onBones || !chance(0.5)) return false;
  [m, ...bodyParts(m)].forEach((s, i) => { // head first, each part after it slithering down the same hole
    g.fx.float(s, s.ch, s.color, { css: 'sink', delay: i * 0.12 });
    if (s !== m) s.hp = 0;
  });
  g.fx.flash(m, '#4a3e28');
  m.body = [];
  m.underground = true;
  (g.map.under ||= []).push({ m, turns: rand(4, 6) });
  if (g.map.visible[m.y]?.[m.x]) g.log(`${m.subj} burrows down into the bones!`, m.color);
  return true;
}
// Phylactery (monster field `phylactery`: the template key of the thing keeping it alive - the Lich's): slain while its
// phylactery stands, it crumbles, waits in map.under and re-forms beside the phylactery 3 turns later at half HP.
// Called from onDeath.
function tryReform(m, g) {
  const ph = g.monsters.find(o => o.alive && o.name === MONSTERS[m.phylactery].name);
  if (!ph) return false;
  if (m.pending) { g.map.set(m.pending.x, m.pending.y, m.pending.was); delete m.pending; } // (an unfinished raise)
  g.fx.float(m, m.ch, m.color, { css: 'sink' });
  Object.assign(m, { hp: Math.ceil(m.maxHp / 2), status: {}, underground: true });
  (g.map.under ||= []).push({ m, turns: 3, at: ph, msg: `${m.subj} re-forms beside its phylactery!` });
  g.log(`${m.subj} crumbles to dust - but its phylactery pulses with a sickly light...`, m.color);
  g.log(`(While its phylactery stands, ${m.obj} cannot truly die. Smash the ${ph.ch} on the dais!)`, '#ffe070');
  return true;
}
// Brings buried / crumbled monsters back: beside u.at if given (a phylactery), else 2-4 tiles from you, out of bones if it can.
function tickBurrowed(g) {
  for (const u of [...(g.map.under || [])]) {
    if (--u.turns > 0) continue;
    const p = g.player, near = u.at || p, [lo, hi] = u.at ? [1, 1] : [2, 4];
    const free = g.map.cells((x, y) => g.map.walkable(x, y) && !g.occupied(x, y) && dist({ x, y }, near) >= lo && dist({ x, y }, near) <= hi);
    const spot = pick(free.filter(c => g.map.get(c.x, c.y) === 'bones')) || pick(free);
    if (!spot) continue; // nowhere to come up yet: tries again next turn
    g.map.under.splice(g.map.under.indexOf(u), 1);
    Object.assign(u.m, spot, { underground: false, burrowCd: 8, hpSeen: u.m.hp, target: p });
    g.monsters.push(u.m);
    // it bursts up head first, the body uncoiling out of the ground after it (css rise, staggered rd1..rd6)
    u.m.flashCss = { turn: g.turn, css: 'rise' };
    if (u.m.body) assembleBody(u.m, g).forEach((q, i) => (q.flashCss = { turn: g.turn, css: 'rise rd' + Math.min(i + 1, 6) }));
    if (g.map.visible[spot.y][spot.x]) { g.log(u.msg || `${u.m.subj} bursts up out of the bones!`, u.m.color); g.fx.flash(spot, '#665a40'); }
  }
}

// Monster behaviours, keyed by the `ai` field in MONSTERS. Behaviours compose each other.
// m.target is chosen each turn by Game.pickTarget: the player, an ally, or a monster of a rival faction.
const AI = {
  chase(m, g) {
    const t = m.target;
    if (dist(m, t) === 1) return m.attack(t, g);
    t === g.player ? g.stepAlongPath(m) : g.stepToward(m, t);
  },
  fast(m, g) { AI.chase(m, g); if (m.target.alive) AI.chase(m, g); },
  slow(m, g) { if (g.turn % 2 === 0) AI.chase(m, g); },
  wander(m, g) { g.stepToward(m, { x: m.x + rand(-1, 1), y: m.y + rand(-1, 1) }); },
  flee(m, g) { g.stepToward(m, { x: 2 * m.x - g.player.x, y: 2 * m.y - g.player.y }); },
  erratic(m, g) { chance(0.4) ? AI.wander(m, g) : AI.chase(m, g); },
  turret(m, g) { if (!m.status.silenced && g.inRange(m, m.target)) g.shoot(m, m.target); },
  ranged(m, g) {
    const t = m.target;
    if (dist(m, t) > 1 && !m.status.silenced && g.inRange(m, t)) return g.shoot(m, t);
    AI.chase(m, g);
  },
  // Spits webs at free prey from range (every 4 turns at most), then rushes in once it's stuck.
  webber(m, g) {
    const t = m.target;
    if (m.cooldown > 0) m.cooldown--;
    if (!m.cooldown && !t.status.webbed && dist(m, t) > 1 && !m.status.silenced && g.inRange(m, t)) {
      m.cooldown = 4;
      return g.shoot(m, t);
    }
    AI.chase(m, g);
  },
  // Drowned ones: lurk submerged in deep water until prey comes within 3 tiles (8 at high tide, when they roam
  // the flooded flats), then surge out. On land: chase.
  lurker(m, g) {
    const t = m.target;
    if (!TILES[g.map.get(m.x, m.y)].swim) return AI.chase(m, g);
    if (dist(m, t) === 1) return m.attack(t, g);
    if (dist(m, t) <= (g.tideHigh() ? 8 : 3)) g.stepToward(m, t);
  },
  // Drifts straight through walls (light-shunners won't drift into light).
  phase(m, g) {
    const t = m.target;
    if (dist(m, t) === 1) return m.attack(t, g);
    const x = m.x + Math.sign(t.x - m.x), y = m.y + Math.sign(t.y - m.y);
    if (g.map.inBounds(x, y) && !g.occupied(x, y) && !(m.shunLight && g.map.isLit(x, y))) Object.assign(m, { x, y });
  },
  // Boss summoner (Lich, Drowned Hag, bone forge): calls up minions from nearby tiles, blasts from range, never strays far
  // from home. raise = { from: [tiles], to?: tile left behind, monster, every: turns, max: alive at once, verb, color,
  // warn?: tile, warnMsg? }. With `warn` the raise is telegraphed: the spot turns into that (animated) tile a turn ahead
  // (m.pending; nobody can step onto it) and the minion rises from it next turn.
  summoner(m, g) {
    const t = m.target, r = m.raise, seen = spot => g.map.visible[m.y][m.x] || g.map.visible[spot.y][spot.x];
    if (m.cooldown > 0) m.cooldown--;
    if (m.pending) { // last turn's mark: up it comes
      const q = m.pending;
      m.pending = null;
      g.map.set(q.x, q.y, r.to || q.was);
      if (!g.occupied(q.x, q.y)) {
        g.spawn(MONSTERS[r.monster], q);
        Object.assign(g.monsters[g.monsters.length - 1], { awake: true, raisedBy: m, provoked: m.provoked });
        g.fx.flash(q, r.color);
        if (seen(q)) g.log(`${m.subj} ${r.verb}!`, m.color);
        return;
      }
    }
    const raised = g.monsters.filter(o => o.raisedBy === m && o.alive).length;
    const spot = !m.cooldown && raised < r.max && g.map.cells((x, y) => r.from.includes(g.map.get(x, y)) && dist({ x, y }, m) <= 5 && !g.occupied(x, y))
      .sort((a, b) => dist(a, m) - dist(b, m))[0];
    if (spot) {
      m.cooldown = r.highTideEvery && g.tideHigh() ? r.highTideEvery : r.every;
      if (r.warn) { // mark it: the minion rises there next turn
        m.pending = { ...spot, was: g.map.get(spot.x, spot.y) };
        g.map.set(spot.x, spot.y, r.warn);
        if (seen(spot)) g.log(r.warnMsg || `Something stirs near ${m.obj}...`, m.color);
        return;
      }
      if (r.to) g.map.set(spot.x, spot.y, r.to);
      g.spawn(MONSTERS[r.monster], spot);
      Object.assign(g.monsters[g.monsters.length - 1], { awake: true, raisedBy: m, provoked: m.provoked });
      g.fx.flash(spot, r.color);
      if (seen(spot)) g.log(`${m.subj} ${r.verb}!`, m.color);
      return;
    }
    if (!m.status.silenced && m.skills && aiCast(g, m, t)) return; // e.g. the Lich's Drain Life and Curse
    if (dist(m, t) === 1 && m.atk > 0) return m.attack(t, g); // (0 ATK - the bone forge - never swings)
    if (!m.status.silenced && g.inRange(m, t)) return g.shoot(m, t);
    if (dist(m, m.home) >= 4) return g.stepToward(m, m.home);
    AI.chase(m, g);
  },
  // Enemy spellcasters (e.g. goblin shaman): cast from their template `skills` with the same priorities as companions
  // (aiCast: heals, party buffs, then attacks; real cooldowns, INT scaling). Silence stops all casting. `kite`: backs
  // away from targets within 2. Otherwise fights like AI.chase.
  caster(m, g) {
    const t = m.target;
    if (!m.status.silenced && aiCast(g, m, t)) return;
    if (m.kite && dist(m, t) <= 2 && chance(0.6) && g.stepAway(m, t)) return;
    AI.chase(m, g);
  },
  // Hunters (the freed troll): track their target anywhere on the floor along real paths (pickTarget gives them the
  // nearest enemy even out of sight), then fight it.
  hunter(m, g) {
    const t = m.target;
    if (dist(m, t) === 1) return m.attack(t, g);
    g.stepAlongPath(m, g.map.distanceFrom(t.x, t.y, (x, y) => g.map.passable(x, y))) || g.stepToward(m, t);
  },
  // A multi-tile creature's core (see bodyParts). The core steps toward its prey along real paths; then the body follows,
  // every part moving at most a tile a turn (so it all slides smoothly; a mass part may fall in up to MASS_REACH):
  //  - form 'mass' (Bone Colossus): the parts nearest the core fall in against it first, then the ones behind (up to MASS_REACH tiles
  //    each, only onto tiles touching the part of the body already placed), packing the body into a blob round the core (a 3x3 minus one for 8 tiles; in a 1-wide passage it is
  //    a line, and re-forms within a few turns once it's out). A part with no way to join the body yet closes in on the core by
  //    path (`dm`). The core may swap with a part in its way. Attacks with whichever part touches its prey.
  //  - form 'chain' (snakes): follow the leader - each part moves into the tile the one ahead of it just left, so the
  //    body winds exactly along the head's path. Only the head bites.
  //  Parts cut off (knocked away) head back toward the one they belong next to.
  multibody(m, g) {
    if (tryBurrow(m, g)) return;
    assembleBody(m, g);
    const t = m.target, body = bodyParts(m), chain = m.form === 'chain', rigid = m.form === 'rigid', near = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
    const bites = () => t && (chain ? dist(m, t) === 1 : [m, ...body].some(q => dist(q, t) === 1));
    const old = [m, ...body].map(q => ({ x: q.x, y: q.y }));
    // a snake's head keeps clear of its own coils (touching: how many of its body parts, past the neck, a tile is next
    // to), so the body trails out behind it instead of piling up in a heap
    const touching = c => chain ? body.slice(1).filter(q => near(q, c)).length : 0;
    let want; // (rigid) the step it wants to take
    if (m.pounceCd > 0) m.pounceCd--;
    if (m.shotCd > 0) m.shotCd--;
    // pounce (rigid bodies): every pounce.every turns, a leap along a clear line onto prey 2..range tiles off
    if (rigid && m.pounce && t && !bites() && !m.pounceCd && dist(m, t) >= 2 && dist(m, t) <= m.pounce.range && g.map.hasLos(m, t)) {
      const path = line(m.x, m.y, t.x, t.y).slice(1, -1), mine = (x, y) => body.some(q => q.x === x && q.y === y);
      if (path.length && path.every(c => g.map.walkable(c.x, c.y) && (!g.occupied(c.x, c.y) || mine(c.x, c.y)))) {
        body.forEach(q => { if (path.some(c => c.x === q.x && c.y === q.y)) q.hp = 0; }); // (legs in the way fold up)
        Object.assign(m, path.at(-1));
        m.pounceCd = m.pounce.every;
        placeLegs(m, g, undefined, true, { x: Math.sign(t.x - m.x), y: Math.sign(t.y - m.y) });
        if (g.map.visible[m.y]?.[m.x]) g.log(`${m.subj} leaps at ${t.obj}!`, m.color);
        if (m.skirmish) m.backoff = 2;
        return m.attack(t, g, { mult: 1.5 });
      }
    }
    // spitting webs from range (web shot: m.shot + range), then closing in on stuck prey
    if (m.shot && m.range && t && !bites() && !m.shotCd && !t.status.webbed && !m.status.silenced && g.inRange(m, t)) {
      m.shotCd = 5;
      if (rigid) placeLegs(m, g);
      return g.shoot(m, t);
    }
    if (m.backoff > 0 && t) { // hit and run (skirmish): scuttle back from its prey for a couple of turns after striking
      m.backoff--;
      const mine = (x, y) => body.some(q => q.x === x && q.y === y);
      const c = DIRS.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy })).filter(c => g.map.walkable(c.x, c.y) && (!g.occupied(c.x, c.y) || mine(c.x, c.y))
        && g.map.canStep(m.x, m.y, c.x, c.y) && dist(c, t) > dist(m, t)).sort((a, b) => dist(b, t) - dist(a, t))[0];
      if (rigid) return placeLegs(m, g, c ? { x: c.x - m.x, y: c.y - m.y } : undefined); // (its legs carry it)
      if (c) Object.assign(m, c);
      return;
    }
    if (t && !bites()) { // the core / head: one step closer along real paths
      const dt = g.map.distanceFrom(t.x, t.y, (x, y) => g.map.passable(x, y)), own = (x, y) => !chain && body.find(q => q.x === x && q.y === y);
      const open = DIRS.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }))
        .filter(c => g.map.walkable(c.x, c.y) && (!g.occupied(c.x, c.y) || own(c.x, c.y)) && g.map.canStep(m.x, m.y, c.x, c.y));
      const byPath = (a, b) => dt[a.y][a.x] - dt[b.y][b.x] || touching(a) - touching(b);
      const c = open.filter(c => dt[c.y][c.x] < dt[m.y][m.x]).sort(byPath)[0]
        || (chain && open.filter(c => dt[c.y][c.x] <= dt[m.y][m.x] + 1).sort(byPath)[0]); // (a blocked head sidesteps)
      if (c && rigid) want = { x: c.x - m.x, y: c.y - m.y }; // (its legs carry it there - placeLegs)
      else if (c) { const o = own(c.x, c.y); if (o) Object.assign(o, old[0]); Object.assign(m, c); }
      else if (chain && !open.length) return reverseChain(m); // boxed in by walls and its own body: turn round
    } else if (!t && chain && chance(0.5)) { // nothing to hunt: a snake slithers about, mostly keeping its heading
      const open = DIRS.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy, dx, dy }))
        .filter(c => g.map.walkable(c.x, c.y) && !g.occupied(c.x, c.y) && g.map.canStep(m.x, m.y, c.x, c.y));
      const h = m.heading || {}, turn = c => Math.abs(c.dx - h.dx) + Math.abs(c.dy - h.dy) || 0;
      const wiggle = chance(0.25); // now and then it turns off its heading
      const c = shuffle(open).sort((a, b) => touching(a) - touching(b) || (wiggle ? 0 : turn(a) - turn(b)))[0];
      if (c) { m.heading = { dx: c.dx, dy: c.dy }; Object.assign(m, { x: c.x, y: c.y }); }
      else return reverseChain(m);
    }
    const step = (q, aim, ok) => { // one tile toward aim (or stay), among tiles passing ok()
      const cands = [{ x: q.x, y: q.y }, ...DIRS.map(([dx, dy]) => ({ x: q.x + dx, y: q.y + dy }))
        .filter(c => g.map.walkable(c.x, c.y) && !g.occupied(c.x, c.y) && g.map.canStep(q.x, q.y, c.x, c.y))];
      Object.assign(q, cands.sort((a, b) => ok(a) - ok(b) || dist(a, aim) - dist(b, aim))[0]);
    };
    if (rigid) placeLegs(m, g, want); // the legs walk, and carry the body (the gait)
    else if (chain) body.forEach((q, i) => { // each into the tile the one ahead just left (if that's a step away), else closer to it
      const ahead = i ? body[i - 1] : m, trail = old[i];
      if (near(q, trail) && !g.occupied(trail.x, trail.y)) Object.assign(q, trail);
      else if (!near(q, ahead)) step(q, ahead, c => (near(c, ahead) ? 0 : 1));
    });
    else if (m.surround && t && dist(m, t) <= 2 && bites()) surroundTarget(m, g, t, body); // its core is close and a part touches its prey: close round it
    else packMass(m, g, body); // mass: the body packs into a blob round the core
    if (m.lays && t && g.turn % m.lays.every === 0) { // laying eggs (Broodmother): beside its body, on open ground
      const spot = pick([m, ...bodyParts(m)].flatMap(q => DIRS.map(([dx, dy]) => ({ x: q.x + dx, y: q.y + dy })))
        .filter(c => ['floor', 'silkfloor', 'ash'].includes(g.map.get(c.x, c.y)) && !g.occupied(c.x, c.y) && dist(c, t) > 1));
      if (spot) { g.map.set(spot.x, spot.y, m.lays.tile); if (g.map.visible[spot.y][spot.x]) g.log(`${m.subj} lays a clutch of eggs!`, m.color); }
    }
    if (m.fangCd > 0) m.fangCd--;
    if (!bites()) { m.surrounding = false; return; }
    if (m.fang && !m.fangCd) { // its special bite, every `fang.every` turns
      m.fangCd = m.fang.every;
      if (g.map.visible[m.y]?.[m.x]) g.log(m.fang.msg, m.color);
      return m.attack(t, g, { mult: m.fang.mult, status: m.fang.status, verb: 'bite' });
    }
    const adj = m.surround ? [m, ...bodyParts(m)].filter(q => dist(q, t) === 1).length : 0; // (surround) parts touching its prey
    if (m.surround && adj >= 4 && !m.surrounding && g.map.visible[m.y]?.[m.x]) g.log(`${m.subj} closes in around ${t.obj}!`, m.color);
    m.surrounding = adj >= 4;
    m.attack(t, g, m.surround ? { mult: 1 + m.surround.bonus * Math.max(0, adj - 1) } : undefined);
    if (m.skirmish && chance(0.6)) m.backoff = 2; // (spiders) strike, then scuttle back
  },
  segment() {}, // a Colossus part: its core moves it
  // Silk weaver (Silk Hive): mends burnt silk (map.unburnt, reweave) within 10 tiles - and runs from anything hostile within 7 (along real paths,
  // to whichever neighbouring tile is farthest from it by walking), fighting back only when cornered. `busy`: runs even with nothing to hunt.
  weaver(m, g) {
    const t = m.target;
    const walk = (x, y) => g.map.walkable(x, y), dm = g.map.distanceFrom(m.x, m.y, walk); // (by real paths, round walls)
    if (t && dist(m, t) <= 7) {
      const dp = g.map.distanceFrom(t.x, t.y, walk);
      const away = DIRS.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }))
        .filter(c => walk(c.x, c.y) && !g.occupied(c.x, c.y) && g.map.canStep(m.x, m.y, c.x, c.y) && dp[c.y][c.x] > dp[m.y][m.x])
        .sort((a, b) => dp[b.y][b.x] - dp[a.y][a.x])[0];
      if (away) return g.moveTo(m, away.x, away.y);
      if (dist(m, t) === 1) return m.attack(t, g); // cornered
      return;
    }
    const h = Object.keys(g.map.unburnt || {}).map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; })
      .filter(c => g.map.get(c.x, c.y) === 'ash' && dm[c.y][c.x] <= 10).sort((a, b) => dm[a.y][a.x] - dm[b.y][b.x])[0];
    if (!h) return AI.wander(m, g);
    if (dist(h, m) <= 1) return reweave(g, h);
    const dh = g.map.distanceFrom(h.x, h.y, walk), next = DIRS.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }))
      .filter(c => walk(c.x, c.y) && !g.occupied(c.x, c.y) && g.map.canStep(m.x, m.y, c.x, c.y) && dh[c.y][c.x] < dh[m.y][m.x])
      .sort((a, b) => dh[a.y][a.x] - dh[b.y][b.x])[0];
    if (next) g.moveTo(m, next.x, next.y);
  },
  idle() {},
  // Allies (raised skeletons, companions). Companions cast their class skills (aiCast) about half the time.
  // Ranged-class companions (cls.ranged: Archer, Mage) cast whenever an enemy is in view, back away from anything
  // adjacent (melee only when cornered) and hold at range instead of closing in.
  // hold: stays put (H key) but still fights whatever comes in reach.
  // Support companions (cls.support: Cleric) also cast every turn and back off, but stay within 2 of you instead of
  // taking up a firing position.
  // Orders (m.order, Tactics menu T) come first: regroup = come back to you, ignoring enemies on the way; goto = walk to
  // a tile, then hold; attack = focus that monster until it dies. Stance (g.allyStance): aggressive (default) engages any
  // visible foe; defensive only foes within 2 of you or next to the ally, and won't stray 3+ tiles from you to chase;
  // passive never attacks (companions still heal and buff).
  ally(m, g) {
    const p = g.player, support = m.companion && m.cls?.support, ranged = m.companion && (m.cls?.ranged || support);
    const stance = g.allyStance || 'aggressive', o = m.order;
    if (m.companion && g.companionDrink(m)) return; // low in a fight: drink a potion they carry
    if (o?.type === 'regroup') { if (dist(m, p) > 2) return g.stepAlongPath(m); m.order = null; }
    if (o?.type === 'goto') {
      if ((m.x === o.x && m.y === o.y) || (dist(m, o) === 1 && g.occupied(o.x, o.y))) { m.order = null; m.hold = true; } // arrived
      else { o.d ||= g.map.distanceFrom(o.x, o.y, (x, y) => g.map.passable(x, y)); return g.stepAlongPath(m, o.d); }
    }
    if (m.order?.type === 'attack' && !m.order.target.alive) m.order = null;
    const focus = (m.status.taunted && m.tauntedBy?.alive && m.tauntedBy) // taunted (Death Knight): must go for it
      || (m.order?.type === 'attack' ? m.order.target : null);
    let foes = stance === 'passive' ? [] : g.monsters.filter(f => f.alive && g.hostile(m, f) && g.seesMonster(f)); // not submerged
    if (stance === 'defensive') foes = foes.filter(f => dist(f, p) <= 2 || dist(f, m) <= 1);
    const foe = focus || foes.sort((a, b) => dist(a, m) - dist(b, m))[0];
    if (m.companion && !m.status.silenced && (ranged && foe || chance(0.5)) && aiCast(g, m, foe)) return; // may heal even with no enemy around
    if (foe && dist(foe, m) === 1) return ranged && g.stepAway(m, foe) ? undefined : m.attack(foe, g);
    if (m.hold && !focus) return;
    if (foe && support && !focus) return dist(m, p) > 2 ? g.stepAlongPath(m) : undefined; // hang back with you
    if (foe && ranged && dist(foe, m) <= 5 && g.map.hasLos(m, foe)) return; // in position: wait for an opening
    if (foe && stance === 'defensive' && !focus && dist(m, p) >= 3) return g.stepAlongPath(m); // don't get drawn away
    if (foe && g.stepToward(m, foe)) return; // can't get any closer (across water...): fall through and follow you
    if ((m.vanguard || m.cls?.vanguard) && g.lastDir && dist(m, p) <= 4) { // vanguard (Warrior, skeletons): walk ahead of you
      // A small arc in front of you (2 ahead, 2 ahead to either side, 1 ahead): take the nearest free spot, so several
      // vanguards spread out instead of queuing for one tile.
      const [dx, dy] = g.lastDir, arc = [[2, 0], [2, -1], [2, 1], [1, 0]].map(([k, s]) => ({ x: p.x + dx * k - dy * s, y: p.y + dy * k + dx * s }));
      const spot = arc.filter(c => g.map.walkable(c.x, c.y) && ((c.x === m.x && c.y === m.y) || !g.occupied(c.x, c.y)))
        .sort((a, b) => dist(a, m) - dist(b, m))[0];
      if (spot && (m.x !== spot.x || m.y !== spot.y)) g.stepToward(m, spot);
      return;
    }
    if (dist(m, p) > 2) g.stepAlongPath(m); // follow you along real paths, around corners
  },
};
