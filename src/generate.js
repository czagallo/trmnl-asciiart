// Procedural pieces, generated from a seed (the 15-minute slot), so every request in a slot draws the same picture
// and every slot gets a new one. Pure functions: seed in, array of lines out.

function rng(seed) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function grid(cols, rows) {
  return Array.from({ length: rows }, () => Array(cols).fill(' '));
}

function toLines(g) {
  return g.map((r) => r.join('').replace(/\s+$/, ''));
}

// A walk of heights between alternating random peaks and valleys, moving at most one level per column, so every
// ridge has peaks of different heights. Short flat shoulders (one column) break up the long slopes.
function ridgeHeights(rand, cols, lo, hi, shoulder = 0.1) {
  const span = (a, b) => a + Math.floor(rand() * (b - a + 1));
  let level = span(lo, hi);
  let up = rand() < 0.5;
  let target = up ? span(Math.min(hi, level + 2), hi) : span(lo, Math.max(lo, level - 2));
  const steps = [];
  for (let x = 0; x < cols; x++) {
    if (level === target) {
      up = !up;
      target = up ? span(Math.min(hi, level + 2), hi) : span(lo, Math.max(lo, level - 2));
    }
    let dir = Math.sign(target - level);
    if (dir !== 0 && rand() < shoulder && steps.length && steps[steps.length - 1].dir !== 0) dir = 0;
    steps.push({ level, dir });
    level += dir;
  }
  return steps;
}

// Draws one ridge into the grid: "/" up, "\" down, "_" flat. Cells below the outline are blanked (the near ridge
// hides the far one) and filled by fill(x, k, depth) when given. Returns the outline row per column.
function drawRidge(g, steps, { fill } = {}) {
  const rows = g.length;
  const top = [];
  steps.forEach(({ level, dir }, x) => {
    const k = dir < 0 ? level - 1 : level; // height of the cell the outline character sits in
    const row = rows - 1 - k;
    if (row < 0 || row >= rows) return;
    g[row][x] = dir > 0 ? '/' : dir < 0 ? '\\' : '_';
    top[x] = row;
    for (let r = row + 1; r < rows; r++) g[r][x] = fill ? fill(x, r, r - row) : ' ';
  });
  return top;
}

function ridgeline(seed, { cols = 64, rows = 18 } = {}) {
  const rand = rng(seed * 7919 + 17);
  const g = grid(cols, rows);

  // The ridges keep a landscape band at the bottom; a tall canvas just gets more sky above them.
  const band = Math.min(rows, Math.max(9, Math.round(cols * 0.6)));
  const sky = rows - band + Math.max(2, Math.round(band * 0.28));
  // Sky: stars and a moon.
  for (let i = 0; i < Math.round((cols * sky) / 25); i++) {
    const x = Math.floor(rand() * cols);
    const y = Math.floor(rand() * sky);
    g[y][x] = rand() < 0.8 ? '.' : '*';
  }
  const mx = 3 + Math.floor(rand() * (cols - 10));
  const my = Math.floor(rand() * Math.max(1, sky - 3));
  [' .-. ', '(   )', " '-' "].forEach((s, dy) => [...s].forEach((c, dx) => { g[my + dy][mx + dx] = c; }));

  // Far range: high and bare (snow), with a few rock streaks well below the crest.
  const far = ridgeHeights(rand, cols, Math.round(band * 0.4), band - 3);
  drawRidge(g, far, { fill: (x, r, depth) => (depth >= 3 && rand() < 0.06 ? ':' : ' ') });
  // Near range: lower, its slope dotted with firs.
  const near = ridgeHeights(rand, cols, 1, Math.max(3, Math.round(band * 0.38)), 0.2);
  drawRidge(g, near, { fill: (x, r, depth) => (depth === 1 && rand() < 0.6 ? '^' : depth > 1 && rand() < 0.12 ? '^' : ' ') });
  return toLines(g);
}

const STAR_CHARS = ['.', '.', '.', '.', '*', '+', "'", '.'];
const SKY_OBJECTS = [
  ['    .--.   ', '  .\'    \'. ', ' ---------- ', "  '.    .'  ", "    '--'    "],
  [' .-. ', '(   )', " '-' "],
  ['  _  ', ' (_) ', '-=*=-', '  |  '],
  ['   ___   ', ' .\'   \'. ', '(  o  ) )', " '.___.' "],
];

function nightSky(seed, { cols = 60, rows = 16 } = {}) {
  const rand = rng(seed * 104729 + 3);
  const g = grid(cols, rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (rand() < 0.05) g[y][x] = STAR_CHARS[Math.floor(rand() * STAR_CHARS.length)];
    }
  }
  // A small constellation: four bright stars joined by lines.
  const obj = SKY_OBJECTS[Math.floor(rand() * SKY_OBJECTS.length)];
  const ox = 2 + Math.floor(rand() * (cols - 4 - obj[0].length));
  const oy = 1 + Math.floor(rand() * (rows - 2 - obj.length));
  obj.forEach((s, dy) => [...s].forEach((c, dx) => { g[oy + dy][ox + dx] = c === ' ' ? ' ' : c; }));
  // Clear a small margin around the object so stars do not touch it.
  for (let dy = -1; dy <= obj.length; dy++) {
    for (const dx of [-1, obj[0].length]) {
      const y = oy + dy;
      const x = ox + dx;
      if (y >= 0 && y < rows && x >= 0 && x < cols) g[y][x] = ' ';
    }
  }
  return toLines(g);
}

function maze(seed, { cols = 48, rows = 20 } = {}) {
  const rand = rng(seed * 15485863 + 11);
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) s += rand() < 0.5 ? '/' : '\\';
    lines.push(s);
  }
  return lines;
}

function interference(seed, { cols = 64, rows = 24 } = {}) {
  const rand = rng(seed * 32452843 + 5);
  const sources = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => ({
    x: cols * (0.15 + rand() * 0.7),
    y: rows * 2 * (0.15 + rand() * 0.7), // rows are about twice as tall as columns are wide
    k: 0.3 + rand() * 0.25,
  }));
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) {
      let v = 0;
      for (const p of sources) v += Math.sin(Math.hypot(x - p.x, y * 2 - p.y) * p.k);
      const n = v / sources.length; // -1..1
      s += n > 0.55 ? '#' : n > 0.15 ? '+' : n > -0.25 ? '.' : ' ';
    }
    lines.push(s.replace(/\s+$/, ''));
  }
  return lines;
}

// Generated entries of the collection. The number in the title changes with the seed.
const GENERATORS = [
  { id: 'gen-ridgeline', title: 'Ridgeline', theme: 'mountains', make: ridgeline },
  { id: 'gen-night-sky', title: 'Night Sky', theme: 'space', make: nightSky },
  { id: 'gen-maze', title: 'Maze', theme: 'abstract', make: maze },
  { id: 'gen-interference', title: 'Interference', theme: 'abstract', make: interference },
];

// size: { cols, rows } of the canvas, so a generated piece can be drawn to suit the box it lands in.
function generatePiece(gen, seed, size) {
  const lines = gen.make(seed, size);
  return {
    id: gen.id,
    seed,
    title: `${gen.title} No. ${(((seed % 1000) + 1000) % 1000) + 1}`,
    theme: gen.theme,
    generated: true,
    lines,
    rows: lines.length,
    cols: lines.reduce((m, l) => Math.max(m, l.length), 0),
  };
}

module.exports = { rng, ridgeline, nightSky, maze, interference, GENERATORS, generatePiece, ridgeHeights };
