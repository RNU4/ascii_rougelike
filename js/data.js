// All game content: classes, monsters, items and level definitions. Add content here, not in game.js.

// key: skill tree in SKILL_TREES (skills.js). playerOnly: never appears as a captive companion.
// Passives: crit, regen (turns per MP), lifesteal / manaOnKill (per kill), kin (neutral faction), aura (light radius),
// hardened (flat damage reduction), steadyAim (bonus vs targets 3+ away), manaShield, dodge (chance).
// atk: physical attacks; int: spells (skills marked `magic`, heals...). caster: levels grow INT every level, ATK every other.
// hpPerLevel (default 6), atkEvery / intEvery (levels per +1): override level-up growth (levelUpStats).
// difficulty: Easy / Medium / Hard tag on the class select screen.
// ranged: as a companion, keeps its distance (see AI.ally). support: as a companion, casts every turn and stays by you. vanguard: as a companion, walks ahead of you.
const CLASSES = [
  { key: 'warrior', difficulty: 'Easy', title: 'Warrior', ch: '@', color: '#f44', hp: 40, atk: 5, int: 1, def: 2, mp: 12, regen: 4, hardened: 1, vanguard: true,
    desc: 'Tough melee fighter. Hardened: takes 1 less damage from every hit.' },
  { key: 'archer', difficulty: 'Medium', title: 'Archer', ch: '@', color: '#d8b050', hp: 28, atk: 4, int: 1, def: 1, mp: 14, regen: 3, crit: 0.15, steadyAim: 0.2, ranged: true,
    desc: 'Deadly at range. Steady Aim: +20% damage to targets 3+ tiles away.' },
  { key: 'cleric', difficulty: 'Easy', title: 'Cleric', ch: '@', color: '#fff0a0', hp: 32, atk: 3, int: 4, caster: true, support: true, def: 2, mp: 18, regen: 3, aura: 3,
    desc: 'Holy healer. Aura of Light wards off ghosts and liches and mends allies.' },
  { key: 'mage', difficulty: 'Hard', title: 'Mage', ch: '@', color: '#48f', hp: 24, atk: 2, int: 4, caster: true, def: 0, mp: 20, regen: 2, manaShield: true, ranged: true,
    desc: 'Fire, frost and lightning. Mana Shield: mana above half soaks damage.' },
  { key: 'rogue', difficulty: 'Medium', title: 'Rogue', ch: '@', color: '#4f4', hp: 32, atk: 4, int: 1, def: 1, mp: 12, regen: 4, crit: 0.3, dodge: 0.1,
    desc: 'Frequent crits, poison, stuns and teleports. Dodges 10% of attacks.' },
  { key: 'necromancer', difficulty: 'Medium', title: 'Necromancer', ch: '@', color: '#a6f', hp: 28, atk: 2, int: 4, caster: true, def: 1, mp: 16, regen: 3, lifesteal: 2, kin: 'undead', playerOnly: true,
    desc: 'Raises the dead from bones. Kills heal you. Undead leave you be.' },
  { key: 'trickster', difficulty: 'Hard', title: 'Trickster', ch: '@', color: '#f6c', hp: 24, atk: 3, int: 4, caster: true, def: 1, mp: 16,
    regen: 3, crit: 0.1, playerOnly: true, manaOnKill: 3, dodge: 0.15,
    hpPerLevel: 3, atkEvery: 4, // slippery but frail: grows less HP and ATK than other classes
    desc: 'Slippery fae: orbs, rifts and coils. Dodges 15% of attacks; kills restore mana.' },
];

// A captive adventurer of a player class (prison pens). Freed, they become a companion using that class's
// stats, passives and skill tree (see aiCast in skills.js and growCompanion in entities.js) - as close to playing
// that class as the AI allows. Their class `kin` is only taken on once freed (Game.freeCaptive).
const CLASS_PASSIVES = ['regen', 'aura', 'hardened', 'steadyAim', 'manaShield', 'dodge', 'lifesteal', 'manaOnKill'];
function makeCaptive(cls) {
  const title = cls.title.toLowerCase(), skills = startingSkills(cls);
  skills.push(...poolPicks({ cls, skills, lvl: 1 }, 2)); // every captive knows a couple of random pool skills
  return {
    ...Object.fromEntries(CLASS_PASSIVES.filter(k => cls[k]).map(k => [k, cls[k]])),
    name: `captive ${title}`, freedName: title, cls, ch: '@', color: cls.color, hp: cls.hp, atk: cls.atk, int: cls.int, def: cls.def,
    mp: cls.mp, crit: cls.crit || 0.05, xp: 0, ai: 'idle', captive: 'ally', kin: 'player',
    skills, plea: `A ${title} calls from behind the bars: 'Help me! The jailer has the key!'`,
  };
}

// faction: monsters fight rival factions (FACTION_ENEMIES); no faction = only hostile to you.
// ai: key into AI. range: for ranged/turret. shunLight: never enters lit tiles or attacks targets standing in light.
const MONSTERS = {
  // overworld
  rat:      { name: 'rat', ch: 'r', color: '#a86', hp: 4, atk: 2, def: 0, xp: 2, ai: 'chase' },
  wolf:     { name: 'wolf', ch: 'w', color: '#aaa', hp: 7, atk: 3, def: 0, xp: 4, ai: 'fast' },
  bandit:   { name: 'bandit', ch: 'b', color: '#c84', hp: 10, atk: 4, def: 1, xp: 6, ai: 'chase' },
  poacher:  { name: 'poacher', ch: 'p', color: '#8c4', hp: 7, atk: 3, def: 0, xp: 5, ai: 'ranged', range: 5 },
  // swamp (overworld). drain: heals by the damage it deals. fly: moves over water. glow: {r, color} moving light.
  // alwaysAwake: moves about even when you haven't seen it. faction + kin 'player': neutral wildlife.
  leech:    { name: 'giant leech', ch: 'l', color: '#b0606a', hp: 6, atk: 3, def: 0, xp: 3, ai: 'lurker', swim: true, submerge: true, drain: true, corpse: null },
  frog:     { name: 'bog frog', ch: 'f', color: '#8ac04a', hp: 5, atk: 2, def: 0, xp: 2, ai: 'erratic', swim: true, corpse: null },
  swamprat: { name: 'swamp rat', ch: 'r', color: '#9a8a58', hp: 4, atk: 2, def: 0, xp: 2, ai: 'chase' },
  viper:    { name: 'marsh viper', ch: 's', lunge: true, color: '#7c4', hp: 6, atk: 3, def: 0, xp: 4, ai: 'chase', onHit: { poison: 3 }, corpse: null },
  // The Mire Mother (the Blackwater Mire's boss, in her pool - addMireLair): a monstrous leech under the bog. See BOSS_PATTERNS.miremother.
  miremother: { name: 'Mire Mother', ch: 'Θ', color: '#ff7a90', hp: 55, atk: 5, def: 1, xp: 50, ai: 'boss', pattern: 'miremother', baseAi: 'multibody',
    size: 7, part: 'mirepart', form: 'chain', aquatic: true, lunge: true, swim: true, drain: true, churnCd: 2, alwaysAwake: true, guard: true,
    shedMsg: 'A length of the Mire Mother goes limp and sinks!', loot: 'rare', lootPool: 'reed', corpse: null },
  mirepart: { name: 'Mire Mother', ch: 'o', color: '#b05868', hp: 1, atk: 0, def: 1, xp: 0, ai: 'segment', swim: true, corpse: null },
  // The bog witch (her hut, addWitchHut): curses from the doorway and keeps her distance.
  bogwitch: { name: 'bog witch', ch: 'w', color: '#b0d070', hp: 16, atk: 3, int: 3, def: 1, xp: 16, ai: 'caster', kite: true, skills: ['curse', 'drain'], loot: 'magic', lootPool: 'reed' },
  boglurker: { name: 'bog lurker', ch: 'B', color: '#8a7a4a', hp: 18, atk: 5, def: 1, xp: 12, ai: 'lurker', swim: true, submerge: true, loot: 'magic' },
  wisp:     { name: "will-o'-wisp", ch: '•', color: '#9fe8ff', hp: 3, atk: 0, def: 0, xp: 1, ai: 'erratic', faction: 'wildlife', kin: 'player',
    fly: true, alwaysAwake: true, glow: { r: 3, color: '120,220,255' }, corpse: null },
  fireflies: { name: 'firefly swarm', ch: '∙', color: '#ffe060', hp: 2, atk: 0, def: 0, xp: 1, ai: 'erratic', faction: 'wildlife', kin: 'player',
    fly: true, alwaysAwake: true, glow: { r: 2, color: '255,225,90' }, corpse: null },
  // 1: goblin warrens
  goblin:   { name: 'goblin', ch: 'g', color: '#6c3', hp: 8, atk: 4, def: 1, xp: 5, ai: 'chase', faction: 'goblin', coward: true }, // coward: flees when badly hurt
  archer:   { name: 'goblin archer', ch: 'a', color: '#9e5', hp: 6, atk: 4, def: 0, xp: 6, ai: 'ranged', range: 6, faction: 'goblin', coward: true },
  // skills: an enemy caster's spells (AI.caster / aiCast - same skills and priorities as companions). kite: keeps away.
  shaman:   { name: 'goblin shaman', ch: 'h', color: '#c6f', hp: 10, atk: 3, int: 1, def: 0, xp: 12, ai: 'caster', faction: 'goblin', coward: true,
    skills: ['heal', 'firebolt', 'curse'], kite: true },
  // Prison-pen captives: do nothing until you walk into them. captive: what they become when freed.
  // plea: logged the first time you see them.
  cagedtroll: { name: 'caged troll', ch: 'T', color: '#8a6', hp: 40, atk: 10, def: 2, xp: 0, ai: 'idle', captive: 'troll', kin: 'player',
    wounded: 0.4, // beaten by its captors: starts at 40% HP (Monster constructor)
    plea: 'Something huge and battered rattles the bars of its cell and growls at the goblins.' },
  jailer:   { name: 'goblin jailer', ch: 'g', color: '#c97', hp: 16, atk: 5, def: 2, xp: 12, ai: 'chase', faction: 'goblin', guard: true, drops: 'cellkey' },
  bat:      { name: 'cave bat', ch: 'v', color: '#866', hp: 4, atk: 3, def: 0, xp: 3, ai: 'erratic' },
  chief:    { name: 'goblin chief', ch: 'G', color: '#4f4', hp: 20, atk: 6, def: 2, xp: 15, ai: 'chase', loot: 'rare', faction: 'goblin', leader: true, tome: true }, // leader: goblins panic when it dies
  raider:   { name: 'goblin raider', ch: 'g', color: '#9d4', hp: 14, atk: 6, def: 2, xp: 10, ai: 'chase', faction: 'goblin' }, // crypt raiding parties
  raidarcher: { name: 'goblin raid archer', ch: 'a', color: '#bd6', hp: 10, atk: 6, def: 1, xp: 10, ai: 'ranged', range: 6, faction: 'goblin' },
  // 2: flooded grotto
  mold:     { name: 'creeping mold', ch: 'm', color: '#8fbf4a', hp: 16, atk: 5, def: 0, xp: 7, ai: 'slow', trail: 'moldpatch', corpse: null }, // trail: tile left on floor; corpse: null = no bones
  crab:     { name: 'giant crab', ch: 'c', color: '#e63', hp: 10, atk: 5, def: 4, xp: 8, ai: 'chase' },
  toad:     { name: 'spitting toad', ch: 't', color: '#8b4', hp: 9, atk: 5, def: 1, xp: 8, ai: 'ranged', range: 4, onHit: { poison: 3 } },
  // swim: moves through deep water; submerge: hidden there until you're adjacent
  drowned:  { name: 'drowned one', ch: 'd', color: '#6ad', hp: 14, atk: 6, def: 1, xp: 10, ai: 'lurker', swim: true, submerge: true },
  // Grotto boss: holds the island that the way to the stairs crosses; calls drowned ones up from the water around her,
  // faster at high tide (highTideEvery). (Any boss can also bar the stairs with `seals: 'message'` - see takeStairs.)
  hag:      { name: 'Drowned Hag', ch: 'H', color: '#5fd8c0', hp: 80, atk: 9, def: 2, xp: 55, ai: 'boss', pattern: 'hag', baseAi: 'summoner', surgeCd: 3, range: 6, guard: true, loot: 'rare', lootPool: 'coral', tome: true, int: 7, skills: ['curse'],
    shot: { ch: '~', color: '#5fd8c0', verb: 'hex', status: { poison: 3 } },
    raise: { from: ['water', 'tidewater'], monster: 'drowned', every: 7, highTideEvery: 3, max: 3, verb: 'calls a drowned one up from the water', color: '#1a4a4a',
    warn: 'stirwater', warnMsg: 'The water churns beside the Hag...' } },
  // The smugglers' cove (the Grotto): a crew of cutthroats round their strongbox.
  smuggler: { name: 'smuggler', ch: 'p', color: '#c8a070', hp: 14, atk: 6, def: 1, xp: 10, ai: 'chase' },
  smugglerbow: { name: 'smuggler crossbowman', ch: 'p', color: '#a88a60', hp: 10, atk: 5, def: 0, xp: 10, ai: 'ranged', range: 5 },
  // 3: forgotten crypt - a skeleton army (lots of rank-and-file undead) led by a few strong mini-bosses, each with an escort.
  skeleton: { name: 'skeleton', ch: 'z', color: '#eee', hp: 14, atk: 7, def: 2, xp: 10, ai: 'chase', faction: 'undead' },
  ghost:    { name: 'ghost', ch: 'W', color: '#bdf', hp: 10, atk: 6, def: 1, xp: 12, ai: 'phase', shunLight: true, faction: 'undead', fly: true }, // fly: spirits float over webs, traps and water
  bowman:   { name: 'bone archer', ch: 'k', color: '#ddb', hp: 10, atk: 6, def: 1, xp: 11, ai: 'ranged', range: 6, faction: 'undead' },
  ghoul:    { name: 'ghoul', ch: 'u', color: '#7a6', hp: 12, atk: 6, def: 1, xp: 12, ai: 'fast', faction: 'undead' },
  // Mini-bosses. Death Knight: charges you down from close range and taunts your companions onto itself.
  deathknight: { name: 'Death Knight', ch: 'K', color: '#8a9ab8', hp: 85, atk: 14, def: 4, xp: 35, ai: 'boss', pattern: 'deathknight', baseAi: 'caster', faction: 'undead',
    skills: ['charge', 'taunt'], skillRange: { charge: 3 }, loot: 'magic' }, // skillRange: shorter reach than the Warrior's
  // Animated armour (the Death Knight's guard): a suit of armour from his hall, woken when he's brought to half health.
  animatedarmour: { name: 'animated armour', ch: 'Ω', color: '#b0bcd4', hp: 18, atk: 6, def: 4, xp: 12, ai: 'slow', faction: 'undead', corpse: null },
  // Grave Serpent (crypt mini-boss, its own pit): a long chain-form multibody (see Bone Colossus). fang: a special bite
  // every `every` turns - `mult` x damage plus `status`.
  graveserpent: { name: 'Grave Serpent', ch: '♦', color: '#9fd07a', hp: 110, atk: 13, def: 2, xp: 45, ai: 'boss', pattern: 'serpent', baseAi: 'multibody', faction: 'undead', spitCd: 3,
    size: 8, part: 'serpentpart', form: 'chain', lunge: true,
    fang: { every: 5, mult: 2, status: { poison: 4 }, msg: 'The Grave Serpent rears back and sinks its fangs in!' }, remains: 'bones', shedMsg: 'A coil of the Grave Serpent goes limp!', loot: 'rare' },
  graveadder: { name: 'grave adder', ch: 's', lunge: true, color: '#b8e08a', hp: 7, atk: 4, def: 0, xp: 6, ai: 'fast', faction: 'undead', onHit: { poison: 3 } }, // (out of the Serpent's shed skins)
  serpentpart: { name: 'Grave Serpent', ch: 'o', color: '#6f9f52', hp: 1, atk: 0, def: 2, xp: 0, ai: 'segment', faction: 'undead', corpse: null },
  // Wight: its touch curses you (-3 DEF) and it heals by the damage it deals.
  wight:    { name: 'Wight', ch: 'V', color: '#9fc27a', hp: 95, atk: 13, def: 3, xp: 30, ai: 'boss', pattern: 'wight', baseAi: 'chase', faction: 'undead',
    onHit: { cursed: 5 }, drain: true, darkstalker: 2, lightWeak: true, snuffCd: 4, loot: 'magic' }, // (darkstalker 2: only its eyes past 2 tiles in the dark; lightWeak: x1.5 damage in light)
  // Banshee: shuns light, and wails - everyone around it is hurt and silenced.
  banshee:  { name: 'Banshee', ch: '§', color: '#dde4ff', hp: 115, atk: 12, def: 2, xp: 30, ai: 'boss', pattern: 'banshee', baseAi: 'chase', faction: 'undead', fly: true,
    int: 13, keenCd: 2, loot: 'magic' }, // (her keen replaced the Wail skill; no shunLight - a boss you could stand in the brazier light and wait out)
  // Bone forge (an Ossuary chamber): a rooted heap of bone and sinew that keeps assembling skeletons from the bones around
  // it (summoner ai) until you smash it. rooted: never moves, can't be knocked back.
  boneforge: { name: 'bone forge', ch: '♦', color: '#ff6a3a', hp: 30, atk: 0, def: 3, xp: 25, ai: 'summoner', faction: 'undead',
    css: 'forge', glow: { r: 2, color: '255,90,40' }, // a throbbing ember heart: clearly alive, clearly hostile
    rooted: true, guard: true, corpse: null,
    raise: { from: ['bones'], to: 'floor', monster: 'skeleton', every: 5, max: 3, verb: 'hammers a skeleton together from the bones', color: '#4a3a20',
    warn: 'stirbones', warnMsg: 'The bones around the forge rattle and stir...' } },
  // Bone Colossus: a flowing mass of bones - a multi-tile creature (ai 'multibody', see ai.js): a core (☻) plus body
  // parts that share its HP. form 'mass': it oozes toward its prey as a blob, shrinks as it's hurt (parts slough off as
  // bones: its tiles = size x HP share) and collapses into bones when the core dies. An area skill hurts it once.
  colossus: { name: 'Bone Colossus', ch: '☼', color: '#fff4d8', css: 'writhe', hp: 60, atk: 8, def: 2, xp: 60, ai: 'multibody', faction: 'undead',
    size: 8, surround: { bonus: 0.08 }, part: 'colossuspart', form: 'mass', remains: 'bones', shedMsg: 'Bones slough off the Bone Colossus!', loot: 'rare', lootPool: 'bone' },
  // Bone Worm (Ossuary): a chain-form multibody (see Bone Colossus) with a poison bite that dives into bone piles when
  // hurt and bursts up again near you (`burrow`, tryBurrow in ai.js).
  boneworm: { name: 'bone worm', ch: '◙', color: '#e8dcb0', hp: 40, atk: 6, def: 1, xp: 40, ai: 'multibody', faction: 'undead',
    size: 6, part: 'wormpart', form: 'chain', lunge: true, burrow: true, onHit: { poison: 3 }, remains: 'bones', shedMsg: 'Vertebrae scatter from the bone worm!', loot: 'magic', lootPool: 'bone' },
  wormpart: { name: 'bone worm', ch: '○', color: '#cfc29a', hp: 1, atk: 0, def: 1, xp: 0, ai: 'segment', faction: 'undead', corpse: null },
  // Giant spiders: rigid multibodies (form 'rigid': legs with home slots round the body - BODY_LAYOUTS - walking in an
  // alternating gait, folding away where there's no room, torn off as they're hurt). pounce: a leap onto prey within
  // `range`, every `every` turns. skirmish: hit and run - after striking it scuttles back a couple of turns. Legs have
  // `pass`: walking into one pushes past it (it folds) instead of attacking, so they can't wall you in.
  // The Broodmother (Silk Hive boss, 5x5): also spits webs (shot + range), trails silk and lays egg sacs (`lays`: tile,
  // every n turns, beside her body, while she has prey).
  broodmother: { name: 'Broodmother', ch: '\u263b', color: '#efe0ff', hp: 80, atk: 8, def: 2, xp: 80, ai: 'multibody', webs: true,
    size: 9, part: 'broodleg', form: 'rigid', layout: 'spider5', skirmish: true, onHit: { poison: 3 }, pounce: { range: 4, every: 6 },
    range: 5, shot: { ch: '%', color: '#ddd', verb: 'web', status: { webbed: 2 } }, trail: 'silkfloor',
    lays: { tile: 'eggsac', every: 5 }, remains: 'silkfloor', shedMsg: 'A leg tears off the Broodmother!', loot: 'rare', lootPool: 'hive' },
  broodleg: { name: 'Broodmother', ch: '/', color: '#d8c8f0', hp: 1, atk: 0, def: 2, xp: 0, ai: 'segment', webs: true, corpse: null, pass: true },
  giantspider: { name: 'giant spider', ch: '\u00f6', color: '#d0c090', hp: 30, atk: 6, def: 1, xp: 30, ai: 'multibody', webs: true,
    size: 5, part: 'spiderleg', form: 'rigid', layout: 'spider3', skirmish: true, onHit: { poison: 2 }, pounce: { range: 3, every: 5 },
    remains: 'silkfloor', shedMsg: 'A leg tears off the giant spider!', loot: 'magic' },
  // Long-legged spider (test room: EXTRA_FLOORS.longspidertest): a giant spider on legs of three parts - root, knee, foot - reaching 3 tiles (layout spider3seg).
  longspider: { name: 'long-legged spider', ch: '\u00f6', color: '#c8b090', hp: 45, atk: 7, def: 1, xp: 45, ai: 'multibody', webs: true,
    size: 13, part: 'longleg', form: 'rigid', layout: 'spider3seg', skirmish: true, onHit: { poison: 2 }, pounce: { range: 4, every: 6 },
    remains: 'silkfloor', shedMsg: 'A leg tears off the long-legged spider!', loot: 'magic' },
  longleg: { name: 'long-legged spider', ch: '/', color: '#b8a878', hp: 1, atk: 0, def: 1, xp: 0, ai: 'segment', webs: true, corpse: null, pass: true },
  spiderleg: { name: 'giant spider', ch: '/', color: '#b8a878', hp: 1, atk: 0, def: 1, xp: 0, ai: 'segment', webs: true, corpse: null, pass: true },
  silkweaver: { name: 'silk weaver', webs: true, ch: 'S', color: '#e8d088', hp: 12, atk: 3, def: 1, xp: 14, ai: 'weaver', busy: true, alwaysAwake: true }, // mends burnt silk
  spiderling: { name: 'spiderling', webs: true, ch: 's', color: '#e8e0b8', hp: 4, atk: 3, def: 0, xp: 2, ai: 'fast', corpse: null }, // Silk Hive swarms
  colossuspart: { name: 'Bone Colossus', ch: 'x', color: '#fff4d8', css: 'writhe', hp: 1, atk: 0, def: 2, xp: 0, ai: 'segment', faction: 'undead',
    corpse: null }, // (crossed bones, bright, no background and gently pulsing, so it isn't mistaken for bone walls)
  // The trial chamber's final champion (last wave).
  warden:   { name: 'Grave Warden', ch: 'Z', color: '#e8d8a0', hp: 30, atk: 8, def: 3, xp: 25, ai: 'chase', faction: 'undead' },
  hand:     { name: 'crawling hand', ch: 'ƒ', color: '#c8b8a0', hp: 4, atk: 3, def: 0, xp: 3, ai: 'fast', faction: 'undead', corpse: null }, // come in packs
  // 4: fungal depths
  // The Mycelium Heart (the Fungal Depths' boss, rooted in the central cavern): see BOSS_PATTERNS.myceliumheart.
  myceliumheart: { name: 'Mycelium Heart', spores: true, ch: '¥', color: '#e070ff', css: 'writhe', hp: 120, atk: 10, int: 9, def: 3, xp: 80, ai: 'boss', pattern: 'myceliumheart', baseAi: 'idle',
    rooted: true, alwaysAwake: true, graspCd: 2, sproutCd: 4, loot: 'rare', lootPool: 'fungal', corpse: null, deathMsg: 'The Mycelium Heart bursts in a cloud of dead spores - the roots go limp all through the cavern.' },
  // The myconid village's elder: heals his kin from the middle of the clearing.
  myconidelder: { name: 'myconid elder', spores: true, ch: 'M', color: '#f0a0ff', hp: 30, atk: 7, int: 4, def: 3, xp: 22, ai: 'caster', skills: ['heal'], loot: 'magic', lootPool: 'fungal' },
  spore:    { name: 'sporeling', spores: true, ch: 'o', color: '#e8f', hp: 8, atk: 8, def: 0, xp: 9, ai: 'turret', range: 5, onHit: { poison: 3 } },
  myconid:  { name: 'myconid', spores: true, ch: 'M', color: '#c6a', hp: 24, atk: 9, def: 3, xp: 14, ai: 'chase' },
  spider:   { name: 'cave spider', webs: true, ch: 's', color: '#a33', hp: 12, atk: 7, def: 1, xp: 13, ai: 'fast', onHit: { poison: 4 } },
  cryptspider: { name: 'crypt spider', webs: true, ch: 's', color: '#c9a0c0', hp: 8, atk: 5, def: 0, xp: 8, ai: 'fast', onHit: { poison: 3 } }, // ossuary lairs
  webspinner: { name: 'web spinner', webs: true, ch: 'S', color: '#dcdcff', hp: 10, atk: 3, def: 0, xp: 12, ai: 'webber', range: 5,
    shot: { ch: '%', color: '#ddd', verb: 'web', status: { webbed: 2 } } }, // ossuary lairs. shot: projectile look + on-hit status
  moth:     { name: 'glow moth', ch: 'm', color: '#ff8', hp: 8, atk: 6, def: 0, xp: 8, ai: 'erratic' },
  // 5: crystal sanctum
  lich:     { name: 'Lich', ch: 'L', color: '#c8ffb0', css: 'lich', hp: 110, atk: 12, def: 3, xp: 60, ai: 'boss', pattern: 'lich', baseAi: 'summoner', graspCd: 3, tetherCd: 4, range: 6, faction: 'undead', tome: true, int: 10, skills: ['drain', 'curse'],
    raise: { from: ['bones'], to: 'lichfloor', monster: 'skeleton', every: 8, max: 3, verb: 'raises a skeleton from the bones', color: '#4a2a66',
      warn: 'stirbones', warnMsg: 'The Lich points a bony finger - the bones begin to stir!' },
    shunLight: true, guard: true, loot: 'rare', drops: 'cryptkey', phylactery: 'phylactery', shot: { ch: '*', color: '#b8f', verb: 'blast' } }, // crypt boss
  // The Lich's phylactery (on its dais): while it stands, the Lich re-forms beside it 3 turns after being slain.
  phylactery: { name: 'phylactery', ch: '♥', color: '#d8a8ff', css: 'phylactery', hp: 20, atk: 0, def: 4, xp: 20, ai: 'idle', faction: 'undead',
    rooted: true, alwaysAwake: true, corpse: null, deathMsg: 'The phylactery shatters with a scream! The Lich is bound to its body now.' },
  golem:    { name: 'crystal golem', ch: 'O', color: '#7ef', hp: 35, atk: 14, def: 5, xp: 25, ai: 'slow' },
  wraith:   { name: 'shard wraith', ch: 'W', color: '#aff', hp: 18, atk: 10, def: 2, xp: 18, ai: 'phase', fly: true },
  prism:    { name: 'prism eye', ch: 'e', color: '#f7f', hp: 14, atk: 10, def: 2, xp: 16, ai: 'turret', range: 7, onHit: { burn: 2 } },
  // The Crystal Guardian (the Sanctum's throne hall): see BOSS_PATTERNS.guardian. Focus crystals feed its prism shield.
  guardian: { name: 'Crystal Guardian', ch: 'Q', color: '#0ff', css: 'lich', hp: 160, atk: 15, def: 5, xp: 100, ai: 'boss', pattern: 'guardian', baseAi: 'chase',
    novaCd: 3, loot: 'rare', lootPool: 'crystal' },
  focus:    { name: 'focus crystal', ch: '♦', color: '#c0f8ff', css: 'phylactery', hp: 22, atk: 0, def: 2, xp: 10, ai: 'idle', rooted: true, alwaysAwake: true,
    corpse: null, deathMsg: 'The focus crystal shatters into glittering dust!' },
  // Crystal pylons (the Sanctum's galleries): rooted spires firing beams along their row and column (AI.pylon).
  pylon:    { name: 'crystal pylon', ch: '▲', color: '#9ff', hp: 22, atk: 6, int: 8, def: 3, xp: 14, ai: 'pylon', rooted: true, pulseCd: 2, corpse: null },
  // allies
  minion:   { name: 'your skeleton', ch: 'z', color: '#a6f', def: 1, xp: 0, ai: 'ally', ally: true, kin: 'undead', minion: true, vanguard: true }, // kin: neutral with that faction; minion: counts toward the raise cap
};

// Who each faction attacks on sight (besides you, whom everyone attacks).
const FACTION_ENEMIES = {
  goblin: ['undead', 'troll'],
  troll: ['goblin'],
  undead: ['goblin'],
};

const ITEM_LOOK = { crystal: ['*', '#0ff'], book: ['?', '#fd6'] };
const CRYSTAL = { name: 'Crystal of Ages', kind: 'crystal' };

// Level 0 is the overworld; the rest are the dungeon. `solid` fills unreachable pockets.
// size: [w, h] (default DEFAULT_SIZE). count/items are per 96x48 and scale with the floor's area.
const LEVELS = [
  {
    name: 'the Blackwater Mire', intro: 'Mist hangs over the black water. Boardwalks wind between the bogs - the dungeon entrance (>) lies in a sunken ruin.',
    gen: (w, h) => genSwamp(w, h), solid: 'tree', fov: 6, // mist: short sight; campfires and wisps glow through it
    mist: { thick: 3, thin: 8, clear: 70, fog: 30, ease: 5 }, gas: true, // now and then a bank of mist rolls in (Game.sightRange); swamp-gas vents puff poison (swampGas)
    colors: { tree: '#2a4a24', floor: '#3e4630', grass: '#4a6a2a', wall: '#6f7f6a' }, chars: { tree: '♣' },
    monsters: ['leech', 'frog', 'frog', 'swamprat', 'viper'], count: 18, items: 10,
  },
  {
    name: 'the Goblin Warrens', intro: 'Dug-out tunnels echo with goblin chatter. The chief holds court by the stairs down.',
    gen: (w, h) => placeTorches(furnishWarren(genWarren(w, h, { caverns: 14 })), 22, 7), fov: 8, size: [80, 40],
    colors: { wall: '#8b5a2b', floor: '#4a3b2a' },
    monsters: ['goblin', 'goblin', 'archer', 'shaman', 'bat'], count: 12, items: 6, boss: 'chief', // boss spawns at the throne (furnishWarren)
  },
  {
    name: 'the Flooded Grotto', intro: 'An underground river cuts through the caves - cross at the fords, and mind the tide. The way down lies beyond the lake, across the island where the Drowned Hag waits.',
    gen: (w, h) => decorate(furnishGrotto(genGrotto(w, h)), 'moldpatch', 6, 6),
    spread: { tile: 'moldpatch', chance: 0.008, max: 300, sprout: 'mold', sproutChance: 0.015, maxSprouts: 6 },
    tide: { low: 12, high: 10 }, // turns at low / high water; rising and falling take TIDE_WAVES turns each (features.js)
    fov: 7, size: [90, 45], colors: { wall: '#2f4f6f', floor: '#34495e' }, chars: { wall: '▓' },
    monsters: ['mold', 'crab', 'toad', 'toad', 'drowned'], count: 16, items: 8, boss: 'hag', // boss: on the lake island, between the two tidal causeways (genGrotto)
  },
  {
    name: 'the Forgotten Crypt', intro: 'Darkness presses in, broken only by guttering torches. The way down lies behind a sealed door - and the Lich holds its key.',
    gen: (w, h) => placeTorches(decorate(addRooms(addTrialChamber(addLichLair(genMaze(w, h, { spacing: 4, loops: 40, sparse: 2 }))), 9, CRYPT_ROOMS), 'bones', 40, 3), 32, 6), fov: 4, size: [61, 31], // tight: small and dark
    colors: { wall: '#6b6b7b', floor: '#3a3a44' }, chars: { wall: '▒' }, bgs: { wall: '#26262e' },
    monsters: ['skeleton', 'skeleton', 'skeleton', 'skeleton', 'bowman', 'bowman', 'ghost'], count: 40, items: 9, // the army
    trial: { waves: [ // the trial chamber (addTrialChamber): one wave after another, no ghosts (they'd drift out through the walls)
      ['skeleton', 'skeleton', 'hand', 'hand', 'hand'],
      ['skeleton', 'skeleton', 'bowman', 'ghoul'],
      ['warden', 'skeleton', 'bowman', 'bowman', 'ghoul'], // the Grave Warden leads the last wave
    ] },
    groups: [{ monsters: ['raider', 'raider', 'raidarcher'], count: 5 }, // goblin raiding parties (count per 96x48)
      { monsters: ['hand', 'hand', 'hand', 'hand'], count: 5 }, // hand packs
      // mini-bosses (one each) with their escorts
      { monsters: ['deathknight', 'skeleton', 'skeleton', 'skeleton'], count: 1 },
      { monsters: ['wight', 'ghoul', 'ghoul'], count: 1 },
      { monsters: ['banshee', 'ghost', 'ghost'], count: 1 }],
    boss: 'lich', // spawns at the lair's bossSpot (addLichLair)
  },
  {
    name: 'the Fungal Depths', intro: 'A vast dark cavern. Glowing mushroom groves light the gloom - and sporelings guard them.',
    gen: (w, h) => furnishFungal(genFungal(w, h)), fov: 5, size: [130, 64], // dark: groves are beacons
    colors: { wall: '#4a4a4a', floor: '#2f3d2a' }, chars: { wall: '▓' }, // rough natural rock
    monsters: ['myconid', 'spider', 'moth', 'moth'], count: 10, items: 8, // sporelings only guard groves
  },
  {
    name: 'the Crystal Sanctum', intro: "Galleries of living crystal hum around you. The Crystal of Ages lies in the Guardian's throne hall (*).",
    gen: (w, h) => genSanctum(w, h), fov: 9, final: true, size: [90, 44], // crystal galleries round the Guardian's throne hall
    colors: { wall: '#4a6a80', floor: '#23364a' },
    monsters: ['golem', 'wraith', 'prism', 'prism'], count: 16, items: 6, boss: 'guardian',
  },
];

// Test maps (debug J): a level def loaded in place of the current floor, to try out a new layout before it replaces one.
const TEST_LEVEL = {
  ...LEVELS[3], depth: 3, name: 'the Forgotten Crypt', size: [116, 54], count: 16, items: 5, // depth: which floor it stands in for; size: 5x3 grid cells of 22x17 - room for 17x11 boss rooms
  // (the bigger map would otherwise scale the war bands and hand packs way up; the mini-bosses wait in their arenas)
  groups: [{ monsters: ['hand', 'hand', 'hand', 'hand'], count: 2 }], // (the goblin raiders have their own camp room)
  gen: (w, h) => placeTorches(decorate(genCryptHub(w, h), 'bones', 40, 3), 32, 6),
  chars: { wall: '#' }, final: true, // (the run's last floor: the Crystal of Ages waits in the Lich's sealed vault - map.stairs)
  intro: 'Darkness presses in, broken only by guttering torches. The Crystal of Ages lies behind a sealed door - and the Lich holds its key.',
  // read on the entrance hall's plaque (TILES.plaque.onBump)
  plaque: 'Here the faithful sleep. Their champions keep the key to the vault; their master keeps the Crystal. Walk the runes, and earn the favour of the dead.',
};

// A run's main floors, top to bottom (Game.changeLevel walks this list): the Blackwater Mire (where a run starts) ->
// the Goblin Warrens (the way down is by the chief's throne) -> the boss crypt (side-floors off it to level up in; the
// last floor for now: the Crystal of Ages lies in the Lich's vault).
const RUN_FLOORS = [LEVELS[0], LEVELS[1], TEST_LEVEL];
// -> { depth, testLevel } for Game: a main floor by its place in LEVELS, anything else (the crypt) loads as testLevel.
const runFloor = def => LEVELS.includes(def) ? { depth: LEVELS.indexOf(def), testLevel: null } : { depth: def.depth, testLevel: def };

// Side-floors: optional areas off a main floor, reached by a tile with `side` (e.g. the crypt's bone stairway) and left
// by their stairs back up (Game.enterSide / leaveSide). Persisted like any floor, under 'depth:key'. noStairs: no way
// further down. Same fields as LEVELS otherwise.
// Body plans for rigid multibodies (form 'rigid'): each part's offset from the core, in the order they grow (and,
// from the end, the order they're lost in - farthest first). from: the part it joins on to (else the core) - it always
// stays touching that one. spider3: 4 diagonal legs; spider5: long legs, 2 tiles each (outer half on the inner).
const BODY_LAYOUTS = {
  spider3: [{ dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 }],
  spider3seg: [{ dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 }, // four legs of three parts (root, knee, foot)
    { dx: -2, dy: -2, from: 0 }, { dx: 2, dy: -2, from: 1 }, { dx: -2, dy: 2, from: 2 }, { dx: 2, dy: 2, from: 3 },
    { dx: -3, dy: -3, from: 4 }, { dx: 3, dy: -3, from: 5 }, { dx: -3, dy: 3, from: 6 }, { dx: 3, dy: 3, from: 7 }],
  spider5: [{ dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
    { dx: -2, dy: -2, from: 0 }, { dx: 2, dy: -2, from: 1 }, { dx: -2, dy: 2, from: 2 }, { dx: 2, dy: 2, from: 3 }],
};

// Floors not yet wired into the dungeon (loaded from the debug floor menu, J): `depth` = the depth it stands in for.
const EXTRA_FLOORS = {
  bosstest: { // a hub with a door to every boss room, and gear at each rarity (genBossTest)
    ...LEVELS[3], name: 'Boss test room', depth: 3, intro: 'A test room: every boss room off one hall. Gear of each rarity lies in rows - common, magic, rare.',
    gen: (w, h) => genBossTest(w, h), size: [110, 52], groups: [], count: 0, items: 0, trial: null, noUp: true, chars: { wall: '#' },
  },
  geartest: { // every exclusive gear piece laid out to try on (genGearTest)
    name: 'Gear test room', depth: 3, intro: 'A test room: every exclusive gear set (bone, silk, reed, coral, fungal, crystal), a row each.',
    gen: (w, h) => genGearTest(w, h), size: [26, 24], fov: 40, colors: { floor: '#3e3a30' }, chars: { wall: '#' }, monsters: ['spiderling'], count: 0, items: 0,
  },
  spidertest: { // a small arena for trying the giant spiders (genSpiderTest)
    name: 'Spider test room', depth: 4, intro: 'A test room: the Broodmother and a giant spider.', gen: (w, h) => genSpiderTest(w, h),
    size: [44, 22], fov: 40, colors: { floor: '#3e3a30' }, chars: { wall: '#' }, monsters: ['spiderling'], count: 0, items: 0,
  },
  longspidertest: { // a lit hall with the long-legged spider (genLongSpiderTest)
    name: 'Long-legged spider test room', depth: 4, intro: 'A test room: a spider whose legs have three parts.', gen: (w, h) => genLongSpiderTest(w, h),
    size: [48, 24], fov: 40, noStairs: true, colors: { floor: '#3e3a30' }, chars: { wall: '#' }, monsters: ['spiderling'], count: 0, items: 0,
  },
  bonetest: { // bone heap glyph candidates (genBoneTest)
    name: 'Bone heap test room', depth: 3, intro: `Bone heap glyphs, left to right: ${BONE_GLYPHS.join(' ')}. Rows: bare floor, in bone litter, stirring.`,
    gen: (w, h) => genBoneTest(w, h), size: [26, 16], fov: 40, noStairs: true, colors: { floor: '#2e2a24' }, chars: { wall: '#' }, monsters: ['spiderling'], count: 0, items: 0,
  },
};

const SIDE_LEVELS = {
  hive: {
    name: 'the Silk Hive', depth: 3, noStairs: true, intro: 'Silk everywhere - walls of it, floors of it, shapes wrapped in it. The air ticks with tiny legs. Fire would go through this place like a flood.',
    gen: (w, h) => genHive(w, h), size: [90, 44], fov: 4,
    colors: { floor: '#3e3a30' }, chars: { wall: '#' },
    monsters: ['spiderling', 'spiderling', 'spiderling', 'spider', 'webspinner'], count: 22, items: 4, // (giant spiders: genHive puts them in roomy chambers)
  },
  ossuary: {
    name: 'the Ossuary', intro: 'Walls of skulls, drifts of bones, cobwebs thick as curtains. Somewhere in the dark, something vast is shifting.',
    gen: (w, h) => genOssuary(w, h), size: [72, 36], fov: 4, noStairs: true, depth: 3, // (depth: the floor it lies under)
    stirBones: true, niches: true, // bone heaps that stir, burial niches (see tickBones / tickNiches)
    colors: { wall: '#5a5a66', floor: '#2e2a24' }, chars: { wall: '#' },
    monsters: ['cryptspider', 'webspinner', 'skeleton', 'skeleton', 'skeleton', 'hand', 'hand', 'ghoul'], count: 20, items: 4,
  },
};
