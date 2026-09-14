# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==12.3.0"]
# ///
"""Prepare the eight individual GPT-generated character images.

Run: uv run scripts/prepare_characters.py
Preserves original PNGs; exports one lossless RGBA atlas and a review contact sheet.
No background removal, invented pixels, or sheet splitting is needed.
"""

from __future__ import annotations

import argparse
import json
from math import hypot
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
NAMES = ("fire", "ice", "leaf", "sun", "shadow", "blossom", "golem", "cosmic")
SIZE = 256
COLUMNS = 4
SAFE_RADIUS = 110


def prepare(path: Path) -> Image.Image:
    """Fit the full silhouette into a circle; keep room for bounce and rotation."""
    with Image.open(path) as source:
        if "A" not in source.getbands():
            raise ValueError(f"Expected a transparent PNG: {path}")
        image = source.convert("RGBA")
    alpha = image.getchannel("A")
    if alpha.getextrema()[0] != 0:
        raise ValueError(f"Missing transparent background: {path}")
    # These exports contain scattered alpha 1–4 dust far outside the character.
    # Remove only that nearly invisible noise, not petals/droplets or dark areas.
    alpha = alpha.point([0 if value <= 4 else value for value in range(256)])
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError(f"Empty character: {path}")
    image.putalpha(alpha)
    image = image.crop(bounds)
    cx, cy = image.width / 2, image.height / 2
    radius = max(
        hypot(index % image.width + 0.5 - cx, index // image.width + 0.5 - cy)
        for index, value in enumerate(image.getchannel("A").tobytes())
        if value
    )
    # Two source pixels of allowance for resampling fringes.
    scale = SAFE_RADIUS / (radius + 2)
    dimensions = (
        max(1, round(image.width * scale)),
        max(1, round(image.height * scale)),
    )
    resized = image.resize(dimensions, Image.Resampling.LANCZOS)
    sprite = Image.new("RGBA", (SIZE, SIZE))
    sprite.alpha_composite(
        resized, ((SIZE - resized.width) // 2, (SIZE - resized.height) // 2)
    )
    # Validate the exported pixels, including faint antialiasing, not just boxes.
    extent = max(
        hypot(index % SIZE + 0.5 - SIZE / 2, index // SIZE + 0.5 - SIZE / 2)
        for index, value in enumerate(sprite.getchannel("A").tobytes())
        if value > 4
    )
    if extent > SAFE_RADIUS + 2:
        raise ValueError(f"Character exceeds its safe circle: {path} ({extent:.2f}px)")
    return sprite


def generate(source: Path, output: Path) -> None:
    """Keep the atlas order identical to the game's color indices (wildcard last)."""
    sprites = [prepare(source / f"{name}.png") for name in NAMES]
    output.mkdir(parents=True, exist_ok=True)
    atlas = Image.new("RGBA", (SIZE * COLUMNS, SIZE * 2))
    contact = Image.new("RGB", (SIZE * COLUMNS, (SIZE + 42) * 2), "#101b30")
    draw = ImageDraw.Draw(contact)
    entries: list[dict[str, object]] = []
    for index, (name, sprite) in enumerate(zip(NAMES, sprites, strict=True)):
        x, y = index % COLUMNS * SIZE, index // COLUMNS * SIZE
        atlas.alpha_composite(sprite, (x, y))
        sprite.save(output / f"{name}.webp", "WEBP", lossless=True, method=6)
        cy = index // COLUMNS * (SIZE + 42)
        draw.rounded_rectangle(
            (x + 8, cy + 8, x + 248, cy + 290), radius=18, fill="#1b2b44"
        )
        contact.paste(sprite, (x, cy), sprite)
        draw.text((x + 18, cy + 268), name.upper(), fill="#eef6ff")
        # Also show the real phone-scale appearance beside the large art.
        thumb = sprite.resize((48, 48), Image.Resampling.LANCZOS)
        contact.paste(thumb, (x + 194, cy + 242), thumb)
        entries.append({"name": name, "index": index, "rect": [x, y, SIZE, SIZE]})
    atlas_path = output / "atlas.webp"
    atlas.save(atlas_path, "WEBP", lossless=True, method=6)
    with Image.open(atlas_path) as saved:
        if saved.mode != "RGBA" or saved.size != atlas.size:
            raise ValueError("Atlas lost its dimensions or transparency")
        if saved.tobytes() != atlas.tobytes():
            # Lossless WebP may discard RGB under alpha=0; compare composited pixels.
            for background in ("#000000", "#ffffff"):
                base = Image.new("RGBA", atlas.size, background)
                if (
                    Image.alpha_composite(base, saved).tobytes()
                    != Image.alpha_composite(base, atlas).tobytes()
                ):
                    raise ValueError("Atlas changed visible pixels")
    contact.save(output / "comparison.png")
    with Image.open(source / "background.png") as background:
        background.convert("RGB").save(
            output.parent / "background.webp", "WEBP", quality=88, method=6
        )
    manifest = {
        "size": list(atlas.size),
        "safe_radius": SAFE_RADIUS,
        "characters": entries,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Prepared 8 sprites; atlas {atlas_path.stat().st_size / 1024:.0f} KiB")
    print(f"Review: {output / 'comparison.png'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "art/characters/source")
    parser.add_argument("--output", type=Path, default=ROOT / "public/characters")
    args = parser.parse_args()
    generate(args.source, args.output)


if __name__ == "__main__":
    main()
