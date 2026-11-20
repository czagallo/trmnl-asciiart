// Builds the screen's view model from a user's settings and the clock. No I/O: the collection is loaded once from disk.

const { pieceAt, normalizeSettings } = require('./schedule');
const { THEMES, SEASONAL } = require('./art');

function themeLabel(theme) {
  return THEMES[theme] || SEASONAL[theme] || theme;
}

// settings: stored per-user settings (or null for defaults). Never throws: a broken collection becomes an error view.
function buildView(settings, { now = Date.now(), timeZone, pieces } = {}) {
  const s = normalizeSettings(settings);
  try {
    const r = pieces ? pieceAt(s, { now, timeZone }, pieces) : pieceAt(s, { now, timeZone });
    if (!r.piece || !r.piece.lines || r.piece.rows === 0) return { state: 'error', error: 'empty' };
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
    };
  } catch (err) {
    console.error('Could not pick a piece:', err.message);
    return { state: 'error', error: 'internal' };
  }
}

module.exports = { buildView, themeLabel };
