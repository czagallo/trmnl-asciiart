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

// box.creditRows: rows the artist credit takes from the art when the caption shows it on a line of its own.
function fits(piece, box) {
  if (!piece || piece.variants || piece.generated) return true;
  const rows = box.rows - (piece.by ? box.creditRows || 0 : 0);
  return piece.cols * 0.6 * MIN_FONT <= box.cols * CELL_PX[0] && piece.rows * 1.2 * MIN_FONT <= rows * CELL_PX[1];
}

// Layouts whose caption puts the credit on a second line on TRMNL OG (src/markup.js), in OG character rows.
const CREDIT_ROWS = { half_horizontal: { wide: 2 } };

// Every layout and orientation, as [view, orientation, box].
function boxes() {
  const out = [];
  for (const [view, b] of Object.entries(LAYOUT.boxes)) {
    for (const [orient, box] of Object.entries(b)) {
      const creditRows = CREDIT_ROWS[view] && CREDIT_ROWS[view][orient];
      out.push([view, orient, creditRows ? { ...box, creditRows } : box]);
    }
  }
  return out;
}

module.exports = { fits, boxes, MIN_FONT };
