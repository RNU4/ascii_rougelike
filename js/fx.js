// Short-lived visual effects drawn over the map (projectiles, blasts, hit flashes). Effects go into frames shown one
// after another (see Game.render): a bolt that would cross tiles already drawn in the current frame starts a new one,
// so two archers shooting at each other show both arrows instead of one overwriting the other.
class Fx {
  constructor(game) { this.game = game; this.puffs = []; this.floats = []; this.clear(); }
  // An animated cloud swelling out over radius r around c (drawn and animated by Game.renderPuffs). rgb: 'r,g,b'.
  puff(c, r, rgb) { this.puffs.push({ x: c.x, y: c.y, r, rgb }); }
  // A number floating up from e's tile (Game.renderFloats): damage, heals. Only for tiles you can see.
  // opts: css (a class with its own animation - e.g. 'sink', a full-size glyph), delay (seconds).
  float(e, text, color, opts = {}) { if (this.game.map.visible[e.y]?.[e.x]) this.floats.push({ x: e.x, y: e.y, text, color, ...opts }); }
  get size() { return this.frames[0].size; }
  get(key) { return this.frames[0].get(key); }
  clear() { this.frames = [new Map()]; }
  // Moves on to the next queued frame; returns false when none are left.
  next() { this.frames.shift(); if (this.frames.length) return true; this.clear(); return false; }
  add(x, y, look) { const f = this.frames[this.frames.length - 1], k = x + ',' + y; f.set(k, { ...f.get(k), ...look }); }

  flash(e, bg) { this.add(e.x, e.y, { bg }); }
  // Projectile trail between two points (endpoints excluded so the shooter/target stay visible).
  bolt(from, to, ch, color) {
    const cells = line(from.x, from.y, to.x, to.y).slice(1, -1), f = this.frames[this.frames.length - 1];
    if (cells.some(c => f.has(c.x + ',' + c.y))) this.frames.push(new Map());
    cells.forEach(c => this.add(c.x, c.y, { ch, color }));
  }
  // Tints every visible cell within radius r of center.
  area(center, r, bg) {
    const vis = this.game.map.visible;
    for (let y = center.y - r; y <= center.y + r; y++)
      for (let x = center.x - r; x <= center.x + r; x++) if (vis[y]?.[x]) this.add(x, y, { bg });
  }
}
