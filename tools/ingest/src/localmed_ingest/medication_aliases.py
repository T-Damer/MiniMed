"""Project source-listed trade names onto existing core INN pointers, without new documents."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import unicodedata
from contextlib import closing
from pathlib import Path

import yaml
from pydantic import ConfigDict, Field, TypeAdapter

from localmed_ingest.models import Alias, CamelModel


class MedicationMetadata(CamelModel):
    model_config = ConfigDict(extra="ignore")
    catalog_family: str | None = None
    target_document_id: str | None = None
    standardized_inn: str | None = None
    declared_aliases: list[str] = Field(default_factory=list)
    navigation_aliases: list[str] = Field(default_factory=list)
    linked_mnn_document_id: str | None = None


class GrlsRecord(CamelModel):
    model_config = ConfigDict(extra="ignore")
    registration_number: str
    trade_name: str
    inn: list[str]
    status: str


class GrlsLedger(CamelModel):
    model_config = ConfigDict(extra="ignore")
    records: list[GrlsRecord]


def _identity(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold().replace("ё", "е")
    return " ".join("".join(char if char.isalnum() else " " for char in value).split())


def _documents(path: Path) -> list[tuple[str, str, str | None, MedicationMetadata]]:
    with closing(sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)) as connection:
        rows = TypeAdapter(list[tuple[str, str, str | None, str]]).validate_python(
            connection.execute(
                "SELECT id, title, short_title, metadata_json FROM documents ORDER BY id"
            ).fetchall()
        )
        return [
            (document_id, title, short_title, MedicationMetadata.model_validate_json(metadata))
            for document_id, title, short_title, metadata in rows
        ]


def build_medication_aliases(core: Path, allmed: Path, grls: Path) -> dict[str, object]:
    pointers: dict[str, str] = {}
    inn_titles: dict[str, set[str]] = {}
    surfaces: set[str] = set()
    for _, title, short_title, metadata in _documents(core):
        if metadata.catalog_family != "medication" or not metadata.target_document_id:
            continue
        pointers[metadata.target_document_id] = title
        for value in (title, metadata.standardized_inn):
            if value:
                inn_titles.setdefault(_identity(value), set()).add(title)
        surfaces.update(
            _identity(value)
            for value in (
                title,
                short_title,
                metadata.standardized_inn,
                *metadata.declared_aliases,
                *metadata.navigation_aliases,
            )
            if value
        )
    if not pointers:
        raise ValueError("Core has no medication pointers.")
    with closing(sqlite3.connect(f"{core.resolve().as_uri()}?mode=ro", uri=True)) as connection:
        for canonical, name in connection.execute("SELECT canonical_term, alias FROM aliases"):
            if _identity(canonical) in inn_titles:
                surfaces.add(_identity(name))

    aliases: dict[tuple[str, str], Alias] = {}
    evidence: dict[str, list[dict[str, object]]] = {}
    unresolved: list[dict[str, object]] = []

    def propose(name: str, titles: set[str], source: dict[str, object]) -> None:
        if not name.strip() or name == "~" or _identity(name) in surfaces:
            return
        if not titles:
            unresolved.append({"name": name, "reason": "no-exact-INN-pointer", **source})
            return
        for title in sorted(titles):
            key = (_identity(name), _identity(title))
            digest = hashlib.sha256("|".join(key).encode()).hexdigest()[:20]
            alias_id = f"alias.core.medication.source.{digest}"
            aliases.setdefault(
                key,
                Alias(id=alias_id, alias=name, canonical_term=title, category="medication"),
            )
            evidence.setdefault(alias_id, []).append(source)

    for document_id, title, _, metadata in _documents(allmed):
        target = metadata.linked_mnn_document_id
        propose(
            title,
            {pointers[target]} if target is not None and target in pointers else set(),
            {"source": "allmed", "documentId": document_id, "linkedMnnDocumentId": target},
        )

    ledger = GrlsLedger.model_validate_json(grls.read_text(encoding="utf-8"))
    for index, record in enumerate(ledger.records):
        if record.status != "active":
            continue
        # A combination must match a combination pointer, never each ingredient separately.
        inn = " + ".join(record.inn)
        propose(
            record.trade_name.strip(),
            inn_titles.get(_identity(inn), set()),
            {
                "source": "grls",
                "recordIndex": index,
                "registrationNumber": record.registration_number,
                "tradeName": record.trade_name,
                "inn": record.inn,
            },
        )

    ordered = sorted(aliases.values(), key=lambda alias: alias.id)
    return {
        "sources": [{"path": str(path), "sha256": _sha256(path)} for path in (core, allmed, grls)],
        "aliasCount": len(ordered),
        "newSurfaceCount": len({_identity(alias.alias) for alias in ordered}),
        "aliases": [alias.model_dump(by_alias=True) for alias in ordered],
        "evidence": evidence,
        "unresolved": unresolved,
    }


def _sha256(path: Path) -> str:
    with path.open("rb") as source:
        return f"sha256:{hashlib.file_digest(source, 'sha256').hexdigest()}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("core", "allmed", "grls", "output", "report"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    inputs = {args.core.resolve(), args.allmed.resolve(), args.grls.resolve()}
    if args.output.resolve() in inputs or args.report.resolve() in inputs:
        raise ValueError("Outputs must differ from source files.")
    report = build_medication_aliases(args.core, args.allmed, args.grls)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        yaml.safe_dump({"aliases": report["aliases"]}, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({key: report[key] for key in ("aliasCount", "newSurfaceCount")}))


if __name__ == "__main__":
    main()
