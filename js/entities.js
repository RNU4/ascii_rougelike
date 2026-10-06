// Entity base (combat, statuses) + Player (gear, xp, skills) + Monster (AI key, allegiance).
class Entity {
  constructor(template, x, y) {
    Object.assign(this, { crit: 0.05 }, template);
    this.status = {};
    this.maxHp = this.hp;
    this.x = x; this.y = y;
  }
  get alive() { return this.hp > 0; }
  // Gear (player and companions): `gear` maps SLOTS to items; `base` holds hp/mp/crit before gear.
  gearStat(k) { return this.gear ? SLOTS.reduce((sum, s) => sum + (this.gear[s]?.stats[k] || 0), 0) : 0; }
  get power() { return this.atk + this.gearStat('atk'); }
  // Intelligence (INT) scales spells; monsters without a `int` use their ATK.
  get spellPower() { return (this.int ?? this.atk) + this.gearStat('int'); }
  // INT gained beyond the class's starting INT (gear, levels). Feeds max MP (recalc) and cooldowns (cooldownOf).
  get bonusInt() { return this.cls ? Math.max(0, this.spellPower - this.cls.int) : 0; }
  // A skill's cooldown for this caster: 1 turn shorter per 5 bonus INT, never below 1.
  cooldownOf(s) { return s.cd ? Math.max(1, s.cd - Math.floor(this.bonusInt / 5)) : 0; }
  get armor() { return Math.max(0, this.def + statusMod(this, 'def')) + this.gearStat('def'); }

  // Re-derive gear-dependent stats after equipping or levelling. Every class gets +2 max MP per INT above its class's
  // starting INT (from gear or levels), so INT helps skill-users of any kind, not just spellcasters.
  recalc() {
    this.maxHp = this.base.hp + this.gearStat('hp');
    this.maxMp = this.base.mp + this.gearStat('mp') + 2 * this.bonusInt;
    this.crit = this.base.crit + this.gearStat('crit') / 100;
    this.hp = Math.min(this.hp, this.maxHp);
    this.mp = Math.min(this.mp, this.maxMp);
  }
  get subj() { return this.name[0].toUpperCase() + this.name.slice(1); }
  get obj() { return 'the ' + this.name; }
  verb(v) { return v + (/(ch|sh|s|x)$/.test(v) ? 'es' : 's'); } // scorch -> scorches

  // Returns damage dealt. `status` (or the attacker's onHit) is applied to the target on hit.
  // magic: scales with INT instead of ATK - on by default while a skill marked `magic` is being cast (game.casting).
  attack(target, game, { mult = 1, verb = 'hit', pierce = false, crit = false, status = null, magic = !!game.casting?.magic } = {}) {
    if (target.partOf && game.casting && target.partOf.hitByCast === game.castN) return 0; // this skill already hit that Colossus
    if (target.status.phased) return game.log(`${this.subj} ${this.verb('strike')} at ${target.obj}, but hit only air.`, '#f9f'), 0;
    if (chance((target.dodge || 0) + target.gearStat('dodge') / 100)) // Slippery (Trickster), silk gear
      return game.log(`${target.subj} ${target.verb('slip')} away from ${this.obj}'s attack!`, '#f9f'), 0;
    if (this.steadyAim && dist(this, target) >= 3) mult *= 1 + this.steadyAim; // Steady Aim (Archer)
    const isCrit = crit || chance(this.crit);
    const raw = Math.round(((magic ? this.spellPower : this.power) + rand(-1, 1)) * mult * (isCrit ? 2 : 1));
    const dmg = Math.max(1, raw - (pierce ? 0 : target.armor) - (target.hardened || 0)); // Hardened (Warrior)
    const p = game.player, seen = game.map.visible[target.y]?.[target.x];
    if (this === p || target === p || seen) // monster-vs-monster fights only show up when you can see them
      game.log(`${this.subj} ${this.verb(verb)} ${target.obj} for ${dmg}${isCrit ? ' (critical!)' : ''}.`, target === p ? '#f88' : '#ddd');
    target.hurt(dmg, game, this);
    const thorns = target.gearStat('thorns'); // (bone gear) striking it in melee hurts
    if (thorns && this.alive && !magic && dist(this, target) <= 1) {
      if (this === p || target === p) game.log(`${this.subj} ${this.verb('cut')} ${this === p ? 'yourself' : 'itself'} on ${target === p ? 'your' : 'its'} bone spikes for ${thorns}.`, '#e0d4b0');
      this.hurt(thorns, game, target);
    }
    if (this.drain) this.hp = Math.min(this.maxHp, this.hp + dmg * (this.drain === true ? 1 : this.drain)); // drain (leeches, the Wight): heals by the damage dealt (x drain if a number)
    if (this.gearStat('venom') && target.alive) applyStatus(target, 'poison', this.gearStat('venom'), game); // (Broodfang)
    const onHit = status || this.onHit;
    if (target.alive && onHit) for (const [k, n] of Object.entries(onHit)) applyStatus(target, k, n, game);
    if (target.alive && this.chill && chance(this.chill)) applyStatus(target, 'frozen', 1, game); // chill: a chance its hits freeze you a turn (the Wight's grave-cold)
    return dmg;
  }

  // at: where the blow landed (a Colossus part passes its own tile when its core takes the damage).
  hurt(n, game, src, at = this) {
    if (this.partOf) { // a Colossus part: the core takes it - once per skill use, however many parts the skill caught
      const core = this.partOf;
      if (game.casting && core.hitByCast === game.castN) return;
      if (game.casting) core.hitByCast = game.castN;
      return core.hurt(n, game, src, this);
    }
    if (this.status.phased || (this === game.player && game.ghost)) return; // debug ghost mode: no damage
    if (this.lightWeak && game.map.isLit(this.x, this.y)) n = Math.round(n * 1.5); // exposed in the light (the Wight)
    if (src === game.player || src?.ally) game.provoke(this);
    this.awake = true; // getting hurt wakes anyone (e.g. goblins jumped by the troll out of your sight)
    if (this.manaShield && this.mp > this.maxMp / 2) { // Mana Shield (Mage): mana above half soaks damage first
      const soak = Math.min(n, this.mp - Math.floor(this.maxMp / 2));
      this.mp -= soak; n -= soak;
      if (game.map.visible[this.y]?.[this.x]) game.log(`${this.subj === 'You' ? 'Your' : this.subj + "'s"} mana shield absorbs ${soak} damage.`, '#8cf');
      game.fx.float(at, '-' + soak, '#6cf'); // absorbed: a blue number...
      this.flashCss = { turn: game.turn, css: 'shieldhit' }; // ...and a blue ripple round it (renderMap)
      if (!n) return game.fx.flash(this, '#223a66');
    }
    this.hp -= n;
    game.fx.flash(at, '#900');
    game.fx.float(at, '-' + n, this === game.player ? '#ff5a5a' : '#ffffff');
    if (!this.alive) game.onDeath(this, src);
    else if (this.body) shedBody(this, game); // a multi-tile creature sheds parts as it weakens
  }
}

class Player extends Entity {
  constructor(cls, x, y) {
    super({ ...cls, name: 'you' }, x, y);
    this.cls = cls;
    this.maxMp = this.mp;
    this.base = { hp: this.hp, mp: this.mp, crit: this.crit }; // before gear
    this.lvl = 1; this.xp = 0;
    this.skills = startingSkills(cls);
    this.gear = Object.fromEntries(SLOTS.map(s => [s, null]));
    this.inv = [];
  }
  get subj() { return 'You'; }
  get obj() { return 'you'; }
  verb(v) { return v; }

  attack(target, game, opts) {
    delete this.status.hidden; // attacking reveals you
    return super.attack(target, game, opts);
  }

  learn(id, game) {
    this.skills.push(id);
    const n = this.skills.length;
    game.log(`You learned ${SKILLS[id].name}! ${n <= ACTIVE_SKILLS ? `It is on key ${n}.` : `Your ${ACTIVE_SKILLS} skill slots are full - it waits in reserve (K to swap it in).`}`, '#ff0');
  }

  gainXp(n, game) {
    this.xp += n;
    while (this.xp >= this.lvl * 20) {
      this.xp -= this.lvl * 20;
      this.lvl++;
      levelUpStats(this);
      game.log(`You reach level ${this.lvl}!`, '#ff0');
      // Core skills unlock by themselves once you're high enough (the rest come from tomes).
      SKILL_TREES[this.cls.key].core.filter(id => !this.skills.includes(id) && (SKILLS[id].lvl || 1) <= this.lvl).forEach(id => this.learn(id, game));
      const buddies = game.monsters.filter(m => m.companion && m.alive);
      buddies.forEach(growCompanion);
      if (buddies.length) game.log(`Your ${buddies.length > 1 ? 'companions grow' : buddies[0].name + ' grows'} stronger too.`, '#8cf');
    }
  }
}

// Stat gains for reaching e.lvl (player and companions): +hpPerLevel HP (default 6), +2 MP, DEF every other level.
// ATK/INT +1 every atkEvery/intEvery levels - by default casters (cls.caster) gain INT every level and ATK every other,
// everyone else the reverse. No heal: current HP/MP only go up by what the maximums gained.
function levelUpStats(e) {
  const c = e.cls, every = (n, def) => e.lvl % (n ?? def) === 0, { maxHp, maxMp } = e;
  e.base.hp += c.hpPerLevel ?? 6; e.base.mp += 2;
  if (every(c.atkEvery, c.caster ? 2 : 1)) e.atk++;
  if (every(c.intEvery, c.caster ? 1 : 2)) e.int++;
  if (e.lvl % 2 === 0) e.def++;
  e.recalc(); e.hp += e.maxHp - maxHp; e.mp += e.maxMp - maxMp;
}

// Companions grow a level alongside the player, with the same gains. They learn their next core skill once its level
// allows, and on every other level a random pool skill (they find their own tomes, so to speak).
function growCompanion(m) {
  m.lvl = (m.lvl || 1) + 1;
  levelUpStats(m);
  const { core, pool } = SKILL_TREES[m.cls.key], can = id => !m.skills.includes(id) && (SKILLS[id].lvl || 1) <= m.lvl;
  const next = core.find(can) || (m.lvl % 2 === 0 && pick(pool.filter(can)));
  if (next) m.skills.push(next);
}

class Monster extends Entity {
  get alive() { return this.hp > 0 && !this.underground; } // a burrowed bone worm is out of play until it resurfaces
  constructor(template, x, y) {
    super(template, x, y);
    this.awake = !!(template.ally || template.alwaysAwake); // alwaysAwake: drifts about even unseen (wisps)
    if (template.guard) this.home = { x, y }; // guards return here when they have nothing to fight
    if (template.wounded) this.hp = Math.ceil(this.maxHp * template.wounded); // starts at this share of its HP
  }
}
