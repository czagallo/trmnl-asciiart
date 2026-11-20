const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArtFile, validatePiece, loadCollection, THEMES, SEASONAL, LIMITS } = require('../src/art');
const { GENERATORS, generatePiece } = require('../src/generate');
const sched = require('../src/schedule');
const { buildView } = require('../src/view');
const { renderAll, esc, artSvg, runs, minutesLeft, SIZES, forLayout } = require('../src/markup');
const { createStore } = require('../src/store');

const MIN = 60e3;
const SLOT = sched.SLOT_MS;
const pieces = loadCollection();
const NOV = Date.UTC(2026, 10, 19, 12, 0);
const DEC = Date.UTC(2026, 11, 10, 12, 0);
const JUL = Date.UTC(2026, 6, 10, 12, 0);
const STYLE_RE = /<style>[\s\S]*?<\/style>/;

// ---------------------------------------------------------------------------
// Collection: parsing and validation
// ---------------------------------------------------------------------------

test('art files parse into titled, themed pieces with exact whitespace', () => {
  const ps = parseArtFile('=== Box | abstract\n\n  +--+\n  |  | \\\n  +--+\n\n=== Two Words | nature\n /\\\n/  \\\n', 't.txt');
  assert.equal(ps.length, 2);
  assert.deepEqual(ps[0], { id: 'box', title: 'Box', theme: 'abstract', file: 't.txt', lines: ['  +--+', '  |  | \\', '  +--+'], rows: 3, cols: 8 });
  assert.equal(ps[1].id, 'two-words');
  assert.deepEqual(ps[1].lines, [' /\\', '/  \\']);
  assert.throws(() => parseArtFile('stray\n=== A | sea\nx'), /before the first/);
});

test('validation catches tabs, trailing whitespace, unknown themes, odd characters and size limits', () => {
  const v = (lines, theme = 'sea') => validatePiece({ title: 'T', theme, file: 'f', lines, rows: lines.length, cols: Math.max(...lines.map((l) => l.length)) });
  assert.deepEqual(v(['12345678', '12345678', '12345678']), []);
  assert.match(v(['1234\t678', '12345678', '1']).join(), /tab/);
  assert.match(v(['12345678 ', '12345678', '1']).join(), /trailing whitespace/);
  assert.match(v(['12345678', '12345678', '1'], 'pirates').join(), /unknown theme/);
  assert.match(v(['1234567é', '12345678', '1']).join(), /non-ASCII/);
  assert.match(v(['x'.repeat(LIMITS.maxCols + 1), 'x', 'x']).join(), /columns wide/);
  assert.match(v(Array(LIMITS.maxRows + 1).fill('xxxxxxxx')).join(), /rows tall/);
  assert.match(v(['ab', 'cd']).join(), /too small/);
});

test('the collection has at least 60 valid hand-made pieces across every theme and season', () => {
  assert.ok(pieces.length >= 60, `only ${pieces.length} pieces`);
  for (const p of pieces) assert.deepEqual(validatePiece(p), [], p.title);
  const ids = new Set(pieces.map((p) => p.id));
  assert.equal(ids.size, pieces.length, 'duplicate titles');
  for (const t of [...Object.keys(THEMES), ...Object.keys(SEASONAL)]) {
    const n = pieces.filter((p) => p.theme === t).length;
    assert.ok(n >= 3, `theme ${t} has only ${n} pieces`);
  }
});

test('every art file is clean: no tabs, no trailing whitespace, no art line that looks like a header', () => {
  const dir = path.join(__dirname, '..', 'src', 'art');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt'));
  assert.ok(files.length >= 5);
  let total = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    text.split('\n').forEach((l, i) => {
      assert.ok(!l.includes('\t'), `${f}:${i + 1} tab`);
      assert.ok(!/[ \t]$/.test(l), `${f}:${i + 1} trailing whitespace`);
      if (l.startsWith('=== ')) assert.match(l, /^=== .+ \| [a-z]+$/, `${f}:${i + 1} malformed header`);
    });
    total += parseArtFile(text, f).length;
  }
  assert.equal(total, pieces.length, 'some pieces were skipped by the loader');
});

test('pieces come in many sizes, all within the limits', () => {
  const widths = pieces.map((p) => p.cols);
  const heights = pieces.map((p) => p.rows);
  assert.ok(Math.min(...widths) <= 16 && Math.max(...widths) >= 50, 'needs small and wide pieces');
  assert.ok(Math.max(...heights) >= 13, 'needs tall pieces');
  for (const p of pieces) assert.ok(p.cols <= LIMITS.maxCols && p.rows <= LIMITS.maxRows, p.title);
});

// ---------------------------------------------------------------------------
// Generated pieces
// ---------------------------------------------------------------------------

test('generated pieces are deterministic per seed, differ between seeds and fit any canvas', () => {
  for (const g of GENERATORS) {
    const a = generatePiece(g, 12345);
    assert.deepEqual(generatePiece(g, 12345), a, g.id);
    assert.notDeepEqual(generatePiece(g, 12346).lines, a.lines, g.id);
    assert.match(a.title, /No\. \d+$/);
    for (const size of [undefined, ...Object.values(SIZES).map((s) => s.gen)]) {
      for (const seed of [0, 1, 7, 99999, 2e6]) {
        const p = generatePiece(g, seed, size);
        const err = validatePiece({ ...p, file: 'gen' });
        assert.deepEqual(err.filter((e) => !/too small/.test(e)), [], `${g.id} seed ${seed}`);
        if (size) assert.ok(p.cols <= size.cols && p.rows === size.rows, `${g.id} ${p.cols}x${p.rows} on ${size.cols}x${size.rows}`);
        assert.ok(p.lines.some((l) => l.trim()), `${g.id} seed ${seed} is empty`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Timing and selection
// ---------------------------------------------------------------------------

test('slots are 15 minutes and every request in a slot shows the same piece', () => {
  const start = 1_000_000 * SLOT;
  assert.equal(sched.slotOf(start), 1_000_000);
  assert.equal(sched.slotOf(start + SLOT - 1), 1_000_000);
  assert.equal(sched.slotOf(start + SLOT), 1_000_001);
  assert.equal(sched.slotEnd(1_000_000), start + SLOT);
  const a = sched.pieceAt(null, { now: start + 1 });
  const b = sched.pieceAt(null, { now: start + 14 * MIN });
  assert.equal(a.piece.id, b.piece.id);
  assert.equal(a.nextAt, start + SLOT);
});

test('"next in" counts whole minutes up, never 0', () => {
  assert.equal(minutesLeft(15 * MIN), 15);
  assert.equal(minutesLeft(14 * MIN + 1), 15);
  assert.equal(minutesLeft(30e3), 1);
  assert.equal(minutesLeft(-5), 1);
  const v = buildView(null, { now: 1_000_000 * SLOT + 11 * MIN + 20e3 });
  assert.equal(minutesLeft(v.msLeft), 4);
});

function walk(settings, now, n) {
  const ids = [];
  const first = sched.slotOf(now);
  for (let s = first; s < first + n; s++) ids.push(sched.pieceAt(settings, { now: s * SLOT, timeZone: 'Europe/Vienna' }).piece.id);
  return ids;
}

test('consecutive slots never repeat a piece, also across cycle boundaries and in every setting', () => {
  const configs = [null, { seasonal: false }, { themes: ['coffee'] }, { themes: ['seasonal'] }, { themes: ['abstract', 'seasonal'] }, { themes: ['space', 'sea'] }];
  for (const cfg of configs) {
    for (const now of [NOV, DEC, JUL]) {
      const size = sched.playlist(cfg, { month: new Date(now).getUTCMonth() + 1, southern: false }).ids.length;
      const ids = walk(cfg, now, size * 3 + 5);
      for (let i = 1; i < ids.length; i++) assert.notEqual(ids[i], ids[i - 1], `${JSON.stringify(cfg)} at ${i}`);
    }
  }
});

test('the whole collection is shown before anything repeats', () => {
  const cal = { month: 11, southern: false };
  const { ids } = sched.playlist({ seasonal: false }, cal);
  const n = ids.length;
  assert.equal(new Set(ids).size, n, 'without weighting every piece is in the playlist once');
  assert.equal(n, pieces.length + GENERATORS.length);
  // With weighting on (November = autumn), every eligible piece still comes up in every single cycle.
  const weighted = sched.playlist(null, cal).ids;
  for (const c of [0, 1, 77]) assert.equal(new Set(sched.cycleOrder(weighted, c)).size, new Set(weighted).size);
  const cycle = 4321;
  const order = sched.cycleOrder(ids, cycle);
  assert.deepEqual(order.slice().sort(), ids.slice().sort());
  for (let s = cycle * n; s < (cycle + 1) * n; s++) assert.equal(sched.pickId(ids, s), order[s - cycle * n]);
  assert.notDeepEqual(sched.cycleOrder(ids, cycle + 1), order, 'each cycle has its own order');
});

test('selection is a pure function of the slot', () => {
  const now = NOV + 3 * SLOT;
  assert.equal(sched.pieceAt(null, { now }).piece.id, sched.pieceAt(null, { now }).piece.id);
  assert.deepEqual(walk(null, DEC, 40), walk(null, DEC, 40));
});

test('seasons follow the local month and flip in the southern hemisphere', () => {
  assert.equal(sched.seasonOf(12), 'winter');
  assert.equal(sched.seasonOf(4), 'spring');
  assert.equal(sched.seasonOf(7), 'summer');
  assert.equal(sched.seasonOf(10), 'autumn');
  assert.equal(sched.seasonOf(7, true), 'winter');
  assert.ok(sched.isSouthern('Australia/Sydney'));
  assert.ok(sched.isSouthern('America/Argentina/Buenos_Aires'));
  assert.ok(!sched.isSouthern('Europe/Vienna'));
  assert.ok(sched.inSeason('christmas', { month: 12, southern: true }));
  assert.ok(!sched.inSeason('christmas', { month: 11, southern: false }));
  // Nov 30, 23:30 UTC is already December 1 in Vienna.
  assert.equal(sched.localDate(Date.UTC(2026, 10, 30, 23, 30), 'Europe/Vienna').month, 12);
  assert.equal(sched.localDate(Date.UTC(2026, 10, 30, 23, 30), 'Not/AZone').month, 11);
});

test('seasonal weighting: in season twice, out of season never; off means once, all year', () => {
  const count = (ids, theme) => ids.filter((id) => pieces.find((p) => p.id === id)?.theme === theme).length;
  const nChristmas = pieces.filter((p) => p.theme === 'christmas').length;
  const nSummer = pieces.filter((p) => p.theme === 'summer').length;
  const dec = sched.playlist(null, { month: 12, southern: false }).ids;
  assert.equal(count(dec, 'christmas'), nChristmas * sched.SEASON_WEIGHT);
  assert.equal(count(dec, 'winter'), pieces.filter((p) => p.theme === 'winter').length * sched.SEASON_WEIGHT);
  assert.equal(count(dec, 'summer'), 0);
  const jul = sched.playlist(null, { month: 7, southern: false }).ids;
  assert.equal(count(jul, 'christmas'), 0);
  assert.equal(count(jul, 'summer'), nSummer * sched.SEASON_WEIGHT);
  const off = sched.playlist({ seasonal: false }, { month: 7, southern: false }).ids;
  assert.equal(count(off, 'christmas'), nChristmas);
  assert.equal(count(off, 'summer'), nSummer);
  // December really shows Christmas pieces in the rotation.
  const seen = new Set(walk(null, DEC, dec.length).map((id) => pieces.find((p) => p.id === id)?.theme));
  assert.ok(seen.has('christmas'));
});

test('theme filter keeps only the chosen themes, including their generated pieces', () => {
  const { ids } = sched.playlist({ themes: ['mountains'] }, { month: 11, southern: false });
  assert.ok(ids.includes('gen-ridgeline'));
  for (const id of ids) assert.ok(id.startsWith('gen-') || pieces.find((p) => p.id === id).theme === 'mountains', id);
  const seasonalOnly = sched.playlist({ themes: ['seasonal'] }, { month: 12, southern: false });
  assert.equal(seasonalOnly.fallback, false);
  for (const id of seasonalOnly.ids) assert.ok(SEASONAL[pieces.find((p) => p.id === id).theme], id);
});

test('a filter with nothing in season falls back to the year-round collection instead of an empty screen', () => {
  // Only "seasonal" ticked, but no seasonal set covers... every month has a season, so force it with a fake collection.
  const fake = [{ id: 'x', title: 'X', theme: 'christmas', lines: ['xxxxxxxx'], rows: 1, cols: 8 }, { id: 'y', title: 'Y', theme: 'sea', lines: ['yyyyyyyy'], rows: 1, cols: 8 }];
  const r = sched.playlist({ themes: ['seasonal'] }, { month: 7, southern: false }, fake);
  assert.equal(r.fallback, true);
  assert.ok(r.ids.includes('y') && !r.ids.includes('x'));
  const v = buildView({ themes: ['seasonal'] }, { now: JUL, pieces: fake });
  assert.equal(v.state, 'ok');
  assert.equal(v.fallback, true);
});

test('settings are normalised: unknown themes dropped, empty or complete filter means everything', () => {
  assert.deepEqual(sched.normalizeSettings(null), { themes: null, seasonal: true, caption: true });
  assert.deepEqual(sched.normalizeSettings({ themes: ['sea', 'pirates'], seasonal: false, caption: false }), { themes: ['sea'], seasonal: false, caption: false });
  assert.equal(sched.normalizeSettings({ themes: [] }).themes, null);
  assert.equal(sched.normalizeSettings({ themes: sched.FILTER_KEYS }).themes, null);
  assert.equal(sched.normalizeSettings({ seasonal: 'yes' }).seasonal, true);
});

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

const LAYOUT_KEYS = ['markup', 'markup_half_horizontal', 'markup_half_vertical', 'markup_quadrant'];
const VIEW_CLASS = { markup: 'view--full', markup_half_horizontal: 'view--half_horizontal', markup_half_vertical: 'view--half_vertical', markup_quadrant: 'view--quadrant' };

function assertSafe(out, name) {
  assert.deepEqual(Object.keys(out).sort(), [...LAYOUT_KEYS].sort(), name);
  for (const k of LAYOUT_KEYS) {
    assert.match(out[k], new RegExp(VIEW_CLASS[k]), `${name} ${k}`);
    assert.match(out[k], /class="title_bar"/, `${name} ${k}`);
    assert.match(out[k], /icon\.svg/, `${name} ${k}`);
    assert.doesNotMatch(out[k], /\{\{|\{%/, `${name} ${k} contains Liquid delimiters`);
    // Outside <style> (CSS needs single braces) no brace may appear unescaped: art and titles are escaped.
    assert.doesNotMatch(out[k].replace(STYLE_RE, ''), /[{}]/, `${name} ${k} contains a raw brace`);
    assert.doesNotMatch(out[k], /(?:color|fill|stroke|background)\s*[:=]\s*"?\s*#[0-9a-f]{3}/i, `${name} ${k} contains a hex color`);
  }
}

test('every hand-made piece renders Liquid-safe in every layout', () => {
  for (const p of pieces) {
    const v = { state: 'ok', piece: p, theme: 'T', msLeft: 5 * MIN, caption: true };
    assertSafe(renderAll(v, { baseUrl: 'https://x.example' }), p.title);
  }
});

test('views across a day, with and without caption, are Liquid-safe', () => {
  for (let i = 0; i < 96; i += 7) {
    for (const caption of [true, false]) {
      const v = buildView({ caption }, { now: DEC + i * SLOT, timeZone: 'Europe/Vienna' });
      assert.equal(v.state, 'ok');
      const out = renderAll(v, { baseUrl: 'https://x.example', instance: 'Hall' });
      assertSafe(out, v.piece.title);
      assert.equal(/asc-cap/.test(out.markup.replace(STYLE_RE, '')), caption);
      if (caption) assert.match(out.markup, /next in&nbsp;<\/span>\d+m/);
      assert.match(out.markup, />Hall</);
    }
  }
});

test('art text is escaped, braces included, and whitespace is kept by exact column positions', () => {
  const p = { id: 'evil', title: '<b>{{ title }}</b>', theme: 'abstract', lines: ['{{ x }}  {% raw %}', '  <script>&', '}}'], rows: 3, cols: 17 };
  const out = renderAll({ state: 'ok', piece: p, theme: 'Patterns', msLeft: MIN, caption: true }, { baseUrl: 'https://x.example' });
  assertSafe(out, 'evil');
  assert.doesNotMatch(out.markup, /<script>|<b>/);
  assert.match(out.markup, /&#123;&#123; x &#125;&#125;/);
  assert.match(out.markup, /&lt;b&gt;&#123;&#123; title &#125;&#125;&lt;\/b&gt;/);
  assert.equal(esc('{%'), '&#123;%');
  assert.deepEqual(runs('  ab c   d  e'), [{ col: 2, text: 'ab c' }, { col: 9, text: 'd' }, { col: 12, text: 'e' }]);
});

test('the art SVG has a viewBox of exactly the piece grid and places runs at their columns', () => {
  const p = { id: 't', title: 'T', theme: 'sea', lines: ['/\\    /\\', '  ~~~~'], rows: 2, cols: 8 };
  const svg = artSvg(p);
  assert.match(svg, /viewBox="0 0 48 24"/);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(svg, /<text x="0" y="9.4" textLength="12"[^>]*>\/\\<\/text>/);
  assert.match(svg, /<text x="36" y="9.4" textLength="12"/);
  assert.match(svg, /<text x="12" y="21.4" textLength="24"[^>]*>~~~~<\/text>/);
  assert.doesNotMatch(svg, /fill="#/);
  // Tiny pieces get a minimum grid, centred, so they are not blown up to poster size.
  assert.match(artSvg(p, { minCols: 20, minRows: 6 }), /viewBox="0 0 120 72"/);
});

test('generated pieces are redrawn on a canvas shaped like each layout', () => {
  const g = generatePiece(GENERATORS[0], 42);
  for (const s of Object.values(SIZES)) {
    const p = forLayout(g, s.gen);
    assert.equal(p.title, g.title);
    assert.equal(p.rows, s.gen.rows);
  }
  const hand = pieces[0];
  assert.equal(forLayout(hand, SIZES.quadrant.gen), hand);
  // Generated pieces carry a wide and a tall drawing; CSS on screen--portrait picks one. Hand-made pieces have one.
  const out = renderAll({ state: 'ok', piece: g, theme: 'Mountains', msLeft: MIN, caption: true }, { baseUrl: 'https://x.example' });
  for (const k of LAYOUT_KEYS) {
    assert.equal((out[k].match(/<svg class="asc-wide"/g) || []).length, 1, k);
    assert.equal((out[k].match(/<svg class="asc-tall"/g) || []).length, 1, k);
  }
  const outHand = renderAll({ state: 'ok', piece: hand, theme: 'T', msLeft: MIN, caption: true }, { baseUrl: 'https://x.example' });
  assert.equal((outHand.markup.match(/<svg /g) || []).length, 1);
});

test('error states render a clear message in every layout', () => {
  for (const v of [null, { state: 'error', error: 'empty' }, { state: 'error', error: 'internal' }, { state: 'error', error: 'whatever' }]) {
    const out = renderAll(v, { baseUrl: 'https://x.example' });
    assertSafe(out, JSON.stringify(v));
    assert.match(out.markup, /class="title text--center"/);
  }
  const empty = buildView(null, { now: NOV, pieces: [] });
  assert.equal(empty.state, 'ok', 'generated pieces still fill an empty collection');
  const noCoffee = buildView({ themes: ['coffee'] }, { now: NOV, pieces: [] });
  assert.deepEqual([noCoffee.state, noCoffee.fallback], ['ok', true]);
  const broken = buildView(null, { now: NOV, pieces: { [Symbol.iterator]() { throw new Error('boom'); } } });
  assert.deepEqual(broken, { state: 'error', error: 'internal' });
  assertSafe(renderAll(broken, { baseUrl: 'https://x.example' }), 'broken');
});

// ---------------------------------------------------------------------------
// Store and server
// ---------------------------------------------------------------------------

test('store persists settings with owner-only permissions and forgets them on delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascii-store-'));
  const file = path.join(dir, 'connections.json');
  const a = createStore(file);
  a.update('u1', { themes: ['sea'], seasonal: false, caption: true });
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.deepEqual(createStore(file).get('u1').themes, ['sea']);
  a.delete('u1');
  assert.equal(createStore(file).get('u1'), null);
  fs.rmSync(dir, { recursive: true });
});

test('server: health, markup with defaults and per-user settings, settings page round trip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascii-srv-'));
  process.env.DATA_FILE = path.join(dir, 'connections.json');
  delete require.cache[require.resolve('../src/store')];
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.pieces, pieces.length);

    const form = (o) => new URLSearchParams(o).toString();
    const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const m = await (await post('/markup', form({ 'trmnl[user][time_zone_iana]': 'Europe/Vienna' }))).json();
    assertSafe(m, 'default markup');

    assert.equal((await fetch(`${base}/manage`)).status, 400);
    const page = await (await fetch(`${base}/manage?uuid=abc-123`)).text();
    assert.match(page, /name="themes" value="coffee" checked/);
    assert.match(page, /15 minutes/);

    const saved = await (await post('/manage/save', 'uuid=abc-123&themes=coffee&seasonal=off')).text();
    assert.match(saved, /Saved: Coffee &amp; tea/);
    assert.match(saved, /name="themes" value="coffee" checked/);
    assert.doesNotMatch(saved, /value="sea" checked/);
    assert.doesNotMatch(saved, /name="caption" value="on" checked/);

    const mu = await (await post('/markup', form({ 'trmnl[user][uuid]': 'abc-123' }))).json();
    assertSafe(mu, 'user markup');
    assert.match(mu.markup, /Coffee &amp; tea/);
    assert.doesNotMatch(mu.markup.replace(STYLE_RE, ''), /asc-cap/);

    await post('/webhooks/uninstall', form({ 'user[uuid]': 'abc-123' }));
    const after = await (await fetch(`${base}/manage?uuid=abc-123`)).text();
    assert.match(after, /name="caption" value="on" checked/);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true });
  }
});
