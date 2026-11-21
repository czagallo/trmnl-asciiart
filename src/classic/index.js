// The classic collection: hand-drawn ASCII art by the artists of the ASCII Art Archive (asciiart.eu), picked by
// scripts/classic/picks.json and written by scripts/classic/build.py. Signatures stay in the art, and every piece
// names its artist and source:
//
//   === Mountains | mountains
//   by: Joan G. Stark
//   source: https://www.asciiart.eu/nature/mountains
//   ...art...
//
// Same rules as the sketches in src/art (same parser and validation), plus the two credit lines.

const fs = require('fs');
const path = require('path');
const { parseArtFile, validatePiece } = require('../art');

const DIR = __dirname;

function parseClassicFile(text, file = 'inline') {
  const theme = path.basename(file, '.txt');
  return parseArtFile(text, file).map((p, i) => {
    const meta = {};
    let lines = p.lines;
    while (lines.length && /^(by|source): /.test(lines[0])) {
      const [, k, v] = /^(by|source): (.*)$/.exec(lines[0]);
      meta[k] = v.trim();
      lines = lines.slice(1);
    }
    return {
      ...p,
      id: `classic-${theme}-${i + 1}`,
      collection: 'classic',
      by: meta.by,
      source: meta.source,
      lines,
      rows: lines.length,
      cols: lines.reduce((m, l) => Math.max(m, l.length), 0),
    };
  });
}

function validateClassicPiece(p) {
  const errs = validatePiece(p);
  if (!p.by || !p.source) errs.push(`${p.file}: "${p.title}" needs by: and source: lines`);
  return errs;
}

let cache = null;
function loadClassic(dir = DIR) {
  if (dir === DIR && cache) return cache;
  const pieces = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt')).sort()) {
    for (const p of parseClassicFile(fs.readFileSync(path.join(dir, f), 'utf8'), f)) {
      const errs = validateClassicPiece(p);
      if (errs.length) console.error(`Skipping classic piece:\n  ${errs.join('\n  ')}`);
      else pieces.push(p);
    }
  }
  if (dir === DIR) cache = pieces;
  return pieces;
}

module.exports = { parseClassicFile, validateClassicPiece, loadClassic, DIR };
