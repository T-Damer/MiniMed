from __future__ import annotations

import re

from pydantic import Field

from .models import CamelModel

_SPACE_PATTERN = re.compile(r"\s+")
_SPLIT_PATTERN = re.compile(r"[;,|\n]+")
_CONTROLLED_HEADER = (
    "Наличие в лекарственном препарате наркотических средств, психотропных веществ и их прекурсоров"
)


class SmnnSourceRow(CamelModel):
    smnn_code: str
    standardized_inn: str
    dosage_form: str | None = None
    strength: str | None = None
    unit: str | None = None
    product_unit: str | None = None
    pharmacotherapeutic_group: str | None = None
    atc: str | None = None
    essential_drug: bool | None = None
    controlled: bool | None = None
    validity_period: str | None = None
    changed_at: str | None = None
    normalized_inns: list[str] = Field(default_factory=list)
    normalized_forms_strengths: list[str] = Field(default_factory=list)
    diagnostics: list[str] = Field(default_factory=list)

    @property
    def form(self) -> str | None:
        return self.dosage_form

    @property
    def ftg(self) -> str | None:
        return self.pharmacotherapeutic_group

    @property
    def jnvlp(self) -> bool | None:
        return self.essential_drug

    @property
    def validity(self) -> str | None:
        return self.validity_period

    @property
    def changed(self) -> str | None:
        return self.changed_at


class TradeSourceRow(CamelModel):
    trade_name: str
    registration_number: str
    smnn_code: str
    standardized_inn: str
    dosage_form: str | None = None
    strength: str | None = None
    unit: str | None = None
    normalized_inns: list[str] = Field(default_factory=list)
    normalized_forms_strengths: list[str] = Field(default_factory=list)

    @property
    def form(self) -> str | None:
        return self.dosage_form


class KlpSourceRow(CamelModel):
    smnn_code: str
    standardized_inn: str
    klp_code: str
    trade_name: str | None = None
    registration_number: str | None = None
    dosage_form: str | None = None
    strength: str | None = None
    unit: str | None = None
    unit_count: str | None = None
    primary_package: str | None = None
    secondary_package: str | None = None
    package_contents: str | None = None
    holder: str | None = None
    manufacturer: str | None = None
    essential_drug: bool | None = None
    validity_period: str | None = None
    price: str | None = None
    diagnostics: list[str] = Field(default_factory=list)

    @property
    def form(self) -> str | None:
        return self.dosage_form

    @property
    def jnvlp(self) -> bool | None:
        return self.essential_drug

    @property
    def validity(self) -> str | None:
        return self.validity_period


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = _SPACE_PATTERN.sub(" ", value.replace("\xa0", " ")).strip()
    return cleaned or None


def _split(value: str | None) -> list[str]:
    cleaned = _clean(value)
    if cleaned is None:
        return []
    result: list[str] = []
    seen: set[str] = set()
    for part in _SPLIT_PATTERN.split(cleaned):
        item = _clean(part)
        if item is None or item.casefold() in seen:
            continue
        seen.add(item.casefold())
        result.append(item)
    return result


def _bool(value: str | None, *, source: str, row_number: int, field: str) -> bool | None:
    cleaned = _clean(value)
    if cleaned is None:
        return None
    normalized = cleaned.casefold()
    if normalized in {"да", "true", "1"}:
        return True
    if normalized in {"нет", "false", "0"}:
        return False
    raise ValueError(
        f"{source} row {row_number} has invalid {field} value: {cleaned!r}. Expected Да or Нет."
    )


def _cell(row: list[str], column: int) -> str:
    return row[column] if column < len(row) else ""


def _required(row: list[str], column: int, *, source: str, row_number: int, field: str) -> str:
    value = _clean(_cell(row, column))
    if value is None:
        raise ValueError(f"{source} row {row_number} is missing required {field}.")
    return value


def _combine(first: str | None, second: str | None) -> str | None:
    values = [value for value in (_clean(first), _clean(second)) if value is not None]
    return " ".join(values) or None


def _blank(row: list[str]) -> bool:
    return all(_clean(value) is None for value in row)


def _validate_layout(
    rows: list[list[str]],
    *,
    source: str,
    data_start: int,
    markers: dict[tuple[int, int], str],
) -> None:
    if len(rows) < data_start:
        raise ValueError(
            f"{source} layout drift: expected {data_start} header rows, received {len(rows)}."
        )
    for (row_number, column), expected in markers.items():
        actual = _clean(_cell(rows[row_number], column))
        if actual != expected:
            raise ValueError(
                f"{source} layout drift at row {row_number}, column {column}: "
                f"expected {expected!r}, received {actual!r}."
            )


_SMNN_MARKERS = {
    (0, 0): "Стандартизованное МНН",
    (0, 1): "Код узла СМНН",
    (0, 3): "Стандартизованная лекарственная форма",
    (0, 4): "Стандартизованная дозировка",
    (0, 5): "Единица измерения дозировки",
    (0, 9): "Единица измерения лекарственного препарата",
    (0, 12): "Наименование ФТГ",
    (0, 13): "АТХ",
    (0, 15): "ЖНВЛП",
    (
        0,
        16,
    ): _CONTROLLED_HEADER,
    (0, 17): "Период действия узла СМНН",
    (0, 19): "Дата изменения записи",
    (0, 33): "Список нормализованных МНН для узла СМНН",
    (0, 34): "Список нормализованных лекарственных форм и дозировок для узла СМНН",
    (0, 35): "КЛП",
    (0, 36): "Некорректные данные",
    (1, 4): "Кол-во",
    (1, 5): "Единица измерения",
    (2, 9): "Наименование",
    (3, 0): "1",
    (3, 36): "37",
}

_TRADE_MARKERS = {
    (0, 0): "Торговое наименование",
    (0, 1): "Номер регистрационного удостоверения",
    (0, 2): "Код узла СМНН",
    (0, 3): "Стандартизованное МНН",
    (0, 4): "Стандартизованная лекарственная форма",
    (0, 5): "Стандартизованная дозировка",
    (0, 6): "Единица измерения дозировки",
    (0, 9): "Единица измерения лекарственного препарата",
    (0, 10): "Список нормализованных МНН",
    (0, 11): "Список нормализованных лекарственных форм и дозировок",
    (1, 5): "Кол-во",
    (1, 6): "Единица измерения",
    (2, 7): "Наименование",
    (3, 0): "1",
    (3, 11): "12",
}

_KLP_MARKERS = {
    (0, 0): "Узел СМНН",
    (0, 3): "Код КЛП",
    (0, 4): "Торговое наименование",
    (0, 5): "Нормализованное МНН",
    (0, 6): "Нормализованная лекарственная форма",
    (0, 7): "Нормализованная дозировка",
    (0, 8): "Наименование единицы измерения лекарственного препарата",
    (0, 9): "Кол-во ЕИ ЛП во вторичной (потребительской) упаковке",
    (0, 10): "Первичная упаковка",
    (0, 12): "Вторичная (потребительская) упаковка",
    (0, 14): "Комплектность вторичной (потребительской) упаковки",
    (0, 15): "Регистрационное удостоверение",
    (0, 20): "Производитель",
    (0, 24): "ЖНВЛП",
    (
        0,
        25,
    ): _CONTROLLED_HEADER,
    (0, 26): "Период действия КЛП",
    (0, 28): "Дата изменения записи",
    (0, 29): "Предельная отпускная цена на позицию КЛП",
    (0, 30): "Некорректные данные",
    (1, 0): "Код узла СМНН",
    (1, 10): "Кол-во лекарственной формы",
    (1, 11): "Наименование",
    (1, 12): "Кол-во первичных упаковок",
    (1, 13): "Наименование",
    (1, 15): "Номер",
    (1, 16): "Владелец регистрационного удостоверения",
    (2, 11): "Наименование",
    (4, 0): "1",
    (4, 30): "31",
}


def parse_smnn_rows(rows: list[list[str]]) -> list[SmnnSourceRow]:
    _validate_layout(rows, source="SMNN", data_start=4, markers=_SMNN_MARKERS)
    parsed: list[SmnnSourceRow] = []
    for row_number, row in enumerate(rows[4:], 4):
        if _blank(row):
            continue
        parsed.append(
            SmnnSourceRow(
                standardized_inn=_required(
                    row, 0, source="SMNN", row_number=row_number, field="standardizedInn"
                ),
                smnn_code=_required(row, 1, source="SMNN", row_number=row_number, field="smnnCode"),
                dosage_form=_clean(_cell(row, 3)),
                strength=_clean(_cell(row, 4)),
                unit=_clean(_cell(row, 5)),
                product_unit=_clean(_cell(row, 9)),
                pharmacotherapeutic_group=_clean(_cell(row, 12)),
                atc=_clean(_cell(row, 13)),
                essential_drug=_bool(
                    _cell(row, 15), source="SMNN", row_number=row_number, field="JNVLP"
                ),
                controlled=_bool(
                    _cell(row, 16), source="SMNN", row_number=row_number, field="controlled"
                ),
                validity_period=_clean(_cell(row, 17)),
                changed_at=_clean(_cell(row, 19)),
                normalized_inns=_split(_cell(row, 33)),
                normalized_forms_strengths=_split(_cell(row, 34)),
                diagnostics=_split(_cell(row, 36)),
            )
        )
    return parsed


def parse_trade_rows(rows: list[list[str]]) -> list[TradeSourceRow]:
    _validate_layout(rows, source="TN", data_start=4, markers=_TRADE_MARKERS)
    parsed: list[TradeSourceRow] = []
    for row_number, row in enumerate(rows[4:], 4):
        if _blank(row):
            continue
        parsed.append(
            TradeSourceRow(
                trade_name=_required(row, 0, source="TN", row_number=row_number, field="tradeName"),
                registration_number=_required(
                    row,
                    1,
                    source="TN",
                    row_number=row_number,
                    field="registrationNumber",
                ),
                smnn_code=_required(row, 2, source="TN", row_number=row_number, field="smnnCode"),
                standardized_inn=_required(
                    row, 3, source="TN", row_number=row_number, field="standardizedInn"
                ),
                dosage_form=_clean(_cell(row, 4)),
                strength=_combine(_cell(row, 5), _cell(row, 6)),
                unit=_clean(_cell(row, 9)),
                normalized_inns=_split(_cell(row, 10)),
                normalized_forms_strengths=_split(_cell(row, 11)),
            )
        )
    return parsed


def parse_klp_rows(rows: list[list[str]]) -> list[KlpSourceRow]:
    _validate_layout(rows, source="KLP", data_start=5, markers=_KLP_MARKERS)
    parsed: list[KlpSourceRow] = []
    for row_number, row in enumerate(rows[5:], 5):
        if _blank(row):
            continue
        parsed.append(
            KlpSourceRow(
                smnn_code=_required(row, 0, source="KLP", row_number=row_number, field="smnnCode"),
                standardized_inn=_required(
                    row, 1, source="KLP", row_number=row_number, field="standardizedInn"
                ),
                klp_code=_required(row, 3, source="KLP", row_number=row_number, field="klpCode"),
                trade_name=_clean(_cell(row, 4)),
                registration_number=_clean(_cell(row, 15)),
                dosage_form=_clean(_cell(row, 6)),
                strength=_clean(_cell(row, 7)),
                unit=_clean(_cell(row, 8)),
                unit_count=_clean(_cell(row, 9)),
                primary_package=_combine(_cell(row, 10), _cell(row, 11)),
                secondary_package=_combine(_cell(row, 12), _cell(row, 13)),
                package_contents=_clean(_cell(row, 14)),
                holder=_clean(_cell(row, 16)),
                manufacturer=_clean(_cell(row, 20)),
                essential_drug=_bool(
                    _cell(row, 24), source="KLP", row_number=row_number, field="JNVLP"
                ),
                validity_period=_clean(_cell(row, 26)),
                price=_clean(_cell(row, 29)),
                diagnostics=_split(_cell(row, 30)),
            )
        )
    return parsed
