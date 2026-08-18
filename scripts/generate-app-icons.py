#!/usr/bin/env python3
"""Generate MiniMed launcher, favicon, and in-app icon assets from one source PNG.

Replace `branding/app-icon-source.png` and run `bun run icons:generate`.
Pass `--source path/to/logo.png` to use a different master.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "branding" / "app-icon-source.png"
OPAQUE_BACKGROUND = (0, 0, 0, 255)
ANDROID_DENSITIES = {
    "mdpi": 1.0,
    "hdpi": 1.5,
    "xhdpi": 2.0,
    "xxhdpi": 3.0,
    "xxxhdpi": 4.0,
}
ANDROID_LAUNCHER_DP = 48
ANDROID_FOREGROUND_DP = 108
ANDROID_FOREGROUND_INSET = 0.72


def cropped_artwork(source: Image.Image) -> Image.Image:
    rgba = source.convert("RGBA")
    bbox = rgba.getbbox()
    if bbox is None:
        raise ValueError("Icon source is fully transparent.")
    return rgba.crop(bbox)


def contain(
    image: Image.Image, size: int, fill: tuple[int, int, int, int] = (0, 0, 0, 0)
) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), fill)
    fitted = image.copy()
    fitted.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas.paste(
        fitted, ((size - fitted.width) // 2, (size - fitted.height) // 2), fitted
    )
    return canvas


def cover(image: Image.Image, size: int) -> Image.Image:
    scale = max(size / image.width, size / image.height)
    resized = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - size) // 2
    top = (resized.height - size) // 2
    return resized.crop((left, top, left + size, top + size))


def opaque(
    image: Image.Image, background: tuple[int, int, int, int] = OPAQUE_BACKGROUND
) -> Image.Image:
    base = Image.new("RGBA", image.size, background)
    base.alpha_composite(image)
    return base.convert("RGB")


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True, compress_level=9)


def write_android_mipmaps(artwork: Image.Image, repo_root: Path) -> list[Path]:
    written: list[Path] = []
    res = repo_root / "apps" / "app" / "android" / "app" / "src" / "main" / "res"
    for name, scale in ANDROID_DENSITIES.items():
        folder = res / f"mipmap-{name}"
        launcher_size = round(ANDROID_LAUNCHER_DP * scale)
        foreground_size = round(ANDROID_FOREGROUND_DP * scale)
        launcher = opaque(cover(artwork, launcher_size))
        inset = round(foreground_size * ANDROID_FOREGROUND_INSET)
        foreground = contain(artwork, inset)
        foreground_canvas = Image.new(
            "RGBA", (foreground_size, foreground_size), (0, 0, 0, 0)
        )
        foreground_canvas.paste(
            foreground,
            (
                (foreground_size - foreground.width) // 2,
                (foreground_size - foreground.height) // 2,
            ),
            foreground,
        )
        for filename, image in (
            ("ic_launcher.png", launcher),
            ("ic_launcher_round.png", launcher),
            ("ic_launcher_foreground.png", foreground_canvas),
        ):
            path = folder / filename
            save_png(image, path)
            written.append(path)
    return written


def generate_app_icons(source_path: Path, repo_root: Path) -> list[Path]:
    if not source_path.is_file():
        raise FileNotFoundError(f"Icon source not found: {source_path}")
    artwork = cropped_artwork(Image.open(source_path))
    web_targets = (
        (repo_root / "apps" / "app" / "public" / "app-icon.png", 256),
        (repo_root / "apps" / "app" / "public" / "favicon.png", 64),
        (repo_root / "apps" / "app" / "public" / "apple-touch-icon.png", 180),
        (repo_root / "apps" / "landing" / "public" / "favicon.png", 64),
    )
    written: list[Path] = []
    for path, size in web_targets:
        save_png(contain(artwork, size), path)
        written.append(path)

    ios_icon = (
        repo_root
        / "apps"
        / "app"
        / "ios"
        / "App"
        / "App"
        / "Assets.xcassets"
        / "AppIcon.appiconset"
        / "AppIcon-512@2x.png"
    )
    save_png(opaque(cover(artwork, 1024)), ios_icon)
    written.append(ios_icon)
    written.extend(write_android_mipmaps(artwork, repo_root))
    return written


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help=f"Master PNG (default: {DEFAULT_SOURCE.relative_to(ROOT)})",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=ROOT,
        help="Repository root that contains apps/ and branding/",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    source = args.source.expanduser().resolve()
    repo_root = args.repo_root.expanduser().resolve()
    written = generate_app_icons(source, repo_root)
    print(f"Source: {source}")
    for path in written:
        print(path.relative_to(repo_root))
    print(f"Wrote {len(written)} icon files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
