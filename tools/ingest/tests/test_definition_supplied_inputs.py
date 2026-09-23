from __future__ import annotations

import copy
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_compact_pack import build_compact_definition_reference
from localmed_ingest.definition_reference_pack import encoded, obj, seq
from localmed_ingest.definition_supplied_inputs import (
    load_supplied_inputs,
    register_supplied_inputs,
)
from test_definition_reference_pack import fixture


def supplied(root: Path) -> tuple[Path, Path]:
    # These are byte-receipt fixtures, not a test of a PDF parser or medical meaning.
    original = root / "source.pdf"
    original.write_bytes(b"%PDF-1.7\nsynthetic source-receipt fixture\n")
    data = fixture()
    descriptor = obj(seq(data["sources"], 10)[0])
    descriptor.update(
        {
            "sourceType": "owner-pdf",
            "baseUrl": "",
            "fileName": original.name,
            "sourceSha256": hashlib.sha256(original.read_bytes()).hexdigest(),
        }
    )
    for value in seq(data["blocks"], 10):
        obj(value)["path"] = ""
    for value in seq(data["terms"], 10):
        row = obj(value)
        row["id"] = "supplied." + str(row["id"])
    prepared = root / "supplied.json"
    prepared.write_text(encoded(data), encoding="utf-8")
    return original, prepared


def registered(root: Path) -> tuple[Path, Path, Path]:
    original, prepared = supplied(root)
    manifest = Path("registered.json")
    register_supplied_inputs(root, manifest, (Path(prepared.name),), (Path(original.name),))
    return original, prepared, root / manifest


def test_receipts_return_exact_bytes_and_do_not_modify_sources(tmp_path: Path) -> None:
    original, prepared, manifest = registered(tmp_path)
    before = original.read_bytes(), prepared.read_bytes()
    snapshots = load_supplied_inputs(tmp_path, Path(manifest.name))
    assert len(snapshots) == 1
    assert snapshots[0].payload == before[1]
    assert (snapshots[0].entries, snapshots[0].definitions, snapshots[0].abbreviations) == (2, 1, 0)
    assert before == (original.read_bytes(), prepared.read_bytes())


@pytest.mark.parametrize("which", ["original", "prepared"])
def test_replacement_after_registration_is_rejected(tmp_path: Path, which: str) -> None:
    original, prepared, manifest = registered(tmp_path)
    path = original if which == "original" else prepared
    data = path.read_bytes()
    path.write_bytes(data[:-1] + (b"X" if data[-1:] != b"X" else b"Y"))
    with pytest.raises(ValueError, match="checksum"):
        load_supplied_inputs(tmp_path, Path(manifest.name))


@pytest.mark.parametrize("path", ["../outside.pdf", "/etc/passwd", "folder\\outside.pdf"])
def test_root_escape_rejected_before_read(tmp_path: Path, path: str) -> None:
    _, _, manifest = registered(tmp_path)
    data = json.loads(manifest.read_text())
    data["sources"][0]["path"] = path
    manifest.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="relative"):
        load_supplied_inputs(tmp_path, Path(manifest.name))


def test_symlink_escape_is_not_accepted(tmp_path: Path) -> None:
    root = tmp_path / "root"
    root.mkdir()
    _, _, manifest = registered(root)
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"%PDF-1.7\nexternal fixture\n")
    (root / "link.pdf").symlink_to(outside)
    data = json.loads(manifest.read_text())
    data["sources"][0]["path"] = "link.pdf"
    manifest.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="escapes"):
        load_supplied_inputs(root, Path(manifest.name))


@pytest.mark.parametrize("mutation", ["source-hash", "release", "dangling", "body", "duplicate-id"])
def test_invalid_prepared_material_cannot_be_registered(tmp_path: Path, mutation: str) -> None:
    original, prepared = supplied(tmp_path)
    data = json.loads(prepared.read_text())
    if mutation == "source-hash":
        data["sources"][0]["sourceSha256"] = "0" * 64
    elif mutation == "release":
        data["sources"][0]["releaseEligible"] = True
    elif mutation == "dangling":
        data["terms"][0]["blockIds"] = [9999]
    elif mutation == "body":
        data["blocks"][0]["text"] += " changed"
    else:
        data["terms"][1]["id"] = data["terms"][0]["id"]
    prepared.write_text(encoded(data))
    with pytest.raises(ValueError):
        register_supplied_inputs(
            tmp_path, Path("must-not-exist.json"), (Path(prepared.name),), (Path(original.name),)
        )
    assert not (tmp_path / "must-not-exist.json").exists()


def test_overwrite_and_unused_original_are_rejected(tmp_path: Path) -> None:
    original, prepared, manifest = registered(tmp_path)
    with pytest.raises(ValueError, match="new manifest"):
        register_supplied_inputs(
            tmp_path, Path(manifest.name), (Path(prepared.name),), (Path(original.name),)
        )
    extra = tmp_path / "extra.pdf"
    extra.write_bytes(b"%PDF-1.7\nunused original\n")
    with pytest.raises(ValueError, match="unused"):
        register_supplied_inputs(
            tmp_path,
            Path("new.json"),
            (Path(prepared.name),),
            (Path(original.name), Path(extra.name)),
        )
    assert not (tmp_path / "new.json").exists()


def test_definitions_and_instruments_share_normal_database_without_new_facts(
    tmp_path: Path,
) -> None:
    _, prepared, manifest = registered(tmp_path)
    ordinary = tmp_path / "ordinary.json"
    ordinary.write_text(encoded(fixture()), encoding="utf-8")
    db_path = tmp_path / "combined.db"
    report = build_compact_definition_reference(
        (ordinary,),
        db_path,
        input_root=tmp_path,
        edition_id="fixture.unified",
        version="1",
        built_at="2026-09-23",
        definitions_only=True,
        supplied_root=tmp_path,
        supplied_manifest=Path(manifest.name),
    )
    assert report["entries"] == 3
    assert report["suppliedSources"] == {
        "entries": 2,
        "definitions": 1,
        "abbreviations": 0,
        "otherReferences": 1,
    }
    assert report["logicalRoundTripEqual"] is True
    assert len(seq(report["receipts"], 10)) == 2
    with sqlite3.connect(db_path) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert {r[0] for r in db.execute("SELECT id FROM knowledge_entities")} == {
            "fixture.second",
            "supplied.fixture.first",
            "supplied.fixture.second",
        }
        for table in ("knowledge_facts", "knowledge_relations", "tool_definitions"):
            assert db.execute(f"SELECT count(*) FROM {table}").fetchone() == (0,)
        data = json.loads(prepared.read_text())
        for block in data["blocks"]:
            assert (
                db.execute(
                    "SELECT count(*) FROM chunks WHERE original_text=?", (block["text"],)
                ).fetchone()[0]
                >= 1
            )
        assert db.execute(
            "SELECT DISTINCT review_status FROM definition_reference_links"
        ).fetchall() == [("proposed",)]


def test_abbreviation_is_not_counted_as_a_clinical_definition(tmp_path: Path) -> None:
    original, prepared = supplied(tmp_path)
    data = json.loads(prepared.read_text())
    data["terms"][1]["extractionRole"] = "abbreviation-expansion"
    prepared.write_text(encoded(data))
    register_supplied_inputs(
        tmp_path, Path("registered.json"), (Path(prepared.name),), (Path(original.name),)
    )
    snapshot = load_supplied_inputs(tmp_path, Path("registered.json"))[0]
    assert (snapshot.definitions, snapshot.abbreviations) == (0, 1)


def test_conflicting_global_identity_fails_without_database(tmp_path: Path) -> None:
    _, prepared, manifest = registered(tmp_path)
    original = copy.deepcopy(json.loads(prepared.read_text()))
    ordinary = tmp_path / "ordinary.json"
    ordinary.write_text(encoded(original))
    output = tmp_path / "not-created.db"
    with pytest.raises(ValueError, match=r"repeats|conflicting"):
        build_compact_definition_reference(
            (ordinary,),
            output,
            input_root=tmp_path,
            edition_id="fixture.unified",
            version="1",
            built_at="2026-09-23",
            supplied_root=tmp_path,
            supplied_manifest=Path(manifest.name),
        )
    assert not output.exists()
