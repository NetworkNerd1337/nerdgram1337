#!/usr/bin/env python3
"""Build docs/images/social-preview.png from the NerdGram mascot.

Dev tool only. It is not part of the npm package or the Docker image.
Requires Pillow. Uses Inter when that font is installed, then Liberation Sans,
then DejaVu Sans.

The words below are the card. Do not rephrase them.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
MASCOT = ROOT / "client" / "public" / "branding" / "networknerd1337.jpg"
OUT = ROOT / "docs" / "images" / "social-preview.png"

WIDTH = 1280
HEIGHT = 640
NAVY_TOP = (7, 17, 32)
NAVY_BOTTOM = (16, 42, 68)
TEAL = (45, 212, 191)
YELLOW = (253, 224, 71)
WHITE = (255, 255, 255)
GRAY = (203, 213, 225)
URL_GRAY = (148, 163, 184)

WORD_NERD = "Nerd"
WORD_GRAM = "Gram"
TAGLINE_WHITE = "If it isn't diagrammed,"
TAGLINE_YELLOW = "it's just a rumor."
SUBLINE = "Code-first network diagrams in Mermaid. Local, versioned, and fed by your real data."
PILLS = ("Local-first", "NetBox · LibreNMS · pyATS", "Docker · npm")
REPO_URL = "github.com/NetworkNerd1337/NerdGram1337"

FONT_CANDIDATES = {
    "bold": [
        "/usr/share/fonts/truetype/macos/Inter-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "semibold": [
        "/usr/share/fonts/truetype/macos/Inter-SemiBold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "medium": [
        "/usr/share/fonts/truetype/macos/Inter-Medium.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    "regular": [
        "/usr/share/fonts/truetype/macos/Inter-Regular.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
}


def load_font(weight: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES[weight]:
        if os.path.isfile(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def background() -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT))
    pixels = image.load()
    for y in range(HEIGHT):
        t = y / (HEIGHT - 1)
        color = tuple(lerp(NAVY_TOP[i], NAVY_BOTTOM[i], t) for i in range(3))
        for x in range(WIDTH):
            pixels[x, y] = color
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    dots = ImageDraw.Draw(overlay)
    for y in range(22, HEIGHT, 28):
        for x in range(22, WIDTH, 28):
            dots.ellipse((x, y, x + 2, y + 2), fill=(255, 255, 255, 28))
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def rounded_mascot() -> Image.Image:
    source = Image.open(MASCOT).convert("RGBA")
    side = 560
    scale = max(side / source.width, side / source.height)
    resized = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - side) // 2
    top = (resized.height - side) // 2
    cropped = resized.crop((left, top, left + side, top + side))
    mask = Image.new("L", (side, side), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, side - 1, side - 1), radius=48, fill=255)
    cropped.putalpha(mask)
    return cropped


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def draw_pill(base: Image.Image, origin: tuple[int, int], label: str, font: ImageFont.ImageFont) -> int:
    draw = ImageDraw.Draw(base)
    pad_x = 16
    pad_y = 8
    width = text_width(draw, label, font) + pad_x * 2
    height = 36
    x, y = origin
    draw.rounded_rectangle((x, y, x + width, y + height), radius=18, outline=TEAL, width=2)
    draw.text((x + pad_x, y + pad_y - 2), label, font=font, fill=TEAL)
    return width


def main() -> None:
    image = background()
    draw = ImageDraw.Draw(image)

    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((700, 20, 1260, 620), fill=(45, 212, 191, 70))
    image = Image.alpha_composite(image, glow.filter(ImageFilter.GaussianBlur(28)))

    mascot = rounded_mascot()
    image.paste(mascot, (680, 40), mascot)

    draw = ImageDraw.Draw(image)
    word = load_font("bold", 84)
    nerd_w = text_width(draw, WORD_NERD, word)
    draw.text((64, 92), WORD_NERD, font=word, fill=WHITE)
    draw.text((64 + nerd_w, 92), WORD_GRAM, font=word, fill=TEAL)

    tag = load_font("semibold", 34)
    draw.text((64, 210), TAGLINE_WHITE, font=tag, fill=WHITE)
    draw.text((64, 256), TAGLINE_YELLOW, font=tag, fill=YELLOW)

    sub = load_font("regular", 20)
    sub_lines = [
        "Code-first network diagrams in Mermaid.",
        "Local, versioned, and fed by your real data.",
    ]
    if text_width(draw, SUBLINE, sub) <= 560:
        sub_lines = [SUBLINE]
    y = 330
    for line in sub_lines:
        draw.text((64, y), line, font=sub, fill=GRAY)
        y += 30

    pill_font = load_font("medium", 18)
    x = 64
    pill_y = 430 if len(sub_lines) > 1 else 400
    measure = ImageDraw.Draw(image)
    for label in PILLS:
        width = text_width(measure, label, pill_font) + 32
        if x > 64 and x + width > 660:
            x = 64
            pill_y += 48
        draw_pill(image, (x, pill_y), label, pill_font)
        x += width + 12

    draw = ImageDraw.Draw(image)
    draw.text((64, 580), REPO_URL, font=load_font("regular", 16), fill=URL_GRAY)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(OUT, format="PNG", optimize=True)
    size = OUT.stat().st_size
    if size >= 1_000_000:
        raise SystemExit(f"{OUT} is {size} bytes, which is over 1 MB")
    print(f"wrote {OUT} ({size} bytes)")


if __name__ == "__main__":
    main()
