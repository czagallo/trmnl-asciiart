# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10", "numpy>=1.26"]
# ///
"""Builds the gallery: public-domain artworks from Wikimedia Commons, converted to ASCII art.

    uv run scripts/gallery/build.py                 # every piece in catalog.json
    uv run scripts/gallery/build.py great-wave owl  # only these
    uv run scripts/gallery/build.py --missing       # only pieces that have no file yet
    uv run scripts/gallery/build.py --sheet         # also write review sheets to preview/gallery/

Every image's licence is checked against Commons when it is downloaded: only "Public domain" and CC0 pass.
Downloads are cached in scripts/gallery/.cache (gitignored), the results go to src/gallery/<id>.txt.

Conversion is glyph matching, not a brightness ramp: the image is cut into cells shaped like a character cell, and
each cell gets the printable ASCII character whose rendered shape is closest to it (least squared difference after a
slight blur). Edges therefore come out as / \\ | _ ( ) and friends, the way a person would draw them, and flat areas
as tone. Each piece is converted at every width of the WIDTHS ladder that a layout can use (src/gallery/index.js
picks the largest one that fits), so small layouts get a coarser drawing instead of a shrunken big one.
"""

import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
OUT = ROOT / "src" / "gallery"
CATALOG = HERE / "catalog.json"
LAYOUT = json.loads((OUT / "layout.json").read_text())
WIDTHS = LAYOUT["widths"]

UA = {"User-Agent": "trmnl-asciiart-build/1.0 (gallery builder)"}
API = "https://commons.wikimedia.org/w/api.php"
OK_LICENSES = ("Public domain", "CC0", "PD")

CW, CH = 10, 20  # matching resolution of one character cell (the 1:2 cell of the SVG renderer)
FONT_FILES = ["/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
CHARS = [chr(c) for c in range(32, 127)]


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def http(url, tries=8):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == tries - 1:
                raise
            wait = min(int(e.headers.get("Retry-After") or 0) or 20 * (i + 1), 90)
            print(f"  rate limited, waiting {wait}s", flush=True)
            time.sleep(wait)


def fetch(entry):
    """Image + licence info for a catalog entry, cached."""
    key = re.sub(r"[^A-Za-z0-9._-]+", "_", entry["file"])[:150]
    meta_path, img_path = CACHE / f"{key}.json", CACHE / f"{key}.img"
    if meta_path.exists() and img_path.exists():
        return Image.open(img_path), json.loads(meta_path.read_text())
    q = urllib.parse.urlencode({
        "action": "query", "titles": entry["file"], "prop": "imageinfo", "format": "json",
        "iiprop": "url|extmetadata", "iiurlwidth": 1280, "iiextmetadatafilter": "LicenseShortName",
    })
    page = next(iter(json.loads(http(f"{API}?{q}"))["query"]["pages"].values()))
    if "imageinfo" not in page:
        raise SystemExit(f"{entry['id']}: {entry['file']} not found on Commons")
    ii = page["imageinfo"][0]
    lic = ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value", "")
    if not lic.startswith(OK_LICENSES):
        raise SystemExit(f"{entry['id']}: licence is {lic!r}, not public domain / CC0")
    meta = {"license": lic, "page": ii["descriptionurl"]}
    data = http(ii.get("thumburl") or ii["url"])
    CACHE.mkdir(exist_ok=True)
    img_path.write_bytes(data)
    meta_path.write_text(json.dumps(meta))
    time.sleep(10)
    return Image.open(io.BytesIO(data)), meta


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------

def glyph_masks():
    font_file = next(f for f in FONT_FILES if Path(f).exists())
    font = ImageFont.truetype(font_file, 17)
    masks = []
    for ch in CHARS:
        im = Image.new("L", (CW, CH), 0)
        ImageDraw.Draw(im).text((0, 0), ch, fill=255, font=font)
        masks.append(np.asarray(im.filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float32) / 255)
    return np.stack(masks).reshape(len(CHARS), -1)


GLYPHS = None


def prepare(img, opt):
    """Grayscale "ink" image in 0..1 (1 = black), cropped and levelled per the catalog options."""
    im = ImageOps.exif_transpose(img).convert("L")
    if "crop" in opt:  # fractions: left, top, right, bottom
        l, t, r, b = opt["crop"]
        im = im.crop((round(l * im.width), round(t * im.height), round(r * im.width), round(b * im.height)))
    if opt.get("invert"):
        im = ImageOps.invert(im)
    im = ImageOps.autocontrast(im, cutoff=opt.get("cutoff", 1))
    if opt.get("equalize"):
        im = Image.blend(im, ImageOps.equalize(im), opt["equalize"])
    return im


def convert(im, cols, opt):
    global GLYPHS
    if GLYPHS is None:
        GLYPHS = glyph_masks()
    rows = max(1, round(cols * im.height / im.width * CW / CH))
    big = im.resize((cols * CW, rows * CH), Image.LANCZOS)
    if opt.get("sharpen", 1):
        big = big.filter(ImageFilter.UnsharpMask(2, int(120 * opt.get("sharpen", 1)), 2))
    ink = 1 - np.asarray(big.filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float32) / 255
    # Paper is blank: ink below the threshold (scan texture, faint washes) is dropped, the rest stretched back to 0..1.
    t = opt.get("paper", 0.12)
    ink = np.clip((ink - t) / (1 - t), 0, 1) ** opt.get("gamma", 1.0) * opt.get("ink", 1.0)
    patches = ink.reshape(rows, CH, cols, CW).transpose(0, 2, 1, 3).reshape(rows * cols, -1)
    dist = (GLYPHS ** 2).sum(1)[None, :] - 2 * patches @ GLYPHS.T
    idx = dist.argmin(1).reshape(rows, cols)
    return [("".join(CHARS[i] for i in row)).rstrip() for row in idx], rows


def widths_for(aspect):
    """Ladder widths any layout can pick for an image of this aspect (height / width in pixels)."""
    need = 0
    for box in LAYOUT["boxes"].values():
        for b in box.values():
            need = max(need, min(b["cols"], int(b["rows"] * 2 / aspect)))
    return [w for w in WIDTHS if w <= max(need, WIDTHS[0])]


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def build(entry):
    img, meta = fetch(entry)
    opt = entry.get("options", {})
    im = prepare(img, opt)
    aspect = im.height / im.width
    out = [
        f"=== {entry['title']} | {entry['theme']}",
        f"by: {entry['artist']}" + (f", {entry['year']}" if entry.get("year") else ""),
        f"source: {meta['page']}",
        f"license: {meta['license']}",
    ]
    for w in widths_for(aspect):
        lines, rows = convert(im, w, opt)
        out.append(f"--- {w}x{rows}")
        out.extend(lines)
    (OUT / f"{entry['id']}.txt").write_text("\n".join(out) + "\n")
    return out


def sheet(ids):
    """Review sheets: the largest variant of each piece, rendered with the matching font."""
    font_file = next(f for f in FONT_FILES if Path(f).exists())
    font = ImageFont.truetype(font_file, 10)
    tiles = []
    for pid in ids:
        text = (OUT / f"{pid}.txt").read_text().split("\n")
        starts = [i for i, l in enumerate(text) if l.startswith("--- ")]
        w, h = map(int, text[starts[-1]][4:].split("x"))
        lines = text[starts[-1] + 1: starts[-1] + 1 + h]
        tile = Image.new("L", (w * 6 + 8, h * 12 + 24), 255)
        d = ImageDraw.Draw(tile)
        d.text((4, 2), f"{pid}  ({text[0][4:]})", fill=0, font=font)
        for i, line in enumerate(lines):
            d.text((4, 20 + i * 12), line, fill=0, font=font)
        tiles.append(tile)
    dest = ROOT / "preview" / "gallery"
    dest.mkdir(parents=True, exist_ok=True)
    for n in range(0, len(tiles), 4):
        group = tiles[n:n + 4]
        W = max(t.width for t in group) * 2 + 10
        rows = [group[i:i + 2] for i in range(0, len(group), 2)]
        H = sum(max(t.height for t in r) for r in rows) + 10 * len(rows)
        page = Image.new("L", (W, H), 200)
        y = 0
        for r in rows:
            x = 0
            for t in r:
                page.paste(t, (x, y))
                x += t.width + 10
            y += max(t.height for t in r) + 10
        page.save(dest / f"sheet-{n // 4 + 1:02d}.png")
    print(f"sheets in {dest}")


def main(argv):
    catalog = json.loads(CATALOG.read_text())
    want = [a for a in argv if not a.startswith("--")]
    entries = [e for e in catalog if not want or e["id"] in want]
    if "--missing" in argv:
        entries = [e for e in entries if not (OUT / f"{e['id']}.txt").exists()]
    if want and len(entries) != len(want):
        raise SystemExit(f"unknown ids: {sorted(set(want) - {e['id'] for e in entries})}")
    OUT.mkdir(parents=True, exist_ok=True)
    for e in entries:
        out = build(e)
        print(f"{e['id']:22} {[l[4:] for l in out if l.startswith('--- ')]}", flush=True)
    if not want and "--missing" not in argv:  # drop pieces that left the catalog
        keep = {f"{e['id']}.txt" for e in catalog}
        for f in OUT.glob("*.txt"):
            if f.name not in keep:
                f.unlink()
    if "--sheet" in argv:
        sheet([e["id"] for e in entries])


if __name__ == "__main__":
    main(sys.argv[1:])
