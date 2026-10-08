// Drawing: title, map (with statuses, targeting and effects), menus, side panel and banner.

// Roots join up with neighbouring roots using box-drawing characters (extended ASCII / code page 437), picked from
// which of the 4 sides have roots (N=1 E=2 S=4 W=8). The map font fills each tile, so they connect.
// No orthogonal neighbour: / \ for a diagonal link, & for a lone clump.
const ROOT_BOX = ['&', '║', '═', '╚', '║', '║', '╔', '╠', '═', '╝', '═', '╩', '╗', '╣', '╦', '╬'];
function rootGlyph(map, x, y) {
  const r = (dx, dy) => map.get(x + dx, y + dy) === 'roots';
  const mask = r(0, -1) | r(1, 0) << 1 | r(0, 1) << 2 | r(-1, 0) << 3;
  if (mask) return ROOT_BOX[mask];
  const up = r(1, -1) || r(-1, 1), down = r(-1, -1) || r(1, 1);
  return up ? '/' : down ? '\\' : '&';
}

// '#abc' / '#aabbcc' -> 'rgba(r,g,b,a)'
const tint = (hex, a) => {
  const h = hex.slice(1), f = h.length === 3 ? [...h].map(c => c + c) : h.match(/../g);
  return `rgba(${f.map(v => parseInt(v, 16)).join(',')},${a})`;
};

const PILE = { ch: '≡', color: '#eee', kind: 'pile' }; // map glyph for a tile holding several items
const SLIDE_MS = 110; // smooth movement: how long a one-tile slide takes

const DIFFICULTY_COLOR = { Easy: '#6d6', Medium: '#fc4', Hard: '#f66' };

Object.assign(Game.prototype, {
  showTitle() {
    this.state = 'title';
    this.menu = this.targeting = null;
    this.$side.textContent = this.$log.innerHTML = this.$banner.innerHTML = '';
    this.render();
  },

  titleText() {
    const classes = CLASSES.map((c, i) => {
      const t = SKILL_TREES[c.key], tree = [t.basic, ...t.core].filter(Boolean).map(id => SKILLS[id].name);
      const tag = `<span style="color:${DIFFICULTY_COLOR[c.difficulty]}">${('[' + c.difficulty + ']').padEnd(9)}</span>`;
      return `  <b style="color:${c.color}">${i + 1}) ${c.title.padEnd(12)}</b> ${tag} HP ${c.hp}  ATK ${c.atk}  INT ${c.int}  DEF ${c.def}  MP ${c.mp}\n` +
        `     ${c.desc}\n     Skills: <span style="color:#ff8">${tree[0]}</span>, ${tree.slice(1).join(', ')} + ${t.pool.length} more to find in tomes\n`;
    });
    return `\n  <b style="color:#0ff">C R Y S T A L   D E P T H S</b>\n\n  Descend ${LEVELS.length - 1} dungeon levels and claim the Crystal of Ages.\n\n  Choose your class:\n\n${classes.join('\n')}`;
  },

  charSize() {
    const probe = document.createElement('span');
    probe.textContent = 'M';
    this.$map.style.fontSize = '100px';
    this.$map.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return { cw: r.width / 100, ch: r.height / 100 };
  },

  // Text screens (title, menus): scale font so the longest line and all rows fit.
  renderText(html) {
    this.$map.classList.remove('square');
    this.$stage.style.margin = this.$stage.style.transform = '';
    this.$actors.hidden = this.$puffs.hidden = this.$floats.hidden = true; // creatures, clouds and numbers only show over the map
    this.$map.innerHTML = html;
    const lines = this.$map.textContent.split('\n');
    const box = this.$view, { cw, ch } = this.charSize();
    const cols = Math.max(...lines.map(l => l.length)) + 2;
    this.$map.style.fontSize = Math.min(30, (box.clientWidth - 8) / (cols * cw), (box.clientHeight - 8) / ((lines.length + 1) * ch)) + 'px';
  },

  render() {
    if (this.state === 'title') return this.renderText(this.titleText());
    if (this.menu) this.renderMenu();
    else this.renderMap();
    this.$log.innerHTML = this.messages.join('');
    this.renderSide();
    this.renderBanner();
    if (this.fx.size) { // show each effect frame in turn (quicker when several are queued), then clear
      clearTimeout(this.fxTimer);
      this.fxTimer = setTimeout(() => { this.fx.next(); this.render(); }, this.fx.frames.length > 1 ? 220 : 350);
    }
  },

  // noLetters: rows have no a) b) labels (letters are action keys there). detail(row): extra lines about the selected row.
  renderMenu() {
    const menu = this.menu, choices = menu.lines.filter(l => l.run);
    let n = 0;
    const lines = menu.lines.map(l => {
      if (!l.run) return `  ${l.text}`;
      const on = l.enabled !== false, cur = n === menu.sel, tag = menu.noLetters ? '' : `<span style="color:${on ? '#ff8' : '#666'}">${LETTERS[n]})</span> `;
      n++;
      const row = `${tag}<span style="color:${on ? '#eee' : '#666'}">${l.text}</span>`;
      return cur ? `<span style="color:#ff0">&gt;</span> <span style="background:#2a2a40">${row}</span>` : `  ${row}`;
    });
    const detail = menu.detail?.(choices[menu.sel]);
    this.renderText(`\n  <b style="color:#ff0">${menu.title}</b>\n\n${lines.join('\n')}\n${detail ? `\n${detail}\n` : ''}`);
  },

  renderMap() {
    const { map, player: p } = this;
    // Every tile is a 1em x 1em cell (see #map.square in index.html), so the grid is square with any font.
    // Tile size is a multiple of 8 (the font's native 8x8) so glyph pixels land on whole screen pixels; the map is
    // placed at whole-pixel offsets too. Both avoid thin seams between tiles.
    const box = this.$view;
    const size = this.overview ? 8 : Math.max(8, Math.round((box.clientHeight - 4) / VIEW_ROWS / 8) * 8); // overview (debug): the whole map at 8px
    this.$map.classList.add('square');
    this.$map.style.fontSize = size + 'px';
    const viewW = Math.min(map.w, Math.floor(box.clientWidth / size)), viewH = Math.min(map.h, Math.floor(box.clientHeight / size));
    this.$stage.style.margin = `${(box.clientHeight - viewH * size) >> 1}px 0 0 ${(box.clientWidth - viewW * size) >> 1}px`;
    const camX = Math.max(0, Math.min(map.w - viewW, p.x - (viewW >> 1)));
    const camY = Math.max(0, Math.min(map.h - viewH, p.y - (viewH >> 1)));

    const colors = this.level.colors || {}, chars = this.level.chars || {}, bgs = this.level.bgs || {};
    const glyphs = {};
    for (const i of this.items) { const k = i.x + ',' + i.y; glyphs[k] = glyphs[k] ? PILE : i; } // several items: a pile
    for (const m of this.monsters) if (m.alive && !this.submerged(m)) glyphs[m.x + ',' + m.y] = m;
    glyphs[p.x + ',' + p.y] = this.dead ? { ch: '†', color: '#e8e8e8' } : p; // a cross marks where you fell

    // A multi-tile creature you can see part of shows whole - every piece in your line of sight, even out in the dark
    // (so a serpent never looks cut into bits).
    const bodyShown = new Set();
    for (const m of this.monsters.filter(m => m.alive && m.body)) {
      const pieces = [m, ...bodyParts(m)];
      if (pieces.some(q => map.visible[q.y][q.x])) pieces.forEach(q => map.hasLos(p, q) && bodyShown.add(q.x + ',' + q.y));
    }

    // Eyes in the dark: a hidden darkstalker (the Wight) you have a line of sight to, within 8, shows as a pair of faint
    // blinking eyes - you can watch it circle and close in without seeing it.
    const eyes = new Set(this.monsters.filter(m => m.alive && m.darkstalker && this.submerged(m) && dist(m, p) <= 8 && map.hasLos(p, m)).map(m => m.x + ',' + m.y));
    // (boss telegraphs: shown on every marked tile in your line of sight, even in the dark - you sense the blow coming)
    const danger = new Set((map.dangers || []).filter(d => d.owner.alive).flatMap(d => d.tiles)
      .filter(c => map.visible[c.y]?.[c.x] || (dist(c, p) <= 10 && map.hasLos(p, c))).map(c => c.x + ',' + c.y));

    const tgt = this.aim, aimOk = tgt && this.aimOk();
    const path = new Set(tgt ? line(p.x, p.y, tgt.x, tgt.y).slice(1, -1).map(c => c.x + ',' + c.y) : []);

    // Status halos (e.g. Phase Shift's rift) tint the tiles around whoever carries them.
    const halo = new Map();
    for (const e of [p, ...this.monsters.filter(m => m.alive && this.seesMonster(m))])
      for (const s of Object.keys(e.status)) if (STATUS[s].halo) DIRS.forEach(([dx, dy]) => halo.set((e.x + dx) + ',' + (e.y + dy), STATUS[s].halo));

    const flick = this.stepFlicker();
    const actors = []; // smooth movement: creatures drawn on the overlay instead of in their tile
    let html = '';
    for (let y = camY; y < camY + viewH; y++) {
      for (let x = camX; x < camX + viewW; x++) {
        const k = x + ',' + y, vis = map.visible[y][x] || bodyShown.has(k);
        if (eyes.has(k)) { html += '<span class="eyes">"</span>'; continue; } // (a darkstalker, unseen in the dark)
        if (!vis && !map.seen[y][x]) { html += danger.has(k) ? '<span class="danger"> </span>' : '<span> </span>'; continue; }
        const t = map.get(x, y);
        let ch = t === 'roots' ? rootGlyph(map, x, y) : chars[t] || TILES[t].ch, color = colors[t] || TILES[t].color, bg = TILES[t].bg || bgs[t] || '';
        if (TILES[t].hidden && !map.found[y][x]) { ch = TILES.floor.ch; color = colors.floor || TILES.floor.color; } // unspotted trap
        const g = vis && glyphs[k];
        // Solid tiles only glow when you're on their lit side: a visible, lit floor tile must touch them.
        const litSide = map.walkable(x, y) || TILES[t].light ||
          DIRS.some(([dx, dy]) => map.walkable(x + dx, y + dy) && map.isLit(x + dx, y + dy) && map.visible[y + dy]?.[x + dx]);
        const lit = vis && litSide && map.light?.[y][x], fl = flick[map.lightFrom?.[y][x]] ?? 1;
        const src = lit && map.lightSources[map.lightFrom[y][x]], rgb = (src && (src.color || TILES[map.get(src.x, src.y)].lightColor)) || '255,140,40';
        if (lit) { // glow tints over the tile's own or the level's background instead of replacing it
          const glow = `rgba(${rgb},${(0.34 * lit * fl).toFixed(2)})`;
          bg = bg ? `linear-gradient(${glow},${glow}),${bg}` : glow;
        }
        if (TILES[t].fire && vis) color = fl > 0.88 ? '#ffd060' : fl > 0.76 ? '#ffa030' : '#e06010';
        if (vis && this.coil && dist({ x, y }, this.coil) <= 2) bg = '#1a1a3a';
        if (vis && halo.has(k) && !TILES[t].bg) bg = halo.get(k);
        if (vis && this.orb && this.orb.x === x && this.orb.y === y) { ch = 'O'; color = '#f6f'; bg = '#331a33'; }
        // An item on notable ground (bones, webs, mold, water...) keeps a tint of that ground so you can see what's under it.
        if (g && g.kind && t !== 'floor' && TILES[t].walk && !TILES[t].bg) bg = tint(colors[t] || TILES[t].color, 0.3);
        const actor = this.smooth && g && !g.kind; // a creature (or your cross), not an item
        if (g && !actor) ({ ch, color } = g);
        const ebg = g && (statusBg(g) || (g.ally ? '#2a1a3a' : '')); // the creature's own background (status, ally)
        if (ebg && !actor) bg = ebg; // smooth movement: it goes on the sliding glyph instead
        if (t === 'stairs' || t === 'upstairs') bg = '#554400';
        if (path.has(k)) bg = aimOk ? '#402020' : '#2a2020';
        if (tgt && x === tgt.x && y === tgt.y) bg = aimOk ? '#b01010' : '#4a3030';
        const f = vis && this.fx.get(k);
        if (f) { if (f.ch && !g) ({ ch, color } = f); if (f.bg) bg = f.bg; }
        const sk = g?.status && Object.keys(STATUS).find(s => g.status[s] && STATUS[s].css); // first in STATUS order
        const scss = (g?.flashCss?.turn >= this.turn - 1 && g.flashCss.css) // a one-off effect just now (mana shield ripple)
          || (g?.lostTurn?.turn === this.turn && g.lostTurn.css) || (sk && STATUS[sk].css) // lostTurn: stun/freeze just spent (endTurn)
          || (g && !g.kind && g.css) || ''; // else the creature's own look (monster `css`, e.g. the bone forge's throb)
        const hp = g && !g.kind && !g.partOf && g.maxHp && g.hp > 0 && g.hp < g.maxHp ? g.hp / g.maxHp : 0; // health bar (hurt creatures only; a multi-tile creature's on its core/head alone)
        const hpVars = hp ? `;--hp:${hp.toFixed(2)};--hpc:${hp > 0.6 ? '#4c4' : hp > 0.3 ? '#eb3' : '#e33'}` : '';
        const look = g === p && this.gearLook ? heroGearLook(p) : null; // (option: your gear shows on your tile)
        if (actor) { actors.push({ e: g.status ? g : p, ch: g.ch, color: g.color, bg: ebg,
          cls: (scss || '') + (hp ? ' hurt' : '') + (look?.cls ? ' ' + look.cls : ''), hpVars, overlay: look?.html, x, y }); ch = ' '; } // cross -> keyed by you
        const join = /[─-╿]/.test(ch), tcss = (vis && TILES[t].css ? TILES[t].css + ' ' : '') + (danger.has(k) ? 'danger ' : ''); // tile animation (swelling vent); a boss's marked tiles
        const cls = (vis ? '' : 'dim ') +(join ? 'join ' : '') + tcss + (!actor && scss || '') + (!actor && hp ? ' hurt' : '') + (!actor && look?.cls ? ' ' + look.cls : ''); // join: box-drawing glyphs
        html += `<span${cls ? ` class="${cls.trim()}"` : ''} style="color:${color}${bg ? ';background:' + bg : ''}${actor ? '' : hpVars}">${join ? `<i>${ch}</i>` : ch}${!actor && look ? look.html : ''}</span>`;
      }
      html += '\n';
    }
    this.$map.innerHTML = html;
    this.renderActors(actors, { x: camX, y: camY }, size);
    this.renderPuffs({ x: camX, y: camY }, size);
    this.renderFloats({ x: camX, y: camY }, size);
  },

  // Gas puffs (fx.puff): each visible tile of a new puff gets a tint that grows outward - centre first, then the ring
  // (CSS gasCore / gasRing) - and fades; the group removes itself when done. Living puffs are re-placed each render so
  // they stay on their tiles as the camera moves.
  renderPuffs(cam, size) {
    const layer = this.$puffs, live = this.puffEls ||= [];
    layer.hidden = false;
    if (this.puffFloor !== this.map) { live.forEach(p => p.el.remove()); live.length = 0; this.puffFloor = this.map; }
    for (const p of this.fx.puffs.splice(0)) {
      const el = document.createElement('div');
      el.style.setProperty('--c', p.rgb);
      for (let dy = -p.r; dy <= p.r; dy++)
        for (let dx = -p.r; dx <= p.r; dx++) {
          if (!this.map.visible[p.y + dy]?.[p.x + dx]) continue;
          const t = document.createElement('span');
          if (dx || dy) t.className = 'ring';
          Object.assign(t.style, { left: dx + p.r + 'em', top: dy + p.r + 'em' });
          el.appendChild(t);
        }
      const entry = { ...p, el };
      live.push(entry);
      layer.appendChild(el);
      setTimeout(() => { el.remove(); live.splice(live.indexOf(entry), 1); }, 1200); // after the 1 s animation
    }
    for (const p of live) Object.assign(p.el.style, { fontSize: size + 'px',
      left: (p.x - p.r - cam.x) * size + 'px', top: (p.y - p.r - cam.y) * size + 'px' });
  },

  // Smooth movement (option): creatures live on an overlay and keep their element between renders, so each slides
  // from where it was last drawn to its new tile; the whole stage (map + creatures) slides by the camera's movement.
  // Big jumps (teleports, new floor) snap. With the option off the layer is hidden and creatures draw in their tiles.
  // Floating numbers (fx.float): each rises from its creature's tile and fades (CSS floatUp); several on one tile in a
  // turn are staggered so they don't sit on top of each other. Living ones are re-placed each render (the camera moves).
  renderFloats(cam, size) {
    const layer = this.$floats, live = this.floatEls ||= [];
    layer.hidden = false;
    if (this.floatFloor !== this.map) { live.forEach(f => f.el.remove()); live.length = 0; this.floatFloor = this.map; }
    const onTile = {};
    for (const f of this.fx.floats.splice(0)) {
      const n = onTile[f.x + ',' + f.y] = (onTile[f.x + ',' + f.y] || 0) + 1, el = document.createElement('span');
      const delay = (f.delay || 0) + (n - 1) * 0.15;
      el.textContent = f.text; el.style.color = f.color; el.style.animationDelay = delay + 's'; el.className = f.css || '';
      const entry = { ...f, el };
      live.push(entry);
      layer.appendChild(el);
      setTimeout(() => { el.remove(); live.splice(live.indexOf(entry), 1); }, 1000 + delay * 1000);
    }
    for (const f of live) Object.assign(f.el.style, { fontSize: size * (f.css ? 1 : 0.55) + 'px', width: size + 'px',
      left: (f.x - cam.x) * size + 'px', top: (f.y - cam.y) * size + 'px' });
  },
  renderActors(list, cam, size) {
    const layer = this.$actors, stage = this.$stage, els = this.actorEls ||= new Map(), last = this.actorLast ||= new WeakMap();
    layer.hidden = !this.smooth;
    if (!this.smooth) { els.forEach(el => el.remove()); els.clear(); stage.style.transform = ''; return; }
    const fresh = this.actorFloor !== this.map, prev = !fresh && this.prevCam || cam;
    this.actorFloor = this.map; this.prevCam = cam;
    layer.style.fontSize = size + 'px';
    const at = c => `translate(${(c.x - cam.x) * size}px, ${(c.y - cam.y) * size}px)`;
    const shown = new Set(list.map(a => a.e));
    for (const [e, el] of els) if (!shown.has(e)) { el.remove(); els.delete(e); } // died / out of view
    // 1) freeze everything where it is on screen right now - mid-slide if a key came in fast - with the new camera
    //    offset compensated, so nothing jumps (no transition)...
    const camJump = Math.abs(cam.x - prev.x) > 3 || Math.abs(cam.y - prev.y) > 3;
    const dx = (cam.x - prev.x) * size, dy = (cam.y - prev.y) * size;
    const now = el => { const t = getComputedStyle(el).transform, m = t && t !== 'none' ? new DOMMatrixReadOnly(t) : null; return m ? [m.m41, m.m42] : [0, 0]; };
    // Nothing is touched that hasn't moved: a redraw with the camera and a creature both still (the ~8/s torch-flicker
    // redraws) leaves their transforms alone - re-applying them makes the browser re-place the text, jittering it 1px.
    const camStill = !dx && !dy && !camJump, moving = [];
    if (!camStill) {
      const [sx, sy] = now(stage);
      stage.style.transition = 'none';
      stage.style.transform = camJump ? '' : `translate(${sx + dx}px, ${sy + dy}px)`;
    }
    for (const a of list) {
      let el = els.get(a.e);
      const from = !fresh && el && last.get(a.e);
      if (!el) { el = document.createElement('span'); el.appendChild(document.createElement('span')); layer.appendChild(el); els.set(a.e, el); }
      const glyph = el.firstChild, key = a.ch + (a.overlay || '');
      if (glyph.dataset.k !== key) { // (rebuilt only when it changes)
        glyph.textContent = a.ch;
        if (a.overlay) glyph.insertAdjacentHTML('beforeend', a.overlay); // (your gear, drawn round your glyph)
        glyph.dataset.k = key;
      }
      glyph.className = a.cls.trim();
      glyph.style.cssText = `color:${a.color};background:${a.bg || ''}${a.hpVars}`; // (+ health bar variables)
      if (camStill && from && from.x === a.x && from.y === a.y && !a.e.spawnFrom) continue; // (still: leave it be)
      const [ex, ey] = now(el);
      moving.push(a);
      el.style.transition = 'none';
      el.style.transform = a.e.spawnFrom && !from ? at(a.e.spawnFrom) // (just hatched: starts on its egg sac and scuttles out)
        : from && dist(from, a) <= (a.e.partOf ? 3 : 2) && !camJump ? `translate(${ex - dx}px, ${ey - dy}px)` : at(a); // teleports snap (a leg may stride 3)
      delete a.e.spawnFrom;
      last.set(a.e, { x: a.x, y: a.y });
    }
    void layer.offsetWidth; // commit the start positions
    // 2) ...then glide to the new ones.
    const glide = `transform ${SLIDE_MS}ms linear`;
    if (!camStill) { stage.style.transition = glide; stage.style.transform = ''; }
    for (const a of moving) { const el = els.get(a.e); el.style.transition = glide; el.style.transform = at(a); }
  },

  // Each torch's brightness drifts randomly between 0.65 and 1 so they flicker independently and smoothly.
  stepFlicker() {
    const n = this.map.lightSources?.length || 0;
    if (!this.flicker || this.flicker.length !== n) this.flicker = Array(n).fill(0.9);
    this.flicker = this.flicker.map(v => Math.min(1, Math.max(0.65, v + (Math.random() - 0.5) * 0.18)));
    return this.flicker;
  },

  renderBanner() {
    const p = this.player, t = this.targeting;
    const a = this.aim, mon = a && this.monsterAt(a.x, a.y);
    const what = !a ? '' : mon ? `<span style="color:${mon.color}">${mon.name}</span> ${mon.hp}/${mon.maxHp}`
      : (TILES[this.map.get(a.x, a.y)].name || this.map.get(a.x, a.y));
    const keys = t && (t.cursor ? 'move: aim &middot; Tab: next enemy' : `(${t.i + 1}/${t.list.length}) &larr;&rarr;/Tab: switch`);
    this.$banner.innerHTML =
      this.state === 'over' ? this.gameOverText
      : t ? `Targeting <b style="color:#ff8">${t.skill.name}</b> &rarr; ${what}${this.aimOk() ? '' : ' <span style="color:#f66">(out of range)</span>'}` +
        ` <span style="color:#888">&nbsp; ${keys} &middot; ${t.pick ? 'Enter/F: confirm' : `Enter/F/${t.slot + 1}: cast`} &middot; Esc: cancel</span>`
      : this.menu ? `<span style="color:#888">&uarr;&darr; move &middot; ${this.menu.noLetters ? 'Enter / action keys' : 'Enter select (or press a letter)'} &middot; Esc close</span>`
      : '';
  },

  // Direction + distance to the stairs once they've been seen.
  compass() {
    const s = this.stairs, p = this.player;
    if (this.side) { // a side-floor: point the way back up once seen
      const u = this.upStairs, d = u && this.map.seen[u.y][u.x] ? dist(u, p) : null;
      return `<span style="color:#c4a870">${this.level.name}${d != null ? ` - way back up ${d} tiles away` : ''}</span>`;
    }
    if (!s) return `<span style="color:#0ff">Goal: find the Crystal of Ages (*)</span>`;
    if (!this.map.seen[s.y][s.x]) return `<span style="color:#777">Stairs: not found yet</span>`;
    const dx = s.x - p.x, dy = s.y - p.y;
    const dir = (Math.abs(dy) * 2 >= Math.abs(dx) ? (dy < 0 ? 'N' : dy > 0 ? 'S' : '') : '') +
      (Math.abs(dx) * 2 >= Math.abs(dy) ? (dx < 0 ? 'W' : dx > 0 ? 'E' : '') : '');
    const label = this.depth === 0 ? 'Dungeon entrance' : 'Stairs down';
    return `<span style="color:#ff0">${label}: ${dir || 'here'}${dir ? `, ${dist(s, p)} tiles` : ''}</span>`;
  },

  // Levels with tides: current phase, a water-level bar and turns until it changes.
  tideGauge() {
    if (!this.level.tide) return '';
    const { level, name, left } = tidePhase(this, this.level.tide);
    const next = { LOW: 'rising', RISING: 'high', HIGH: 'ebbing', FALLING: 'low' }[name];
    return `Tide <span style="color:#6ad">${'▓'.repeat(level)}${'░'.repeat(TIDE_WAVES - level)}</span> ` +
      `<span style="color:${name === 'LOW' ? '#8c8' : name === 'HIGH' ? '#f86' : '#fc6'}">${name}</span> - ${next} in ${left}`;
  },

  renderSide() {
    const p = this.player;
    const seen = this.monsters.filter(m => !m.partOf && (this.seesMonster(m) || m.body?.some(s => s.alive && this.seesMonster(s)))) // a Colossus: listed once
      .sort((a, b) => dist(a, p) - dist(b, p));
    const status = statusText(p);
    const reserve = p.skills.length - ACTIVE_SKILLS;
    const skills = p.skills.slice(0, ACTIVE_SKILLS).map((id, i) => {
      // mana cost, range in tiles, cooldown length (orange "cd left/total" while recharging)
      const s = SKILLS[id], cd = p.cooldowns?.[id], ok = p.mp >= s.mp && !cd;
      const info = [`${s.mp}mp`, s.range && `${s.range} tiles`].filter(Boolean).join(' ');
      const full = p.cooldownOf(s); // after INT reduction
      const cdTag = !full ? '' : cd ? ` <span style="color:#f96">cd ${cd}/${full}</span>` : ` <span style="color:#777">cd ${full}</span>`;
      return ` <span style="color:${ok ? '#ff8' : '#555'}">${i + 1}</span> <span style="color:${ok ? '#ddd' : '#555'}">${s.name.padEnd(16)} ${info}</span>${cdTag}`;
    });
    const gear = SLOTS.filter(s => p.gear[s]).map(s => ` ${s.padEnd(8)}${itemName(p.gear[s])}`);
    const lying = this.itemsAt(p.x, p.y); // what's under you
    const here = lying.length ? ['', '<b>HERE</b>  (G: pick up)', ...lying.map(i => ` ${itemName(i)}`)] : [];
    this.$side.innerHTML = [
      `<b style="color:${p.color}">${p.cls.title}</b>  Lv ${p.lvl}  (XP ${p.xp}/${xpToNext(p.lvl)})`,
      `${this.depth ? 'Dungeon ' + this.depth + ': ' : ''}${this.level.name}`,
      this.compass(),
      this.tideGauge(),
      '',
      `HP <span style="color:#e44">${bar(p.hp, p.maxHp)}</span> ${p.hp}/${p.maxHp}`,
      `MP <span style="color:#48f">${bar(p.mp, p.maxMp)}</span> ${p.mp}/${p.maxMp}`,
      `ATK ${p.power}   INT ${p.spellPower}   DEF ${p.armor}`,
      status ? `Status: ${status}` : '',
      this.ghost || this.revealAll ? `<span style="color:#f8f">DEBUG: ${[this.ghost && 'ghost mode', this.revealAll && 'no fog'].filter(Boolean).join(', ')}</span>` : '',
      '',
      '<b>SKILLS</b>  (K)',
      ...skills,
      reserve > 0 ? ` <span style="color:#777">+${reserve} in reserve (K to swap)</span>` : '',
      '',
      `<b>GEAR</b>  (I: pack ${p.inv.length}/${PACK_SIZE})`,
      ...(gear.length ? gear : [' nothing equipped']),
      ...(this.orb ? [` <span style="color:#f6f">Orb active (${this.orb.ttl})</span>`] : []),
      ...here,
      '',
      '<b>IN VIEW</b>',
      ...(seen.length ? seen.map(m => {
        const bgc = statusBg(m) || (m.ally ? '#2a1a3a' : '');
        const rival = m.target && m.target !== p && !m.ally && m.awake ? ` <span style="color:#f96">&rarr; fighting ${m.target.name}</span>` : '';
        const neutral = !m.ally && !this.hostile(m, p) ? ' <span style="color:#8c8">neutral</span>' : '';
        const special = m.captive ? ' <span style="color:#8cf">captive: walk into to free</span>' : m.runTo ? ' <span style="color:#fc3">running to the gong!</span>' : '';
        const o = m.order, doing = !m.ally ? '' : o?.type === 'attack' ? ` &middot; attacking ${o.target.name}` // current order (Tactics)
          : o?.type === 'goto' ? ' &middot; going' : o?.type === 'regroup' ? ' &middot; regrouping' : m.hold ? ' &middot; waiting' : '';
        const tag = (m.companion ? ` <span style="color:#8cf">companion Lv ${m.lvl} &middot; MP ${m.mp}/${m.maxMp}${doing}</span>` : m.ally ? ` <span style="color:#a6f">ally${doing}</span>` : m.awake ? '' : ' <span style="color:#777">asleep</span>') + neutral + rival + special +
          (m.shunLight ? ' <span style="color:#fa4">shuns light</span>' : '');
        return ` <span style="color:${m.color}${bgc ? ';background:' + bgc : ''}">${m.ch}</span> ${m.name}${tag}\n` +
          `   <span style="color:#e44">${bar(m.hp, m.maxHp, 8)}</span> ${m.hp}/${m.maxHp} ${statusText(m)}`;
      }) : [' nothing']),
      '',
      '<span style="color:#777">Move: arrows/WASD/QEZC/numpad',
      'Skills: 1-5  Wait: space',
      'K: skills  I: pack  Esc: cancel',
      'G: pick up  R: drink healing potion  O: options',
      'T: tactics &amp; wait/follow  P: party',
      'M: fog of war  N: ghost mode  J: load floor (debug)</span>',
    ].join('\n');
  },
});

const game = new Game();
document.fonts.ready.then(() => game.render());
// Keep torches flickering while you stand still (map only; side panel and log don't change).
setInterval(() => { if (game.state === 'play' && !game.menu && game.map?.light) game.renderMap(); }, 120);
