from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
from typer.testing import CliRunner

from localmed_ingest.models import SourceProvenance, SourceRights
from localmed_ingest.terminology_cli import app
from localmed_ingest.terminology_mesh import checked_xml, parse_mesh
from localmed_ingest.terminology_models import (
    MedicalTerm,
    TerminologySource,
    TerminologySources,
)
from localmed_ingest.terminology_packs import build_terminology_packs
from localmed_ingest.terminology_prepare import (
    apply_wikidata_names,
    display_name,
    prepare_terminology,
    read_terms,
)
from localmed_ingest.terminology_sources import collect_terminology, read_sources, sha256_file

# Synthetic records exercise identity and evidence boundaries. They are NOT clinical definitions.
XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE DescriptorRecordSet SYSTEM "https://example.invalid/never-fetch.dtd">
<DescriptorRecordSet LanguageCode="eng" DescriptorSetYear="2026">
<DescriptorRecord>
<DescriptorUI>D009110</DescriptorUI>
<DescriptorName>
<String>Munchausen Syndrome</String>
</DescriptorName>
<TreeNumberList>
<TreeNumber>F03.100</TreeNumber>
<TreeNumber>C10.200</TreeNumber>
</TreeNumberList>
<ConceptList>
 <Concept PreferredConceptYN="Y">
<ConceptUI>M0000001</ConceptUI>
<ConceptName>
<String>Munchausen Syndrome</String>
</ConceptName>
 <ScopeNote>Synthetic source definition, not medical guidance.</ScopeNote>
 <TermList>
<Term ConceptPreferredTermYN="Y">
<TermUI>T000001</TermUI>
<String>Munchausen Syndrome</String>
</Term>
<Term>
<TermUI>T000002</TermUI>
<String>Test shared name</String>
</Term>
</TermList>
 <ConceptRelationList>
<ConceptRelation RelationName="NRW">
<Concept1UI>M0000001</Concept1UI>
<Concept2UI>M0000002</Concept2UI>
</ConceptRelation>
</ConceptRelationList>
 </Concept>
 <Concept PreferredConceptYN="N">
<ConceptUI>M0000002</ConceptUI>
<ConceptName>
<String>Narrower fixture concept</String>
</ConceptName>
 <TermList>
<Term ConceptPreferredTermYN="Y">
<TermUI>T000003</TermUI>
<String>Narrower fixture concept</String>
</Term>
</TermList>
</Concept>
</ConceptList>
</DescriptorRecord>
<DescriptorRecord>
<DescriptorUI>D016735</DescriptorUI>
<DescriptorName>
<String>Munchausen Syndrome by Proxy</String>
</DescriptorName>
<TreeNumberList>
<TreeNumber>F03.300</TreeNumber>
</TreeNumberList>
<ConceptList>
 <Concept PreferredConceptYN="Y">
<ConceptUI>M0000003</ConceptUI>
<ConceptName>
<String>Munchausen Syndrome by Proxy</String>
</ConceptName>
 <ScopeNote>Another synthetic definition.</ScopeNote>
 <TermList>
<Term ConceptPreferredTermYN="Y">
<TermUI>T000004</TermUI>
<String>Munchausen Syndrome by Proxy</String>
</Term>
<Term>
<TermUI>T000005</TermUI>
<String>Test shared name</String>
</Term>
</TermList>
 </Concept>
</ConceptList>
</DescriptorRecord>
</DescriptorRecordSet>"""


def add_source(
    root: Path, filename: str, data: bytes, kind: str = "mesh-descriptors"
) -> TerminologySource:
    root.mkdir(parents=True, exist_ok=True)
    (root / filename).write_bytes(data)
    checksum = sha256_file(root / filename)
    return TerminologySource.model_validate(
        {
            "id": kind,
            "format": kind,
            "path": filename,
            "edition": "2026",
            "sha256": checksum,
            "provenance": SourceProvenance(
                source_id=kind,
                publisher="Synthetic fixtures",
                official_locator=f"https://example.invalid/{filename}",
                jurisdiction="international",
                rights_status="verified",
                raw_checksum=checksum,
                rights=SourceRights(
                    owner="MiniMed tests",
                    license_id="synthetic-fixture",
                    allows_offline_storage=True,
                    allows_derivative_processing=True,
                    allows_redistribution=True,
                ),
            ).model_dump(by_alias=True),
        }
    )


def snapshot(root: Path, *, russian: bool = False) -> TerminologySources:
    mesh = add_source(root, "mesh.xml.gz", gzip.compress(XML, mtime=0))
    sources = [mesh]
    if russian:
        record = {
            "conceptId": "M0000001",
            "preferredName": "Синдром Мюнхгаузена",
            "aliases": ["Мюнхгаузен синдром"],
            "definition": "Синтетическое определение для теста, не медицинская справка.",
        }
        sources.append(
            add_source(
                root,
                "localized.jsonl",
                (json.dumps(record, ensure_ascii=False) + "\n").encode(),
                "localized-concepts",
            )
        )
    manifest = TerminologySources(sources=sources)
    (root / "sources.json").write_text(manifest.model_dump_json(by_alias=True), "utf-8")
    return manifest


def binding(value: str, *, lang: str | None = None) -> dict[str, str]:
    return {
        "value": value,
        "type": "literal" if lang else "uri",
        **({"xml:lang": lang} if lang else {}),
    }


def wd_row(descriptor: str, item: str, label: str, lang: str = "ru") -> dict[str, object]:
    return {
        "item": binding(f"http://www.wikidata.org/entity/{item}"),
        "mesh": {"value": descriptor, "type": "literal"},
        "label": binding(label, lang=lang),
    }


def test_concepts_keep_own_names_definitions_and_multisection_identity(tmp_path: Path) -> None:
    manifest = snapshot(tmp_path)
    terms = parse_mesh(tmp_path / "mesh.xml.gz", manifest.sources[0])
    assert len(terms) == 3
    assert terms[1].definitions == []  # no inheritance from preferred concept
    assert terms[0].tree_numbers == ["C10.200", "F03.100"]
    assert terms[0].relations[0].object_id == terms[1].id
    assert terms[0].relations[0].predicate == "NRW"  # direction retained verbatim
    assert "ConceptUI='M0000001'" in terms[0].relations[0].evidence.locator
    assert terms[2].id != terms[0].id  # shared aliases never merge clinical concepts


@pytest.mark.parametrize(
    "replacement",
    [
        XML.replace(b"M0000002", b"M0000001"),
        XML.replace(b"<Concept2UI>M0000002", b"<Concept2UI>M9999999"),
        XML.replace(b'DescriptorSetYear="2026"', b'DescriptorSetYear="2025"'),
        XML.replace(b"<TreeNumber>F03.100", b"<TreeNumber>../bad"),
        XML.replace(b'PreferredConceptYN="N"', b'PreferredConceptYN="Y"'),
    ],
)
def test_invalid_mesh_fails_closed(tmp_path: Path, replacement: bytes) -> None:
    source = add_source(tmp_path, "mesh.xml", replacement)
    with pytest.raises(ValueError):
        parse_mesh(tmp_path / "mesh.xml", source)


@pytest.mark.parametrize(
    "data",
    [
        b'<!DOCTYPE foo [<!ENTITY x "unsafe">]><foo/>',
        b"<!DOCTYPE foo [ ]><foo/>",
        "<foo/>".encode("utf-16"),
    ],
)
def test_unsafe_xml_never_reaches_parser(tmp_path: Path, data: bytes) -> None:
    path = tmp_path / "input"
    path.write_bytes(data)
    with pytest.raises(ValueError), checked_xml(path):
        pass


def test_bounded_decompression(tmp_path: Path) -> None:
    path = tmp_path / "input.gz"
    path.write_bytes(gzip.compress(b"x" * 1024))
    with pytest.raises(ValueError, match="byte limit"), checked_xml(path, max_bytes=128):
        pass


def test_exact_wikidata_join_does_not_supply_definitions(tmp_path: Path) -> None:
    manifest = snapshot(tmp_path)
    terms = parse_mesh(tmp_path / "mesh.xml.gz", manifest.sources[0])
    original = [t.definitions.copy() for t in terms]
    payload = {"results": {"bindings": [wd_row("D009110", "Q1", "Синдром Мюнхгаузена")]}}
    source = add_source(tmp_path, "wd.json", json.dumps(payload).encode(), "wikidata-ru")
    assert apply_wikidata_names(terms, tmp_path / "wd.json", source) == []
    assert display_name(terms[0]).text == "Синдром Мюнхгаузена"
    assert display_name(terms[0]).kind == "candidate-label"
    assert not any(n.language == "ru" for n in terms[1].names)
    assert [t.definitions for t in terms] == original


@pytest.mark.parametrize(
    "rows",
    [
        [wd_row("D009110", "Q1", "Первое"), wd_row("D009110", "Q2", "Второе")],
        [wd_row("D009110", "Q1", "Первое"), wd_row("D016735", "Q1", "Первое")],
    ],
)
def test_ambiguous_wikidata_crosswalk_is_review_not_a_merge(
    tmp_path: Path, rows: list[dict[str, object]]
) -> None:
    manifest = snapshot(tmp_path)
    terms = parse_mesh(tmp_path / "mesh.xml.gz", manifest.sources[0])
    source = add_source(
        tmp_path, "wd.json", json.dumps({"results": {"bindings": rows}}).encode(), "wikidata-ru"
    )
    reviews = apply_wikidata_names(terms, tmp_path / "wd.json", source)
    assert reviews and all(r.reason == "wikidata-ambiguous-crosswalk" for r in reviews)
    assert all(n.language == "en" for t in terms for n in t.names)


def test_checksums_permissions_and_path_escape(tmp_path: Path) -> None:
    manifest = snapshot(tmp_path / "raw")
    source = manifest.sources[0]
    (tmp_path / "raw" / source.path).write_bytes(b"changed")
    with pytest.raises(ValueError, match="checksum"):
        read_sources(tmp_path / "raw")
    manifest = snapshot(tmp_path / "raw2")
    manifest.sources[0].provenance.rights.allows_derivative_processing = False
    (tmp_path / "raw2/sources.json").write_text(manifest.model_dump_json(by_alias=True))
    with pytest.raises(ValueError, match="permission"):
        read_sources(tmp_path / "raw2")
    manifest.sources[0].path = "../outside"
    (tmp_path / "raw2/sources.json").write_text(manifest.model_dump_json(by_alias=True))
    with pytest.raises(ValueError, match="escapes"):
        read_sources(tmp_path / "raw2")


def test_prepare_is_reproducible_with_definitions_and_unique_owners(tmp_path: Path) -> None:
    snapshot(tmp_path / "raw", russian=True)
    first = prepare_terminology(tmp_path / "raw", tmp_path / "a")
    second = prepare_terminology(tmp_path / "raw", tmp_path / "b")
    assert first == second
    assert first["conceptsWithRussianDefinitions"] == 1
    assert first["conceptsWithoutDefinition"] == 1
    for name in ["terms.jsonl", "terms.jsonl.gz", "core-discovery.jsonl", "size-report.json"]:
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes()
    terms, _, sections = read_terms(tmp_path / "a")
    assert sorted(i for s in sections for i in s.owned_term_ids) == [t.id for t in terms]
    f03 = next(s for s in sections if s.id == "F03")
    assert "minimed.terminology.mesh.c10" in f03.required_module_ids
    row = json.loads((tmp_path / "a/core-discovery.jsonl").read_text().splitlines()[0])
    assert row["definition"]["language"] == "ru"
    assert row["definition"]["text"].startswith("Синтетическое определение")
    with pytest.raises(ValueError, match="exists"):
        prepare_terminology(tmp_path / "raw", tmp_path / "a")


def test_prepared_manifest_and_term_evidence_are_validated(tmp_path: Path) -> None:
    snapshot(tmp_path / "raw")
    prepare_terminology(tmp_path / "raw", tmp_path / "out")
    (tmp_path / "out/sources.json").write_text("{}")
    with pytest.raises(ValueError):
        read_terms(tmp_path / "out")
    with pytest.raises(ValueError, match="identity"):
        MedicalTerm(
            id="mesh.M1",
            mesh_concept_id="M2",
            descriptor_ids=["D1"],
            preferred_for=[],
            names=[
                parse_mesh(tmp_path / "raw/mesh.xml.gz", read_sources(tmp_path / "raw").sources[0])[
                    0
                ].names[0]
            ],
            definitions=[],
            tree_numbers=[],
            semantic_types=[],
            relations=[],
        )


def test_collect_offline_is_read_only_and_network_opt_in(tmp_path: Path) -> None:
    original = snapshot(tmp_path / "raw")
    assert collect_terminology(tmp_path / "raw", tmp_path / "cache", offline=True) == original
    with pytest.raises(ValueError, match="require --network"):
        collect_terminology(tmp_path / "new", tmp_path / "cache")
    with pytest.raises(ValueError, match="Russian"):
        collect_terminology(tmp_path / "raw", tmp_path / "cache", offline=True, with_wikidata=True)
    result = CliRunner().invoke(
        app,
        [
            "collect",
            "--output",
            str(tmp_path / "raw"),
            "--cache",
            str(tmp_path / "cache"),
            "--offline",
        ],
    )
    assert result.exit_code == 0, result.output


def test_existing_sqlite_pack_build_with_core_definitions(tmp_path: Path) -> None:
    snapshot(tmp_path / "raw", russian=True)
    prepare_terminology(tmp_path / "raw", tmp_path / "prepared")
    report = build_terminology_packs(
        tmp_path / "prepared",
        tmp_path / "packs",
        version="2026.1.0",
        built_at="2026-01-01T00:00:00Z",
        sections=["F03"],
        for_redistribution=True,
    )
    assert report["runtimeChanged"] is False
    db_path = tmp_path / "packs/minimed.terminology.discovery.db"
    with sqlite3.connect(db_path) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        rows = db.execute(
            "SELECT document_id FROM chunks_fts WHERE chunks_fts MATCH ?", ('"Мюнхгаузена"',)
        ).fetchall()
        assert rows and all("M0000001" in row[0] for row in rows)
        assert db.execute(
            "SELECT count(*) FROM knowledge_facts WHERE review_status='reviewed'"
        ).fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM knowledge_facts").fetchone()[0] > 0
        assert (
            db.execute(
                "SELECT count(*) FROM chunks WHERE original_text LIKE '%Синтетическое определение%'"
            ).fetchone()[0]
            > 0
        )
    assert gzip.decompress(db_path.with_suffix(".db.gz").read_bytes()) == db_path.read_bytes()
    assert not (tmp_path / "packs/catalog.preview.json").exists()  # no premature publication
    # A rebuild at an independent path yields identical immutable database bytes.
    build_terminology_packs(
        tmp_path / "prepared",
        tmp_path / "repeat",
        version="2026.1.0",
        built_at="2026-01-01T00:00:00Z",
        sections=["F03"],
    )
    assert (
        hashlib.sha256(db_path.read_bytes()).digest()
        == hashlib.sha256((tmp_path / "repeat" / db_path.name).read_bytes()).digest()
    )


def test_permuted_term_ui_and_non_padded_tree_branches(tmp_path: Path) -> None:
    # Both constructs occur in the actual 2026 NLM snapshot (e.g. D000001 and D017798).
    xml = XML.replace(b"<TermUI>T000002</TermUI>", b"<TermUI>T000001</TermUI>")
    xml = xml.replace(b"F03.100", b"F03.100.2.150")
    source = add_source(tmp_path, "mesh.xml", xml)
    terms = parse_mesh(tmp_path / "mesh.xml", source)
    assert "Test shared name" in [name.text for name in terms[0].names]
    assert "F03.100.2.150" in terms[0].tree_numbers
    same_ui = [n for n in terms[0].names if n.external_id == "T000001"]
    assert len(same_ui) == 2 and same_ui[0].evidence.locator != same_ui[1].evidence.locator


def test_truncated_wikidata_never_creates_a_partial_prepared_output(tmp_path: Path) -> None:
    manifest = snapshot(tmp_path / "raw")
    source = add_source(tmp_path / "raw", "wd.json", b'{"results":{"bindings":[', "wikidata-ru")
    manifest.sources.append(source)
    (tmp_path / "raw/sources.json").write_text(manifest.model_dump_json(by_alias=True))
    with pytest.raises(ValueError):
        prepare_terminology(tmp_path / "raw", tmp_path / "out")
    assert not (tmp_path / "out").exists()


def test_redistribution_is_explicit_and_does_not_modify_runtime(tmp_path: Path) -> None:
    manifest = snapshot(tmp_path / "raw")
    manifest.sources[0].provenance.rights.allows_redistribution = False
    (tmp_path / "raw/sources.json").write_text(manifest.model_dump_json(by_alias=True))
    prepare_terminology(tmp_path / "raw", tmp_path / "prepared")
    with pytest.raises(ValueError, match="Redistribution"):
        build_terminology_packs(
            tmp_path / "prepared",
            tmp_path / "out",
            version="2026.1.0",
            built_at="2026-01-01T00:00:00Z",
            for_redistribution=True,
        )
    assert not (tmp_path / "out").exists()
