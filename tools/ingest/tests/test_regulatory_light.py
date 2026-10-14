"""The bundled regulatory pack (REG2): 323-FZ in full text, a module-pointer card per other act.

No network, no private data: the cards are generated from the committed full-text Markdown under
`content/regulatory-rf-pilot`, the module is that same pack. Search over the bundled pack is covered
by `bun run benchmark:regulatory --database=apps/app/public/content/regulatory.db`.
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any

import pytest
import yaml

from localmed_ingest.builder import build_content_pack, lint_content_pack, load_content_pack
from localmed_ingest.module_distribution import sha256_file
from localmed_ingest.regulatory_distribution import package_regulatory_module
from localmed_ingest.regulatory_light import (
    FULL_TEXT_DOCUMENT_IDS,
    LIGHT_PACK_ID,
    MODULE_ID,
    light_card,
    write_light_sources,
)

ROOT = Path(__file__).resolve().parents[3]
FULL = ROOT / "content" / "regulatory-rf-pilot"
BUNDLED = ROOT / "apps" / "app" / "public" / "content" / "regulatory.db"
# 323-FZ alone is about 3 MB; a card is a few kilobytes. The bundled pack must stay far below the
# 27.8 MB of the full-text module and below the 32 MiB sqlite-wasm limit with room for companions.
BUNDLED_MAX_BYTES = 5 * 1024 * 1024


def _front(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"---\n(.*?)\n---\n", text, re.DOTALL)
    assert match, path.name
    loaded = yaml.safe_load(match.group(1))
    assert isinstance(loaded, dict)
    return loaded


@pytest.fixture(scope="module")
def light(tmp_path_factory: pytest.TempPathFactory) -> Path:
    output = tmp_path_factory.mktemp("light") / "rf-regulatory-light"
    write_light_sources(FULL, output)
    return output


def test_the_main_law_and_the_crosswalk_are_the_modules_bytes(light: Path) -> None:
    full_text = {
        path.name for path in FULL.glob("*.md") if _front(path)["id"] in FULL_TEXT_DOCUMENT_IDS
    }
    assert len(full_text) == len(FULL_TEXT_DOCUMENT_IDS) == 2
    for name in full_text:
        assert (light / name).read_bytes() == (FULL / name).read_bytes(), name


def test_every_other_act_is_a_pointer_card_with_the_same_identity(light: Path) -> None:
    cards = 0
    for path in sorted(FULL.glob("*.md")):
        full = _front(path)
        card = _front(light / path.name)
        if full["id"] in FULL_TEXT_DOCUMENT_IDS:
            continue
        cards += 1
        metadata = card["metadata"]
        # The module carries the same ids; installing it replaces the card.
        assert card["id"] == full["id"] and card["version_label"] == full["version_label"]
        assert metadata["contentMode"] == "module-pointer", path.name
        assert metadata["targetDocumentId"] == full["id"]
        assert metadata["primaryModuleId"] == MODULE_ID
        assert metadata["moduleIds"] == [MODULE_ID]
        assert metadata["textTier"] == "index"
        assert metadata["fullTextContentMode"] == "source_text"
        # What a reader needs to recognise the act is kept; the full-text provenance is not claimed.
        for key in ("documentNumber", "signedAt", "officialSourceUrl", "edition", "description"):
            assert metadata[key] == full["metadata"][key], (path.name, key)
        for key in ("textReading", "textPages", "textFlaggedPages", "textPagesReviewed"):
            assert key not in metadata, (path.name, key)
        assert card["source_type"] == full["source_type"] and card["status"] == full["status"]
    assert cards == 29


def test_a_card_only_repeats_the_act_and_stays_small(light: Path) -> None:
    for path in sorted(FULL.glob("*.md")):
        if _front(path)["id"] in FULL_TEXT_DOCUMENT_IDS:
            continue
        text = path.read_text(encoding="utf-8")
        _, card_body = (light / path.name).read_text(encoding="utf-8").split("\n---\n", 1)
        assert len(card_body) < 12_000, path.name
        # The source-and-edition section is copied verbatim to the end of the card.
        source = text[text.index("# Источник и редакция") :]
        assert card_body.rstrip("\n").endswith(source.rstrip("\n")), path.name
        # Every sentence outside the outline is the first paragraph of the act, the card description
        # or the source section; nothing is composed here.
        assert card_body.count("# ") <= 6, path.name


def test_a_card_without_a_source_section_is_refused() -> None:
    text = (FULL / "order-192n-dispensary-observation.md").read_text(encoding="utf-8")
    broken = text[: text.index("# Источник и редакция")]
    with pytest.raises(ValueError, match="Источник и редакция"):
        light_card(broken, file_name="x.md")


def test_the_light_sources_never_overwrite_the_full_text_sources() -> None:
    with pytest.raises(ValueError, match="overwrite"):
        write_light_sources(FULL, FULL)


def test_the_bundled_pack_builds_from_the_cards_and_lints(light: Path, tmp_path: Path) -> None:
    assert lint_content_pack(load_content_pack(light)) == []
    database = tmp_path / "light.db"
    pack, _report = build_content_pack(light, database, include_embeddings=False)
    assert pack.manifest.id == LIGHT_PACK_ID
    assert len(pack.documents) == 31
    with sqlite3.connect(database) as connection:
        ids = {row[0] for row in connection.execute("SELECT id FROM documents")}
        full_ids = {_front(path)["id"] for path in FULL.glob("*.md")}
        assert ids == full_ids
        law_chunks = connection.execute(
            "SELECT count(*) FROM chunks c JOIN sections s ON s.id = c.section_id "
            "JOIN document_versions v ON v.id = s.document_version_id "
            "WHERE v.document_id = 'regulatory.rf.federal-law.323-fz-2011'"
        ).fetchone()[0]
        assert law_chunks > 150


def test_the_committed_bundled_pack_is_light_and_lists_every_act() -> None:
    assert BUNDLED.stat().st_size < BUNDLED_MAX_BYTES
    full_ids = {_front(path)["id"] for path in FULL.glob("*.md")}
    with sqlite3.connect(BUNDLED.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        rows = connection.execute(
            "SELECT id, json_extract(metadata_json, '$.contentMode') FROM documents"
        ).fetchall()
        pack = connection.execute("SELECT id FROM content_packs").fetchall()
    assert pack == [(LIGHT_PACK_ID,)]
    assert {row[0] for row in rows} == full_ids
    pointers = {row[0] for row in rows if row[1] == "module-pointer"}
    assert pointers == full_ids - FULL_TEXT_DOCUMENT_IDS


def test_the_module_is_the_full_text_pack_in_framed_zstd(tmp_path: Path) -> None:
    database = tmp_path / "full.db"
    build_content_pack(FULL, database, include_embeddings=False)
    report = package_regulatory_module(
        database, tmp_path / "release", version="2026.10.14-r2", min_app_version="0.6.60"
    )
    entry = json.loads(Path(str(report["catalogEntry"])).read_text(encoding="utf-8"))
    artifact = entry["artifacts"][0]
    assert entry["id"] == MODULE_ID and entry["compatibility"]["minAppVersion"] == "0.6.60"
    assert artifact["compression"] == "zstd"
    assert artifact["url"].endswith(
        "/regulatory-2026.10.14-r2/minimed.regulatory.pediatrics.2026.10.14-r2.db.zst"
    )
    assert artifact["decodedSizeBytes"] == database.stat().st_size
    assert artifact["decodedSha256"] == sha256_file(database)
    assert artifact["sizeBytes"] < artifact["decodedSizeBytes"] / 4
    assert entry["sizes"]["downloadBytes"] == artifact["sizeBytes"]
    # The module carries every document the bundled cards stand for, under the same ids.
    assert {row["documentId"] for row in entry["documents"]} == {
        _front(path)["id"] for path in FULL.glob("*.md")
    }
    assert Path(str(report["archive"])).read_bytes()[:4] == b"\x28\xb5\x2f\xfd"
