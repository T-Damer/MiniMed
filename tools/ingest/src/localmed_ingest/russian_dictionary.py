"""Russian medical senses from the licensed Russian Wiktionary/Kaikki snapshot.

This is a lexical source, not clinical guidance. Only *sense-level* subject categories admit
entries. A medical sense never brings in unrelated senses, third-party example quotations,
translations, media, or a guessed MeSH equivalence.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
from collections import Counter
from collections.abc import Iterator
from pathlib import Path
from typing import Literal, cast
from urllib.parse import quote

import yaml
from pydantic import Field

from .models import CamelModel
from .source_sync import sync_source_manifest
from .terminology_prepare import json_bytes
from .terminology_sources import sha256_file

SOURCE_URL = "https://kaikki.org/dictionary/downloads/ru/ru-extract.jsonl.gz"
TERMS_URL = "https://kaikki.org/ruwiktionary/"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"
ATTRIBUTION = "Russian Wiktionary contributors; extraction by Wiktextract/Kaikki.org"
MAX_COMPRESSED_BYTES = 440_000_000
MAX_EXPANDED_BYTES = 6_000_000_000
MAX_LINE_BYTES = 4_000_000

# These are source lexicographic labels, not specialties inferred from a disease/drug name.
SUBJECTS = {
    "Медицинские термины": "medicine",
    "Анатомические термины": "anatomy",
    "Психологические термины": "psychology",
    "Психиатрические термины": "psychiatry",
    "Физиологические термины": "physiology",
    "Термины фармацевтики и фармакологии": "pharmacology",
}
SUBJECT_TITLES = {
    "medicine": "Медицинские термины",
    "anatomy": "Анатомия",
    "psychology": "Психология",
    "psychiatry": "Психиатрия",
    "physiology": "Физиология",
    "pharmacology": "Фармакология",
}


class RussianDictionarySource(CamelModel):
    schema_version: Literal[1] = 1
    url: Literal["https://kaikki.org/dictionary/downloads/ru/ru-extract.jsonl.gz"] = SOURCE_URL
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    bytes: int = Field(gt=0, le=MAX_COMPRESSED_BYTES)
    retrieved_at: str = Field(min_length=1)
    license: Literal["CC-BY-SA-4.0"] = "CC-BY-SA-4.0"
    source_project: Literal["ru.wiktionary.org"] = "ru.wiktionary.org"
    attribution: str = ATTRIBUTION
    terms_url: str = TERMS_URL


class RussianDictionarySense(CamelModel):
    id: str = Field(pattern=r"^ruwikt\.[a-f0-9]{24}$")
    word: str = Field(min_length=1, max_length=2000)
    part_of_speech: str = Field(min_length=1)
    glosses: list[str] = Field(min_length=1)
    subjects: list[str] = Field(min_length=1)
    categories: list[str]
    source_url: str
    source_line: int = Field(gt=0)
    sense_index: int = Field(ge=0)
    record_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    source_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")


def _strings(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ValueError(f"Expected string list: {label}")
    return cast(list[str], value)


def iter_medical_senses(
    path: Path, source: RussianDictionarySource
) -> Iterator[RussianDictionarySense]:
    """Stream to EOF (including gzip CRC), bounded, rejecting malformed or truncated input."""
    if path.stat().st_size != source.bytes or sha256_file(path) != f"sha256:{source.sha256}":
        raise ValueError("Russian dictionary source checksum/size mismatch")
    expanded = 0
    with gzip.open(path, "rb") as stream:
        line_number = 0
        while line := stream.readline(MAX_LINE_BYTES + 1):
            line_number += 1
            expanded += len(line)
            if len(line) > MAX_LINE_BYTES or expanded > MAX_EXPANDED_BYTES:
                raise ValueError("Russian dictionary expansion/line limit exceeded")
            record: object = json.loads(line)
            if not isinstance(record, dict):
                raise ValueError(f"Invalid dictionary record at line {line_number}")
            entry = cast(dict[str, object], record)
            if entry.get("lang_code") != "ru":
                continue
            senses = entry.get("senses", [])
            if not isinstance(senses, list):
                raise ValueError(f"Invalid dictionary senses at line {line_number}")
            for index, item in enumerate(senses):
                if not isinstance(item, dict):
                    raise ValueError(f"Invalid sense at line {line_number}")
                sense = cast(dict[str, object], item)
                categories = _strings(sense.get("categories", []), "sense categories")
                subjects = sorted(
                    {
                        SUBJECTS[c.removesuffix("/ru")]
                        for c in categories
                        if c.removesuffix("/ru") in SUBJECTS
                    }
                )
                if (
                    not subjects
                    or sense.get("form_of")
                    or "no-gloss" in _strings(sense.get("tags", []), "sense tags")
                ):
                    continue
                glosses = _strings(sense.get("glosses", []), "sense glosses")
                if not glosses or not all(g.strip() for g in glosses):
                    raise ValueError(f"Selected medical sense lacks a definition at {line_number}")
                word = entry.get("word")
                pos = entry.get("pos")
                if not isinstance(word, str) or not isinstance(pos, str):
                    raise ValueError(f"Missing dictionary word/POS at line {line_number}")
                # Content-addressed sense identity: ordering changes do not merge homonyms.
                identity = hashlib.sha256(json_bytes([word, pos, glosses])).hexdigest()[:24]
                yield RussianDictionarySense(
                    id=f"ruwikt.{identity}",
                    word=word,
                    part_of_speech=pos,
                    glosses=glosses,
                    subjects=subjects,
                    categories=categories,
                    source_url="https://ru.wiktionary.org/wiki/" + quote(word, safe=""),
                    source_line=line_number,
                    sense_index=index,
                    record_sha256="sha256:" + hashlib.sha256(line).hexdigest(),
                    source_sha256=f"sha256:{source.sha256}",
                )
    if sha256_file(path) != f"sha256:{source.sha256}":
        raise ValueError("Dictionary source changed while reading")


def collect_russian_dictionary(output: Path, cache: Path, *, network: bool = False) -> None:
    if not network:
        raise ValueError("Public source download requires --network")
    if output.exists():
        raise ValueError("Use a new immutable Russian source snapshot directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as name:
        root = Path(name)
        plan = root / "sync.yaml"
        plan.write_text(
            yaml.safe_dump(
                {
                    "version": 1,
                    "sources": [
                        {
                            "id": "ruwiktionary-kaikki",
                            "location": SOURCE_URL,
                            "target": "ru-extract.jsonl.gz",
                            "content_type": "binary",
                            "max_bytes": MAX_COMPRESSED_BYTES,
                        }
                    ],
                }
            )
        )
        snapshot = root / "source"
        report = sync_source_manifest(plan, snapshot, cache, timeout_seconds=120)
        path = snapshot / "ru-extract.jsonl.gz"
        source = RussianDictionarySource(
            sha256=sha256_file(path).removeprefix("sha256:"),
            bytes=path.stat().st_size,
            retrieved_at=report.generated_at,
        )
        (snapshot / "source.json").write_bytes(json_bytes(source.model_dump(by_alias=True)))
        snapshot.rename(output)


def prepare_russian_dictionary(source_root: Path, output: Path) -> dict[str, object]:
    if output.exists():
        raise ValueError("Use a new immutable prepared dictionary directory")
    source = RussianDictionarySource.model_validate_json((source_root / "source.json").read_text())
    records: dict[str, RussianDictionarySense] = {}
    for record in iter_medical_senses(source_root / "ru-extract.jsonl.gz", source):
        previous = records.get(record.id)
        if previous:
            previous.subjects = sorted(set(previous.subjects) | set(record.subjects))
        else:
            records[record.id] = record
    if not records:
        raise ValueError("No source-labelled Russian medical senses found")
    counts: Counter[str] = Counter()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as name:
        stage = Path(name) / "prepared"
        stage.mkdir()
        with (stage / "senses.jsonl").open("wb") as target:
            for record in sorted(records.values(), key=lambda r: r.id):
                counts.update(record.subjects)
                target.write(json_bytes(record.model_dump(by_alias=True)))
        report: dict[str, object] = {
            "schemaVersion": 1,
            "senses": len(records),
            "words": len({r.word for r in records.values()}),
            "russianDefinitionCount": sum(len(r.glosses) for r in records.values()),
            "subjects": dict(sorted(counts.items())),
            "license": source.license,
            "sourceSha256": f"sha256:{source.sha256}",
            "preparedSha256": sha256_file(stage / "senses.jsonl"),
            "authority": "community-lexical-reference",
            "clinicalApproval": False,
        }
        (stage / "source.json").write_bytes(json_bytes(source.model_dump(by_alias=True)))
        (stage / "report.json").write_bytes(json_bytes(report))
        stage.rename(output)
    return report
