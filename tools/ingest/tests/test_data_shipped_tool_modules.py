"""Data-type test: every authored tool module rebuilds into the pack shipped in the repository.

The builder tests cover three modules; this one walks all of them, so a calculator edited without
repackaging (or a pack hand-edited) is caught. See docs/DATA_TESTS.md.
"""

import json
import re
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.tool_modules import build_tool_module, load_tool_module

ROOT = Path(__file__).resolve().parents[3]
TOOL_FILES = sorted((ROOT / "content/tool-modules").glob("*.json"))
CATALOG = ROOT / "apps/app/src/features/modules/catalog.preview.json"
MODULES = ROOT / "apps/app/public/content/modules"


def _shipped_pack(module_id: str) -> Path:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    entry = next(module for module in catalog["modules"] if module["id"] == module_id)
    artifact = next(item for item in entry["artifacts"] if item["kind"] == "index")
    return MODULES / str(artifact["url"]).rsplit("/", 1)[-1]


def _snapshot(path: Path) -> dict[str, list[tuple[object, ...]]]:
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        return {
            "pack": connection.execute(
                "SELECT id, version, schema_version, title, checksum FROM content_packs"
            ).fetchall(),
            "tools": connection.execute("SELECT * FROM tool_definitions ORDER BY id").fetchall(),
            "sources": connection.execute("SELECT * FROM tool_sources ORDER BY id").fetchall(),
        }


def test_there_is_a_tool_module_per_catalog_tool_entry() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    cataloged = {m["id"] for m in catalog["modules"] if m["id"].startswith("minimed.tools.")}
    authored = {load_tool_module(path)[0].id for path in TOOL_FILES}
    assert authored == cataloged
    assert len(TOOL_FILES) >= 16


def test_tool_ids_and_slugs_are_unique_across_modules() -> None:
    ids: set[str] = set()
    slugs: set[str] = set()
    for path in TOOL_FILES:
        module, _ = load_tool_module(path)
        for tool in module.tools:
            assert tool.id not in ids, tool.id
            assert tool.slug not in slugs, tool.slug
            ids.add(tool.id)
            slugs.add(tool.slug)
            assert tool.sources, f"{tool.id} cites no source"
            for source in tool.sources:
                assert source.title.strip(), f"{tool.id}/{source.id} has no title"
                assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", source.reviewed_at), source.id
                if source.url:
                    assert source.url.startswith("https://"), f"{tool.id}/{source.id}"
    assert len(ids) > 100


@pytest.mark.parametrize("source", TOOL_FILES, ids=lambda path: path.stem)
def test_rebuilding_a_tool_module_reproduces_the_shipped_pack(source: Path, tmp_path: Path) -> None:
    module, _ = load_tool_module(source)
    output = tmp_path / f"{source.stem}.db"
    build_tool_module(source, output)
    assert _snapshot(output) == _snapshot(_shipped_pack(module.id))
