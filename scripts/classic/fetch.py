"""Fetches candidate pieces for the classic collection from the ASCII Art Archive (asciiart.eu).

    python3 scripts/classic/fetch.py            # writes scripts/classic/.cache/candidates.json

The pieces belong to their artists. They are used with their signatures (initials) intact and credited by name;
see the README. This script only gathers candidates: the chosen ones are listed in scripts/classic/picks.json
and written to src/classic/ by scripts/classic/build.py.
"""
import html
import json
import re
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
UA = {"User-Agent": "Mozilla/5.0 (trmnl-asciiart classic collection builder)"}
BASE = "https://www.asciiart.eu"

# archive category -> plugin theme
CATEGORIES = {
    "nature/landscapes": "nature", "nature/waterfall": "nature", "nature/sun": "nature", "nature/clouds": "nature",
    "nature/rainbow": "nature", "plants/flowers": "nature", "plants/roses": "nature", "plants/bonsai-trees": "nature",
    "plants/mushroom": "nature", "plants/cactus": "nature", "nature/deserts": "nature",
    "nature/mountains": "mountains", "nature/camping": "mountains",
    "nature/beach": "sea", "nature/islands": "sea", "vehicles/boats": "sea", "animals/fish": "sea",
    "animals/dolphins": "sea", "animals/other-water": "sea", "buildings-and-places/lighthouses": "sea",
    "miscellaneous/anchors": "sea", "animals/birds-water": "sea",
    "space/planets": "space", "space/moons": "space", "space/spaceships": "space", "space/stars": "space",
    "space/telescopes": "space", "space/astronauts": "space", "space/satellites": "space", "space/other": "space",
    "space/planetary-rovers": "space",
    "animals/cats": "animals", "animals/dogs": "animals", "animals/birds-land": "animals", "animals/deer": "animals",
    "animals/horses": "animals", "animals/rabbits": "animals", "animals/bears": "animals", "animals/elephants": "animals",
    "animals/wolves": "animals", "animals/insects": "animals", "animals/frogs": "animals", "animals/other-land": "animals",
    "animals/moose": "animals", "animals/monkeys": "animals", "animals/rodents": "animals", "animals/bats": "animals",
    "buildings-and-places/cities": "city", "buildings-and-places/bridges": "city", "buildings-and-places/buildings": "city",
    "buildings-and-places/castles": "city", "buildings-and-places/houses": "city", "buildings-and-places/monuments": "city",
    "buildings-and-places/windmills": "city", "buildings-and-places/church": "city", "vehicles/trains": "city",
    "food-and-drinks/coffee-and-tea": "coffee", "food-and-drinks/drinks": "coffee", "food-and-drinks/chocolates": "coffee",
    "computers/computers": "tech", "computers/apple": "tech", "computers/amiga": "tech", "computers/atari": "tech",
    "computers/floppies": "tech", "computers/keyboards": "tech", "computers/joysticks": "tech", "computers/game-consoles": "tech",
    "electronics/robots": "tech", "electronics/televisions": "tech", "electronics/phones": "tech", "electronics/cameras": "tech",
    "electronics/clocks": "tech", "electronics/light-bulbs": "tech", "electronics/audio-equipment": "tech",
    "electronics/calculators": "tech",
    "art-and-design/escher": "abstract", "art-and-design/geometries": "abstract", "art-and-design/fractals": "abstract",
    "art-and-design/celtic": "abstract", "art-and-design/origamis": "abstract", "art-and-design/mazes": "abstract",
    "art-and-design/other": "abstract", "art-and-design/famous-paintings": "abstract",
    "holiday-and-events/christmas/trees": "christmas", "holiday-and-events/christmas/santa-claus": "christmas",
    "holiday-and-events/christmas/snowmen": "christmas", "holiday-and-events/christmas/other": "christmas",
    "nature/snows": "winter",
    "holiday-and-events/easter": "spring", "plants/daffodils": "spring", "plants/dandelions": "spring",
    "holiday-and-events/4th-of-july": "summer", "holiday-and-events/fireworks": "summer", "food-and-drinks/ice-creams": "summer",
    "holiday-and-events/halloween": "autumn", "holiday-and-events/thanksgiving": "autumn", "plants/leaf": "autumn",
    "food-and-drinks/apples": "autumn",
}

CARD = re.compile(r'(?s)<div class="card art-card[^"]*"[^>]*data-id="([^"]*)"[^>]*data-title="([^"]*)"[^>]*'
                  r'data-artist="([^"]*)"[^>]*data-height="(\d+)"[^>]*data-width="(\d+)".*?'
                  r'<div class="art-card__ascii"[^>]*>(.*?)</div>')


def get(path):
    req = urllib.request.Request(f"{BASE}/{path}", headers=UA)
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")


def main():
    CACHE.mkdir(exist_ok=True)
    out = []
    for cat, theme in CATEGORIES.items():
        page = CACHE / (cat.replace("/", "__") + ".html")
        if not page.exists():
            page.write_text(get(cat))
            time.sleep(1.5)
        s = page.read_text()
        n = 0
        for m in CARD.finditer(s):
            pid, title, artist, h, w, body = m.groups()
            art = html.unescape(re.sub(r"<br\s*/?>", "\n", re.sub(r"<(?!br)[^>]+>", "", body)))
            out.append({"id": pid, "category": cat, "theme": theme, "title": html.unescape(title), "artist": html.unescape(artist),
                        "w": int(w), "h": int(h), "art": art, "url": f"{BASE}/{cat}"})
            n += 1
        print(f"{cat:45} {theme:10} {n}", flush=True)
    (CACHE / "candidates.json").write_text(json.dumps(out, indent=1))
    print(len(out), "candidates")


if __name__ == "__main__":
    main()
