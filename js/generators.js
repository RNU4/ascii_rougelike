// Level generators. Each returns a GameMap; building blocks (carveRect, connect, blob, decorate) are shared.

// Counts passed to generators (and in LEVELS) are per standard 96x48 floor; scaled() adapts them to the real size.
const BASE_AREA = 96 * 48;
const scaled = (n, w, h) => n ? Math.max(1, Math.round(n * w * h / BASE_AREA)) : 0; // (0 stays 0: test maps)

function carveRect(map, x, y, w, h, t = 'floor') {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) map.set(i, j, t);
}

// Random-walk blob: paints `tile` over any tile listed in `over`.
function blob(map, x, y, size, tile, over) {
  for (let i = 0; i < size; i++) {
    if (over.includes(map.get(x, y)) && x > 0 && y > 0 && x < map.w - 1 && y < map.h - 1) map.set(x, y, tile);
    const [dx, dy] = pick(DIRS);
    x += dx; y += dy;
  }
}

// Scatter `count` blobs of `tile` onto walkable ground. Returns map for chaining.
function decorate(map, tile, count, size, over = ['floor', 'grass']) {
  const spots = map.cells((x, y) => over.includes(map.get(x, y)));
  for (let i = 0, n = scaled(count, map.w, map.h); i < n && spots.length; i++) {
    const s = pick(spots);
    blob(map, s.x, s.y, size, tile, over);
  }
  return map;
}

// Doors in the 1-tile gaps (where corridors enter) of the ring around room r, each with probability p.
function addDoors(map, r, p = 0.5, tile = 'door') {
  for (let y = r.y - 1; y <= r.y + r.h; y++)
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const outX = x < r.x || x >= r.x + r.w, outY = y < r.y || y >= r.y + r.h;
      if (!(outX || outY) || (outX && outY) || !map.walkable(x, y)) continue; // ring cells only, no corners
      const [side, through] = outY ? [[1, 0], [0, 1]] : [[0, 1], [1, 0]];
      const gap = !map.walkable(x - side[0], y - side[1]) && !map.walkable(x + side[0], y + side[1]);
      const leads = map.walkable(x - through[0], y - through[1]) && map.walkable(x + through[0], y + through[1]);
      if (gap && leads && chance(p)) map.set(x, y, tile);
    }
}

// ---- special rooms ----
// Re-skins the existing walls in the 1-tile ring around a room. Openings (corridors running into it) stay open.
function wallRing(map, r, tile) {
  for (let y = r.y - 1; y <= r.y + r.h; y++)
    for (let x = r.x - 1; x <= r.x + r.w; x++)
      if ((x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) && map.get(x, y) === 'wall' && map.inBounds(x, y)) map.set(x, y, tile);
}

// Crypt room types. Sizes are odd so rooms sit on the maze grid. build(map, r) furnishes the carved room.
const CRYPT_ROOMS = [
  { name: 'burial chamber', w: 9, h: 7, weight: 3, wall: 'granite', // sarcophagi in the middle rows, walkway ring kept clear
    build: (map, r) => { for (const dy of [2, 4]) for (let dx = 2; dx < r.w - 2; dx += 2) if (chance(0.5)) map.set(r.x + dx, r.y + dy, 'sarcophagus'); } },
  { name: 'ossuary', w: 7, h: 5, weight: 2, wall: 'bonewall', // bone niches, bones, cobwebs and a spider lair
    build: (map, r) => {
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
          if (edge && chance(0.3)) map.set(x, y, 'bonewall');
          else if (chance(0.35)) map.set(x, y, 'bones');
        }
      for (let i = rand(3, 4); i > 0; i--) blob(map, rand(r.x, r.x + r.w - 1), rand(r.y, r.y + r.h - 1), 4, 'web', ['floor', 'bones']);
      const spot = () => ({ x: rand(r.x + 1, r.x + r.w - 2), y: rand(r.y + 1, r.y + r.h - 2) });
      for (let i = rand(1, 2); i > 0; i--) map.spawns.push({ ...spot(), monster: 'cryptspider' });
      if (chance(0.5)) map.spawns.push({ ...spot(), monster: 'webspinner' });
    } },
  { name: 'collapsed hall', w: 9, h: 7, weight: 1, wall: 'rubble', // cave-in piles
    build: (map, r) => { for (let i = 0; i < 3; i++) blob(map, rand(r.x, r.x + r.w - 1), rand(r.y, r.y + r.h - 1), 8, 'rubble', ['floor']); } },
  { name: 'shrine', w: 7, h: 7, weight: 1, wall: 'marble', // pillars, braziers and a restoring altar
    build: (map, r) => {
      for (const [dx, dy] of [[1, 1], [5, 1], [1, 5], [5, 5]]) map.set(r.x + dx, r.y + dy, 'pillar');
      map.set(r.x + 3, r.y + 1, 'brazier'); map.set(r.x + 3, r.y + 5, 'brazier');
      map.set(r.x + 3, r.y + 3, 'altar');
    } },
];

// Carves `count` (per standard floor) non-overlapping special rooms picked by weight from `types`.
function addRooms(map, count, types) {
  const bag = types.flatMap(t => Array(t.weight).fill(t));
  const rooms = [];
  for (let tries = 0, n = scaled(count, map.w, map.h); tries < n * 20 && rooms.length < n; tries++) {
    const t = pick(bag);
    const r = { x: rand(1, map.w - t.w - 1) | 1, y: rand(1, map.h - t.h - 1) | 1, w: t.w, h: t.h };
    if (r.x + r.w >= map.w - 1 || r.y + r.h >= map.h - 1) continue;
    if ([...rooms, ...map.reserved].some(o => r.x < o.x + o.w + 2 && o.x < r.x + r.w + 2 && r.y < o.y + o.h + 2 && o.y < r.y + r.h + 2)) continue;
    carveRect(map, r.x, r.y, r.w, r.h);
    wallRing(map, r, t.wall);
    t.build(map, r);
    addDoors(map, r, 0.3);
    rooms.push(r);
  }
  return map;
}

// The Lich's lair: a dark granite hall (boss + bone archers + bones to raise) with a sealed vault
// holding the stairs down behind a locked door. Sets map.stairs, bossSpot, noSpawn and reserved.
// The Lich's sanctum (hall + the stairs vault beside it): black flagstones, walls of dark stone set with skull niches (Ω),
// a dais along the vault wall with the phylactery on it (it brings the Lich back until smashed), a ring of glowing soul
// runes round the Lich, bone heaps for its raising in the far corners, two bone archers at the dais ends. No lights -
// the Lich shuns them. The vault: locked door mid-wall, stairs inside.
function furnishLichHall(map, hall, vault) {
  const c = roomMid(hall), s = vault.y < hall.y ? -1 : 1; // s: toward the vault
  const row = n => (s < 0 ? hall.y + n : hall.y + hall.h - 1 - n); // the n-th row out from the vault wall
  for (let y = hall.y; y < hall.y + hall.h; y++) for (let x = hall.x; x < hall.x + hall.w; x++) map.set(x, y, 'lichfloor');
  for (let n = 0; n < 2; n++) for (let x = c.x - 3; x <= c.x + 3; x++) map.set(x, row(n), 'dais');
  for (let y = vault.y - 1; y <= vault.y + vault.h; y++) for (let x = vault.x - 1; x <= vault.x + vault.w; x++) map.set(x, y, 'lichwall');
  carveRect(map, vault.x, vault.y, vault.w, vault.h);
  wallRing(map, hall, 'lichwall');
  for (const y of [hall.y - 1, hall.y + hall.h])
    for (let x = hall.x + 1; x < hall.x + hall.w - 1; x += 2) if (x !== c.x && map.get(x, y) === 'lichwall') map.set(x, y, 'skullniche');
  map.set(c.x, s < 0 ? hall.y - 1 : hall.y + hall.h, 'lockedDoor');
  map.stairs = { x: vault.x + (vault.w >> 1), y: vault.y + (vault.h >> 1) };
  map.bossSpot = { x: c.x, y: row(2) };
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
    if (Math.abs(dx) + Math.abs(dy) === 2) map.set(c.x + dx, row(2) + dy, 'soulrune');
  const inHall = (x, y) => x >= hall.x && x < hall.x + hall.w && y >= hall.y && y < hall.y + hall.h;
  for (const x of [hall.x, hall.x + hall.w - 1]) // bone heaps in the corners on the way in
    map.cells((cx, cy) => dist({ x: cx, y: cy }, { x, y: row(hall.h - 1) }) <= 1 && map.get(cx, cy) === 'lichfloor').forEach(p => chance(0.7) && map.set(p.x, p.y, 'bones'));
  map.cells((x, y) => inHall(x, y) && map.get(x, y) === 'lichfloor' && chance(0.12)).forEach(p => map.set(p.x, p.y, 'bones'));
  map.spawns.push({ x: c.x, y: row(1), monster: 'phylactery' },
    { x: c.x - 4, y: row(1), monster: 'bowman' }, { x: c.x + 4, y: row(1), monster: 'bowman' });
  for (const r of [hall, vault]) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.noSpawn[y][x] = true; // only the Lich and its escort
}

function addLichLair(map) {
  const H = { w: 11, h: 7 }, V = { w: 5, h: 3 };
  for (let tries = 0; tries < 300; tries++) {
    const hx = rand(3, map.w - H.w - 3) | 1, hy = rand(V.h + 3, map.h - H.h - 2) | 1;
    if (hx + H.w + 2 >= map.w || hy + H.h >= map.h - 1) continue;
    const hall = { x: hx, y: hy, w: H.w, h: H.h }, vault = { x: hx + 3, y: hy - V.h - 1, w: V.w, h: V.h };
    carveRect(map, hall.x, hall.y, hall.w, hall.h);
    for (const side of [-1, 1]) { // guaranteed entrances into the maze on both sides of the hall (below the dais)
      const x = side < 0 ? hx - 1 : hx + H.w;
      map.set(x, hy + 4, 'floor'); map.set(x + side, hy + 4, 'floor');
    }
    map.noSpawn = grid(map.w, map.h, false);
    furnishLichHall(map, hall, vault);
    map.reserved.push({ x: hx - 2, y: vault.y - 2, w: H.w + 4, h: H.h + V.h + 4 });
    addDoors(map, hall, 0.3);
    return map;
  }
  return map;
}

// Dress a trial chamber's floor: a summoning circle of runes around a glowing sigil in the middle (where the reward
// appears), rune obelisks casting violet light in the four inner corners.
function furnishTrial(map, r) {
  const c = { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }, rx = (r.w - 3) / 2, ry = (r.h - 3) / 2;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) { const e = ((x - c.x) / rx) ** 2 + ((y - c.y) / ry) ** 2; if (e >= 0.55 && e <= 1.05) map.set(x, y, 'runecircle'); }
  map.set(c.x, c.y, 'sigil');
  for (const [x, y] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) map.set(x, y, 'obelisk');
}

// A trial chamber: a rune-walled hall with an entrance on each side (furnishTrial). Stepping onto its runed floor
// seals it and starts the level's `trial` waves (trialTick, features.js). Sets map.trial; its tiles are noSpawn.
function addTrialChamber(map) {
  const W = 9, H = 7;
  for (let tries = 0; tries < 300; tries++) {
    const x = rand(3, map.w - W - 4) | 1, y = rand(3, map.h - H - 4) | 1, r = { x, y, w: W, h: H };
    if (x + W + 2 >= map.w || y + H + 2 >= map.h) continue;
    if (map.reserved.some(o => x - 2 < o.x + o.w && o.x < x + W + 2 && y - 2 < o.y + o.h && o.y < y + H + 2)) continue;
    for (let yy = y - 1; yy <= y + H; yy++) for (let xx = x - 1; xx <= x + W; xx++) map.set(xx, yy, 'runewall');
    carveRect(map, x, y, W, H, 'runefloor');
    for (const side of [-1, 1]) { // an entrance in the middle of each side wall, with a stub out into the maze
      const ex = side < 0 ? x - 1 : x + W;
      map.set(ex, y + 3, 'floor'); map.set(ex + side, y + 3, 'floor');
    }
    furnishTrial(map, r);
    map.noSpawn ||= grid(map.w, map.h, false);
    for (let yy = y; yy < y + H; yy++) for (let xx = x; xx < x + W; xx++) map.noSpawn[yy][xx] = true;
    map.reserved.push({ x: x - 2, y: y - 2, w: W + 4, h: H + 4 });
    map.trial = { r, state: 'ready' };
    return map;
  }
  return map;
}

// Ossuary chambers: 3 to `max` of assorted sizes (by default odd, 5-9 wide, 3-7 tall) packed into `area`, a wall apart,
// around any rooms already in `out`. [0] is the entrance.
function ossuaryChambers(area, max = 6, ws = [5, 5, 7, 7, 9], hs = [3, 5, 5, 7], out = []) {
  out = [...out];
  for (let tries = 0; tries < 60 * max && out.length < max; tries++) {
    const w = pick(ws), h = pick(hs);
    const r = { x: rand(area.x, area.x + area.w - w), y: rand(area.y, area.y + area.h - h), w, h };
    if (r.x + w > area.x + area.w || r.y + h > area.y + area.h) continue;
    if (out.some(o => r.x < o.x + o.w + 2 && o.x < r.x + r.w + 2 && r.y < o.y + o.h + 2 && o.y < r.y + r.h + 2)) continue;
    out.push(r);
  }
  return out.length >= 3 ? out : [];
}
// A warren's material and natives (buildOssuary, addSecretRoom, carveShape): the Ossuary's bone, the Silk Hive's silk.
// wall: hugs every chamber and passage (and makes pillars); crack: a secret room's breakable wall; litter: strewn over
// chamber floors (litterChance); webs: chance a chamber gets a cobweb patch; spawn: chamber natives (half the chambers);
// big: lives in the biggest chamber.
const WARREN_STYLES = {
  bone: { wall: 'bonewall', crack: 'crackedbone', litter: 'bones', litterChance: 0.35, webs: 0.7, spawn: 'skeleton', big: 'webspinner', pool: 'bone' },
  silk: { wall: 'silkwall', crack: 'thicksilk', litter: 'silkfloor', litterChance: 0.5, webs: 0.5, spawn: 'spiderling', big: 'webspinner', pool: 'hive' },
};
// Carve room c (its rect is the bounding box) in a shape. Every shape keeps the middle row and column open, so passages
// aimed at the middle always get in. rect | round (ellipse) | cross (4 arms) | L (one corner missing) |
// pillared (bone pillars on a grid) | cave (ragged edge).
function carveShape(map, c, shape, pillar = 'bonewall') {
  const cx = c.x + (c.w >> 1), cy = c.y + (c.h >> 1), rx = c.w / 2, ry = c.h / 2;
  const e = (x, y) => ((x + 0.5 - c.x - rx) / rx) ** 2 + ((y + 0.5 - c.y - ry) / ry) ** 2; // 0 middle .. 1 edge of the ellipse
  const vb = c.w >> 2, hb = c.h >> 2, sx = pick([-1, 1]), sy = pick([-1, 1]);
  const keep = {
    rect: () => true,
    round: (x, y) => e(x, y) <= 1.1,
    cross: (x, y) => Math.abs(x - cx) <= vb || Math.abs(y - cy) <= hb,
    L: (x, y) => sx * (x - cx) <= vb || sy * (y - cy) <= hb,
    pillared: () => true,
    cave: (x, y) => e(x, y) <= 0.55 + Math.random() * 0.6,
  }[shape];
  for (let y = c.y; y < c.y + c.h; y++)
    for (let x = c.x; x < c.x + c.w; x++) if (x === cx || y === cy || keep(x, y)) map.set(x, y, 'floor');
  if (shape === 'cave') { // a ragged edge can strand floor tiles: fill in any not joined to the middle (in the room)
    const inRoom = (x, y) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
    const d = map.distanceFrom(cx, cy, (x, y) => inRoom(x, y) && map.walkable(x, y));
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) if (d[y][x] === Infinity && map.walkable(x, y)) map.set(x, y, 'wall');
  }
  if (shape === 'pillared') // bone pillars on every other tile, off the middle row and column
    for (let y = c.y + 1; y < c.y + c.h - 1; y += 2) for (let x = c.x + 1; x < c.x + c.w - 1; x += 2) if (x !== cx && y !== cy) map.set(x, y, pillar);
}

// Carve and dress an ossuary complex: each chamber joins the nearest already-joined one by a passage, and often its
// second-nearest too (loops, several ways through), bone walls all round, bones and cobwebs, crypt spiders, a web spinner in the biggest
// chamber and a loot pile in the one farthest from the entrance.
function buildOssuary(map, cham, mid, entry = [], area = null, style = WARREN_STYLES.bone) { // entry: its way in, inside its area (bone-walled like a passage)
  // passages run between chamber middles, so they stay inside the complex's area
  const dig = (a, b) => orthoPath(a, b).map(p => (map.get(p.x, p.y) === 'wall' && map.set(p.x, p.y, 'floor'), p));
  // shapes first: carveShape's cave cleanup deletes floor not joined to the room's middle, which would cut a passage clipping its box
  cham.forEach(c => carveShape(map, c, c.shape || pick(c.w < 5 || c.h < 5 ? ['rect', 'cross'] : ['rect', 'round', 'round', 'cross', 'L', 'pillared', 'cave']), style.wall));
  const joined = [cham[0]], passages = [], linked = new Set(), link = (a, b) => {
    const k = [cham.indexOf(a), cham.indexOf(b)].sort().join();
    if (!linked.has(k)) { linked.add(k); passages.push(dig(mid(a), mid(b))); }
  };
  for (const c of cham.slice(1)) { // every chamber joins the nearest one already joined (all connected)...
    link(c, joined.reduce((a, b) => (dist(mid(b), mid(c)) < dist(mid(a), mid(c)) ? b : a)));
    joined.push(c);
  }
  for (const c of cham) { // ...and often its second-nearest too: loops, chambers with several ways in and out
    const second = cham.filter(o => o !== c).sort((a, b) => dist(mid(a), mid(c)) - dist(mid(b), mid(c)))[1];
    if (second && chance(0.6)) link(c, second);
  }
  // bone walls hug whatever was carved: chamber outlines and the passages between them
  const pass = [...passages.flat(), ...entry], near = (x, y) => cham.some(c => x >= c.x - 1 && x <= c.x + c.w && y >= c.y - 1 && y <= c.y + c.h);
  map.cells((x, y) => map.get(x, y) === 'wall' && DIRS.some(([dx, dy]) => map.walkable(x + dx, y + dy))).forEach(e => {
    if (near(e.x, e.y) || pass.some(p => dist(p, e) <= 1)) map.set(e.x, e.y, style.wall);
  });
  cham.forEach(c => {
    for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) if (map.get(x, y) === 'floor' && chance(style.litterChance)) map.set(x, y, style.litter);
    if (chance(style.webs)) blob(map, mid(c).x, mid(c).y, 4, 'web', ['floor', style.litter]);
    if (c !== cham[0] && chance(0.5)) map.spawns.push({ ...mid(c), monster: style.spawn });
  });
  const big = cham.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)), far = cham.reduce((a, b) => (dist(mid(b), mid(cham[0])) > dist(mid(a), mid(cham[0])) ? b : a));
  map.spawns.push({ ...mid(big), monster: style.big });
  map.loot.push({ ...mid(far), rarity: 'magic', pool: style.pool });
  if (area && chance(0.5)) addSecretRoom(map, cham, mid, area, style); // sometimes: a sealed room behind a cracked wall
}

// Burial niches: one-tile alcoves cut into the walls of a warren's corridors (the passage tiles outside every chamber), at most one
// per 3 tiles. Each holds a pickup (`loot`) or a hidden skeleton (`nicheam`, see tickNiches) or reacts when you step in (`map.nicheFx`: a mana boost, bone shards, a bit of lore). The alcove's own walls are
// re-hugged in the style's wall. Corridors keep their shape: a niche is a dead end off the side, so connectivity is untouched.
function addNiches(map, cham, style = WARREN_STYLES.bone, { loot = 0.22, ambush = 0.22 } = {}) {
  const box = [...cham, ...(map.secrets || [])], inBox = (x, y) => box.some(r => x >= r.x - 1 && x < r.x + r.w + 1 && y >= r.y - 1 && y < r.y + r.h + 1);
  const open = (x, y) => map.inBounds(x, y) && map.walkable(x, y), solid = (x, y) => map.inBounds(x, y) && !map.walkable(x, y) && !TILES[map.get(x, y)].breakable;
  const made = [];
  for (const c of shuffle(map.cells((x, y) => map.walkable(x, y) && !inBox(x, y)))) {
    const vert = open(c.x, c.y - 1) && open(c.x, c.y + 1) && !open(c.x - 1, c.y) && !open(c.x + 1, c.y);
    const horiz = open(c.x - 1, c.y) && open(c.x + 1, c.y) && !open(c.x, c.y - 1) && !open(c.x, c.y + 1);
    if (!vert && !horiz) continue;
    const side = pick(vert ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]]), [sx, sy] = side, ax = vert ? 0 : 1, ay = vert ? 1 : 0; // side = out of the corridor, a = along it
    const n = { x: c.x + sx, y: c.y + sy };
    const ring = [[0, 0], [sx, sy], [sx + ax, sy + ay], [sx - ax, sy - ay], [ax, ay], [-ax, -ay]].map(([dx, dy]) => ({ x: n.x + dx, y: n.y + dy }));
    if (!ring.every(p => map.inBounds(p.x, p.y) && p.x > 0 && p.y > 0 && p.x < map.w - 1 && p.y < map.h - 1 && solid(p.x, p.y)) || inBox(n.x, n.y)) continue;
    if (made.some(o => dist(o, n) < 3)) continue;
    map.set(n.x, n.y, 'niche');
    DIRS.forEach(([dx, dy]) => map.get(n.x + dx, n.y + dy) === 'wall' && map.set(n.x + dx, n.y + dy, style.wall)); // hug the alcove like the passage
    const r = Math.random();
    if (r < loot) map.loot.push({ x: n.x, y: n.y, ...(chance(0.7) ? { item: pick(['Healing Potion', 'Mana Potion']) } : { rarity: 'common' }) });
    else if (r < loot + ambush) map.set(n.x, n.y, 'nicheam');
    else (map.nicheFx ||= {})[n.x + ',' + n.y] = pick(['mp', 'mp', 'trap', 'lore', 'lore', 'lore']); // the rest react when stepped in (TILES.niche.onEnter)
    made.push(n);
  }
  return made;
}

// The hand room: one chamber (from `cands`, 5x5 or bigger if any) is the crawling hands' - bone litter on the floor, a rare pickup in the middle,
// and up to `n` wall tiles hugging the floor set with hands (`handwall`, 2 or more tiles apart). Its own natives are removed. Step inside and they
// claw out (tickHandRoom). Recorded in map.handRoom (the chamber's rect). Returns the chamber, or null.
function addHandRoom(map, cands, n = 8) {
  const roomy = cands.filter(r => r.w >= 5 && r.h >= 5), c = pick(roomy.length ? roomy : cands);
  if (!c) return null;
  const inside = (x, y) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h, mid = roomMid(c);
  map.spawns = map.spawns.filter(s => !inside(s.x, s.y));
  map.cells((x, y) => inside(x, y) && ['floor', 'web'].includes(map.get(x, y)) && chance(0.4)).forEach(p => map.set(p.x, p.y, 'bones'));
  map.loot.push({ ...mid, rarity: 'rare', pool: 'bone' });
  const spots = shuffle(map.cells((x, y) => map.get(x, y) === 'bonewall' && DIRS.slice(0, 4).some(([dx, dy]) => inside(x + dx, y + dy) && map.walkable(x + dx, y + dy))));
  const made = [];
  for (const s of spots) if (made.length < n && !made.some(o => dist(o, s) < 2)) { map.set(s.x, s.y, 'handwall'); made.push(s); }
  map.handRoom = { x: c.x, y: c.y, w: c.w, h: c.h, woken: false };
  return c;
}
// An ossuary's secret room: a small sealed chamber behind a cracked bone wall (crackedbone) in the middle of one of its
// chambers' sides - only where it fits in untouched rock inside the complex's area (so nothing built later cuts in).
// Placeholder contents for now: a rare item. Recorded in map.secrets.
function addSecretRoom(map, cham, mid, area, style = WARREN_STYLES.bone) {
  const inArea = (x, y) => x >= area.x - 1 && y >= area.y - 1 && x <= area.x + area.w && y <= area.y + area.h;
  for (const c of shuffle([...cham]))
    for (const [dx, dy] of shuffle(DIRS.slice(0, 4))) {
      const m = mid(c), w = dx ? 3 : pick([3, 5]), h = dx ? pick([3, 5]) : 3;
      const crack = dx ? { x: dx > 0 ? c.x + c.w : c.x - 1, y: m.y } : { x: m.x, y: dy > 0 ? c.y + c.h : c.y - 1 };
      const r = dx ? { x: dx > 0 ? crack.x + 1 : crack.x - w, y: m.y - (h >> 1), w, h } : { x: m.x - (w >> 1), y: dy > 0 ? crack.y + 1 : crack.y - h, w, h };
      let ok = map.walkable(crack.x - dx, crack.y - dy); // the chamber side of the crack is open floor
      for (let y = r.y - 1; ok && y <= r.y + r.h; y++)
        for (let x = r.x - 1; ok && x <= r.x + r.w; x++) {
          if (x === crack.x && y === crack.y) continue;
          const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h, t = map.get(x, y);
          ok = inArea(x, y) && (inside ? t === 'wall' : t === 'wall' || t === style.wall);
        }
      if (!ok) continue;
      carveRect(map, r.x, r.y, r.w, r.h);
      wallRing(map, r, style.wall);
      map.set(crack.x, crack.y, style.crack);
      map.loot.push({ ...mid(r), rarity: 'rare', pool: style.pool }); // (pool: e.g. the hive's silk gear)
      (map.secrets ||= []).push(r);
      return r;
    }
  return null;
}

// ---- chamber-crypt rooms (genCryptChambers). Each gets its room r (carved floor), and adds its own monsters. ----
const roomMid = r => ({ x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) });
const spawnAt = (map, x, y, monster, extra) => map.spawns.push(extra ? { x, y, template: { ...MONSTERS[monster], ...extra } } : { x, y, monster });
// Main-path arenas. from: the middle of the chamber you come in from (bosses wait at the far end). withKey: this
// mini-boss carries the treasure vault's key.
// Helpers: the room's far end (away from where you come in); dress the plain-wall tiles of its long (top and bottom)
// walls, leaving any openings; put a centrepiece at the far end of the middle row unless a corridor comes in there.
const farSide = (r, from) => (from.x < roomMid(r).x ? 1 : -1);
const dressLongWalls = (map, r, tile, every = 1) => {
  for (let x = r.x; x < r.x + r.w; x += every) for (const y of [r.y - 1, r.y + r.h]) if (map.get(x, y) === 'wall') map.set(x, y, tile);
};
// Put `tile` on edge cell (x, y) of room r unless a corridor comes in right beside it (it would block the way in).
function edgeProp(map, r, x, y, tile) {
  const outside = DIRS.slice(0, 4).map(([dx, dy]) => ({ x: x + dx, y: y + dy })).filter(p => p.x < r.x || p.y < r.y || p.x >= r.x + r.w || p.y >= r.y + r.h);
  if (!outside.some(p => map.walkable(p.x, p.y))) map.set(x, y, tile);
}
// The centrepiece (throne, altar) goes in the middle of the far wall. A corridor arriving right there is rerouted to
// come in two tiles along that wall instead (a short dogleg just outside), so the centrepiece never blocks the way in.
function farCentrepiece(map, r, dir, tile) {
  const c = roomMid(r), x = dir > 0 ? r.x + r.w - 1 : r.x, ring = x + dir, out = ring + dir;
  if (map.walkable(ring, c.y) || TILES[map.get(ring, c.y)].door) {
    const wallTile = map.get(ring, c.y - 1), ok = t => ['wall', 'floor', wallTile].includes(t);
    const s = [2, -2].find(s => ok(map.get(out, c.y + s / 2)) && ok(map.get(out, c.y + s)) && ok(map.get(ring, c.y + s)));
    if (s) {
      map.set(ring, c.y, wallTile);
      for (const p of [{ x: out, y: c.y + s / 2 }, { x: out, y: c.y + s }, { x: ring, y: c.y + s }]) map.set(p.x, p.y, 'floor');
    }
  }
  if (!map.walkable(ring, c.y)) map.set(x, c.y, tile);
  return x - dir; // where its owner stands, before it
}
const CRYPT_DOORS = 0.85; // chance each doorway of a chamber-crypt room gets a door
// Boss rooms (the chamber crypt's mini-boss arenas and the Lich's hall): this size - roomy enough for a fight. The crypt's
// grid cells (TEST_LEVEL.size) are sized to fit them, the Lich's hall with its stairs vault behind.
const ARENA = { w: 17, h: 11 };
const ARENA_BUILDS = {
  // The Death Knight's parade hall: a red carpet up the middle to a throne at the far end, suits of armour down both
  // sides, red banners on the walls. The knight stands before his throne, skeletons at his side.
  deathknight(map, r, from, withKey) {
    const c = roomMid(r), dir = farSide(r, from);
    for (let x = r.x; x < r.x + r.w; x++) map.set(x, c.y, 'carpet');
    for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) if (x !== c.x) { map.set(x, r.y + 1, 'armour'); map.set(x, r.y + r.h - 2, 'armour'); }
    dressLongWalls(map, r, 'banner', 2);
    wallRing(map, r, 'ironwall'); // (after the banners: they hang on plain wall)
    const at = farCentrepiece(map, r, dir, 'throne'), endX = at + dir; // braziers flank the throne (no torches on iron)
    edgeProp(map, r, endX, r.y, 'brazier'); edgeProp(map, r, endX, r.y + r.h - 1, 'brazier');
    spawnAt(map, at, c.y, 'deathknight', withKey && { drops: 'vaultkey' });
    [[0, -1], [0, 1], [-dir, 0]].forEach(([dx, dy]) => spawnAt(map, at + dx, c.y + dy, 'skeleton'));
  },
  // The Wight's tomb: rows of sarcophagi in the dark (no torches on its walls), grave candles in the corners casting a
  // sickly green light, and open graves the ghouls climb out of. The Wight waits among them.
  wight(map, r, from, withKey) {
    const c = roomMid(r);
    for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) if (x !== c.x) { map.set(x, r.y + 1, 'sarcophagus'); map.set(x, r.y + r.h - 2, 'sarcophagus'); }
    // grave candles in the corners and midway along the end walls - the tomb's only light (the Wight snuffs them)
    for (const [x, y] of [[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1], [r.x, c.y - 1], [r.x + r.w - 1, c.y + 1]])
      edgeProp(map, r, x, y, 'candle');
    map.dark.push({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });
    wallRing(map, r, 'tombwall');
    spawnAt(map, c.x, c.y, 'wight', withKey && { drops: 'vaultkey' });
    for (const dx of [-2, 2]) { map.set(c.x + dx, c.y, 'grave'); spawnAt(map, c.x + dx, c.y, 'ghoul'); }
    for (const dx of [-6, 6]) map.set(c.x + dx, c.y, 'grave'); // (two more, empty for now - ghouls climb out mid-fight)
  },
  // The Banshee's chapel: pews either side of a central aisle, stained-glass windows along the walls, an altar at the
  // far end with the Banshee before it. A lone brazier by the door is the only warm light - she keeps to the dark.
  banshee(map, r, from, withKey) {
    const c = roomMid(r), dir = farSide(r, from);
    // pews on every other row, in short benches with gaps between: room to move about (her keens and flits need it)
    for (let y = r.y + 1; y < r.y + r.h - 1; y += 2)
      if (y !== c.y) for (let x = r.x + 2; x < r.x + r.w - 2; x++) if (x !== c.x && Math.abs(x - c.x) % 4 !== 0) map.set(x, y, 'pew');
    dressLongWalls(map, r, 'glass');
    wallRing(map, r, 'chapelwall'); // (the end walls: the long ones are windows)
    edgeProp(map, r, dir > 0 ? r.x : r.x + r.w - 1, r.y, 'brazier');
    map.dark.push({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });
    const at = farCentrepiece(map, r, dir, 'chapelaltar');
    spawnAt(map, at, c.y, 'banshee', withKey && { drops: 'vaultkey' });
    spawnAt(map, at, r.y, 'ghost'); spawnAt(map, at, r.y + r.h - 1, 'ghost');
  },
  // The Grave Serpent's pit: packed earth strewn with shed skins, four broken columns for it to wind between, crumbling
  // walls, candles in the corners the only light. It lies coiled in the middle.
  serpent(map, r, from, withKey) {
    const c = roomMid(r);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.set(x, y, 'pitfloor');
    const qx = r.w >> 2, qy = r.h >> 2; // (columns a quarter of the way in from each side, however big the pit)
    for (const [dx, dy] of [[-qx, -qy], [qx, -qy], [-qx, qy], [qx, qy]]) map.set(c.x + dx, c.y + dy, 'column');
    shuffle(map.cells((x, y) => map.get(x, y) === 'pitfloor' && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h && dist({ x, y }, c) > 1))
      .slice(0, 6).forEach(p => map.set(p.x, p.y, 'shedskin'));
    for (const [x, y] of [[r.x, r.y], [r.x + r.w - 1, r.y], [r.x, r.y + r.h - 1], [r.x + r.w - 1, r.y + r.h - 1]]) edgeProp(map, r, x, y, 'candlestick');
    wallRing(map, r, 'pitwall');
    map.dark.push({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });
    spawnAt(map, c.x, c.y, 'graveserpent', withKey && { drops: 'vaultkey' });
  },
  // Flooded crypt: dark flood water fills it (wading is slow; the drowned glide through it) but for a causeway of raised
  // flagstones along the middle row and column. Two deep pools, glowing in patches - the only light - with drowned ones
  // in them and half-sunken coffins at their edges. Dripping walls. The rim and the causeway stay walkable, so the way
  // through is never cut.
  flooded(map, r, from) {
    const c = roomMid(r), inRoom = (x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.set(x, y, x === c.x || y === c.y ? 'flagstone' : 'floodwater');
    const quads = shuffle([[-1, -1], [1, -1], [-1, 1], [1, 1]]).slice(0, 2);
    quads.forEach(([qx, qy], k) => {
      const px = c.x + qx * 3, py = c.y + qy * 2;
      for (let y = r.y + 1; y < r.y + r.h - 1; y++)
        for (let x = r.x + 1; x < r.x + r.w - 1; x++)
          if (x !== c.x && y !== c.y && Math.sign(x - c.x) === qx && Math.sign(y - c.y) === qy && ((x - px) / 2.2) ** 2 + ((y - py) / 1.2) ** 2 <= 1)
            map.set(x, y, chance(0.3) ? 'glowwater' : 'water');
      spawnAt(map, px, py, 'drowned');
      if (k === 0) spawnAt(map, px + (map.get(px + 1, py) === 'floodwater' ? -1 : 1), py, 'drowned');
    });
    // Coffins sinking at the pools' edges - each only if every walkable tile in the room is still joined up after it.
    const joined = () => { const d = map.distanceFrom(c.x, c.y, (x, y) => inRoom(x, y) && map.walkable(x, y));
      return map.cells((x, y) => inRoom(x, y) && map.walkable(x, y)).every(p => d[p.y][p.x] < Infinity); };
    shuffle(map.cells((x, y) => inRoom(x, y) && map.get(x, y) === 'floodwater' && DIRS.some(([dx, dy]) => TILES[map.get(x + dx, y + dy)].swim)))
      .slice(0, 3).forEach(p => { map.set(p.x, p.y, 'sunkencoffin'); if (!joined()) map.set(p.x, p.y, 'floodwater'); });
    wallRing(map, r, 'wetwall');
    map.dark.push({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });
  },
};
// Carve room r into a ragged, roundish hollow instead of a box: the middle row and column, the tiles within 2 of the
// middle and the corridor's line in (from `fromRoom`) always stay open; stray bits cut off by the ragged edge are filled
// back in. floor(): the tile for each open cell. Returns open(x, y): an open tile inside the room.
function raggedHollow(map, r, fromRoom, mid, floor) {
  const c = roomMid(r), inRoom = (x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const open = (x, y) => inRoom(x, y) && map.walkable(x, y);
  const keep = new Set(orthoPath(mid(fromRoom), c).map(p => p.x + ',' + p.y)), rx = r.w / 2, ry = r.h / 2;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const e = ((x + 0.5 - r.x - rx) / rx) ** 2 + ((y + 0.5 - r.y - ry) / ry) ** 2;
      const isOpen = x === c.x || y === c.y || dist({ x, y }, c) <= 2 || keep.has(x + ',' + y) || e <= 0.7 + Math.random() * 0.45;
      map.set(x, y, isOpen ? floor() : 'wall');
    }
  const reach = map.distanceFrom(c.x, c.y, open);
  map.cells((x, y) => open(x, y) && reach[y][x] === Infinity).forEach(p => map.set(p.x, p.y, 'wall'));
  return open;
}

// Special side rooms. r: the carved room; from: the path chamber whose corridor leads in.
// A room nothing spawns in (the ways down to the side-floors stay clear).
const calmRoom = (map, r) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.noSpawn[y][x] = true; };
const SIDE_BUILDS = {
  // Treasure vault: solid granite all round but for one locked door, mid-wall on the side facing the chamber it hangs
  // off, with its own corridor straight to it (that corridor stays on the near side, so it never cuts the vault's wall).
  // A rare item and a magic one.
  vault(map, r, fromRoom, mid) {
    const from = mid(fromRoom), c = mid(r), dx = from.x - c.x, dy = from.y - c.y, horiz = Math.abs(dx) > Math.abs(dy);
    const door = horiz ? { x: dx < 0 ? r.x - 1 : r.x + r.w, y: c.y } : { x: c.x, y: dy < 0 ? r.y - 1 : r.y + r.h };
    const out = { x: door.x + (horiz ? Math.sign(dx) : 0), y: door.y + (horiz ? 0 : Math.sign(dy)) };
    orthoPath(from, out).forEach(p => map.get(p.x, p.y) === 'wall' && map.set(p.x, p.y, 'floor'));
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++)
      if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) map.set(x, y, 'granite');
    map.set(door.x, door.y, 'vaultDoor');
    map.loot.push({ x: r.x + 1, y: r.y + 1, rarity: 'rare' }, { x: r.x + r.w - 2, y: r.y + 1, rarity: 'magic' });
  },
  // Sarcophagus ambush: a quiet tomb, coffins along both long walls, a treasure on a plinth in the middle - step up to
  // it and the coffins burst open (TILES.plinth.onEnter).
  ambush(map, r) {
    const c = roomMid(r);
    wallRing(map, r, 'granite');
    for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) if (x !== c.x) { map.set(x, r.y, 'sarcophagus'); map.set(x, r.y + r.h - 1, 'sarcophagus'); }
    map.set(c.x, c.y, 'plinth');
    map.loot.push({ ...c, rarity: 'rare' });
    addDoors(map, r, CRYPT_DOORS);
  },
  // The way down to the Ossuary (a side-floor): a small bone crypt with a stairway in the middle (nothing spawns in it).
  ossuarystair(map, r) {
    const c = roomMid(r);
    wallRing(map, r, 'bonewall');
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (chance(0.4)) map.set(x, y, 'bones');
    map.set(c.x, c.y, 'bonestair');
    calmRoom(map, r);
    addDoors(map, r, CRYPT_DOORS);
  },
  // The way down to the Goblin Warrens (a side-floor): a dug-out tunnel mouth - trampled dirt, supply crates and barrels
  // by the walls, a guttering torch, the tunnel in the middle.
  warrenstair(map, r) {
    const c = roomMid(r);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.set(x, y, 'dirt');
    edgeProp(map, r, r.x, r.y, 'crate'); edgeProp(map, r, r.x + r.w - 1, r.y + r.h - 1, 'barrel');
    map.set(c.x, c.y, 'warrenstair');
    calmRoom(map, r);
    addDoors(map, r, CRYPT_DOORS);
  },
  // The way down to the Silk Hive (a side-floor): a shaft choked with silk - webbed walls, strands and cobwebs underfoot.
  hivestair(map, r) {
    const c = roomMid(r);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.set(x, y, chance(0.3) ? 'web' : 'silkfloor');
    wallRing(map, r, 'silkwall');
    map.set(c.x, c.y, 'hivestair');
    calmRoom(map, r);
    addDoors(map, r, CRYPT_DOORS);
  },
  // Goblin war camp: a raiding party holed up on trampled dirt around a campfire - hide tents in the corners with
  // straw bedrolls, crates and barrels of supplies along the walls, gnawed bones, and their plunder. Kept apart from the
  // undead (in the open crypt they'd be mobbed the moment they woke). Nothing else spawns in it.
  camp(map, r, fromRoom, mid) {
    const c = roomMid(r), onCross = (x, y) => x === c.x || y === c.y;
    const open = raggedHollow(map, r, fromRoom, mid, () => (chance(0.08) ? 'bones' : 'dirt'));
    const joined = () => { const d = map.distanceFrom(c.x + 1, c.y, open); return map.cells(open).every(p => d[p.y][p.x] < Infinity); };
    map.set(c.x, c.y, 'campfire');
    // Against the walls: a tent in each quadrant with a straw bedroll beside it, then crates and barrels - each prop only
    // if every open tile in the camp stays joined up.
    const byWall = (x, y) => open(x, y) && !onCross(x, y) && dist({ x, y }, c) > 2 && DIRS.slice(0, 4).some(([dx, dy]) => map.get(x + dx, y + dy) === 'wall');
    const put = (p, t) => { const was = map.get(p.x, p.y); map.set(p.x, p.y, t); if (!joined()) { map.set(p.x, p.y, was); return false; } return true; };
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const spot = shuffle(map.cells((x, y) => byWall(x, y) && Math.sign(x - c.x) === sx && Math.sign(y - c.y) === sy))[0];
      if (!spot || !put(spot, 'tent')) continue;
      const bed = DIRS.slice(0, 4).map(([dx, dy]) => ({ x: spot.x + dx, y: spot.y + dy })).find(p => open(p.x, p.y) && !onCross(p.x, p.y));
      if (bed) map.set(bed.x, bed.y, 'straw');
    }
    shuffle(map.cells(byWall)).slice(0, 6).forEach((p, i) => put(p, i % 2 ? 'barrel' : 'crate'));
    // The war band around the fire, their plunder beside it.
    const round = shuffle(map.cells((x, y) => open(x, y) && dist({ x, y }, c) <= 2 && map.get(x, y) !== 'campfire'));
    ['raider', 'raider', 'raider', 'raidarcher', 'raidarcher'].forEach((k, i) => round[i] && spawnAt(map, round[i].x, round[i].y, k));
    if (round[5]) map.loot.push({ ...round[5], rarity: 'magic' });
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) map.noSpawn[y][x] = true;
    addDoors(map, r, CRYPT_DOORS);
  },
};

// Build a warren again (up to 8 times) until every chamber (map.reserved) can be reached from map.start - a cut-off one would
// be filled in by keepLargestRegion, taking the boss or even the entrance with it. Secret rooms count (their crack is breakable).
function untilJoined(build) {
  let map;
  for (let i = 0; i < 8; i++) {
    map = build();
    const d = map.distanceFrom(map.start.x, map.start.y, (x, y) => map.walkable(x, y) || !!TILES[map.get(x, y)].breakable);
    if (map.reserved.every(c => d[c.y + (c.h >> 1)][c.x + (c.w >> 1)] < Infinity)) break;
  }
  return map;
}
// The Ossuary (a side-floor under the crypt, SIDE_LEVELS.ossuary): one big bone warren - 10-14 shaped bone chambers
// joined by looped passages, two secret rooms behind cracked walls, spiders and webs, loot deep in, and the Bone Colossus
// oozing about the biggest of the far chambers. map.start: the first chamber (loadLevel puts the way back up there). Also: burial niches along the
// corridors (addNiches), stirring bone heaps (bonepile) and a chamber of crawling hands (addHandRoom) - see the level's `niches` / `stirBones` flags.
function genOssuary(w, h) { return untilJoined(() => ossuaryOnce(w, h)); }
function ossuaryOnce(w, h) {
  const map = new GameMap(w, h), area = { x: 2, y: 2, w: w - 4, h: h - 4 };
  let cham = [];
  for (let tries = 0; tries < 10 && cham.length < 10; tries++) cham = ossuaryChambers(area, 14);
  buildOssuary(map, cham, roomMid);
  for (let i = 0; i < 2; i++) addSecretRoom(map, cham, roomMid, area);
  addNiches(map, cham); // corridors lined with burial niches
  map.start = roomMid(cham[0]);
  const far = cham.slice(1).sort((a, b) => dist(roomMid(b), map.start) - dist(roomMid(a), map.start)).slice(0, 4)
    .reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  map.spawns.unshift({ ...roomMid(far), monster: 'colossus' }); // first, so it gets its spot (the web spinner may want it)
  // The bone forge: a chamber (not the entrance, the Colossus's or the web spinner's) knee-deep in bones, no webs, the
  // forge in the middle building skeletons from them.
  const big = cham.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  const away = cs => { const f = cs.filter(c => dist(roomMid(c), map.start) >= 18); return f.length ? f : cs; }; // set pieces keep clear of the entrance
  const forge = shuffle(away(cham.slice(1).filter(c => c !== far && c !== big))).sort((a, b) => (b.w >= 5 && b.h >= 5) - (a.w >= 5 && a.h >= 5))[0];
  if (forge) {
    const c = roomMid(forge);
    for (let y = forge.y; y < forge.y + forge.h; y++)
      for (let x = forge.x; x < forge.x + forge.w; x++) if (['floor', 'bones', 'web'].includes(map.get(x, y))) map.set(x, y, chance(0.55) ? 'bones' : 'floor');
    map.set(c.x, c.y, 'floor');
    map.spawns = map.spawns.filter(s => dist(s, c) > 0); // (a crypt spider may have been put there)
    map.spawns.push({ ...c, monster: 'boneforge' });
  }
  const worm = pick(away(cham.slice(1).filter(c => c !== far && c !== forge))); // a bone worm nosing through the bones
  if (worm) map.spawns.unshift({ ...roomMid(worm), monster: 'boneworm' }); // first, so a native in its chamber can't take its spot
  const handRoom = addHandRoom(map, cham.slice(1).filter(c => ![far, forge, worm, big].includes(c))); // a chamber of crawling hands
  // Bone heaps (level.stirBones, tickBones): half the chambers - not the entrance or the forge's - get one, off the middle row and column.
  for (const c of cham.slice(1).filter(r => r !== forge && r !== handRoom && chance(0.5))) {
    const m = roomMid(c), spots = map.cells((x, y) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h && x !== m.x && y !== m.y && ['floor', 'bones'].includes(map.get(x, y)));
    if (spots.length) { const p = pick(spots); map.set(p.x, p.y, 'bonepile'); }
  }
  map.reserved.push(...cham);
  return map;
}

// The Silk Hive (SIDE_LEVELS.hive - a side-floor off the boss crypt): a warren built like the Ossuary but all of silk - 12-18
// shaped chambers walled in webbing (silkwall: fire burns through it, see tickFire), floors strung with silk strands,
// cobwebs, spiderlings. Cocoons line chamber edges (cut them open: an old adventurer's gear, a spiderling brood or a
// husk), egg clutches sit in some chambers (they hatch as you come near - tickEggs), two sealed side rooms behind thick
// silk (bump it 3x), and the Broodmother - a mass-form multibody laying eggs as she goes - in the biggest far chamber.
function genHive(w, h) { return untilJoined(() => hiveOnce(w, h)); }
function hiveOnce(w, h) {
  const map = new GameMap(w, h), area = { x: 2, y: 2, w: w - 4, h: h - 4 }, S = WARREN_STYLES.silk;
  // Spiders need room to spread their legs: the Broodmother's lair (15x11, in a far corner) goes in first, then roomy
  // chambers round it; the entrance is the chamber farthest from the lair.
  const lair = { w: 15, h: 11, shape: 'round' }; // (c.shape: buildOssuary carves it that shape)
  Object.assign(lair, { x: pick([area.x + 1, area.x + area.w - lair.w - 1]), y: pick([area.y + 1, area.y + area.h - lair.h - 1]) });
  let cham = [];
  for (let tries = 0; tries < 10 && cham.length < 10; tries++) cham = ossuaryChambers(area, 16, [5, 7, 7, 9, 9, 11], [5, 5, 7, 7, 9], [lair]);
  cham.unshift(...cham.splice(cham.indexOf(cham.reduce((a, b) => (dist(roomMid(b), roomMid(lair)) > dist(roomMid(a), roomMid(lair)) ? b : a))), 1));
  buildOssuary(map, cham, roomMid, [], null, S);
  for (let i = 0; i < 2; i++) addSecretRoom(map, cham, roomMid, area, S);
  map.start = roomMid(cham[0]);
  map.spawns.unshift({ ...roomMid(lair), monster: 'broodmother' });
  // oil lamps on chamber walls (half the chambers), silk weavers in two chambers
  for (const c of cham) if (chance(0.5)) {
    const wall = pick(map.cells((x, y) => map.get(x, y) === S.wall && DIRS.slice(0, 4).some(([dx, dy]) => {
      const fx = x + dx, fy = y + dy; return fx >= c.x && fx < c.x + c.w && fy >= c.y && fy < c.y + c.h && map.walkable(fx, fy); })));
    if (wall) map.set(wall.x, wall.y, 'oillamp');
  }
  shuffle(cham.slice(1).filter(c => c !== lair)).slice(0, 2).forEach(c => map.spawns.unshift({ ...roomMid(c), monster: 'silkweaver' })); // (first, so a native standing in that chamber can't take its spot)
  // giant spiders (3x3) in the roomiest other chambers
  shuffle(cham.slice(1).filter(c => c !== lair && c.w >= 7 && c.h >= 7)).slice(0, 3).forEach(c => map.spawns.push({ ...roomMid(c), monster: 'giantspider' }));
  // A prop stays only if every chamber is still reachable from the entrance (a passage may cross a chamber off its axes).
  const open = (x, y) => map.walkable(x, y) || !!TILES[map.get(x, y)].breakable;
  const put = (p, tile) => {
    map.set(p.x, p.y, tile);
    const d = map.distanceFrom(map.start.x, map.start.y, open);
    if (cham.some(c => d[roomMid(c).y][roomMid(c).x] === Infinity)) map.set(p.x, p.y, 'silkfloor');
  };
  for (const c of cham.slice(1)) {
    const m = roomMid(c), inside = (x, y) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
    const offAxis = (x, y) => inside(x, y) && map.walkable(x, y) && x !== m.x && y !== m.y; // (the middle row/column are the ways through)
    shuffle(map.cells((x, y) => offAxis(x, y) && DIRS.slice(0, 4).some(([dx, dy]) => map.get(x + dx, y + dy) === S.wall)))
      .slice(0, rand(0, 2)).forEach(p => put(p, 'cocoon'));
    if (c !== lair && chance(0.35))
      shuffle(map.cells((x, y) => offAxis(x, y) && dist({ x, y }, m) <= 2)).slice(0, rand(2, 3)).forEach(p => put(p, 'eggsac'));
  }
  map.reserved.push(...cham);
  return map;
}

// Spider test room (EXTRA_FLOORS.spidertest): a lit hall with a few pillars, a 1-wide corridor out to a side room (to
// watch legs fold), you at the west end, the Broodmother at the east end and a giant spider in the side room.
function genSpiderTest(w, h) {
  const map = new GameMap(w, h), hall = { x: 2, y: 3, w: 26, h: 15 }, side = { x: 34, y: 7, w: 7, h: 7 };
  carveRect(map, hall.x, hall.y, hall.w, hall.h); carveRect(map, side.x, side.y, side.w, side.h);
  for (let x = hall.x + hall.w; x < side.x; x++) map.set(x, 10, 'floor');
  for (const [x, y] of [[10, 6], [10, 14], [16, 14]]) map.set(x, y, 'wall');
  map.start = { x: 4, y: 10 };
  map.spawns.push({ x: 21, y: 10, monster: 'broodmother' }, { x: 37, y: 10, monster: 'giantspider' });
  return placeTorches(map, 6, 3);
}

// Long-legged spider test room (EXTRA_FLOORS.longspidertest): a lit hall with a few pillars and a 1-wide corridor out to a side room (to watch the
// three-part legs fold), you at the west end, the spider in the east half.
function genLongSpiderTest(w, h) {
  const map = new GameMap(w, h), hall = { x: 2, y: 3, w: 30, h: 17 }, side = { x: 38, y: 7, w: 8, h: 9 };
  carveRect(map, hall.x, hall.y, hall.w, hall.h); carveRect(map, side.x, side.y, side.w, side.h);
  for (let x = hall.x + hall.w; x < side.x; x++) map.set(x, 11, 'floor');
  for (const [x, y] of [[10, 6], [10, 16], [18, 11], [18, 12], [24, 7], [24, 15]]) map.set(x, y, 'wall');
  map.start = { x: 4, y: 11 };
  map.spawns.push({ x: 24, y: 11, monster: 'longspider' });
  return placeTorches(map, 8, 4);
}

// Gear test room (EXTRA_FLOORS.geartest): a lit room with every exclusive set piece laid out in rows - the Ossuary's
// bone armour, its relic set, the hive's silk gear - to try on (paper doll, gear on the hero).
function genGearTest(w, h) {
  const map = new GameMap(w, h);
  carveRect(map, 2, 2, w - 4, h - 4);
  map.start = { x: 4, y: h >> 1 };
  const rows = [POOL_BASES.bone.slice(0, 6), POOL_BASES.bone.slice(6), POOL_BASES.hive];
  rows.forEach((set, r) => set.forEach((b, i) => map.loot.push({ x: 8 + i * 2, y: 4 + r * 3, base: b.name })));
  return placeTorches(map, 4, 4);
}

// Boss test (EXTRA_FLOORS.bosstest): a lit hub with a corridor and boss door to every boss room - the Death Knight's hall
// (west), the Wight's tomb (north-west), the Banshee's chapel (north-east), the Grave Serpent's pit (east) and the Lich's
// sanctum with its stairs vault (south). The same ARENA_BUILDS / furnishLichHall rooms as the crypt, each locking behind
// you (map.arenas). In the hub, BOSS_TEST_GEAR at each rarity: a row of common, magic and rare pieces.
const BOSS_TEST_GEAR = ['Iron Helm', 'Plate Armor', 'Gauntlets', 'Greaves', 'Tower Shield', 'Longsword', 'Circlet', 'Runestaff', 'Spell Orb', 'Gold Ring', 'Jade Amulet'];
function genBossTest(w, h) {
  const map = new GameMap(w, h), A = ARENA;
  map.noSpawn = grid(w, h, true);
  const hub = { x: 43, y: 21, w: 25, h: 9 }, c = roomMid(hub);
  const rooms = { deathknight: { x: 4, y: 20 }, wight: { x: 18, y: 3 }, banshee: { x: 76, y: 3 }, serpent: { x: 89, y: 20 } };
  const hall = { x: 47, y: 35, w: A.w, h: A.h }, vault = { x: 53, y: 47, w: 5, h: 3 };
  for (const r of [hub, hall, ...Object.values(rooms).map(r => Object.assign(r, A))]) carveRect(map, r.x, r.y, r.w, r.h);
  const dig = pts => pts.slice(1).forEach((b, i) => line(pts[i].x, pts[i].y, b.x, b.y).forEach(p => map.set(p.x, p.y, 'floor')));
  dig([{ x: 21, y: c.y }, { x: 42, y: c.y }]); // west
  dig([{ x: 68, y: c.y }, { x: 88, y: c.y }]); // east
  dig([{ x: 47, y: 20 }, { x: 47, y: 8 }, { x: 35, y: 8 }]); // north-west
  dig([{ x: 63, y: 20 }, { x: 63, y: 8 }, { x: 75, y: 8 }]); // north-east
  dig([{ x: c.x, y: 30 }, { x: c.x, y: 34 }]); // south
  map.arenas = [];
  for (const [role, r] of Object.entries(rooms)) {
    ARENA_BUILDS[role](map, r, c, false);
    map.arenas.push({ r, state: 'ready' }); addDoors(map, r, 1, 'bossdoor');
  }
  furnishLichHall(map, hall, vault);
  map.arenas.push({ r: hall, state: 'ready' }); addDoors(map, hall, 1, 'bossdoor');
  wallRing(map, hub, 'marble');
  ['common', 'magic', 'rare'].forEach((rarity, row) => BOSS_TEST_GEAR.forEach((base, i) => map.loot.push({ x: hub.x + 2 + i * 2, y: hub.y + 1 + row * 2, base, rarity })));
  map.start = { x: c.x, y: hub.y + hub.h - 2 };
  map.reserved.push(hub, hall, ...Object.values(rooms));
  return placeTorches(map, 32, 6);
}

// Bone heap glyph test (EXTRA_FLOORS.bonetest): one column per candidate glyph (left to right = BONE_GLYPHS), three rows - resting on
// bare floor, resting in bone litter, and stirring - to pick the look of a bone heap (bonepile / bonestir in map.js).
const BONE_GLYPHS = ['∩', '⌂', '¤', '░', '▒', 'Ω', '∞', '"', '^', ','];
function genBoneTest(w, h) {
  const map = new GameMap(w, h);
  carveRect(map, 2, 2, w - 4, h - 4);
  map.start = { x: 3, y: h - 4 };
  BONE_GLYPHS.forEach((ch, i) => {
    TILES['boneresting' + i] = { ...TILES.bonepile, ch };
    TILES['bonestirring' + i] = { ...TILES.bonestir, ch };
    const x = 4 + i * 2;
    map.set(x, 4, 'boneresting' + i);
    for (const [dx, dy] of [[0, 0], ...DIRS]) map.set(x + dx, 8 + dy, 'bones'); // a patch of bone litter round it
    map.set(x, 8, 'boneresting' + i);
    map.set(x, 12, 'bonestirring' + i);
  });
  return placeTorches(map, 4, 4);
}

// The boss crypt (where a run starts): genCryptChambers, rebuilt (up to 10 times) until all three ways down to the
// side-floors - the Ossuary, the Goblin Warrens, the Silk Hive - made it in.
const HUB_STAIRS = ['bonestair', 'warrenstair', 'hivestair'], HUB_STAIRS_ROOMS = ['ossuarystair', 'warrenstair', 'hivestair'];
// ...and until at least one of them can be reached from the start without going through a boss room (its tiles or ring).
function genCryptHub(w, h) {
  let map;
  for (let i = 0; i < 10; i++) {
    map = genCryptChambers(w, h);
    const gated = (x, y) => map.arenas.some(a => x >= a.r.x - 1 && x <= a.r.x + a.r.w && y >= a.r.y - 1 && y <= a.r.y + a.r.h);
    const d = map.distanceFrom(map.start.x, map.start.y, (x, y) => (map.walkable(x, y) || !!TILES[map.get(x, y)].door) && !gated(x, y));
    const stairs = HUB_STAIRS.map(t => map.cells((x, y) => map.get(x, y) === t));
    if (stairs.every(c => c.length) && stairs.some(c => c.some(p => d[p.y][p.x] < Infinity))) return map;
  }
  return map;
}

// Crypt, chamber layout (test map - debug J): the floor is a grid of cells. A winding chain of chambers (the main path)
// runs from the start chamber through a trial chamber (midway) to the Lich's hall, whose sealed vault holds the stairs.
// Path chambers branch off into dead-end special rooms (CRYPT_ROOMS: burial chambers, ossuaries, shrines...).
function genCryptChambers(w, h) {
  const C = 5, R = 3, cw = Math.floor((w - 2) / C), chh = Math.floor((h - 2) / R);
  const key = (c, r) => c + ',' + r, inGrid = (c, r) => c >= 0 && r >= 0 && c < C && r < R;
  let path = [];
  for (let tries = 0; tries < 200 && path.length < 7; tries++) { // a random self-avoiding walk over the grid
    path = [{ c: rand(0, C - 1), r: rand(0, R - 1) }];
    const used = new Set([key(path[0].c, path[0].r)]);
    for (let n; path.length < 8 && (n = shuffle(DIRS.slice(0, 4)).map(([dx, dy]) => ({ c: path.at(-1).c + dx, r: path.at(-1).r + dy }))
      .find(p => inGrid(p.c, p.r) && !used.has(key(p.c, p.r))));) { path.push(n); used.add(key(n.c, n.r)); }
  }
  const map = new GameMap(w, h);
  map.noSpawn = grid(w, h, false);
  const used = new Set(path.map(p => key(p.c, p.r)));
  // A room of size rw x rh somewhere inside grid cell (c, r), on odd coordinates.
  const place = (c, r, rw, rh) => ({ x: (1 + c * cw + rand(2, Math.max(2, cw - rw - 2))) | 1, y: (1 + r * chh + rand(2, Math.max(2, chh - rh - 2))) | 1, w: rw, h: rh });
  const mid = rm => ({ x: rm.x + (rm.w >> 1), y: rm.y + (rm.h >> 1) });
  const corridor = (a, b) => orthoPath(mid(a), mid(b)).forEach(p => map.get(p.x, p.y) === 'wall' && map.set(p.x, p.y, 'floor'));

  const trialAt = path.length >> 1, last = path.length - 1;
  // Main-path roles: the four mini-boss arenas, in random order along the path (a short path leaves a random one out).
  const role = {}, roles = shuffle(['deathknight', 'wight', 'banshee', 'serpent']); // (the flooded crypt, ARENA_BUILDS.flooded, is left out for now)
  const slots = shuffle(path.map((_, i) => i).filter(i => i > 0 && i !== trialAt && i !== last));
  if (slots.length > roles.length) slots.push(...slots.splice(slots.indexOf(1), 1)); // (the chamber after the start stays plain if it can)
  slots.forEach((i, k) => { if (k < roles.length) role[i] = roles[k]; });
  // The first gate: the first boss arena or the trial chamber along the path - a way down to a side-floor must hang off
  // something before it, so a new run always has somewhere to level up first.
  const firstGate = Math.min(trialAt, ...Object.keys(role).map(Number));
  const rooms = path.map((p, i) => i === 0 ? place(p.c, p.r, 9, 7) : i === trialAt ? place(p.c, p.r, 9, 7)
    : role[i] ? place(p.c, p.r, ARENA.w, ARENA.h) : place(p.c, p.r, pick([7, 9, 11]), pick([5, 7])));
  // Boss block (11x11): the hall and its stairs vault, the vault on the side the corridor from the previous chamber
  // doesn't come in on (that corridor runs straight toward the hall's middle, so it never crosses the vault).
  const block = place(path[last].c, path[last].r, ARENA.w, ARENA.h + 4), up = mid(rooms[last - 1]).y > block.y + (ARENA.h + 4 >> 1);
  const hall = rooms[last] = { x: block.x, y: up ? block.y + 4 : block.y, w: ARENA.w, h: ARENA.h };
  const vault = { x: block.x + (ARENA.w - 5 >> 1), y: up ? block.y : block.y + ARENA.h + 1, w: 5, h: 3 };
  // Side rooms first choose their cells (off path chambers other than the trial and the boss hall). The special ones
  // come first, in this order, while free cells last; then random CRYPT_ROOMS.
  // (the three ways down to the side-floors first, so they always find a cell - genCryptHub rebuilds if one doesn't)
  const sides = [], queue = [{ name: 'ossuarystair', w: 5, h: 5 }, { name: 'warrenstair', w: 5, h: 5 }, { name: 'hivestair', w: 5, h: 5 },
    { name: 'vault', w: 5, h: 3 }, { name: 'camp', w: 9, h: 7 }, { name: 'ambush', w: 7, h: 5 }];
  const extras = CRYPT_ROOMS.filter(t => t.name !== 'ossuary').flatMap(t => Array(t.weight).fill(t)); // (the Ossuary is its own floor now)
  // Hosts: rooms a side branch can hang off - path chambers (not the trial or the boss hall), and then side rooms too
  // (deeper branches), except the vault (one way in).
  // early: before the first gate; arena: a boss room (or behind one) - no way down hangs off those.
  const hosts = path.map((cell, i) => ({ cell, room: rooms[i], early: i < firstGate, arena: !!role[i] })).filter((h, i) => i !== trialAt && i !== last);
  const freeNext = h => shuffle(DIRS.slice(0, 4)).map(([dx, dy]) => ({ c: h.cell.c + dx, r: h.cell.r + dy })).find(q => inGrid(q.c, q.r) && !used.has(key(q.c, q.r)));
  // Each special in turn goes off any host that still has a free cell beside it (a host may take several); then each
  // path chamber may get one random extra room.
  const addSide = (host, t) => {
    const n = freeNext(host);
    if (!n) return;
    used.add(key(n.c, n.r));
    const s = { from: host.room, type: t, r: place(n.c, n.r, t.w, t.h) };
    sides.push(s);
    if (t.name !== 'vault') hosts.push({ cell: n, room: s.r, side: true, early: host.early, arena: host.arena });
  };
  const earlyStair = pick(HUB_STAIRS_ROOMS); // (one of the three, at random, always before the first gate)
  for (const t of queue) {
    const fits = h => freeNext(h) && (!HUB_STAIRS_ROOMS.includes(t.name) || !h.arena) && (t.name !== earlyStair || h.early);
    const h = shuffle([...hosts]).find(fits);
    if (h) addSide(h, t);
  }
  shuffle(hosts.filter(h => !h.side)).forEach(h => chance(0.6) && addSide(h, pick(extras)));
  rooms.slice(1).forEach((rm, i) => corridor(rooms[i], rm));
  sides.forEach(s => s.type.name !== 'vault' && corridor(s.from, s.r)); // (the vault digs its own, to its door)
  rooms.forEach((rm, i) => carveRect(map, rm.x, rm.y, rm.w, rm.h, i === trialAt ? 'runefloor' : 'floor'));
  sides.forEach(s => {
    carveRect(map, s.r.x, s.r.y, s.r.w, s.r.h);
    const special = SIDE_BUILDS[s.type.name];
    if (special) special(map, s.r, s.from, mid);
    else { wallRing(map, s.r, s.type.wall); s.type.build(map, s.r); }
    // Furnishing can wall off the way in (bone niches, rubble, coffins) - and the region joiner can't dig through
    // those, so it would fill the room in. Clear the corridor's line to the room's middle.
    orthoPath(mid(s.from), mid(s.r)).forEach(p => ['bonewall', 'rubble', 'sarcophagus'].includes(map.get(p.x, p.y)) && map.set(p.x, p.y, 'floor'));
    if (!special) addDoors(map, s.r, CRYPT_DOORS);
  });

  // Start chamber: the crypt's entrance hall - checkered marble, an honour guard of statues along both long walls,
  // braziers at either end of the middle row, an engraved plaque on the wall (bump it to read the level's hints) and
  // the stairs up in the middle (loadLevel puts them on map.start). Nothing spawns in it.
  const st = rooms[0], sc = mid(st);
  for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) map.set(x, y, (x + y) % 2 ? 'marbledark' : 'marblefloor');
  for (let x = st.x + 1; x < st.x + st.w - 1; x += 2) if (x !== sc.x) { map.set(x, st.y + 1, 'statue'); map.set(x, st.y + st.h - 2, 'statue'); }
  for (const ends of [[[st.x, sc.y], [st.x, st.y], [st.x, st.y + st.h - 1]], [[st.x + st.w - 1, sc.y], [st.x + st.w - 1, st.y + st.h - 1], [st.x + st.w - 1, st.y]]])
    ends.find(([x, y]) => (edgeProp(map, st, x, y, 'brazier'), map.get(x, y) === 'brazier')); // each end: middle, else a free corner
  const plaque = [[sc.x, st.y - 1], [sc.x, st.y + st.h], [sc.x - 2, st.y - 1], [sc.x + 2, st.y + st.h]].find(([x, y]) => map.get(x, y) === 'wall');
  wallRing(map, st, 'marble');
  if (plaque) map.set(plaque[0], plaque[1], 'plaque');
  for (let y = st.y; y < st.y + st.h; y++) for (let x = st.x; x < st.x + st.w; x++) map.noSpawn[y][x] = true;
  map.start = sc;
  // Trial chamber: rune walls (the corridors in and out stay open until it seals), summoning circle and obelisks.
  const tr = rooms[trialAt];
  wallRing(map, tr, 'runewall');
  furnishTrial(map, tr);
  for (let y = tr.y; y < tr.y + tr.h; y++) for (let x = tr.x; x < tr.x + tr.w; x++) map.noSpawn[y][x] = true;
  map.trial = { r: tr, state: 'ready' };
  // Boss hall: the Lich's sanctum and the stairs vault behind its locked door (furnishLichHall).
  furnishLichHall(map, hall, vault);
  map.arenas = [];
  // Mini-boss arenas and the flooded crypt (furnished and populated by ARENA_BUILDS; nothing else spawns in them).
  // One of the mini-bosses carries the treasure vault's key, if a vault was built.
  const keyHolder = sides.some(s => s.type.name === 'vault') && pick(Object.keys(role).filter(i => role[i] !== 'flooded'));
  for (const i in role) {
    const rm = rooms[i];
    ARENA_BUILDS[role[i]](map, rm, mid(rooms[i - 1]), i === keyHolder);
    for (let y = rm.y; y < rm.y + rm.h; y++) for (let x = rm.x; x < rm.x + rm.w; x++) map.noSpawn[y][x] = true;
    if (role[i] !== 'flooded') { map.arenas.push({ r: rm, state: 'ready' }); addDoors(map, rm, 1, 'bossdoor'); } // a boss room: its own doors, and it locks behind you (arenaTick)
  }
  map.arenas.push({ r: hall, state: 'ready' }); // (the Lich's)
  addDoors(map, hall, 1, 'bossdoor');
  rooms.forEach((rm, i) => i !== trialAt && addDoors(map, rm, CRYPT_DOORS));
  map.reserved.push(...rooms, ...sides.map(s => s.r));
  // Monsters wait in the chambers and rooms, not strung along the corridors between them.
  const inRoom = (x, y) => map.reserved.some(o => x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h);
  map.cells((x, y) => map.walkable(x, y) && !inRoom(x, y)).forEach(c => { map.noSpawn[c.y][c.x] = true; });
  return map;
}

// Wall-mounted lights, kept `spacing` apart. A torch must sit in solid wall facing exactly one open side:
// only the 3 tiles in front of it may be open, so it can't be seen from behind through thin walls or corners.
function placeTorches(map, count, spacing = 6, tile = 'torch') {
  const mountable = (x, y) => {
    if (map.get(x, y) !== 'wall' || map.dark.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) return false;
    const open = DIRS.slice(0, 4).filter(([dx, dy]) => map.walkable(x + dx, y + dy));
    if (open.length !== 1) return false;
    const [fx, fy] = open[0];
    return DIRS.every(([dx, dy]) => dx * fx + dy * fy > 0 || !map.walkable(x + dx, y + dy));
  };
  const spots = shuffle(map.cells(mountable));
  const placed = [], n = scaled(count, map.w, map.h);
  for (const s of spots) {
    if (placed.length >= n) break;
    if (placed.some(t => dist(t, s) < spacing)) continue;
    map.set(s.x, s.y, tile);
    placed.push(s);
  }
  return map;
}

// map.keepOut: rects that joining tunnels must never dig into (e.g. the grotto's stairs grotto behind the boss island).
const keptOut = map => (x, y) => (map.keepOut || []).some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

// Guarantees full connectivity. Doors (even locked ones) count as connections.
// Sizeable regions cut off from the main one are joined to it by tunnelling through plain `fill` tiles
// (never special walls like granite, so vaults stay sealed); leftover tiny pockets become `fill`.
function keepLargestRegion(map, fill = 'wall', minJoin = 8) {
  const pass = (x, y) => map.walkable(x, y) || !!TILES[map.get(x, y)].door || !!TILES[map.get(x, y)].locked || !!TILES[map.get(x, y)].breakable;
  const regionOf = grid(map.w, map.h, -1), regions = [];
  for (const c of map.cells((x, y) => map.walkable(x, y))) {
    if (regionOf[c.y][c.x] >= 0) continue;
    const d = map.distanceFrom(c.x, c.y, pass);
    const cells = map.cells((x, y) => d[y][x] < Infinity);
    cells.forEach(r => (regionOf[r.y][r.x] = regions.length));
    regions.push(cells);
  }
  const main = regions.reduce((a, r, i) => (r.length > regions[a].length ? i : a), 0);
  const out = keptOut(map), inMain = (x, y) => regionOf[y]?.[x] === main;
  for (let i = 0; i < regions.length; i++) {
    if (i === main || regions[i].length < minJoin) continue;
    const path = tunnel(map, regions[i], (x, y) => inMain(x, y) && !out(x, y), fill, out);
    if (!path) continue;
    path.forEach(c => map.get(c.x, c.y) === fill && map.set(c.x, c.y, 'floor'));
    [...regions[i], ...path].forEach(c => (regionOf[c.y][c.x] = main));
  }
  map.cells((x, y) => map.walkable(x, y) && !inMain(x, y)).forEach(c => map.set(c.x, c.y, fill));
  return map;
}

// Shortest orthogonal path from any cell of `from` to a cell where isGoal(x, y), moving through
// walkable tiles or `dig` tiles (a tile name or a list; not the map border). Returns the path cells, or null.
function tunnel(map, from, isGoal, dig, blocked = () => false) {
  const prev = grid(map.w, map.h, null), q = [...from];
  from.forEach(c => (prev[c.y][c.x] = c));
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (isGoal(c.x, c.y)) {
      const path = [];
      for (let p = c; prev[p.y][p.x] !== p; p = prev[p.y][p.x]) path.push(p);
      return path;
    }
    for (const [dx, dy] of DIRS.slice(0, 4)) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1 || prev[y][x] || blocked(x, y)) continue;
      if (!map.walkable(x, y) && ![].concat(dig).includes(map.get(x, y))) continue;
      prev[y][x] = c;
      q.push({ x, y });
    }
  }
  return null;
}

// Goblin warren: rough elliptical caverns joined by wobbly dug-out tunnels (minimum spanning tree over the
// caverns plus a few loops). Records map.caverns [{ x, y, rx, ry, cells, entrances, tunnels }] for furnishWarren;
// each tunnel is its dug path, ordered outward from that cavern.
// A rough elliptical cavern centred on (x, y). Returns { x, y, rx, ry, cells, entrances, tunnels }.
function carveCavern(map, x, y, rx, ry) {
  const c = { x, y, rx, ry, cells: [], entrances: [], tunnels: [] };
  for (let j = y - ry - 1; j <= y + ry + 1; j++)
    for (let i = x - rx - 1; i <= x + rx + 1; i++)
      if (i > 0 && j > 0 && i < map.w - 1 && j < map.h - 1 && ((i - x) / rx) ** 2 + ((j - y) / ry) ** 2 <= 1 + (Math.random() - 0.5) * 0.5) {
        map.set(i, j, 'floor'); c.cells.push({ x: i, y: j });
      }
  return c;
}

// Digs a wobbly tunnel between two caverns and records it on both (entrances + tunnels ordered outward).
function linkCaverns(map, a, b) {
  const path = digTunnel(map, a, b);
  if (path.length) { a.entrances.push(path[0]); b.entrances.push(path[path.length - 1]); a.tunnels.push(path); b.tunnels.push([...path].reverse()); }
  return path;
}

function genWarren(w, h, { caverns = 12 } = {}) {
  const map = new GameMap(w, h), cavs = [], n = scaled(caverns, w, h);
  for (let tries = 0; tries < n * 60 && cavs.length < n; tries++) {
    const rx = rand(4, 8), ry = rand(3, 5), x = rand(rx + 2, w - rx - 3), y = rand(ry + 2, h - ry - 3);
    if (cavs.some(o => Math.abs(o.x - x) < o.rx + rx + 3 && Math.abs(o.y - y) < o.ry + ry + 2)) continue;
    cavs.push(carveCavern(map, x, y, rx, ry));
  }
  const edges = [], tree = [cavs[0]];
  while (tree.length < cavs.length) {
    let best = null;
    for (const a of tree) for (const b of cavs) if (!tree.includes(b) && (!best || dist(a, b) < best.d)) best = { a, b, d: dist(a, b) };
    edges.push(best); tree.push(best.b);
  }
  for (let i = 0; i < Math.ceil(cavs.length / 4); i++) { // loops: link a cavern to its second-nearest neighbour
    const a = pick(cavs), b = cavs.filter(o => o !== a).sort((p, q) => dist(p, a) - dist(q, a))[1];
    if (b) edges.push({ a, b });
  }
  for (const { a, b } of edges) linkCaverns(map, a, b);
  map.caverns = cavs;
  return map;
}

// Fungal depths: one big central cavern (with a few rock outcrops) ringed by smaller grottos. Narrow tunnels,
// choked with tangled roots, link every grotto to the centre and many to their neighbour.
function genFungal(w, h, { grottos = 9 } = {}) {
  const map = new GameMap(w, h), cx = w >> 1, cy = h >> 1;
  const center = carveCavern(map, cx, cy, Math.floor(w * 0.17), Math.floor(h * 0.22));
  for (let i = 0; i < 5; i++) blob(map, rand(cx - 12, cx + 12), rand(cy - 6, cy + 6), 7, 'wall', ['floor']);
  const ring = [];
  for (let i = 0; i < grottos; i++) {
    const a = (i / grottos) * Math.PI * 2 + (Math.random() - 0.5) * 0.4, rx = rand(5, 8), ry = rand(3, 5);
    const x = Math.max(rx + 2, Math.min(w - rx - 3, Math.round(cx + Math.cos(a) * w * 0.37)));
    const y = Math.max(ry + 2, Math.min(h - ry - 3, Math.round(cy + Math.sin(a) * h * 0.36)));
    ring.push(carveCavern(map, x, y, rx, ry));
  }
  ring.forEach((g, i) => { linkCaverns(map, g, center); if (chance(0.5)) linkCaverns(map, g, ring[(i + 1) % grottos]); });
  // Roots: long connected strands seeded along the tunnels (about one per 12 tiles); narrow tunnels steer them.
  for (const t of ring.flatMap(c => c.tunnels))
    for (let i = Math.ceil(t.length / 12); i > 0; i--) growRoot(map, pick(t), rand(6, 12));
  map.caverns = [center, ...ring];
  map.center = center;
  map.grottos = ring;
  return map;
}

// A root strand: an orthogonal walk over floor from p, mostly straight, never forming a 2x2 clump
// (so the box-drawing autotiler draws clean lines). Joins existing roots when it runs into them.
function growRoot(map, p, len) {
  const isRoot = (x, y) => map.get(x, y) === 'roots';
  const clump = (x, y) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => isRoot(x + dx, y) && isRoot(x, y + dy) && isRoot(x + dx, y + dy));
  let { x, y } = p, dir = pick(DIRS.slice(0, 4));
  if (map.get(x, y) !== 'floor' || clump(x, y)) return;
  map.set(x, y, 'roots');
  for (let i = 1; i < len; i++) {
    const opts = DIRS.slice(0, 4).filter(([dx, dy]) => map.get(x + dx, y + dy) === 'floor' && !clump(x + dx, y + dy));
    if (!opts.length) return;
    dir = opts.find(d => d === dir && chance(0.7)) || pick(opts);
    x += dir[0]; y += dir[1];
    map.set(x, y, 'roots');
  }
}

// Gives fungal grottos their roles: glowing groves guarded by sporeling clusters, a spider nest,
// a flooded root pool, a fungal shrine and the myconid village. Fungus carpets the caves; the centre gets a few dim groves
// too, and the Mycelium Heart in its middle. Puffballs (spore mines) dot the fungus.
function furnishFungal(map) {
  const reach = map.distanceFrom(map.center.x, map.center.y);
  map.caverns.forEach(c => (c.cells = c.cells.filter(p => reach[p.y][p.x] < Infinity && map.walkable(p.x, p.y))));
  const floorOf = c => c.cells.filter(p => map.get(p.x, p.y) === 'floor');
  const around = (c, k, monster) => shuffle(c.cells.filter(p => dist(p, c) >= 2)).slice(0, k).forEach(p => map.spawns.push({ ...p, monster }));
  // Fungus grows in a few distinct patches (more in the big central cavern), leaving clear floor between them.
  map.caverns.forEach(c => { for (let i = c === map.center ? 6 : rand(1, 2); i > 0; i--) { const s = pick(floorOf(c)); if (s) blob(map, s.x, s.y, c === map.center ? 12 : 6, 'fungus', ['floor']); } });
  const grove = (c, shrooms) => shuffle(floorOf(c)).slice(0, shrooms).forEach(p => map.set(p.x, p.y, 'glowshroom'));
  const [g1, g2, g3, nest, pool, shrine, village] = shuffle(map.grottos);

  // Glowing groves: purple light, three sporelings guarding each.
  for (const c of [g1, g2, g3]) { grove(c, 4); around(c, 3, 'spore'); }
  grove(map.center, 3);
  // Spider nest: webs, bones, spiders and a web spinner.
  floorOf(nest).forEach(p => map.set(p.x, p.y, chance(0.6) ? 'web' : chance(0.15) ? 'bones' : map.get(p.x, p.y)));
  around(nest, 3, 'spider'); around(nest, 1, 'webspinner');
  // Flooded root pool: dark water in the middle, shallows and roots round the edge, loot at the water's edge.
  for (const p of pool.cells) {
    const e = ((p.x - pool.x) / pool.rx) ** 2 + ((p.y - pool.y) / pool.ry) ** 2;
    map.set(p.x, p.y, e < 0.3 ? 'water' : e < 0.6 ? 'shallow' : 'floor');
  }
  for (let i = 0; i < 4; i++) { const s = pick(floorOf(pool)); if (s) growRoot(map, s, rand(5, 9)); }
  shuffle(pool.cells.filter(p => map.get(p.x, p.y) === 'shallow')).slice(0, 2).forEach(p => map.loot.push({ ...p }));
  // Fungal shrine: a restoring altar ringed by glowing mushrooms, two myconids keeping watch.
  map.set(shrine.x, shrine.y, 'altar');
  DIRS.filter(([dx, dy]) => dx && dy).forEach(([dx, dy]) => map.walkable(shrine.x + 2 * dx, shrine.y + 2 * dy) && map.set(shrine.x + 2 * dx, shrine.y + 2 * dy, 'glowshroom'));
  around(shrine, 2, 'myconid');
  // Myconid village: giant mushroom caps (bigcap - they block the way, like huts) round a clearing of fungus, the elder in
  // the middle healing his kin, myconids about, a stash of fungal gear.
  if (village) {
    floorOf(village).forEach(p => map.set(p.x, p.y, 'fungus'));
    shuffle(village.cells.filter(p => dist(p, village) >= 2 && DIRS.slice(0, 4).some(([dx, dy]) => map.get(p.x + dx, p.y + dy) === 'wall')))
      .slice(0, 5).forEach(p => map.set(p.x, p.y, 'bigcap'));
    map.spawns.push({ x: village.x, y: village.y, monster: 'myconidelder' });
    around(village, 3, 'myconid');
    const s = pick(village.cells.filter(p => map.get(p.x, p.y) === 'fungus' && dist(p, village) === 1));
    if (s) map.loot.push({ ...s, rarity: 'magic', pool: 'fungal' });
  }
  // The Mycelium Heart: rooted in the middle of the great central cavern, a ring of roots round it (BOSS_PATTERNS.myceliumheart).
  const open = p => [[0, 0], ...DIRS].every(([dx, dy]) => map.walkable(p.x + dx, p.y + dy)); // (the cavern's middle may be in a rock outcrop)
  const heart = map.center.cells.filter(open).sort((a, b) => dist(a, map.center) - dist(b, map.center))[0] || map.center;
  for (let i = 0; i < 6; i++) growRoot(map, { x: heart.x + rand(-2, 2), y: heart.y + rand(-2, 2) }, rand(4, 8));
  map.set(heart.x, heart.y, 'floor');
  map.spawns.unshift({ x: heart.x, y: heart.y, monster: 'myceliumheart' });
  // Puffballs: spore mines on the fungus (puffball onEnter / onMonster: a lingering spore cloud, map.spores - tickSpores).
  shuffle(map.cells((x, y) => map.get(x, y) === 'fungus' && dist({ x, y }, heart) > 3)).slice(0, scaled(14, map.w, map.h)).forEach(p => map.set(p.x, p.y, 'puffball'));
  for (const c of [g1, g2, g3, nest, pool, shrine, village].filter(Boolean)) map.reserved.push(cavernBox(c));
  return map;
}

// Cells from a to b in orthogonal steps only (a staircase, never a diagonal squeeze - see GameMap.canStep).
function orthoPath(a, b) {
  const out = [{ x: a.x, y: a.y }];
  let { x, y } = a;
  while (x !== b.x || y !== b.y) {
    if (Math.abs(b.x - x) >= Math.abs(b.y - y)) x += Math.sign(b.x - x);
    else y += Math.sign(b.y - y);
    out.push({ x, y });
  }
  return out;
}
// Elliptical "distance" of a point from a cavern's centre: 0 at the centre, 1 at its rim.
const ellipse = (c, p) => ((p.x - c.x) / c.rx) ** 2 + ((p.y - c.y) / c.ry) ** 2;

// Flooded grotto: warren-style caverns and tunnels cut across by an underground river (deep water, shallow banks)
// that you cross at fords and a rope bridge. The roomiest cavern away from the river becomes a lake: a tidal causeway
// leads to the boss's island, and a second one on to the stairs grotto (addStairGrotto). Sets map.stairs, map.bossSpot,
// map.lake, map.keepOut.
function genGrotto(w, h) {
  const map = genWarren(w, h, { caverns: 12 });
  const river = []; // per column { x, y0, y1 }
  let y = rand(h * 0.35 | 0, h * 0.65 | 0);
  for (let x = 1; x < w - 1; x++) {
    y = Math.max(5, Math.min(h - 8, y + rand(-1, 1)));
    const c = { x, y0: y, y1: y + (chance(0.3) ? 2 : 1) };
    for (let j = c.y0; j <= c.y1; j++) map.set(x, j, 'water');
    river.push(c);
  }
  for (const c of river) for (const j of [c.y0 - 1, c.y1 + 1]) if (map.get(c.x, j) === 'floor') map.set(c.x, j, 'shallow');
  // Crossings, each dug through the rock on both banks until it meets open ground: two shallow fords and a rope
  // bridge always, plus two low-tide fords (tidal flats across the river) as shortcuts.
  const at = f => river[Math.max(0, Math.min(river.length - 1, Math.round(f * w) + rand(-2, 2)))];
  const crossings = shuffle(['shallow', 'shallow', 'bridge']).map((tile, i) => ({ c: at([0.15, 0.5, 0.85][i]), tile }))
    .concat([0.32, 0.68].map(f => ({ c: at(f), tile: 'tideflat' })));
  for (const { c, tile } of crossings) {
    const ext = tile === 'tideflat' ? 1 : 0; // tidal fords span the banks too
    for (let j = c.y0 - ext; j <= c.y1 + ext; j++) map.set(c.x, j, tile);
    for (const dir of [-1, 1])
      for (let j = dir < 0 ? c.y0 - ext - 1 : c.y1 + ext + 1; j > 0 && j < h - 1 && !map.walkable(c.x, j); j += dir) map.set(c.x, j, 'floor');
  }
  // Lake: the roomiest cavern whose centre is well clear of the river, re-carved larger.
  const riverY = x => river[Math.max(0, Math.min(river.length - 1, x - 1))].y0;
  const clear = map.caverns.filter(c => Math.abs(c.y - riverY(c.x)) >= 9);
  const old = (clear.length ? clear : map.caverns).reduce((a, b) => (b.rx * b.ry > a.rx * a.ry ? b : a));
  const rx = 9, ry = 6, lx = Math.max(rx + 2, Math.min(w - rx - 3, old.x)), ly = Math.max(ry + 2, Math.min(h - ry - 3, old.y));
  const lake = carveCavern(map, lx, ly, rx, ry);
  lake.entrances = old.entrances;
  map.caverns[map.caverns.indexOf(old)] = lake;
  for (const p of lake.cells) {
    const e = ellipse(lake, p);
    map.set(p.x, p.y, e < 0.14 ? 'floor' : e < 0.62 ? 'water' : e < 0.8 ? 'shallow' : 'floor');
  }
  map.lake = lake;
  map.bossSpot = { x: lake.x, y: lake.y }; // the island is the boss's lair
  map.reserved.push(cavernBox(lake));
  const kx = Math.round(rx * 0.6), ky = Math.round(ry * 0.6);
  map.keepOut = [{ x: lake.x - kx, y: lake.y - ky, w: 2 * kx + 1, h: 2 * ky + 1 }]; // island + deep water: no joining fords
  // The stairs grotto lies on the far side from the nearest tunnel mouth; the first causeway runs to that mouth.
  const shore = [...lake.entrances].sort((a, b) => dist(a, lake) - dist(b, lake))[0] || lake.cells.reduce((a, b) => (ellipse(lake, b) > ellipse(lake, a) ? b : a));
  map.stairs = addStairGrotto(map, lake, shore) || { x: lake.x + (shore.x < lake.x ? 1 : -1), y: lake.y }; // fallback: on the island
  map.set(map.stairs.x, map.stairs.y, 'floor');
  // First causeway, island to the tunnel mouth: tidal inside the lake, dug through any rock between shore and tunnel.
  // If the re-carved lake swallowed the mouth, run to the shore in its direction instead (the tunnel meets the shore there).
  const e0 = ellipse(lake, shore), k = Math.sqrt(0.9 / Math.max(e0, 0.01));
  const end = e0 >= 0.9 ? shore : { x: Math.round(lake.x + (shore.x - lake.x) * k), y: Math.round(lake.y + (shore.y - lake.y) * k) };
  orthoPath(lake, end).forEach(p => {
    const e = ellipse(lake, p);
    if (e >= 0.14 && e < 0.8) map.set(p.x, p.y, 'tideflat');
    else if (e >= 0.8 && !map.walkable(p.x, p.y)) map.set(p.x, p.y, 'floor');
  });
  // Drowned ones lurk in the river and the lake.
  const deep = map.cells((x, y) => map.get(x, y) === 'water');
  shuffle(deep).slice(0, scaled(6, w, h)).forEach(p => map.spawns.push({ ...p, monster: 'drowned' }));
  return map;
}

// The stairs down: a small grotto sealed in the rock beyond the lake, reached only by a second tidal causeway from
// the island - so the way down leads past the island's boss (fight, or sneak by at low tide). On that side the lake
// runs deep right up to the rock, so there is no shore to walk around. Returns the stairs spot, or null if no room.
function addStairGrotto(map, lake, shore) {
  const key = p => p.x + ',' + p.y, inLake = new Set(lake.cells.map(key)), lakeCell = p => inLake.has(key(p));
  const away = Math.atan2(lake.y - shore.y, lake.x - shore.x);
  for (let tries = 0; tries < 150; tries++) {
    // Far side from the first causeway; later tries swing round further (still >= 1.2 rad from the causeway's direction).
    const a = away + (Math.random() - 0.5) * (tries < 75 ? 2.4 : 3.8), rx = tries < 75 ? 3 : 2, ry = 2;
    const x = lake.x + Math.round(Math.cos(a) * (lake.rx + rx + rand(2, 6))), y = lake.y + Math.round(Math.sin(a) * (lake.ry + ry + rand(2, 5)));
    if (x - rx - 2 < 1 || y - ry - 2 < 1 || x + rx + 2 > map.w - 2 || y + ry + 2 > map.h - 2) continue;
    if (lake.cells.some(p => Math.abs(p.x - x) <= rx + 1 && Math.abs(p.y - y) <= ry + 1)) continue; // keep clear of the lake
    const grotto = carveCavern(map, x, y, rx, ry), inGrotto = new Set(grotto.cells.map(key));
    const toward = p => { const d = Math.atan2(p.y - lake.y, p.x - lake.x) - a; return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); };
    lake.cells.forEach(p => toward(p) < 0.9 && ellipse(lake, p) >= 0.14 && map.set(p.x, p.y, 'water')); // deep right up to the rock
    const channel = orthoPath(lake, { x, y }).filter(p => ellipse(lake, p) >= 0.14 && !inGrotto.has(key(p)));
    channel.forEach(p => map.set(p.x, p.y, 'tideflat'));
    // Seal it off: nothing walkable may touch the grotto or the channel (past the island's edge) except each other.
    const inChannel = new Set(channel.map(key)), own = p => inChannel.has(key(p)) || inGrotto.has(key(p));
    const edge = [...grotto.cells, ...channel.filter(c => ellipse(lake, c) >= 0.4)];
    for (const c of edge) for (const [dx, dy] of DIRS) {
      const n = { x: c.x + dx, y: c.y + dy };
      if (!own(n) && (map.walkable(n.x, n.y) || TILES[map.get(n.x, n.y)].door)) map.set(n.x, n.y, lakeCell(n) ? 'water' : 'wall');
    }
    map.caverns.forEach(c => (c.cells = c.cells.filter(p => !inGrotto.has(key(p))))); // special rooms stay out
    map.reserved.push(cavernBox(grotto));
    map.keepOut.push(cavernBox(grotto), ...channel.map(c => ({ x: c.x - 1, y: c.y - 1, w: 3, h: 3 })));
    return { x, y };
  }
  return null;
}

// Joins every sizeable walkable region to the one holding map.stairs, digging a path through the tiles in `fords`
// (tile -> what it becomes: by default rock -> floor, deep water -> a shallow ford): rivers, pools and bogs can cut
// land off, which keepLargestRegion can't fix.
function joinAcrossWater(map, minJoin = 8, fords = { wall: 'floor', water: 'shallow' }) {
  const pass = (x, y) => map.walkable(x, y) || !!TILES[map.get(x, y)].door;
  const done = grid(map.w, map.h, false);
  let main = map.distanceFrom(map.stairs.x, map.stairs.y, pass);
  for (const c of map.cells((x, y) => map.walkable(x, y))) {
    if (main[c.y][c.x] < Infinity || done[c.y][c.x]) continue;
    const d = map.distanceFrom(c.x, c.y, pass), region = map.cells((x, y) => d[y][x] < Infinity);
    region.forEach(r => (done[r.y][r.x] = true));
    if (region.length < minJoin) continue; // tiny pockets are filled in later by keepLargestRegion
    const out = keptOut(map);
    const path = tunnel(map, region, (x, y) => main[y][x] < Infinity && !out(x, y), Object.keys(fords), out) || [];
    path.forEach(p => { const to = fords[map.get(p.x, p.y)]; if (to) map.set(p.x, p.y, to); });
    main = map.distanceFrom(map.stairs.x, map.stairs.y, pass);
  }
  return map;
}

// Tidal cave: a small sandy grotto sealed in the rock beside cavern `from`, reached only by a channel of tidal
// flats (open at low tide, drowned at high tide). Holds a rare find and a lesser one. Returns true if placed.
function addTidalCave(map, from) {
  for (let tries = 0; tries < 60; tries++) {
    const a = Math.random() * Math.PI * 2, rx = rand(3, 4), ry = rand(2, 3);
    const x = from.x + Math.round(Math.cos(a) * (from.rx + rx + rand(4, 6))), y = from.y + Math.round(Math.sin(a) * (from.ry + ry + rand(3, 5)));
    if (x - rx - 2 < 1 || y - ry - 2 < 1 || x + rx + 2 > map.w - 2 || y + ry + 2 > map.h - 2) continue;
    let solid = true;
    for (let j = y - ry - 2; j <= y + ry + 2 && solid; j++) for (let i = x - rx - 2; i <= x + rx + 2; i++) if (map.get(i, j) !== 'wall') { solid = false; break; }
    if (!solid) continue;
    const cave = carveCavern(map, x, y, rx, ry);
    cave.cells.forEach(p => map.set(p.x, p.y, 'sand'));
    for (const p of orthoPath(cave, from).slice(1)) { // channel: tidal flats through the rock until it meets open ground
      if (map.walkable(p.x, p.y) && !cave.cells.some(c => c.x === p.x && c.y === p.y)) break;
      if (map.get(p.x, p.y) === 'wall') map.set(p.x, p.y, 'tideflat');
    }
    const [a1, a2] = shuffle(cave.cells);
    map.loot.push({ ...a1, rarity: 'rare' }, { ...a2, rarity: 'magic' });
    map.reserved.push(cavernBox(cave));
    map.caverns.push(Object.assign(cave, { tidal: true })); // (furnishGrotto puts clams in it)
    return true;
  }
  return false;
}

// Grotto special caverns: a crab nest on a sandbar, a half-sunken shrine, a drowned adventurers' camp, a glowing pool and
// the smugglers' cove. Each claims one cavern (not the lake). Giant clams (pry them open) in the nest and the tidal caves.
function furnishGrotto(map) {
  const floorOf = c => c.cells.filter(p => map.get(p.x, p.y) === 'floor');
  const heart = c => floorOf(c).reduce((a, b) => (dist(b, c) < dist(a, c) ? b : a), floorOf(c)[0]);
  const around = (c, k, monster) => shuffle(floorOf(c).filter(p => dist(p, c) >= 2)).slice(0, k).forEach(p => map.spawns.push({ ...p, monster }));
  const [nest, shrine, camp, pool, cove] = shuffle(map.caverns.filter(c => c !== map.lake && floorOf(c).length >= 14));
  const clams = (c, n) => shuffle(c.cells.filter(p => map.get(p.x, p.y) === 'sand' && DIRS.every(([dx, dy]) => map.get(p.x + dx, p.y + dy) !== 'clam')))
    .slice(0, n).forEach(p => map.set(p.x, p.y, 'clam')); // giant clams (TILES.clam.onBump: pry one open)
  // Crab nest: a sandbar ringed by shallows at the walls, crabs guarding a find.
  if (nest) {
    for (const p of floorOf(nest)) map.set(p.x, p.y, DIRS.slice(0, 4).some(([dx, dy]) => map.get(p.x + dx, p.y + dy) === 'wall') ? 'shallow' : 'sand');
    around(nest, 3, 'crab');
    const s = pick(nest.cells.filter(p => map.get(p.x, p.y) === 'sand'));
    if (s) map.loot.push({ ...s, rarity: 'magic' });
    clams(nest, 2);
    map.reserved.push(cavernBox(nest));
  }
  // Sunken shrine: a restoring altar on a flooded floor, two deep pools with drowned ones in them.
  const h = shrine && heart(shrine);
  if (h) {
    floorOf(shrine).forEach(p => ellipse(shrine, p) < 0.7 && map.set(p.x, p.y, 'shallow'));
    map.set(h.x, h.y, 'altar');
    shuffle(shrine.cells.filter(p => map.get(p.x, p.y) === 'shallow' && dist(p, h) >= 3)).slice(0, 2).forEach(p => {
      blob(map, p.x, p.y, 5, 'water', ['shallow']);
      map.set(p.x, p.y, 'water');
      map.spawns.push({ ...p, monster: 'drowned' });
    });
    map.reserved.push(cavernBox(shrine));
  }
  // Drowned camp: a cold campfire, bedrolls and bones, half the camp under water, the dead still guarding their loot.
  const f = camp && heart(camp);
  if (f) {
    map.set(f.x, f.y, 'ashes');
    const spots = shuffle(floorOf(camp).filter(p => dist(p, f) <= 3 && dist(p, f) >= 1));
    spots.slice(0, 3).forEach(p => map.set(p.x, p.y, 'straw'));
    spots.slice(3, 6).forEach(p => map.set(p.x, p.y, 'bones'));
    spots.slice(6, 9).forEach((p, i) => map.loot.push({ ...p, rarity: i === 0 ? 'rare' : 'magic' }));
    floorOf(camp).forEach(p => p.x > f.x && chance(0.7) && map.set(p.x, p.y, 'shallow'));
    around(camp, 3, 'drowned');
    map.reserved.push(cavernBox(camp));
  }
  // Glowing pool: bioluminescent water lights the cave; toads on the shore, something beneath the glow.
  const g = pool && heart(pool);
  if (g) {
    const c = { x: g.x, y: g.y, rx: pool.rx, ry: pool.ry };
    floorOf(pool).forEach(p => { const e = ellipse(c, p); if (e < 0.3) map.set(p.x, p.y, 'glowwater'); else if (e < 0.55) map.set(p.x, p.y, 'shallow'); });
    map.set(g.x, g.y, 'glowwater');
    map.spawns.push({ ...g, monster: 'drowned' });
    around(pool, 2, 'toad');
    const s = pick(pool.cells.filter(p => map.get(p.x, p.y) === 'shallow'));
    if (s) map.loot.push({ ...s });
    map.reserved.push(cavernBox(pool));
  }
  // Smugglers' cove: their hideout - sand underfoot, crates and barrels stacked along the walls, a strongbox in the middle
  // (TILES.strongbox.onBump: a rare piece of coral gear) and the crew round it.
  const k = cove && heart(cove);
  if (k) {
    floorOf(cove).forEach(p => map.set(p.x, p.y, 'sand'));
    shuffle(cove.cells.filter(p => map.get(p.x, p.y) === 'sand' && dist(p, k) >= 2 && DIRS.slice(0, 4).some(([dx, dy]) => map.get(p.x + dx, p.y + dy) === 'wall')))
      .slice(0, 6).forEach((p, i) => map.set(p.x, p.y, i % 2 ? 'barrel' : 'crate'));
    map.set(k.x, k.y, 'strongbox');
    shuffle(cove.cells.filter(p => map.get(p.x, p.y) === 'sand' && dist(p, k) >= 1 && dist(p, k) <= 3)).slice(0, 4)
      .forEach((p, i) => map.spawns.push({ ...p, monster: i < 2 ? 'smuggler' : 'smugglerbow' }));
    map.reserved.push(cavernBox(cove));
  }
  // One or two tidal caves off ordinary caverns (clams in them), and crabs foraging out on the tidal flats.
  let caves = rand(1, 2);
  for (const c of shuffle(map.caverns.filter(c => ![map.lake, nest, shrine, camp, pool, cove].includes(c)))) if (caves && addTidalCave(map, c)) caves--;
  map.caverns.filter(c => c.tidal).forEach(c => clams(c, 2));
  shuffle(map.cells((x, y) => map.get(x, y) === 'tideflat')).slice(0, 2).forEach(p => map.spawns.push({ ...p, monster: 'crab' }));
  return joinAcrossWater(map);
}

// Wobbly tunnel from a to b: mostly steps toward the target, sometimes wanders. Returns the newly dug cells.
function digTunnel(map, a, b) {
  let x = a.x, y = a.y;
  const path = [];
  for (let i = 0; i < 600 && (x !== b.x || y !== b.y); i++) {
    const ax = Math.abs(b.x - x), ay = Math.abs(b.y - y);
    const step = chance(0.25) ? pick(DIRS.slice(0, 4)) : chance(ax / (ax + ay)) ? [Math.sign(b.x - x), 0] : [0, Math.sign(b.y - y)];
    const nx = x + step[0], ny = y + step[1];
    if (nx < 1 || ny < 1 || nx >= map.w - 1 || ny >= map.h - 1) continue;
    x = nx; y = ny;
    if (map.get(x, y) !== 'floor') { map.set(x, y, 'floor'); path.push({ x, y }); }
  }
  return path;
}

// A 1-wide gap (walls on two opposite sides, floor on the other two) - where a door fits.
const isGap = (map, x, y) => map.walkable(x, y) && (
  (!map.walkable(x - 1, y) && !map.walkable(x + 1, y) && map.walkable(x, y - 1) && map.walkable(x, y + 1)) ||
  (!map.walkable(x, y - 1) && !map.walkable(x, y + 1) && map.walkable(x - 1, y) && map.walkable(x + 1, y)));

const cavernBox = c => ({ x: c.x - c.rx - 1, y: c.y - c.ry - 1, w: c.rx * 2 + 3, h: c.ry * 2 + 3 });

// Gives warren caverns their roles: the chief's throne room (stairs, carpet, braziers, boss + guards),
// campfire halls (one with the alarm gong), a wolf kennel, a mushroom farm, a mine, a prison pen and a loot hoard
// behind doors. Hidden traps go in the tunnels; some other tunnel mouths get doors. Sets map.gongs.
// alarms: the alarm gong and tripwires (off for now - they made the first dungeon floor too hard).
function furnishWarren(map, { alarms = false } = {}) {
  const reach = map.distanceFrom(map.caverns[0].x, map.caverns[0].y); // cavern centres are all linked by tunnels
  map.caverns.forEach(c => (c.cells = c.cells.filter(p => reach[p.y][p.x] < Infinity))); // drop cut-off edge bits
  const cavs = [...map.caverns].sort((a, b) => b.cells.length - a.cells.length);
  const [throne] = cavs, hoard = cavs[cavs.length - 1], prison = cavs[cavs.length - 2];
  const rest = shuffle(cavs.slice(1, -2));
  const edgeCell = c => pick(c.cells.filter(p => map.get(p.x, p.y) === 'floor' && dist(p, c) >= 2 &&
    DIRS.slice(0, 4).some(([dx, dy]) => !map.walkable(p.x + dx, p.y + dy))));
  map.gongs = [];
  const addGong = c => { const p = edgeCell(c); if (p) { map.set(p.x, p.y, 'gong'); map.gongs.push(p); } };
  const around = (c, k, monster) => shuffle(c.cells.filter(p => dist(p, c) >= 2)).slice(0, k)
    .forEach(p => map.spawns.push({ ...p, monster }));

  // Throne room: stairs at the far end from its first entrance, a red carpet leading up, chief in front.
  const door = throne.entrances[0] || throne;
  const stairs = throne.cells.reduce((a, b) => (dist(b, door) > dist(a, door) ? b : a));
  line(door.x, door.y, stairs.x, stairs.y).forEach(p => map.get(p.x, p.y) === 'floor' && map.set(p.x, p.y, 'carpet'));
  map.set(stairs.x, stairs.y, 'stairs');
  map.stairs = stairs;
  map.bossSpot = line(stairs.x, stairs.y, throne.x, throne.y).find(p => dist(p, stairs) === 2) || throne;
  shuffle(throne.cells.filter(p => map.get(p.x, p.y) === 'floor' && dist(p, stairs) >= 2 && dist(p, map.bossSpot) >= 2))
    .slice(0, 2).forEach(p => map.set(p.x, p.y, 'brazier'));
  map.spawns.push(...shuffle(throne.cells.filter(p => dist(p, map.bossSpot) === 1)).slice(0, 2).map(p => ({ ...p, monster: 'goblin' })));
  map.reserved.push(cavernBox(throne));

  // Campfire halls: a fire in the middle with goblins gathered round.
  rest.splice(0, 2).forEach((c, i) => {
    map.set(c.x, c.y, 'campfire');
    around(c, 2, 'goblin'); around(c, 1, 'shaman');
    if (i === 0 && alarms) addGong(c); // one alarm gong per warren
    map.reserved.push(cavernBox(c));
  });
  // Kennel: wolves among gnawed bones.
  for (const c of rest.splice(0, 1)) {
    c.cells.forEach(p => chance(0.25) && map.set(p.x, p.y, 'bones'));
    around(c, 3, 'wolf');
    map.reserved.push(cavernBox(c));
  }
  // Mushroom farm: fungus beds lit by glowing mushrooms, Glowcaps to pick, a goblin farmer.
  for (const c of rest.splice(0, 1)) {
    c.cells.forEach(p => chance(0.4) && map.set(p.x, p.y, 'fungus'));
    shuffle(c.cells).slice(0, 3).forEach(p => map.set(p.x, p.y, 'glowshroom'));
    shuffle(c.cells.filter(p => map.walkable(p.x, p.y))).slice(0, 4).forEach(p => map.loot.push({ ...p, item: 'Glowcap Mushroom' }));
    around(c, 1, 'goblin');
    map.reserved.push(cavernBox(c));
  }
  // Mine: ore veins in the walls, a couple of goblin miners.
  for (const c of rest.splice(0, 1)) {
    const walls = [...new Set(c.cells.flatMap(p => DIRS.slice(0, 4).map(([dx, dy]) => (p.x + dx) + ',' + (p.y + dy))))]
      .map(k => k.split(',').map(Number)).filter(([x, y]) => map.get(x, y) === 'wall' && x > 1 && y > 1 && x < map.w - 2 && y < map.h - 2);
    shuffle(walls).slice(0, 8).forEach(([x, y]) => map.set(x, y, 'ore'));
    around(c, 2, 'goblin');
    map.reserved.push(cavernBox(c));
  }
  // Door in the first proper doorway within a few tiles of where a tunnel leaves the cavern.
  const doorway = t => t.slice(0, 6).find(p => isGap(map, p.x, p.y));
  // Hoard: every tunnel into it gets a door; loot piles inside.
  hoard.tunnels.map(doorway).forEach(p => p && map.set(p.x, p.y, 'door'));
  shuffle(hoard.cells).slice(0, 4).forEach((p, i) => map.loot.push({ ...p, rarity: i === 0 ? 'rare' : 'magic' }));
  map.reserved.push(cavernBox(hoard));
  // Prison pen: dark, shut behind doors, straw and shackles, a barred cell in the middle holding a captive
  // adventurer (joins you) or a caged troll (turns on the goblins). The jailer outside the cell has the key.
  prison.tunnels.map(doorway).forEach(p => p && map.set(p.x, p.y, 'door'));
  prison.cells.forEach(p => map.get(p.x, p.y) === 'floor' && chance(0.3) && map.set(p.x, p.y, 'straw'));
  const cell = { x: prison.x, y: prison.y };
  for (const [dx, dy] of DIRS) map.set(cell.x + dx, cell.y + dy, 'bars');
  map.set(cell.x, cell.y, 'floor');
  const side = shuffle(DIRS.slice(0, 4)).find(([dx, dy]) => map.walkable(cell.x + 2 * dx, cell.y + 2 * dy)) || [0, 1];
  const cellDoor = { x: cell.x + side[0], y: cell.y + side[1] };
  map.set(cellDoor.x, cellDoor.y, 'cellDoor');
  if (!map.walkable(cell.x + 2 * side[0], cell.y + 2 * side[1])) map.set(cell.x + 2 * side[0], cell.y + 2 * side[1], 'floor');
  map.spawns.push(chance(0.5) ? { ...cell, template: makeCaptive(pick(CLASSES.filter(c => !c.playerOnly))) } : { ...cell, monster: 'cagedtroll' });
  map.spawns.push({ x: cell.x + 2 * side[0], y: cell.y + 2 * side[1], monster: 'jailer' });
  const penWalls = [...new Set(prison.cells.flatMap(p => DIRS.slice(0, 4).map(([dx, dy]) => (p.x + dx) + ',' + (p.y + dy))))]
    .map(k => k.split(',').map(Number)).filter(([x, y]) => map.get(x, y) === 'wall');
  shuffle(penWalls).slice(0, 3).forEach(([x, y]) => map.set(x, y, 'chains'));
  map.reserved.push(cavernBox(prison));
  map.dark.push(cavernBox(prison));
  // Hidden traps along the tunnels.
  const tunnelCells = cavs.flatMap(c => c.tunnels.flat()).filter(p => map.get(p.x, p.y) === 'floor');
  shuffle(tunnelCells).slice(0, scaled(14, map.w, map.h))
    .forEach(p => map.set(p.x, p.y, pick(['spikeTrap', 'spikeTrap', 'snareTrap', ...(alarms ? ['tripwire'] : [])])));
  // Other tunnel mouths: sometimes a door.
  for (const c of cavs) if (c !== hoard && c !== prison) c.tunnels.forEach(t => { const p = chance(0.25) && doorway(t); if (p) map.set(p.x, p.y, 'door'); });
  return map;
}

// Cellular-automata caves.
function genCaves(w, h, { fill = 0.45, steps = 5 } = {}) {
  const map = new GameMap(w, h);
  map.cells((x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1)
    .forEach(c => map.set(c.x, c.y, chance(fill) ? 'wall' : 'floor'));
  for (let s = 0; s < steps; s++) {
    const next = map.tiles.map(row => row.slice());
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let walls = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) walls += map.get(x + i, y + j) === 'wall';
        next[y][x] = walls >= 5 ? 'wall' : 'floor';
      }
    map.tiles = next;
  }
  return map;
}

// Recursive-backtracker maze on a grid of cells `spacing` tiles apart (2 = classic dense maze, 3+ = thicker walls),
// braided with `loops` extra connections and a few small chambers. `sparse` passes then trim dead-end tiles,
// leaving fewer corridors and more solid rock.
function genMaze(w, h, { chambers = 10, loops = 150, spacing = 2, sparse = 0 } = {}) {
  chambers = scaled(chambers, w, h); loops = scaled(loops, w, h);
  const map = new GameMap(w, h);
  const cols = Math.floor((w - 3) / spacing) + 1, rows = Math.floor((h - 3) / spacing) + 1;
  const at = (i, j) => ({ x: 1 + i * spacing, y: 1 + j * spacing });
  const link = (a, b) => { // carve from cell a to neighbouring cell b
    const pa = at(a.i, a.j), pb = at(b.i, b.j);
    carveRect(map, Math.min(pa.x, pb.x), Math.min(pa.y, pb.y), Math.abs(pa.x - pb.x) + 1, Math.abs(pa.y - pb.y) + 1);
  };
  const neighbours = c => DIRS.slice(0, 4).map(([dx, dy]) => ({ i: c.i + dx, j: c.j + dy }))
    .filter(n => n.i >= 0 && n.j >= 0 && n.i < cols && n.j < rows);
  const visited = grid(cols, rows, false), stack = [{ i: 0, j: 0 }];
  visited[0][0] = true;
  map.set(1, 1, 'floor');
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const next = shuffle(neighbours(cur)).find(n => !visited[n.j][n.i]);
    if (!next) { stack.pop(); continue; }
    visited[next.j][next.i] = true;
    link(cur, next);
    stack.push(next);
  }
  for (let i = 0; i < loops; i++) { const c = { i: rand(0, cols - 1), j: rand(0, rows - 1) }; link(c, pick(neighbours(c))); }
  for (let i = 0; i < chambers; i++) carveRect(map, rand(1, w - 8) | 1, rand(1, h - 6) | 1, 5, 3);
  for (let pass = 0; pass < sparse; pass++) // dead end = floor with exactly one open orthogonal neighbour
    map.cells((x, y) => map.walkable(x, y) && DIRS.slice(0, 4).filter(([dx, dy]) => map.walkable(x + dx, y + dy)).length === 1)
      .forEach(c => map.set(c.x, c.y, 'wall'));
  return map;
}

// Huge pillared hall with broken inner walls.
function genHall(w, h) {
  const map = new GameMap(w, h);
  carveRect(map, 2, 2, w - 4, h - 4);
  for (let y = 4; y < h - 4; y += 4)
    for (let x = 4; x < w - 4; x += 5) if (chance(0.7)) carveRect(map, x, y, 2, 1, 'wall');
  for (let i = 0, n = scaled(16, w, h); i < n; i++) {
    const vertical = chance(0.5), len = rand(4, 10);
    carveRect(map, rand(3, w - 12), rand(3, h - 12), vertical ? 1 : len, vertical ? len : 1, 'wall');
  }
  return map;
}

// Swamp overworld: firm ground and black bog in natural blobs, joined by boardwalks. Mangrove clumps,
// reeds along the banks (block sight), mud (slow) hiding patches of quicksand, lily pads and moss.
// Places: the sunken ruin holding the dungeon entrance (guarded), the fishermen's camp where you start (map.start),
// a leech pool with a treasure cache on its islet, a bandit camp, the bog witch's hut (addWitchHut) and the Mire Mother's
// pool (addMireLair). Rotten boardwalk planks (rotboard), swamp-gas vents at the water's edge. Will-o'-wisps and fireflies
// drift about as lights; the mist rolls in and out (level.mist).
function genSwamp(w, h) {
  const map = genCaves(w, h, { fill: 0.47 }); // CA blobs: 'wall' becomes bog, 'floor' stays firm ground
  map.cells((x, y) => map.get(x, y) === 'wall').forEach(c => map.set(c.x, c.y, 'bog'));
  map.cells((x, y) => !x || !y || x === w - 1 || y === h - 1).forEach(c => map.set(c.x, c.y, 'tree'));
  const floors = () => map.cells((x, y) => map.get(x, y) === 'floor');
  const nextTo = (x, y, t) => DIRS.slice(0, 4).some(([dx, dy]) => map.get(x + dx, y + dy) === t);
  decorate(map, 'tree', 45, 12, ['floor']); // mangrove clumps
  decorate(map, 'mud', 14, 20, ['floor']);
  map.cells((x, y) => map.get(x, y) === 'mud').forEach(c => chance(0.06) && map.set(c.x, c.y, 'quicksand'));
  decorate(map, 'moss', 16, 16, ['floor']);
  decorate(map, 'grass', 18, 24, ['floor']);
  floors().forEach(c => nextTo(c.x, c.y, 'bog') && chance(0.5) && map.set(c.x, c.y, 'reeds'));
  map.cells((x, y) => map.get(x, y) === 'bog').forEach(c => chance(0.12) && map.set(c.x, c.y, 'lily'));

  map.keepOut = [];
  addSunkenRuin(map);
  addMireLair(map);
  addLeechPool(map);
  addWitchHut(map);
  addBanditCamp(map);
  joinAcrossWater(map, 8, { bog: 'boardwalk', lily: 'boardwalk', tree: 'floor' }); // boardwalks across the bog
  addFishermensCamp(map);
  // Rotten planks: some of the boardwalk (not the Mire Mother's - that one is her bait) gives way underfoot (rotboard.onEnter).
  const inLair = p => map.keepOut.some(r => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
  map.cells((x, y) => map.get(x, y) === 'boardwalk' && !inLair({ x, y })).forEach(p => chance(0.15) && map.set(p.x, p.y, 'rotboard'));
  // Swamp-gas vents (level.gas, swampGas): on firm ground at the water's edge, away from the camp.
  shuffle(map.cells((x, y) => map.get(x, y) === 'floor' && nextTo(x, y, 'bog') && !map.noSpawn?.[y]?.[x] && !inLair({ x, y })))
    .slice(0, scaled(8, w, h)).forEach(p => map.set(p.x, p.y, 'gasvent'));
  // Drifting lights: wisps over the water, fireflies over land.
  shuffle(map.cells((x, y) => map.get(x, y) === 'bog')).slice(0, scaled(3, w, h)).forEach(c => map.spawns.push({ ...c, monster: 'wisp' }));
  shuffle(floors()).slice(0, scaled(4, w, h)).forEach(c => map.spawns.push({ ...c, monster: 'fireflies' }));
  return map;
}

// A free w x h rectangle of the map (inside a margin), not overlapping reserved areas. Tries `tries` random spots.
function freeRect(map, w, h, margin = 3, tries = 200) {
  for (let i = 0; i < tries; i++) {
    const r = { x: rand(margin, map.w - w - margin), y: rand(margin, map.h - h - margin), w, h };
    if (!map.reserved.some(o => r.x < o.x + o.w + 2 && o.x < r.x + r.w + 2 && r.y < o.y + o.h + 2 && o.y < r.y + r.h + 2)) return r;
  }
  return null;
}

// Sunken ruin: a half-flooded square of old stone with a gap on two sides; the dungeon entrance (map.stairs) in the
// middle, a bog lurker in the flooded part and a viper among the rubble.
function addSunkenRuin(map) {
  const r = freeRect(map, 11, 9, 6);
  if (!r) return;
  carveRect(map, r.x, r.y, r.w, r.h, 'wall');
  carveRect(map, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 'floor');
  const c = { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) };
  map.set(r.x, c.y, 'floor'); map.set(r.x + r.w - 1, c.y, 'floor'); // gaps west and east
  const inner = map.cells((x, y) => x > r.x && y > r.y && x < r.x + r.w - 1 && y < r.y + r.h - 1 && dist({ x, y }, c) > 1);
  const wet = shuffle(inner).slice(0, inner.length * 0.3 | 0);
  wet.forEach(p => map.set(p.x, p.y, 'bog'));
  shuffle(inner.filter(p => map.get(p.x, p.y) === 'floor')).slice(0, 3).forEach(p => map.set(p.x, p.y, 'rubble'));
  map.stairs = c;
  if (wet[0]) map.spawns.push({ ...wet[0], monster: 'boglurker' });
  const dry = inner.find(p => map.get(p.x, p.y) === 'floor');
  if (dry) map.spawns.push({ ...dry, monster: 'viper' });
  map.reserved.push(r);
}

// Leech pool: a ring of bog around a little islet with a treasure cache. The only way in is a strip of slow mud -
// wading it while the leeches wake. keepOut stops boardwalks being built to the islet.
function addLeechPool(map) {
  const r = freeRect(map, 13, 9);
  if (!r) return;
  const pool = { x: r.x + 6, y: r.y + 4, rx: 6, ry: 4 };
  const cells = map.cells((x, y) => ellipse(pool, { x, y }) < 1);
  cells.forEach(p => map.set(p.x, p.y, ellipse(pool, p) < 0.25 ? 'floor' : 'bog'));
  orthoPath(pool, { x: r.x, y: pool.y }).forEach(p => ellipse(pool, p) >= 0.25 && map.set(p.x, p.y, 'mud'));
  map.set(r.x - 1, pool.y, 'floor');
  const islet = cells.filter(p => ellipse(pool, p) < 0.25);
  const [a, b] = shuffle(islet);
  if (a) map.loot.push({ ...a, rarity: 'rare' });
  if (b) map.loot.push({ ...b, rarity: 'magic' });
  shuffle(cells.filter(p => map.get(p.x, p.y) === 'bog')).slice(0, 3).forEach(p => map.spawns.push({ ...p, monster: 'leech' }));
  map.reserved.push(r);
  map.keepOut.push(r);
}

// Bandit camp: a clearing around a campfire, two bandits and a poacher, and their stash.
function addBanditCamp(map) {
  const r = freeRect(map, 5, 5);
  if (!r) return;
  carveRect(map, r.x, r.y, r.w, r.h, 'floor');
  const c = { x: r.x + 2, y: r.y + 2 };
  map.set(c.x, c.y, 'campfire');
  const round = shuffle(DIRS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })));
  ['bandit', 'bandit', 'poacher'].forEach((monster, i) => map.spawns.push({ ...round[i], monster }));
  map.loot.push({ ...round[3], rarity: 'magic' });
  map.reserved.push(r);
}

// The abandoned fishermen's camp where you start (map.start): a cold-night campfire, bedrolls, some old gear and a
// potion. Placed 16-28 steps from the ruin so the dungeon entrance is a short trek away.
function addFishermensCamp(map) {
  if (!map.stairs) return;
  const d = map.distanceFrom(map.stairs.x, map.stairs.y, (x, y) => map.passable(x, y));
  const open = (x, y) => DIRS.every(([dx, dy]) => map.walkable(x + dx, y + dy));
  const inRes = c => map.reserved.some(r => c.x >= r.x - 1 && c.x <= r.x + r.w && c.y >= r.y - 1 && c.y <= r.y + r.h);
  for (const [lo, hi] of [[16, 28], [10, 40], [4, 99]]) {
    const spot = pick(map.cells((x, y) => map.get(x, y) === 'floor' && d[y][x] >= lo && d[y][x] <= hi && open(x, y) && !inRes({ x, y })));
    if (!spot) continue;
    map.set(spot.x, spot.y, 'campfire');
    const round = shuffle(DIRS.map(([dx, dy]) => ({ x: spot.x + dx, y: spot.y + dy })));
    round.slice(0, 2).forEach(p => map.set(p.x, p.y, 'straw'));
    map.loot.push({ ...round[2], rarity: 'common' }, { ...round[3], rarity: 'common' }, { ...round[4], item: 'Healing Potion' });
    map.start = round[5];
    map.noSpawn = grid(map.w, map.h, false);
    for (let y = spot.y - 4; y <= spot.y + 4; y++) for (let x = spot.x - 4; x <= spot.x + 4; x++) if (map.inBounds(x, y)) map.noSpawn[y][x] = true;
    map.reserved.push({ x: spot.x - 4, y: spot.y - 4, w: 9, h: 9 });
    return;
  }
}

// The bog witch's hut: a little house of rough planks on firm ground (hutwall, a door on the side facing the middle of the
// map), herbs drying on the floor, her cauldron in the middle (bump it: TILES.cauldron.onBump brews a potion, once), the
// witch and two frog familiars. Her stash: a magic piece of the Mire's reed gear.
function addWitchHut(map) {
  const r = freeRect(map, 9, 7, 4);
  if (!r) return;
  const inner = { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, c = roomMid(inner);
  carveRect(map, r.x, r.y, r.w, r.h, 'hutwall');
  carveRect(map, inner.x, inner.y, inner.w, inner.h, 'hutfloor');
  const dx = Math.sign(map.w / 2 - c.x) || 1, door = { x: dx > 0 ? r.x + r.w - 1 : r.x, y: c.y };
  map.set(door.x, door.y, 'door');
  map.set(door.x + dx, door.y, 'floor'); // (a step of firm ground outside the door)
  map.set(c.x, c.y, 'cauldron');
  shuffle(map.cells((x, y) => map.get(x, y) === 'hutfloor' && dist({ x, y }, c) > 1)).slice(0, 4).forEach(p => map.set(p.x, p.y, 'herbs'));
  const free = shuffle(map.cells((x, y) => map.get(x, y) === 'hutfloor' && dist({ x, y }, c) === 1));
  map.spawns.push({ ...free[0], monster: 'bogwitch' }, { ...free[1], monster: 'frog' }, { ...free[2], monster: 'frog' });
  map.loot.push({ ...free[3], rarity: 'magic', pool: 'reed' });
  map.reserved.push(r);
}

// The Mire Mother's pool: a wide round pool of black bog (lily pads here and there) ringed by firm ground and reeds, and a
// boardwalk out to an islet in the middle holding her hoard - a rare piece of reed gear. She lurks under the water (see
// BOSS_PATTERNS.miremother); the boardwalk is the only dry way out to the islet. keepOut: no other boardwalks cross it.
function addMireLair(map) {
  const r = freeRect(map, 21, 13, 4);
  if (!r) return;
  const pool = { x: r.x + 10, y: r.y + 6, rx: 9, ry: 5 };
  map.cells((x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h).forEach(p => {
    const e = ellipse(pool, p);
    map.set(p.x, p.y, e < 0.08 ? 'floor' : e < 1 ? (chance(0.08) ? 'lily' : 'bog') : chance(0.35) ? 'reeds' : 'floor');
  });
  const side = pick([-1, 1]); // the boardwalk comes in from the west or east bank
  for (let x = pool.x + side; Math.abs(x - pool.x) <= pool.rx; x += side) if (ellipse(pool, { x, y: pool.y }) >= 0.08) map.set(x, pool.y, 'boardwalk');
  map.loot.push({ x: pool.x, y: pool.y, rarity: 'rare', pool: 'reed' });
  const deep = shuffle(map.cells((x, y) => map.get(x, y) === 'bog' && ellipse(pool, { x, y }) < 0.5 && Math.abs(y - pool.y) >= 2));
  if (deep[0]) map.spawns.unshift({ ...deep[0], monster: 'miremother' });
  map.reserved.push(r);
  map.keepOut.push(r);
}
