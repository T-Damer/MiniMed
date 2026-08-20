#!/usr/bin/env python3
"""Install or verify a prepared MiniMed icon pack."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DENSITIES = ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")
FAVICON_SIZES = (16, 32, 48, 64, 128, 256)


def icon_mappings(repo_root: Path) -> dict[str, tuple[Path, ...]]:
    android_res = repo_root / "apps/app/android/app/src/main/res"
    app_public = repo_root / "apps/app/public"
    landing_public = repo_root / "apps/landing/public"
    mappings: dict[str, tuple[Path, ...]] = {
        "source/detailed-master-transparent-1536.png": (
            repo_root / "branding/app-icon-source.png",
        ),
        "android/adaptive/background-1080.png": (
            repo_root / "branding/app-icon-adaptive-background.png",
        ),
        "android/adaptive/foreground-1080.png": (
            repo_root / "branding/app-icon-adaptive-foreground.png",
        ),
        "android/adaptive/monochrome-1080.png": (
            repo_root / "branding/app-icon-monochrome.png",
        ),
        "android/legacy/play-store-512.png": (repo_root / "branding/play-store-icon.png",),
        "web/favicon-master-512.png": (repo_root / "branding/app-icon-favicon.png",),
        "ios/AppIcon-1024.png": (
            repo_root
            / "apps/app/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
        ),
        "web/favicon.ico": (app_public / "favicon.ico", landing_public / "favicon.ico"),
        "web/favicon-64.png": (app_public / "favicon.png", landing_public / "favicon.png"),
        "web/favicon-256.png": (app_public / "app-icon.png",),
        "web/icon-192.png": (app_public / "icon-192.png", app_public / "apple-touch-icon.png"),
        "web/icon-512.png": (app_public / "icon-512.png",),
        "web/maskable-192.png": (app_public / "maskable-192.png",),
        "web/maskable-512.png": (
            repo_root / "branding/app-icon-maskable.png",
            app_public / "maskable-512.png",
        ),
    }
    for density in DENSITIES:
        mipmap = android_res / f"mipmap-{density}"
        mappings[f"android/legacy/{density}/ic_launcher.png"] = (mipmap / "ic_launcher.png",)
        mappings[f"android/legacy/{density}/ic_launcher_round.png"] = (
            mipmap / "ic_launcher_round.png",
        )
        for layer in ("background", "foreground", "monochrome"):
            mappings[f"android/adaptive/{density}/ic_launcher_{layer}.png"] = (
                mipmap / f"ic_launcher_{layer}.png",
            )
    for size in FAVICON_SIZES:
        source = f"web/favicon-{size}.png"
        mappings[source] = (
            *(mappings.get(source, ())),
            app_public / f"favicon-{size}.png",
            landing_public / f"favicon-{size}.png",
        )
    return mappings


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_manifest(data: bytes) -> dict[str, object]:
    manifest = json.loads(data)
    if manifest.get("name") != "MiniMed" or manifest.get("version") != 2:
        raise ValueError("Expected MiniMed icon pack version 2.")
    hashes = manifest.get("sha256")
    if not isinstance(hashes, dict) or not all(
        isinstance(path, str) and isinstance(value, str) for path, value in hashes.items()
    ):
        raise ValueError("Icon pack sha256 manifest is invalid.")
    return manifest


def install(pack: Path, repo_root: Path) -> int:
    mappings = icon_mappings(repo_root)
    with ZipFile(pack) as archive:
        manifest_data = archive.read("icons.json")
        manifest = load_manifest(manifest_data)
        hashes = manifest["sha256"]
        assert isinstance(hashes, dict)
        for source, expected in hashes.items():
            data = archive.read(source)
            if digest(data) != expected:
                raise ValueError(f"Icon pack hash mismatch: {source}")
        for source, destinations in mappings.items():
            data = archive.read(source)
            for destination in destinations:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
        provenance = repo_root / "branding/app-icon-pack-v2.json"
        provenance.write_bytes(manifest_data.rstrip(b"\n") + b"\n")
    print(f"Installed {len(mappings)} icon assets from {pack}.")
    return 0


def check(repo_root: Path) -> int:
    manifest_path = repo_root / "branding/app-icon-pack-v2.json"
    manifest = load_manifest(manifest_path.read_bytes())
    hashes = manifest["sha256"]
    assert isinstance(hashes, dict)
    failures: list[str] = []
    for source, destinations in icon_mappings(repo_root).items():
        expected = hashes.get(source)
        if not isinstance(expected, str):
            failures.append(f"missing manifest hash: {source}")
            continue
        for destination in destinations:
            if not destination.is_file():
                failures.append(f"missing: {destination.relative_to(repo_root)}")
            elif digest(destination.read_bytes()) != expected:
                failures.append(f"hash mismatch: {destination.relative_to(repo_root)}")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("MiniMed icon pack v2 assets match the recorded hashes.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", type=Path, nargs="?")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    repo_root = args.repo_root.expanduser().resolve()
    if args.check:
        if args.pack is not None:
            parser.error("pack is not used with --check")
        return check(repo_root)
    if args.pack is None:
        parser.error("pack is required unless --check is used")
    return install(args.pack.expanduser().resolve(), repo_root)


if __name__ == "__main__":
    raise SystemExit(main())
