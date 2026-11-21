// Which piece is on screen when.
//
// Time is cut into 15-minute slots: slot = floor(now / 15 min). Every request in the same slot gets the same piece.
// The eligible pieces (theme filter + season) form a playlist that is shuffled once per cycle with a seed derived from
// the cycle number, so the whole playlist is shown before anything comes back, and the order differs every cycle.
// The shuffle is repaired so the same piece never shows twice in a row, also across the boundary between two cycles.

const { loadCollection, THEMES, SEASONAL } = require('./art');
const { loadGallery } = require('./gallery');
const { loadClassic } = require('./classic');
const { GENERATORS, generatePiece, rng } = require('./generate');

const SLOT_MS = 15 * 60 * 1000;
const SEASON_WEIGHT = 2; // in-season seasonal pieces come up this many times per cycle

const slotOf = (now) => Math.floor(now / SLOT_MS);
const slotEnd = (slot) => (slot + 1) * SLOT_MS;

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function localDate(now, timeZone) {
  const fmt = (tz) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(now));
  let parts;
  try {
    parts = fmt(timeZone || 'UTC');
  } catch {
    parts = fmt('UTC');
  }
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

// Seasons flip south of the equator. The time zone is the only location hint TRMNL sends, and it is good enough.
const SOUTHERN = /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Apia|Noumea|Efate)$|^America\/(Argentina\/.*|Santiago|Punta_Arenas|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima|Buenos_Aires)$|^Africa\/(Johannesburg|Maputo|Windhoek|Harare|Lusaka|Gaborone|Maseru|Mbabane|Blantyre|Lubumbashi)$|^Indian\/(Mauritius|Reunion|Antananarivo)$/;

function isSouthern(timeZone) {
  return SOUTHERN.test(String(timeZone || ''));
}

// Meteorological seasons: Dec-Feb winter, Mar-May spring, Jun-Aug summer, Sep-Nov autumn (northern hemisphere).
function seasonOf(month, southern = false) {
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][month - 1];
  if (!southern) return north;
  return { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' }[north];
}

// Christmas and Advent pieces belong to December everywhere; the others follow the local season.
function inSeason(theme, { month, southern }) {
  if (theme === 'christmas') return month === 12;
  return seasonOf(month, southern) === theme;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const FILTER_KEYS = [...Object.keys(THEMES), 'seasonal'];
// classic: hand-drawn pieces by ASCII artists (asciiart.eu); gallery: public-domain artworks converted to ASCII;
// sketches: the pieces made for this plugin, plus the generators. Any mix can be picked; null means all of them.
const COLLECTIONS = ['classic', 'gallery', 'sketches'];
const DEFAULTS = Object.freeze({ themes: null, seasonal: true, caption: true, collections: null });

// Every piece the plugin knows.
function allPieces() {
  return [...loadClassic(), ...loadGallery(), ...loadCollection()];
}

const collectionOf = (p) => p.collection || 'sketches';

// Turns whatever was stored (or nothing) into complete settings. themes: null = everything.
function normalizeSettings(s) {
  const out = { ...DEFAULTS };
  if (!s || typeof s !== 'object') return out;
  if (Array.isArray(s.themes)) {
    const t = FILTER_KEYS.filter((k) => s.themes.includes(k));
    out.themes = t.length === 0 || t.length === FILTER_KEYS.length ? null : t;
  }
  if (typeof s.seasonal === 'boolean') out.seasonal = s.seasonal;
  if (typeof s.caption === 'boolean') out.caption = s.caption;
  // Older settings stored one choice: "gallery", "sketches" or "both".
  const picked = Array.isArray(s.collections)
    ? s.collections
    : { gallery: ['gallery'], sketches: ['sketches'], both: ['gallery', 'sketches'] }[s.collection];
  if (picked) {
    const c = COLLECTIONS.filter((k) => picked.includes(k));
    out.collections = c.length === 0 || c.length === COLLECTIONS.length ? null : c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Playlist
// ---------------------------------------------------------------------------

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Ids of every eligible piece, in-season seasonal pieces SEASON_WEIGHT times. Sorted, so the result depends only on
// the collection and the settings, not on file order.
function playlist(settings, cal, pieces = allPieces()) {
  const s = normalizeSettings(settings);
  const wanted = (k) => !s.themes || s.themes.includes(k);
  const inCollection = (c) => !s.collections || s.collections.includes(c);
  const ids = [];
  for (const p of pieces) {
    if (!inCollection(collectionOf(p))) continue;
    if (THEMES[p.theme]) {
      if (wanted(p.theme)) ids.push(p.id);
    } else if (SEASONAL[p.theme] && wanted('seasonal')) {
      if (!s.seasonal) ids.push(p.id);
      else if (inSeason(p.theme, cal)) for (let i = 0; i < SEASON_WEIGHT; i++) ids.push(p.id);
    }
  }
  if (inCollection('sketches')) for (const g of GENERATORS) if (wanted(g.theme)) ids.push(g.id);
  if (ids.length === 0 && s.themes) {
    // e.g. only "seasonal" picked and nothing is in season: show the year-round collection rather than nothing.
    return { ids: playlist({ ...s, themes: null }, cal, pieces).ids.filter((id) => !isSeasonalId(id, pieces)), fallback: true };
  }
  return { ids: ids.sort(), fallback: false };
}

function isSeasonalId(id, pieces) {
  const p = pieces.find((x) => x.id === id);
  return Boolean(p && SEASONAL[p.theme]);
}

function shuffle(ids, seed) {
  const a = ids.slice();
  const rand = rng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Moves duplicates apart so no id follows itself. Only needed for weighted (doubled) entries.
function separate(a) {
  const n = a.length;
  for (let i = 1; i < n; i++) {
    if (a[i] !== a[i - 1]) continue;
    for (let j = 0; j < n; j++) {
      if (j === i || a[j] === a[i]) continue;
      const ok = (k, v) => k < 0 || k >= n || k === i || k === j || a[k] !== v;
      // a[j] moves to i, a[i] moves to j: both must differ from their new neighbours.
      if (ok(i - 1, a[j]) && ok(i + 1, a[j]) && ok(j - 1, a[i]) && ok(j + 1, a[i])) {
        [a[i], a[j]] = [a[j], a[i]];
        break;
      }
    }
  }
  return a;
}

function baseOrder(ids, cycle) {
  return separate(shuffle(ids, hash(`${cycle}:${ids.join(',')}`)));
}

// Order of one cycle. Its first piece is never the previous cycle's last one. The fix only touches positions
// 0..n-2, so the last piece of a cycle is the same in baseOrder and cycleOrder.
function cycleOrder(ids, cycle) {
  const a = baseOrder(ids, cycle);
  const n = a.length;
  if (n < 3) return a;
  const prevLast = baseOrder(ids, cycle - 1)[n - 1];
  if (a[0] !== prevLast) return a;
  for (let k = 1; k < n - 1; k++) {
    if (a[k] === prevLast || a[k] === a[0]) continue;
    // a[k] moves to 0 (neighbour a[1]), a[0] moves to k (neighbours a[k-1], a[k+1]).
    const next0 = k === 1 ? a[0] : a[1];
    const left = k === 1 ? a[k] : a[k - 1];
    if (a[k] !== next0 && a[0] !== left && a[0] !== a[k + 1]) {
      [a[0], a[k]] = [a[k], a[0]];
      break;
    }
  }
  return a;
}

function pickId(ids, slot) {
  const n = ids.length;
  if (n === 1) return ids[0];
  if (n === 2) return ids[((slot % 2) + 2) % 2];
  const cycle = Math.floor(slot / n);
  return cycleOrder(ids, cycle)[slot - cycle * n];
}

// The piece for a moment in time. Generated pieces are drawn from the slot number.
// Also returns nextFitting(ok): the first piece from this slot on that passes ok(), for layouts too small for the
// slot's own piece. It walks the same rotation forward, so it is deterministic too.
function pieceAt(settings, { now = Date.now(), timeZone } = {}, pieces = allPieces()) {
  const slot = slotOf(now);
  const d = localDate(now, timeZone);
  const cal = { month: d.month, southern: isSouthern(timeZone) };
  const { ids, fallback } = playlist(settings, cal, pieces);
  if (ids.length === 0) return { piece: null, slot, nextAt: slotEnd(slot), playlistSize: 0, fallback, nextFitting: () => null };
  const resolve = (id) => {
    const gen = GENERATORS.find((g) => g.id === id);
    return gen ? generatePiece(gen, slot) : pieces.find((p) => p.id === id);
  };
  const piece = resolve(pickId(ids, slot));
  const nextFitting = (ok) => {
    for (let k = 0; k < ids.length + 1; k++) {
      const p = k === 0 ? piece : resolve(pickId(ids, slot + k));
      if (p && ok(p)) return p;
    }
    return null;
  };
  return { piece, slot, nextAt: slotEnd(slot), playlistSize: ids.length, fallback, nextFitting };
}

module.exports = {
  SLOT_MS,
  SEASON_WEIGHT,
  FILTER_KEYS,
  COLLECTIONS,
  DEFAULTS,
  allPieces,
  slotOf,
  slotEnd,
  localDate,
  isSouthern,
  seasonOf,
  inSeason,
  normalizeSettings,
  playlist,
  cycleOrder,
  pickId,
  pieceAt,
};
