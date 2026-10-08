// Skill system. Each skill: name, mp, desc, optional lvl (required level) and range (=> needs a target).
// ground: the target can be any visible tile in range (free cursor), not only an enemy; t is then { x, y }.
// use(g, p, target) returns true if the skill went off (mana is only spent then).
// cd: cooldown in turns after use (per caster, see Game.runSkill); 0/absent = none.
// magic: its attacks scale with INT instead of ATK (see Entity.attack / Game.runSkill); flat-number spells use p.spellPower.

// ---- shared building blocks ----
// Friends / foes are relative to the caster (game.caster while a skill runs; the player otherwise), so the same skills
// work for you, your companions and enemy spellcasters. Your side: your allies, and every non-allied monster you can see.
// A monster's side: its faction; its foes are whoever it's hostile to and can see.
const friendsNear = (g, center, r, caster = g.caster || g.player) =>
  [g.player, ...g.monsters].filter(f => f.alive && g.factionOf(f) === g.factionOf(caster) && dist(f, center) <= r);
function foesNear(g, center, r, caster = g.caster || g.player) {
  const mine = g.factionOf(caster) === 'player';
  return (mine ? g.hostilesWhere(m => g.map.visible[m.y][m.x] && dist(m, center) <= r)
    : [g.player, ...g.monsters].filter(o => o.alive && o !== caster && g.hostile(caster, o) && dist(o, center) <= r && g.map.hasLos(caster, o)));
}

// Hits every visible hostile within r of center, with an area flash.
function burst(g, center, r, bg, fn) {
  const foes = foesNear(g, center, r);
  if (!foes.length) return (g.caster === g.player && g.log('No enemies in reach.')), false;
  g.fx.area(center, r, bg);
  foes.forEach(fn);
  return true;
}

function bolt(g, p, t, ch, color, opts) {
  g.fx.bolt(p, t, ch, color);
  return p.attack(t, g, opts);
}

function blast(g, m, n, what, bg) {
  g.fx.flash(m, bg);
  g.log(`${m.subj} is caught in the ${what} for ${n}.`, '#fa4');
  m.hurt(n, g, g.player);
}

// Flavour lines for group spells: 'the party' for your side, '<caster> and its kin' for enemies; shown only if seen.
const partyOf = (g, p) => g.factionOf(p) === 'player' ? 'the party' : `${p.obj} and its kin`;
const castLog = (g, p, msg, color) => (p === g.player || g.map.visible[p.y]?.[p.x]) && g.log(msg, color);

const heal = (g, p, n) => {
  const was = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + n); g.fx.flash(p, '#1a5a1a');
  if (p.hp > was) g.fx.float(p, '+' + (p.hp - was), '#6f6');
};

const freeCellsNear = (g, c) => DIRS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy }))
  .filter(n => g.map.walkable(n.x, n.y) && !g.occupied(n.x, n.y));

// Push m up to n tiles straight away from `from`. Returns false if something stopped it short (it hit a wall/creature).
function knockback(g, from, m, n = 1) {
  if (m.rooted || Object.keys(m.status).some(k => STATUS[k].noPush)) return false; // stands its ground (rooted, unstoppable)
  const dx = Math.sign(m.x - from.x), dy = Math.sign(m.y - from.y);
  for (let i = 0; i < n; i++) {
    const x = m.x + dx, y = m.y + dy;
    if (!g.canEnter(m, x, y) || g.occupied(x, y) || !g.map.canStep(m.x, m.y, x, y)) return false;
    Object.assign(m, { x, y });
  }
  return true;
}

// Every non-allied creature on the line from p to t (Bone Spear, Piercing Shot).
const onLine = (g, p, t) => line(p.x, p.y, t.x, t.y).slice(1).map(c => g.monsterAt(c.x, c.y)).filter(m => m && !m.ally);

const hasBadStatus = f => Object.keys(f.status).some(k => STATUS[k].bad);

const visibleBones = (g, p, r) => g.map.cells((x, y) => g.map.get(x, y) === 'bones' && g.map.visible[y][x]
  && !g.occupied(x, y) && dist({ x, y }, p) <= r).sort((a, b) => dist(a, p) - dist(b, p));

// Raised skeletons: each caster can keep 2 + level/2 at once; raising past that crumbles their oldest one.
// Their ATK is 1 + the caster's INT.
const minionCap = p => 2 + Math.floor(p.lvl / 2);
const minionsOf = (g, p) => g.monsters.filter(o => o.alive && o.minion && o.owner === p);
function raiseAt(g, p, c) {
  const mine = minionsOf(g, p);
  if (mine.length >= minionCap(p)) {
    const oldest = mine.reduce((a, b) => (b.raisedN < a.raisedN ? b : a));
    oldest.hp = 0;
    g.fx.flash(oldest, '#333');
    g.log('Your oldest skeleton crumbles to make room.', '#a6f');
  }
  g.map.set(c.x, c.y, 'floor');
  g.spawn({ ...MONSTERS.minion, hp: 8 + p.lvl * 3, atk: 1 + p.spellPower, owner: p, raisedN: g.raiseCount = (g.raiseCount || 0) + 1, hold: !!g.alliesHold }, c);
  g.fx.flash(c, '#4a2a66');
}

// ---- skill definitions ----
const SKILLS = {
  // Warrior
  cleave: { name: 'Cleave', mp: 4, desc: 'Strike every adjacent enemy (x1.3).',
    use: (g, p) => burst(g, p, 1, '#402020', m => p.attack(m, g, { mult: 1.3, verb: 'cleave' })) },
  charge: { name: 'Charge', act: 'charges', mp: 4, cd: 3, lvl: 2, range: 6, desc: 'Rush to a target, hit x1.5 and stun it 1 turn.',
    use: (g, p, t) => {
      const path = line(p.x, p.y, t.x, t.y).slice(1, -1);
      for (const c of path) { if (!g.moveTo(p, c.x, c.y)) break; g.fx.add(c.x, c.y, { bg: '#402020' }); }
      if (dist(p, t) === 1) p.attack(t, g, { mult: 1.5, verb: 'slam', status: { stun: 1 } });
      return true;
    } },
  warcry: { name: 'War Cry', mp: 5, cd: 8, lvl: 2, desc: 'Terrify visible enemies within 6 for 5 turns.',
    use: (g, p) => burst(g, p, 6, '#2a1a33', m => applyStatus(m, 'fear', 5, g)) },
  ironskin: { name: 'Iron Skin', mp: 6, cd: 10, lvl: 3, desc: 'For 8 turns: shielded (+4 DEF) and unstoppable (can\'t be stunned, frozen or knocked back).',
    use: (g, p) => (applyStatus(p, 'shield', 8, g), applyStatus(p, 'unstoppable', 8, g), true) },
  whirlwind: { name: 'Whirlwind', mp: 8, cd: 4, lvl: 5, desc: 'Spin, hitting all enemies within 2 (x1.6).',
    use: (g, p) => burst(g, p, 2, '#402020', m => p.attack(m, g, { mult: 1.6, verb: 'slash' })) },
  earthshatter: { name: 'Earthshatter', mp: 9, cd: 6, book: true, desc: 'Quake: enemies within 3 take x1.5 and are stunned 2.',
    use: (g, p) => burst(g, p, 3, '#4a3a1a', m => p.attack(m, g, { mult: 1.5, verb: 'crush', status: { stun: 2 } })) },
  secondwind: { name: 'Second Wind', mp: 10, cd: 15, book: true, desc: 'Recover half your max HP.',
    use: (g, p) => (heal(g, p, p.maxHp >> 1), g.log(`${p.subj} ${p.verb('catch')} a second wind.`, '#6f6'), true) },
  shieldbash: { name: 'Shield Bash', mp: 4, cd: 4, lvl: 4, range: 1, desc: 'Bash (x1.2) and knock the target back 2 tiles; if it slams into something on the way, it is stunned 2 turns.',
    use: (g, p, t) => {
      p.attack(t, g, { mult: 1.2, verb: 'bash' });
      if (t.alive && !knockback(g, p, t, 2)) applyStatus(t, 'stun', 2, g);
      return true;
    } },
  taunt: { name: 'Taunt', act: 'bellows a challenge', mp: 4, cd: 8, lvl: 6, desc: 'Enemies within 5 must attack you for 4 turns.',
    use: (g, p) => { // (the player can't be taunted - it only pulls monsters and companions)
      const foes = foesNear(g, p, 5).filter(m => m !== g.player);
      if (!foes.length) return castLog(g, p, 'Nothing in reach to taunt.'), false;
      g.fx.area(p, 5, '#4a1a1a');
      foes.forEach(m => { m.tauntedBy = p; applyStatus(m, 'taunted', 4, g); });
      return true;
    } },

  // Rogue
  smoke: { name: 'Smoke Bomb', mp: 5, cd: 8, desc: 'Stun visible enemies within 4 for 3 turns.',
    use: (g, p) => burst(g, p, 4, '#3a3a3a', m => applyStatus(m, 'stun', 3, g)) },
  backstab: { name: 'Backstab', mp: 3, lvl: 2, range: 1, desc: 'Guaranteed crit x1.5; x3 on stunned/frozen foes.',
    use: (g, p, t) => (p.attack(t, g, { mult: isDisabled(t) ? 3 : 1.5, crit: true, verb: 'backstab' }), true) },
  knives: { name: 'Throw Knife', mp: 3, lvl: 2, range: 6, desc: 'Ranged knife throw (x1.2).',
    use: (g, p, t) => (bolt(g, p, t, '-', '#ddd', { mult: 1.2, verb: 'stick' }), true) },
  envenom: { name: 'Envenom', mp: 4, cd: 2, lvl: 3, range: 1, desc: 'Poisoned strike: 2 dmg/turn for 8 turns.',
    use: (g, p, t) => (p.attack(t, g, { verb: 'stab', status: { poison: 8 } }), true) },
  shadowstep: { name: 'Shadowstep', mp: 6, cd: 5, lvl: 5, range: 8, desc: 'Teleport beside a target and crit it (x1.5).',
    use: (g, p, t) => {
      const spot = pick(freeCellsNear(g, t));
      if (!spot) return g.log('No room beside the target.'), false;
      g.fx.flash(p, '#333');
      Object.assign(p, spot);
      p.attack(t, g, { mult: 1.5, crit: true, verb: 'ambush' });
      return true;
    } },
  fan: { name: 'Fan of Knives', mp: 7, cd: 4, book: true, desc: 'Throw a knife at every visible enemy within 5.',
    use: (g, p) => {
      const foes = foesNear(g, p, 5).filter(m => g.map.hasLos(p, m));
      if (!foes.length) return g.log('No enemies in reach.'), false;
      foes.forEach(m => bolt(g, p, m, '-', '#ddd', { verb: 'stick' }));
      return true;
    } },
  vanish: { name: 'Vanish', mp: 6, cd: 12, book: true, desc: 'Become hidden for 6 turns; enemies lose track of you.',
    use: (g, p) => (applyStatus(p, 'hidden', 6, g), true) },
  caltrops: { name: 'Caltrops', mp: 5, cd: 8, lvl: 6, range: 5, ground: true, desc: 'Scatter spikes within 1 of a spot for 10 turns: enemies stepping on them take 2 and are slowed.',
    use: (g, p, t) => {
      const n = g.map.cells((x, y) => dist({ x, y }, t) <= 1).filter(c => placeTimed(g, c.x, c.y, 'caltrops', 10)).length;
      if (!n) return castLog(g, p, 'No room to scatter caltrops there.'), false;
      g.fx.area(t, 1, '#333');
      return true;
    } },

  // Mage
  firebolt: { magic: true, name: 'Firebolt', mp: 3, cd: 2, range: 8, ground: true, desc: 'Armor-piercing bolt (x2.5) that sets the target burning. Burns mold and webs.',
    use: (g, p, t) => {
      scorch(g, line(p.x, p.y, t.x, t.y));
      if (t.hp) bolt(g, p, t, '*', '#f80', { mult: 2.5, pierce: true, verb: 'scorch', status: { burn: 3 } });
      else { g.fx.bolt(p, t, '*', '#f80'); g.fx.flash(t, '#6b2a00'); }
      return true;
    } },
  frostnova: { magic: true, name: 'Frost Nova', mp: 6, cd: 5, lvl: 2, desc: 'Enemies within 2 take damage and are frozen 3 turns.',
    use: (g, p) => burst(g, p, 2, '#1f4f66', m => p.attack(m, g, { pierce: true, verb: 'freeze', status: { frozen: 3 } })) },
  arcaneshield: { name: 'Arcane Shield', mp: 6, cd: 12, lvl: 2, desc: 'For 10 turns: shielded (+4 DEF) and warded (can\'t be stunned or frozen).',
    use: (g, p) => (applyStatus(p, 'shield', 10, g), applyStatus(p, 'warded', 10, g), true) },
  blink: { name: 'Blink', mp: 4, cd: 6, lvl: 3, desc: 'Teleport to the visible spot farthest from enemies.',
    use: (g, p) => {
      const foes = foesNear(g, p, 99);
      const spots = g.map.cells((x, y) => g.map.visible[y][x] && g.map.walkable(x, y) && !g.occupied(x, y));
      const score = c => Math.min(99, ...foes.map(m => dist(m, c)));
      const best = spots.sort((a, b) => score(b) - score(a))[0];
      if (!best) return false;
      g.fx.flash(p, '#305080');
      Object.assign(p, best);
      g.fx.flash(p, '#305080');
      return true;
    } },
  chain: { magic: true, name: 'Chain Lightning', mp: 9, cd: 3, lvl: 5, range: 7, desc: 'Lightning (x1.8) that jumps to 3 more enemies.',
    use: (g, p, t) => {
      const hit = [];
      for (let from = p, cur = t; cur && hit.length < 4; from = cur, cur = foesNear(g, cur, 4).find(m => !hit.includes(m))) {
        bolt(g, from, cur, '~', '#ff8', { mult: 1.8, pierce: true, verb: 'shock' });
        g.fx.flash(cur, '#666600');
        hit.push(cur);
      }
      return true;
    } },
  meteor: { magic: true, name: 'Meteor', mp: 12, cd: 6, book: true, range: 8, ground: true, desc: 'Meteor strike: x2.2 to all enemies within 2 of the target spot. Burns mold and webs.',
    use: (g, p, t) => {
      scorch(g, g.map.cells((x, y) => dist({ x, y }, t) <= 2));
      g.fx.area(t, 2, '#6b2a00');
      foesNear(g, t, 2).forEach(m => p.attack(m, g, { mult: 2.2, pierce: true, verb: 'smash', status: { burn: 2 } }));
      return true;
    } },
  timestop: { name: 'Time Stop', mp: 10, cd: 15, book: true, desc: 'Freeze every visible enemy for 4 turns.',
    use: (g, p) => burst(g, p, 99, '#1f3f55', m => applyStatus(m, 'frozen', 4, g)) },
  icewall: { name: 'Ice Wall', mp: 6, cd: 10, lvl: 6, range: 6, ground: true, desc: 'Raise a 5-tile wall of ice across your aim at a spot. Melts after 6 turns.',
    use: (g, p, t) => {
      const dx = Math.sign(t.x - p.x), dy = Math.sign(t.y - p.y); // the wall runs across the line of aim
      const n = [-2, -1, 0, 1, 2].filter(k => placeTimed(g, t.x - dy * k, t.y + dx * k, 'icewall', 6, { free: true })).length;
      if (!n) return castLog(g, p, 'No room for a wall there.'), false;
      g.map.computeLights();
      castLog(g, p, 'A wall of ice cracks up out of the ground.', '#aef');
      return true;
    } },

  // Necromancer
  raise: { name: 'Raise Dead', mp: 6, desc: 'Turn the nearest bones (,) within 6 into a skeleton ally.',
    use: (g, p) => {
      const b = visibleBones(g, p, 6)[0];
      if (!b) return g.log('No bones nearby to raise.'), false;
      raiseAt(g, p, b);
      g.log('A skeleton claws its way up to serve you.', '#a6f');
      return true;
    } },
  drain: { magic: true, name: 'Drain Life', mp: 4, lvl: 2, range: 6, desc: 'Armor-piercing drain (x1.5); heals you for the damage.',
    use: (g, p, t) => (heal(g, p, bolt(g, p, t, '~', '#c4f', { mult: 1.5, pierce: true, verb: 'drain' })), true) },
  bonespear: { magic: true, name: 'Bone Spear', mp: 5, cd: 2, lvl: 2, range: 7, desc: 'Impale every enemy along the line to the target (x1.6).',
    use: (g, p, t) => {
      g.fx.bolt(p, t, '=', '#eed');
      onLine(g, p, t).forEach(m => p.attack(m, g, { mult: 1.6, verb: 'impale' }));
      return true;
    } },
  curse: { name: 'Curse', mp: 3, cd: 3, lvl: 3, range: 7, desc: 'Curse a target: -3 DEF for 10 turns.',
    use: (g, p, t) => (g.fx.bolt(p, t, '.', '#c6f'), applyStatus(t, 'cursed', 10, g), true) },
  corpseboom: { name: 'Corpse Explosion', mp: 6, cd: 4, lvl: 5, desc: 'Detonate visible bones within 8, hurting adjacent enemies (2 + 2 x INT).',
    use: (g, p) => {
      const bones = visibleBones(g, p, 8);
      if (!bones.length) return g.log('No bones to detonate.'), false;
      for (const b of bones) {
        g.map.set(b.x, b.y, 'floor');
        g.fx.area(b, 1, '#5a2a00');
        foesNear(g, b, 1).forEach(m => blast(g, m, 2 + 2 * p.spellPower, 'corpse explosion', '#8a3a00'));
      }
      return true;
    } },
  army: { name: 'Army of the Dead', mp: 12, cd: 12, book: true, desc: 'Raise up to 4 visible bones at once.',
    use: (g, p) => {
      const bones = visibleBones(g, p, 99).slice(0, 4);
      if (!bones.length) return g.log('No bones nearby to raise.'), false;
      bones.forEach(b => raiseAt(g, p, b));
      g.log(`${bones.length} skeletons rise!`, '#a6f');
      return true;
    } },
  plague: { name: 'Plague', mp: 8, cd: 10, book: true, desc: 'Poison every visible enemy for 10 turns.',
    use: (g, p) => burst(g, p, 99, '#1a3a1a', m => applyStatus(m, 'poison', 10, g)) },

  // Monster-only (in no class's skills): the Banshee's scream.
  wail: { magic: true, name: 'Wail', act: 'lets out a piercing wail', mp: 0, cd: 5, desc: 'Everyone hostile within 3 takes damage and is silenced 2 turns.',
    use: (g, p) => burst(g, p, 3, '#2a2a44', m => p.attack(m, g, { pierce: true, verb: 'deafen', status: { silenced: 2 } })) },

  // Basic attacks: free, always known by their class (SKILL_TREES basic); companions only use them when nothing better fits.
  bowshot: { name: 'Bow Shot', mp: 0, range: 6, desc: 'A quick arrow (x0.5). Free.',
    use: (g, p, t) => (bolt(g, p, t, '-', '#dca', { mult: 0.5, verb: 'shoot' }), true) },
  zap: { magic: true, name: 'Arcane Zap', mp: 0, range: 5, desc: 'A spark of raw magic (x0.6). Free.',
    use: (g, p, t) => (bolt(g, p, t, '*', '#88f', { mult: 0.6, verb: 'zap' }), true) },
  wither: { magic: true, name: 'Wither', mp: 0, range: 4, desc: 'A bolt of grave-cold (x0.6). Free.',
    use: (g, p, t) => (bolt(g, p, t, '~', '#a6f', { mult: 0.6, verb: 'wither' }), true) },

  // Archer
  aimedshot: { name: 'Aimed Shot', mp: 2, range: 8, desc: 'A careful arrow (x2).',
    use: (g, p, t) => (bolt(g, p, t, '-', '#dca', { mult: 2, verb: 'shoot' }), true) },
  pinshot: { name: 'Pinning Shot', mp: 4, cd: 3, lvl: 2, range: 7, desc: 'An arrow that pins the target in place (x1.2, stun 2).',
    use: (g, p, t) => (bolt(g, p, t, '-', '#dca', { mult: 1.2, verb: 'pin', status: { stun: 2 } }), true) },
  volley: { name: 'Volley', mp: 5, cd: 3, lvl: 2, desc: 'Loose arrows at up to 3 visible enemies within 6 (x1.2).',
    use: (g, p) => {
      const foes = foesNear(g, p, 6).filter(m => g.map.hasLos(p, m)).sort((a, b) => dist(a, p) - dist(b, p)).slice(0, 3);
      if (!foes.length) return g.log('No enemies in reach.'), false;
      foes.forEach(m => bolt(g, p, m, '-', '#dca', { mult: 1.2, verb: 'shoot' }));
      return true;
    } },
  roll: { name: 'Evasive Roll', mp: 3, cd: 5, lvl: 3, desc: 'Tumble up to 3 tiles away from the nearest enemy.',
    use: (g, p) => {
      const foe = foesNear(g, p, 99).sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (!foe) return g.log('Nothing to get away from.'), false;
      let moved = 0;
      for (let i = 0; i < 3; i++) {
        const next = DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
          .filter(c => g.map.walkable(c.x, c.y) && g.map.canStep(p.x, p.y, c.x, c.y) && !g.occupied(c.x, c.y) && dist(c, foe) > dist(p, foe))[0];
        if (!next) break;
        g.fx.add(p.x, p.y, { bg: '#333' });
        Object.assign(p, next);
        moved++;
      }
      return moved > 0 || (g.log('No room to roll.'), false);
    } },
  rain: { name: 'Rain of Arrows', mp: 8, cd: 4, lvl: 5, range: 8, ground: true, desc: 'Arrows rain on every enemy within 2 of the target spot (x1.4).',
    use: (g, p, t) => { g.fx.area(t, 2, '#3a3020'); foesNear(g, t, 2).forEach(m => p.attack(m, g, { mult: 1.4, verb: 'pelt' })); return true; } },
  explosive: { name: 'Explosive Shot', mp: 8, cd: 3, book: true, range: 8, ground: true, desc: 'An arrow that bursts within 1 of the target (x1.8) and sets it burning. Burns mold and webs.',
    use: (g, p, t) => {
      g.fx.bolt(p, t, '-', '#f80');
      scorch(g, g.map.cells((x, y) => dist({ x, y }, t) <= 1));
      g.fx.area(t, 1, '#6b2a00');
      foesNear(g, t, 1).forEach(m => p.attack(m, g, { mult: 1.8, verb: 'blast', status: { burn: 2 } }));
      return true;
    } },
  snipe: { name: 'Snipe', mp: 7, cd: 4, book: true, range: 12, desc: 'A long-range, armor-piercing shot (x3.5).',
    use: (g, p, t) => (bolt(g, p, t, '-', '#fff', { mult: 3.5, pierce: true, verb: 'snipe' }), true) },
  snaretrap: { name: 'Snare Trap', mp: 3, cd: 6, lvl: 4, range: 3, ground: true, desc: 'Set a snare on a spot (or just in front of the creature there): the first enemy to step on it is stuck 4 turns.',
    use: (g, p, t) => {
      const spot = g.occupied(t.x, t.y) ? freeCellsNear(g, t).sort((a, b) => dist(a, p) - dist(b, p))[0] : t;
      if (!spot || !placeTimed(g, spot.x, spot.y, 'snare', 300, { free: true })) return castLog(g, p, 'No room for a snare there.'), false;
      castLog(g, p, `${p.subj} ${p.verb('set')} a snare.`, '#dca060');
      return true;
    } },
  piercing: { name: 'Piercing Shot', mp: 5, cd: 3, lvl: 6, range: 8, desc: 'An arrow through every enemy in the line to the target (x1.4).',
    use: (g, p, t) => { g.fx.bolt(p, t, '-', '#fff'); onLine(g, p, t).forEach(m => p.attack(m, g, { mult: 1.4, verb: 'pierce' })); return true; } },

  // Cleric
  heal: { name: 'Heal', mp: 4, cd: 3, desc: 'Heal yourself and allies within 4 for 4 + 2 x INT.',
    use: (g, p) => {
      const n = 4 + 2 * p.spellPower;
      friendsNear(g, p, 4).forEach(f => heal(g, f, n));
      castLog(g, p, `Holy light mends ${partyOf(g, p)} for ${n}.`, '#ffd');
      return true;
    } },
  smite: { magic: true, name: 'Smite', mp: 3, cd: 2, lvl: 2, range: 6, desc: 'An armor-piercing holy bolt (x1.8); x1.5 against undead.',
    use: (g, p, t) => (bolt(g, p, t, '+', '#ffd', { mult: t.faction === 'undead' ? 2.7 : 1.8, pierce: true, verb: 'smite' }), true) },
  bless: { name: 'Bless', mp: 5, cd: 10, lvl: 2, desc: 'Shield yourself and allies within 5 (+4 DEF) for 8 turns.',
    use: (g, p) => (friendsNear(g, p, 5).forEach(f => applyStatus(f, 'shield', 8, g)), true) },
  turnundead: { magic: true, name: 'Turn Undead', mp: 6, cd: 8, lvl: 3, desc: 'Undead within 6 are seared by holy light and flee for 6 turns.',
    use: (g, p) => {
      const undead = foesNear(g, p, 6).filter(m => m.faction === 'undead');
      if (!undead.length) return g.log('No undead in reach.'), false;
      g.fx.area(p, 6, '#3a3a20');
      undead.forEach(m => { p.attack(m, g, { pierce: true, verb: 'sear' }); if (m.alive) applyStatus(m, 'fear', 6, g); });
      return true;
    } },
  sanctuary: { name: 'Sanctuary', mp: 9, cd: 12, lvl: 5, desc: 'Heal everyone friendly within 4 for 9 + 3 x INT; enemies within 2 are stunned 2.',
    use: (g, p) => {
      const n = 9 + 3 * p.spellPower;
      g.fx.area(p, 2, '#4a4a20');
      friendsNear(g, p, 4).forEach(f => heal(g, f, n));
      foesNear(g, p, 2).forEach(m => applyStatus(m, 'stun', 2, g));
      castLog(g, p, `A dome of holy light settles over ${partyOf(g, p)}.`, '#ffd');
      return true;
    } },
  holyfire: { magic: true, name: 'Holy Fire', mp: 10, cd: 8, book: true, desc: 'Every visible enemy burns in holy fire (x1.2, undead x2.4).',
    use: (g, p) => burst(g, p, 99, '#4a3a10', m => p.attack(m, g, { mult: m.faction === 'undead' ? 2.4 : 1.2, pierce: true, verb: 'purge', status: { burn: 3 } })) },
  purify: { name: 'Purify', mp: 3, cd: 4, lvl: 4, desc: 'Cleanse yourself and allies within 4 of every harmful effect (stun, poison, curse, fear...).',
    use: (g, p) => {
      const hit = friendsNear(g, p, 4).filter(hasBadStatus);
      if (!hit.length) return castLog(g, p, 'Nobody nearby needs purifying.'), false;
      hit.forEach(f => { for (const k in f.status) if (STATUS[k].bad) delete f.status[k]; g.fx.flash(f, '#4a4a20'); });
      castLog(g, p, `Purifying light washes over ${partyOf(g, p)}.`, '#ffd');
      return true;
    } },
  consecrate: { name: 'Consecrate', mp: 7, cd: 12, lvl: 6, range: 6, ground: true, desc: 'Hallow the ground within 1 of a spot for 8 turns: friends on it heal 2 a turn, undead burn for 4.',
    use: (g, p, t) => {
      const n = g.map.cells((x, y) => dist({ x, y }, t) <= 1).filter(c => placeTimed(g, c.x, c.y, 'holyground', 8)).length;
      if (!n) return castLog(g, p, 'The ground there cannot be hallowed.'), false;
      castLog(g, p, 'The ground glows with holy light.', '#ffd');
      return true;
    } },
  resurrect: { name: 'Resurrection', mp: 12, cd: 30, lvl: 8, desc: 'Call your most recently fallen companion back to your side at half HP.',
    use: (g, p) => {
      const b = g.fallen?.[g.fallen.length - 1], spot = freeCellsNear(g, p)[0];
      if (!b) return castLog(g, p, 'No fallen companion to call back.'), false;
      if (!spot) return castLog(g, p, 'There is no room beside you.'), false;
      g.fallen.pop();
      Object.assign(b, spot, { hp: Math.ceil(b.maxHp / 2), status: {}, cooldowns: {}, order: null, target: null, hold: false });
      g.monsters.push(b);
      g.fx.flash(b, '#5a5a20');
      g.log(`Holy light gathers - your ${b.name} returns to life!`, '#ffd');
      return true;
    } },
  favor: { name: 'Divine Favor', mp: 12, cd: 20, book: true, desc: 'Fully heal yourself and allies within 6 and cleanse poison, burning and curses.',
    use: (g, p) => {
      friendsNear(g, p, 6).forEach(f => { heal(g, f, f.maxHp); ['poison', 'burn', 'cursed', 'afflicted'].forEach(k => delete f.status[k]); });
      castLog(g, p, `Divine favor washes over ${partyOf(g, p)}.`, '#ffd');
      return true;
    } },

  // Trickster (Puck / Pocket)
  orb: { magic: true, name: 'Illusory Orb', mp: 4, cd: 3, range: 8, ground: true, desc: 'Orb flies 8 tiles toward a target, hitting all in its path (x1.3). Lingers 3 turns.',
    use: (g, p, t) => {
      const len = dist(p, t) || 1;
      const end = { x: p.x + Math.round((t.x - p.x) / len * 8), y: p.y + Math.round((t.y - p.y) / len * 8) };
      let last = p;
      for (const c of line(p.x, p.y, end.x, end.y).slice(1)) {
        if (!g.map.walkable(c.x, c.y) || !g.map.canStep(last.x, last.y, c.x, c.y)) break;
        last = c;
        const m = g.monsterAt(c.x, c.y);
        if (m && !m.ally) p.attack(m, g, { mult: 1.3, pierce: true, verb: 'blast' });
      }
      g.fx.bolt(p, last, 'o', '#f6f');
      g.orb = { x: last.x, y: last.y, ttl: 3 };
      return true;
    } },
  jaunt: { name: 'Ethereal Jaunt', mp: 2, lvl: 2, free: true, desc: 'Teleport to your Illusory Orb. Takes no turn.',
    use: (g, p) => {
      if (!g.orb) return g.log('No orb to jaunt to.'), false;
      const spot = g.map.walkable(g.orb.x, g.orb.y) && !g.occupied(g.orb.x, g.orb.y) ? g.orb : pick(freeCellsNear(g, g.orb));
      if (!spot) return g.log('The orb is blocked.'), false;
      g.fx.flash(p, '#553355');
      Object.assign(p, { x: spot.x, y: spot.y });
      g.orb = null;
      return true;
    } },
  rift: { magic: true, name: 'Waning Rift', mp: 5, cd: 4, lvl: 2, range: 5, desc: 'Blink beside a target; enemies within 2 take damage and are silenced 3.',
    use: (g, p, t) => {
      const spot = pick(freeCellsNear(g, t));
      if (!spot) return g.log('No room beside the target.'), false;
      g.fx.flash(p, '#553355');
      Object.assign(p, spot);
      burst(g, p, 2, '#3a2a4a', m => p.attack(m, g, { pierce: true, verb: 'rift', status: { silenced: 3 } }));
      return true;
    } },
  phaseshift: { name: 'Phase Shift', mp: 4, cd: 8, lvl: 3, desc: 'Shift out of reality: immune to all damage for 2 turns.',
    use: (g, p) => (g.fx.area(p, 1, '#6a2a6a'), applyStatus(p, 'phased', 3, g), true) }, // burst as reality tears
  coil: { magic: true, name: 'Dream Coil', mp: 8, cd: 10, lvl: 5, range: 7, desc: 'Stun + coil enemies within 2 of target; any that stray past 2 tiles get snapped (big dmg, stun 3).',
    use: (g, p, t) => {
      g.coil = { x: t.x, y: t.y, ttl: 6 };
      return burst(g, g.coil, 2, '#2a2a66', m => {
        p.attack(m, g, { pierce: true, verb: 'coil', status: { stun: 1 } });
        if (m.alive) applyStatus(m, 'coiled', 6, g);
      });
    } },
  barrage: { magic: true, name: 'Barrage', mp: 8, cd: 4, book: true, range: 7, ground: true, desc: 'Rain 3 volleys on the area around a target (x0.7 each).',
    use: (g, p, t) => {
      const c = { x: t.x, y: t.y };
      g.fx.area(c, 1, '#4a2a10');
      for (let v = 0; v < 3; v++) foesNear(g, c, 1).forEach(m => p.attack(m, g, { mult: 0.7, verb: 'pelt' }));
      return true;
    } },
  affliction: { name: 'Affliction', mp: 7, cd: 6, book: true, desc: 'Afflict visible enemies within 5: 3 dmg/turn for 6 turns.',
    use: (g, p) => burst(g, p, 5, '#3a1a2a', m => applyStatus(m, 'afflicted', 6, g)) },
};

for (const [id, s] of Object.entries(SKILLS)) s.id = id; // lets code holding a skill find its cooldown slot

// AI spellcasting (companions and enemy casters with a `skills` list): uses the first of m's skills that makes sense
// now, in priority order - heals, then party buffs, then everything else (random order), then the free basic attack.
// Monsters without mana (no `mp`) are limited by cooldowns alone.
// Heals when someone friendly nearby is below 60%; party buffs when a fight is on and it isn't already shielded;
// self-buffs below half HP; the rest need an enemy (`foe`): targeted skills in range, area skills within 2
// (or anywhere, for ANYWHERE_SKILLS).
const HEAL_SKILLS = ['heal', 'sanctuary', 'favor'];
const PARTY_BUFFS = ['bless'];
const SELF_SKILLS = ['ironskin', 'arcaneshield', 'phaseshift', 'secondwind', 'blink', 'vanish', 'jaunt', 'roll'];
const ANYWHERE_SKILLS = ['raise', 'army', 'corpseboom', 'plague', 'timestop', 'holyfire']; // work at any distance
// Support skills with their own trigger (ranked with heals): used only when needed.
const NEEDED_WHEN = {
  purify: (g, m) => friendsNear(g, m, 4, m).some(hasBadStatus),
  resurrect: (g, m) => g.factionOf(m) === 'player' && g.fallen?.length > 0,
};
function aiCast(g, m, foe) {
  const hurt = friendsNear(g, m, 4, m).some(f => f.hp < f.maxHp * 0.6), basic = m.cls && SKILL_TREES[m.cls.key].basic;
  const rank = id => HEAL_SKILLS.includes(id) || NEEDED_WHEN[id] ? 0 : PARTY_BUFFS.includes(id) ? 1 : 2;
  const order = shuffle(m.skills.filter(id => id !== basic)).sort((a, b) => rank(a) - rank(b)); // stable: random within a rank
  for (const id of [...order, ...(basic ? [basic] : [])]) {
    const s = SKILLS[id];
    if ((m.mp != null && m.mp < s.mp) || m.cooldowns?.[id] || (id === 'jaunt' && !g.orb)) continue;
    if (NEEDED_WHEN[id] ? !NEEDED_WHEN[id](g, m)
      : HEAL_SKILLS.includes(id) ? !hurt
      : PARTY_BUFFS.includes(id) ? !foe || m.status.shield
      : SELF_SKILLS.includes(id) ? m.hp > m.maxHp / 2 || !foe
      : !foe ? true
      : s.range ? !(dist(m, foe) <= (m.skillRange?.[id] ?? s.range) && g.map.hasLos(m, foe)) // skillRange: per-monster override
      : !ANYWHERE_SKILLS.includes(id) && dist(m, foe) > 2) continue;
    // Announce first so the spell's effects read after it; take the line back if the spell fizzles.
    // enemies: "<Name> casts Firebolt!", or the skill's own `act` line ("charges!") for skills that aren't spells
    const said = g.map.visible[m.y][m.x] && g.log(m.ally ? `The ${m.name} used ${s.name}.` : `${m.subj} ${s.act || `casts ${s.name}`}!`, m.ally ? '#8cf' : '#f96');
    if (!g.runSkill(s, m, foe)) { if (said && g.messages[g.messages.length - 1] === said) g.messages.pop(); continue; }
    if (m.mp != null) m.mp -= s.mp;
    return true;
  }
  return false;
}

// You can have ACTIVE_SKILLS skills on your hotbar (keys 1-5, the first entries of player.skills); any others you know
// wait in reserve until you swap them in (K: pick one up and move it). Companions aren't limited.
const ACTIVE_SKILLS = 5;

// Each class: core = the essentials, unlocked automatically at each skill's level (core[0] known from the start); pool = everything else,
// only found during a run - reading your class's tome offers TOME_CHOICES random unknown pool skills to keep one
// (Game.readBook), so the same class plays differently run to run. basic: a free attack known from the start.
// Companions: core + a few random pool skills, and another now and then as they level (makeCaptive, growCompanion).
const TOME_CHOICES = 3;
const startingSkills = cls => [SKILL_TREES[cls.key].basic, SKILL_TREES[cls.key].core[0]].filter(Boolean); // basic attack on key 1
const SKILL_TREES = {
  warrior:     { core: ['cleave', 'charge'], pool: ['warcry', 'ironskin', 'shieldbash', 'whirlwind', 'taunt', 'earthshatter', 'secondwind'] },
  archer:      { basic: 'bowshot', core: ['aimedshot', 'roll'], pool: ['pinshot', 'volley', 'snaretrap', 'rain', 'piercing', 'explosive', 'snipe'] },
  cleric:      { core: ['heal', 'smite'], pool: ['bless', 'turnundead', 'purify', 'sanctuary', 'consecrate', 'resurrect', 'holyfire', 'favor'] },
  rogue:       { core: ['smoke', 'backstab'], pool: ['knives', 'envenom', 'shadowstep', 'caltrops', 'fan', 'vanish'] },
  mage:        { basic: 'zap', core: ['firebolt', 'blink'], pool: ['frostnova', 'arcaneshield', 'chain', 'icewall', 'meteor', 'timestop'] },
  necromancer: { basic: 'wither', core: ['raise'], pool: ['drain', 'bonespear', 'curse', 'corpseboom', 'army', 'plague'] },
  trickster:   { core: ['orb', 'jaunt'], pool: ['rift', 'phaseshift', 'coil', 'barrage', 'affliction'] },
};
// Up to n random pool skills `e` doesn't know, favouring ones within reach of its level (skill lvl <= e.lvl + 2).
function poolPicks(e, n) {
  const ok = id => (SKILLS[id].lvl || 1) <= (e.lvl || 1) + 2;
  return shuffle(SKILL_TREES[e.cls.key].pool.filter(id => !e.skills.includes(id))).sort((a, b) => ok(b) - ok(a)).slice(0, n);
}
