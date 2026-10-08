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

// ---- boss fight patterns ----
// Danger marks (map.dangers: [{ owner, tiles }]): tiles about to be struck, drawn pulsing red (renderMap) while their
// owner lives - a turn's warning to step out. markDanger returns the mark, to clear once it's resolved.
function markDanger(g, owner, tiles) { const d = { owner, tiles }; (g.map.dangers ||= []).push(d); return d; }
const clearDanger = (g, d) => { g.map.dangers = (g.map.dangers || []).filter(o => o !== d); };
const inRect = (r, e) => e.x >= r.x && e.x < r.x + r.w && e.y >= r.y && e.y < r.y + r.h;
// The 3 tiles in front of m toward (dx, dy): straight ahead and the two diagonals beside it.
const arcToward = (m, dx, dy) => [{ x: dx, y: dy }, { x: Math.sign(dx - dy), y: Math.sign(dx + dy) }, { x: Math.sign(dx + dy), y: Math.sign(dy - dx) }]
  .map(d => ({ x: m.x + d.x, y: m.y + d.y }));
// A blade sweeping through tiles from m: on each in turn (round from one side to the other) a bright slash across the
// line of the blow (float css slash) and a red flash - shown whether or not anyone was still standing there.
function slashFx(g, m, tiles) {
  const ang = c => Math.atan2(c.y - m.y, c.x - m.x);
  [...tiles].sort((a, b) => ang(a) - ang(b)).forEach((c, i) => {
    const dx = Math.sign(c.x - m.x), dy = Math.sign(c.y - m.y); // the slash runs across the blow
    g.fx.float(c, dx === 0 ? '─' : dy === 0 ? '│' : dx * dy > 0 ? '/' : '\\', '#ffffff', { css: 'slash', delay: i * 0.07 });
    g.fx.flash(c, '#5a1010');
  });
}
// Everyone hostile to m standing on one of the tiles (a telegraphed blow landing).
const foesOn = (g, m, tiles) => [g.player, ...g.monsters].filter(e => e.alive && e !== m && !e.partOf && g.hostile(m, e) && tiles.some(c => c.x === e.x && c.y === e.y));
// Tiles in room r (or within 6 of m outside one) that are `t`.
const tilesNear = (g, m, r, t) => g.map.cells((x, y) => (r ? inRect(r, { x, y }) : dist({ x, y }, m) <= 6) && g.map.get(x, y) === t);
// Every `stir` tile near m gives up a `monster` (awake, provoked, joining the fight) and turns back into `back`.
function riseFrom(g, m, r, stir, back, monster) {
  const spots = tilesNear(g, m, r, stir);
  spots.forEach(c => {
    g.map.set(c.x, c.y, back);
    if (g.occupied(c.x, c.y)) return;
    g.spawn(MONSTERS[monster], c);
    Object.assign(g.monsters.at(-1), { awake: true, provoked: true, raisedBy: m, flashCss: { turn: g.turn, css: 'hatch' } });
  });
  return spots.length;
}
// Each returns true if it used the boss's turn.
const BOSS_PATTERNS = {
  // The Crystal Guardian (the Crystal Sanctum's throne hall, guarding the Crystal of Ages): shard nova - its crystals flare
  // (every tile within 2 marked for two turns, while it holds still), then burst: x1.5 for everyone still there; every 5
  // turns, its foe within 2. The
  // prism shield: at 2/3 and at 1/3 health it raises a shield (phased - blows pass through it) and two focus crystals flare
  // up at the far sides of its hall; the shield holds until both are smashed - and while it holds it, the Guardian acts only every
  // other turn (a race to the crystals). Otherwise it hunts you (baseAi chase).
  guardian(m, g) {
    const t = m.target, seen = g.map.visible[m.y]?.[m.x], r = g.map.arenas?.find(a => inRect(a.r, m))?.r;
    const focus = g.monsters.filter(o => o.alive && o.name === MONSTERS.focus.name);
    if (m.shielded) {
      if (focus.length) { m.status.phased = 99; if (g.turn % 2) return true; } // (holding the shield slows it: it acts every other turn)
      else { m.shielded = false; delete m.status.phased; m.flashCss = { turn: g.turn, css: 'shieldhit' }; g.log('The last focus crystal shatters - the prism shield breaks!', m.color); }
    }
    const phase = m.hp <= m.maxHp / 3 ? 2 : m.hp <= m.maxHp * 2 / 3 ? 1 : 0;
    if (phase > (m.phase || 0)) { // the prism shield goes up
      m.phase = phase; m.shielded = true; m.status.phased = 99;
      const spots = g.map.cells((x, y) => (r ? inRect(r, { x, y }) : dist({ x, y }, m) <= 7) && g.map.walkable(x, y) && !g.occupied(x, y) && dist({ x, y }, m) >= 4)
        .sort((a, b) => dist(b, m) - dist(a, m));
      const a = spots[0], b = a && spots.find(c => dist(c, a) >= 6);
      [a, b].filter(Boolean).forEach(c => { g.spawn(MONSTERS.focus, c); Object.assign(g.monsters.at(-1), { flashCss: { turn: g.turn, css: 'emerge' } }); });
      g.log('The Crystal Guardian raises a shimmering prism shield - two focus crystals flare to life! Smash them!', m.color);
      return true;
    }
    if (m.nova && m.nova.wait-- > 0) return true; // (still gathering - a two-turn warning, room to get 3 tiles clear)
    if (m.nova) { // the shards burst out
      const tiles = m.nova.tiles;
      clearDanger(g, m.nova); m.nova = null; m.novaCd = 5;
      tiles.forEach((c, i) => { g.fx.float(c, '*', '#d0faff', { css: 'slash', delay: (dist(c, m) - 1) * 0.08 }); g.fx.flash(c, '#1a4a6a'); });
      const hit = foesOn(g, m, tiles);
      if (seen || hit.includes(g.player)) g.log(hit.length ? 'Crystal shards burst out of the Guardian!' : 'Crystal shards burst out of the Guardian and shatter on the floor.', m.color);
      hit.forEach(e => m.attack(e, g, { mult: 1.5, verb: 'shred' }));
      return true;
    }
    if (m.novaCd > 0) m.novaCd--;
    if (t && !m.novaCd && dist(m, t) <= 2 && !isDisabled(m)) { // its crystals flare
      const tiles = [];
      for (let y = m.y - 2; y <= m.y + 2; y++) for (let x = m.x - 2; x <= m.x + 2; x++) if (dist({ x, y }, m) >= 1 && g.map.walkable(x, y)) tiles.push({ x, y });
      m.nova = Object.assign(markDanger(g, m, tiles), { wait: 1 });
      if (seen) g.log("The Guardian's crystals flare blindingly - shards are about to burst out! Get clear!", m.color);
      return true;
    }
    return false;
  },
  // The Mycelium Heart (rooted in the Fungal Depths' central cavern - it never moves; you come to it): root eruption - the
  // floor round its foe heaves (a plus of 5 tiles marked), then roots burst up: x1.3 (INT) and stuck 2 for everyone still
  // there, every 3 turns, its foe within 8 in sight. It sprouts a sporeling on the fungus round it every 7 turns (a turn's
  // warning; 2 at most). At half health the spore bloom: everything within 4 is marked, then bursts into spore clouds
  // (poison, 5 turns). Beside it, it lashes out (melee).
  myceliumheart(m, g) {
    const t = m.target, seen = g.map.visible[m.y]?.[m.x];
    riseFrom(g, m, null, 'sprouting', 'fungus', 'spore');
    if (m.bloom) { // the spore bloom bursts
      const tiles = m.bloom.tiles;
      clearDanger(g, m.bloom); m.bloom = null;
      shuffle(tiles).slice(0, 8).forEach(c => sporeCloud(g, c, 1, 5));
      const hit = foesOn(g, m, tiles);
      g.log('The Mycelium Heart bursts open in a vast bloom of choking spores!', m.color);
      hit.forEach(e => { m.attack(e, g, { magic: true, verb: 'choke' }); if (e.alive) applyStatus(e, 'poison', 4, g); });
      return true;
    }
    if (m.grasp) { // the roots burst up
      const tiles = m.grasp.tiles;
      clearDanger(g, m.grasp); m.grasp = null; m.graspCd = 3;
      tiles.forEach((c, i) => { g.fx.float(c, '&', '#c08a50', { css: 'slash', delay: i * 0.05 }); g.fx.flash(c, '#2a1a10'); });
      const hit = foesOn(g, m, tiles);
      if (seen || hit.includes(g.player)) g.log(hit.length ? 'Roots erupt from the ground and lash around you!' : 'Roots erupt from the ground, grasping at nothing.', '#c08a50');
      hit.forEach(e => { m.attack(e, g, { mult: 1.3, magic: true, verb: 'lash' }); if (e.alive) applyStatus(e, 'stuck', 2, g); });
      return true;
    }
    if (!m.bloomed && m.hp <= m.maxHp / 2) { // the bloom swells
      m.bloomed = true;
      const tiles = [];
      for (let y = m.y - 4; y <= m.y + 4; y++) for (let x = m.x - 4; x <= m.x + 4; x++)
        if (dist({ x, y }, m) >= 1 && g.map.walkable(x, y) && g.map.hasLos(m, { x, y })) tiles.push({ x, y });
      m.bloom = markDanger(g, m, tiles);
      g.log('The Mycelium Heart swells and pulses - a bloom of spores is about to burst! Get clear!', m.color);
      return true;
    }
    if (m.sproutCd > 0) m.sproutCd--;
    const sprouts = g.monsters.filter(o => o.alive && o.raisedBy === m).length + tilesNear(g, m, null, 'sprouting').length;
    if (t && !m.sproutCd && sprouts < 2) { // a sporeling sprouts (free: it doesn't take the turn)
      const c = pick(g.map.cells((x, y) => g.map.get(x, y) === 'fungus' && !g.occupied(x, y) && dist({ x, y }, m) >= 2 && dist({ x, y }, m) <= 5));
      if (c) { g.map.set(c.x, c.y, 'sprouting'); if (g.map.visible[c.y][c.x]) g.log('The fungus nearby bulges and splits - something is sprouting!', '#f0a0ff'); }
      m.sproutCd = 7;
    }
    if (m.graspCd > 0) m.graspCd--;
    if (t && !m.graspCd && dist(m, t) <= 8 && g.map.hasLos(m, t) && !isDisabled(m)) { // the floor heaves
      const tiles = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy })).filter(c => g.map.walkable(c.x, c.y));
      m.grasp = markDanger(g, m, tiles);
      if (seen || t === g.player) g.log(`The ground heaves around ${t.obj} - roots are coming up!`, '#c08a50');
      return true;
    }
    if (t && dist(m, t) === 1 && !isDisabled(m)) { m.attack(t, g, { verb: 'lash' }); return true; }
    return false;
  },
  // The Drowned Hag (her island in the Flooded Grotto): the tidal surge - the water draws back for a turn while a 3-wide lane
  // 7 tiles long from her toward her foe is marked, then the wave crashes down it: x1.2 (INT), swept 2 tiles back and a
  // lost turn for everyone still in it. Every 6 turns, 4 at high tide. At half health "the sea answers": she drags the
  // tide in (map.tideShift - it starts rising now, flooding the causeways). Her raising, hexes and curse stay (baseAi summoner).
  hag(m, g) {
    const t = m.target, seen = g.map.visible[m.y]?.[m.x], tide = g.level.tide;
    if (m.surge) { // the wave crashes
      const tiles = m.surge.tiles;
      clearDanger(g, m.surge); m.surge = null; m.surgeCd = g.tideHigh() ? 4 : 6;
      tiles.forEach(c => { g.fx.float(c, '≈', '#8fe8ff', { css: 'slash', delay: dist(c, m) * 0.05 }); g.fx.flash(c, '#12405a'); });
      const hit = foesOn(g, m, tiles);
      if (seen || hit.includes(g.player)) g.log(hit.length ? 'A wall of black water crashes down the lane!' : 'The wave crashes down on empty ground.', m.color);
      hit.forEach(e => {
        m.attack(e, g, { mult: 1.2, magic: true, verb: 'engulf' });
        if (!e.alive) return;
        knockback(g, m, e, 2);
        if (e === g.player) g.skipTurn = true; else applyStatus(e, 'stun', 1, g, true);
      });
      return true;
    }
    if (tide && !m.deep && m.hp <= m.maxHp / 2) { // the sea answers: the tide starts rising now
      m.deep = true;
      const P = tide.low + tide.high + 2 * TIDE_WAVES;
      g.map.tideShift = (((tide.low - g.turn) % P) + P) % P;
      g.log('The Drowned Hag shrieks - and the sea answers. The tide comes rushing in!', m.color);
      return true;
    }
    if (m.surgeCd > 0) m.surgeCd--;
    if (t && !m.surgeCd && dist(m, t) <= 7 && g.map.hasLos(m, t) && !isDisabled(m)) { // the water draws back
      const dx = t.x - m.x, dy = t.y - m.y, k = 7 / Math.max(Math.abs(dx), Math.abs(dy)), sx = Math.sign(dx), sy = Math.sign(dy);
      const wet = (x, y) => g.map.walkable(x, y) || !!TILES[g.map.get(x, y)].swim, tiles = [], seenAt = new Set();
      for (const c of line(m.x, m.y, m.x + Math.round(dx * k), m.y + Math.round(dy * k)).slice(1))
        for (const o of [0, 1, -1]) {
          const x = c.x - sy * o, y = c.y + sx * o; // (the lane: the line and a tile either side of it)
          if (wet(x, y) && !seenAt.has(x + ',' + y)) { seenAt.add(x + ',' + y); tiles.push({ x, y }); }
        }
      m.surge = markDanger(g, m, tiles);
      if (seen || t === g.player) g.log('The Hag raises her arms - the water draws back as a wave rears up behind her!', m.color);
      return true;
    }
    return false;
  },
  // The Mire Mother (her pool in the Blackwater Mire): a huge leech, unseen under the bog (submerge) unless right beside
  // you. Every 5 turns, when you're within 8 and standing by open water, the bog beside you churns (the 3x3 round you
  // marked) - next turn she lunges up out of it: x1.5 and stuck a turn for everyone still there, draining what she bites.
  // Step back from the water's edge to make her miss. At half health a brood of 3 giant leeches swarms out of the bog
  // around her. Otherwise she lurks and bites from the water (baseAi lurker).
  miremother(m, g) {
    const t = m.target, seen = g.map.visible[m.y]?.[m.x];
    const water = c => DIRS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(s => TILES[g.map.get(s.x, s.y)].swim && !g.occupied(s.x, s.y) && dist(s, m) <= 8);
    if (m.churn) { // she lunges
      const tiles = m.churn.tiles, from = pick(water(m.churn.at));
      clearDanger(g, m.churn); m.churn = null; m.churnCd = 5;
      if (from) Object.assign(m, from, { flashCss: { turn: g.turn, css: 'emerge' } });
      tiles.forEach(c => g.fx.flash(c, '#3a1a20'));
      const hit = foesOn(g, m, tiles);
      if (seen || hit.includes(g.player) || g.map.visible[m.y]?.[m.x]) g.log(hit.length ? 'The Mire Mother erupts from the bog and latches on!' : 'The Mire Mother erupts from the bog - and snaps shut on nothing.', m.color);
      hit.forEach(e => { m.attack(e, g, { mult: 1.5, verb: 'latch onto' }); if (e.alive) applyStatus(e, 'stuck', 1, g); });
      return true;
    }
    if (!m.brood && m.hp <= m.maxHp / 2) {
      m.brood = true;
      shuffle(g.map.cells((x, y) => TILES[g.map.get(x, y)].swim && !g.occupied(x, y) && dist({ x, y }, m) <= 4)).slice(0, 3).forEach(c => {
        g.spawn(MONSTERS.leech, c); Object.assign(g.monsters.at(-1), { awake: true, provoked: true });
      });
      if (seen || dist(m, g.player) <= 6) g.log('The bog seethes - a brood of leeches swarms out around the Mire Mother!', m.color);
    }
    if (m.churnCd > 0) m.churnCd--;
    if (t && !m.churnCd && dist(m, t) <= 8 && water(t).length && !isDisabled(m)) { // the water beside you churns
      const tiles = [t, ...DIRS.map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy }))].filter(c => g.map.walkable(c.x, c.y));
      m.churn = Object.assign(markDanger(g, m, tiles), { at: { x: t.x, y: t.y } });
      if (t === g.player) g.log('The black water beside you churns and heaves...', '#d07080');
      return true;
    }
    return false;
  },
  // The Banshee (her chapel): the keen - she draws breath for a turn while the air trembles round her (marked), then
  // screams: everyone hostile on those tiles is hurt (x1.5) and silenced 2 turns. Her keens alternate: a close one (1-2
  // tiles - back away) and a far-reaching one (2-4 tiles - get in close, or right out); every 3 turns, 2 once she's
  // hurt to half. Pinned in melee she flits away (every 5 turns: dissolves and drifts back in 4-6 tiles off, among the
  // pews). At half health "the dead answer": three ghosts rise beside her. Otherwise she fights you as baseAi chase.
  banshee(m, g) {
    const t = m.target, seen = g.map.visible[m.y]?.[m.x], r = g.map.arenas?.find(a => inRect(a.r, m))?.r;
    const inArea = c => (r ? inRect(r, c) : dist(c, m) <= 6);
    if (m.keen) { // the scream lands
      const tiles = m.keen.tiles;
      clearDanger(g, m.keen); m.keen = null; m.keenCd = m.answered ? 2 : 3;
      tiles.forEach(c => g.fx.flash(c, '#3a4466'));
      const hit = foesOn(g, m, tiles);
      if (seen || hit.includes(g.player)) g.log(hit.length ? 'The Banshee shrieks - the sound tears through you!' : 'The Banshee shrieks at no one.', '#dde4ff');
      hit.forEach(e => { m.attack(e, g, { mult: 1.5, magic: true, verb: 'deafen' }); if (e.alive) applyStatus(e, 'silenced', 2, g); });
      return true;
    }
    if (!m.answered && m.hp <= m.maxHp / 2) {
      m.answered = true;
      const spots = shuffle(DIRS.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy })).filter(c => g.map.walkable(c.x, c.y) && !g.occupied(c.x, c.y))).slice(0, 3);
      spots.forEach(c => { g.spawn(MONSTERS.ghost, c); Object.assign(g.monsters.at(-1), { awake: true, provoked: true, flashCss: { turn: g.turn, css: 'emerge' } }); });
      if (seen) g.log('The Banshee wails for the dead - and the dead answer!', '#bdf');
      return true;
    }
    if (!t) return false;
    if (m.keenCd > 0) m.keenCd--;
    if (m.flitCd > 0) m.flitCd--;
    if (!m.keenCd && dist(m, t) <= 4 && !isDisabled(m)) { // draws breath
      m.near = !m.near;
      const [lo, hi] = m.near ? [1, 2] : [2, 4], tiles = []; // (the far keen takes in 2 too: no hugging the line between them)
      for (let y = m.y - hi; y <= m.y + hi; y++) for (let x = m.x - hi; x <= m.x + hi; x++)
        if (dist({ x, y }, m) >= lo && g.map.walkable(x, y) && g.map.hasLos(m, { x, y })) tiles.push({ x, y });
      m.keen = markDanger(g, m, tiles);
      if (seen || t === g.player) g.log(m.near ? 'The Banshee draws a ragged breath - the air around her shivers!' : 'The Banshee throws back her head - her keen will carry far!', '#dde4ff');
      return true;
    }
    if (!m.flitCd && dist(m, t) === 1 && !isDisabled(m)) { // pinned: she flits off among the pews
      const to = shuffle(g.map.cells((x, y) => inArea({ x, y }) && g.map.walkable(x, y) && !g.occupied(x, y) && dist({ x, y }, t) >= 4 && dist({ x, y }, t) <= 6))[0];
      if (to) {
        g.fx.float(m, m.ch, m.color, { css: 'fadeout' });
        Object.assign(m, to, { flitCd: 5, flashCss: { turn: g.turn, css: 'emerge' } });
        if (seen) g.log('The Banshee dissolves into mist and drifts away...', '#dde4ff');
        return true;
      }
    }
    return false;
  },
  // The Grave Serpent (its pit): venom spit - it rears up for a turn, marking a line 6 tiles long toward its prey (cut
  // short by the columns: duck behind one), then sprays it - x1 damage and poison on everyone hostile in it; every 6
  // turns, when its prey is 2+ tiles off. At half health it sloughs its skin: the shed skins strewn about the pit stir
  // (a turn's warning) and grave adders wriggle out (3 at most). Its fang and its chase stay (baseAi multibody).
  serpent(m, g) {
    const t = m.target, seen = g.map.visible[m.y]?.[m.x], r = g.map.arenas?.find(a => inRect(a.r, m))?.r;
    if (riseFrom(g, m, r, 'skinstir', 'pitfloor', 'graveadder') && seen) g.log('Grave adders wriggle out of the shed skins!', '#9fd07a');
    if (!m.sloughed && m.hp <= m.maxHp / 2) {
      m.sloughed = true;
      shuffle(tilesNear(g, m, r, 'shedskin').filter(c => !g.occupied(c.x, c.y))).slice(0, 3).forEach(c => g.map.set(c.x, c.y, 'skinstir'));
      if (seen) g.log('The Grave Serpent writhes - the shed skins about the pit begin to twitch...', '#c8c898');
    }
    if (m.spit) { // the spray lands
      const tiles = m.spit.tiles;
      clearDanger(g, m.spit); m.spit = null; m.spitCd = 6;
      tiles.forEach((c, i) => { g.fx.float(c, '≈', '#9fff6a', { css: 'slash', delay: i * 0.05 }); g.fx.flash(c, '#1f4d1f'); });
      const hit = foesOn(g, m, tiles);
      if (seen) g.log(hit.length ? 'The Grave Serpent sprays a stream of venom!' : 'Venom spatters the empty ground.', '#9fd07a');
      hit.forEach(e => m.attack(e, g, { verb: 'spray', status: { poison: 4 } }));
      return true;
    }
    if (m.spitCd > 0) m.spitCd--;
    if (t && !m.spitCd && dist(m, t) >= 2 && dist(m, t) <= 6 && g.map.hasLos(m, t) && !isDisabled(m)) { // rears up
      const dx = t.x - m.x, dy = t.y - m.y, k = 6 / Math.max(Math.abs(dx), Math.abs(dy)), tiles = [];
      for (const c of line(m.x, m.y, m.x + Math.round(dx * k), m.y + Math.round(dy * k)).slice(1)) {
        const prev = tiles.at(-1) || m;
        if (!g.map.walkable(c.x, c.y) || !g.map.canStep(prev.x, prev.y, c.x, c.y)) break;
        tiles.push(c);
      }
      m.spit = markDanger(g, m, tiles.filter(c => !bodyParts(m).some(q => q.x === c.x && q.y === c.y)));
      if (seen || t === g.player) g.log('The Grave Serpent rears up, venom glistening on its fangs!', '#9fd07a');
      return true;
    }
    return false;
  },
  // The Lich (its sanctum): grasping dead - it clenches a fist and the floor round its foe crawls (the 3x3 there marked a
  // turn), then bony hands burst up: x1 (INT) and stuck 2 turns for everyone hostile in it; every 5 turns. Soul tether: hurt
  // while its phylactery stands, it draws on it every 8 turns (a beam from the dais) and heals 8 - smash it first. At half
  // health (once) "the legion": every bone heap in the hall stirs (4 at most) and skeletons rise from them next turn.
  // Its raising, blasts and spells stay (baseAi summoner).
  lich(m, g) {
    const t = m.target, seen = g.map.visible[m.y]?.[m.x], r = g.map.arenas?.find(a => inRect(a.r, m))?.r;
    riseFrom(g, m, r, 'legionbones', 'lichfloor', 'skeleton');
    if (m.grasp) { // the hands burst up
      const tiles = m.grasp.tiles;
      clearDanger(g, m.grasp); m.grasp = null; m.graspCd = 5;
      tiles.forEach((c, i) => { g.fx.float(c, 'ƒ', '#e8dcc0', { css: 'slash', delay: i * 0.04 }); g.fx.flash(c, '#2a1a3a'); });
      const hit = foesOn(g, m, tiles);
      if (seen || hit.includes(g.player)) g.log(hit.length ? 'Bony hands burst from the floor and seize hold!' : 'Bony hands claw at empty air and sink back.', '#c8ffb0');
      hit.forEach(e => { m.attack(e, g, { magic: true, verb: 'claw' }); if (e.alive) applyStatus(e, 'stuck', 2, g); });
      return true;
    }
    if (!m.legion && m.hp <= m.maxHp / 2) {
      m.legion = true;
      const heaps = shuffle(tilesNear(g, m, r, 'bones').filter(c => !g.occupied(c.x, c.y))).slice(0, 4);
      heaps.forEach(c => g.map.set(c.x, c.y, 'legionbones'));
      if (seen) g.log(heaps.length ? 'The Lich raises both arms: "Rise, my legion!" - every bone in the hall shudders!' : 'The Lich calls for its legion, but no bones answer.', '#c8ffb0');
      return true;
    }
    const ph = g.monsters.find(o => o.alive && o.name === MONSTERS.phylactery.name);
    if (m.tetherCd > 0) m.tetherCd--;
    if (ph && !m.tetherCd && m.hp <= m.maxHp - 8 && dist(m, ph) <= 10) {
      m.tetherCd = 8;
      g.fx.bolt(ph, m, '~', '#d8a8ff');
      m.hp = Math.min(m.maxHp, m.hp + 8);
      g.fx.float(m, '+8', '#d8a8ff');
      if (seen) g.log('A thread of sickly light runs from the phylactery to the Lich - its wounds knit!', '#d8a8ff');
      return true;
    }
    if (m.graspCd > 0) m.graspCd--;
    if (t && !m.graspCd && dist(m, t) <= 6 && g.map.hasLos(m, t) && !isDisabled(m) && !m.status.silenced) { // clenches its fist
      const tiles = [];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g.map.walkable(t.x + dx, t.y + dy)) tiles.push({ x: t.x + dx, y: t.y + dy });
      m.grasp = markDanger(g, m, tiles);
      if (seen || t === g.player) g.log(`The Lich clenches a bony fist - the floor around ${t.obj} begins to crawl!`, '#c8ffb0');
      return true;
    }
    return false;
  },
  // The Wight (its dark tomb) - a fight over the light. Shrouded on unlit tiles: it regenerates 3 HP a turn and heals by
  // the damage it deals, and past 2 tiles away only its eyes show (darkstalker 2). Exposed in candlelight: no healing,
  // and it takes x1.5 damage (lightWeak, Entity.hurt). Every ~6 turns it goes for the nearest lit candle and reaches for it
  // - a turn's warning; hit it then and it recoils and the candle survives, else the candle goes out and an open grave
  // heaves (a ghoul climbs out next turn, 4 at most). You relight a snuffed candle by walking into it (a turn). At half
  // health "the tomb goes cold": a gust snuffs half the lit candles and every grave heaves; grave-cold from then on (its
  // hits may freeze you, it heals double). Otherwise it fights you as baseAi chase.
  wight(m, g) {
    const arena = g.map.arenas?.find(a => inRect(a.r, m)), seen = (x, y) => g.map.visible[y]?.[x];
    if (!arena || !m.target) return false;
    const r = arena.r, here = t => g.map.cells((x, y) => inRect(r, { x, y }) && g.map.get(x, y) === t);
    const shrouded = !g.map.isLit(m.x, m.y), halved = !m.cold && m.hp <= m.maxHp / 2; // (checked before it regenerates)
    m.drain = shrouded ? (m.cold ? 2 : true) : 0;
    if (shrouded && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + 3);
    const heave = c => { // an open grave stirs; a ghoul climbs out of it next turn
      const ghouls = g.monsters.filter(o => o.alive && o.name === MONSTERS.ghoul.name && inRect(r, o)).length + here('gravestir').length;
      if (ghouls < 4 && c && !g.occupied(c.x, c.y)) g.map.set(c.x, c.y, 'gravestir');
    };
    const stirring = here('gravestir');
    stirring.forEach(c => {
      g.map.set(c.x, c.y, 'grave');
      if (g.occupied(c.x, c.y)) return;
      g.spawn(MONSTERS.ghoul, c);
      Object.assign(g.monsters.at(-1), { awake: true, provoked: true, flashCss: { turn: g.turn, css: 'hatch' } });
      if (seen(c.x, c.y)) g.log('A ghoul claws its way up out of the grave!', '#9fc27a');
    });
    const snuff = c => {
      g.map.set(c.x, c.y, 'candleout'); g.map.computeLights();
      heave(pick(here('grave')));
    };
    if (halved) { // the tomb goes cold
      Object.assign(m, { cold: true, chill: 0.35 });
      const lit = shuffle(here('candle'));
      lit.slice(0, Math.ceil(lit.length / 2)).forEach(c => { g.map.set(c.x, c.y, 'candleout'); });
      g.map.computeLights();
      here('grave').forEach(heave);
      g.log('An icy gust howls through the tomb - candles gutter out and the graves heave! Frost spreads from the Wight.', '#bfe8ff');
      m.reach = null;
      return true;
    }
    if (m.reach) { // the warned snuff lands - unless it was struck while reaching
      const { c, hp } = m.reach;
      m.reach = null; m.snuffCd = 6;
      if (m.hp < hp) { if (seen(m.x, m.y)) g.log('The Wight recoils - the candle survives!', '#ffd24a'); return true; }
      if (g.map.get(c.x, c.y) === 'candle' && dist(m, c) <= 1) {
        snuff(c);
        if (seen(c.x, c.y)) g.log('The Wight pinches out a grave candle - the dark deepens, and an open grave heaves...', '#9fc27a');
      }
      return true;
    }
    if (--m.snuffCd <= 0) { // off to put out a candle
      const dm = g.map.distanceFrom(m.x, m.y, (x, y) => g.map.walkable(x, y));
      const near = c => DIRS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(s => g.map.walkable(s.x, s.y)).reduce((b, s) => Math.min(b, dm[s.y][s.x]), Infinity);
      const c = here('candle').sort((a, b) => near(a) - near(b))[0];
      if (c) {
        if (dist(m, c) <= 1) {
          m.reach = { c, hp: m.hp };
          if (seen(m.x, m.y)) g.log('The Wight reaches for a grave candle - strike it now!', '#ffd24a');
          return true;
        }
        const goal = DIRS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(s => g.map.walkable(s.x, s.y) && !g.occupied(s.x, s.y))
          .sort((a, b) => dm[a.y][a.x] - dm[b.y][b.x])[0];
        if (goal) { g.stepToward(m, goal); return true; }
      }
    }
    return false;
  },
  // The Death Knight: the executioner's swing - raises his blade over the 3 tiles in front of his foe for a turn (marked),
  // then cleaves them for double damage (every 4 turns); at half health, "Rise, my guard!" - the suits of armour in his hall
  // wake as animated armour, two at a time every 3 turns (each trembles a turn first; 6 in all, at most 4 standing). His charge and taunt stay (baseAi caster).
  deathknight(m, g) {
    const t = m.target, seen = g.map.visible[m.y]?.[m.x], arena = g.map.arenas?.find(a => inRect(a.r, m));
    if (m.rallied && arena) { // (the guard rises whatever else he does this turn)
      const r = arena.r, stirring = g.map.cells((x, y) => inRect(r, { x, y }) && g.map.get(x, y) === 'armourstir');
      stirring.forEach(c => {
        g.map.set(c.x, c.y, 'floor');
        g.spawn(MONSTERS.animatedarmour, c);
        Object.assign(g.monsters.at(-1), { awake: true, provoked: true, flashCss: { turn: g.turn, css: 'hatch' } });
      });
      if (stirring.length && seen) g.log('The suits of armour step down from their stands!', '#b0bcd4');
      const standing = g.monsters.filter(o => o.alive && o.name === MONSTERS.animatedarmour.name).length;
      if (!stirring.length && --m.rallyCd <= 0 && (m.woken || 0) < 6 && standing < 4) { // (6 in all, 4 up at once at most)
        const wake = shuffle(g.map.cells((x, y) => inRect(r, { x, y }) && g.map.get(x, y) === 'armour')).slice(0, Math.min(2, 6 - (m.woken || 0)));
        m.woken = (m.woken || 0) + wake.length;
        wake.forEach(c => g.map.set(c.x, c.y, 'armourstir'));
        if (wake.length && seen) g.log('Two suits of armour shudder on their stands...', '#b0bcd4');
        m.rallyCd = 3;
      }
    }
    if (!m.rallied && m.hp <= m.maxHp / 2) {
      Object.assign(m, { rallied: true, rallyCd: 0 });
      if (seen) g.log('The Death Knight bellows: "Rise, my guard!"', '#e04040');
    }
    if (m.swing) { // the blow lands - on whoever is still in the marked tiles
      const tiles = m.swing.tiles;
      clearDanger(g, m.swing); m.swing = null; m.swingCd = 4;
      const hit = foesOn(g, m, tiles);
      slashFx(g, m, tiles);
      if (seen) g.log(hit.length ? "The Death Knight's blade comes crashing down!" : "The Death Knight's blade cleaves empty air.", '#e04040');
      hit.forEach(e => m.attack(e, g, { mult: 2, verb: 'cleave' }));
      return true;
    }
    if (m.swingCd > 0) m.swingCd--;
    if (t && dist(m, t) === 1 && !m.swingCd && !isDisabled(m)) { // wind up
      m.swing = markDanger(g, m, arcToward(m, Math.sign(t.x - m.x), Math.sign(t.y - m.y)).filter(c => g.map.walkable(c.x, c.y)));
      if (seen) g.log('The Death Knight raises his blade high - get clear!', '#e04040');
      return true;
    }
    return false;
  },
};

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
  // A boss (monster `pattern`): its fight pattern (BOSS_PATTERNS) runs first and may take the turn; otherwise it fights
  // as its `baseAi`.
  boss(m, g) {
    if (!BOSS_PATTERNS[m.pattern]?.(m, g)) AI[m.baseAi](m, g);
    if (m.darkstalker) { // slipping into / out of the dark is shown, not a pop: it dissolves where last seen, and fades in
      const hid = g.submerged(m);
      if (m.wasHidden && !hid) m.flashCss = { turn: g.turn, css: 'emerge' };
      if (!m.wasHidden && hid && m.lastSeenAt) g.fx.float(m.lastSeenAt, m.ch, m.color, { css: 'fadeout' });
      m.wasHidden = hid;
      if (!hid) m.lastSeenAt = { x: m.x, y: m.y };
    }
  },
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
  // Crystal pylon (the Crystal Sanctum): rooted. Every 5 turns, a foe within 9 in sight, it charges - its 4 beams (along its row
  // and column, to the first wall, 9 tiles at most) marked a turn - then fires: x1 (INT) and burning 2 for everyone hostile on them.
  pylon(m, g) {
    const seen = g.map.visible[m.y]?.[m.x];
    if (m.beam) {
      const tiles = m.beam.tiles;
      clearDanger(g, m.beam); m.beam = null; m.pulseCd = 5;
      tiles.forEach(c => { g.fx.float(c, c.y === m.y ? '─' : '│', '#d0faff', { css: 'slash', delay: dist(c, m) * 0.03 }); g.fx.flash(c, '#1a4a6a'); });
      const hit = foesOn(g, m, tiles);
      if (seen || hit.includes(g.player)) g.log(hit.length ? 'The crystal pylon fires searing beams of light!' : 'The crystal pylon flashes - its beams sear empty floor.', m.color);
      hit.forEach(e => m.attack(e, g, { magic: true, verb: 'sear', status: { burn: 2 } }));
      return;
    }
    if (m.pulseCd > 0) { m.pulseCd--; return; }
    const t = m.target;
    if (!t || dist(m, t) > 9 || !g.map.hasLos(m, t) || isDisabled(m)) return;
    const tiles = [];
    for (const [dx, dy] of DIRS.slice(0, 4))
      for (let i = 1, x = m.x + dx, y = m.y + dy; i <= 9 && g.map.walkable(x, y); i++, x += dx, y += dy) tiles.push({ x, y });
    m.beam = markDanger(g, m, tiles);
    if (seen) g.log('A crystal pylon hums and brightens - its beams are about to fire!', m.color);
  },
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
