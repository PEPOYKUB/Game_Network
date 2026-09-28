"""Convert the designers' high-resolution pixel art into native-resolution game sprites.

The artwork in art/source/ was drawn in Procreate on a small pixel canvas and exported
at 3000x3000 (buttons, characters) or ~2420x1450 (cover background). This script finds
the pixel grid in each export, samples one colour per art-pixel and writes small PNGs
that the browser scales up with `image-rendering: pixelated`.

Usage:  py tools/build_assets.py      (needs Pillow)
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art" / "source"
OUT = ROOT / "public" / "assets"


def color_distance(a, b):
    return sum(abs(int(x) - int(y)) for x, y in zip(a, b))


def transitions(im: Image.Image, axis: int, step: int = 5, threshold: int = 60):
    px = im.load()
    w, h = im.size
    found = []
    outer, inner = (h, w) if axis == 0 else (w, h)
    for o in range(0, outer, step):
        prev = px[0, o] if axis == 0 else px[o, 0]
        for i in range(1, inner):
            cur = px[i, o] if axis == 0 else px[o, i]
            if color_distance(cur, prev) > threshold:
                found.append(i)
            prev = cur
    return found


def fit_grid(positions, lo, hi):
    """Return (block size, offset) whose grid lines best match the colour transitions."""
    best = (-1.0, lo, 0.0)
    for k in range(int(lo * 100), int(hi * 100) + 1):
        b = k / 100
        c = s = 0.0
        for p in positions:
            a = 2 * math.pi * (p % b) / b
            c += math.cos(a)
            s += math.sin(a)
        r = math.hypot(c, s) / max(1, len(positions))
        if r > best[0]:
            phase = (math.atan2(s, c) / (2 * math.pi)) % 1.0
            best = (r, b, phase * b)
    return best[1], best[2]


def sample_grid(im: Image.Image, block_x, off_x, block_y, off_y):
    w, h = im.size
    xs = [off_x + (i + 0.5) * block_x for i in range(-2, int(w / block_x) + 3)]
    ys = [off_y + (j + 0.5) * block_y for j in range(-2, int(h / block_y) + 3)]
    xs = [x for x in xs if 0 <= x < w]
    ys = [y for y in ys if 0 <= y < h]
    out = Image.new(im.mode, (len(xs), len(ys)))
    src, dst = im.load(), out.load()
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            dst[i, j] = src[int(x), int(y)]
    return out


def native(path: Path, lo: float, hi: float, mode="RGBA", grid=None):
    """Downsample one export. Frames exported from the same canvas can reuse `grid`."""
    im = Image.open(path).convert(mode)
    if grid is None:
        probe = im.convert("RGB")
        grid = (*fit_grid(transitions(probe, 0), lo, hi), *fit_grid(transitions(probe, 1), lo, hi))
    bx, ox, by, oy = grid
    return sample_grid(im, bx, ox, by, oy), grid


def clear_white_background(im: Image.Image):
    """Flood-fill near-white pixels connected to the border and make them transparent."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    seen = set()
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        seen.add((x, y))
        r, g, b, a = px[x, y]
        if a == 0 or (r > 225 and g > 225 and b > 225):
            px[x, y] = (0, 0, 0, 0)
            stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    return im


def union_bbox(images):
    boxes = [im.getchannel("A").getbbox() for im in images]
    boxes = [b for b in boxes if b]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def strip(frames):
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * w, 0))
    return sheet


def build_buttons():
    (OUT / "ui").mkdir(parents=True, exist_ok=True)
    meta = {}
    for name in ("start", "settings", "howto"):
        first, grid = native(SRC / "cover" / f"btn-{name}-1.png", 54, 57)
        frames = [first] + [native(SRC / "cover" / f"btn-{name}-{i}.png", 0, 0, grid=grid)[0] for i in (2, 3)]
        # Semi-transparent anti-aliasing specks become fully transparent or fully opaque.
        for f in frames:
            a = f.getchannel("A").point(lambda v: 255 if v > 127 else 0)
            f.putalpha(a)
        box = union_bbox(frames)
        frames = [f.crop(box) for f in frames]
        strip(frames).save(OUT / "ui" / f"btn-{name}.png")
        meta[name] = {"w": frames[0].width, "h": frames[0].height, "frames": 3}
        print("button", name, frames[0].size)
    return meta


def build_background():
    im, block = native(SRC / "cover" / "background.jpg", 5.5, 6.6, mode="RGB")
    im.save(OUT / "ui" / "cover-bg.png", optimize=True)
    print("background", im.size, "block", block)
    return {"w": im.width, "h": im.height}


# Colours of the reference student sprite, grouped into swappable parts.
def classify(rgb):
    r, g, b = rgb
    if g > r + 20 and g > b + 20:
        return "hair"
    if b > r + 30 and b > g + 10 and r < 90:
        return "uniform"
    if r > 200 and g > 170 and b > 120 and r > b + 30:
        return "skin"
    if r > 150 and g > 120 and b < 90:
        return "button"
    return None


VARIANTS = [
    ("ping", "Ping", None, None),
    ("packet", "Packet", (228, 80, 154), (122, 38, 74)),
    ("router", "Router", (143, 94, 60), (38, 128, 118)),
    ("switch", "Switch", (247, 222, 96), (112, 64, 170)),
    ("cache", "Cache", (46, 46, 58), (96, 104, 120)),
    ("byte", "Byte", (98, 176, 240), (170, 70, 60)),
]


def shade(base, reference, target):
    """Map a colour from the reference ramp onto the target colour, keeping its brightness offset."""
    ref_l = sum(reference) / 3
    cur_l = sum(base) / 3
    factor = cur_l / ref_l if ref_l else 1
    return tuple(max(0, min(255, int(c * factor))) for c in target)


def build_characters():
    (OUT / "chars").mkdir(parents=True, exist_ok=True)
    frames, grid = [], None
    for i in (1, 2):
        im, grid = native(SRC / "characters" / f"student-frame-{i}.png", 54, 56.5, grid=grid)
        frames.append(clear_white_background(im))
        print("character frame", i, im.size, "grid", grid)
    box = union_bbox(frames)
    box = (box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1)
    frames = [f.crop(box) for f in frames]

    parts = {}
    for f in frames:
        for (r, g, b, a) in f.get_flattened_data():
            if a:
                kind = classify((r, g, b))
                if kind:
                    parts.setdefault(kind, {}).setdefault((r, g, b), 0)
                    parts[kind][(r, g, b)] += 1
    refs = {k: max(v, key=v.get) for k, v in parts.items()}

    chars = []
    for cid, name, hair, uniform in VARIANTS:
        out_frames = []
        for f in frames:
            g = f.copy()
            px = g.load()
            for y in range(g.height):
                for x in range(g.width):
                    r, gg, b, a = px[x, y]
                    if not a:
                        continue
                    kind = classify((r, gg, b))
                    if kind == "hair" and hair:
                        px[x, y] = shade((r, gg, b), refs["hair"], hair) + (a,)
                    elif kind == "uniform" and uniform:
                        px[x, y] = shade((r, gg, b), refs["uniform"], uniform) + (a,)
            out_frames.append(g)
        strip(out_frames).save(OUT / "chars" / f"{cid}.png")
        chars.append({"id": cid, "name": name, "file": f"/assets/chars/{cid}.png"})
    print("characters", frames[0].size, "palette refs", refs)
    return {"frameW": frames[0].width, "frameH": frames[0].height, "frames": 2, "chars": chars}


def main():
    manifest = {"buttons": build_buttons(), "background": build_background(), "characters": build_characters()}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("wrote", OUT / "manifest.json")


if __name__ == "__main__":
    main()
