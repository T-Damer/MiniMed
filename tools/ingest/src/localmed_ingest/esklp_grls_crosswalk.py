from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Literal, cast

from pydantic import Field

from .models import CamelModel

CrosswalkStatus = Literal["matched", "ambiguous"]

_SPACE_PATTERN = re.compile(r"\s+")
_TRADEMARK_PATTERN = re.compile(r"[®™℠]")
_DATABASE_SUFFIXES = {".db", ".sqlite", ".sqlite3"}


class EsklpPresentation(CamelModel):
    """One ESKLP MNN/SMNN/TN/presentation identity row."""

    mnn_document_id: str
    standardized_inn: str
    smnn_code: str
    registration_number: str
    trade_name: str | None = None
    dosage_form: str | None = None
    strength: str | None = None
    klp_codes: list[str] = Field(default_factory=list)
    source_pack: str


class EsklpRegistration(CamelModel):
    """All exact ESKLP presentations observed for one registration number."""

    registration_number: str
    status: CrosswalkStatus
    mnn_document_ids: list[str] = Field(default_factory=list)
    standardized_inns: list[str] = Field(default_factory=list)
    trade_names: list[str] = Field(default_factory=list)
    presentations: list[EsklpPresentation] = Field(default_factory=list)
    ambiguity_reasons: list[str] = Field(default_factory=list)

    @property
    def mnn_document_id(self) -> str | None:
        return (
            self.mnn_document_ids[0]
            if self.status == "matched" and len(self.mnn_document_ids) == 1
            else None
        )

    @property
    def standardized_inn(self) -> str | None:
        return (
            self.standardized_inns[0]
            if self.status == "matched" and len(self.standardized_inns) == 1
            else None
        )


class EsklpGrlsCrosswalk(CamelModel):
    """Read-only ESKLP index keyed by the exact registration number."""

    source_packs: list[str] = Field(default_factory=list)
    registrations: dict[str, EsklpRegistration] = Field(default_factory=dict)

    def resolve(
        self,
        registration_number: str,
        trade_name: str | None = None,
    ) -> EsklpRegistration | None:
        entry = self.registrations.get(_registration_key(registration_number))
        if entry is None or trade_name is None:
            return entry

        normalized_trade_name = _identity_key(trade_name)
        if normalized_trade_name in {_identity_key(value) for value in entry.trade_names}:
            return entry

        reason = (
            f"Торговое наименование ГРЛС {trade_name!r} отсутствует среди точных "
            f"ТН ЕСКЛП для {entry.registration_number}."
        )
        return entry.model_copy(
            update={
                "status": "ambiguous",
                "ambiguity_reasons": [*entry.ambiguity_reasons, reason],
            }
        )

    lookup = resolve


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = _SPACE_PATTERN.sub(" ", str(value).replace("\xa0", " ")).strip(" ;")
    return cleaned or None


def _identity_key(value: str) -> str:
    without_trademark = _TRADEMARK_PATTERN.sub("", value)
    return _SPACE_PATTERN.sub(" ", without_trademark.casefold().replace("ё", "е")).strip()


def _registration_key(value: str) -> str:
    """Canonicalize whitespace only; punctuation and letters stay exact."""
    return _clean(value) or ""


def _object_list(value: object | None) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [cast(dict[str, object], item) for item in value if isinstance(item, dict)]


def _metadata_record(
    document_id: object, metadata: object, source_pack: Path
) -> dict[str, object] | None:
    if not isinstance(document_id, str) or not document_id.strip():
        raise ValueError(f"ESKLP document in {source_pack} has an invalid id.")
    if not isinstance(metadata, dict):
        raise ValueError(f"ESKLP document {document_id} has non-object metadata_json.")
    record = cast(dict[str, object], metadata)
    if record.get("contentMode") != "esklp-mnn":
        return None
    if _clean(record.get("standardizedInn")) is None:
        raise ValueError(f"ESKLP document {document_id} lacks standardizedInn.")
    return {"documentId": document_id, **record, "sourcePack": str(source_pack)}


def _read_sqlite_records(path: Path) -> list[dict[str, object]]:
    uri = f"{path.resolve().as_uri()}?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as error:
        raise ValueError(f"ESKLP input is not a readable SQLite database: {path}") from error
    try:
        connection.execute("PRAGMA query_only = ON")
        tables = {
            str(row[0])
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        if "documents" not in tables:
            raise ValueError(f"ESKLP SQLite pack lacks the documents table: {path}")
        columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(documents)")}
        missing = {"id", "metadata_json"} - columns
        if missing:
            raise ValueError(f"ESKLP SQLite pack lacks documents columns {sorted(missing)}: {path}")
        # The pack builder already validates SQLite integrity. This index only reads the small
        # document metadata table, so it does not rescan the large FTS/chunk tables.
        records: list[dict[str, object]] = []
        for document_id, metadata_json in connection.execute(
            "SELECT id, metadata_json FROM documents ORDER BY id"
        ):
            try:
                metadata = json.loads(str(metadata_json))
            except (TypeError, json.JSONDecodeError) as error:
                raise ValueError(
                    f"ESKLP document {document_id} has invalid metadata_json: {path}"
                ) from error
            record = _metadata_record(document_id, metadata, path)
            if record is not None:
                records.append(record)
        return records
    except sqlite3.Error as error:
        raise ValueError(f"Unable to read ESKLP SQLite pack {path}: {error}") from error
    finally:
        connection.close()


def _read_catalog_records(path: Path) -> list[dict[str, object]]:
    try:
        payload: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"ESKLP catalog is not valid JSON: {path}") from error
    raw_records: object = payload.get("records") if isinstance(payload, dict) else payload
    if not isinstance(raw_records, list):
        raise ValueError(f"ESKLP catalog must contain a records list: {path}")
    records: list[dict[str, object]] = []
    for raw_record in raw_records:
        if not isinstance(raw_record, dict):
            raise ValueError(f"ESKLP catalog contains a non-object record: {path}")
        record = cast(dict[str, object], raw_record)
        record_kind = record.get("recordKind", record.get("record_kind"))
        if record_kind not in (None, "esklp-mnn"):
            continue
        document_id = record.get("documentId", record.get("document_id", record.get("recordId")))
        metadata = dict(record)
        metadata["contentMode"] = "esklp-mnn"
        normalized = _metadata_record(document_id, metadata, path)
        if normalized is not None:
            records.append(normalized)
    return records


def _input_paths(paths: Sequence[Path]) -> list[Path]:
    if not paths:
        raise ValueError("At least one ESKLP SQLite pack or catalog is required.")
    expanded: list[Path] = []
    for path in paths:
        if not path.exists():
            raise ValueError(f"ESKLP input does not exist: {path}")
        if path.is_dir():
            expanded.extend(
                candidate
                for candidate in sorted(path.rglob("*"))
                if candidate.is_file() and candidate.suffix.lower() in _DATABASE_SUFFIXES
            )
            continue
        expanded.append(path)
    unique: dict[str, Path] = {str(path.resolve()): path.resolve() for path in expanded}
    if not unique:
        raise ValueError("ESKLP input directory contains no SQLite pack or JSON catalog.")
    return [unique[key] for key in sorted(unique)]


def _read_inputs(paths: Sequence[Path]) -> tuple[list[dict[str, object]], list[str]]:
    records: list[dict[str, object]] = []
    source_packs: list[str] = []
    for path in _input_paths(paths):
        source_packs.append(str(path))
        if path.suffix.lower() in _DATABASE_SUFFIXES:
            records.extend(_read_sqlite_records(path))
        else:
            records.extend(_read_catalog_records(path))
    return records, source_packs


def _presentation_key(presentation: EsklpPresentation) -> tuple[str, ...]:
    return (
        presentation.mnn_document_id,
        _identity_key(presentation.standardized_inn),
        presentation.smnn_code,
        _registration_key(presentation.registration_number),
        _identity_key(presentation.trade_name or ""),
        _identity_key(presentation.dosage_form or ""),
        _identity_key(presentation.strength or ""),
    )


def _add_presentation(
    by_registration: dict[str, dict[tuple[str, ...], EsklpPresentation]],
    presentation: EsklpPresentation,
) -> None:
    registration_key = _registration_key(presentation.registration_number)
    if not registration_key:
        return
    presentations = by_registration.setdefault(registration_key, {})
    key = _presentation_key(presentation)
    current = presentations.get(key)
    if current is None:
        presentations[key] = presentation
        return
    current.klp_codes = sorted(set(current.klp_codes) | set(presentation.klp_codes))


def _document_presentations(
    record: Mapping[str, object],
) -> list[EsklpPresentation]:
    document_id = _clean(record.get("documentId"))
    document_inn = _clean(record.get("standardizedInn"))
    source_pack = _clean(record.get("sourcePack"))
    if document_id is None or document_inn is None or source_pack is None:
        raise ValueError("ESKLP MNN record requires documentId, standardizedInn, and sourcePack.")
    result: dict[tuple[str, ...], EsklpPresentation] = {}
    for raw_node in _object_list(record.get("smnnNodes")):
        smnn_code = _clean(raw_node.get("smnnCode"))
        node_inn = _clean(raw_node.get("standardizedInn")) or document_inn
        if smnn_code is None:
            raise ValueError(
                f"ESKLP document {document_id} contains an SMNN node without smnnCode."
            )
        node_form = _clean(raw_node.get("dosageForm"))
        node_strength = _clean(raw_node.get("strength"))
        trades = _object_list(raw_node.get("tradeNames"))
        klps = _object_list(raw_node.get("klpPositions"))

        for raw_trade in trades:
            registration = _clean(raw_trade.get("registrationNumber"))
            if registration is None:
                continue
            presentation = EsklpPresentation(
                mnn_document_id=document_id,
                standardized_inn=node_inn,
                smnn_code=smnn_code,
                registration_number=registration,
                trade_name=_clean(raw_trade.get("tradeName")),
                dosage_form=_clean(raw_trade.get("dosageForm")) or node_form,
                strength=_clean(raw_trade.get("strength")) or node_strength,
                source_pack=source_pack,
            )
            result[_presentation_key(presentation)] = presentation

        for raw_klp in klps:
            registration = _clean(raw_klp.get("registrationNumber"))
            if registration is None:
                continue
            trade_name = _clean(raw_klp.get("tradeName"))
            if trade_name is None:
                matching_names = {
                    _clean(raw_trade.get("tradeName"))
                    for raw_trade in trades
                    if _clean(raw_trade.get("registrationNumber")) == registration
                    and _clean(raw_trade.get("tradeName")) is not None
                }
                if len(matching_names) == 1:
                    trade_name = next(iter(matching_names))
            presentation = EsklpPresentation(
                mnn_document_id=document_id,
                standardized_inn=node_inn,
                smnn_code=smnn_code,
                registration_number=registration,
                trade_name=trade_name,
                dosage_form=_clean(raw_klp.get("dosageForm")) or node_form,
                strength=_clean(raw_klp.get("strength")) or node_strength,
                klp_codes=[klp_code]
                if (klp_code := _clean(raw_klp.get("klpCode"))) is not None
                else [],
                source_pack=source_pack,
            )
            key = _presentation_key(presentation)
            current = result.get(key)
            if current is None:
                result[key] = presentation
            else:
                current.klp_codes = sorted(set(current.klp_codes) | set(presentation.klp_codes))
    return list(result.values())


def build_esklp_grls_crosswalk(esklp_packs: Sequence[Path]) -> EsklpGrlsCrosswalk:
    """Build an exact-registration ESKLP index without mutating any input pack."""
    records, source_packs = _read_inputs(esklp_packs)
    by_registration: dict[str, dict[tuple[str, ...], EsklpPresentation]] = {}
    for record in records:
        for presentation in _document_presentations(record):
            _add_presentation(by_registration, presentation)

    registrations: dict[str, EsklpRegistration] = {}
    for registration_key, presentation_map in sorted(by_registration.items()):
        presentations = sorted(
            presentation_map.values(),
            key=lambda item: (
                item.mnn_document_id,
                _identity_key(item.standardized_inn),
                item.smnn_code,
                _registration_key(item.registration_number),
                _identity_key(item.trade_name or ""),
                _identity_key(item.dosage_form or ""),
                _identity_key(item.strength or ""),
            ),
        )
        mnn_document_ids = sorted({item.mnn_document_id for item in presentations})
        standardized_inns_by_key: dict[str, str] = {}
        for item in presentations:
            standardized_inns_by_key.setdefault(
                _identity_key(item.standardized_inn), item.standardized_inn
            )
        standardized_inns = [
            standardized_inns_by_key[key] for key in sorted(standardized_inns_by_key)
        ]
        trade_names_by_key: dict[str, str] = {}
        for item in presentations:
            if item.trade_name:
                trade_names_by_key.setdefault(_identity_key(item.trade_name), item.trade_name)
        reasons: list[str] = []
        if len(standardized_inns) > 1:
            reasons.append(
                "Один registrationNumber связан с разными стандартизированными МНН: "
                + ", ".join(standardized_inns)
                + "."
            )
        if len(mnn_document_ids) > 1:
            reasons.append(
                "Один registrationNumber связан с разными документами МНН: "
                + ", ".join(mnn_document_ids)
                + "."
            )
        registrations[registration_key] = EsklpRegistration(
            registration_number=presentations[0].registration_number,
            status="ambiguous" if reasons else "matched",
            mnn_document_ids=mnn_document_ids,
            standardized_inns=standardized_inns,
            trade_names=[trade_names_by_key[key] for key in sorted(trade_names_by_key)],
            presentations=presentations,
            ambiguity_reasons=reasons,
        )
    return EsklpGrlsCrosswalk(source_packs=source_packs, registrations=registrations)


build_esklp_crosswalk = build_esklp_grls_crosswalk
