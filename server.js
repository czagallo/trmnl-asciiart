require('dotenv').config();
const path = require('path');
const express = require('express');
const { buildView } = require('./src/view');
const { renderAll, esc } = require('./src/markup');
const { createStore } = require('./src/store');
const { loadCollection, THEMES } = require('./src/art');
const { loadGallery } = require('./src/gallery');
const { loadClassic } = require('./src/classic');
const { normalizeSettings, FILTER_KEYS, DEFAULTS, COLLECTIONS } = require('./src/schedule');

const PORT = Number(process.env.PORT) || 3016;
const CLIENT_ID = process.env.TRMNL_CLIENT_ID;
const CLIENT_SECRET = process.env.TRMNL_CLIENT_SECRET;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TRMNL_OAUTH_URL = 'https://usetrmnl.com/oauth/token';

// The art is local, so there is no upstream to wait for: load (and validate) the collection once at start-up.
const collection = loadCollection();
const gallery = loadGallery();
const classic = loadClassic();

const store = createStore();
const app = express();
app.disable('x-powered-by');
// TRMNL posts the markup request form-encoded with nested keys (trmnl[user][...]); JSON is for local testing.
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

const UUID_RE = /^[A-Za-z0-9-]{1,64}$/;

app.get('/icon.svg', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'icon.svg'));
});

// /icon.png: white symbol on a black tile, readable in light and dark UIs (/icon.svg is the same).
// /icon-light.svg|png (black) and /icon-dark.svg|png (white) are transparent single-colour variants.
app.get(/^\/icon(-light|-dark)?\.(svg|png)$/, (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'icons', `icon${req.params[0] || ''}.${req.params[1]}`));
});

// ---------------------------------------------------------------------------
// Installation (OAuth)
// ---------------------------------------------------------------------------

app.get('/install', async (req, res) => {
  const { code, installation_callback_url: callback } = req.query;
  if (!code || !callback) return res.status(400).json({ error: 'Missing code or installation_callback_url' });
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).json({ error: 'Plugin credentials not configured' });

  try {
    const r = await fetch(TRMNL_OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.access_token) throw new Error(`token exchange failed (HTTP ${r.status})`);
    console.log('Install: token exchange ok');
    res.redirect(302, callback);
  } catch (err) {
    console.error('Install failed:', err.message);
    res.status(500).json({ error: 'Installation failed' });
  }
});

app.post('/webhooks/install-success', (req, res) => {
  const user = req.body?.user;
  if (!user?.uuid || !UUID_RE.test(user.uuid)) return res.status(400).json({ error: 'No user data' });
  store.update(user.uuid, { plugin_setting_id: user.plugin_setting_id ?? null });
  console.log('Install success');
  res.json({ success: true });
});

app.post('/webhooks/uninstall', (req, res) => {
  const uuid = req.body?.user?.uuid || req.body?.uuid;
  if (uuid) store.delete(uuid);
  console.log(uuid ? 'Uninstall' : 'Uninstall without a user');
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

const FILTER_LABELS = { ...THEMES, seasonal: 'Seasonal sets (winter, Christmas & Advent, spring, summer, autumn)' };

// Pieces per theme filter, as "classic / gallery / sketches".
function counts() {
  const c = {};
  [classic, gallery, collection].forEach((list, i) => {
    for (const p of list) {
      const k = THEMES[p.theme] ? p.theme : 'seasonal';
      c[k] = c[k] || [0, 0, 0];
      c[k][i] += 1;
    }
  });
  return c;
}

const COLLECTION_LABELS = {
  classic: () => `Classic: ${classic.length} hand-drawn pieces by ASCII artists (Joan G. Stark and many more), credited by name`,
  gallery: () => `Gallery: ${gallery.length} public-domain artworks (Hokusai, Dürer, Haeckel, Van Gogh, NASA ...) redrawn in ASCII`,
  sketches: () => `Sketches: ${collection.length} pieces drawn for this plugin, plus generated ridges, night skies, mazes and ripples`,
};

function managePage(uuid, conn, notice) {
  const s = normalizeSettings(conn);
  const n = counts();
  const back = conn?.plugin_setting_id
    ? `https://usetrmnl.com/plugin_settings/${encodeURIComponent(conn.plugin_setting_id)}/edit?force_refresh=true`
    : 'https://usetrmnl.com';
  const checked = (k) => (!s.themes || s.themes.includes(k) ? ' checked' : '');
  const themeBoxes = FILTER_KEYS.map((k) => {
    const [c, g, sk] = n[k] || [0, 0, 0];
    return `<label class="check"><input type="checkbox" name="themes" value="${k}"${checked(k)}> ${esc(FILTER_LABELS[k])} <small class="n">${c} / ${g} / ${sk}</small></label>`;
  }).join('\n');
  const collectionBoxes = COLLECTIONS.map(
    (c) => `<label class="check"><input type="checkbox" name="collections" value="${c}"${!s.collections || s.collections.includes(c) ? ' checked' : ''}> ${esc(COLLECTION_LABELS[c]())}</label>`,
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ASCII Art</title>
<style>
body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 16px;line-height:1.5;color:#1a1a1a}
h2{font-size:1.05rem;margin:26px 0 6px}
label.check{display:block;margin:4px 0;font-weight:400}
small{color:#555}
small.n{color:#777;margin-left:4px}
fieldset{border:0;padding:0;margin:0}
button,.btn{display:inline-block;margin-top:24px;margin-right:8px;padding:10px 18px;font:inherit;border-radius:6px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;text-decoration:none;cursor:pointer}
.btn{background:#fff;color:#1a1a1a}
.notice{padding:10px 14px;border-radius:6px;margin:16px 0;background:#eef6ee;border:1px solid #9c9}
.notice.err{background:#fbeeee;border-color:#d99}
pre{font-size:12px;line-height:1.15;background:#f6f6f6;padding:10px;border-radius:6px;overflow:auto}
</style></head>
<body>
<h1>ASCII Art</h1>
<p>A new ASCII art piece every 15 minutes. Set this plugin's refresh interval in TRMNL to <b>15 minutes</b> to see
every one.</p>
${notice ? `<div class="notice${notice.ok ? '' : ' err'}">${esc(notice.text)}</div>` : ''}
<form method="POST" action="/manage/save">
<input type="hidden" name="uuid" value="${esc(uuid)}">

<h2>Collections</h2>
${collectionBoxes}
<small>Nothing ticked means all three.</small>

<h2>Themes</h2>
<fieldset>
${themeBoxes}
</fieldset>
<small>Nothing ticked means everything. The numbers are classic / gallery / sketches pieces.</small>

<h2>Seasons</h2>
<label class="check"><input type="radio" name="seasonal" value="on"${s.seasonal ? ' checked' : ''}> In season: seasonal pieces come up twice as often during their season (Christmas &amp; Advent in December) and take a break outside it</label>
<label class="check"><input type="radio" name="seasonal" value="off"${s.seasonal ? '' : ' checked'}> All year: seasonal pieces show as often as any other, whatever the date</label>
<small>Seasons follow your TRMNL time zone, flipped for the southern hemisphere.</small>

<h2>Caption</h2>
<label class="check"><input type="checkbox" name="caption" value="on"${s.caption ? ' checked' : ''}> Show the title (and the artist) and the time until the next piece below the art</label>

<button type="submit">Save</button>
<a class="btn" href="${esc(back)}">Back to TRMNL</a>
</form>
</body></html>`;
}

app.get('/manage', (req, res) => {
  const uuid = String(req.query.uuid || '');
  if (!UUID_RE.test(uuid)) return res.status(400).send('Missing or invalid uuid');
  res.type('html').send(managePage(uuid, store.get(uuid)));
});

app.post('/manage/save', (req, res) => {
  const uuid = String(req.body.uuid || '');
  if (!UUID_RE.test(uuid)) return res.status(400).send('Missing or invalid uuid');
  const list = (raw) => (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String);
  const picked = list(req.body.themes);
  const s = normalizeSettings({
    themes: picked,
    seasonal: req.body.seasonal !== 'off',
    caption: req.body.caption === 'on',
    collections: list(req.body.collections),
  });
  const next = store.update(uuid, { themes: s.themes, seasonal: s.seasonal, caption: s.caption, collections: s.collections, collection: undefined });
  const v = buildView(next);
  const what = s.themes ? s.themes.map((k) => FILTER_LABELS[k].replace(/ \(.*/, '')).join(', ') : 'all themes';
  const notice = v.state === 'ok'
    ? { ok: true, text: `Saved: ${what}. ${v.fallback ? 'None of those are in season right now, so the year-round collection shows until they are.' : `${v.playlistSize} pieces in rotation; right now: “${v.piece.title}”.`}` }
    : { ok: false, text: 'Saved, but no piece matches these settings.' };
  res.type('html').send(managePage(uuid, next, notice));
});

// ---------------------------------------------------------------------------
// Screen generation
// ---------------------------------------------------------------------------

// TRMNL sends trmnl[...] form fields, but some clients (trmnl-plugin-preview, at times TRMNL itself) send the whole
// trmnl object as one JSON string. Accept both.
function trmnlField(body) {
  const t = body?.trmnl;
  if (typeof t === 'string') {
    try {
      const parsed = JSON.parse(t);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return t && typeof t === 'object' ? t : {};
}

app.post('/markup', (req, res) => {
  const trmnl = trmnlField(req.body);
  const uuid = req.body?.user_uuid || trmnl.user?.uuid;
  const ctx = { baseUrl: BASE_URL, instance: trmnl.plugin_settings?.instance_name };
  try {
    const cfg = uuid && UUID_RE.test(String(uuid)) ? store.get(String(uuid)) : null;
    const v = buildView(cfg || DEFAULTS, { timeZone: trmnl.user?.time_zone_iana });
    res.json(renderAll(v, ctx));
  } catch (err) {
    console.error('Markup failed:', err);
    res.json(renderAll(null, ctx));
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', classic: classic.length, gallery: gallery.length, sketches: collection.length, users: store.size() });
});

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => console.log(`TRMNL ASCII Art plugin on http://127.0.0.1:${PORT} (${classic.length} classic, ${gallery.length} gallery, ${collection.length} sketches)`));
}

module.exports = app;
