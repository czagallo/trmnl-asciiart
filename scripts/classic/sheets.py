# /// script
# dependencies = ["pillow"]
# ///
"""Review sheets of the filtered candidates, per theme: python sheets.py THEME [start] [count]"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
HERE = Path(__file__).resolve().parent
c = json.loads((HERE / ".cache" / "filtered.json").read_text())
theme = sys.argv[1]; start = int(sys.argv[2]) if len(sys.argv) > 2 else 0; count = int(sys.argv[3]) if len(sys.argv) > 3 else 24
items = [p for p in c if p["theme"] == theme]
items.sort(key=lambda p: -(min(p["w"], 70) * min(p["h"], 30)) * min(p["ink"], 0.4))
items = items[start:start + count]
font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 7)
lab = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 10)
TW, TH = 400, 260
cols = 4
page = Image.new("L", (cols * TW, ((len(items) + cols - 1) // cols) * TH), 255)
d = ImageDraw.Draw(page)
for i, p in enumerate(items):
    x0, y0 = (i % cols) * TW, (i // cols) * TH
    d.rectangle([x0, y0, x0 + TW - 1, y0 + TH - 1], outline=160)
    d.text((x0 + 3, y0 + 2), f"{p['id'][:8]} {p['artist'][:14]} {p['w']}x{p['h']}", fill=0, font=lab)
    s = min((TW - 8) / (p["w"] * 4.2), (TH - 20) / (p["h"] * 8))
    f = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", max(4, int(7 * s)))
    for n, l in enumerate(p["lines"]):
        d.text((x0 + 4, y0 + 16 + n * max(4, int(7 * s)) * 1.15), l, fill=0, font=f)
out = HERE / ".cache" / f"sheet-{theme}-{start}.png"
page.save(out)
print(out)
