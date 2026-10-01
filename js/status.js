// Status effects shared by player and monsters. `bg` tints the entity's tile so effects are visible on the map.
// skip: loses its turn · dot: damage per turn · def: armor modifier.
// css: class on the entity's tile (animated in index.html) · halo: tint on the 8 tiles around it.
// hold: can't move (can still act) · bad: harmful - Purify cleanses it.
// Order = which animation shows when several apply: loss of control first, then damage over time, then buffs.
const STATUS = {
  stun:   { label: 'stunned',  color: '#ff4', bg: '#665500', skip: true, css: 'stunned', bad: true },
  frozen: { label: 'frozen',   color: '#8ef', bg: '#1f5f80', skip: true, css: 'frozen', bad: true },
  phased: { label: 'phased',   color: '#f9f', bg: '#553355', css: 'phased', halo: '#2e1a36' }, // immune to damage
  fear:   { label: 'afraid',   color: '#d9f', bg: '#4d2a66', css: 'afraid', bad: true },
  taunted: { label: 'taunted', color: '#f66', bg: '#4a1a1a', css: 'taunted', bad: true }, // must attack m.tauntedBy (pickTarget)
  silenced: { label: 'silenced', color: '#aab', bg: '#2a2a44', css: 'silenced', bad: true }, // no skills or ranged attacks (you, companions, monsters)
  webbed: { label: 'webbed',   color: '#ddd', bg: '#4a4a4a', css: 'webbed', hold: true, bad: true }, // Game.move / moveTo
  stuck:  { label: 'stuck',    color: '#ca8', bg: '#4a3a1a', css: 'stuck', hold: true, bad: true },  // quicksand, snares
  coiled: { label: 'coiled',   color: '#88f', bg: '#22224a', css: 'coiled', bad: true },           // see Game.checkCoil
  poison: { label: 'poisoned', color: '#6f6', bg: '#1f4d1f', dot: 2, noun: 'poison', css: 'poisoned', bad: true },
  burn:   { label: 'burning',  color: '#f93', bg: '#6b2a00', dot: 3, noun: 'fire', css: 'burning', bad: true },
  afflicted: { label: 'afflicted', color: '#f4a', bg: '#4a1a33', dot: 3, noun: 'affliction', css: 'afflicted', bad: true },
  cursed: { label: 'cursed',   color: '#c6f', bg: '#3d1f4d', def: -3, css: 'cursed', bad: true },
  hidden: { label: 'hidden',   color: '#999', bg: '#333333', css: 'hidden' },
  // noSkip: immune to stun/freeze (skip statuses) · noPush: can't be knocked back
  unstoppable: { label: 'unstoppable', color: '#fc8', bg: '#4a3418', css: 'unstoppable', noSkip: true, noPush: true }, // Iron Skin
  warded: { label: 'warded', color: '#9cf', bg: '#1f2f55', css: 'warded', noSkip: true }, // Arcane Shield
  shield: { label: 'shielded', color: '#6af', bg: '#1f3f6b', def: 4, css: 'shielded' },
};

function applyStatus(e, key, turns, g, quiet) { // quiet: the caller already logged its own message
  if (e.partOf) e = e.partOf; // a Colossus part: its core takes the status
  const s = STATUS[key];
  const guard = s.skip && Object.keys(e.status).find(k => STATUS[k].noSkip); // e.g. unstoppable, warded
  if (guard) {
    if (e === g.player || g.map.visible[e.y]?.[e.x]) g.log(`${e.subj} ${e === g.player ? 'are' : 'is'} ${STATUS[guard].label} - not ${s.label}!`, STATUS[guard].color);
    return;
  }
  e.status[key] = Math.max(e.status[key] || 0, turns);
  if (!quiet && (e === g.player || g.map.visible[e.y]?.[e.x])) g.log(`${e.subj} ${e === g.player ? 'are' : 'is'} ${s.label}!`, s.color); // only what you see
}

const statusMod = (e, stat) => Object.keys(e.status).reduce((sum, k) => sum + (STATUS[k][stat] || 0), 0);
const statusBg = e => e.status && Object.keys(e.status).map(k => STATUS[k].bg)[0];
const isDisabled = e => Object.keys(e.status).some(k => STATUS[k].skip);
const statusText = e => Object.entries(e.status)
  .map(([k, n]) => `<span style="color:${STATUS[k].color}">${STATUS[k].label}(${n})</span>`).join(' ');

// Called once per turn for each entity: damage over time, then countdown.
function tickStatuses(e, g) {
  for (const k of Object.keys(e.status)) {
    const s = STATUS[k];
    if (k === 'burn') scorch(g, [e]); // burning creatures burn away mold/webs under them
    if (s.dot && e.alive) {
      g.log(`${e.subj} ${e.verb('suffer')} ${s.dot} ${s.noun} damage.`, s.color);
      e.hurt(s.dot, g, { obj: s.noun });
    }
    if (--e.status[k] <= 0) delete e.status[k];
  }
}
