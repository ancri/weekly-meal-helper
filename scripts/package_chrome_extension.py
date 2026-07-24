#!/usr/bin/env python3
"""Validate and create a deterministic Chrome Web Store extension archive."""

from __future__ import annotations

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extension" / "whole-foods-cart-helper"
DIST = ROOT / "dist"
RUNTIME_SUFFIXES = {".css", ".html", ".js", ".png"}


def manifest_references(manifest: dict) -> set[str]:
    references = {
        manifest["background"]["service_worker"],
        manifest["action"]["default_popup"],
    }
    default_icon = manifest["action"].get("default_icon")
    if isinstance(default_icon, str):
        references.add(default_icon)
    elif isinstance(default_icon, dict):
        references.update(default_icon.values())
    references.update(manifest.get("icons", {}).values())
    for content_script in manifest["content_scripts"]:
        references.update(content_script.get("js", []))
        references.update(content_script.get("css", []))
    return references


def validate() -> tuple[dict, list[Path]]:
    manifest_path = SOURCE / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("manifest_version") != 3:
        raise ValueError("The extension must use Manifest V3.")

    missing = sorted(
        reference
        for reference in manifest_references(manifest)
        if not (SOURCE / reference).is_file()
    )
    if missing:
        raise ValueError(f"Manifest references missing files: {', '.join(missing)}")

    runtime_files = [
        path
        for path in SOURCE.iterdir()
        if path.is_file() and path.suffix in RUNTIME_SUFFIXES
    ]
    runtime_files.append(manifest_path)
    return manifest, sorted(set(runtime_files), key=lambda path: path.name)


def package() -> Path:
    manifest, files = validate()
    DIST.mkdir(parents=True, exist_ok=True)
    destination = DIST / f"whole-foods-cart-helper-{manifest['version']}.zip"
    with ZipFile(destination, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            info = ZipInfo(path.name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    return destination


if __name__ == "__main__":
    output = package()
    print(output.relative_to(ROOT))
