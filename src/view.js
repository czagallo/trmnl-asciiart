// Builds the screen's view model from a user's settings and the clock. No I/O: the collection is loaded once from disk.

const { pieceAt, normalizeSettings } = require('./schedule');
const { THEMES, SEASONAL } = require('./art');
const { fits, boxes } = require('./fit');

// Layouts too small for a piece show another one that fits them, per orientation: nextFitting(ok) supplies it
// (in the plugin, the next piece of the rotation that passes ok). Returns { view: { wide?, tall? } }.
function fitFor(piece, nextFitting) {
  const fit = {};
  for (const [view, orient, box] of boxes()) {
    if (fits(piece, box)) continue;
    const alt = nextFitting((p) => fits(p, box));
    if (alt) (fit[view] = fit[view] || {})[orient] = alt;
  }
  return fit;
}

function themeLabel(theme) {
  return THEMES[theme] || SEASONAL[theme] || theme;
}

// settings: stored per-user settings (or null for defaults). Never throws: a broken collection becomes an error view.
function buildView(settings, { now = Date.now(), timeZone, pieces } = {}) {
  const s = normalizeSettings(settings);
  try {
    const r = pieces ? pieceAt(s, { now, timeZone }, pieces) : pieceAt(s, { now, timeZone });
    if (!r.piece || !r.piece.lines || r.piece.rows === 0) return { state: 'error', error: 'empty' };
    const fit = fitFor(r.piece, r.nextFitting);
    return {
      state: 'ok',
      piece: r.piece,
      theme: themeLabel(r.piece.theme),
      slot: r.slot,
      nextAt: r.nextAt,
      msLeft: r.nextAt - now,
      caption: s.caption,
      fallback: r.fallback,
      playlistSize: r.playlistSize,
      fit,
    };
  } catch (err) {
    console.error('Could not pick a piece:', err.message);
    return { state: 'error', error: 'internal' };
  }
}

module.exports = { buildView, themeLabel, fitFor };
