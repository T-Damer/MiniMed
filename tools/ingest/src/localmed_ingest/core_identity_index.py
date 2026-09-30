"""Project exact source-local names into a DEV core, without adding clinical FTS rows."""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast

from localmed_ingest.definition_reference_pack import normalized_name
from localmed_ingest.edition_manifest import sha256_file
from localmed_ingest.sqlite_builder import repository_root

MIGRATION = 11


def _object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    return cast(dict[str, object], value)


def _list(value: object) -> list[object]:
    if not isinstance(value, list):
        raise ValueError("Expected a JSON array")
    return cast(list[object], value)


def _text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Expected a non-empty identity string")
    return value


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _download_index(module: dict[str, object]) -> dict[str, object] | None:
    if module.get("releaseState") not in ("published", "preview", "bundled"):
        return None
    artifacts = [_object(a) for a in _list(module.get("artifacts", []))]
    indexes = [a for a in artifacts if a.get("kind") == "index"]
    if len(indexes) != 1 or not module.get("sourceSetDigest"):
        return None
    index = indexes[0]
    if (
        not index.get("required")
        or not index.get("url")
        or not index.get("sha256")
        or index.get("sourceSetDigest") != module["sourceSetDigest"]
        or any(not a.get("url") or not a.get("sha256") for a in artifacts if a.get("required"))
        or (
            index.get("compression") != "none"
            and (not index.get("decodedSha256") or not index.get("decodedSizeBytes"))
        )
    ):
        return None
    return index


def _documents(module: dict[str, object]) -> list[dict[str, object]]:
    if "documentTable" not in module:
        return [_object(d) for d in _list(module.get("documents", []))]
    if "documents" in module:
        raise ValueError("Catalog cannot contain both documents and documentTable")
    table = _object(module["documentTable"])
    documents: list[dict[str, object]] = []
    for raw in _list(table["rows"]):
        row = _list(raw)
        if len(row) not in (4, 5):
            raise ValueError("Invalid compact catalog membership row")
        identity, version = _text(row[0]), _text(row[1])
        documents.append(
            {
                "documentId": identity,
                "documentVersionId": identity + version if version.startswith("@") else version,
                "sourceChecksum": "sha256:" + _text(row[2]),
                "indexArtifactId": table["indexArtifactId"],
                **(_object(row[4]) if len(row) == 5 else {}),
            }
        )
    return documents


@contextmanager
def _source_database(path: Path) -> Iterator[sqlite3.Connection]:
    if not path.is_file():
        raise ValueError(f"Identity source does not exist: {path}")
    with TemporaryDirectory(prefix="core-identity-") as directory:
        source = path
        if path.suffix == ".gz":
            source = Path(directory) / "source.db"
            with gzip.open(path, "rb") as compressed, source.open("wb") as decoded:
                shutil.copyfileobj(compressed, decoded)
        with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as db:
            yield db


def _insert_target(
    db: sqlite3.Connection,
    title: str,
    kind: str,
    coverage: str,
    target: dict[str, object],
    names: list[str],
) -> None:
    target_id = _text(target.get("entityId", target.get("documentId")))
    module_id = _text(target["moduleId"])
    db.execute(
        "INSERT INTO core_identity_targets VALUES (?, ?, ?, ?, ?, ?)",
        (target_id, module_id, title, kind, coverage, _json(target)),
    )
    db.executemany(
        "INSERT OR IGNORE INTO core_identities VALUES (?, ?, ?, ?)",
        [
            (normalized_name(name), name, target_id, module_id)
            for name in names
            if normalized_name(name)
        ],
    )


def build_core_identity_index(
    core: Path,
    catalog: Path,
    definitions: Path | None,
    document_sources: list[Path],
) -> dict[str, object]:
    if not core.is_file():
        raise ValueError("Core database must already exist")
    inputs = ([definitions] if definitions else []) + document_sources
    if any(path.resolve() == core.resolve() for path in inputs):
        raise ValueError("Core cannot also be an identity source")
    modules = [_object(m) for m in _list(_object(json.loads(catalog.read_text()))["modules"])]
    available = [(module, index) for module in modules if (index := _download_index(module))]
    input_checksum = sha256_file(core)
    skipped_documents = 0
    with closing(sqlite3.connect(core)) as output:
        output.execute("PRAGMA foreign_keys = ON")
        output.executescript(
            "BEGIN IMMEDIATE;\n"
            + (repository_root() / "schema/sql/011_core_identities.sql").read_text()
        )
        output.execute("DELETE FROM core_identities")
        output.execute("DELETE FROM core_identity_targets")
        if definitions:
            with _source_database(definitions) as source:
                row = source.execute(
                    "SELECT value FROM app_metadata WHERE key='definition_reference'"
                ).fetchone()
                if not row:
                    raise ValueError("Definition source lacks a reference manifest")
                manifest = _object(json.loads(str(row[0])))
                edition_id = _text(manifest["editionId"])
                matches = [
                    (m, a)
                    for m, a in available
                    if _object(m.get("definitionReference", {})).get("editionId") == edition_id
                ]
                if len(matches) != 1:
                    raise ValueError("Definition edition has no unique downloadable catalog target")
                module, artifact = matches[0]
                source_path = Path(str(source.execute("PRAGMA database_list").fetchone()[2]))
                expected = artifact.get("decodedSha256", artifact.get("sha256"))
                if sha256_file(source_path) != expected:
                    raise ValueError("Definition source does not match the catalog index checksum")
                entities = source.execute(
                    """
                    SELECT id, canonical_name, entity_type, json_extract(metadata_json,'$.coverage')
                    FROM knowledge_entities
                    WHERE json_extract(metadata_json,'$.definitionReference')=1
                      AND json_extract(metadata_json,'$.editionId')=? ORDER BY id
                """,
                    (edition_id,),
                ).fetchall()
                if len(entities) != _object(module["definitionReference"])["entries"]:
                    raise ValueError("Definition entity inventory differs from catalog capability")
                names_by_id: dict[str, list[str]] = {}
                for entity_id, name in source.execute(
                    "SELECT entity_id, name FROM knowledge_names ORDER BY entity_id, name"
                ):
                    names_by_id.setdefault(str(entity_id), []).append(str(name))
                for entity_id, title, kind, coverage in entities:
                    _insert_target(
                        output,
                        str(title),
                        str(kind),
                        _text(coverage),
                        {
                            "type": "definition",
                            "entityId": str(entity_id),
                            "editionId": edition_id,
                            "moduleId": module["id"],
                            "moduleVersion": module["version"],
                        },
                        [str(title), *names_by_id.get(str(entity_id), [])],
                    )
        membership: dict[tuple[str, str, str], list[dict[str, object]]] = {}
        for module, artifact in available:
            for document in _documents(module):
                if document["indexArtifactId"] != artifact["id"]:
                    continue
                key = tuple(
                    _text(document[k])
                    for k in ("documentId", "documentVersionId", "sourceChecksum")
                )
                membership.setdefault(cast(tuple[str, str, str], key), []).append(module)
        seen: set[tuple[str, str]] = set()
        for path in document_sources:
            with _source_database(path) as source:
                rows = source.execute("""
                    SELECT d.id,d.title,d.short_title,d.source_type,d.metadata_json,
                           v.id,v.source_checksum
                    FROM documents d JOIN document_versions v ON v.id=d.current_version_id
                    WHERE v.document_id=d.id ORDER BY d.id
                """).fetchall()
                for doc_id, title, short_title, kind, raw_metadata, version_id, checksum in rows:
                    candidates = membership.get((str(doc_id), str(version_id), str(checksum)), [])
                    anchor = source.execute(
                        """
                        SELECT anchor FROM chunks WHERE document_version_id=?
                          AND length(trim(original_text))>0 ORDER BY order_index,id LIMIT 1
                    """,
                        (version_id,),
                    ).fetchone()
                    if not candidates or not anchor or not anchor[0]:
                        skipped_documents += 1
                        continue
                    metadata = _object(json.loads(str(raw_metadata)))
                    names = [str(title), *([str(short_title)] if short_title else [])]
                    for key in ("navigationAliases",):
                        names.extend(_text(name) for name in _list(metadata.get(key, [])))
                    for module in candidates:
                        key = (str(doc_id), _text(module["id"]))
                        if key in seen:
                            continue
                        seen.add(key)
                        _insert_target(
                            output,
                            str(title),
                            str(kind),
                            "source-document",
                            {
                                "type": "document",
                                "documentId": str(doc_id),
                                "documentVersionId": str(version_id),
                                "sourceChecksum": str(checksum),
                                "anchor": str(anchor[0]),
                                "moduleId": module["id"],
                                "moduleVersion": module["version"],
                            },
                            names,
                        )
        timestamp = output.execute(
            "SELECT installed_at FROM content_packs ORDER BY id LIMIT 1"
        ).fetchone()
        output.execute(
            "INSERT OR REPLACE INTO schema_migrations VALUES (?, ?)",
            (MIGRATION, str(timestamp[0]) if timestamp else "core-identity-index"),
        )
        counts = {
            "identities": output.execute("SELECT count(*) FROM core_identities").fetchone()[0],
            "targets": output.execute("SELECT count(*) FROM core_identity_targets").fetchone()[0],
        }
        if output.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("Identity index has foreign-key violations")
        output.commit()
    return {
        "migration": MIGRATION,
        "inputChecksum": input_checksum,
        "outputChecksum": sha256_file(core),
        **counts,
        "skippedDocuments": skipped_documents,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--core", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--definitions", type=Path)
    parser.add_argument("--document-source", type=Path, action="append", default=[])
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = build_core_identity_index(
        args.core, args.catalog, args.definitions, args.document_source
    )
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
