#!/usr/bin/env python3
"""Generate app icons: a vermilion pilcrow on warm paper. Run from the repo root:
    python3 scripts/make-icons.py
Uses the Instrument Serif .woff from node_modules (FreeType reads WOFF)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "node_modules/@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-700-normal.woff"
PAPER = (245, 248, 247)
VERMILION = (219, 39, 119)  # pink mark (name kept from the first palette)
SS = 4  # supersample


def render(size: int, glyph_frac: float) -> Image.Image:
    """Square RGB icon; the pilcrow's ink box is glyph_frac of the canvas height, centred."""
    big = size * SS
    img = Image.new("RGB", (big, big), PAPER)
    d = ImageDraw.Draw(img)
    probe = ImageFont.truetype(str(FONT), 1000)
    l, t, r, b = probe.getbbox("¶")
    scale = (big * glyph_frac) / (b - t)
    font = ImageFont.truetype(str(FONT), max(1, round(1000 * scale)))
    l, t, r, b = font.getbbox("¶")
    x = (big - (r - l)) / 2 - l
    y = (big - (b - t)) / 2 - t
    d.text((x, y), "¶", font=font, fill=VERMILION, stroke_width=0)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = ROOT / "public"
    out.mkdir(exist_ok=True)
    render(192, 0.62).save(out / "icon-192.png")
    render(512, 0.62).save(out / "icon-512.png")
    render(512, 0.40).save(out / "icon-maskable-512.png")  # inside the 80% safe zone
    render(180, 0.60).save(out / "apple-touch-icon.png")
    # Next's app/icon.png convention (an .ico must be RGBA; a PNG is simpler)
    render(64, 0.66).save(ROOT / "app/icon.png")


if __name__ == "__main__":
    main()
