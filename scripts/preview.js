#!/usr/bin/env node
// Renders every layout on every screen class with TRMNL's real framework CSS and screenshots it with headless Chrome.
//
//   node scripts/preview.js [outDir]              the piece of the current 15-minute slot
//   node scripts/preview.js --slot=N              the piece of slot N (any integer; try a few)
//   node scripts/preview.js --piece=espresso,...  specific pieces by id (gen-ridgeline etc. for generated ones)
//   node scripts/preview.js --set=sizes           smallest, widest, tallest, largest and a generated piece
//   node scripts/preview.js --sheet               one contact sheet with every piece (for reviewing the collection)
//   add --check to also measure every page in Chrome and report clipping, overflow and tiny text (exit 1 on problems)
//   add --tz=Area/City to pick the time zone (seasons), --date=2026-12-10 to pretend another day
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildView, themeLabel } = require('../src/view');
const { renderAll, artSvg, esc } = require('../src/markup');
const { loadCollection } = require('../src/art');
const { GENERATORS, generatePiece } = require('../src/generate');
const { slotOf, SLOT_MS } = require('../src/schedule');

const args = process.argv.slice(2);
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || null;
const flag = (name) => args.includes(`--${name}`);
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'preview'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FRAMEWORK = 'https://trmnl.com';
const TZ = opt('tz') || 'Europe/Vienna';

const SCREENS = [
  { name: 'og-1bit', cls: 'screen--og screen--md screen--1bit', w: 800, h: 480 },
  { name: 'og-2bit', cls: 'screen--ogv2 screen--md screen--2bit', w: 800, h: 480 },
  { name: 'trmnl-x-lg', cls: 'screen--v2 screen--lg screen--4bit', w: 1872, h: 1404 },
];

// Runs in the page: measures every view and leaves the result on <body data-report>. Read with --dump-dom.
const CHECK_SCRIPT = `<script>
window.addEventListener('load', () => setTimeout(() => {
  const out = [];
  document.querySelectorAll('.view').forEach((v, i) => {
    const r = (el) => el.getBoundingClientRect();
    const vr = r(v);
    const svg = [...v.querySelectorAll('.asc-art svg')].find((el) => el.getBoundingClientRect().width > 0);
    const res = { i, problems: [] };
    const inside = (a, b, tol) => a.left >= b.left - tol && a.top >= b.top - tol && a.right <= b.right + tol && a.bottom <= b.bottom + tol;
    if (svg) {
      const box = r(v.querySelector('.asc-art'));
      const vb = svg.viewBox.baseVal;
      const sr = r(svg);
      const scale = Math.min(sr.width / vb.width, sr.height / vb.height);
      res.fontPx = +(scale * 10).toFixed(1);
      res.box = [Math.round(box.width), Math.round(box.height)];
      let u = null;
      svg.querySelectorAll('text').forEach((t) => {
        const b = r(t);
        u = u ? { left: Math.min(u.left, b.left), top: Math.min(u.top, b.top), right: Math.max(u.right, b.right), bottom: Math.max(u.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
      });
      if (u && !inside(u, vr, 0.5)) res.problems.push('art outside the view');
      if (u && !inside(u, box, 3)) res.problems.push('art outside its box');
      if (box.height < 20 || box.width < 20) res.problems.push('art box collapsed');
      res.fill = u ? [+((u.right - u.left) / box.width).toFixed(2), +((u.bottom - u.top) / box.height).toFixed(2)] : null;
    }
    const cap = v.querySelector('.asc-cap');
    if (cap && !inside(r(cap), vr, 0.5)) res.problems.push('caption outside the view');
    const next = v.querySelector('.asc-next');
    if (next && !inside(r(next), vr, 0.5)) res.problems.push('countdown clipped');
    const title = v.querySelector('.asc-title');
    if (title && title.scrollWidth > title.clientWidth + 1) res.problems.push('title truncated');
    const lay = v.querySelector('.layout');
    if (lay && lay.scrollHeight > lay.clientHeight + 1) res.problems.push('layout overflows vertically');
    out.push(res);
  });
  document.body.setAttribute('data-report', JSON.stringify(out));
}, 300));
</script>`;

function page(screen, portrait, body, extra = '') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${FRAMEWORK}/css/latest/plugins.css">
<script src="${FRAMEWORK}/js/latest/plugins.js"></script>
<style>html,body{margin:0;padding:0;background:#fff}</style></head>
<body class="trmnl"><div class="screen ${screen.cls}${portrait ? ' screen--portrait' : ''}">${body}</div>${extra}</body></html>`;
}

// Headless Chrome now and then exits non-zero after doing its job, or hangs: keep its output if there is any, else
// retry once.
function chrome(argv, retry = true) {
  try {
    return execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', ...argv], {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
      timeout: 45000, // a hung headless run is killed and retried
    }).toString();
  } catch (err) {
    const out = err.stdout ? err.stdout.toString() : '';
    if (out.includes('</html>')) return out;
    if (retry) return chrome(argv, false);
    throw err;
  }
}

function viewFor(piece, now) {
  const nextAt = (slotOf(now) + 1) * SLOT_MS;
  return { state: 'ok', piece, theme: themeLabel(piece.theme), msLeft: nextAt - now, nextAt, caption: !flag('no-caption') };
}

function sheet(pieces, perPage = 12) {
  fs.mkdirSync(outDir, { recursive: true });
  for (let page = 0; page * perPage < pieces.length; page++) {
    const chunk = pieces.slice(page * perPage, (page + 1) * perPage);
    const cells = chunk
      .map((p) => `<figure><div class="a">${artSvg(p)}</div><figcaption>${esc(p.title)} · ${p.theme} · ${p.cols}x${p.rows}</figcaption></figure>`)
      .join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:12px;background:#fff;color:#000;font:14px system-ui;display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
figure{margin:0;border:1px solid #000;padding:8px}.a{height:260px}.a svg{display:block;width:100%;height:100%}
figcaption{margin-top:6px;font-weight:600}.a text{font-weight:600}</style></head><body>${cells}</body></html>`;
    const file = path.join(outDir, `sheet-${page + 1}.html`);
    fs.writeFileSync(file, html);
    const rows = Math.ceil(chunk.length / 4);
    chrome([`--window-size=1600,${rows * 312 + 30}`, '--virtual-time-budget=3000', `--screenshot=${file.replace(/html$/, 'png')}`, `file://${file}`]);
  }
  console.log(`contact sheets with ${pieces.length} pieces in ${outDir}/sheet-*.png`);
}

function renderSet(name, v) {
  const m = renderAll(v, { baseUrl: 'http://localhost:3016' });
  const icon = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, '..', 'icon.svg')).toString('base64');
  const fix = (s) => s.replaceAll('http://localhost:3016/icon.svg', icon);
  const LAYOUTS = {
    full: fix(m.markup),
    half_horizontal: `<div class="mashup mashup--1Tx1B">${fix(m.markup_half_horizontal)}${fix(m.markup_half_horizontal)}</div>`,
    half_vertical: `<div class="mashup mashup--1Lx1R">${fix(m.markup_half_vertical)}${fix(m.markup_half_vertical)}</div>`,
    quadrant: `<div class="mashup mashup--2x2">${fix(m.markup_quadrant).repeat(4)}</div>`,
  };
  const problems = [];
  let n = 0;
  for (const s of SCREENS) {
    for (const portrait of [false, true]) {
      for (const [layout, body] of Object.entries(LAYOUTS)) {
        const file = `${name}-${s.name}${portrait ? '-portrait' : ''}-${layout}`;
        const html = path.join(outDir, `${file}.html`);
        fs.writeFileSync(html, page(s, portrait, body, flag('check') ? CHECK_SCRIPT : ''));
        const [w, h] = portrait ? [s.h, s.w] : [s.w, s.h];
        const common = [`--window-size=${w},${h}`, '--virtual-time-budget=6000'];
        chrome([...common, `--screenshot=${path.join(outDir, `${file}.png`)}`, `file://${html}`]);
        if (flag('check')) {
          const dump = () => /data-report="([^"]*)"/.exec(chrome([...common, '--dump-dom', `file://${html}`]));
          const mm = dump() || dump(); // a rare headless run ends before the page script; one retry settles it
          const report = mm ? JSON.parse(mm[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')) : null;
          if (!report) problems.push(`${file}: no report`);
          else {
            const first = report[0] || {};
            const bad = report.flatMap((r) => r.problems);
            const tiny = first.fontPx !== undefined && first.fontPx < (s.name === 'trmnl-x-lg' ? 9 : 6);
            console.log(`  ${file.padEnd(52)} font ${String(first.fontPx).padStart(5)}px  box ${first.box}  fill ${first.fill}${bad.length ? '  ' + bad.join(', ') : ''}${tiny ? '  TINY' : ''}`);
            if (bad.length) problems.push(`${file}: ${[...new Set(bad)].join(', ')}`);
            if (tiny) problems.push(`${file}: text only ${first.fontPx}px`);
          }
        }
        n++;
      }
    }
  }
  return { n, problems };
}

function main() {
  const now = opt('date') ? new Date(`${opt('date')}T12:07:00Z`).getTime() : Date.now();
  const all = loadCollection();
  const generated = (id, seed) => generatePiece(GENERATORS.find((g) => g.id === id), seed);

  if (flag('sheet')) {
    const seeds = [1, 2, 3];
    return sheet([...all, ...GENERATORS.flatMap((g) => seeds.map((s) => generatePiece(g, slotOf(now) + s)))]);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const sets = [];
  if (opt('piece')) {
    for (const id of opt('piece').split(',')) {
      const p = all.find((x) => x.id === id) || (GENERATORS.find((g) => g.id === id) && generated(id, slotOf(now)));
      if (!p) throw new Error(`unknown piece ${id}`);
      sets.push([id, viewFor(p, now)]);
    }
  } else if (opt('set') === 'sizes') {
    const by = (f) => all.slice().sort((a, b) => f(a) - f(b))[0];
    const picks = {
      smallest: by((p) => p.cols * p.rows),
      widest: by((p) => -p.cols),
      tallest: by((p) => -p.rows / p.cols),
      largest: by((p) => -p.cols * p.rows),
    };
    for (const [k, p] of Object.entries(picks)) sets.push([`${k}-${p.id}`, viewFor(p, now)]);
    sets.push(['generated-gen-interference', viewFor(generated('gen-interference', slotOf(now)), now)]);
    sets.push(['generated-gen-ridgeline', viewFor(generated('gen-ridgeline', slotOf(now)), now)]);
  } else {
    const slot = opt('slot') !== null ? Number(opt('slot')) : slotOf(now);
    const at = opt('slot') !== null ? slot * SLOT_MS + 7 * 60e3 : now;
    const v = buildView(null, { now: at, timeZone: TZ });
    console.log(`slot ${slot}: ${v.piece ? `${v.piece.title} (${v.piece.id}, ${v.piece.cols}x${v.piece.rows})` : v.error}`);
    sets.push([`slot-${slot}`, v]);
  }

  let total = 0;
  const problems = [];
  for (const [name, v] of sets) {
    if (v.piece) console.log(`${name}: ${v.piece.title} ${v.piece.cols}x${v.piece.rows}`);
    const r = renderSet(name, v);
    total += r.n;
    problems.push(...r.problems);
  }
  console.log(`${total} screenshots in ${outDir}`);
  if (flag('check')) {
    if (problems.length) {
      console.log(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
      process.exitCode = 1;
    } else console.log('check: no clipping, overflow or tiny text');
  }
}

main();
