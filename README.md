# ASCII Art for TRMNL

A new ASCII art piece every 15 minutes, set in a monospace font and scaled to fill the screen. Every piece is
hand-made for this plugin. There are also generated mountain ridges, night skies, mazes and ripple patterns, drawn
fresh for each slot.

> **Set the plugin's refresh interval in TRMNL to 15 minutes.** The piece changes every 15 minutes either way, but
> the device only shows the change when it refreshes. A longer interval skips pieces.

- **73 hand-made pieces** across nature, space, animals, city, coffee & tea, retro tech, mountains & Alps, the sea
  and patterns, plus seasonal sets: winter, Christmas & Advent, spring, summer and autumn
- **4 generators**: ridgeline, night sky, maze and interference ripples. They are seeded by the 15-minute slot, so
  each slot draws a new picture. The picture is drawn on a canvas shaped like the layout it lands in.
- **Deterministic rotation**: every request in the same 15-minute slot shows the same piece. The collection is
  shuffled once per cycle and shown in full before anything repeats, and the same piece never comes twice in a row,
  also across cycles.
- **Seasons**: in-season pieces come up twice per cycle and out-of-season pieces rest. Christmas & Advent pieces show
  in December. The other seasons follow the meteorological calendar in your TRMNL time zone, flipped for the
  southern hemisphere.
- Every layout (full, half horizontal, half vertical, quadrant) on every screen (TRMNL OG 1-/2-bit, TRMNL X,
  portrait), in pure black and white. A caption shows the title and "next in Xm".

## Settings

The settings page (`/manage`) has three options. Without saving anything, you get everything with seasonal weighting
and the caption shown.

- **Themes**: any mix of the nine themes and "Seasonal sets". Nothing ticked means everything.
- **Seasons**: *in season* (default) or *all year* (seasonal pieces as often as any other, whatever the date)
- **Caption**: show or hide the title and countdown below the art

## How it renders

Each piece becomes an SVG whose `viewBox` is the piece's character grid: `cols × 6` by `rows × 12` units, with a
10-unit monospace font. The browser scales it to the box the layout leaves, so a 14-column espresso cup and a
64-column ridgeline both fill the space without wrapping or clipping. Every run of characters is placed at its exact
column and stretched to its exact width (`textLength`). Whitespace is therefore preserved exactly, and columns line
up even if the renderer falls back to a font with other proportions. Small pieces get a minimum grid so they are not
blown up to poster size. All text is HTML-escaped, including `{` and `}`, so no piece can produce Liquid tags.

There is no upstream service: the art ships with the plugin, so `/markup` answers in milliseconds and cannot be
held up by a slow API.

## Adding art

Pieces live in `src/art/*.txt`:

```
=== Title | theme
  your art here, backslashes and all \o/
```

Themes: `nature space animals city coffee tech mountains sea abstract` and the seasonal `winter christmas spring summer
autumn`. Use printable ASCII only, with no tabs and no trailing whitespace. Pieces may be up to 80 × 40 characters.
`npm test` checks all of this. `npm run preview -- --sheet` renders every piece onto contact sheets for review.

## Development

```bash
npm install
cp .env.example .env
npm run dev                                   # http://127.0.0.1:3016
npm test

npm run preview                               # this slot's piece, every layout on every screen, in ./preview (needs Chrome)
npm run preview -- --slot=1234                # the piece of another 15-minute slot
npm run preview -- --piece=espresso,gen-maze  # specific pieces by id
npm run preview -- --set=sizes --check        # smallest, widest, tallest, largest and generated; reports clipping and tiny text
npm run preview -- --sheet                    # contact sheets of the whole collection

curl -X POST http://127.0.0.1:3016/markup --data-urlencode 'trmnl[user][time_zone_iana]=Europe/Vienna'
```

Code: `src/art/` (the collection and its loader), `src/generate.js` (generated pieces), `src/schedule.js` (slots,
seasons, rotation), `src/view.js` (what the screen shows), `src/markup.js` (layouts), `src/store.js` (user settings).

## Deployment

Pushes to `main` are tested and deployed by GitHub Actions (`.github/workflows/deploy.yml`), which runs
`deployment/deploy.sh` on the server. The server connection comes from repository secrets. The service writes user
settings to `data/`, which the deploy script creates.

## License

MIT
