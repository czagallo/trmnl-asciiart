// Pure markup builders for every TRMNL layout.
//
// Same rules as the other plugins in this repo:
// - The platform picks the screen and adds screen--sm/md/lg, screen--portrait and bit-depth classes; we never branch
//   on device in JS. Text uses framework classes with lg:/portrait: prefixes, graphics are SVG with a viewBox.
// - Black and white only (currentColor in SVG), no hex colors: they dither badly on 1-bit panels.
// - TRMNL parses every markup string as Liquid, so nothing may contain "{{" or "{%". esc() also escapes braces.
//
// The art is an SVG whose viewBox is the piece's character grid (cols x rows cells of 6 x 12 units), so the browser
// scales the font to whatever box the layout leaves: a 13-column espresso cup and a 64-column ridgeline both fill
// it without wrapping or clipping. Every run of characters is placed at its exact column and stretched to its exact
// width (textLength), so columns line up even if the renderer falls back to a font with other proportions.

const { GENERATORS, generatePiece } = require('./generate');
const { variantFor, LAYOUT } = require('./gallery');
const { THEMES, SEASONAL } = require('./art');

const CELL_W = 6;
const CELL_H = 12;
const FONT_SIZE = 10; // 0.6em advance = 6 units, the width of a cell in every common monospace font
const BASELINE = 9.4;
const FONTS = "'DejaVu Sans Mono','Liberation Mono',Menlo,Consolas,'Courier New',monospace";

const STYLE = `<style>
.asc-art{flex:1 1 0;min-height:0;min-width:0;width:100%;display:flex;align-items:center;justify-content:center}
.asc-art svg{display:block;width:100%;height:100%}
.asc-art text{font-weight:600}
.asc-cap{flex:none;display:flex;justify-content:space-between;align-items:baseline;gap:12px;width:100%;min-width:0}
.asc-cap .asc-title{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.asc-cap .asc-next{flex:none;white-space:nowrap}
.asc-art .asc-tall{display:none}
.screen--portrait .asc-art .asc-wide{display:none}
.screen--portrait .asc-art .asc-tall{display:block}
.screen--portrait .view--half_vertical .asc-long,.screen--portrait .view--quadrant .asc-long{display:none}
.view--quadrant .asc-by,.view--half_vertical .asc-by,.screen--portrait .view--half_horizontal .asc-by{display:none}
/* TRMNL X quadrant: room for the credit, on a line of its own so long credits stay readable. */
.screen--lg .view--quadrant .asc-by{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.screen--lg .view--quadrant .asc-sep{display:none}
.screen--lg .view--quadrant .asc-title{display:block}
.screen--lg .view--quadrant .asc-cap{align-items:flex-end}
.asc-o-tall{display:none !important}
.screen--portrait .asc-o-wide{display:none !important}
.screen--portrait .asc-o-tall{display:flex !important}
</style>`;

function esc(s) {
  return String(s).replace(
    /[&<>"'{}]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '{': '&#123;', '}': '&#125;' })[c],
  );
}

function minutesLeft(ms) {
  return Math.max(1, Math.ceil(ms / 60000));
}

// ---------------------------------------------------------------------------
// Art
// ---------------------------------------------------------------------------

// Runs of text without double spaces. A single space inside a run survives SVG whitespace handling, two or more
// would collapse, so runs are split there and each one is positioned on its own.
function runs(line) {
  const out = [];
  const re = /\S+(?: \S+)*/g;
  let m;
  while ((m = re.exec(line))) out.push({ col: m.index, text: m[0] });
  return out;
}

// minCols/minRows keep tiny pieces from being blown up to poster size: the grid is at least that big, centred.
function artSvg(piece, { minCols = 0, minRows = 0, label } = {}) {
  const cols = Math.max(piece.cols, minCols, 1);
  const rows = Math.max(piece.rows, minRows, 1);
  const w = cols * CELL_W;
  const h = rows * CELL_H;
  const ox = ((cols - piece.cols) * CELL_W) / 2;
  const oy = Math.floor((rows - piece.rows) / 2) * CELL_H;
  const text = [];
  piece.lines.forEach((line, i) => {
    const y = (oy + i * CELL_H + BASELINE).toFixed(1);
    for (const r of runs(line)) {
      const x = +(ox + r.col * CELL_W).toFixed(1);
      const fit = r.text.length > 1 ? ` textLength="${r.text.length * CELL_W}" lengthAdjust="spacingAndGlyphs"` : '';
      text.push(`<text x="${x}" y="${y}"${fit}>${esc(r.text)}</text>`);
    }
  });
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label || piece.title)}" fill="currentColor" font-family="${FONTS}" font-size="${FONT_SIZE}">${text.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

// cls: extra class (the landscape/portrait switch); piece: the piece shown, whose theme names the instance.
function titleBar(ctx, v, piece, cls = '') {
  const theme = piece && piece !== (v && v.piece) ? THEMES[piece.theme] || SEASONAL[piece.theme] : v && v.theme;
  const instance = ctx.instance || theme || 'Every 15 minutes';
  return `<div class="title_bar${cls}">
<img class="image" src="${esc(ctx.baseUrl)}/icon.svg" alt="">
<span class="title">ASCII Art</span>
<span class="instance">${esc(instance)}</span>
</div>`;
}

function caption(v, size, piece = v.piece) {
  if (!v.caption) return '';
  // TRMNL X gets bigger type, and X held upright the biggest. The quadrant is the same size on X in either
  // orientation, so it skips the portrait step (and shows the artist, which OG has no room for).
  const cls = size === 'small' ? 'label label--small lg:label--large' : 'label lg:label--large lg:portrait:label--xlarge';
  // Narrow portrait boxes drop "next in" (CSS) so the title keeps its room.
  const next = `<span class="asc-long">next in&nbsp;</span>${minutesLeft(v.msLeft)}m`;
  const by = piece.by ? `<span class="asc-by"><span class="asc-sep">&nbsp;&middot; </span>${esc(piece.by)}</span>` : '';
  return `<div class="asc-cap">
<span class="asc-title ${cls}">${esc(piece.title)}${by}</span>
<span class="asc-next ${cls}">${next}</span>
</div>`;
}

// Per layout: how small a piece may be before it stops growing (min grid, in cells), the canvas generated pieces are
// drawn on (shaped like the box, so they never shrink to unreadable sizes), and the gap above the caption.
// genTall is the canvas for portrait screens: generated pieces get both, CSS shows the one matching the screen.
const SIZES = {
  full: { minCols: 22, minRows: 9, gen: { cols: 60, rows: 18 }, genTall: { cols: 40, rows: 30 }, gap: 8, cap: 'normal' },
  half_horizontal: { minCols: 26, minRows: 7, gen: { cols: 64, rows: 10 }, genTall: { cols: 48, rows: 16 }, gap: 4, cap: 'normal' },
  half_vertical: { minCols: 18, minRows: 10, gen: { cols: 32, rows: 16 }, genTall: { cols: 20, rows: 32 }, gap: 6, cap: 'normal' },
  quadrant: { minCols: 18, minRows: 7, gen: { cols: 34, rows: 10 }, genTall: { cols: 22, rows: 16 }, gap: 4, cap: 'small' },
};

// Generated pieces are redrawn from their seed on the layout's canvas; hand-made pieces are used as they are.
function forLayout(piece, size) {
  if (!piece.generated) return piece;
  const gen = GENERATORS.find((g) => g.id === piece.id);
  return gen ? generatePiece(gen, piece.seed, size) : piece;
}

// Gallery pieces come in several widths: each screen orientation gets the widest one that fits its box.
function galleryArt(piece, view) {
  const box = LAYOUT.boxes[view];
  const wide = variantFor(piece, box.wide);
  const tall = variantFor(piece, box.tall);
  const svg = (v) => artSvg({ ...piece, ...v });
  if (wide === tall) return svg(wide);
  return svg(wide).replace('<svg ', '<svg class="asc-wide" ') + svg(tall).replace('<svg ', '<svg class="asc-tall" ');
}

function art(piece, s, view) {
  if (piece.variants) return galleryArt(piece, view);
  if (!piece.generated) return artSvg(piece, s);
  const wide = artSvg(forLayout(piece, s.gen), s).replace('<svg ', '<svg class="asc-wide" ');
  const tall = artSvg(forLayout(piece, s.genTall), s).replace('<svg ', '<svg class="asc-tall" ');
  return wide + tall;
}

// v.fit[view] holds a smaller piece for a box the slot's piece would be illegible in (see src/view.js). When
// landscape and portrait need different pieces, both are rendered and CSS shows the one for the screen.
function layout(view, v, ctx) {
  const s = SIZES[view];
  const wide = (v.fit && v.fit[view] && v.fit[view].wide) || v.piece;
  const tall = (v.fit && v.fit[view] && v.fit[view].tall) || v.piece;
  const body = (p, cls) => `<div class="layout layout--col${cls}" style="gap:${s.gap}px;align-items:stretch;justify-content:stretch">
<div class="asc-art">${art(p, s, view)}</div>
${caption(v, s.cap, p)}
</div>`;
  const inner =
    wide === tall
      ? `${body(wide, '')}\n${titleBar(ctx, v, wide)}`
      : `${body(wide, ' asc-o-wide')}\n${body(tall, ' asc-o-tall')}\n${titleBar(ctx, v, wide, ' asc-o-wide')}\n${titleBar(ctx, v, tall, ' asc-o-tall')}`;
  return `<div class="view view--${view}">${STYLE}
${inner}
</div>`;
}

const MESSAGES = {
  empty: ['Nothing to show', 'No piece matches the plugin settings. Pick more themes on the settings page.'],
  internal: ['Art unavailable', 'Something went wrong picking a piece. It will try again on the next refresh.'],
};

function message(view, v, ctx) {
  const [title, text] = MESSAGES[v.error] || MESSAGES.internal;
  return `<div class="view view--${view}">
<div class="layout layout--col layout--center" style="gap:6px">
  <span class="title text--center">${esc(title)}</span>
  <span class="description text--center">${esc(text)}</span>
</div>
${titleBar(ctx, null)}
</div>`;
}

// ctx: { baseUrl, instance }
function renderAll(v, ctx) {
  const views = { markup: 'full', markup_half_horizontal: 'half_horizontal', markup_half_vertical: 'half_vertical', markup_quadrant: 'quadrant' };
  const out = {};
  for (const [key, view] of Object.entries(views)) {
    out[key] = v && v.state === 'ok' ? layout(view, v, ctx) : message(view, v || { state: 'error', error: 'internal' }, ctx);
  }
  return out;
}

module.exports = { renderAll, esc, artSvg, runs, minutesLeft, forLayout, SIZES, CELL_W, CELL_H };
