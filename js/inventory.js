// Pack & equipment actions and their menus (I key). Each action returns true if it used a turn.
Object.assign(Game.prototype, {
  // Consumables stack by name. Returns false if there's no room. `p`: whose pack (you, or a companion's).
  addItem(item, p = this.player) {
    p.inv ||= [];
    const stack = item.kind === 'consumable' && p.inv.find(i => i.name === item.name);
    if (stack) { stack.count += item.count; return true; }
    if (p.inv.length >= PACK_SIZE) return false;
    p.inv.push(item);
    return true;
  },

  equip(item) {
    const p = this.player, old = p.gear[item.slot];
    if (!canWear(p, item)) return this.log(`Only spellcasters can use ${itemName(item)}.`, '#f88'), false;
    p.inv.splice(p.inv.indexOf(item), 1);
    if (old) p.inv.push(old);
    p.gear[item.slot] = item;
    p.recalc();
    this.log(`You equip ${itemName(item)}${old ? `, stowing ${itemName(old)}` : ''}.`);
    return true;
  },

  unequip(slot) {
    const p = this.player, item = p.gear[slot];
    if (p.inv.length >= PACK_SIZE) return this.log('Your pack is full.'), false;
    p.gear[slot] = null;
    p.inv.push(item);
    p.recalc();
    this.log(`You take off ${itemName(item)}.`);
    return true;
  },

  drop(item) {
    const p = this.player;
    p.inv.splice(p.inv.indexOf(item), 1);
    this.items.push({ ...item, x: p.x, y: p.y });
    this.log(`You drop ${itemName(item)}.`);
    return true;
  },

  useItem(item) {
    const p = this.player;
    this.log(`You use the ${item.name}.`, '#8cf');
    item.use(this, p);
    if (--item.count <= 0) p.inv.splice(p.inv.indexOf(item), 1);
    return true;
  },

  // Hand a piece of gear to an adjacent companion; what they wore in that slot comes back to you.
  giveGear(item, buddy) {
    const p = this.player, old = buddy.gear[item.slot];
    if (!canWear(buddy, item)) return this.log(`Your ${buddy.name} can't use ${itemName(item)}.`, '#f88'), false;
    p.inv.splice(p.inv.indexOf(item), 1);
    buddy.gear[item.slot] = item;
    buddy.recalc();
    this.log(`The ${buddy.name} equips ${itemName(item)}.`, '#8cf');
    if (old && !this.addItem(old)) this.items.push({ ...old, x: p.x, y: p.y }); // pack full: it lands at your feet
    else if (old) this.log(`You take back ${itemName(old)}.`);
    return true;
  },

  takeGear(buddy, slot) {
    const item = buddy.gear[slot];
    if (!this.addItem(item)) return this.log('Your pack is full.'), false;
    buddy.gear[slot] = null;
    buddy.recalc();
    this.log(`You take ${itemName(item)} from the ${buddy.name}.`);
    return true;
  },

  // Party (P): list companions; each opens a sheet with stats, skills and worn gear.
  openParty() {
    const p = this.player, buddies = this.monsters.filter(o => o.companion && o.alive), skels = minionsOf(this, p);
    const lines = buddies.map(b => ({ text: `${b.name.padEnd(12)} Lv ${b.lvl}  HP ${b.hp}/${b.maxHp}  MP ${b.mp}/${b.maxMp}${b.hold ? '  (waiting)' : ''}`, run: () => this.openCompanion(b) }));
    if (skels.length || p.skills.some(id => ['raise', 'army'].includes(id)))
      lines.push({ text: '' }, { text: `<span style="color:#a6f">Skeletons ${skels.length}/${minionCap(p)}</span>  ` +
        (skels.map(s => `${s.hp}/${s.maxHp}`).join('  ') || 'none raised') + (skels[0]?.hold ? '  (waiting)' : '') });
    this.openMenu('PARTY', lines.length ? lines : [{ text: 'You have no companions. Free a captive from a goblin prison pen.' }]);
  },

  // Tactics (T): orders and a stance for all your allies (companions and raised skeletons). Orders take no turn.
  // Orders (m.order): attack a monster, go to a tile (then hold), regroup with you. Stance (game.allyStance):
  // aggressive = engage anything in sight; defensive = stay close, fight only what's near you or next to them;
  // passive = never attack, just follow, heal and buff. See AI.ally.
  openTactics() {
    const allies = () => this.monsters.filter(o => o.ally && o.alive);
    if (!allies().length) return this.log('You have no allies to command.');
    const order = (o, msg) => { allies().forEach(a => { a.order = o && { ...o }; if (o) a.hold = false; }); this.alliesHold = false; this.log(msg, '#8cf'); return false; };
    const aim = (name, ground, list, pick) => { this.targeting = { skill: { name, range: 99, ground }, list, i: 0, pick, ...(ground && { cursor: { x: this.player.x, y: this.player.y } }) }; return false; };
    const foes = () => this.hostilesWhere(m => this.seesMonster(m)).sort((a, b) => dist(a, this.player) - dist(b, this.player));
    const stance = this.allyStance || 'aggressive', setStance = s => { this.allyStance = s; this.log(`Your allies take a ${s} stance.`, '#8cf'); this.openTactics(); return false; };
    const hold = allies().every(a => a.hold);
    this.openMenu('TACTICS', [
      { text: 'Orders <span style="color:#777">(apply to all your allies; take no turn)</span>' },
      { text: 'Attack my target...', enabled: foes().length > 0, run: () => aim('Attack order', false, foes(), t => order({ type: 'attack', target: t }, `You point at ${t.obj}: "Take it down!"`)) },
      { text: 'Go to a spot...', run: () => aim('Go-there order', true, [], t => this.map.walkable(t.x, t.y) ? order({ type: 'goto', x: t.x, y: t.y }, 'You send your allies ahead.') : (this.log("They can't go there.", '#f88'), false)) },
      { text: 'Regroup (come back to me now)', run: () => order({ type: 'regroup' }, 'You call your allies back to your side.') },
      { text: hold ? 'Follow me' : 'Hold here', run: () => { allies().forEach(a => { a.hold = !hold; a.order = null; }); this.alliesHold = !hold; this.log(hold ? 'You wave your allies to follow.' : 'You tell your allies to wait here.', '#8cf'); return false; } },
      { text: '' },
      { text: 'Stance' },
      ...[['aggressive', 'engage anything in sight'], ['defensive', 'stay close; fight only what threatens you or them'], ['passive', 'never attack; follow, heal and buff']]
        .map(([s, what]) => ({ text: `${s === stance ? '<span style="color:#6d6">&#9679;</span>' : ' '} ${s.padEnd(11)}<span style="color:#777">${what}</span>`, run: () => setStance(s) })),
    ]);
  },

  openCompanion(b) {
    const near = dist(b, this.player) === 1;
    const worn = SLOTS.map(slot => {
      const it = b.gear[slot], label = slot.padEnd(8);
      return it ? { text: `${label}${itemName(it)}  <span style="color:#999">${fmtStats(it.stats)}</span>`, enabled: near, run: () => this.takeGear(b, slot) }
        : { text: `   ${label}<span style="color:#555">-</span>` };
    });
    this.openMenu(`COMPANION - ${b.name}`, [
      { text: `<span style="color:${b.color}">${b.cls.title}</span>  Lv ${b.lvl}   HP ${b.hp}/${b.maxHp}  MP ${b.mp}/${b.maxMp}  ATK ${b.power}  INT ${b.spellPower}  DEF ${b.armor}  crit ${Math.round(b.crit * 100)}%` },
      { text: `Skills: ${b.skills.map(id => SKILLS[id].name).join(', ')}` },
      { text: '' },
      { text: near ? '<b>Gear</b> (pick an item or potion to take it back; give from your inventory)' : '<b>Gear</b> <span style="color:#777">(stand next to them to trade gear)</span>' },
      ...worn,
      { text: '' },
      { text: '<b>Potions</b> <span style="color:#777">(give with G in your inventory; they drink them when needed in a fight)</span>' },
      ...(b.inv?.length ? b.inv.map(it => ({ text: `   ${itemName(it)}  <span style="color:#999">${it.desc}</span>`, enabled: near, run: () => this.takePotions(b, it) }))
        : [{ text: '   <span style="color:#555">none</span>' }]),
      { text: '' },
      { text: 'Back', run: () => this.openParty() },
    ], false);
  },

  // Hand one potion to an adjacent companion; they carry it and drink it when they need it (companionDrink).
  giveItem(item, buddy) {
    if (!this.addItem({ ...item, count: 1 }, buddy)) return this.log(`Your ${buddy.name} can't carry any more.`, '#f88'), false;
    this.log(`You hand a ${item.name} to the ${buddy.name}.`, '#8cf');
    if (--item.count <= 0) this.player.inv.splice(this.player.inv.indexOf(item), 1);
    return true;
  },

  takePotions(buddy, item) {
    if (!this.addItem(item)) return this.log('Your pack is full.'), false;
    buddy.inv.splice(buddy.inv.indexOf(item), 1);
    this.log(`You take back ${itemName(item)} from the ${buddy.name}.`);
    return true;
  },

  // A companion's turn spent drinking, if it needs to and a fight is on (something targets it, or an enemy within 5): a healing potion below 40% HP (the smallest
  // that covers what it's missing, like R), else a mana potion below 25% MP.
  companionDrink(m) {
    const inv = m.inv || [];
    const threat = this.inCombat(m) || this.monsters.some(o => o.alive && this.hostile(m, o) && this.seesMonster(o) && dist(o, m) <= 5);
    if (!inv.length || !threat) return false;
    const heals = inv.filter(i => i.heals).sort((a, b) => a.heals - b.heals);
    const pot = (m.hp < m.maxHp * 0.4 && (heals.find(i => i.heals >= m.maxHp - m.hp) || heals[heals.length - 1]))
      || (m.mp < m.maxMp * 0.25 && inv.find(i => i.mana));
    if (!pot) return false;
    if (this.map.visible[m.y][m.x]) this.log(`The ${m.name} drinks a ${pot.name}.`, '#8cf');
    pot.use(this, m);
    if (--pot.count <= 0) inv.splice(inv.indexOf(pot), 1);
    return true;
  },

  // Take off a worn item and drop it at your feet.
  dropWorn(slot) {
    const p = this.player, item = p.gear[slot];
    p.gear[slot] = null;
    p.recalc();
    this.items.push({ ...item, x: p.x, y: p.y });
    this.log(`You take off and drop ${itemName(item)}.`);
    return true;
  },

  // What each key does to an inventory row ({ item, slot } - slot set when worn). Every fn returns true if it spent
  // a turn. Enter runs the row's default (unequip / equip / use). G gives to the first adjacent companion.
  itemKeys({ item, slot }) {
    const p = this.player, buddy = this.giveTarget(item);
    if (slot) return { KeyE: () => this.unequip(slot), KeyD: () => this.dropWorn(slot) };
    const k = { KeyD: () => this.drop(item) };
    if (item.kind === 'gear') { if (canWear(p, item)) k.KeyE = () => this.equip(item); if (buddy) k.KeyG = () => this.giveGear(item, buddy); }
    if (item.kind === 'consumable') { k.KeyU = () => this.useItem(item); if (buddy && item.give) k.KeyG = () => this.giveItem(item, buddy); }
    if (item.kind === 'book') { k.KeyU = () => this.readBook(item); if (buddy) k.KeyG = () => this.readBook(item, buddy); }
    return k;
  },

  // Inventory (I): worn gear and pack on one screen. Arrow to an item and press a key - no per-item sub-menu.
  // The panel below the list describes the selected item and compares gear with what you (and a companion) wear.
  openInventory() {
    const p = this.player, stay = fn => () => { // keep the screen open - unless the action opened another (a tome's choice)
      const menu = this.menu, spent = fn();
      if (this.menu === menu) this.openInventory();
      return spent;
    };
    const row = (item, slot) => ({ item, slot, run: stay(() => { const k = this.itemKeys({ item, slot }); return (k.KeyE || k.KeyU || (() => false))(); }) });
    const worn = SLOTS.map(slot => {
      const it = p.gear[slot], label = slot.padEnd(8);
      return it ? { ...row(it, slot), text: `${label}${itemName(it)}` } // (its stats: the details panel)
        : { text: `  ${label}<span style="color:#555">-</span>` };
    });
    const pack = p.inv.map(it => ({ ...row(it), text: itemName(it) + (it.kind === 'gear' ? `  [${compareGear(it, p.gear[it.slot])}]` : '') })); // (stats / what it does: the details panel)
    this.openMenu('INVENTORY', [
      { text: '<span style="color:#999">Enter default · E equip/unequip · U use · D drop · G give · R heal · Esc</span>' },
      { text: '' },
      { text: `<b>Equipped</b>   ATK ${p.power}  INT ${p.spellPower}  DEF ${p.armor}  HP ${p.maxHp}  MP ${p.maxMp}  crit ${Math.round(p.crit * 100)}%` },
      ...worn, { text: '' },
      { text: `<b>Pack</b> ${p.inv.length}/${PACK_SIZE}  <span style="color:#777">[brackets: change vs. what you wear]</span>` },
      ...(pack.length ? pack : [{ text: '   (empty)' }]),
    ], true, {
      noLetters: true,
      keys: r => r && Object.fromEntries(Object.entries(this.itemKeys(r)).map(([key, fn]) => [key, stay(fn)])),
      detail: r => r && this.itemDetail(r),
    });
  },

  // First adjacent companion who could use `item` (gear they can wear; a tome of their class; anything else).
  giveTarget(item) {
    return this.monsters.find(o => o.companion && o.alive && dist(o, this.player) === 1
      && (item.kind === 'gear' ? canWear(o, item) : item.kind === 'book' ? o.cls === item.cls : true));
  },

  // Detail panel for the selected inventory row.
  itemDetail({ item, slot }) {
    const p = this.player, buddy = this.giveTarget(item);
    const have = this.itemKeys({ item, slot }), label = { KeyE: slot ? 'E unequip' : 'E equip', KeyU: 'U use', KeyD: 'D drop', KeyG: `G give to ${buddy?.name}` };
    const keys = ['KeyE', 'KeyU', 'KeyG', 'KeyD'].filter(k => have[k]).map(k => label[k]);
    const lines = [`  <b>${itemName(item)}</b>  <span style="color:#777">${item.kind === 'gear' ? `${item.rarity} ${item.slot}${slot ? ' (worn)' : ''}` : item.kind}</span>`,
      `  ${itemInfo(item)}`];
    if (item.kind === 'gear' && !slot) {
      const worn = p.gear[item.slot];
      lines.push(`  Worn now: ${worn ? `${itemName(worn)} ${fmtStats(worn.stats)}` : 'nothing'}   Change if equipped: ${compareGear(item, worn)}`);
      if (buddy) lines.push(`  For your ${buddy.name}: ${compareGear(item, buddy.gear[item.slot])}`);
    }
    if (item.kind === 'gear' && !canWear(p, item)) lines.push('  <span style="color:#f88">Only spellcasters can use this - but a caster companion could.</span>');
    lines.push(`  <span style="color:#ff8">${keys.join(' · ')}</span>`);
    return lines.join('\n');
  },

  // Pile (G on a tile with several items): take one at a time, or everything. Stays open while items remain.
  openPile() {
    const p = this.player, here = this.itemsAt(p.x, p.y);
    if (!here.length) return;
    const again = fn => () => { const spent = fn(); if (this.itemsAt(p.x, p.y).length) this.openPile(); return spent; };
    this.openMenu('PILE', [
      { text: `${here.length} items here. Pack ${p.inv.length}/${PACK_SIZE}.` }, { text: '' },
      ...here.map(it => ({ text: `${itemName(it)}  <span style="color:#999">${itemInfo(it)}</span>`, run: again(() => this.takeItem(it)) })),
      { text: '' },
      { text: 'Take everything', run: () => here.map(it => this.takeItem(it)).some(Boolean) },
    ], false);
  },
});
