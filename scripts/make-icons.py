#!/usr/bin/env python3
"""Generate app icons: the "margin note" mark on the cool off-white page. Run from the repo root:
    python3 scripts/make-icons.py
The mark is the site's pull-quote treatment reduced to a glyph: a pink rule beside three lines of
text in teal-950, the lines getting shorter. Drawn from rectangles, so no font is needed."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PAPER = (245, 248, 247)  # --paper
INK = (4, 47, 46)  # --ink, teal 950
PINK = (219, 39, 119)  # --accent-2, the pull-rule pink
SS = 8  # supersample

# The mark on a 256-unit grid (its own bounding box): (x, y, w, h, colour).
MARK_W, MARK_H = 258, 256
SHAPES = [
    (0, 0, 44, 256, PINK),  # the rule
    (90, 18, 168, 44, INK),  # text lines, longest first
    (90, 106, 140, 44, INK),
    (90, 194, 96, 44, INK),
]


def render(size: int, mark_frac: float) -> Image.Image:
    """Square RGB icon; the mark's height is mark_frac of the canvas, centred."""
    big = size * SS
    img = Image.new("RGB", (big, big), PAPER)
    d = ImageDraw.Draw(img)
    scale = big * mark_frac / MARK_H
    ox = (big - MARK_W * scale) / 2
    oy = (big - MARK_H * scale) / 2
    for x, y, w, h, colour in SHAPES:
        d.rectangle(
            [round(ox + x * scale), round(oy + y * scale), round(ox + (x + w) * scale) - 1, round(oy + (y + h) * scale) - 1],
            fill=colour,
        )
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = ROOT / "public"
    out.mkdir(exist_ok=True)
    render(192, 0.50).save(out / "icon-192.png")
    render(512, 0.50).save(out / "icon-512.png")
    render(512, 0.40).save(out / "icon-maskable-512.png")  # inside the 80% safe zone
    render(180, 0.50).save(out / "apple-touch-icon.png")
    # Next's app/icon.png convention (the favicon). A larger mark so it holds at 16 px.
    render(64, 0.62).save(ROOT / "app/icon.png")


if __name__ == "__main__":
    main()
