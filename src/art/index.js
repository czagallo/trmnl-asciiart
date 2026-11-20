// Loads the hand-made pieces from src/art/*.txt.
//
// File format: a header line "=== Title | theme" starts each piece; every following line up to the next header is the
// art. Leading and trailing blank lines of a piece are dropped, everything else is kept exactly (no escaping needed, so
// backslashes are literal). Pieces are padded to a rectangle (cols x rows) when rendered, not here.

const fs = require('fs');
const path = require('path');

const ART_DIR = __dirname;
const HEADER = /^=== (.+?) \| ([a-z]+)\s*$/;

// Year-round themes, in the order the settings page lists them.
const THEMES = {
  nature: 'Nature',
  space: 'Space',
  animals: 'Animals',
  city: 'City',
  coffee: 'Coffee & tea',
  tech: 'Retro tech',
  mountains: 'Mountains & Alps',
  sea: 'Sea',
  abstract: 'Patterns',
};

// Seasonal sets. All of them are switched on and off together by the "seasonal" theme filter.
const SEASONAL = {
  christmas: 'Christmas & Advent',
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
};

const LIMITS = { maxCols: 80, maxRows: 40 };

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function trimBlank(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === '') a++;
  while (b > a && lines[b - 1].trim() === '') b--;
  return lines.slice(a, b);
}

// Parses one art file. Returns pieces as written; validation is separate (validatePiece) so tests can report every
// problem, and the loader can skip broken pieces instead of crashing the server.
function parseArtFile(text, file = 'inline') {
  const pieces = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const lines = trimBlank(cur.raw);
    pieces.push({
      id: slug(cur.title),
      title: cur.title,
      theme: cur.theme,
      file,
      lines,
      rows: lines.length,
      cols: lines.reduce((m, l) => Math.max(m, l.length), 0),
    });
  };
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const h = HEADER.exec(line);
    if (h) {
      flush();
      cur = { title: h[1].trim(), theme: h[2], raw: [] };
    } else if (cur) {
      cur.raw.push(line);
    } else if (line.trim() !== '') {
      throw new Error(`${file}: text before the first "=== Title | theme" header`);
    }
  }
  flush();
  return pieces;
}

// Returns a list of problems (empty when the piece is fine).
function validatePiece(p) {
  const errs = [];
  const where = `${p.file}: "${p.title}"`;
  if (!THEMES[p.theme] && !SEASONAL[p.theme]) errs.push(`${where} has unknown theme "${p.theme}"`);
  if (p.rows === 0) errs.push(`${where} is empty`);
  if (p.rows < 3 || p.cols < 8) errs.push(`${where} is too small (${p.cols}x${p.rows})`);
  if (p.cols > LIMITS.maxCols) errs.push(`${where} is ${p.cols} columns wide (max ${LIMITS.maxCols})`);
  if (p.rows > LIMITS.maxRows) errs.push(`${where} is ${p.rows} rows tall (max ${LIMITS.maxRows})`);
  p.lines.forEach((l, i) => {
    if (l.includes('\t')) errs.push(`${where} line ${i + 1} contains a tab`);
    if (/\s$/.test(l)) errs.push(`${where} line ${i + 1} has trailing whitespace`);
    if (/[^\x20-\x7e]/.test(l)) errs.push(`${where} line ${i + 1} has a non-ASCII or control character`);
  });
  // Consistent width: the piece's declared width is its widest line, and no line is far wider than the rest.
  if (p.lines.length && p.cols !== Math.max(...p.lines.map((l) => l.length))) errs.push(`${where} width mismatch`);
  return errs;
}

let cached = null;

function loadCollection(dir = ART_DIR) {
  if (cached && dir === ART_DIR) return cached;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort();
  const pieces = [];
  const seen = new Set();
  for (const f of files) {
    for (const p of parseArtFile(fs.readFileSync(path.join(dir, f), 'utf8'), f)) {
      const errs = validatePiece(p);
      if (seen.has(p.id)) errs.push(`${f}: duplicate title "${p.title}"`);
      if (errs.length) {
        console.error(`Skipping art: ${errs.join('; ')}`);
        continue;
      }
      seen.add(p.id);
      pieces.push(p);
    }
  }
  if (dir === ART_DIR) cached = pieces;
  return pieces;
}

module.exports = { parseArtFile, validatePiece, loadCollection, THEMES, SEASONAL, LIMITS, ART_DIR };
