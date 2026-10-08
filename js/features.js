// Interactive map features: tile handlers onBump (walk into it) and onEnter (step onto it).

// Doors: walking into a closed door opens it; a sealed door needs a key from your pack.
// Opening re-computes lighting so torchlight spills through the doorway.
// Open doors swing shut once their doorway has been empty for DOOR_CLOSE turns (see closeDoors).
const DOOR_CLOSE = 6;
function openDoor(g, x, y) {
  g.map.set(x, y, TILES[g.map.get(x, y)].openTile || 'doorOpen');
  (g.map.openedAt ||= {})[x + ',' + y] = g.turn;
  g.map.computeLights();
}

// Called every turn: shut open doors nobody has used for a while. Anyone (or an item) in the doorway props it open.
function closeDoors(g) {
  const m = g.map, at = m.openedAt || {};
  let shut = false;
  for (const k in at) {
    const [x, y] = k.split(',').map(Number);
    const shutTo = TILES[m.get(x, y)].closesTo;
    if (!shutTo) { delete at[k]; continue; }
    if (g.occupied(x, y) || g.itemAt(x, y)) { at[k] = g.turn; continue; }
    if (g.turn - at[k] < DOOR_CLOSE) continue;
    m.set(x, y, shutTo);
    delete at[k];
    shut = true;
    if (m.visible[y][x]) g.log('A door swings shut.', '#a87');
  }
  if (shut) m.computeLights();
}
TILES.door.onBump = (g, x, y) => { openDoor(g, x, y); g.log('You open the door.'); };
TILES.bossdoor.onBump = (g, x, y) => { openDoor(g, x, y); g.log('You heave open the iron-bound door. Something waits beyond...', '#ff6a5a'); };
// Locked doors (sealed vault door, cell door) open only with the key whose id matches the tile's `key`.
function unlock(g, x, y) {
  const t = TILES[g.map.get(x, y)], p = g.player, key = p.inv.find(i => i.kind === 'key' && i.id === t.key);
  if (!key) return g.log(t.lockedMsg, '#ffd24a');
  p.inv.splice(p.inv.indexOf(key), 1);
  if (t.opensTo === 'doorOpen') openDoor(g, x, y); // an unlocked vault door behaves like a normal door from now on
  else { g.map.set(x, y, t.opensTo); g.map.computeLights(); }
  g.fx.flash({ x, y }, '#5a4a10');
  g.log(`You turn the ${key.name} in the lock. The ${t.name} swings open.`, '#ffd24a');
}
TILES.lockedDoor.onBump = TILES.cellDoor.onBump = TILES.vaultDoor.onBump = unlock;

// Alarm: wakes every goblin within 25 tiles (gongs, tripwires).
function soundAlarm(g, at, msg) {
  g.log(msg, '#ffcc33');
  g.fx.area(at, 1, '#4a3a00');
  for (const m of g.monsters) if (m.faction === 'goblin' && dist(m, at) <= 25) m.awake = true;
}
TILES.gong.onBump = (g, x, y) => { g.map.set(x, y, 'gongRung'); soundAlarm(g, { x, y }, 'You bang the gong. BWONNG! The warren stirs...'); };
TILES.gongRung.onBump = g => g.log('The gong is still humming.', '#888');

// Monsters set off traps, webs and quicksand too (onMonster, from Game.moveTo) - except your allies (they follow your
// footsteps), fliers, goblins (they laid the traps) and, for webs, spiders (`webs`).
const trips = m => !m.ally && !m.fly && m.faction !== 'goblin';
const seenAt = (g, x, y) => g.map.visible[y]?.[x];

// Traps (hidden until spotted). Each springs once, then is gone.
TILES.spikeTrap.onEnter = (g, x, y) => {
  g.map.set(x, y, 'floor');
  const n = 5 + g.depth * 2;
  g.log(`Spikes shoot up from the floor! You take ${n} damage.`, '#f66');
  g.player.hurt(n, g, { obj: 'a spike trap' });
};
TILES.spikeTrap.onMonster = (g, m, x, y) => {
  if (!trips(m)) return;
  g.map.set(x, y, 'floor');
  const n = 5 + g.depth * 2;
  if (seenAt(g, x, y)) g.log(`Spikes shoot up under ${m.obj} for ${n}!`, '#f66');
  m.hurt(n, g, { obj: 'a spike trap' });
};
TILES.snareTrap.onEnter = (g, x, y) => { g.map.set(x, y, 'floor'); g.log('A snare snaps shut around your leg!', '#ddd'); applyStatus(g.player, 'stuck', 3, g, true); };
TILES.snareTrap.onMonster = (g, m, x, y) => {
  if (!trips(m)) return;
  g.map.set(x, y, 'floor');
  if (seenAt(g, x, y)) g.log(`A snare snaps shut on ${m.obj}!`, '#ddd');
  applyStatus(m, 'stuck', 3, g, true);
};
TILES.tripwire.onEnter = (g, x, y) => { g.map.set(x, y, 'floor'); soundAlarm(g, { x, y }, 'You catch a tripwire - bells jangle through the tunnels!'); };

// Skill-made tiles (snares, caltrops, consecrated ground, ice walls): placeTimed lays `tile` over plain walkable ground
// for `ttl` turns, then tickTimed (every turn) puts the old tile back. Kept on the map, so they survive leaving the
// floor. free: only where nobody stands (walls, snares). Returns false if the tile can't take it.
function placeTimed(g, x, y, tile, ttl, { free = false } = {}) {
  const m = g.map, was = m.get(x, y);
  if (!TILES[was].walk || TILES[was].door || ['stairs', 'upstairs'].includes(was) || (free && g.occupied(x, y))
    || g.itemAt(x, y) || m.timed?.some(t => t.x === x && t.y === y)) return false;
  (m.timed ||= []).push({ x, y, tile, was, until: g.turn + ttl });
  m.set(x, y, tile);
  return true;
}
// Put a timed tile back early (a sprung snare).
function clearTimed(g, x, y) {
  const m = g.map, t = m.timed?.find(t => t.x === x && t.y === y);
  if (t) { m.set(x, y, t.was); m.timed.splice(m.timed.indexOf(t), 1); }
}
function tickTimed(g) {
  const m = g.map;
  let walls = false;
  m.timed = (m.timed || []).filter(t => {
    if (m.get(t.x, t.y) !== t.tile) return false; // changed by something else
    if (g.turn < t.until) return true;
    m.set(t.x, t.y, t.was);
    walls ||= TILES[t.tile].opaque;
    return false;
  });
  if (walls) { m.computeLights(); g.log('The ice wall melts away.', '#aef'); }
  // Consecrated ground: friendlies standing on it heal 2 a turn; undead foes burn for 4.
  for (const e of [g.player, ...g.monsters]) {
    if (!e.alive || m.get(e.x, e.y) !== 'holyground') continue;
    if (g.factionOf(e) === 'player') { if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + 2); }
    else if (e.faction === 'undead') { if (m.visible[e.y][e.x]) g.log(`${e.subj} burns on the hallowed ground.`, '#ffd'); e.hurt(4, g, g.player); }
  }
}
// Trial chamber (map.trial, addTrialChamber): step inside and every way out seals; the level's `trial.waves` rise one by
// one from the floor (each wave once the last is dead). Clear them all: the seals open and a reward appears. Leave
// (teleport) mid-trial: the seals fade, no reward. Waves are provoked, so even a Necromancer's kin fight.
// Seal every way into room r (the walkable / door tiles in its ring) with `gate`; returns what was there, for unsealRoom.
function sealRoom(g, r, gate) {
  const sealed = [];
  for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) continue;
    const t = g.map.get(x, y);
    if ((TILES[t].walk || TILES[t].door) && !g.occupied(x, y)) { sealed.push({ x, y, was: t }); g.map.set(x, y, gate); }
  }
  g.map.computeLights();
  return sealed;
}
const unsealRoom = (g, sealed) => { sealed.forEach(c => g.map.set(c.x, c.y, c.was)); g.map.computeLights(); };
// Boss rooms (map.arenas, from the generator): step inside and iron portcullises drop over every way in; they lift once
// every hostile in the room is dead (boss, escort, the Lich's phylactery and raised dead alike) - or if you leave it
// (a teleport), then it's ready to lock again. Runs every turn from endTurn.
function arenaTick(g) {
  const p = g.player;
  for (const a of g.map.arenas || []) {
    if (a.state === 'done') continue;
    const r = a.r, inside = e => e.x >= r.x && e.x < r.x + r.w && e.y >= r.y && e.y < r.y + r.h;
    if (a.state === 'ready') {
      if (!inside(p) || g.ghost) continue;
      a.sealed = sealRoom(g, r, 'portcullis'); a.state = 'locked';
      g.log('Iron bars slam down behind you - there is no way out but through!', '#c8d0e0');
      continue;
    }
    if (!inside(p)) { unsealRoom(g, a.sealed); a.state = 'ready'; continue; } // (left it some other way)
    if (g.monsters.some(m => m.alive && inside(m) && g.hostile(m, p) && !m.captive)) continue;
    unsealRoom(g, a.sealed); a.state = 'done';
    g.log('The last foe falls. With a grinding of chains, the bars lift.', '#ffd24a');
  }
}
function trialTick(g) {
  const t = g.map.trial, waves = g.level.trial?.waves;
  if (!t || !waves || t.state === 'done') return;
  const { r } = t, p = g.player, inside = e => e.x >= r.x && e.x < r.x + r.w && e.y >= r.y && e.y < r.y + r.h;
  // the room's tiles / its ring of walls, from its rectangle (no whole-map scans - this runs every turn)
  const box = (pad, keep) => { const out = []; for (let y = r.y - pad; y < r.y + r.h + pad; y++) for (let x = r.x - pad; x < r.x + r.w + pad; x++) if (keep({ x, y })) out.push({ x, y }); return out; };
  const unseal = () => {
    [...t.sealed, ...(t.marks || [])].forEach(c => g.map.set(c.x, c.y, c.was)); // gates, and any runes still flaring
    t.marks = null; g.map.computeLights(); t.state = 'done';
  };
  if (t.state === 'ready') {
    if (!inside(p)) return;
    t.sealed = box(1, c => !inside(c)).filter(c => TILES[g.map.get(c.x, c.y)].walk || TILES[g.map.get(c.x, c.y)].door).map(c => ({ ...c, was: g.map.get(c.x, c.y) }));
    t.sealed.forEach(c => g.map.set(c.x, c.y, 'sealed'));
    g.map.computeLights();
    Object.assign(t, { state: 'active', wave: 0, foes: [] });
    g.log('The runes flare - the way out seals behind you! A trial begins.', '#f6c');
  }
  if (!inside(p)) { unseal(); return g.log('You slip out of the chamber. The seals fade - the trial is forfeit.', '#f6c'); }
  if (t.foes.some(m => m.alive)) return;
  if (t.wave < waves.length) {
    if (!t.marks) { // warning: the runes where the next wave will rise flare up a turn ahead (3+ tiles from you)
      const spots = shuffle(box(0, c => g.map.walkable(c.x, c.y) && !g.occupied(c.x, c.y) && g.map.get(c.x, c.y) !== 'sigil' && dist(c, p) >= 3));
      t.marks = spots.slice(0, waves[t.wave].length).map(c => ({ ...c, was: g.map.get(c.x, c.y) }));
      t.marks.forEach(c => g.map.set(c.x, c.y, 'runeflare'));
      return g.log(`The runes flare - wave ${t.wave + 1} of ${waves.length} is coming!`, '#f6c');
    }
    // ...and up it comes, out of the flaring runes (one standing on a rune keeps that one down)
    const kinds = waves[t.wave++], marks = t.marks;
    marks.forEach(c => g.map.set(c.x, c.y, c.was));
    t.marks = null;
    t.foes = kinds.map((k, i) => marks[i] && !g.occupied(marks[i].x, marks[i].y)
      && (g.spawn(MONSTERS[k], marks[i]), Object.assign(g.monsters.at(-1), { awake: true, provoked: true }))).filter(Boolean);
    t.foes.forEach(m => g.fx.flash(m, '#4a1040'));
    return g.log(`Wave ${t.wave} of ${waves.length}: the dead claw up through the runes!`, '#f6c');
  }
  unseal();
  const c = { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) };
  g.items.push({ ...makeGear(g.depth + 1, 'rare'), ...c }, { ...makeConsumable(CONSUMABLES.find(k => k.name === 'Greater Healing')), ...c });
  g.fx.flash(c, '#5a4a10');
  Object.assign(p, { hp: p.maxHp, mp: p.maxMp }); // the trial's blessing
  g.fx.flash(p, '#5a3a66');
  g.log('The last of the dead falls. The runes blaze and their power washes over you - fully restored! The seals open, and a reward glints on the sigil.', '#ffd24a');
}

// Breakable walls (secret rooms: cracked bone, thick silk): a few blows and it gives way to its `breakTo` tile.
const BREAK_HITS = 3;
for (const t of Object.values(TILES).filter(t => t.breakable)) t.onBump = (g, x, y) => {
  const hits = (g.map.cracks ||= {})[x + ',' + y] = (g.map.cracks[x + ',' + y] || 0) + 1;
  if (hits < BREAK_HITS) return g.log(`${t.hitMsg}(${BREAK_HITS - hits} more)`, t.color);
  g.map.set(x, y, t.breakTo);
  g.map.computeLights();
  g.fx.flash({ x, y }, '#4a3a20');
  g.log(t.breakMsg, '#ffd24a');
};

// Burning silk (the Silk Hive): silk set alight (scorch -> silkfire) burns 2 turns, each turn spreading to the silk beside
// it (60% per side) - walls burn through into new ways - then leaves ash. Anyone standing in it catches fire (and a
// burning creature sets the silk it walks over alight, see tickStatuses). Lights follow the flames.
function tickFire(g) {
  const m = g.map, lit = m.cells((x, y) => m.get(x, y) === 'silkfire');
  if (!lit.length) return;
  const age = m.fireAge ||= {}, spread = [];
  for (const c of lit) {
    const k = c.x + ',' + c.y;
    for (const [dx, dy] of DIRS.slice(0, 4)) if (TILES[m.get(c.x + dx, c.y + dy)].burnsTo === 'silkfire' && chance(0.6)) spread.push({ x: c.x + dx, y: c.y + dy });
    if ((age[k] = (age[k] || 0) + 1) >= 2) { m.set(c.x, c.y, 'ash'); delete age[k]; }
  }
  spread.forEach(c => m.get(c.x, c.y) !== 'silkfire' && ignite(m, c.x, c.y));
  for (const e of [g.player, ...g.monsters]) if (e.alive && m.get(e.x, e.y) === 'silkfire') applyStatus(e, 'burn', 3, g);
  m.computeLights();
}

// Egg sacs (the Silk Hive, and the Broodmother's clutches): one within 3 tiles of you may start to swell (eggswell - can't
// be stepped on; a turn's warning), and next turn it bursts into spiderlings. Fire destroys them first.
// Spiderlings spilling out of an egg sac / cocoon at `at`: up to n, on it and the free tiles round it. Each starts on
// the sac and scuttles out to its tile (spawnFrom: renderActors slides it from there) popping into being (css hatch);
// the sac bursts (a swelling, fading glyph - float css burst).
function hatch(g, at, n, ch = 'O') {
  const spots = [at, ...shuffle(DIRS.map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy })))].filter(s => g.map.walkable(s.x, s.y) && !g.occupied(s.x, s.y)).slice(0, n);
  spots.forEach(s => {
    g.spawn(MONSTERS.spiderling, s);
    Object.assign(g.monsters.at(-1), { awake: true, spawnFrom: { x: at.x, y: at.y }, flashCss: { turn: g.turn, css: 'hatch' } });
  });
  g.fx.float(at, ch, '#f4ff90', { css: 'burst' });
}
function tickEggs(g) {
  const m = g.map, p = g.player;
  for (const c of m.cells((x, y) => m.get(x, y) === 'eggswell')) {
    m.set(c.x, c.y, 'silkfloor');
    hatch(g, c, 2);
    if (m.visible[c.y][c.x]) g.log('The egg sac bursts - spiderlings spill out!', '#d8e0a0');
  }
  for (const c of m.cells((x, y) => m.get(x, y) === 'eggsac' && dist({ x, y }, p) <= 3))
    if (chance(0.25)) {
      m.set(c.x, c.y, 'eggswell');
      if (m.visible[c.y][c.x]) g.log('An egg sac swells and twitches...', '#d8e0a0');
    }
}

// Bone heaps (levels with `stirBones`: the Ossuary): one within 3 tiles of you may start to stir (bonestir: a turn's
// warning), and next turn a skeleton clambers out of it. Heaps are placed by the generator (bonepile), so it's a handful per floor.
function tickBones(g) {
  if (!g.level.stirBones) return;
  const m = g.map, p = g.player;
  for (const c of m.cells((x, y) => m.get(x, y) === 'bonestir')) {
    m.set(c.x, c.y, 'bones');
    g.spawn(MONSTERS.skeleton, c);
    Object.assign(g.monsters.at(-1), { awake: true, flashCss: { turn: g.turn, css: 'hatch' } });
    if (m.visible[c.y][c.x]) g.log('A skeleton clambers out of the bones!', '#d8cfa8');
  }
  for (const c of m.cells((x, y) => m.get(x, y) === 'bonepile' && dist({ x, y }, p) <= 3 && !g.occupied(x, y)))
    if (chance(0.25)) {
      m.set(c.x, c.y, 'bonestir');
      if (m.visible[c.y][c.x]) g.log('A heap of bones rattles and stirs...', '#d8cfa8');
    }
}

// Stepping into a niche (addNiches): the find recorded in map.nicheFx - a little mana, a trap of bone shards, or just a line of lore.
const NICHE_LORE = ['Bones and a cracked skull, laid to rest long ago.', 'A name is scratched into the stone, worn smooth.', 'Dust and a rusted chain. Nothing worth taking.'];
TILES.niche.onEnter = (g, x, y) => {
  const fx = g.map.nicheFx?.[x + ',' + y];
  if (!fx) return; // (a niche holding a pickup: the pickup is the find)
  g.map.set(x, y, 'nicheused');
  const p = g.player;
  if (fx === 'mp') { p.mp = Math.min(p.maxMp, p.mp + 3); g.log('A skull in the niche glows faintly - your mind clears. (+3 MP)', '#8cf'); }
  else if (fx === 'trap') { const n = 3 + g.depth; g.log(`Bone shards spill from the niche and cut you for ${n}!`, '#f66'); p.hurt(n, g, { obj: 'a burial niche' }); }
  else g.log(pick(NICHE_LORE), '#a89a74');
};

// The hand room (map.handRoom, addHandRoom): step inside and the walls writhe - then 2 a turn the hands set in them (handwall) claw loose: the tile goes
// back to plain bone wall and a crawling hand drops onto a free floor tile beside it, awake and hunting.
function tickHandRoom(g) {
  const hr = g.map.handRoom, m = g.map, p = g.player;
  if (!hr) return;
  if (!hr.woken) {
    if (!(p.x >= hr.x && p.x < hr.x + hr.w && p.y >= hr.y && p.y < hr.y + hr.h)) return;
    hr.woken = true;
    g.log('The walls of the chamber writhe - hands claw their way out of the bone!', '#e8d8b8');
  }
  for (const c of shuffle(m.cells((x, y) => m.get(x, y) === 'handwall')).slice(0, 2)) {
    const spot = pick(DIRS.slice(0, 4).map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(s => m.walkable(s.x, s.y) && !g.occupied(s.x, s.y)));
    if (!spot) continue; // boxed in: it stays a wall of hands for now
    m.set(c.x, c.y, 'bonewall');
    g.spawn(MONSTERS.hand, spot);
    Object.assign(g.monsters.at(-1), { awake: true, spawnFrom: { x: c.x, y: c.y }, flashCss: { turn: g.turn, css: 'hatch' } });
  }
}

// Hidden niche skeletons (levels with `niches`, addNiches): walk past a nicheam (alongside it) and a skeleton lurches out of the alcove.
function tickNiches(g) {
  if (!g.level.niches) return;
  const m = g.map, p = g.player;
  for (const c of m.cells((x, y) => m.get(x, y) === 'nicheam' && dist({ x, y }, p) <= 1 && !g.occupied(x, y))) {
    m.set(c.x, c.y, 'niche');
    g.spawn(MONSTERS.skeleton, c);
    Object.assign(g.monsters.at(-1), { awake: true, flashCss: { turn: g.turn, css: 'hatch' } });
    g.log('A skeleton lurches out of a burial niche!', '#d8cfa8');
  }
}

// Oil lamp (Silk Hive walls - left by earlier explorers; the only steady light): walk into it to knock it down - it and
// the silk walls round it catch fire (the floor a turn later, as it spreads), so any class can burn the hive.
TILES.oillamp.onBump = (g, x, y) => {
  ignite(g.map, x, y);
  DIRS.slice(0, 4).forEach(([dx, dy]) => g.map.get(x + dx, y + dy) === 'silkwall' && ignite(g.map, x + dx, y + dy));
  g.map.computeLights();
  g.log('You knock the oil lamp from its hook - burning oil splashes over the silk!', '#ffa040');
};
// Silk strands (Silk Hive floors; Vanish silences them): your steps send a tremor down the web - sleeping spiders within 6 wake. Ash and bare
// floor are silent.
TILES.silkfloor.onEnter = (g, x, y) => {
  if (g.player.status.hidden) return; // Vanish: you step lightly
  const woken = g.monsters.filter(m => m.alive && !m.awake && m.webs && dist(m, { x, y }) <= 6 && g.map.hasLos(m, { x, y }));
  if (!woken.length) return;
  woken.forEach(m => { m.awake = true; });
  g.log('The silk trembles under your feet - something stirs in the dark.', '#c8c898');
};
// Mend a burnt tile (silk weavers): back to the silk it was - a wall again (unless someone's standing there), else strands.
function reweave(g, c) {
  const k = c.x + ',' + c.y, was = g.map.unburnt?.[k];
  delete g.map.unburnt[k];
  g.map.set(c.x, c.y, ['silkwall', 'thicksilk', 'oillamp'].includes(was) && !g.occupied(c.x, c.y) ? 'silkwall' : 'silkfloor');
  g.map.computeLights();
  if (g.map.visible[c.y][c.x]) g.log('A silk weaver spins the burnt gap closed.', '#e8d088');
}

// A snuffed grave candle (the Wight's tomb): walk into it to light it again.
TILES.candleout.onBump = (g, x, y) => {
  g.map.set(x, y, 'candle'); g.map.computeLights();
  g.log('You relight the grave candle - its green glow pushes back the dark.', '#c8f0a8');
};

// Cocoon (the Silk Hive): walk into it to cut it open - an old adventurer's gear (half the time), a spiderling brood (a
// quarter) or a dried husk.
TILES.cocoon.onBump = (g, x, y) => {
  g.map.set(x, y, 'silkfloor');
  const r = Math.random();
  if (r < 0.5) {
    g.items.push({ ...makeGear(g.depth + 1, chance(0.3) ? 'rare' : 'magic'), x, y });
    g.log('You slit the cocoon open. Inside, a long-dead adventurer - and their gear!', '#ffd24a');
  } else if (r < 0.75) {
    hatch(g, { x, y }, 3, '0');
    g.log('You slit the cocoon open - and a brood of spiderlings boils out!', '#d8e0a0');
  } else g.log('You slit the cocoon open. Only a dried husk inside.', '#aaa');
};

// Engraved plaque (chamber-crypt entrance hall): walking into it reads the level's `plaque` text.
TILES.plaque.onBump = g => g.log(`Carved into the marble: "${g.level.plaque || 'Here lie the faithful dead. Disturb them not.'}"`, '#e8c060');

// Sarcophagus ambush: stepping onto the plinth (the treasure is on it) bursts every coffin around it open - a skeleton
// (sometimes a ghoul) climbs out of each, leaving bones behind.
TILES.plinth.onEnter = (g, x, y) => {
  g.map.set(x, y, 'floor');
  const lids = g.map.cells((cx, cy) => g.map.get(cx, cy) === 'sarcophagus' && dist({ x: cx, y: cy }, { x, y }) <= 4);
  if (!lids.length) return;
  g.log('As you reach for the treasure, the sarcophagus lids crash open!', '#f96');
  lids.forEach(c => {
    g.map.set(c.x, c.y, 'bones');
    g.spawn(MONSTERS[chance(0.3) ? 'ghoul' : 'skeleton'], c);
    Object.assign(g.monsters.at(-1), { awake: true, provoked: true });
    g.fx.flash(c, '#3a2a10');
  });
};

// Your snare: the first enemy to step in is stuck fast (can't move, can still fight).
TILES.snare.onMonster = (g, m, x, y) => {
  if (m.ally) return;
  clearTimed(g, x, y);
  if (g.map.visible[y][x]) g.log(`${m.subj} is caught in your snare!`, '#dca060');
  applyStatus(m, 'stuck', 4, g, true);
};
TILES.caltrops.onMonster = (g, m, x, y) => {
  if (m.ally) return;
  if (g.map.visible[y][x]) g.log(`${m.subj} ${m.verb('step')} on caltrops.`, '#bbb');
  m.hurt(2, g, g.player);
};

// Ore vein: two hits break it open for loot; sometimes there's a hidden pocket behind it.
TILES.ore.onBump = (g, x, y) => {
  const hits = g.map.oreHits || (g.map.oreHits = {}), k = x + ',' + y;
  hits[k] = (hits[k] || 0) + 1;
  if (hits[k] < 2) return g.log('You chip at the ore vein. It cracks...', '#e8c050');
  g.map.set(x, y, 'floor');
  const loot = chance(0.3) ? makeGear(g.depth + 1, chance(0.3) ? 'rare' : 'magic') : randomItem(g.depth + 1);
  g.items.push({ ...loot, x, y });
  g.log(`The vein breaks open, revealing ${itemName(loot)}.`, '#e8c050');
  if (!chance(0.25)) return;
  const c = { x: x + 2 * Math.sign(x - g.player.x), y: y + 2 * Math.sign(y - g.player.y) };
  for (let j = c.y - 1; j <= c.y + 1; j++)
    for (let i = c.x - 1; i <= c.x + 1; i++) if (g.map.get(i, j) === 'wall' && i > 0 && j > 0 && i < g.map.w - 1 && j < g.map.h - 1) g.map.set(i, j, 'floor');
  if (g.map.walkable(c.x, c.y)) g.items.push({ ...randomItem(g.depth + 1), ...c });
  g.map.computeLights();
  g.log('Behind it, a hidden pocket!', '#e8c050');
};

// Spider web: tears when you walk in, but leaves you stuck for 2 turns.
TILES.web.onEnter = (g, x, y) => {
  g.map.set(x, y, 'floor');
  applyStatus(g.player, 'webbed', 3, g); // counts down once this turn, so you're stuck for the next 2
};
TILES.web.onMonster = (g, m, x, y) => {
  if (!trips(m) || m.webs) return;
  g.map.set(x, y, 'floor');
  applyStatus(m, 'webbed', 3, g);
};

// Quicksand: looks much like mud, but grabs you for 2 turns.
TILES.quicksand.onEnter = g => { g.log('You sink into quicksand!', '#ca8'); applyStatus(g.player, 'stuck', 3, g, true); };
TILES.quicksand.onMonster = (g, m, x, y) => {
  if (!trips(m) || m.swim) return; // swimmers wade through
  if (seenAt(g, x, y)) g.log(`${m.subj} ${m.verb('sink')} into quicksand!`, '#ca8');
  applyStatus(m, 'stuck', 3, g, true);
};

// Swamp gas vents (level.gas): each turn a quiet vent may start to swell (a pulsing bubble - your warning); 2 turns
// later it bursts, puffing poison over the tiles around it (fliers are above it). Fire burns a vent out (burnsTo).
const GAS_WARN = 2;
function swampGas(g) {
  const m = g.map, swell = m.swellAt ||= {};
  m.vents ||= m.cells((x, y) => ['gasvent', 'gasswell'].includes(m.get(x, y)));
  for (const v of m.vents) {
    const t = m.get(v.x, v.y), k = v.x + ',' + v.y;
    if (t === 'gasvent' && chance(0.12)) {
      m.set(v.x, v.y, 'gasswell');
      swell[k] = g.turn + GAS_WARN;
      if (dist(v, g.player) <= 2 && m.visible[v.y][v.x]) g.log('A gas vent bubbles and swells...', '#bd6');
    }
    if (t !== 'gasswell' || g.turn < swell[k]) continue;
    m.set(v.x, v.y, 'gasvent');
    if (m.visible[v.y][v.x]) g.fx.puff(v, 1, '110,170,30');
    if (dist(v, g.player) <= 1 && m.visible[v.y][v.x]) g.log('A bubble of swamp gas bursts beside you!', '#9c4');
    for (const e of [g.player, ...g.monsters]) if (e.alive && !e.fly && dist(e, v) <= 1) applyStatus(e, 'poison', 2, g);
  }
}

// Rotten boardwalk (the Mire): a third of the time the planks give way - you drop into the mud below and lose a turn.
TILES.rotboard.onEnter = (g, x, y) => {
  if (!chance(0.35)) return g.log('The rotten planks creak alarmingly underfoot.', '#a89060');
  g.map.set(x, y, 'mud');
  g.skipTurn = true;
  g.fx.flash({ x, y }, '#3a2a10');
  g.log('The planks give way - you crash down into the sucking mud!', '#c8a060');
};
// The bog witch's cauldron: stir it and it brews you one potion (healing most often), then goes cold.
TILES.cauldron.onBump = (g, x, y) => {
  const brew = pick(['Healing Potion', 'Healing Potion', 'Mana Potion', 'Greater Healing']);
  g.items.push({ ...makeConsumable(CONSUMABLES.find(c => c.name === brew)), x: g.player.x, y: g.player.y });
  g.map.set(x, y, 'cauldroncold'); g.map.computeLights();
  g.log(`You stir the witch's cauldron - it belches green smoke and leaves behind a ${brew}.`, '#9fdc50');
  g.lookHere();
};
TILES.cauldroncold.onBump = g => g.log('The cauldron has gone cold.', '#888');

// Mold patch: stepping on it releases poisonous spores.
TILES.moldpatch.onEnter = (g, x, y) => {
  g.log('Spores burst from the mold underfoot!', '#9c6');
  applyStatus(g.player, 'poison', 2, g);
};

// Fire destroys burnable tiles (mold, webs) on the given cells.
function scorch(g, cells) {
  for (const c of cells) {
    const to = TILES[g.map.get(c.x, c.y)].burnsTo;
    if (to === 'silkfire') ignite(g.map, c.x, c.y);
    else if (to) g.map.set(c.x, c.y, to);
  }
}
// Set silk alight, remembering what it was (map.unburnt) so silk weavers can mend it.
function ignite(map, x, y) {
  (map.unburnt ||= {})[x + ',' + y] ||= map.get(x, y);
  map.set(x, y, 'silkfire');
}

// Level-driven spreading tile. spread = { tile, chance, max, sprout, sproutChance, maxSprouts }:
// each patch may grow into a neighbouring floor tile; dense growth occasionally sprouts a monster.
function growSpread(g, s) {
  const m = g.map;
  const patches = m.cells((x, y) => m.get(x, y) === s.tile);
  let total = patches.length;
  for (const c of patches) {
    if (total >= s.max || !chance(s.chance)) continue;
    const [dx, dy] = pick(DIRS);
    if (m.get(c.x + dx, c.y + dy) === 'floor') { m.set(c.x + dx, c.y + dy, s.tile); total++; }
  }
  if ((g.sprouts || 0) >= s.maxSprouts || !chance(s.sproutChance)) return;
  const dense = patches.filter(c => !g.occupied(c.x, c.y) && dist(c, g.player) > 3 &&
    DIRS.filter(([dx, dy]) => m.get(c.x + dx, c.y + dy) === s.tile).length >= 3);
  const at = pick(dense);
  if (!at) return;
  g.spawn(MONSTERS[s.sprout], at);
  g.sprouts = (g.sprouts || 0) + 1;
  if (m.visible[at.y][at.x]) g.log(`A ${MONSTERS[s.sprout].name} sprouts from the growth!`, '#9c6');
}

// ---- Tides (level.tide = { low, high } turns) ----
// Cycle: low -> rising (TIDE_WAVES turns) -> high -> falling (TIDE_WAVES turns). The water comes in wave by wave:
// tidal tiles farthest from dry land flood first (the middle of a causeway), the ones touching land last.
const TIDE_WAVES = 4;
function tidePhase(g, t) {
  const W = TIDE_WAVES, ph = g.turn % (t.low + t.high + 2 * W);
  if (ph < t.low) return { level: 0, name: 'LOW', left: t.low - ph };
  if (ph < t.low + W) return { level: ph - t.low + 1, name: 'RISING', left: t.low + W - ph };
  if (ph < t.low + W + t.high) return { level: W, name: 'HIGH', left: t.low + W + t.high - ph };
  const f = ph - t.low - W - t.high;
  return { level: W - 1 - f, name: 'FALLING', left: W - f };
}

// Steps from dry land for every tidal tile (tideflat/tidewater), computed once per map.
function tidalDepths(m) {
  const tidal = (x, y) => ['tideflat', 'tidewater'].includes(m.get(x, y));
  const depth = grid(m.w, m.h, 0), q = [];
  m.tideCells = m.cells(tidal);
  for (const c of m.tideCells)
    if (DIRS.slice(0, 4).some(([dx, dy]) => m.walkable(c.x + dx, c.y + dy) && !tidal(c.x + dx, c.y + dy))) { depth[c.y][c.x] = 1; q.push(c); }
  for (let i = 0; i < q.length; i++)
    for (const [dx, dy] of DIRS.slice(0, 4)) {
      const x = q[i].x + dx, y = q[i].y + dy;
      if (tidal(x, y) && !depth[y][x]) { depth[y][x] = depth[q[i].y][q[i].x] + 1; q.push({ x, y }); }
    }
  m.tideCells.forEach(c => (depth[c.y][c.x] ||= TIDE_WAVES)); // flats not touching land flood with the first wave
  return depth;
}

function tide(g, t) {
  const m = g.map, { level, name, left } = tidePhase(g, t), prev = m.tideName;
  m.tideDepth ||= tidalDepths(m);
  if (name === 'LOW' && left === 3) g.log('Water gurgles through the channels - the tide will turn soon.', '#6ad');
  if (prev && prev !== name) g.log({ RISING: 'The tide turns. Water creeps in over the flats!', HIGH: 'The tide is high.',
    FALLING: 'The tide begins to ebb.', LOW: 'The flats lie bare at low tide.' }[name], '#6ad');
  m.tideName = name;
  const flooded = [];
  for (const c of m.tideCells) {
    const wet = level > 0 && level >= TIDE_WAVES + 1 - Math.min(m.tideDepth[c.y][c.x], TIDE_WAVES), tile = m.get(c.x, c.y);
    if (wet && tile === 'tideflat') { m.set(c.x, c.y, 'tidewater'); flooded.push(c); }
    else if (!wet && tile === 'tidewater') m.set(c.x, c.y, 'tideflat');
  }
  for (const c of flooded) { // whoever stood there is swept to dry ground; you lose your next turn
    const e = c.x === g.player.x && c.y === g.player.y ? g.player : g.monsterAt(c.x, c.y);
    if (e && !e.swim) sweep(g, e);
  }
}

// Carries e to the nearest free tile it can stand on (reached through water or open ground), preferring solid land.
function sweep(g, e) {
  const m = g.map, d = m.distanceFrom(e.x, e.y, (x, y) => m.walkable(x, y) || !!TILES[m.get(x, y)].swim);
  const spot = m.cells((x, y) => d[y][x] < Infinity && m.walkable(x, y) && !g.occupied(x, y))
    .sort((a, b) => d[a.y][a.x] + (m.get(a.x, a.y) === 'tideflat' ? 50 : 0) - d[b.y][b.x] - (m.get(b.x, b.y) === 'tideflat' ? 50 : 0))[0];
  if (!spot) return;
  g.fx.bolt(e, spot, '~', '#6ad');
  Object.assign(e, { x: spot.x, y: spot.y });
  if (e === g.player) { g.log('The tide sweeps you off your feet and drags you ashore!', '#6ad'); g.skipTurn = true; }
  else if (m.visible[spot.y][spot.x]) g.log(`The tide sweeps ${e.obj} away.`, '#6ad');
}

// Shrine altar: one prayer fully restores HP and MP and cleanses harmful statuses.
TILES.altar.onBump = (g, x, y) => {
  const p = g.player;
  p.hp = p.maxHp; p.mp = p.maxMp;
  for (const k of ['poison', 'burn', 'cursed', 'afflicted', 'fear']) delete p.status[k];
  g.map.set(x, y, 'altarUsed');
  g.fx.area(p, 1, '#555533');
  g.log('You kneel at the altar. Warm light washes over you: fully restored.', '#ffd');
};
TILES.altarUsed.onBump = g => g.log('The altar has gone cold.', '#888');

// Sarcophagus: opens into a walkable coffin holding loot, an angry corpse, or just bones.
TILES.sarcophagus.onBump = (g, x, y) => {
  const r = Math.random();
  g.fx.flash({ x, y }, '#5a4a30');
  if (r < 0.1) {
    g.map.set(x, y, 'bones');
    return g.log('You slide the lid aside. Only old bones inside.', '#bbb');
  }
  g.map.set(x, y, 'coffin');
  if (r < 0.35) {
    const spot = pick(freeCellsNear(g, { x, y }));
    if (spot) {
      g.spawn(MONSTERS[pick(['skeleton', 'ghoul'])], spot);
      g.monsters[g.monsters.length - 1].awake = true;
      g.fx.flash(spot, '#6a1a1a');
      g.log('Something lurches out of the sarcophagus!', '#f66');
    }
    if (chance(0.5)) return;
  }
  const loot = chance(0.75) ? makeGear(g.depth + 1, chance(0.35) ? 'rare' : 'magic') : randomItem(g.depth + 1);
  g.items.push({ ...loot, x, y });
  g.log(`You pry open the sarcophagus. Inside lies ${itemName(loot)}.`, '#fd6');
};
