// The gallery: public-domain artworks converted to ASCII art by scripts/gallery/build.py.
//
// One file per piece, src/gallery/<id>.txt:
//
//   === The Great Wave | sea
//   by: Katsushika Hokusai, c. 1831
//   source: https://commons.wikimedia.org/wiki/File:...
//   license: Public domain
//   --- 28x9
//   ...9 lines...
//   --- 34x11
//   ...
//
// Each "--- COLSxROWS" block is the same picture converted at another width (the ladder in layout.json). A layout
// shows the widest block that fits its box (variantFor), so small boxes get a coarser drawing, not a shrunken one.

const fs = require('fs');
const path = require('path');
const LAYOUT = require('./layout.json');

const DIR = __dirname;
const HEADER = /^=== (.+?) \| ([a-z]+)\s*$/;
const VARIANT = /^--- (\d+)x(\d+)$/;
const LIMITS = { maxCols: 120, maxRows: 80 };

function parseGalleryFile(text, file = 'inline') {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const h = HEADER.exec(lines[0] || '');
  if (!h) throw new Error(`${file}: first line must be "=== Title | theme"`);
  const piece = { id: path.basename(file, '.txt'), file, title: h[1], theme: h[2], collection: 'gallery', variants: [] };
  let i = 1;
  for (; i < lines.length && !VARIANT.test(lines[i]); i++) {
    const m = /^(by|source|license): (.+)$/.exec(lines[i]);
    if (m) piece[m[1]] = m[2];
  }
  while (i < lines.length && VARIANT.test(lines[i])) {
    const [, c, r] = VARIANT.exec(lines[i]);
    const cols = Number(c);
    const rows = Number(r);
    const body = lines.slice(i + 1, i + 1 + rows);
    while (body.length < rows) body.push('');
    piece.variants.push({ cols, rows, lines: body });
    i += 1 + rows;
  }
  piece.variants.sort((a, b) => a.cols - b.cols);
  // The largest drawing stands in wherever a single picture is needed (tests, validation).
  const big = piece.variants[piece.variants.length - 1] || { cols: 0, rows: 0, lines: [] };
  Object.assign(piece, { lines: big.lines, cols: big.cols, rows: big.rows });
  return piece;
}

function validateGalleryPiece(p) {
  const errs = [];
  const where = `${p.file}: "${p.title}"`;
  if (!p.by || !p.source || !p.license) errs.push(`${where} needs by:, source: and license: lines`);
  if (p.license && !/^(Public domain|CC0|PD)/.test(p.license)) errs.push(`${where} has licence ${p.license}`);
  if (p.variants.length === 0) errs.push(`${where} has no drawings`);
  for (const v of p.variants) {
    if (v.cols > LIMITS.maxCols || v.rows > LIMITS.maxRows) errs.push(`${where} ${v.cols}x${v.rows} is too big`);
    v.lines.forEach((l, n) => {
      if (l.length > v.cols) errs.push(`${where} ${v.cols}x${v.rows} line ${n + 1} is ${l.length} wide`);
      if (/[^\x20-\x7e]/.test(l)) errs.push(`${where} ${v.cols}x${v.rows} line ${n + 1} has non-ASCII characters`);
      if (/\s$/.test(l)) errs.push(`${where} ${v.cols}x${v.rows} line ${n + 1} has trailing whitespace`);
    });
  }
  return errs;
}

// The widest drawing that fits a box (in OG character cells). Falls back to the narrowest one.
function variantFor(piece, box) {
  let best = piece.variants[0];
  for (const v of piece.variants) if (v.cols <= box.cols && v.rows <= box.rows) best = v;
  return best;
}

let cache = null;
function loadGallery(dir = DIR) {
  if (dir === DIR && cache) return cache;
  const pieces = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt')).sort()) {
    let p;
    try {
      p = parseGalleryFile(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    } catch (err) {
      console.error(`Skipping gallery file: ${err.message}`);
      continue;
    }
    const errs = validateGalleryPiece(p);
    if (errs.length) {
      console.error(`Skipping gallery piece:\n  ${errs.join('\n  ')}`);
      continue;
    }
    pieces.push(p);
  }
  if (dir === DIR) cache = pieces;
  return pieces;
}

module.exports = { parseGalleryFile, validateGalleryPiece, variantFor, loadGallery, LAYOUT, LIMITS, DIR };
