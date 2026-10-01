// Game state, turn loop, player actions and input. Drawing lives in ui.js.
const DEFAULT_SIZE = [96, 48]; // floor size unless a level sets `size`
const VIEW_ROWS = 23;   // visible rows (zoom level); columns adapt to the window's width
const ENEMY_MIN_CD = 3; // enemy casters (no mana): shortest recharge of any skill (runSkill)

const MOVES = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
  KeyQ: [-1, -1], KeyE: [1, -1], KeyZ: [-1, 1], KeyC: [1, 1],
  Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0],
  Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
};
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Player options persist in this browser (localStorage may be unavailable - then defaults are used).
function loadOption(k, def) { try { const v = localStorage.getItem('crystal.' + k); return v === null ? def : v === 'true'; } catch { return def; } }
function saveOption(k, v) { try { localStorage.setItem('crystal.' + k, String(v)); } catch { /* not saved */ } }

class Game {
  constructor() {
    this.$map = document.getElementById('map');
    this.$view = document.getElementById('view');
    this.$stage = document.getElementById('stage');   // map + creature layer; slides with the camera (smooth movement)
    this.$actors = document.getElementById('actors'); // creature layer for smooth movement
    this.$puffs = document.getElementById('puffs');   // animated clouds (fx.puff)
    this.$floats = document.getElementById('floats'); // floating damage / heal numbers (fx.float)
    this.smooth = loadOption('smooth', true);
    this.sharedVision = loadOption('sharedVision', true);
    this.gearLook = loadOption('gearLook', true); // your gear shows on your tile (heroGearLook)
    this.$side = document.getElementById('side');
    this.$log = document.getElementById('log');
    this.$banner = document.getElementById('banner');
    this.fx = new Fx(this);
    document.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('resize', () => this.render());
    this.showTitle();
  }

  start(cls) {
    this.state = 'play';
    this.player = new Player(cls, 0, 0);
    this.depth = 0;
    this.turn = 0;
    this.messages = [];
    this.menu = this.targeting = null;
    this.dead = false;
    this.floors = {}; // depth -> saved floor (see changeLevel)
    this.alliesHold = false; this.allyStance = 'aggressive'; // a new game starts with fresh orders
    this.fallen = []; // dead companions (Resurrection)
    this.side = this.sideBack = this.testLevel = null; // on the main floors
    this.addItem({ ...makeConsumable(CONSUMABLES[0]), count: 2 });
    this.loadLevel();
  }

  get level() { return this.side ? SIDE_LEVELS[this.side] : this.testLevel || LEVELS[this.depth]; } // side: a side-floor; testLevel: debug J

  // Generates a brand-new floor for this.depth. `followers` (allies coming along) are placed next to you.
  loadLevel(followers = []) {
    const def = this.level;
    const [w, h] = def.size || DEFAULT_SIZE;
    this.map = keepLargestRegion(def.gen(w, h), def.solid);
    this.map.computeLights();
    const m = this.map, pass = (x, y) => m.passable(x, y);
    const floors = m.cells((x, y) => m.walkable(x, y) && !m.noSpawn?.[y][x]);
    // Start: random, or (levels with a boss lair) among the tiles farthest from the boss.
    let start = m.start || pick(floors); // start: a generator can set it (the swamp's fishermen's camp)
    if (m.bossSpot && !m.start) { // (a start the generator chose wins)
      const db = m.distanceFrom(m.bossSpot.x, m.bossSpot.y, pass);
      const byDist = floors.filter(c => db[c.y][c.x] < Infinity).sort((a, b) => db[b.y][b.x] - db[a.y][a.x]);
      start = pick(byDist.slice(0, Math.max(1, byDist.length / 5 | 0))) || start;
    }
    const d = m.distanceFrom(start.x, start.y, pass);
    const reach = floors.filter(c => d[c.y][c.x] < Infinity); // locked vaults are excluded
    // Stairs/goal: fixed by the generator, within def.goalRange steps if set, else the farthest reachable tile.
    const [lo, hi] = def.goalRange || [];
    const far = m.stairs || (lo && pick(reach.filter(c => d[c.y][c.x] >= lo && d[c.y][c.x] <= hi)))
      || reach.reduce((a, b) => (d[b.y][b.x] > d[a.y][a.x] ? b : a));
    // Safety net: a generator-placed goal you can't reach (even opening locked doors) means a bad map - roll a new one.
    const dl = m.stairs && m.distanceFrom(start.x, start.y, (x, y) => pass(x, y) || !!TILES[m.get(x, y)].locked || !!TILES[m.get(x, y)].breakable);
    if (dl && dl[far.y][far.x] === Infinity && (this.regens = (this.regens || 0) + 1) < 5) return this.loadLevel(followers);
    this.regens = 0;

    const p = this.player;
    Object.assign(p, start);
    if (this.depth > 0) m.set(start.x, start.y, 'upstairs'); // the way back up
    this.upStairs = this.depth > 0 ? start : null;
    this.monsters = [];
    this.items = [];
    this.orb = this.coil = null;
    this.sprouts = 0;

    if (def.final) this.items.push({ ...CRYSTAL, ch: ITEM_LOOK.crystal[0], color: ITEM_LOOK.crystal[1], ...far });
    else if (!def.noStairs) { // (side-floors have no way down - only back up)
      this.map.set(far.x, far.y, 'stairs');
      if (this.depth === 0) this.map.seen[far.y][far.x] = true; // overworld entrance is known from the start
    }
    this.stairs = def.final || def.noStairs ? null : far;

    const inReserved = c => m.reserved.some(r => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h); // lairs stay their owners'
    const free = (near = null, dark = false) => {
      const ok = reach.filter(c => !this.occupied(c.x, c.y) && !this.itemAt(c.x, c.y) && !['stairs', 'upstairs'].includes(this.map.get(c.x, c.y))
        && (near ? dist(c, near) <= 2 : d[c.y][c.x] > 6) && !inReserved(c) && !(dark && this.map.isLit(c.x, c.y)));
      return pick(ok.length ? ok : reach);
    };
    this.placeFollowers(followers);
    if (def.boss) this.spawn(MONSTERS[def.boss], m.bossSpot && !this.occupied(m.bossSpot.x, m.bossSpot.y) ? m.bossSpot : free(far));
    for (const grp of def.groups || []) // war bands etc.: members spawn together
      for (let i = 0; i < scaled(grp.count, w, h); i++) {
        const at = free();
        grp.monsters.forEach(k => this.spawn(MONSTERS[k], free(at)));
      }
    for (let i = 0; i < scaled(def.count, w, h); i++) {
      const t = MONSTERS[pick(def.monsters)];
      this.spawn(t, free(null, t.shunLight));
    }
    for (const s of this.map.spawns) {
      const t = s.template || MONSTERS[s.monster];
      if (this.canEnter(t, s.x, s.y) && !this.occupied(s.x, s.y)) this.spawn(t, s);
    }
    for (const l of m.loot.filter(l => m.walkable(l.x, l.y))) {
      const it = l.item ? makeConsumable(CONSUMABLES.find(c => c.name === l.item)) : l.base ? makeGear(this.depth + 1, 'common', null, l.base) : l.rarity ? makeGear(this.depth + 1, l.rarity, l.pool) : randomItem(this.depth + 1);
      this.items.push({ ...it, x: l.x, y: l.y });
    }
    for (let i = 0; i < scaled(def.items, w, h); i++) this.items.push({ ...randomItem(this.depth), ...free() });
    this.items.push({ ...this.makeBook(), ...free() }); // a tome on every floor (bosses with `tome` drop another)

    this.log(`You enter ${def.name}. ${def.intro}`, '#ff0');
    this.updateView();
    this.render();
  }

  // 60% chance the tome belongs to your class (own: always); otherwise it's another class's (worth some XP).
  makeBook(own = false) {
    const cls = own || chance(0.6) ? this.player.cls : pick(CLASSES.filter(c => c !== this.player.cls));
    const [ch, color] = ITEM_LOOK.book;
    return { kind: 'book', cls, name: `${cls.title}'s Tome`, ch, color };
  }

  // ---- queries ----
  spawn(template, pos) { this.monsters.push(new Monster(template, pos.x, pos.y)); }
  monsterAt(x, y) { return this.monsters.find(m => m.alive && m.x === x && m.y === y); }
  itemAt(x, y) { return this.items.find(i => i.x === x && i.y === y); }
  occupied(x, y) { return (this.player.x === x && this.player.y === y) || !!this.monsterAt(x, y); }
  hostilesWhere(pred) { return this.monsters.filter(m => m.alive && !m.ally && pred(m)); }
  inRange(a, b, range = a.range) { return dist(a, b) <= range && this.map.hasLos(a, b); }

  // ---- movement helpers shared by player, skills and AI ----
  moveTo(e, x, y) {
    if (dist(e, { x, y }) === 1 && !this.map.canStep(e.x, e.y, x, y)) return false; // no squeezing past corners
    const here = TILES[this.map.get(e.x, e.y)]; // mud / flood water (slow): every other turn, swimmers excepted;
    if (e !== this.player && (here.slow && !e.swim || here.snag && !e.ally) && this.turn % 2) return false; // caltrops: enemies
    if (e !== this.player && TILES[this.map.get(x, y)].door) { openDoor(this, x, y); return true; } // monsters open doors
    if (e.rooted || e !== this.player && Object.keys(e.status).some(k => STATUS[k].hold)) return false; // rooted (bone forge); webbed / stuck (you: Game.move)
    if (!this.canEnter(e, x, y) || this.occupied(x, y) || e.shunLight && this.map.isLit(x, y)) return false;
    e.x = x; e.y = y;
    if (e !== this.player) TILES[this.map.get(x, y)].onMonster?.(this, e, x, y); // your snares, caltrops
    return true;
  }
  tideHigh() { return !!this.level.tide && tidePhase(this, this.level.tide).name === 'HIGH'; }
  // Walkable ground, or deep water for swimmers.
  canEnter(e, x, y) { const t = TILES[this.map.get(x, y)]; return t.walk || !!((e.swim || e.fly) && t.swim); } // fly: over water
  // Submerged swimmers (drowned ones in deep water) stay hidden until they're right next to you.
  submerged(m) { return !!m.submerge && !!TILES[this.map.get(m.x, m.y)].swim && dist(m, this.player) > 1; }
  seesMonster(m) { return this.map.visible[m.y][m.x] && !this.submerged(m); }
  // In a fight: some monster is targeting e (you by default) - m.target, set each turn by pickTarget.
  inCombat(e = this.player) { return this.monsters.some(o => o.alive && o.awake && o.target === e); }
  // Follows the BFS distance map toward the player (true pathfinding around walls).
  // Allies stuck behind other allies (every step closer is taken) swap places with one that won't be moving on anyway
  // (waiting, already by you, or itself blocked) and isn't fighting - never twice in a turn, so two allies can't
  // trade places back and forth. Otherwise they sidestep to a free tile just as close. Keeps corridors from jamming.
  stepAlongPath(m, d = this.distMap) {
    const here = d[m.y][m.x], around = (e, x = e.x, y = e.y) => DIRS.map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
      .filter(c => this.map.passable(c.x, c.y) && this.map.canStep(x, y, c.x, c.y));
    const closer = around(m).filter(c => d[c.y][c.x] < here).sort((a, b) => d[a.y][a.x] - d[b.y][b.x]);
    const best = closer.find(c => !this.occupied(c.x, c.y));
    if (best) return this.moveTo(m, best.x, best.y);
    if (!m.ally) return false;
    const busy = o => this.monsters.some(f => f.alive && this.hostile(o, f) && dist(f, o) === 1);
    const staying = o => o.hold || dist(o, this.player) <= 2 || !around(o).some(c => d[c.y][c.x] < d[o.y][o.x] && !this.occupied(c.x, c.y));
    const mate = m.swapped !== this.turn && closer.map(c => this.monsterAt(c.x, c.y))
      .find(o => o?.ally && o.swapped !== this.turn && staying(o) && !busy(o) && this.canEnter(o, m.x, m.y));
    if (mate) { [mate.x, mate.y, m.x, m.y] = [m.x, m.y, mate.x, mate.y]; m.swapped = mate.swapped = this.turn; return true; }
    const side = shuffle(around(m).filter(c => d[c.y][c.x] === here && !this.occupied(c.x, c.y)))[0];
    return side ? this.moveTo(m, side.x, side.y) : false;
  }
  // Greedy step toward any point. Returns true if it moved.
  stepToward(m, target) {
    return shuffle(DIRS).map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }))
      .filter(c => dist(c, target) < dist(m, target))
      .some(c => this.moveTo(m, c.x, c.y));
  }
  // Step directly away from `from` (e.g. a ranged companion backing off). Returns true if it moved.
  stepAway(m, from) { return this.stepToward(m, { x: 2 * m.x - from.x, y: 2 * m.y - from.y }); }
  // A monster's `shot` ({ ch, color, verb, status, mult, magic }) customises its projectile's look, wording, on-hit
  // status, damage multiplier and whether it scales with INT.
  shoot(m, target) {
    const s = m.shot || {};
    this.fx.bolt(m, target, s.ch || '*', s.color || m.color);
    m.attack(target, this, { verb: s.verb || 'shoot', status: s.status, mult: s.mult, magic: !!s.magic });
  }

  // ---- player actions (return true if a turn was spent) ----
  move(dx, dy) {
    const p = this.player, x = p.x + dx, y = p.y + dy;
    if (!this.ghost && !this.map.canStep(p.x, p.y, x, y)) return false; // can't squeeze (or reach) past a corner
    let m = this.monsterAt(x, y);
    if (m && m.pass && !this.ghost) { m.hp = 0; m = null; } // a spider's leg: you push past it (it folds away) instead of attacking
    if (m && m.captive) { this.freeCaptive(m); return true; }
    if (m && !m.ally) { p.attack(m, this); return true; }
    if (m) { [m.x, m.y] = [p.x, p.y]; p.x = x; p.y = y; this.lastDir = [dx, dy]; return this.arrive(x, y); } // swap with an ally, then arrive as usual
    if (this.ghost) { // debug no-clip: walk through anything inside the map
      if (!this.map.inBounds(x, y)) return false;
      p.x = x; p.y = y;
      this.lookHere();
      return this.takeStairs(x, y);
    }
    if (Object.keys(p.status).some(k => STATUS[k].hold)) {this.log('You struggle to break free.', '#ddd'); return true; }
    const bump = TILES[this.map.get(x, y)].onBump;
    if (bump) { bump(this, x, y); return true; }
    if (!this.moveTo(p, x, y)) return false;
    this.lastDir = [dx, dy]; // where you're heading (vanguard companions walk ahead of you)
    return this.arrive(x, y);
  }

  // You've stepped onto (x, y): tile effects (traps, webs...), see what's lying there, take stairs.
  arrive(x, y) {
    TILES[this.map.get(x, y)].onEnter?.(this, x, y);
    const t = TILES[this.map.get(x, y)];
    if (t.slow) { // wading through mud / flood water costs an extra turn (said once per floor and kind)
      this.skipTurn = true;
      if (!(this.map.slowWarned ||= {})[t.name]) { this.map.slowWarned[t.name] = true; this.log(`The ${t.name} slows you down.`, '#a87'); }
    }
    this.lookHere();
    return this.takeStairs(x, y);
  }

  // Standing on stairs moves you between floors (no turn passes); otherwise the move used a turn.
  // A living boss with `seals` (a message) bars the way down.
  takeStairs(x, y) {
    const t = this.map.get(x, y), warden = t === 'stairs' && !this.ghost && this.monsters.find(m => m.alive && m.seals);
    if (warden) return this.log(warden.seals, warden.color), true;
    if (TILES[t].side) return this.enterSide(TILES[t].side), false; // a way down into a side-floor (the Ossuary...)
    if (t === 'stairs') return this.changeLevel(1), false;
    if (t === 'upstairs') return (this.side ? this.leaveSide() : this.changeLevel(-1)), false;
    return true;
  }

  // Leave this floor (saved as-is) for the one above/below: revisit it if seen before, else generate it.
  // Companions always come along; raised skeletons only if within 2 tiles. Wait orders are cancelled.
  // ---- floors ----
  // Floors are kept in game.floors under a key: the depth, or 'depth:name' for a side-floor (SIDE_LEVELS - e.g. the
  // Ossuary under the crypt). switchFloor saves the floor you're leaving and loads or restores the one you're going to.
  floorKey() { return this.side ? this.depth + ':' + this.side : this.depth; }
  // dest: { depth, side?, testLevel? }; arriveAt(saved floor) -> where you appear on a floor you've been to before.
  switchFloor(dest, arriveAt, verb) {
    const p = this.player;
    const followers = this.monsters.filter(m => m.alive && m.ally && (m.companion || dist(m, p) <= 2));
    followers.forEach(m => { m.hold = false; m.order = null; }); // orders don't carry over to a new floor
    this.alliesHold = false;
    this.floors[this.floorKey()] = { map: this.map, monsters: this.monsters.filter(m => !followers.includes(m)), items: this.items,
      orb: this.orb, coil: this.coil, sprouts: this.sprouts, stairs: this.stairs, upStairs: this.upStairs,
      testLevel: this.testLevel, sideBack: this.sideBack };
    Object.assign(this, { depth: dest.depth, side: dest.side || null, testLevel: dest.testLevel || null, targeting: null });
    const saved = this.floors[this.floorKey()];
    if (!saved) this.loadLevel(followers);
    else {
      Object.assign(this, saved);
      delete this.floors[this.floorKey()];
      Object.assign(p, arriveAt(saved));
      this.placeFollowers(followers);
      this.log(`You ${verb} to ${this.level.name}.`, '#ff0');
      this.updateView();
    }
    const skels = followers.filter(m => !m.companion).length, names = followers.filter(m => m.companion).map(m => `your ${m.name}`);
    if (skels) names.push(`${skels} skeleton${skels > 1 ? 's' : ''}`);
    const who = names.join(', ').replace(/, ([^,]*)$/, ' and $1');
    if (names.length) this.log(`${who[0].toUpperCase() + who.slice(1)} follow${names.length === 1 && skels <= 1 ? 's' : ''} you.`, '#8cf');
  }
  // Main stairs: one floor down / up, arriving on the stairs you came through. (Leaving a test map returns to the
  // normal floors.)
  changeLevel(dir) {
    this.switchFloor({ depth: this.depth + dir }, s => ({ ...(dir > 0 ? s.upStairs : s.stairs) }), dir > 0 ? 'descend' : 'climb back up');
  }
  // Into a side-floor (a tile with `side`), and back out onto the tile you went in by.
  enterSide(name) {
    const back = { depth: this.depth, testLevel: this.testLevel, x: this.player.x, y: this.player.y };
    this.switchFloor({ depth: this.depth, side: name }, s => ({ ...s.upStairs }), 'descend');
    this.sideBack = back;
  }
  leaveSide() {
    const b = this.sideBack;
    this.switchFloor({ depth: b.depth, testLevel: b.testLevel }, () => ({ x: b.x, y: b.y }), 'climb back up');
  }

  // Put arriving allies on the free tiles closest to you.
  placeFollowers(followers) {
    const p = this.player, m = this.map;
    const spots = m.cells((x, y) => m.walkable(x, y) && dist({ x, y }, p) <= 5 && !['stairs', 'upstairs'].includes(m.get(x, y)))
      .sort((a, b) => dist(a, p) - dist(b, p));
    for (const f of followers) {
      const spot = spots.find(c => !this.occupied(c.x, c.y));
      if (!spot) continue;
      Object.assign(f, spot);
      this.monsters.push(f);
    }
  }

  itemsAt(x, y) { return this.items.filter(i => i.x === x && i.y === y); }

  // Stepping onto items: the Crystal ends the game at once; consumables, keys, tomes and gear for an empty slot you can
  // use are picked up automatically (autoPick); anything else is only announced (G / , picks it up).
  lookHere() {
    const p = this.player;
    if (this.itemsAt(p.x, p.y).some(i => i.kind === 'crystal')) return this.gameOver(true);
    for (const it of this.itemsAt(p.x, p.y)) if (this.autoPick(it)) this.takeItem(it); // checked one by one: an equip fills its slot
    const here = this.itemsAt(p.x, p.y);
    if (here.length === 1) this.log(`You see ${itemName(here[0])} here. <span style="color:#999">(G to pick up)</span>`);
    else if (here.length) this.log(`There are ${here.length} items here. <span style="color:#999">(G to pick up)</span>`);
  }

  autoPick(it) {
    return ['consumable', 'key', 'book'].includes(it.kind) || (it.kind === 'gear' && !this.player.gear[it.slot] && canWear(this.player, it));
  }

  // G / , : one item is taken straight away; a pile opens a list to take from. Picking up takes a turn.
  pickUp() {
    const p = this.player, here = this.itemsAt(p.x, p.y);
    if (!here.length) return this.log('There is nothing here to pick up.'), false;
    if (here.length === 1) return this.takeItem(here[0]);
    this.openPile();
    return false;
  }

  // Gear goes into an empty slot automatically; your class's tome goes into the pack and opens at once. Another class's
  // tome is read on the spot for XP - unless a companion of that class could learn from it: then it's kept (G to give).
  takeItem(item) {
    const p = this.player;
    if (item.kind === 'book' && item.cls !== p.cls && !this.monsters.some(m => m.companion && m.alive && m.cls === item.cls)) this.readBook(item);
    else if (!this.addItem(item)) return this.log(`Your pack is full - ${itemName(item)} stays on the ground.`, '#f88'), false;
    else {
      this.log(`You pick up ${itemName(item)} <span style="color:#999">${itemInfo(item)}</span>`);
      if (item.kind === 'gear' && !p.gear[item.slot] && canWear(p, item)) this.equip(item);
      if (item.kind === 'book' && item.cls === p.cls) this.readBook(item);
      else if (item.kind === 'book') this.log(`Your ${item.cls.title.toLowerCase()} companion could learn from this - stand next to them and give it (I, G).`, '#8cf');
    }
    this.items.splice(this.items.indexOf(item), 1);
    return true;
  }

  // R: drink the healing potion that best fits the HP you're missing - the smallest that covers it, else the biggest.
  quaff() {
    const p = this.player, pots = p.inv.filter(i => i.heals).sort((a, b) => a.heals - b.heals);
    if (!pots.length) return this.log('You have no healing potions.'), false;
    if (p.hp >= p.maxHp) return this.log('You are already at full health.'), false;
    return this.useItem(pots.find(i => i.heals >= p.maxHp - p.hp) || pots[pots.length - 1]);
  }

  // who: the reader - you, or a companion of the tome's class you hand it to (inventory G).
  readBook(book, who = this.player) {
    const p = this.player, used = () => { const i = p.inv.indexOf(book); if (i >= 0) p.inv.splice(i, 1); };
    if (book.cls !== who.cls) {
      used();
      this.log(`The ${book.name} is meant for another path, but you glean some insight.`, '#fd6');
      return p.gainXp(15, this);
    }
    // A tome of the reader's class: choose 1 of its (up to TOME_CHOICES) random pool skills. The offer is rolled once
    // per tome, so closing it (Esc: the tome stays in your pack, U/G to read it later) doesn't re-roll. No turn taken.
    const offer = (book.offer ||= poolPicks(who, TOME_CHOICES)).filter(id => !who.skills.includes(id));
    if (!offer.length) {
      used();
      this.log(`${who === p ? 'You already know' : `Your ${who.name} already knows`} everything this tome can teach. You glean some insight.`, '#fd6');
      return p.gainXp(15, this);
    }
    const learn = id => { used(); if (who === p) p.learn(id, this); else { who.skills.push(id); this.log(`Your ${who.name} learns ${SKILLS[id].name}!`, '#8cf'); } return false; };
    this.openMenu(who === p ? 'TOME - learn one skill' : `TOME - teach your ${who.name} one skill`, [
      { text: `The ${book.name} reveals ${offer.length} technique${offer.length > 1 ? 's' : ''}. Choose one to ${who === p ? 'learn' : 'teach'} <span style="color:#777">(Esc: keep the tome for later)</span>:` },
      { text: '' },
      ...offer.map(id => ({ text: this.skillLine(SKILLS[id]), run: () => learn(id) })),
    ], false);
  }

  // Hotbar key pressed: instant skills fire now, ranged ones enter targeting mode.
  useSkill(slot) {
    const p = this.player, id = p.skills[slot], s = SKILLS[id];
    if (!s || slot >= ACTIVE_SKILLS) return; // reserve skills can't be used
    if (p.status.silenced) return this.log("You are silenced - you can't use skills!", STATUS.silenced.color);
    if (p.mp < s.mp) return this.log(`Not enough mana for ${s.name} (${s.mp} MP).`, '#f88');
    const cd = p.cooldowns?.[id];
    if (cd) return this.log(`${s.name} is recharging (${cd} turn${cd > 1 ? 's' : ''}).`, '#f88');
    if (!s.range) return this.act(() => this.cast(s));
    const list = this.hostilesWhere(m => this.seesMonster(m) && this.inRange(p, m, s.range))
      .sort((a, b) => dist(a, p) - dist(b, p));
    const i = Math.max(0, list.indexOf(this.lastTarget));
    if (s.ground) { // free cursor: starts on an enemy, else the nearest burnable tile, else on you
      const burnable = this.map.cells((x, y) => TILES[this.map.get(x, y)].burnsTo && this.map.visible[y][x] && this.inRange(p, { x, y }, s.range))
        .sort((a, b) => dist(a, p) - dist(b, p))[0];
      const start = list[i] || burnable || p;
      this.targeting = { slot, skill: s, list, i, cursor: { x: start.x, y: start.y } };
      return;
    }
    if (!list.length) return this.log(`No target in range for ${s.name} (range ${s.range}).`);
    this.targeting = { slot, skill: s, list, i };
  }

  // Current aim point while targeting: the free cursor, or the selected enemy.
  get aim() { const t = this.targeting; return t && (t.cursor || t.list[t.i]); }
  aimOk() {
    const a = this.aim, p = this.player;
    return !!a && !(a.x === p.x && a.y === p.y) && this.map.visible[a.y][a.x] && this.inRange(p, a, this.targeting.skill.range);
  }

  // Runs a skill for any caster; while it runs, game.casting marks it so `magic` skills hit with INT (Entity.attack).
  // A skill that went off starts its cooldown: unusable for its next `cd` turns (ticked at the end of each turn).
  // Enemy casters have no mana to run out of, so every skill they cast recharges for at least ENEMY_MIN_CD turns
  // (else a shaman would Firebolt every single turn).
  runSkill(s, caster, target) {
    this.casting = s; this.caster = caster; // caster: whose friends/foes the skill's helpers pick (friendsNear, foesNear)
    this.castN = (this.castN || 0) + 1; // numbers each skill use (a Colossus is hurt once per use)
    let ok;
    try { ok = s.use(this, caster, target); } finally { this.casting = this.caster = null; }
    const cd = Math.max(caster.cooldownOf(s), caster.mp == null ? ENEMY_MIN_CD : 0);
    if (ok && cd) (caster.cooldowns ||= {})[s.id] = cd + 1;
    return ok;
  }

  // `free` skills (e.g. Ethereal Jaunt) don't end the turn.
  cast(s, target) {
    if (!this.runSkill(s, this.player, target)) return false;
    this.player.mp -= s.mp;
    if (s.free) this.updateView();
    return !s.free;
  }

  // ---- turn loop ----
  act(action) {
    this.fx.clear();
    // Stunned / frozen (any `skip` status): whatever you tried, the turn passes. N turns of stun cost N actions.
    const stuck = !this.ghost && Object.keys(this.player.status).find(k => STATUS[k].skip);
    if (stuck) this.log(`You are ${STATUS[stuck].label} and can't act!`, STATUS[stuck].color);
    else if (!action()) return;
    this.endTurn();
    if (this.skipTurn && this.state === 'play') { this.skipTurn = false; this.endTurn(); } // e.g. swept away by the tide
  }

  // Entities with an `aura` (Clerics) carry their own light.
  auraBearers() { return [this.player, ...this.monsters.filter(m => m.alive && m.ally)].filter(e => e.aura); }

  updateView() {
    this.map.addMovingLights([ // auras (Clerics) and glowing creatures (wisps, fireflies)
      ...this.auraBearers().map(e => ({ x: e.x, y: e.y, r: e.aura, color: '255,235,170' })),
      ...this.monsters.filter(m => m.alive && m.glow).map(m => ({ x: m.x, y: m.y, r: m.glow.r, color: m.glow.color }))]);
    this.map.computeFov(this.player, this.level.fov);
    if (this.sharedVision) { // option: companions' sight is added to yours (you still need your own line of sight to aim)
      const party = this.map.visible;
      for (const c of this.monsters.filter(m => m.alive && m.companion)) {
        this.map.computeFov(c, this.level.fov);
        this.map.visible.forEach((row, y) => row.forEach((v, x) => { if (v) party[y][x] = true; }));
      }
      this.map.visible = party;
    }
    this.sight = this.map.visible; // what you really see (monsters wake from this, even with the fog lifted)
    if (this.revealAll) this.map.visible = this.map.seen = grid(this.map.w, this.map.h, true); // debug: no fog (M)
    this.distMap = this.map.distanceFrom(this.player.x, this.player.y, (x, y) => this.map.passable(x, y));
    this.spotTraps();
  }

  // Hidden tiles next to you are found; a Rogue spots every one in sight.
  spotTraps() {
    const m = this.map, p = this.player, rogue = p.cls.key === 'rogue';
    for (let y = p.y - LIT_VIEW; y <= p.y + LIT_VIEW; y++)
      for (let x = p.x - LIT_VIEW; x <= p.x + LIT_VIEW; x++) {
        if (!TILES[m.get(x, y)].hidden || m.found[y][x] || !(dist({ x, y }, p) <= 1 || (rogue && this.sight[y][x]))) continue;
        m.found[y][x] = true;
        this.log(`You spot a ${TILES[m.get(x, y)].name}!`, '#fc6');
      }
  }

  // Goblins lose their nerve: flee, maybe dropping what they carry.
  panic(m) {
    if (m.fled) return;
    m.fled = true;
    applyStatus(m, 'fear', 8, this);
    if (chance(0.3)) this.items.push({ ...randomItem(this.depth), x: m.x, y: m.y });
  }

  // A goblin that has seen you may run to strike the nearest free gong (alarm).
  gongRun(m) {
    const g = m.runTo;
    if (this.map.get(g.x, g.y) !== 'gong') { m.runTo = null; return false; }
    if (dist(m, g) <= 1) { this.map.set(g.x, g.y, 'gongRung'); m.runTo = null; soundAlarm(this, g, `${m.subj} bangs the alarm gong! BWONNG! The warren stirs...`); return true; }
    g.d = g.d || this.map.distanceFrom(g.x, g.y, (x, y) => this.map.passable(x, y));
    this.stepAlongPath(m, g.d);
    return true;
  }

  // Prison pen: an adventurer joins you; a troll stays neutral to you but hunts goblins.
  freeCaptive(m) {
    const p = this.player;
    if (m.captive === 'ally' && p.kin === 'undead' && m.cls.kin !== 'undead') // only a fellow necromancer will serve a necromancer
      return this.log(`The ${m.name} recoils: 'A necromancer?! I'd rather rot in here!'`, '#f88');
    const kind = m.captive;
    Object.assign(m, { captive: null, awake: true });
    if (kind === 'ally') {
      Object.assign(m, { ally: true, ai: 'ally', companion: true, name: m.freedName, kin: m.cls.kin, hold: !!this.alliesHold, lvl: 1, maxMp: m.mp,
        base: { hp: m.maxHp, mp: m.mp, crit: m.crit }, gear: Object.fromEntries(SLOTS.map(s => [s, null])) });
      for (let l = 1; l < p.lvl; l++) growCompanion(m); // catch up to your level
      return this.log(`You free the ${m.name}! They join you. (T: tactics, P: party)`, '#8cf');
    }
    Object.assign(m, { ai: 'hunter', faction: 'troll', name: 'cave troll' }); // goes looking for goblins (AI.hunter)
    this.log('The troll roars and turns on its goblin captors!', '#8a6');
  }

  endTurn() {
    const p = this.player;
    this.turn++;
    if (this.turn % p.cls.regen === 0) p.mp = Math.min(p.maxMp, p.mp + 1);
    if (this.turn % 8 === 0) p.hp = Math.min(p.maxHp, p.hp + 1);
    tickStatuses(p, this);
    if (this.orb && --this.orb.ttl <= 0) this.orb = null;
    if (this.coil && --this.coil.ttl <= 0) this.coil = null;
    this.updateView();
    for (const m of this.monsters) {
      if (this.state !== 'play') return;
      if (!m.alive) continue;
      if (this.sight[m.y][m.x]) m.awake = true;
      if (m.plea && m.captive && this.sight[m.y][m.x]) { this.log(m.plea, '#8cf'); m.plea = null; }
      if (!m.awake || m.partOf) continue; // body parts: moved by their core (never wander off on their own)
      const lost = Object.keys(m.status).find(k => STATUS[k].skip); // stunned / frozen: loses this turn
      tickStatuses(m, this);
      if (lost) m.lostTurn = { turn: this.turn, css: STATUS[lost].css }; // keeps showing it this turn, even if it just ran out
      if (!m.alive || lost) continue;
      m.target = this.pickTarget(m);
      if (m.coward && m.hp < m.maxHp * 0.3) this.panic(m);
      if (m.faction === 'goblin' && m.target === p && !m.runTo && !m.status.fear && chance(0.35)) {
        m.runTo = (this.map.gongs || []).find(gg => this.map.get(gg.x, gg.y) === 'gong' && dist(gg, m) <= 14 && !this.monsters.some(o => o.runTo === gg));
        if (m.runTo && this.map.visible[m.y][m.x]) this.log(`${m.subj} runs for the alarm gong!`, '#ffcc33');
      }
      if (m.runTo && !m.status.fear && this.gongRun(m)) continue;
      if (m.ally) AI[m.ai](m, this); // allies pick their own foes and follow you
      else if (m.status.fear) AI.flee(m, this);
      else if (!m.target && m.ai !== 'multibody' && !m.busy) m.home ? this.stepToward(m, m.home) : AI.wander(m, this); // nothing to fight: guards go home (a multi-tile creature still assembles)
      else if (m.shunLight && this.map.isLit(m.target.x, m.target.y)) AI.wander(m, this); // targets in torchlight are safe from it
      else AI[m.ai](m, this);
      if (m.alive && m.trail && this.map.get(m.x, m.y) === 'floor') this.map.set(m.x, m.y, m.trail);
      if (m.alive && m.status.coiled) this.checkCoil(m);
    }
    this.monsters = this.monsters.filter(m => m.alive);
    // Aura of Light: friendlies within an aura heal 1 HP every 4 turns.
    if (this.turn % 4 === 0) for (const e of this.auraBearers())
      friendsNear(this, e, e.aura).forEach(f => { if (f.hp < f.maxHp) f.hp++; });
    // Companions regain mana at their class's rate, and 1 HP every 3 turns while no enemy is in sight.
    for (const m of this.monsters.filter(o => o.companion)) {
      if (m.mp < m.maxMp && this.turn % m.regen === 0) m.mp++;
      if (this.turn % 3 === 0 && m.hp < m.maxHp && !this.monsters.some(o => o.alive && this.hostile(m, o) && dist(o, m) <= 8 && this.map.hasLos(m, o))) m.hp++;
    }
    tickBurrowed(this); // burrowed bone worms resurface
    tickFire(this); tickEggs(this); tickBones(this); // (Silk Hive) burning silk spreads; egg sacs hatch
    tickTimed(this); // skill-made tiles expire; consecrated ground heals / burns
    trialTick(this); // crypt trial chamber: seal, waves, reward
    if (this.level.spread) growSpread(this, this.level.spread);
    if (this.level.tide) tide(this, this.level.tide);
    if (this.level.gas) swampGas(this);
    for (const e of [p, ...this.monsters]) // skill cooldowns (player and companions)
      for (const k in e.cooldowns) if (--e.cooldowns[k] <= 0) delete e.cooldowns[k];
    closeDoors(this);
    this.updateView();
  }

  // Factions: the player's side (you + allies) vs everyone; monsters also fight rival factions (FACTION_ENEMIES).
  factionOf(e) { return e === this.player || e.ally ? 'player' : e.faction || 'monster'; }
  hostile(a, b) {
    const fa = this.factionOf(a), fb = this.factionOf(b);
    if (fa === fb) return false;
    if ((a.provoked && fb === 'player') || (b.provoked && fa === 'player')) return true;
    if (a.kin === fb || b.kin === fa) return false; // kinship: e.g. raised skeletons and hostile undead leave each other alone
    if (fa === 'player' || fb === 'player') return true;
    return !!FACTION_ENEMIES[fa]?.includes(fb);
  }

  // Nearest hostile the monster can see within 8 tiles; falls back to the player (who it hunts by path)
  // unless you're hidden, in which case it has no target.
  pickTarget(m) {
    const p = this.player;
    if (m.status.taunted && m.tauntedBy?.alive) return m.tauntedBy; // Taunt: must go for whoever taunted it
    const seen = [p, ...this.monsters].filter(o => o !== m && o.alive && !(o === p && (p.status.hidden || this.ghost)) &&
      this.hostile(m, o) && dist(m, o) <= 8 && this.map.hasLos(m, o));
    return seen.sort((a, b) => dist(a, m) - dist(b, m))[0] || (p.status.hidden || this.ghost || !this.hostile(m, p) ? null : p)
      || (m.ai === 'hunter' && this.huntTarget(m)) || null;
  }
  // A hunter's quarry: the enemy it can reach in the fewest steps, anywhere on the floor (not ones behind locked doors).
  huntTarget(m) {
    const d = this.map.distanceFrom(m.x, m.y, (x, y) => this.map.passable(x, y));
    return this.monsters.filter(o => o.alive && o !== m && this.hostile(m, o) && d[o.y][o.x] < Infinity)
      .sort((a, b) => d[a.y][a.x] - d[b.y][b.x])[0];
  }

  // Hurting a neutral (kin) monster makes it and its nearby faction-mates hostile to you.
  provoke(m) {
    if (m.provoked || m.ally || m === this.player) return;
    const wasNeutral = !this.hostile(m, this.player);
    for (const o of this.monsters) if (o === m || (m.faction && o.faction === m.faction && dist(o, m) <= 6)) o.provoked = true;
    if (wasNeutral) this.log(`${m.subj} and its kin turn on you!`, '#f66');
  }

  onDeath(victim, killer) {
    const p = this.player;
    if (victim === p) return this.gameOver(false, killer);
    if (victim.phylactery && tryReform(victim, this)) return; // the Lich comes back while its phylactery stands
    if (victim.deathMsg) this.log(victim.deathMsg, victim.color);
    else this.log(victim.companion ? `Your ${victim.name} falls!` : victim.ally ? 'Your skeleton crumbles to dust.' : `${victim.subj} dies.`, '#fa4');
    if (victim.companion) { // their gear and potions drop; they're remembered for Resurrection
      [...SLOTS.map(s => victim.gear[s]), ...(victim.inv || [])].forEach(it => it && this.items.push({ ...it, x: victim.x, y: victim.y }));
      SLOTS.forEach(s => { victim.gear[s] = null; }); victim.inv = []; victim.recalc();
      (this.fallen ||= []).push(victim);
    }
    if (victim.ally) return;
    if (victim.pending) this.map.set(victim.pending.x, victim.pending.y, victim.pending.was); // a summoner's unfinished raise
    for (const s of victim.body || []) if (s.alive) { // a Colossus collapses: its whole body falls into bones
      s.hp = 0;
      if (TILES[this.map.get(s.x, s.y)].walk && !['stairs', 'upstairs'].includes(this.map.get(s.x, s.y))) this.map.set(s.x, s.y, victim.remains || 'bones');
    }
    const corpse = victim.corpse === undefined ? 'bones' : victim.corpse; // corpse: tile left behind (null = none)
    if (corpse && TILES[this.map.get(victim.x, victim.y)].walk && !['stairs', 'upstairs'].includes(this.map.get(victim.x, victim.y)))
      this.map.set(victim.x, victim.y, corpse);
    if (!(killer instanceof Monster && !killer.ally)) { // no XP when a rival monster got the kill
      p.gainXp(victim.xp, this);
      // Kill passives: a companion's own kills (or its skeletons') feed its passives; every other party kill feeds yours.
      const who = [killer?.owner, killer].find(e => e?.companion && e.alive) || p;
      if (who.lifesteal) who.hp = Math.min(who.maxHp, who.hp + who.lifesteal);
      if (who.manaOnKill) who.mp = Math.min(who.maxMp, who.mp + who.manaOnKill);
    }
    const loot = victim.loot ? makeGear(this.depth, victim.loot, victim.lootPool) : chance(0.15) && randomItem(this.depth);
    if (loot) this.items.push({ ...loot, x: victim.x, y: victim.y });
    if (victim.leader) { // e.g. the goblin chief
      this.log('With their chief dead, the goblins lose their nerve!', '#fc6');
      this.monsters.filter(o => o.alive && o.faction === victim.faction && o.coward).forEach(o => this.panic(o));
    }
    if (victim.tome) { // bosses: a tome of your class
      this.items.push({ ...this.makeBook(true), x: victim.x, y: victim.y });
      this.log(`${victim.subj} leaves a ${p.cls.title}'s Tome behind!`, '#fd6');
    }
    if (victim.drops) { // e.g. the Lich's key
      this.items.push({ ...KEYS[victim.drops], x: victim.x, y: victim.y });
      this.log(`${victim.subj} drops the ${KEYS[victim.drops].name}!`, '#ffd24a');
    }
  }

  // Dream Coil: a coiled enemy that strays more than 2 tiles from the coil's centre is snapped back and stunned.
  checkCoil(m) {
    if (this.coil && dist(m, this.coil) <= 2) return;
    delete m.status.coiled;
    if (!this.coil) return;
    this.fx.bolt(this.coil, m, '~', '#88f');
    this.log(`The dream coil snaps on ${m.obj}!`, '#88f');
    m.hurt(4 + 2 * this.player.spellPower, this, this.player);
    if (m.alive) applyStatus(m, 'stun', 3, this);
  }

  gameOver(win, killer) {
    this.state = 'over';
    this.dead = !win;
    this.gameOverText = win
      ? '<span style="color:#0ff">You claim the Crystal of Ages. VICTORY!</span> Press R to play again.'
      : `<span style="color:#f44">You were slain by ${killer ? killer.obj : 'something'}.</span> Press R to try again.`;
  }

  log(msg, color = '#ccc') { // returns the stored line (so a caller can take it back)
    const line = `<div style="color:${color}">${msg}</div>`;
    this.messages.push(line);
    this.messages = this.messages.slice(-8);
    return line;
  }

  // ---- menus (skills K, inventory I) ----
  // lines: { text, run?, enabled? }. run() returns true if it used up a turn.
  // The cursor position is remembered per menu (keyed by the title's first word) so "Back" returns to the same row.
  // opts: { keys(row) -> { KeyE: fn, ... } per-row action keys (fn returns true if a turn was spent; the menu stays
  // open), detail(row) -> html under the list, noLetters: no letter shortcuts }.
  openMenu(title, lines, remember = true, opts = {}) {
    this.menuSel = this.menuSel || {};
    const n = lines.filter(l => l.run).length;
    const sel = remember ? this.menuSel[title.split(' ')[0]] || 0 : 0;
    this.menu = { title, lines, sel: Math.min(sel, Math.max(0, n - 1)), ...opts };
  }

  moveCursor(i) { this.menu.sel = this.menuSel[this.menu.title.split(' ')[0]] = i; }

  openSkills() {
    const p = this.player, tree = SKILL_TREES[p.cls.key];
    // Known skills can be picked up (Enter), moved with Up/Down, and dropped (Enter) to reorder the hotbar. The first
    // ACTIVE_SKILLS are usable; moving a reserve skill up into them swaps it in.
    const known = p.skills.map((id, i) => ({
      text: `${this.grabSkill === i ? '<span style="color:#ff0">↕</span>' : ' '} ${i < ACTIVE_SKILLS ? i + 1 : '<span style="color:#555">-</span>'}  ${i < ACTIVE_SKILLS ? this.skillLine(SKILLS[id]) : `<span style="color:#777">${this.skillLine(SKILLS[id])}</span>`}`,
      run: () => { this.grabSkill = this.grabSkill === i ? null : i; this.openSkills(); },
    }));
    if (known.length > ACTIVE_SKILLS) known.splice(ACTIVE_SKILLS, 0, { text: this.inCombat()
      ? '<span style="color:#f88">  Reserve - enemies in sight: no swapping until the fight is over.</span>'
      : `<span style="color:#777">  Reserve - not usable; move one into the top ${ACTIVE_SKILLS} to swap it in (only out of combat):</span>` });
    const upcoming = tree.core.filter(id => !p.skills.includes(id))
      .map(id => ({ text: `<span style="color:#777">  Lv ${SKILLS[id].lvl}  ${this.skillLine(SKILLS[id])}</span>` }));
    const unfound = tree.pool.filter(id => !p.skills.includes(id));
    const books = unfound.length ? [{ text: `<span style="color:#777">  Still to find: ${unfound.map(id => SKILLS[id].name).join(', ')}</span>` }] : [];
    this.openMenu('SKILLS', [
      { text: this.grabSkill == null ? `Active - ${ACTIVE_SKILLS} slots (number keys to use; Enter on one to pick it up and reorder):` : 'Moving: Up/Down to move, Enter to drop' },
      ...known, { text: '' },
      ...(upcoming.length ? [{ text: 'Core skills you unlock by levelling up:' }, ...upcoming, { text: '' }] : []),
      { text: `Other skills are found in ${p.cls.title}'s Tomes (pick 1 of ${TOME_CHOICES}).` }, ...books,
    ]);
  }

  // Options (O).
  // Debug (J): load any kind of floor in place of this one, allies coming along - the main floors, the test map, the
  // side-floors and the extra floors not yet wired in. Anything but a main floor loads as game.testLevel.
  openFloorMenu() {
    const load = (depth, def = null) => ({ run: () => {
      const allies = this.monsters.filter(m => m.alive && m.ally);
      Object.assign(this, { testLevel: def, depth, side: null, sideBack: null });
      this.loadLevel(allies);
    } });
    const kind = (label, note) => `${label.padEnd(26)}<span style="color:#777">${note}</span>`;
    this.openMenu('LOAD FLOOR (debug)', [
      ...LEVELS.map((l, i) => ({ text: kind(l.name, `main floor ${i}`), ...load(i) })),
      { text: kind(TEST_LEVEL.name, 'test map'), ...load(TEST_LEVEL.depth, TEST_LEVEL) },
      ...Object.values(SIDE_LEVELS).map(l => ({ text: kind(l.name, 'side-floor'), ...load(l.depth, l) })),
      ...Object.values(EXTRA_FLOORS).map(l => ({ text: kind(l.name, 'extra floor'), ...load(l.depth, l) })),
    ]);
  }

  openOptions() {
    const toggle = (k, label) => ({ text: `${label.padEnd(18)} ${this[k] ? '<span style="color:#6d6">ON</span>' : '<span style="color:#f66">OFF</span>'}`,
      run: () => { this[k] = !this[k]; saveOption(k, this[k]); if (this.map) this.updateView(); this.openOptions(); return false; } });
    this.openMenu('OPTIONS', [
      toggle('smooth', 'Smooth movement'),
      { text: '<span style="color:#777">  creatures slide between tiles and the view scrolls, instead of jumping</span>' },
      toggle('gearLook', 'Gear on the hero'),
      { text: '<span style="color:#777">  your tile shows helm / shield / weapon marks and full-set shimmers</span>' },
      toggle('sharedVision', 'Shared vision'),
      { text: '<span style="color:#777">  you also see what your companions see</span>' },
    ]);
  }

  skillLine(s) {
    const cd = this.player.cooldownOf(s); // after INT reduction
    return `${s.name.padEnd(17)}${String(s.mp).padStart(2)} MP  ${cd ? `cooldown ${cd}  ` : ''}${s.range ? `${s.range} tiles${s.ground ? ' (any spot)' : ''}` : 'instant'}  ${s.magic ? '<span style="color:#a8f">[INT]</span> ' : ''}${s.desc}`;
  }

  // ---- input ----
  onKey(e) {
    const handled = this.handleKey(e);
    if (handled === false) return;
    e.preventDefault();
    this.render();
  }

  handleKey(e) {
    const c = e.code;
    if (this.state === 'title') { const cls = CLASSES[+e.key - 1]; return cls ? this.start(cls) : false; }
    if (this.state === 'over') return c === 'KeyR' ? this.showTitle() : false;

    if (this.menu) {
      const menu = this.menu, choices = menu.lines.filter(l => l.run), n = choices.length;
      const isSkills = menu.title.startsWith('SKILLS');
      const dir = ['ArrowUp', 'Numpad8'].includes(c) ? -1 : ['ArrowDown', 'Numpad2'].includes(c) ? 1 : 0;
      if (isSkills && this.grabSkill != null && dir) { // move the picked-up skill (known skills are the first rows)
        const sk = this.player.skills, i = this.grabSkill, j = i + dir;
        if (j < 0 || j >= sk.length) return;
        if ((i < ACTIVE_SKILLS) !== (j < ACTIVE_SKILLS) && this.inCombat()) // reordering is fine; swapping in/out is not
          return this.log("You can't swap skills in or out of your slots with enemies in sight.", '#f88');
        [sk[i], sk[j]] = [sk[j], sk[i]];
        this.grabSkill = j;
        this.openSkills();
        return this.moveCursor(j);
      }
      if (['ArrowUp', 'Numpad8'].includes(c) && n) return this.moveCursor((menu.sel + n - 1) % n);
      if (['ArrowDown', 'Numpad2'].includes(c) && n) return this.moveCursor((menu.sel + 1) % n);
      const rowKey = !e.shiftKey && menu.keys?.(choices[menu.sel])?.[c]; // e.g. inventory E / U / D / G
      if (rowKey) return this.act(rowKey);
      const opt = ['Enter', 'Space', 'NumpadEnter'].includes(c) ? choices[menu.sel] : !menu.noLetters && choices[LETTERS.indexOf(e.key)];
      const isParty = ['PARTY', 'COMPANION'].includes(menu.title.split(' ')[0]);
      if (c === 'Escape' || !e.shiftKey && (c === 'KeyO' && menu.title === 'OPTIONS' || c === 'KeyT' && menu.title === 'TACTICS' || c === 'KeyK' && isSkills || c === 'KeyP' && isParty || c === 'KeyI' && !isSkills && !isParty)) { this.menu = null; this.grabSkill = null; }
      else if (opt && opt.enabled !== false) {
        this.moveCursor(choices.indexOf(opt));
        this.act(() => { const spent = opt.run(); if (this.menu === menu) this.menu = null; return spent; });
      } else return false;
      return;
    }

    if (this.targeting) {
      const t = this.targeting, n = t.list.length;
      if (t.cursor && MOVES[c]) {
        const [dx, dy] = MOVES[c];
        t.cursor = { x: Math.max(0, Math.min(this.map.w - 1, t.cursor.x + dx)), y: Math.max(0, Math.min(this.map.h - 1, t.cursor.y + dy)) };
      } else if (c === 'Tab' && n) {
        t.i = (t.i + (e.shiftKey ? n - 1 : 1)) % n;
        if (t.cursor) t.cursor = { x: t.list[t.i].x, y: t.list[t.i].y };
      } else if (!t.cursor && ['ArrowRight', 'ArrowDown', 'KeyD', 'KeyS'].includes(c)) t.i = (t.i + 1) % n;
      else if (!t.cursor && ['ArrowLeft', 'ArrowUp', 'KeyA', 'KeyW'].includes(c)) t.i = (t.i + n - 1) % n;
      else if (c === 'Escape') this.targeting = null;
      else if (['Enter', 'Space', 'KeyF', `Digit${t.slot + 1}`].includes(c)) {
        if (!this.aimOk()) return this.log('Out of range or out of sight.', '#f88');
        const a = this.aim, m = this.monsterAt(a.x, a.y), target = m && !m.ally ? m : { x: a.x, y: a.y };
        this.targeting = null;
        if (m) this.lastTarget = m;
        this.act(() => (t.pick ? t.pick(target) : this.cast(t.skill, target))); // pick: targeting for an order, not a skill
      } else return false;
      return;
    }

    const mv = MOVES[c];
    if (mv) this.act(() => this.move(...mv));
    else if (/^Digit[1-9]$/.test(c)) this.useSkill(+c.slice(5) - 1);
    else if (c === 'KeyK') this.openSkills();
    else if (c === 'KeyI') this.openInventory();
    else if (c === 'KeyG' || c === 'Comma') this.act(() => this.pickUp());
    else if (c === 'KeyO') this.openOptions();
    else if (c === 'KeyT') this.openTactics();
    else if (c === 'KeyR') this.act(() => this.quaff());
    else if (c === 'KeyP') this.openParty();
    else if (c === 'KeyN') { this.ghost = !this.ghost; this.log(`Ghost mode ${this.ghost ? 'on: no-clip, ignored by monsters, no damage' : 'off'} (debug).`, '#888'); }
    else if (c === 'KeyJ') this.openFloorMenu();
    else if (c === 'KeyM') { this.revealAll = !this.revealAll; this.updateView(); this.log(`Fog of war ${this.revealAll ? 'off' : 'on'} (debug).`, '#888'); }
    else if (['Space', 'Period', 'Numpad5'].includes(c)) this.act(() => true);
    else return false;
  }
}
