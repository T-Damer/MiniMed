from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from datetime import date
from pathlib import Path
from typing import Literal, cast
from zipfile import BadZipFile, ZipFile

from pydantic import BaseModel, Field

from .catalog_module_builder import CamelModel, LedgerModule
from .esklp_xlsx import read_esklp_xlsx
from .medication_catalog import (  # pyright: ignore[reportPrivateUsage]
    _assign_modules,  # pyright: ignore[reportPrivateUsage]
    load_medication_taxonomy,
)

ESKLP_SOURCE_URL = "https://esklp.egisz.rosminzdrav.ru/esklp"

_ARCHIVE_DATE = re.compile(r"(?<!\d)(\d{8})(?!\d)")
_SMNN_MEMBER = re.compile(r"esklp_smnn_[^/]+\.xlsx\Z", re.IGNORECASE)
_TRADE_MEMBER = re.compile(r"tn_smnn_[^/]+\.xlsx\Z", re.IGNORECASE)
_KLP_MEMBER = re.compile(r"esklp_klp_[^/]+_[^/]+\.xlsx\Z", re.IGNORECASE)
_KEY_RE = re.compile(r"[^0-9a-zа-я]+", re.IGNORECASE)
_SEPARATORS = re.compile(r"[;|\n]+")


def _key(value: object) -> str:
    return _KEY_RE.sub("", str(value).replace("ё", "е").casefold())


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()
    return cleaned or None


def _text_values(value: object | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set, frozenset)):
        values: list[str] = []
        items = cast(Iterable[object], value)
        if isinstance(value, (set, frozenset)):
            items = sorted(cast(Iterable[object], value), key=_key)
        for item in items:
            values.extend(_text_values(item))
        return values
    cleaned = _clean(value)
    if cleaned is None:
        return []
    return [part.strip() for part in _SEPARATORS.split(cleaned) if part.strip()]


def _unique(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = _clean(value)
        if cleaned is None:
            continue
        identity = _key(cleaned)
        if identity in seen:
            continue
        seen.add(identity)
        result.append(cleaned)
    return result


def _row_mapping(row: object) -> dict[str, object]:
    if isinstance(row, Mapping):
        mapping = cast(Mapping[str, object], row)
        return {str(key): value for key, value in mapping.items()}
    if isinstance(row, BaseModel):
        return cast(dict[str, object], row.model_dump(mode="python"))
    try:
        return cast(dict[str, object], vars(row))
    except TypeError as error:
        raise ValueError("ESKLP row parser returned an unsupported row model.") from error


def _value(row: Mapping[str, object], *names: str) -> object | None:
    values = {_key(name): value for name, value in row.items()}
    for name in names:
        candidate = values.get(_key(name))
        if candidate not in (None, ""):
            return candidate
    return None


def _required_text(row: Mapping[str, object], label: str, *names: str) -> str:
    value = _clean(_value(row, *names))
    if value is None:
        raise ValueError(f"ESKLP row requires {label}.")
    return value


def _boolean(value: object | None) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    normalized = _key(value) if value is not None else ""
    if normalized in {"да", "yes", "true", "1"}:
        return True
    if normalized in {"нет", "no", "false", "0"}:
        return False
    return None


def _number(value: object | None) -> int | float | str | None:
    if isinstance(value, bool) or value is None:
        return None if value is None else int(value)
    if isinstance(value, (int, float)):
        return value
    cleaned = _clean(value)
    if cleaned is None:
        return None
    normalized = cleaned.replace(" ", "").replace(",", ".")
    try:
        parsed = float(normalized)
    except ValueError:
        return cleaned
    return int(parsed) if parsed.is_integer() else parsed


def _strength(value: object | None, unit: object | None) -> str | None:
    strength = _clean(value)
    strength_unit = _clean(unit)
    if strength is None:
        return None
    if strength_unit is None:
        return strength
    normalized_strength = re.sub(r"\s+", "", strength).casefold()
    normalized_unit = re.sub(r"\s+", "", strength_unit).casefold()
    return strength if normalized_strength.endswith(normalized_unit) else strength + strength_unit


def _package_name(value: object | None) -> str | None:
    return _clean(value)


def _smnn_rows_for_parser(rows: list[list[str]]) -> list[list[str]]:
    normalized = _rows_for_parser(
        rows,
        header_row=3,
        last_column=36,
        merged_unit_column=5,
    )
    if (
        len(normalized) > 1
        and len(normalized[0]) > 5
        and len(normalized[1]) > 5
        and _clean(normalized[0][5]) is None
        and _clean(normalized[1][5]) == "Единица измерения"
    ):
        if normalized is rows:
            normalized = list(rows)
            normalized[0] = list(rows[0])
        normalized[0][5] = "Единица измерения дозировки"
        return normalized
    return normalized


def _rows_for_parser(
    rows: list[list[str]],
    *,
    header_row: int,
    last_column: int,
    merged_unit_column: int | None = None,
) -> list[list[str]]:
    normalized = _numbered_rows_for_parser(rows, header_row=header_row, last_column=last_column)
    if (
        merged_unit_column is None
        or len(normalized) <= 1
        or len(normalized[0]) <= merged_unit_column
        or len(normalized[1]) <= merged_unit_column
        or _clean(normalized[0][merged_unit_column]) is not None
        or _clean(normalized[1][merged_unit_column]) != "Единица измерения"
    ):
        return normalized
    if normalized is rows:
        normalized = list(rows)
        normalized[0] = list(rows[0])
    normalized[0][merged_unit_column] = "Единица измерения дозировки"
    return normalized


def _numbered_rows_for_parser(
    rows: list[list[str]], *, header_row: int, last_column: int
) -> list[list[str]]:
    if len(rows) <= header_row:
        return rows
    replacements: dict[int, str] = {}
    for column in (0, last_column):
        if column >= len(rows[header_row]):
            continue
        value = _clean(rows[header_row][column])
        if value is not None and re.fullmatch(r"[0-9]+\.0", value):
            replacements[column] = value[:-2]
    if not replacements:
        return rows
    normalized = list(rows)
    normalized[header_row] = list(rows[header_row])
    for column, value in replacements.items():
        normalized[header_row][column] = value
    return normalized


def _trade_rows_for_parser(rows: list[list[str]]) -> list[list[str]]:
    normalized = _rows_for_parser(
        rows,
        header_row=3,
        last_column=11,
        merged_unit_column=6,
    )
    needs_unit_header = (
        len(normalized) > 0
        and len(normalized[0]) > 9
        and _clean(normalized[0][9]) == "Наименование единицы измерения лекарственного препарата"
    )
    needs_subheader = (
        len(normalized) > 2
        and len(normalized[2]) > 7
        and _clean(normalized[2][6]) == "Наименование"
        and _clean(normalized[2][7]) == "Код ОКЕИ"
    )
    if not needs_unit_header and not needs_subheader:
        return normalized
    if normalized is rows:
        normalized = list(rows)
        normalized[0] = list(rows[0])
    if needs_unit_header:
        normalized[0][9] = "Единица измерения лекарственного препарата"
    if needs_subheader:
        normalized[2][7] = "Наименование"
    return normalized


def _klp_rows_for_parser(rows: list[list[str]]) -> list[list[str]]:
    normalized = _numbered_rows_for_parser(rows, header_row=4, last_column=30)
    if (
        len(normalized) <= 2
        or len(normalized[1]) <= 13
        or len(normalized[2]) <= 13
        or _clean(normalized[1][10]) is not None
        or _clean(normalized[2][10]) != "Кол-во лекарственной формы"
    ):
        return normalized
    normalized = list(normalized)
    normalized[1] = list(normalized[1])
    normalized[2] = list(normalized[2])
    for column in range(10, 14):
        normalized[1][column] = normalized[2][column]
    normalized[2][12] = "Наименование"
    return normalized


def _diagnostics(value: object | None) -> list[str]:
    return _unique(_text_values(value))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _utc_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _filename_edition(name: str) -> str | None:
    for match in _ARCHIVE_DATE.finditer(name):
        try:
            return date.fromisoformat(
                f"{match.group(1)[:4]}-{match.group(1)[4:6]}-{match.group(1)[6:]}"
            ).isoformat()
        except ValueError:
            continue
    return None


class EsKlpTradeName(CamelModel):
    trade_name: str
    registration_number: str | None = None
    dosage_form: str | None = None
    strength: str | None = None
    unit: str | None = None
    normalized_inns: list[str] = Field(default_factory=list)
    normalized_forms_strengths: list[str] = Field(default_factory=list)


class EsKlpPosition(CamelModel):
    klp_code: str
    trade_name: str | None = None
    registration_number: str | None = None
    dosage_form: str | None = None
    strength: str | None = None
    unit: str | None = None
    unit_count: int | float | str | None = None
    primary_package: str | None = None
    secondary_package: str | None = None
    package_contents: str | None = None
    holder: str | None = None
    manufacturer: str | None = None
    essential_drug: bool | None = None
    controlled_substance: bool | None = None
    validity_period: str | None = None
    changed_at: str | None = None
    price: str | None = None
    diagnostics: list[str] = Field(default_factory=list)


class EsKlpSmnnNode(CamelModel):
    smnn_code: str
    standardized_inn: str
    okpd2_code: str | None = None
    dosage_form: str | None = None
    strength: str | None = None
    pharmacotherapeutic_group: str | None = None
    atc_code: str | None = None
    essential_drug: bool | None = None
    controlled_substance: bool | None = None
    validity_period: str | None = None
    changed_at: str | None = None
    reference_prices: list[str] = Field(default_factory=list)
    normalized_inns: list[str] = Field(default_factory=list)
    normalized_forms_strengths: list[str] = Field(default_factory=list)
    klp_codes: list[str] = Field(default_factory=list)
    diagnostics: list[str] = Field(default_factory=list)
    trade_names: list[EsKlpTradeName] = Field(default_factory=list[EsKlpTradeName])
    klp_positions: list[EsKlpPosition] = Field(default_factory=list[EsKlpPosition])


class EsKlpCoverageRecord(CamelModel):
    record_kind: Literal["esklp-mnn"] = "esklp-mnn"
    record_id: str
    standardized_inn: str
    inn: list[str]
    component_inns: list[str] = Field(default_factory=list)
    atc_codes: list[str] = Field(default_factory=list)
    dosage_forms: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    smnn_nodes: list[EsKlpSmnnNode]
    source_edition: str
    source_url: str
    official_url: str
    source_archive: str
    status: Literal["active"] = "active"
    coverage_state: Literal["metadata-only"] = "metadata-only"
    rights: Literal["unknown"] = "unknown"
    module_ids: list[str]
    primary_module_id: str


class EsKlpCoverageSummary(CamelModel):
    total_records: int
    coverage_counts: dict[str, int]
    status_counts: dict[str, int]
    module_counts: dict[str, int]


class EsKlpCoverageLedger(CamelModel):
    schema_version: int = 1
    generated_at: str
    source_checksum: str
    taxonomy_checksum: str
    source_edition: str
    records: list[EsKlpCoverageRecord]
    modules: list[LedgerModule]
    summary: EsKlpCoverageSummary
    warnings: list[str] = Field(default_factory=list)


def _member_names(names: Sequence[str], pattern: re.Pattern[str], label: str) -> list[str]:
    matches = [name for name in names if pattern.fullmatch(name)]
    if not matches:
        raise ValueError(f"ESKLP archive is missing required {label} workbook.")
    if len(matches) != len(set(matches)) or (label != "KLP" and len(matches) != 1):
        raise ValueError(f"ESKLP archive contains duplicate {label} workbook members.")
    return sorted(matches)


def _read_members(archive: Path) -> tuple[str, str, list[str], dict[str, bytes]]:
    try:
        with ZipFile(archive, "r") as outer:
            names = outer.namelist()
            smnn = _member_names(names, _SMNN_MEMBER, "SMNN")[0]
            trade = _member_names(names, _TRADE_MEMBER, "trade")[0]
            klp = _member_names(names, _KLP_MEMBER, "KLP")
            expected = [smnn, trade, *klp]
            payloads = {name: outer.read(name) for name in expected}
    except (BadZipFile, EOFError, OSError, RuntimeError, KeyError) as error:
        raise ValueError("Invalid ESKLP outer ZIP archive.") from error
    return smnn, trade, klp, payloads


def _trade_name(row: Mapping[str, object]) -> EsKlpTradeName:
    return EsKlpTradeName(
        trade_name=_required_text(row, "trade name", "trade_name", "tradeName"),
        registration_number=_clean(
            _value(row, "registration_number", "registrationNumber", "registration")
        ),
        dosage_form=_clean(_value(row, "dosage_form", "dosageForm")),
        strength=_strength(
            _value(row, "strength", "dosage"),
            _value(row, "strength_unit", "strengthUnit", "dosage_unit"),
        ),
        unit=_clean(_value(row, "unit", "drug_unit", "drugUnit")),
        normalized_inns=_unique(
            _text_values(_value(row, "normalized_inns", "normalizedInns", "normalized_inn"))
        ),
        normalized_forms_strengths=_unique(
            _text_values(
                _value(
                    row,
                    "normalized_forms_strengths",
                    "normalizedFormsStrengths",
                    "normalized_form_strength",
                )
            )
        ),
    )


def _klp_position(row: Mapping[str, object]) -> EsKlpPosition:
    return EsKlpPosition(
        klp_code=_required_text(row, "KLP code", "klp_code", "klpCode"),
        trade_name=_clean(_value(row, "trade_name", "tradeName")),
        registration_number=_clean(
            _value(row, "registration_number", "registrationNumber", "registration")
        ),
        dosage_form=_clean(_value(row, "dosage_form", "dosageForm")),
        strength=_clean(_value(row, "strength", "dosage")),
        unit=_clean(_value(row, "unit", "drug_unit", "drugUnit")),
        unit_count=_number(_value(row, "unit_count", "unitCount")),
        primary_package=_package_name(_value(row, "primary_package", "primaryPackage")),
        secondary_package=_package_name(_value(row, "secondary_package", "secondaryPackage")),
        package_contents=_clean(_value(row, "package_contents", "packageContents")),
        holder=_clean(_value(row, "holder", "registration_holder", "registrationHolder")),
        manufacturer=_clean(_value(row, "manufacturer")),
        essential_drug=_boolean(_value(row, "essential_drug", "essentialDrug")),
        controlled_substance=_boolean(_value(row, "controlled_substance", "controlledSubstance")),
        validity_period=_clean(_value(row, "validity_period", "validityPeriod")),
        changed_at=_clean(_value(row, "changed_at", "changedAt")),
        price=_clean(_value(row, "price")),
        diagnostics=_diagnostics(_value(row, "diagnostics")),
    )


def _smnn_node(row: Mapping[str, object]) -> EsKlpSmnnNode:
    atc_codes = _text_values(_value(row, "atc_codes", "atcCodes", "atc_code", "atcCode", "atc"))
    return EsKlpSmnnNode(
        smnn_code=_required_text(row, "SMNN code", "smnn_code", "smnnCode"),
        standardized_inn=_required_text(
            row,
            "standardized MNN",
            "standardized_inn",
            "standardizedInn",
            "standardized_mnn",
        ),
        okpd2_code=_clean(_value(row, "okpd2_code", "okpd2Code")),
        dosage_form=_clean(_value(row, "dosage_form", "dosageForm")),
        strength=_strength(
            _value(row, "strength", "dosage"),
            _value(row, "strength_unit", "strengthUnit", "dosage_unit", "unit"),
        ),
        pharmacotherapeutic_group=_clean(
            _value(
                row,
                "pharmacotherapeutic_group",
                "pharmacotherapeuticGroup",
                "therapeutic_group",
            )
        ),
        atc_code=atc_codes[0] if atc_codes else None,
        essential_drug=_boolean(_value(row, "essential_drug", "essentialDrug")),
        controlled_substance=_boolean(
            _value(row, "controlled_substance", "controlledSubstance", "controlled")
        ),
        validity_period=_clean(_value(row, "validity_period", "validityPeriod")),
        changed_at=_clean(_value(row, "changed_at", "changedAt")),
        reference_prices=_unique(_text_values(_value(row, "reference_prices", "referencePrices"))),
        normalized_inns=_unique(_text_values(_value(row, "normalized_inns", "normalizedInns"))),
        normalized_forms_strengths=_unique(
            _text_values(_value(row, "normalized_forms_strengths", "normalizedFormsStrengths"))
        ),
        klp_codes=_unique(_text_values(_value(row, "klp_codes", "klpCodes"))),
        diagnostics=_diagnostics(_value(row, "diagnostics")),
    )


def _record_id(standardized_inn: str) -> str:
    safe = re.sub(r"[^0-9A-Za-zА-Яа-я._-]+", "-", standardized_inn.casefold()).strip("-.")
    return f"esklp.mnn.{safe or 'unknown'}"


def _components(standardized_inn: str) -> list[str]:
    if "+" not in standardized_inn:
        return []
    return _unique(part.strip() for part in standardized_inn.split("+") if part.strip())


def _sort_trade(value: EsKlpTradeName) -> tuple[str, str, str, str]:
    return (
        _key(value.trade_name),
        _key(value.registration_number or ""),
        _key(value.dosage_form or ""),
        _key(value.strength or ""),
    )


def _sort_klp(value: EsKlpPosition) -> tuple[str, str, str]:
    return (
        _key(value.klp_code),
        _key(value.trade_name or ""),
        _key(value.registration_number or ""),
    )


def _sort_node(value: EsKlpSmnnNode) -> tuple[str, str]:
    return (_key(value.smnn_code), _key(value.standardized_inn))


def _edition_consistency(names: Iterable[str], editions: Iterable[str | None]) -> str:
    parsed = list(editions)
    if any(edition is None for edition in parsed):
        raise ValueError("Every ESKLP workbook must declare a source edition.")
    declared = {cast(str, edition) for edition in parsed}
    if len(declared) != 1:
        raise ValueError("ESKLP workbook editions do not match: " + ", ".join(sorted(declared)))
    edition = next(iter(declared))
    for name in names:
        filename_edition = _filename_edition(Path(name).name)
        if filename_edition is not None and filename_edition != edition:
            raise ValueError(
                f"ESKLP workbook filename edition does not match {name}: {filename_edition}."
            )
    return edition


def build_esklp_coverage_ledger(
    archive: Path,
    taxonomy: Path,
    *,
    generated_at: str | None = None,
) -> EsKlpCoverageLedger:
    smnn_member, trade_member, klp_members, payloads = _read_members(archive)
    smnn_rows_raw, smnn_edition = read_esklp_xlsx(payloads[smnn_member])
    trade_rows_raw, trade_edition = read_esklp_xlsx(payloads[trade_member])
    from .esklp_rows import parse_klp_rows, parse_smnn_rows, parse_trade_rows

    smnn_rows: Sequence[object] = parse_smnn_rows(_smnn_rows_for_parser(smnn_rows_raw))
    trade_rows: Sequence[object] = parse_trade_rows(_trade_rows_for_parser(trade_rows_raw))

    nodes_by_code: dict[str, EsKlpSmnnNode] = {}
    grouped_nodes: dict[str, list[EsKlpSmnnNode]] = defaultdict(list)
    for row in smnn_rows:
        node = _smnn_node(_row_mapping(row))
        code_key = _key(node.smnn_code)
        if code_key in nodes_by_code:
            raise ValueError(f"Duplicate SMNN code: {node.smnn_code}")
        nodes_by_code[code_key] = node
        grouped_nodes[_key(node.standardized_inn)].append(node)

    warnings: list[str] = []
    for row in trade_rows:
        row_mapping = _row_mapping(row)
        trade = _trade_name(row_mapping)
        smnn_code = _clean(_value(row_mapping, "smnn_code", "smnnCode"))
        node = nodes_by_code.get(_key(smnn_code)) if smnn_code else None
        if node is None:
            warnings.append(
                "orphan trade reference: "
                + (f"smnnCode={smnn_code}" if smnn_code else "missing smnnCode")
            )
            continue
        node.trade_names.append(trade)

    klp_codes: set[str] = set()
    klp_editions: list[str | None] = []
    for member in klp_members:
        rows, edition = read_esklp_xlsx(payloads[member])
        klp_editions.append(edition)
        for row in cast(
            Sequence[object],
            parse_klp_rows(_klp_rows_for_parser(rows)),
        ):
            row_mapping = _row_mapping(row)
            position = _klp_position(row_mapping)
            code_key = _key(position.klp_code)
            if code_key in klp_codes:
                raise ValueError(f"Duplicate KLP code: {position.klp_code}")
            klp_codes.add(code_key)
            smnn_code = _clean(_value(row_mapping, "smnn_code", "smnnCode"))
            node = nodes_by_code.get(_key(smnn_code)) if smnn_code else None
            if node is None:
                warnings.append(
                    "orphan KLP reference: "
                    + (f"smnnCode={smnn_code}" if smnn_code else "missing smnnCode")
                )
                continue
            node.klp_positions.append(position)
            node.klp_codes.append(position.klp_code)

    source_edition = _edition_consistency(
        [smnn_member, trade_member, *klp_members, archive.name],
        [smnn_edition, trade_edition, *klp_editions],
    )
    for node in nodes_by_code.values():
        node.klp_codes = _unique(node.klp_codes)

    taxonomy_model = load_medication_taxonomy(taxonomy)
    records: list[EsKlpCoverageRecord] = []
    for nodes in grouped_nodes.values():
        nodes.sort(key=_sort_node)
        standardized_inn = nodes[0].standardized_inn
        inns = _unique(
            [
                standardized_inn,
                *(inn for node in nodes for inn in node.normalized_inns),
                *(
                    inn
                    for node in nodes
                    for trade in node.trade_names
                    for inn in trade.normalized_inns
                ),
            ]
        )
        dosage_forms = _unique(
            [
                *(node.dosage_form or "" for node in nodes),
                *(trade.dosage_form or "" for node in nodes for trade in node.trade_names),
                *(position.dosage_form or "" for node in nodes for position in node.klp_positions),
            ]
        )
        strengths = _unique(
            [
                *(node.strength or "" for node in nodes),
                *(trade.strength or "" for node in nodes for trade in node.trade_names),
                *(position.strength or "" for node in nodes for position in node.klp_positions),
            ]
        )
        atc_codes = _unique(node.atc_code or "" for node in nodes)
        matching_rules, primary_rule = _assign_modules(
            taxonomy_model,
            trade_name=standardized_inn,
            inn=inns,
            atc_codes=atc_codes,
        )
        for node in nodes:
            node.trade_names.sort(key=_sort_trade)
            node.klp_positions.sort(key=_sort_klp)
        records.append(
            EsKlpCoverageRecord(
                record_id=_record_id(standardized_inn),
                standardized_inn=standardized_inn,
                inn=inns,
                component_inns=_components(standardized_inn),
                atc_codes=atc_codes,
                dosage_forms=dosage_forms,
                strengths=strengths,
                smnn_nodes=nodes,
                source_edition=source_edition,
                source_url=ESKLP_SOURCE_URL,
                official_url=ESKLP_SOURCE_URL,
                source_archive=archive.name,
                module_ids=[module.id for module in matching_rules],
                primary_module_id=primary_rule.id,
            )
        )

    records.sort(key=lambda record: (record.primary_module_id, _key(record.standardized_inn)))
    by_module: dict[str, list[EsKlpCoverageRecord]] = defaultdict(list)
    for record in records:
        for module_id in record.module_ids:
            by_module[module_id].append(record)

    modules: list[LedgerModule] = []
    for rule in sorted(taxonomy_model.modules, key=lambda item: (-item.priority, item.id)):
        members = by_module.get(rule.id, [])
        if not members:
            continue
        modules.append(
            LedgerModule(
                module_id=rule.id,
                title=rule.title,
                record_ids=[record.record_id for record in members],
                coverage_counts={"metadata-only": len(members)},
            )
        )

    warnings.sort()
    return EsKlpCoverageLedger(
        generated_at=generated_at or _utc_now(),
        source_checksum=_sha256_file(archive),
        taxonomy_checksum=_sha256_file(taxonomy),
        source_edition=source_edition,
        records=records,
        modules=modules,
        summary=EsKlpCoverageSummary(
            total_records=len(records),
            coverage_counts={"metadata-only": len(records)},
            status_counts={"active": len(records)},
            module_counts={module.module_id: len(module.record_ids) for module in modules},
        ),
        warnings=warnings,
    )


def write_esklp_coverage_ledger(
    ledger: EsKlpCoverageLedger,
    output: Path,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    # ponytail: full 2026-08-28 JSON ledger is ~619 MiB and peaked around 2.3 GiB RSS.
    # Replace with direct workspace/pack streaming if refresh memory becomes a problem.
    output.write_text(
        json.dumps(ledger.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
