import json, re, sys
from pathlib import Path
CACHE = Path(__file__).resolve().parent / ".cache"
c = json.loads((CACHE / "candidates.json").read_text())
keep = []
for p in c:
    lines = p["art"].expandtabs(8).replace("\r", "").split("\n")
    lines = [l.rstrip() for l in lines]
    while lines and not lines[0].strip(): lines.pop(0)
    while lines and not lines[-1].strip(): lines.pop()
    if not lines: continue
    ind = min(len(l) - len(l.lstrip()) for l in lines if l.strip())
    lines = [l[ind:] for l in lines]
    text = "\n".join(lines)
    if re.search(r"[^\x20-\x7e\n]", text): continue
    w, h = max(map(len, lines)), len(lines)
    if not (24 <= w <= 80 and 8 <= h <= 40): continue
    words = re.findall(r"[A-Za-z]{4,}", text)
    if sum(map(len, words)) > 0.12 * sum(len(l.strip()) for l in lines): continue  # mostly lettering
    ink = sum(len(l.replace(" ", "")) for l in lines) / (w * h)
    if ink < 0.08: continue
    keep.append({**p, "lines": lines, "w": w, "h": h, "ink": round(ink, 2)})
(CACHE / "filtered.json").write_text(json.dumps(keep, indent=1))
from collections import Counter
print(len(keep), dict(Counter(p["theme"] for p in keep)))
