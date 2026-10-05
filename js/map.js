// Tile definitions and the GameMap grid (walkability, pathing distances, field of view).
const TILES = {
  wall:    { ch: '#', color: '#777', walk: false, opaque: true },
  floor:   { ch: '.', color: '#555', walk: true },
  grass:   { ch: '"', color: '#3a7d2c', walk: true },
  tree:    { ch: 'T', color: '#1f8b3f', walk: false, opaque: true },
  // swim: deep water that swimmers (monsters with `swim`) can move through
  water:   { ch: '~', color: '#3f6fdf', bg: '#0c1c44', walk: false, swim: true, name: 'deep water' },
  shallow: { ch: '~', color: '#5fb3d9', bg: '#12303f', walk: true },
  // Grotto: tidal flats flood into tidewater and drain again (see tide in features.js); both share a wet background.
  tideflat:  { ch: '.', color: '#8fb8c0', bg: '#16303a', walk: true, name: 'tidal flat' },
  tidewater: { ch: '~', color: '#4a8fd0', bg: '#16303a', walk: false, swim: true, name: 'tidal water' },
  glowwater: { ch: '~', color: '#6fffe0', bg: '#0c3a36', walk: false, swim: true, light: 3, lightColor: '80,230,200', name: 'glowing pool' },
  sand:    { ch: '.', color: '#d8c890', walk: true, name: 'sand' },
  // Swamp (overworld). slow: anyone moving onto it loses a turn (monsters standing in it move every other turn).
  bog:       { ch: '~', color: '#5a7f62', bg: '#0e1810', walk: false, swim: true, name: 'bog' }, // murky green-grey: water, not grass
  lily:      { ch: '°', color: '#6aaa4a', bg: '#0e1810', walk: false, swim: true, name: 'lily pads' },
  mud:       { ch: '~', color: '#8a7040', bg: '#231a0c', walk: true, slow: true, name: 'sucking mud' },
  quicksand: { ch: '~', color: '#9a8048', bg: '#2a200e', walk: true, name: 'quicksand' }, // onEnter: stuck (features.js)
  boardwalk: { ch: '=', color: '#9a7a4a', walk: true, name: 'boardwalk' },
  reeds:     { ch: '|', color: '#9aaa4a', walk: true, opaque: true, name: 'reeds' }, // walk through, can't see through
  moss:      { ch: ',', color: '#5a8a3a', walk: true, name: 'moss' },
  gasvent:   { ch: '°', color: '#b0d040', walk: true, burnsTo: 'mud', name: 'swamp gas vent' }, // puffs poison (swampGas)
  // css: animated class on the tile (index.html). A swelling vent bursts 2 turns later.
  gasswell:  { ch: 'o', color: '#d8ff50', walk: true, burnsTo: 'mud', css: 'swell', name: 'swelling gas vent' },
  bridge:  { ch: '=', color: '#a0703a', walk: true, name: 'rope bridge' },
  ashes:   { ch: '*', color: '#555', walk: false, name: 'cold campfire' },
  fungus:  { ch: '%', color: '#c05fd9', walk: true },
  bones:   { ch: ',', color: '#bbb', walk: true },
  stairs:  { ch: '>', color: '#ff0', walk: true, name: 'stairs down' },
  upstairs: { ch: '<', color: '#ff0', walk: true, name: 'stairs up' },
  // light: radius it illuminates; fire: flickers in fire colours; lightColor: 'r,g,b' of its glow (default firelight)
  torch:   { ch: '*', color: '#ffb040', walk: false, opaque: true, light: 6, fire: true },
  // onBump(game, x, y): runs when the player walks into the tile (takes a turn).
  // onEnter(game, x, y): runs when the player steps onto it. Both defined in features.js.
  // burnsTo: tile it becomes when fire touches it (see scorch in features.js).
  sarcophagus: { ch: '▬', color: '#d8c8a0', walk: false },
  coffin:  { ch: '_', color: '#8a7a60', walk: true },
  web:     { ch: '░', color: '#d0d0d0', walk: true, burnsTo: 'floor', name: 'spider web' }, // onEnter: see features.js
  moldpatch: { ch: ',', color: '#7fae3c', walk: true, burnsTo: 'floor', name: 'mold' }, // spores on step; spreads (level.spread)
  // doors: `door` = monsters open it too; `locked` = needs a key (see features.js)
  door:       { ch: '+', color: '#c08a4a', walk: false, opaque: true, door: true, name: 'door' },
  doorOpen:   { ch: '/', color: '#c08a4a', walk: true, name: 'open door' },
  // locked: needs the key whose id matches `key`; becomes `opensTo`. `lockedMsg` is shown without the key.
  lockedDoor: { ch: '+', color: '#ffd24a', bg: '#3a2a10', walk: false, opaque: true, locked: true, key: 'cryptkey', opensTo: 'doorOpen',
    name: 'sealed door', lockedMsg: 'The door is sealed tight. Something powerful must hold the key.' },
  cellDoor:   { ch: '+', color: '#9aa4b0', bg: '#1c2026', walk: false, locked: true, key: 'cellkey', opensTo: 'cellDoorOpen',
    name: 'cell door', lockedMsg: 'The cell door is locked. The jailer must have the key.' },
  vaultDoor:  { ch: '+', color: '#e8c060', bg: '#3a2a10', walk: false, opaque: true, locked: true, key: 'vaultkey', opensTo: 'doorOpen',
    name: 'vault door', lockedMsg: 'A heavy vault door. One of the crypt\'s champions carries its key.' },
  // Chamber-crypt entrance hall: checkered marble, an honour guard of statues, a plaque to read (onBump, level.plaque).
  marblefloor: { ch: '.', color: '#c8c2b0', bg: '#3c3a35', walk: true, name: 'marble floor' },
  marbledark:  { ch: '.', color: '#8a857a', bg: '#1e1d1a', walk: true, name: 'marble floor' },
  statue:     { ch: '£', color: '#d0ccc0', walk: false, name: 'statue of a fallen hero' },
  plaque:     { ch: '■', color: '#e8c060', bg: '#3a3834', walk: false, opaque: true, name: 'engraved plaque' },
  // Mini-boss arenas (crypt, ARENA_BUILDS): Death Knight's parade hall, Wight's tomb, Banshee's chapel.
  ironwall:   { ch: '#', color: '#8fa4c8', bg: '#1c2638', walk: false, opaque: true, name: 'iron-bound wall' },
  tombwall:   { ch: '#', color: '#5f8a5a', bg: '#121a12', walk: false, opaque: true, name: 'mossy tomb wall' },
  chapelwall: { ch: '#', color: '#cfc6ac', bg: '#2e2a22', walk: false, opaque: true, name: 'limestone wall' },
  armour:     { ch: 'Ω', color: '#9aa8c0', walk: false, name: 'suit of armour' },
  // Flooded crypt: wading costs a turn (slow, like mud - swimmers glide through); the flagstone causeway doesn't.
  lichwall:   { ch: '#', color: '#8a6ab0', bg: '#140c1e', walk: false, opaque: true, name: 'black stone wall' },
  skullniche: { ch: 'Ω', color: '#d8d0b8', bg: '#140c1e', walk: false, opaque: true, name: 'skull niche' },
  lichfloor:  { ch: '.', color: '#4a3e5a', bg: '#0c0912', walk: true, name: 'black flagstone' },
  dais:       { ch: '▒', color: '#3a2c4e', bg: '#150f1e', walk: true, name: 'ritual dais' },
  soulrune:   { ch: '·', color: '#c8a0ff', bg: '#0c0912', walk: true, css: 'ebb', name: 'soul rune' },
  pitwall:    { ch: '#', color: '#9a8a60', bg: '#1e1a10', walk: false, opaque: true, name: 'crumbling pit wall' },
  pitfloor:   { ch: '.', color: '#6a5a3a', bg: '#15110a', walk: true, name: 'packed earth' },
  shedskin:   { ch: '~', color: '#c8c898', bg: '#15110a', walk: true, name: 'shed serpent skin' },
  column:     { ch: 'Φ', color: '#a89a78', bg: '#15110a', walk: false, name: 'broken column' },
  wetwall:    { ch: '#', color: '#4f8a90', bg: '#0e1c20', walk: false, opaque: true, name: 'dripping wall' },
  floodwater: { ch: '≈', color: '#3f8090', bg: '#0f2630', walk: true, slow: true, name: 'flood water' },
  flagstone:  { ch: '■', color: '#8a939c', bg: '#1a2226', walk: true, name: 'flagstone' },
  sunkencoffin: { ch: '▬', color: '#8aa4a4', bg: '#0f2630', walk: false, name: 'sunken coffin' },
  banner:     { ch: '¶', color: '#e04040', bg: '#26262e', walk: false, opaque: true, name: 'hanging banner' },
  throne:     { ch: 'π', color: '#e8c060', bg: '#3a2a10', walk: false, name: 'bone throne' },
  candlestick: { ch: '¡', color: '#ffe8b0', walk: false, light: 2, lightColor: '255,190,110', name: 'candle' },
  candle:     { ch: '¡', color: '#c8f0a8', walk: false, light: 2, lightColor: '110,220,110', name: 'grave candle' },
  grave:      { ch: '∩', color: '#8a7050', bg: '#1a140c', walk: true, name: 'open grave' },
  pew:        { ch: '═', color: '#9a7040', walk: false, name: 'pew' },
  glass:      { ch: '▒', color: '#8a6ad8', bg: '#1a1030', walk: false, opaque: true, name: 'stained glass window' },
  chapelaltar: { ch: '†', color: '#e8e8ff', bg: '#2a2a44', walk: false, name: 'chapel altar' },
  // Sarcophagus ambush (crypt): step onto the plinth (to take what lies on it) and the coffins around burst open.
  plinth:     { ch: '_', color: '#e8c060', bg: '#2a2410', walk: true, name: 'plinth' },
  cellDoorOpen: { ch: '/', color: '#9aa4b0', walk: true, name: 'open cell door' },
  bars:       { ch: '#', color: '#9aa4b0', walk: false, name: 'iron bars' }, // see, shoot and light through; can't pass
  chains:     { ch: '&', color: '#9aa4b0', walk: false, opaque: true, name: 'shackles' },
  straw:      { ch: '"', color: '#c8b060', walk: true, name: 'straw' },
  // Goblin war camp (crypt chamber layout): trampled dirt, hide tents, supply crates and barrels.
  dirt:       { ch: '.', color: '#8a6a44', bg: '#1e160c', walk: true, name: 'trampled dirt' },
  tent:       { ch: '⌂', color: '#b08a50', bg: '#2a1e10', walk: false, name: 'hide tent' },
  crate:      { ch: '■', color: '#a07840', walk: false, name: 'supply crate' },
  barrel:     { ch: 'Θ', color: '#9a6a3a', walk: false, name: 'barrel' },
  roots:      { ch: '&', color: '#7a5530', walk: true, name: 'tangled roots' },
  altar:   { ch: '+', color: '#fff', walk: false },
  altarUsed: { ch: '+', color: '#666', walk: false },
  brazier: { ch: '*', color: '#ffb040', walk: false, light: 4, fire: true },
  campfire: { ch: '*', color: '#ff6a20', walk: false, light: 5, fire: true, name: 'campfire' },
  glowshroom: { ch: '*', color: '#c080ff', walk: false, light: 3, lightColor: '170,90,255', name: 'glowing mushroom' },
  gong:     { ch: 'O', color: '#ffcc33', bg: '#3a2a00', walk: false, name: 'alarm gong' },
  gongRung: { ch: 'O', color: '#8a7030', walk: false, name: 'rung gong' },
  ore:      { ch: '$', color: '#e8c050', bg: '#2a2410', walk: false, opaque: true, name: 'ore vein' },
  // hidden: looks like floor until found (Game.spotTraps); goblins never set them off
  spikeTrap: { ch: '^', color: '#e04040', walk: true, hidden: true, name: 'spike trap' },
  snareTrap: { ch: '^', color: '#dddddd', walk: true, hidden: true, name: 'snare' },
  tripwire:  { ch: '^', color: '#ffcc33', walk: true, hidden: true, name: 'tripwire' },
  // Laid by skills for a while (placeTimed, features.js). onMonster: set off by a monster stepping on it (Game.moveTo).
  snare:      { ch: '^', color: '#dca060', walk: true, name: 'your snare' },
  caltrops:   { ch: '÷', color: '#b8b8b8', walk: true, snag: true, name: 'caltrops' }, // snag: slows enemies only (moveTo)
  holyground: { ch: '·', color: '#ffe888', bg: '#3a3316', walk: true, name: 'consecrated ground' },
  icewall:    { ch: '#', color: '#dff8ff', bg: '#35607a', walk: false, opaque: true, name: 'ice wall' },
  carpet:  { ch: '░', color: '#c23a3a', bg: '#6a1212', walk: true, name: 'carpet' }, // woven deep red
  // Trial chamber (crypt): rune walls and floor; every way out turns into a sealed gate while a trial runs (trialTick).
  runewall:  { ch: '#', color: '#b090e0', bg: '#241a33', walk: false, opaque: true, name: 'rune-carved wall' },
  runefloor: { ch: '·', color: '#7a5a9a', walk: true, name: 'runed floor' },
  portcullis: { ch: '#', color: '#c8d0e0', bg: '#22242c', walk: false, name: 'iron portcullis' }, // boss rooms lock with these (see-through)
  sealed:    { ch: '#', color: '#ff66cc', bg: '#4a1040', walk: false, opaque: true, name: 'sealed gate' },
  runecircle: { ch: '○', color: '#a070e0', walk: true, name: 'summoning circle' },
  sigil:     { ch: '☼', color: '#ff80e0', walk: true, light: 2, lightColor: '255,100,220', name: 'trial sigil' },
  obelisk:   { ch: '▲', color: '#c9a0ff', bg: '#241a33', walk: false, light: 3, lightColor: '170,110,255', name: 'rune obelisk' },
  runeflare: { ch: '*', color: '#ff66cc', bg: '#3a1040', walk: true, css: 'swell', name: 'flaring rune' }, // a wave rises here next turn
  // A summoner's mark (raise.warn): something rises from here next turn (AI.summoner). Nobody can step on it.
  stirbones: { ch: ',', color: '#fff4c0', bg: '#4a3410', walk: false, css: 'swell', name: 'stirring bones' },
  // Ossuary heaps (level.stirBones, see tickBones in features.js): walkable until one stirs - then nobody can step on it, and a skeleton rises next turn.
  bonepile:  { ch: ',', color: '#d8cfa8', walk: true, name: 'heap of bones' },
  bonestir:  { ch: ',', color: '#fff4c0', bg: '#4a3410', walk: false, css: 'swell', name: 'stirring heap of bones' },
  // Burial niches (addNiches, level.niches): alcoves in a corridor wall. nicheam looks the same - something lurches out when you pass (tickNiches).
  niche:     { ch: '∩', color: '#a89a74', bg: '#2a2418', walk: true, name: 'burial niche' },
  // The hand room (addHandRoom, tickHandRoom): a wall with hands set into it. Step into the room and they claw loose (back to bonewall, a crawling hand beside it).
  handwall:  { ch: 'ƒ', color: '#e8d8b8', bg: '#3a3020', walk: false, opaque: true, name: 'wall of hands' },
  nicheused: { ch: '∩', color: '#6a6048', bg: '#201c12', walk: true, name: 'burial niche' }, // a niche whose find you've had
  nicheam:   { ch: '∩', color: '#a89a74', bg: '#2a2418', walk: true, name: 'burial niche' },
  stirwater: { ch: '~', color: '#a0ffff', bg: '#0c3a4a', walk: false, css: 'swell', name: 'churning water' },
  // special-room wall materials (all solid). bg: optional tile background
  granite:  { ch: '#', color: '#7d93d6', bg: '#2c3a66', walk: false, opaque: true },
  marble:   { ch: '#', color: '#a39a86', bg: '#e8e4d8', walk: false, opaque: true },
  bonewall: { ch: '%', color: '#e0d4b0', bg: '#3a3020', walk: false, opaque: true },
  // A weak spot in an ossuary's bone wall: bump it BREAK_HITS times to break through to a secret room (features.js).
  // breakable: counts as a way through when levels are joined up / checked, like a locked door.
  // A way down into a side-floor (side: its SIDE_LEVELS key) - Game.takeStairs -> enterSide.
  bonestair: { ch: '>', color: '#f0e6c8', bg: '#4a3a20', walk: true, side: 'ossuary', name: 'bone stairway down' },
  warrenstair: { ch: '>', color: '#e0a860', bg: '#3a2410', walk: true, side: 'warrens', name: 'goblin tunnel down' },
  hivestair: { ch: '>', color: '#efe8d0', bg: '#3a3832', walk: true, side: 'hive', name: 'silk-choked shaft down' },
  // The Silk Hive. Silk (walls, strands, cocoons, egg sacs) catches fire: burnsTo silkfire, which spreads (tickFire).
  silkwall:  { ch: '#', color: '#e8e4d4', bg: '#3a3832', walk: false, opaque: true, burnsTo: 'silkfire', name: 'wall of webbing' },
  thicksilk: { ch: '#', color: '#fffbe8', bg: '#55503e', walk: false, opaque: true, breakable: true, burnsTo: 'silkfire', name: 'thick silk',
    breakTo: 'silkfloor', hitMsg: 'You tear at the thick silk. It sags... ', breakMsg: 'The thick silk tears away - there is a hidden chamber beyond!' },
  silkfloor: { ch: '\u2248', color: '#8a8470', walk: true, burnsTo: 'silkfire', name: 'silk strands' },
  oillamp:   { ch: '\u263c', color: '#ffcc66', bg: '#3a3832', walk: false, opaque: true, light: 3, lightColor: '255,180,90', burnsTo: 'silkfire', name: 'oil lamp' },
  silkfire:  { ch: '^', color: '#ffa040', bg: '#4a1a04', walk: true, fire: true, light: 2, lightColor: '255,130,40', name: 'burning silk' },
  ash:       { ch: '.', color: '#5a5450', walk: true, name: 'ash' },
  cocoon:    { ch: '0', color: '#efe8d0', bg: '#2a2822', walk: false, burnsTo: 'silkfire', name: 'cocoon' },
  eggsac:    { ch: 'o', color: '#d8e0a0', walk: false, burnsTo: 'silkfire', name: 'egg sac' },
  eggswell:  { ch: 'O', color: '#f4ff90', bg: '#2a3010', walk: false, css: 'swell', burnsTo: 'silkfire', name: 'swelling egg sac' },
  crackedbone: { ch: '%', color: '#c4a870', bg: '#33291a', walk: false, opaque: true, breakable: true, name: 'cracked bone wall',
    breakTo: 'bones', hitMsg: 'You strike the cracked bone wall. It shudders... ', breakMsg: 'The cracked wall gives way in a clatter of bones - there is a hidden chamber beyond!' },
  rubble:   { ch: ':', color: '#a89a80', walk: false, opaque: true },
  pillar:   { ch: 'I', color: '#e8e4d8', walk: false, opaque: true, passLight: true }, // blocks sight, not light
};

const LIT_VIEW = 20; // how far away you can see torch-lit tiles

class GameMap {
  constructor(w, h, fill = 'wall') {
    this.w = w; this.h = h;
    this.tiles = grid(w, h, fill);
    this.seen = grid(w, h, false);
    this.visible = grid(w, h, false);
    this.spawns = []; // { x, y, monster | template } placed by room builders, spawned on level load
    // Optional generator markers: stairs (fixed stairs spot), bossSpot, noSpawn (grid: never start/spawn here),
    // reserved (rects other rooms must avoid).
    this.reserved = [];
    this.loot = []; // { x, y, rarity?, item? } item piles placed by room builders (item: consumable name)
    this.found = grid(w, h, false); // hidden tiles (traps) the player has spotted
    this.dark = []; // rects where no torches are mounted
  }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inBounds(x, y) ? this.tiles[y][x] : 'wall'; }
  set(x, y, t) { if (this.inBounds(x, y)) this.tiles[y][x] = t; }
  walkable(x, y) { return TILES[this.get(x, y)].walk; }
  opaque(x, y) { return !!TILES[this.get(x, y)].opaque; }
  // Walkable, or a closed door someone could open. Used for pathing.
  passable(x, y) { return this.walkable(x, y) || !!TILES[this.get(x, y)].door; }

  cells(pred) {
    const out = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) if (pred(x, y)) out.push({ x, y });
    return out;
  }

  // A diagonal step can't squeeze between two blocking tiles that touch at the corner.
  canStep(x, y, nx, ny, pass = (a, b) => this.passable(a, b)) {
    return x === nx || y === ny || pass(nx, y) || pass(x, ny);
  }

  // BFS step-distance from (sx, sy) over walkable tiles. Used for pathing, flood fill and stair placement.
  distanceFrom(sx, sy, pass = (x, y) => this.walkable(x, y)) {
    const d = grid(this.w, this.h, Infinity);
    d[sy][sx] = 0;
    const q = [[sx, sy]];
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (pass(nx, ny) && d[ny][nx] === Infinity && this.canStep(x, y, nx, ny, pass)) {
          d[ny][nx] = d[y][x] + 1;
          q.push([nx, ny]);
        }
      }
    }
    return d;
  }

  // forLight: tiles marked passLight (pillars) don't block the path.
  // A diagonal step between two blockers that touch at the corner is blocked too (no peeking through corners).
  hasLos(a, b, forLight = false) {
    const pts = line(a.x, a.y, b.x, b.y);
    const blocks = (x, y) => { const t = TILES[this.get(x, y)]; return t.opaque && !(forLight && t.passLight); };
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = pts[i - 1];
      if (p.x !== q.x && p.y !== q.y && blocks(p.x, q.y) && blocks(q.x, p.y)) return false;
      if (i < pts.length - 1 && blocks(p.x, p.y)) return false;
    }
    return true;
  }

  // Light level 0..1 per tile from every light-emitting tile (torches). null when the level has none.
  // lightFrom[y][x] = index into lightSources of the brightest source, so each light can flicker on its own.
  // The fixed result is kept in baseLight; addMovingLights layers moving lights (auras) on top each turn.
  computeLights() {
    this.lightSources = this.cells((x, y) => TILES[this.get(x, y)].light);
    this.light = this.lightSources.length ? grid(this.w, this.h, 0) : null;
    this.lightFrom = grid(this.w, this.h, -1);
    this.lightSources.forEach((s, i) => this.illuminate(s, TILES[this.get(s.x, s.y)].light, i));
    this.baseLight = { light: this.light, from: this.lightFrom, sources: this.lightSources };
  }

  illuminate(s, r, i) {
    this.lightFrom[s.y][s.x] = i;
    for (let y = s.y - r; y <= s.y + r; y++)
      for (let x = s.x - r; x <= s.x + r; x++) {
        const d2 = (x - s.x) ** 2 + (y - s.y) ** 2;
        if (!this.inBounds(x, y) || d2 > r * r + r || !this.hasLos(s, { x, y }, true)) continue;
        const l = 1 - Math.sqrt(d2) / (r + 1);
        if (l > this.light[y][x]) { this.light[y][x] = l; this.lightFrom[y][x] = i; }
      }
  }

  // Moving lights: [{ x, y, r, color: 'r,g,b' }] on top of the fixed lights.
  addMovingLights(list) {
    const b = this.baseLight;
    this.lightSources = [...b.sources];
    this.lightFrom = b.from.map(row => row.slice());
    this.light = b.light ? b.light.map(row => row.slice()) : list.length ? grid(this.w, this.h, 0) : null;
    for (const s of list) this.illuminate(s, s.r, this.lightSources.push(s) - 1);
  }

  isLit(x, y) { return this.light?.[y]?.[x] > 0; }

  // You see tiles within radius r, plus lit tiles within LIT_VIEW, as long as there's line of sight.
  // Far lit floor (and the lights themselves) come first; a far lit wall is then only visible if a lit floor
  // tile next to it is, so you can't spot a wall's glow from its dark back side.
  computeFov(o, r) {
    this.visible = grid(this.w, this.h, false);
    const R = this.light ? Math.max(r, LIT_VIEW) : r;
    const farWalls = [];
    for (let y = o.y - R; y <= o.y + R; y++)
      for (let x = o.x - R; x <= o.x + R; x++) {
        if (!this.inBounds(x, y)) continue;
        const d2 = (x - o.x) ** 2 + (y - o.y) ** 2;
        const near = d2 <= r * r + r, farLit = this.isLit(x, y) && d2 <= R * R;
        if (!near && !farLit) continue;
        if (!near && !this.walkable(x, y) && !TILES[this.get(x, y)].light) { farWalls.push({ x, y }); continue; }
        if (this.hasLos(o, { x, y })) this.visible[y][x] = this.seen[y][x] = true;
      }
    for (const c of farWalls)
      if (DIRS.some(([dx, dy]) => this.walkable(c.x + dx, c.y + dy) && this.isLit(c.x + dx, c.y + dy) && this.visible[c.y + dy]?.[c.x + dx])
        && this.hasLos(o, c)) this.visible[c.y][c.x] = this.seen[c.y][c.x] = true;
  }
}
