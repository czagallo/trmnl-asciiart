// Does a piece fit a layout box legibly?
//
// Boxes come from src/gallery/layout.json: the art box of every layout, in character cells of about 6.5 x 13 px on a
// TRMNL OG, for landscape (wide) and portrait (tall) screens. A hand-drawn piece is scaled to fill its box; it fits
// when its text stays at least MIN_FONT px tall there. A cell of the SVG is 0.6 x 1.2 font sizes, so that means
// cols <= box.cols * 6.5 / (0.6 * MIN_FONT) and rows <= box.rows * 13 / (1.2 * MIN_FONT).
// Gallery pieces (several widths, one picked per box) and generated pieces (drawn for the box) always fit.

const { LAYOUT } = require('./gallery');

const MIN_FONT = 6;
const CELL_PX = [6.5, 13];

function fits(piece, box) {
  if (!piece || piece.variants || piece.generated) return true;
  return piece.cols * 0.6 * MIN_FONT <= box.cols * CELL_PX[0] && piece.rows * 1.2 * MIN_FONT <= box.rows * CELL_PX[1];
}

// Every layout and orientation, as [view, orientation, box].
function boxes() {
  const out = [];
  for (const [view, b] of Object.entries(LAYOUT.boxes)) for (const [orient, box] of Object.entries(b)) out.push([view, orient, box]);
  return out;
}

module.exports = { fits, boxes, MIN_FONT };
