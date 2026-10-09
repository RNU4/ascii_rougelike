// Item generation: equipment (base + rarity + random affixes) and stackable consumables.
const SLOTS = ['weapon', 'offhand', 'head', 'body', 'hands', 'feet', 'ring', 'amulet'];
const SLOT_GLYPH = { weapon: ')', offhand: '(', head: '^', body: '[', hands: '{', feet: ']', ring: '=', amulet: '&' };
const PACK_SIZE = 18;

const RARITY = {
  common: { color: '#ccc' },
  magic:  { color: '#6af' },
  rare:   { color: '#fd4' },
};

// jewel: never common (a plain ring would have no stats). magic: casters only (wands, staffs, orbs - see canWear).
const BASES = [
  { name: 'Dagger', slot: 'weapon', tier: 0, stats: { atk: 1, crit: 5 } },
  { name: 'Short Sword', slot: 'weapon', tier: 0, stats: { atk: 2 } },
  { name: 'Apprentice Wand', slot: 'weapon', tier: 0, stats: { int: 2 }, magic: true },
  { name: 'Oak Staff', slot: 'weapon', tier: 1, stats: { atk: 1, int: 2, mp: 6 }, magic: true },
  { name: 'Mace', slot: 'weapon', tier: 1, stats: { atk: 3 } },
  { name: 'Longsword', slot: 'weapon', tier: 2, stats: { atk: 4 } },
  { name: 'War Axe', slot: 'weapon', tier: 3, stats: { atk: 6 } },
  { name: 'Runeblade', slot: 'weapon', tier: 4, stats: { atk: 8, crit: 5 } },
  { name: 'Runestaff', slot: 'weapon', tier: 3, stats: { atk: 2, int: 5, mp: 8 }, magic: true },
  { name: 'Buckler', slot: 'offhand', tier: 0, stats: { def: 1 } },
  { name: 'Spell Orb', slot: 'offhand', tier: 1, stats: { int: 1, mp: 8 }, magic: true },
  { name: 'Tower Shield', slot: 'offhand', tier: 3, stats: { def: 3 } },
  { name: 'Leather Cap', slot: 'head', tier: 0, stats: { def: 1 } },
  { name: 'Iron Helm', slot: 'head', tier: 2, stats: { def: 2 } },
  { name: 'Circlet', slot: 'head', tier: 3, stats: { def: 1, int: 1, mp: 10 } },
  { name: 'Leather Armor', slot: 'body', tier: 0, stats: { def: 1 } },
  { name: 'Chainmail', slot: 'body', tier: 2, stats: { def: 3 } },
  { name: 'Plate Armor', slot: 'body', tier: 3, stats: { def: 5 } },
  { name: 'Mithril Coat', slot: 'body', tier: 4, stats: { def: 6, hp: 10 } },
  { name: 'Gloves', slot: 'hands', tier: 0, stats: { def: 1 } },
  { name: 'Gauntlets', slot: 'hands', tier: 2, stats: { def: 1, atk: 1 } },
  { name: 'Sandals', slot: 'feet', tier: 0, stats: { def: 1 } },
  { name: 'Greaves', slot: 'feet', tier: 2, stats: { def: 2 } },
  { name: 'Copper Ring', slot: 'ring', tier: 0, stats: {}, jewel: true },
  { name: 'Gold Ring', slot: 'ring', tier: 2, stats: { crit: 3 }, jewel: true },
  { name: 'Bone Amulet', slot: 'amulet', tier: 1, stats: { hp: 5 }, jewel: true },
  { name: 'Jade Amulet', slot: 'amulet', tier: 3, stats: { int: 1, mp: 8 }, jewel: true },
];

// per: stat gained per roll; affix strength rolls 1..depth+1 times.
const PREFIXES = [
  { name: 'Sharp', stat: 'atk', per: 1 }, { name: 'Sturdy', stat: 'def', per: 1 },
  { name: 'Vital', stat: 'hp', per: 5 }, { name: 'Mystic', stat: 'mp', per: 4 }, { name: 'Keen', stat: 'crit', per: 3 },
  { name: 'Arcane', stat: 'int', per: 1 },
];
const SUFFIXES = [
  { name: 'of Might', stat: 'atk', per: 1 }, { name: 'of Warding', stat: 'def', per: 1 },
  { name: 'of the Bear', stat: 'hp', per: 5 }, { name: 'of Wisdom', stat: 'mp', per: 4 }, { name: 'of Precision', stat: 'crit', per: 3 },
  { name: 'of Sorcery', stat: 'int', per: 1 },
];

const CONSUMABLES = [
  // give: can be handed to an adjacent companion (inventory G), who carries it and drinks it when needed (Game.companionDrink).
  // heals: HP restored - R quick-drinks the best fit. mana: MP restored.
  { name: 'Healing Potion', tier: 0, ch: '!', color: '#f55', desc: 'Heals 15 HP.', give: true, heals: 15, use: (g, p) => heal(g, p, 15) },
  { name: 'Mana Potion', tier: 0, ch: '!', color: '#58f', desc: 'Restores 10 MP.', give: true, mana: 10, use: (g, p) => { p.mp = Math.min(p.maxMp, p.mp + 10); } },
  { name: 'Greater Healing', tier: 2, ch: '!', color: '#f3c', desc: 'Heals 40 HP.', give: true, heals: 40, use: (g, p) => heal(g, p, 40) },
  { name: 'Scroll of Teleport', tier: 1, ch: '?', color: '#eee', desc: 'Teleports you somewhere random on this level.',
    use: (g, p) => { g.fx.flash(p, '#305080'); Object.assign(p, pick(g.map.cells((x, y) => g.map.walkable(x, y) && !g.occupied(x, y)))); } },
  { name: 'Glowcap Mushroom', tier: 99, ch: ',', color: '#c080ff', desc: 'Eat it and see what happens...', // tier 99: only from mushroom farms
    use: (g, p) => pick(MUSHROOM_EFFECTS)(g, p) },
  { name: 'Scroll of Mapping', tier: 1, ch: '?', color: '#eee', desc: 'Reveals the layout of this level.',
    use: g => { g.map.seen = g.map.seen.map(row => row.map(() => true)); } },
];

const MUSHROOM_EFFECTS = [
  (g, p) => { heal(g, p, 12); g.log('Delicious! You feel refreshed.', '#6f6'); },
  (g, p) => { p.mp = Math.min(p.maxMp, p.mp + 8); g.log('Your thoughts sparkle. +8 MP.', '#8cf'); },
  (g, p) => { applyStatus(p, 'poison', 5, g); g.log('That one tasted wrong...', '#9c6'); },
  (g, p) => { applyStatus(p, 'shield', 8, g); g.log('Your skin hardens like bark.', '#6af'); },
  (g, p) => { g.map.cells((x, y) => dist({ x, y }, p) <= 14).forEach(c => (g.map.seen[c.y][c.x] = true)); g.log('Your eyes glow - you see through the dark!', '#c8f'); },
];

function rollRarity(depth) {
  const r = Math.random();
  return r < 0.02 + 0.03 * depth ? 'rare' : r < 0.30 + 0.05 * depth ? 'magic' : 'common'; // (depth 4: 14% rare, 36% magic)
}

// Gear only found in one place (not in random drops), picked by makeGear's `pool`: 'hive' = Silk Hive silk gear
// (the Broodmother, the hive's secret rooms and deepest chamber); 'bone' = the Ossuary's bone gear (the Bone Colossus,
// the bone worm, its secret rooms and deepest chamber) - a heavy bone armour set and a caster's relic set. Stats dodge
// (% of attacks slipped), venom (poison turns on each hit), thorns (damage back to whoever strikes you in melee).
const POOL_BASES = {
  bone: [
    { name: 'Bone Helm', slot: 'head', stats: { def: 1, hp: 6 } },
    { name: 'Bone Armour', slot: 'body', stats: { def: 3, hp: 8, thorns: 2 } },
    { name: 'Bone Gauntlets', slot: 'hands', stats: { def: 1, atk: 1, thorns: 1 } },
    { name: 'Bone Greaves', slot: 'feet', stats: { def: 2, hp: 4 } },
    { name: 'Skull Shield', slot: 'offhand', stats: { def: 3, thorns: 1 } },
    { name: 'Femur Club', slot: 'weapon', stats: { atk: 4, crit: 3 } },
    { name: 'Skull Circlet', slot: 'head', stats: { int: 2, mp: 6 } },
    { name: 'Knucklebone Rosary', slot: 'amulet', stats: { int: 2, hp: 6 }, jewel: true },
    { name: 'Finger-Bone Ring', slot: 'ring', stats: { int: 1, crit: 3 }, jewel: true },
    { name: 'Bone Wand', slot: 'weapon', stats: { int: 3 }, magic: true },
  ],
  hive: [
    { name: 'Spider-Silk Cloak', slot: 'body', stats: { def: 1, dodge: 8 } },
    { name: 'Silkweave Gloves', slot: 'hands', stats: { def: 1, dodge: 4, crit: 3 } },
    { name: 'Silk Slippers', slot: 'feet', stats: { dodge: 6 } },
    { name: 'Broodfang', slot: 'weapon', stats: { atk: 3, crit: 5, venom: 3 } },
  ],
  reed: [ // the Blackwater Mire: the Mire Mother, the bog witch's hut
    { name: 'Reedweave Hood', slot: 'head', stats: { def: 1, dodge: 3 } },
    { name: 'Leech-Leather Jerkin', slot: 'body', stats: { def: 2, hp: 6 } },
    { name: 'Bogwalker Boots', slot: 'feet', stats: { def: 1, dodge: 3 } },
    { name: 'Fen Spear', slot: 'weapon', stats: { atk: 3, venom: 2 } },
    { name: "Witch's Charm", slot: 'amulet', stats: { int: 1, mp: 6 }, jewel: true },
  ],
  coral: [ // the Flooded Grotto: the Drowned Hag, the clams and the smugglers' cove
    { name: 'Coral Helm', slot: 'head', stats: { def: 2, thorns: 1 } },
    { name: 'Pearl Diadem', slot: 'head', stats: { int: 2, mp: 8 } },
    { name: 'Kelp Wraps', slot: 'body', stats: { def: 2, dodge: 4 } },
    { name: 'Shellguard', slot: 'offhand', stats: { def: 2, thorns: 2 } },
    { name: 'Trident', slot: 'weapon', stats: { atk: 4, crit: 4 } },
    { name: 'Pearl Ring', slot: 'ring', stats: { int: 1, mp: 6 }, jewel: true },
  ],
  fungal: [ // the Fungal Depths: the Mycelium Heart, the myconid village
    { name: 'Capcrown', slot: 'head', stats: { hp: 6, int: 1 } },
    { name: 'Sporehide Vest', slot: 'body', stats: { def: 2, hp: 8 } },
    { name: 'Mycelial Wraps', slot: 'hands', stats: { def: 1, venom: 2 } },
    { name: 'Rootstride Boots', slot: 'feet', stats: { def: 1, hp: 6 } },
    { name: 'Glowcap Lantern', slot: 'offhand', stats: { int: 2, mp: 6 } },
    { name: 'Puffball Mace', slot: 'weapon', stats: { atk: 4, venom: 2 } },
  ],
  crystal: [ // the Crystal Sanctum: the Crystal Guardian, the galleries' vaults
    { name: 'Prism Crown', slot: 'head', stats: { def: 1, int: 2, crit: 3 } },
    { name: 'Crystal Plate', slot: 'body', stats: { def: 5, hp: 6 } },
    { name: 'Glass Greaves', slot: 'feet', stats: { def: 2, dodge: 3 } },
    { name: 'Shardblade', slot: 'weapon', stats: { atk: 6, crit: 6 } },
    { name: 'Focus Crystal', slot: 'offhand', stats: { int: 3, mp: 10 }, magic: true },
    { name: 'Crystal Ring', slot: 'ring', stats: { int: 1, crit: 4 }, jewel: true },
  ],
};
function makeGear(depth, rarity = rollRarity(depth), pool = null, baseName = null) { // baseName: that exact piece (test maps)
  const base = baseName ? [...BASES, ...Object.values(POOL_BASES).flat()].find(b => b.name === baseName)
    : pick(pool ? POOL_BASES[pool] : BASES.filter(b => !b.pool && b.tier <= depth + 1 && b.tier >= depth - 2));
  if (base.jewel && rarity === 'common') rarity = 'magic';
  const pre = pick(PREFIXES), suf = pick(SUFFIXES);
  const affixes = rarity === 'rare' ? [pre, suf] : rarity === 'magic' ? [chance(0.5) ? pre : suf] : [];
  const stats = { ...base.stats };
  for (const a of affixes) stats[a.stat] = (stats[a.stat] || 0) + a.per * rand(1, Math.ceil((depth + 1) / 2)); // (the crypt rolls at depth 4: x1-3)
  const name = [affixes.includes(pre) && pre.name, base.name, affixes.includes(suf) && suf.name].filter(Boolean).join(' ');
  return { kind: 'gear', slot: base.slot, name, base: base.name, stats, rarity, ch: SLOT_GLYPH[base.slot], color: RARITY[rarity].color, ...(base.magic && { magic: true }) };
}

const makeConsumable = c => ({ ...c, kind: 'consumable', count: 1 });

// Keys open sealed doors (TILES.lockedDoor). Dropped by bosses via their `drops` field.
const KEYS = {
  cryptkey: { kind: 'key', id: 'cryptkey', name: 'Crypt Key', ch: '-', color: '#ffd24a', desc: 'Opens the sealed door in the crypt.' },
  vaultkey: { kind: 'key', id: 'vaultkey', name: 'Vault Key', ch: '-', color: '#e8c060', desc: 'Opens the treasure vault in the crypt.' },
  cellkey:  { kind: 'key', id: 'cellkey', name: 'Cell Key', ch: '-', color: '#9aa4b0', desc: 'Opens a prison cell.' },
};

function randomItem(depth) {
  return chance(0.45) ? makeConsumable(pick(CONSUMABLES.filter(c => c.tier <= depth + 1))) : makeGear(depth);
}

// ---- how gear looks: the hero's tile ----
// A piece's material, from its base name: [pattern, key, colour, body-armour fill].
const GEAR_MATS = [
  [/bone|skull|femur|knuckle|finger/i, 'bone', '#e8dcb0', '≡'], [/silk|spider|brood/i, 'silk', '#ece8ff', '░'],
  [/reed|leech|bogwalker|fen spear|witch/i, 'reed', '#a8b060', '▒'], [/coral|pearl|kelp|shell|trident/i, 'coral', '#ff9a86', '▒'],
  [/capcrown|spore|mycel|rootstride|glowcap|puffball/i, 'fungal', '#d890e8', '▒'], [/crystal|prism|glass|shard/i, 'crystal', '#a0f4ff', '▓'],
  [/mithril|rune/i, 'mithril', '#8fe0ff', '▓'], [/leather|glove|sandal|buckler|cap/i, 'leather', '#b48a58', '▒'],
  [/staff|wand|orb|circlet|jade/i, 'arcane', '#c8a0ff', '░'], [/ring|amulet/i, 'gold', '#e8c060', '▓'], [/./, 'iron', '#a8b4c8', '█']];
const gearMat = it => { const [, key, color, fill] = GEAR_MATS.find(([re]) => re.test(it.base || it.name)); return { key, color, fill }; };
// The hero's tile (option `gearLook`): the armour drawn round the glyph out of glyphs - each worn piece a small
// glyph shrunk and moved into place by a CSS transform (GEAR_OVERLAY: glyph, then the transform), in the piece's
// material colour: a helm dome over the head, a cuirass's plates hugging both sides, a shield low on the left, the
// weapon raised at the upper right (blade / axe or club / staff). Plus a faint glow for a full set (4+ bone pieces,
// 3+ silk). The hero's own glyph keeps its colour. Returns the overlay html and classes.
// Placed against the hero glyph's real footprint: the font's '@' fills columns 0-6 and rows 0-6 of its 8x8 cell, so
// the plates hug columns 0 and 6, the helm is centred over column 3.5, and the weapon stands in the free column 7.
const GEAR_OVERLAY = { // (scales of 0.5 / 1 only and moves in 1/16 em - the 8x8 font stays crisp, nothing smears)
  head: [['[', 'translate(-0.125em, -0.375em) rotate(90deg) scale(0.5, 1)']], // (a [ turned on its side: a flat cap with cheek-guards, over the head)
  body: [['[', 'translate(-0.3125em, 0) scale(0.5, 1)'], [']', 'translate(0.3125em, 0) scale(0.5, 1)']],
  offhand: [['0', 'translate(-0.4375em, 0.25em) scale(0.5)']],
  // weapons upright in the free right-hand column: a sword (cross-hilted), a club/axe/mace (shaft + head), a staff (shaft + orb)
  blade: [['†', 'translate(0.5em, 0) scale(0.5, -1)']], // († flipped: blade up, guard low - held raised)
  blunt: [['│', 'translate(0.4375em, 0) scale(0.5, 1)'], ['■', 'translate(0.4375em, -0.375em) scale(0.5)']],
  staff: [['│', 'translate(0.4375em, 0) scale(0.5, 1)'], ['o', 'translate(0.4375em, -0.4375em) scale(0.5)']],
};
const weaponLook = it => /mace|club|femur|axe/i.test(it.base || it.name) ? 'blunt' : /staff|wand/i.test(it.base || it.name) ? 'staff' : 'blade';
function heroGearLook(e) {
  const g = e.gear || {}, parts = [];
  for (const [slot, key] of [['body', 'body'], ['head', 'head'], ['offhand', 'offhand'], ['weapon', g.weapon && weaponLook(g.weapon)]])
    if (g[slot]) for (const [ch, tf] of GEAR_OVERLAY[key]) parts.push(`<b class="gm${slot === 'weapon' || slot === 'offhand' ? ' ol' : ''}" style="color:${gearMat(g[slot]).color};transform:${tf}">${ch}</b>`);
  const count = k => SLOTS.filter(s => g[s] && gearMat(g[s]).key === k).length;
  const set = count('bone') >= 4 ? ' set-bone' : count('silk') >= 3 ? ' set-silk' : '';
  return { html: parts.join(''), cls: (parts.length ? 'geared' : '') + set };
}

// ---- display helpers ----
const statLabel = (k, v) => `${v > 0 ? '+' : ''}${v}${k === 'crit' ? '% crit' : k === 'dodge' ? '% dodge' : k === 'venom' ? ' venom' : k === 'thorns' ? ' thorns' : ' ' + k.toUpperCase()}`;
const fmtStats = stats => Object.entries(stats).filter(([, v]) => v).map(([k, v]) => statLabel(k, v)).join(' ');
const itemName = it => `<span style="color:${it.color}">${it.name}${it.count > 1 ? ' x' + it.count : ''}</span>`;
// Casters-only gear (wands, staffs, orbs) can't be worn by warriors, archers or rogues.
const canWear = (e, it) => !it.magic || !!e.cls?.caster;
const itemInfo = it => it.kind === 'gear' ? fmtStats(it.stats) + (it.magic ? ' <span style="color:#a8f">casters only</span>' : '') : it.kind === 'book' ? `a skill tome - learn 1 of ${TOME_CHOICES} skills (U: read if it's your class, G: give to a companion of its class)` : it.desc || '';

// Stat difference between an item and what's currently worn, coloured green/red.
function compareGear(item, worn) {
  const keys = new Set([...Object.keys(item.stats), ...Object.keys(worn?.stats || {})]);
  const diffs = [...keys].map(k => [k, (item.stats[k] || 0) - (worn?.stats[k] || 0)]).filter(([, d]) => d);
  return diffs.length ? diffs.map(([k, d]) => `<span style="color:${d > 0 ? '#6f6' : '#f66'}">${statLabel(k, d)}</span>`).join(' ') : 'no change';
}
