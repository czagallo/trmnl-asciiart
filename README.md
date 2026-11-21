# ASCII Art for TRMNL

A new ASCII art piece every 15 minutes, set in a monospace font and scaled to fill the screen. There are three
collections, and any mix of them can be picked:

- **Classic**: 140 hand-drawn pieces by ASCII artists such as Joan G. Stark (jgs), lgbeard, Normand Veilleux and
  Susie Oviatt, from the [ASCII Art Archive](https://www.asciiart.eu). Each one keeps its signature and is credited
  by name in the caption.
- **Gallery**: public-domain artworks redrawn in ASCII characters. They include Hokusai's Great Wave,
  Dürer's Rhinoceros, Haeckel's jellyfish, Van Gogh, Hiroshige and Audubon's birds.
- **Sketches**: hand-drawn pieces made for this plugin, plus generated mountain ridges, night skies, mazes and ripple
  patterns, drawn fresh for each slot.

> **Set the plugin's refresh interval in TRMNL to 15 minutes.** The piece changes every 15 minutes either way, but
> the device only shows the change when it refreshes. A longer interval skips pieces.

- **Gallery pieces** come with their artist and year in the caption. Every source image is public domain or CC0 on
  Wikimedia Commons, and each file in `src/gallery/` links to its source.
- **73 hand-made sketches** across nature, space, animals, city, coffee & tea, retro tech, mountains & Alps, the sea
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

The settings page (`/manage`) has four options. Without saving anything, you get all three collections with
seasonal weighting and the caption shown.

- **Collections**: any mix of *classic*, *gallery* and *sketches*. Nothing ticked means all three.
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

Gallery pieces are stored at several widths (28 to 108 columns). Each layout shows the widest drawing that fits its
box (`src/gallery/layout.json`), with a separate pick for portrait screens. A quadrant therefore gets a coarser
drawing, not a shrunken copy of the full-screen one.

Hand-drawn pieces can't be redrawn smaller. When one would end up with text under 6 px in a layout (a big piece in a
quadrant, say), that layout shows the next piece of the rotation that fits instead, picked separately for landscape
and portrait (`src/fit.js`). Full screens always show the slot's own piece.

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

### The gallery

`scripts/gallery/catalog.json` lists each artwork: id, title, theme, artist, year and its Wikimedia Commons file. It
can also hold conversion options: `crop`, `invert`, `paper`, `gamma`, `ink`, `sharpen`, `equalize` and `cutoff`.
To build:

```bash
uv run scripts/gallery/build.py                  # everything (downloads are cached in scripts/gallery/.cache)
uv run scripts/gallery/build.py great-wave owl   # just these
uv run scripts/gallery/build.py owl --sheet      # plus review sheets in preview/gallery/
```

The build checks each file's licence on Commons and refuses anything that is not public domain or CC0. The conversion
matches glyph shapes rather than mapping brightness. The image is cut into character-sized cells, and each cell gets
the printable ASCII character whose rendered shape is closest. Edges come out as `/ \ | _ ( )`, much as a person would
draw them, and flat areas come out as tone. Only the build needs Python. The server just reads the text files.

### The classic collection

`scripts/classic/fetch.py` gathers candidates from the archive's categories, `scripts/classic/filter.py` drops what
won't work: non-ASCII, mostly lettering, too small, or over 80 × 40. `scripts/classic/picks.json` lists the chosen
pieces per theme, and `scripts/classic/build.py` writes them to `src/classic/<theme>.txt` with a `by:` and a
`source:` line each. `uv run scripts/classic/sheets.py THEME` renders review sheets of the candidates.

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

The code is MIT. The art is not all ours:

- `src/classic/`: every piece belongs to its artist, who is named in its `by:` line. Signatures are kept as drawn.
  These pieces come from the ASCII Art Archive, which asks that names and initials stay on the art. The alt.ascii-art
  FAQ asks for permission before reuse, so if you are an artist and want a piece removed or credited differently,
  open an issue.
- `src/gallery/`: ASCII renderings of public-domain or CC0 images from Wikimedia Commons. Each file links its source.
- `src/art/` and the generators: made for this plugin, MIT like the code.
