"""Writes the classic collection to src/classic/<theme>.txt from the picks.

    python3 scripts/classic/fetch.py && python3 scripts/classic/filter.py   # once, to fill the cache
    python3 scripts/classic/build.py

scripts/classic/picks.json maps each theme to archive piece ids (an id prefix is enough). Every piece keeps its
artist's signature and is credited with the artist's name and the archive page it came from.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "src" / "classic"
NAMES = {  # archive category -> title, when the archive has none
    "landscapes": "Landscape", "waterfall": "Waterfall", "sun": "Sunshine", "clouds": "Clouds", "rainbow": "Rainbow",
    "flowers": "Flowers", "roses": "Rose", "bonsai-trees": "Bonsai", "mushroom": "Mushrooms", "cactus": "Cactus",
    "deserts": "Desert", "mountains": "Mountains", "camping": "Camping", "beach": "Beach", "islands": "Island",
    "boats": "Boat", "fish": "Fish", "dolphins": "Dolphin", "other-water": "Sea Life", "lighthouses": "Lighthouse",
    "anchors": "Anchor", "birds-water": "Water Bird", "planets": "Planet", "moons": "Moon", "spaceships": "Spaceship",
    "stars": "Stars", "telescopes": "Telescope", "astronauts": "Astronaut", "satellites": "Satellite", "other": "Space",
    "planetary-rovers": "Rover", "cats": "Cat", "dogs": "Dog", "birds-land": "Bird", "deer": "Deer", "horses": "Horse",
    "rabbits": "Rabbit", "bears": "Bear", "elephants": "Elephant", "wolves": "Wolf", "insects": "Insect", "frogs": "Frog",
    "other-land": "Animal", "moose": "Moose", "monkeys": "Monkey", "rodents": "Mouse", "bats": "Bat", "cities": "City",
    "bridges": "Bridge", "buildings": "Building", "castles": "Castle", "houses": "House", "monuments": "Monument",
    "windmills": "Windmill", "church": "Church", "trains": "Train", "coffee-and-tea": "Cup of Coffee", "drinks": "Drinks",
    "chocolates": "Chocolate", "computers": "Computer", "apple": "Macintosh", "amiga": "Amiga", "atari": "Atari",
    "floppies": "Floppy Disk", "keyboards": "Keyboard", "joysticks": "Joystick", "game-consoles": "Game Console",
    "robots": "Robot", "televisions": "Television", "phones": "Telephone", "cameras": "Camera", "clocks": "Clock",
    "light-bulbs": "Light Bulb", "audio-equipment": "Stereo", "calculators": "Calculator", "escher": "Impossible Figure",
    "geometries": "Geometry", "fractals": "Fractal", "celtic": "Celtic Knot", "origamis": "Origami", "mazes": "Maze",
    "famous-paintings": "Painting", "trees": "Christmas Tree", "santa-claus": "Santa Claus", "snowmen": "Snowman",
    "snows": "Snow", "easter": "Easter", "daffodils": "Daffodil", "dandelions": "Dandelion", "4th-of-july": "Fireworks",
    "fireworks": "Fireworks", "ice-creams": "Ice Cream", "halloween": "Halloween", "thanksgiving": "Harvest",
    "leaf": "Autumn Leaves", "apples": "Apples",
}


def title_for(p):
    t = (p.get("title") or "").strip()
    if t and len(t) <= 40:
        return t[:1].upper() + t[1:]
    cat = p["category"].split("/")[-1]
    if cat == "other" and "christmas" in p["category"]:
        return "Christmas"
    return NAMES.get(cat, cat.replace("-", " ").title())


def main():
    cands = json.loads((HERE / ".cache" / "filtered.json").read_text())
    picks = json.loads((HERE / "picks.json").read_text())
    files = defaultdict(list)
    seen = set()
    for theme, ids in picks.items():
        for pid in ids:
            hits = [c for c in cands if c["id"].startswith(pid)]
            if not hits:
                raise SystemExit(f"{theme}: no candidate {pid}")
            c = hits[0]
            key = "\n".join(c["lines"])
            if key in seen:
                continue
            seen.add(key)
            artist = c["artist"] if c["artist"] and c["artist"].lower() != "unknown" else "unknown artist"
            files[theme].append([f"=== {title_for(c)} | {theme}", f"by: {artist}", f"source: {c['url']}", *c["lines"], ""])
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*.txt"):
        f.unlink()
    for theme, pieces in files.items():
        (OUT / f"{theme}.txt").write_text("\n".join(l for p in pieces for l in p))
    print({t: len(p) for t, p in files.items()}, sum(len(p) for p in files.values()))


if __name__ == "__main__":
    main()
