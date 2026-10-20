"""Prepare the herbal book («Травник») chapters: one per plant plus the ГФ XV infusion rules.

Inputs, all deterministic:

* ``content/herbal/plants.yaml`` — the plant list (ГРЛС names, EMA page, plate);
* ГРЛС: the registry catalog and the prepared instruction texts (``grls-full-final``). One
  representative instruction per plant is chosen (active registration, the plain raw material, a
  text-layer PDF before OCR, loose herb before filter bags, the newest edition); its sections are
  copied verbatim, each paragraph with its PDF pages and blocks;
* EMA/WHO: the reviewed extraction ``content/herbal/ema|who/<plant>.yaml`` (Russian fields with the
  exact English quote, re-checked against the PDF page here); the English text itself is not copied;
* safety: ``content/herbal/safety/<plant>.yaml`` (NCCIH, LactMed, LiverTox, TR CU 021/2011);
* the plate's licence record and a small thumbnail (the full plates are a separate image module);
* ГФ XV ОФС.1.4.1.0018 «Настои и отвары» from the article page.

Preparation numbers for the «Как заварить» cells are parsed from the ГРЛС «Способ применения и
дозы» text and keep the sentence they were read from.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import re
import shutil
import tempfile
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path
from typing import Any, cast

import pymupdf
import yaml

from .herbal_conflicts import (
    TOPIC_LABELS,
    PlantConflicts,
    load_conflicts,
    validate_conflicts,
)
from .herbal_ema import (
    EmaExtraction,
    ema_documents,
    load_extraction,
    validate_ema_extraction,
    validate_who_extraction,
    who_documents,
)
from .herbal_lookalikes import (
    ManualQuote,
    PlantLookalikes,
    check_lookalikes,
    load_lookalikes,
    manual_paths,
)
from .herbal_plants import (
    PLATE_AUTHORS,
    PLATE_BOOKS,
    RED_BOOK_CATEGORIES,
    Plant,
    load_plants,
)
from .herbal_regions import PLANTARIUM, PlantRegions, RegionalRedBooks, load_regional_red_books
from .herbal_safety import (
    TRTS_SECTIONS,
    PlantSafety,
    lactmed_path,
    livertox_path,
    livertox_score,
    load_safety,
    markup_text,
    nccih_path,
    validate_safety,
)
from .herbal_sources import NCCIH_BASE, TRTS_URL

PACK_ID = "minimed.herbal.book"
DOCUMENT_PREFIX = "herbal."
SOURCE_TYPE = "herbal_monograph"
RIGHTS_STATUS = "official-and-attributed-sources"
RIGHTS_BASIS = (
    "ГРЛС: official instructions approved by the Ministry of Health of Russia; EMA/HMPC: "
    "«Reproduction is authorised provided the source is acknowledged»; WHO monographs: attributed "
    "(personal project); botanical plates: public domain (Wikimedia Commons licence checked at "
    "fetch time) or supplied by the owner; ГФ XV and the Red Book list: official publications"
)
PUBLICATION_DECISION = {
    "decidedAt": "2026-10-20",
    "decidedBy": "project owner",
    "basis": (
        "Herbal book (ГРЛС raw material, EMA/HMPC and WHO monographs, NCCIH, LactMed, LiverTox, "
        "ТР ТС 021/2011, public-domain plates) published as a downloadable module for "
        "self-education after a line-by-line review of the Russian fields against their English "
        "quotes (2026-10-20); the English quote stays on tap"
    ),
}
ACTIVE_STATUSES = frozenset(
    {
        "Действующий",
        "Выдано по правилам ЕАЭС",
        "Изменённый",
        "Действует, на подтверждении государственной регистрации",
    }
)
# A product named after a tincture, extract, oil or brand is not the plain raw material.
_NOT_RAW = re.compile(r"®|настойк|экстракт|масл|сбор|сироп|капл|таблет|сок\b", re.IGNORECASE)
_LOOSE_FORM = re.compile(
    r"измельч|цельн|сырь|^\s*(?:цветки|листья|трава|корни|кора|плоды|семена)\s*$"
)
THUMBNAIL_WIDTH = 240
PLATE_MAX_WIDTH = 1200
_YEAR = re.compile(r"(\d{4})\s*$")
_MARKER = re.compile(r"^<!--\s*localmed:source\s+(\{.*\})\s*-->$")


class HerbalSourceError(ValueError):
    pass


# ---------------------------------------------------------------------------------------------
# ГРЛС: representative instruction
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class GrlsChoice:
    registration_number: str
    trade_name: str
    holder: str
    source_id: str
    instruction_label: str
    ocr: bool
    markdown: Path
    alternatives: int


def _label_year(label: str) -> int:
    match = _YEAR.search(label)
    return int(match.group(1)) if match else 0


def instruction_candidates(
    plant: Plant,
    records: Sequence[dict[str, object]],
    manifest: dict[str, list[dict[str, object]]],
    instructions_roots: Sequence[Path],
) -> list[GrlsChoice]:
    """Prepared national instructions of the plant's plain raw material, best first."""
    if plant.grls is None:
        return []
    names = set(plant.grls.inn)
    ranked: list[tuple[tuple[int, int, int, str], GrlsChoice]] = []
    registrations = 0
    for record in records:
        inn = str(record.get("inn") or "").lower().strip()
        trade = str(record.get("tradeName") or "")
        if inn not in names or record.get("status") not in ACTIVE_STATUSES:
            continue
        if _NOT_RAW.search(trade):
            continue
        registrations += 1
        number = str(record["registrationNumber"])
        for document in manifest.get(number, []):
            if document.get("extraction") != "prepared":
                continue
            if document.get("documentKind") != "national-instruction":
                continue
            source_id = str(document["sourceId"])
            path = next(
                (
                    root / f"{source_id}.md"
                    for root in instructions_roots
                    if (root / f"{source_id}.md").is_file()
                ),
                None,
            )
            if path is None:
                continue
            label = str(document.get("instructionLabel") or "")
            ocr = bool(document.get("ocr"))
            key = (
                int(ocr),
                0 if _LOOSE_FORM.search(_dosage_form(path).lower()) else 1,
                -_label_year(label),
                source_id,
            )
            choice = GrlsChoice(
                registration_number=number,
                trade_name=trade,
                holder=str(record.get("holder") or ""),
                source_id=source_id,
                instruction_label=label,
                ocr=ocr,
                markdown=path,
                alternatives=0,
            )
            ranked.append((key, choice))
    ranked.sort(key=lambda item: item[0])
    return [replace(choice, alternatives=registrations - 1) for _, choice in ranked]


def _dosage_form(path: Path) -> str:
    metadata = _front_matter(path).get("metadata")
    if not isinstance(metadata, dict):
        return ""
    return str(cast("dict[str, object]", metadata).get("dosageForm") or "")


def _front_matter(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    end = text.find("\n---\n", 4)
    if not text.startswith("---\n") or end < 0:
        raise HerbalSourceError(f"{path}: no front matter")
    return cast("dict[str, object]", yaml.safe_load(text[4:end]))


# ---------------------------------------------------------------------------------------------
# ГРЛС: paragraphs and sections
# ---------------------------------------------------------------------------------------------


@dataclass
class Paragraph:
    text: str
    pages: list[int] = field(default_factory=lambda: list[int]())
    blocks: list[str] = field(default_factory=lambda: list[str]())


# Order matters: longer phrases first. Keys outside SECTION_LAYOUT are read but not shown.
_HEADINGS: tuple[tuple[str, str], ...] = (
    ("registration", r"Регистрационн\w* номер"),
    ("trade-name", r"Торгов\w* наименовани\w*"),
    ("inn", r"Международн\w* непатентованн\w*(?: или группировочн\w*)? наименовани\w*"),
    ("form", r"Лекарственн\w* форм\w*"),
    ("composition", r"Состав"),
    ("characteristics", r"Характеристик\w*"),
    ("description", r"Описание"),
    ("group", r"Фармакотерапевтическ\w* групп\w*"),
    ("action", r"Фармакологическ\w* (?:действи\w*|свойств\w*)"),
    ("action", r"Фармакодинамик\w*"),
    ("action", r"Фармакокинетик\w*"),
    ("indications", r"Показани\w* (?:к|для) применени\w*"),
    ("contraindications", r"Противопоказани\w*(?: к применению)?"),
    ("caution", r"С осторожностью"),
    (
        "pregnancy",
        r"(?:Применени\w* (?:при|в период|во время) беременност\w*|Беременность и период"
        r" (?:лактации|грудного вскармливания))[^.:]{0,80}",
    ),
    ("dosage", r"Способ применени\w*(?:,? и доз\w*)?|Режим дозировани\w*"),
    ("adverse", r"Побочн\w* (?:действи\w*|эффект\w*)"),
    ("overdose", r"Передозировк\w*"),
    (
        "interactions",
        r"Взаимодействи\w* с други\w* лекарственн\w* (?:средств\w*|препарат\w*)[^.:]{0,40}"
        r"|Лекарственн\w* взаимодействи\w*",
    ),
    ("special", r"Особ\w* указани\w*"),
    ("driving", r"Влияни\w* на способность (?:к )?управл\w*[^.:]{0,160}"),
    ("release-form", r"Форм\w* выпуска"),
    ("storage", r"Услови\w* хранени\w*"),
    ("shelf-life", r"Срок\w* годности"),
    ("dispensing", r"Услови\w* отпуска(?: из аптек)?"),
    (
        "holder",
        r"(?:Держатель|Владелец) регистрационн\w* удостоверени\w*.*|Производител\w*.*"
        r"|Организаци\w*,? принимающ\w*.*|Наименование,? адрес.*",
    ),
)
_HEADING_PATTERNS = tuple(
    (key, re.compile(rf"^(?:#+\s*)?(?:\d{{1,2}}\.\s*)?({pattern})\s*[.:]?\s*$", re.IGNORECASE))
    for key, pattern in _HEADINGS
)
_INLINE_HEADING_PATTERNS = tuple(
    (key, re.compile(rf"^(?:#+\s*)?(?:\d{{1,2}}\.\s*)?({pattern})\s*[.:]\s+(\S.*)$", re.IGNORECASE))
    for key, pattern in _HEADINGS
    if key != "holder"
)
# Pack-insert layouts run a section into the previous one inside one text block
# («… после еды. Побочное действие. Возможны …»): split at a sentence end followed by a heading.
_RUN_IN_HEADING = re.compile(
    r"(?<=[.!?])\s+(?=(?:"
    + "|".join(pattern for key, pattern in _HEADINGS if key != "holder")
    + r")\s*[.:]\s)"
)
_SENTENCE_END = re.compile(r"[.!?]\)?\s*$")
_BULLET = re.compile(r"^[–—•·-]\s")
_HYPHEN_BREAK = re.compile(r"[а-яёa-z]-$")


def _heading(text: str) -> str | None:
    for key, pattern in _HEADING_PATTERNS:
        if pattern.match(text):
            return key
    return None


def read_blocks(path: Path) -> list[tuple[str, int | None, str | None]]:
    """(text, page, block id) of every source block after the front matter."""
    body = path.read_text(encoding="utf-8").split("\n---\n", 1)[1]
    blocks: list[tuple[str, int | None, str | None]] = []
    page: int | None = None
    block: str | None = None
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        marker = _MARKER.match(stripped)
        if marker:
            payload = cast("dict[str, object]", json.loads(marker.group(1)))
            page_value = payload.get("page")
            page = page_value if isinstance(page_value, int) else None
            block_value = payload.get("block")
            block = block_value if isinstance(block_value, str) else None
            continue
        if stripped.startswith("<!--"):
            continue
        blocks.append((stripped, page, block))
        block = None
    return blocks


def instruction_sections(path: Path) -> dict[str, list[Paragraph]]:
    """Split a prepared ГРЛС instruction into paragraphs under the standard headings.

    PDF lines are joined into paragraphs (a line that does not end a sentence continues; a word
    broken with a hyphen is rejoined); text before the first heading is the title block and is
    not kept."""
    sections: dict[str, list[Paragraph]] = {}
    current: str | None = None
    paragraph: Paragraph | None = None

    def close() -> None:
        nonlocal paragraph
        if paragraph is not None and current is not None and paragraph.text.strip():
            sections.setdefault(current, []).append(paragraph)
        paragraph = None

    segments = [
        (segment, page, block)
        for text, page, block in read_blocks(path)
        for segment in _RUN_IN_HEADING.split(text.lstrip("#").strip())
    ]
    for text, page, block in segments:
        key = _heading(text)
        rest: str | None = None
        if key is None:
            for inline_key, pattern in _INLINE_HEADING_PATTERNS:
                match = pattern.match(text)
                if match:
                    key, rest = inline_key, match.group(2)
                    break
        if key is not None:
            close()
            current = key
            if rest is None:
                continue
            text = rest
        if current is None:
            continue
        starts_new = (
            paragraph is None
            or _BULLET.match(text) is not None
            or (_SENTENCE_END.search(paragraph.text) is not None and not text[:1].islower())
        )
        if starts_new:
            close()
            paragraph = Paragraph(text=text)
        else:
            assert paragraph is not None
            if _HYPHEN_BREAK.search(paragraph.text) and text[:1].islower():
                paragraph.text = paragraph.text[:-1] + text
            else:
                paragraph.text = f"{paragraph.text} {text}"
        if page is not None and page not in paragraph.pages:
            paragraph.pages.append(page)
        if block is not None:
            paragraph.blocks.append(block)
    close()
    return sections


# Chapter layout: heading → ГРЛС section keys, in reading order (how to use first).
SECTION_LAYOUT: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Как заварить и принимать", ("dosage",)),
    ("Противопоказания", ("contraindications", "caution", "pregnancy")),
    ("Показания", ("indications",)),
    ("Действие и состав", ("action", "characteristics", "group")),
    ("Побочное действие и взаимодействия", ("adverse", "overdose", "interactions")),
    ("Особые указания", ("special", "driving")),
    ("Сырьё и хранение", ("description", "release-form", "storage", "shelf-life")),
)
_SUBTITLES = {
    "caution": "С осторожностью",
    "pregnancy": "Беременность и кормление грудью",
    "characteristics": "Что содержит",
    "group": "Фармакотерапевтическая группа",
    "overdose": "Передозировка",
    "interactions": "Взаимодействие с лекарствами",
    "driving": "Управление транспортом",
    "release-form": "Форма выпуска",
    "storage": "Условия хранения",
    "shelf-life": "Срок годности",
}


# ---------------------------------------------------------------------------------------------
# Preparation numbers and action chips
# ---------------------------------------------------------------------------------------------

_SENTENCES = re.compile(r"(?<=[.;])\s+(?=[А-ЯЁA-Z0-9«(])")
_RANGE = r"\d+(?:[,.]\d+)?(?:\s*[-–]\s*\d+(?:[,.]\d+)?)?"
_GRAMS = re.compile(rf"({_RANGE})\s*г\b")
_WATER = re.compile(rf"({_RANGE})\s*мл")
_HEAT = re.compile(rf"(?:нагрева\w*|кипят\w* на|кипящ\w* вод\w*)[^.;]*?({_RANGE})\s*мин")
_STEEP = re.compile(rf"(?:настаива\w*|охлажда\w*)[^.;]*?({_RANGE})\s*мин")
_TIMES = re.compile(rf"{_RANGE}\s*раз\w*\s+в\s+(?:день|сутки)")
_SPOONS = re.compile(rf"(?:около\s+)?({_RANGE}\s*(?:столов|чайн|десертн)\w*\s+ложк\w*)")
_COURSE = re.compile(rf"[Кк]урс\w*[^.]*?({_RANGE})\s*(дн\w*|недел\w*|месяц\w*)")
_ADULT_DOSE = re.compile(r"[Вв]зрослы\w*[^;.]{0,60}?(по\s+[^;:.,]+)")
_ANY_DOSE = re.compile(
    r"(?:принима|применя)\w*\s+(?:[^;:.]{0,40}?)((?:по|наружно|местно)\s+[^;:.,]+)", re.IGNORECASE
)


def _norm_range(value: str) -> str:
    return re.sub(r"\s*[-–]\s*", "–", value)


def _dose_value(value: str) -> str:
    """The single dose alone: «2-3 раза в день» already has its own cell, ranges use an en dash."""
    value = _TIMES.sub(" ", value)
    value = re.sub(r"(?<=[\d/])\s*[-–]\s*(?=\d)", "–", value)
    return re.sub(r"\s+", " ", value).strip(" ,")


def _field(value: str, sentence: str) -> dict[str, str]:
    return {"value": value, "quote": sentence}


def parse_brew(paragraphs: Sequence[Paragraph]) -> dict[str, object]:
    """Read the home preparation from the ГРЛС dosage text; every value keeps its sentence."""
    text = " ".join(paragraph.text for paragraph in paragraphs)
    sentences = [sentence.strip() for sentence in _SENTENCES.split(text) if sentence.strip()]
    brew: dict[str, object] = {}
    lowered = text.lower()
    if "отвар" in lowered:
        brew["kind"] = "отвар"
    elif "настой" in lowered:
        brew["kind"] = "настой"
    elif "полоскан" in lowered or "примочк" in lowered:
        brew["kind"] = "наружно"
    preparation = next(
        (sentence for sentence in sentences if re.search(r"залива|помеща|заваривают", sentence)),
        None,
    )
    if preparation is not None:
        if grams := _GRAMS.search(preparation):
            brew["herb"] = _field(f"{_norm_range(grams.group(1))} г", preparation)
        elif spoons := _SPOONS.search(preparation):
            brew["herb"] = _field(_norm_range(spoons.group(1)), preparation)
        if water := _WATER.search(preparation):
            brew["water"] = _field(f"{_norm_range(water.group(1))} мл", preparation)
    for name, pattern in (("heat", _HEAT), ("steep", _STEEP)):
        for sentence in sentences:
            if match := pattern.search(sentence):
                brew[name] = _field(f"{_norm_range(match.group(1))} мин", sentence)
                break
    for sentence in sentences:
        if match := _TIMES.search(sentence):
            brew["times"] = _field(_norm_range(match.group(0)), sentence)
            break
    dose = next(
        (
            (match, sentence)
            for pattern in (_ADULT_DOSE, _ANY_DOSE)
            for sentence in sentences
            if (match := pattern.search(sentence))
        ),
        None,
    )
    if dose is not None:
        brew["dose"] = _field(_dose_value(dose[0].group(1)), dose[1])
    for sentence in sentences:
        if match := _COURSE.search(sentence):
            brew["course"] = _field(f"{_norm_range(match.group(1))} {match.group(2)}", sentence)
            break
    return brew


ACTIONS: tuple[tuple[str, str], ...] = (
    ("противовоспалительное", r"противовоспалит"),
    ("спазмолитическое", r"спазмолит"),
    ("седативное", r"седатив|успокаива"),
    ("отхаркивающее", r"отхаркива"),
    ("слабительное", r"слабител"),
    ("мочегонное", r"мочегон|диуретич"),
    ("желчегонное", r"желчегон"),
    ("вяжущее", r"вяжущ"),
    ("противомикробное", r"противомикроб|антисептич|антибактериал|бактерицид|антимикроб"),
    ("кровоостанавливающее", r"кровоостанавл|гемостатич"),
    ("потогонное", r"потогон|диафорет"),
    ("ветрогонное", r"ветрогон|карминатив"),
    ("возбуждает аппетит", r"аппетит"),
    ("обволакивающее", r"обволакива"),
    ("ранозаживляющее", r"ранозаживл|регенер"),
    ("антидепрессивное", r"антидепресс"),
)


def action_chips(sections: dict[str, list[Paragraph]]) -> list[str]:
    text = " ".join(
        paragraph.text.lower() for key in ("action", "group") for paragraph in sections.get(key, [])
    )
    return [label for label, pattern in ACTIONS if re.search(pattern, text)]


# ---------------------------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------------------------


def _jpeg(source: Path, width: int, quality: int) -> bytes:
    """The image as RGB JPEG, scaled down to ``width`` when wider (pymupdf ships no type stubs)."""
    pixmap: Any = pymupdf.Pixmap(str(source))
    if pixmap.alpha:
        pixmap = pymupdf.Pixmap(pixmap, 0)
    if pixmap.colorspace is None or pixmap.colorspace.n != 3:
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pixmap)
    if pixmap.width > width:
        height = round(pixmap.height * width / pixmap.width)
        pixmap = pymupdf.Pixmap(pixmap, width, height, None)
    return cast("bytes", pixmap.tobytes("jpg", jpg_quality=quality))


def thumbnail_data_url(source: Path) -> str:
    data = _jpeg(source, THUMBNAIL_WIDTH, 72)
    return "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")


def plate_jpeg(source: Path) -> bytes:
    """The plate as JPEG of at most 1200 px width (quality 85: the ≤15 % lossy-image budget)."""
    return _jpeg(source, PLATE_MAX_WIDTH, 85)


# ---------------------------------------------------------------------------------------------
# ГФ XV
# ---------------------------------------------------------------------------------------------

# The article mixes Word paragraph classes: «MsoNormal» and «Default» (the technology part).
_GF_PARAGRAPH = re.compile(r'<p class="(?:Mso|Default)[^"]*"[^>]*>(.*?)</p>', re.DOTALL)


def gf15_paragraphs(page: Path) -> list[str]:
    raw = page.read_text(encoding="utf-8")
    result: list[str] = []
    for match in _GF_PARAGRAPH.finditer(raw):
        text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", match.group(1)))).strip()
        if text:
            result.append(text)
    return result


@dataclass(frozen=True)
class Identification:
    """What the ГФ raw-material article says about recognising the plant, verbatim."""

    definition: str
    features: tuple[str, ...]
    lookalike_note: str | None
    lookalikes: tuple[str, ...]


# The definition opens «Собранные …» (one article types a Latin «C»); seeds open «Зрелые …»,
# bean pods «Высушенные …», some XV articles «Настоящая фармакопейная статья распространяется …».
_DEFINITION = re.compile(
    r"^(?:[СC]обранн|Зрелые|Высушенные|Настоящая фармакопейная статья распространяется на )"
)
_FEATURES_HEAD = re.compile(r"^Внешние признаки\.\s*")
_OFS_REFERENCE = re.compile(
    r"^Определение проводят в соответствии с (?:требованиями )?ОФС «[^»]+»\.\s*"
)
# The whole raw material ends where the cut herb, powder, microscopy, loupe views or figures begin.
_FEATURES_END = re.compile(
    r"^(?:Измельч[её]нн|Порошок|Резан|Микроскопические признаки|Определение основных|Примечани"
    r"|Рисунок|\d+\s*[–—-]|При рассмотрении|Цельное сырь?[её]\.\s*При рассмотрении)"
)
_INLINE_END = re.compile(r"\s(?=(?:Измельч[её]нное сырь?[её]|Порошок)\.)")
_LOOKALIKE_NOTE = re.compile(r"^Примечани[ея]\s*[–—-]\s*.*(?:других видов|примесь)", re.IGNORECASE)
_LOOKALIKE_ITEM = re.compile(r"^[а-я]\)\s")


def gf_identification(page: Path) -> Identification:
    """Definition, the whole raw material's appearance (not the cut herb, powder or microscopy)
    and the article's note on other species found as an admixture, all verbatim."""
    paragraphs = gf15_paragraphs(page)
    definition = next((text for text in paragraphs if _DEFINITION.match(text)), None)
    start = next(
        (index for index, text in enumerate(paragraphs) if _FEATURES_HEAD.match(text)), None
    )
    if definition is None or start is None:
        raise HerbalSourceError(f"{page}: no definition or «Внешние признаки» in the ГФ article")
    features: list[str] = []
    for index, text in enumerate(paragraphs[start:]):
        if index == 0:
            text = _OFS_REFERENCE.sub("", _FEATURES_HEAD.sub("", text))
        elif _FEATURES_END.match(text):
            break
        if not text:
            continue
        head, *rest = _INLINE_END.split(text, maxsplit=1)
        features.append(head.strip())
        if rest:
            break
    microscopy = next(
        (
            index
            for index, text in enumerate(paragraphs)
            if index > start and text.startswith("Микроскопические признаки")
        ),
        len(paragraphs),
    )
    note: str | None = None
    items: list[str] = []
    for text in paragraphs[start:microscopy]:
        if note is None and _LOOKALIKE_NOTE.match(text):
            note = text
        elif note is not None and _LOOKALIKE_ITEM.match(text):
            items.append(text)
        elif note is not None:
            break
    return Identification(definition, tuple(features), note, tuple(items))


# ---------------------------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------------------------


class _Dumper(yaml.SafeDumper):
    pass


def _marker(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"<!-- localmed:source {encoded} -->"


def _front(metadata: dict[str, object]) -> str:
    return yaml.dump(
        metadata,
        Dumper=_Dumper,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=1_000_000,
    ).rstrip()


def _sha256_bytes(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _digest(parts: dict[str, str]) -> str:
    return _sha256_bytes(json.dumps(parts, sort_keys=True, separators=(",", ":")).encode())


def _who_volume(plant: Plant, raw_manifest: dict[str, object]) -> dict[str, object]:
    assert plant.who is not None
    volumes = cast("dict[str, dict[str, object]]", raw_manifest.get("who") or {})
    if plant.who.volume not in volumes:
        raise HerbalSourceError(f"{plant.id}: WHO volume {plant.who.volume} is not downloaded")
    return volumes[plant.who.volume]


def _monograph_entry(plant: Plant, raw_manifest: dict[str, object]) -> dict[str, object]:
    """The plant's monograph sources in one shape: EMA documents, or the WHO volume."""
    if plant.ema is not None:
        return cast("dict[str, dict[str, object]]", raw_manifest["ema"])[plant.id]
    volume = _who_volume(plant, raw_manifest)
    return {
        "lastUpdated": str(volume["year"]),
        "documents": {"monograph": {"path": volume["path"], "url": volume["url"]}},
    }


NCCIH_PAGE = NCCIH_BASE + "{}"
LACTMED_PAGE = "https://www.ncbi.nlm.nih.gov/books/n/lactmed/{}/"
LIVERTOX_PAGE = "https://www.ncbi.nlm.nih.gov/books/n/livertox/{}/"
TRTS_PAGE = TRTS_URL


def _safety_digest(safety: PlantSafety, raw_root: Path, files: dict[str, str]) -> str:
    """The safety file and the saved sources it was checked against."""
    paths = [
        *([nccih_path(safety.nccih)] if safety.nccih else []),
        *([lactmed_path(safety.lactmed)] if safety.lactmed else []),
        *([livertox_path(safety.livertox)] if safety.livertox else []),
    ]
    return _digest(
        {
            "file": _sha256_bytes(safety.model_dump_json().encode()),
            **{
                path: files.get(path) or _sha256_bytes((raw_root / path).read_bytes())
                for path in paths
            },
        }
    )


def _safety_metadata(safety: PlantSafety, raw_root: Path) -> dict[str, object]:
    lines: list[dict[str, object]] = [
        {
            "source": line.source,
            "kind": line.kind,
            "ru": line.ru,
            "quote": line.quote,
            "url": NCCIH_PAGE.format(safety.nccih)
            if line.source == "nccih"
            else LACTMED_PAGE.format(safety.lactmed),
        }
        for line in safety.lines
    ]
    liver: dict[str, object] | None = None
    if safety.livertox:
        letter, russian, sentence = livertox_score(
            markup_text((raw_root / livertox_path(safety.livertox)).read_text(encoding="utf-8"))
        )
        liver = {
            "score": letter,
            "ru": russian,
            "quote": sentence,
            "url": LIVERTOX_PAGE.format(safety.livertox),
        }
    trts: dict[str, object] | None = None
    if safety.trts is not None:
        row = safety.trts
        trts = {
            "section": row.section,
            "ru": TRTS_SECTIONS[row.section],
            "parts": row.parts,
            "number": row.number,
            "quote": f"{row.number}. {row.name} — {row.latin} — {row.parts}",
            "url": TRTS_PAGE,
            "pdfPage": row.page,
        }
    return {"lines": lines, "liver": liver, "trts": trts}


def _safety_source_lines(safety: PlantSafety) -> list[str]:
    lines: list[str] = []
    if safety.nccih:
        lines.append(
            f"- NCCIH «Herbs at a Glance»: {NCCIH_PAGE.format(safety.nccih)} (US public domain)"
        )
    if safety.lactmed:
        lines.append(
            "- LactMed (Drugs and Lactation Database, NICHD): "
            f"{LACTMED_PAGE.format(safety.lactmed)} (US public domain)"
        )
    if safety.livertox:
        lines.append(
            "- LiverTox (NIDDK), шкала вероятности поражения печени: "
            f"{LIVERTOX_PAGE.format(safety.livertox)} (US public domain)"
        )
    if safety.trts is not None:
        lines.append(
            "- ТР ТС 021/2011 «О безопасности пищевой продукции», приложение 7, "
            f"п. {safety.trts.section}, № {safety.trts.number} (с. {safety.trts.page} PDF): "
            f"{TRTS_PAGE}"
        )
    return lines


def _regions_metadata(book: RegionalRedBooks, plant: PlantRegions) -> dict[str, object]:
    return {
        "regions": [{"region": row.region, "year": row.year} for row in plant.regions],
        "sourceLabel": f"Плантариум, перечни региональных Красных книг ({book.fetched})",
        "url": f"{PLANTARIUM}/page/view/item/{plant.taxon}.html",
    }


def _conflicts_metadata(
    plant: Plant, conflicts: PlantConflicts, raw_manifest: dict[str, object]
) -> list[dict[str, object]]:
    documents = cast(
        "dict[str, dict[str, object]]", _monograph_entry(plant, raw_manifest)["documents"]
    )
    authority = "WHO" if plant.who is not None else "EMA"
    return [
        {
            "topic": item.topic,
            "topicRu": TOPIC_LABELS[item.topic],
            "ru": item.ru,
            "grls": item.grls,
            "authority": authority,
            "doc": item.monograph.doc,
            "page": item.monograph.page,
            "quote": item.monograph.quote,
            "url": documents[item.monograph.doc]["url"],
        }
        for item in conflicts.items
    ]


def _red_book_metadata(plant: Plant, raw_manifest: dict[str, object]) -> dict[str, object] | None:
    if plant.red_book is None:
        return None
    documents = cast("dict[str, dict[str, object]]", raw_manifest.get("redBook") or {})
    if "list" not in documents:
        raise HerbalSourceError("no Red Book list; run fetch-herbal-sources")
    entry = plant.red_book
    return {
        "number": entry.number,
        "category": entry.category,
        "categoryRu": RED_BOOK_CATEGORIES[entry.category],
        **({"note": entry.note} if entry.note else {}),
        "url": documents["list"]["page"],
        "pdfPage": entry.page,
    }


def _ema_metadata(
    plant: Plant, extraction: EmaExtraction | None, raw_manifest: dict[str, object]
) -> dict[str, object] | None:
    entry = _monograph_entry(plant, raw_manifest)
    documents = cast("dict[str, dict[str, object]]", entry["documents"])
    base: dict[str, object] = {
        "authority": "EMA" if plant.ema is not None else "WHO",
        "page": plant.ema.page
        if plant.ema is not None
        else _who_volume(plant, raw_manifest)["handle"],
        "lastUpdated": entry.get("lastUpdated"),
        "species": plant.ema.species if plant.ema is not None else None,
        "otherSpecies": plant.ema.other_species if plant.ema is not None else False,
        "documents": {
            kind: {"url": item["url"], "draft": bool(item.get("draft"))}
            for kind, item in documents.items()
        },
    }
    if plant.who is not None:
        volume = _who_volume(plant, raw_manifest)
        base["volume"] = volume["title"]
        base["monograph"] = plant.who.title
        base["pages"] = list(plant.who.pages)
        if volume.get("mirror"):
            base["mirror"] = volume["mirror"]
    if extraction is None:
        return {**base, "extracted": False}
    return {
        **base,
        "extracted": True,
        "status": extraction.status,
        "useType": extraction.use_type,
        "facts": [fact.model_dump(by_alias=True, exclude_none=True) for fact in extraction.facts],
        "constituents": [
            item.model_dump(by_alias=True, exclude_none=True) for item in extraction.constituents
        ],
    }


def _plate_credit(plant: Plant, plate: dict[str, object]) -> str:
    """«Köhler, 1887»: the book's author and the year Commons gives for the plate."""
    assert plant.plate is not None
    year = re.search(r"\b(1[6-9]\d\d)\b", str(plate.get("date") or ""))
    author = PLATE_AUTHORS[plant.plate.book]
    return f"{author}, {year.group(1)}" if year else author


def _aliases(plant: Plant) -> list[str]:
    binomial = " ".join(plant.latin.replace("×", "").split()[:2])
    names = [
        plant.ru,
        plant.ru.split()[0].lower(),
        binomial,
        *(plant.grls.inn if plant.grls else ()),
    ]
    if plant.ema is not None:
        names.append(plant.ema.slug.replace("-", " "))
    if plant.who is not None:
        names.append(plant.who.title)
    seen: dict[str, str] = {}
    for name in names:
        seen.setdefault(name.casefold(), name)
    return list(seen.values())


@dataclass(frozen=True)
class Chapter:
    document_id: str
    title: str
    markdown: str
    aliases: list[str]


def render_plant(
    plant: Plant,
    choice: GrlsChoice | None,
    sections: dict[str, list[Paragraph]],
    extraction: EmaExtraction | None,
    raw_root: Path,
    raw_manifest: dict[str, object],
    extraction_sha256: str | None,
    manual: PlantLookalikes | None = None,
    safety: PlantSafety | None = None,
    conflicts: PlantConflicts | None = None,
    regions: tuple[RegionalRedBooks, PlantRegions] | None = None,
) -> Chapter:
    grls_front = (
        cast("dict[str, object]", _front_matter(choice.markdown)["metadata"])
        if choice is not None
        else {}
    )
    plate = (
        cast("dict[str, dict[str, object]]", raw_manifest["plates"])[plant.id]
        if plant.plate is not None
        else None
    )
    gf_articles = cast("dict[str, dict[str, object]]", raw_manifest.get("gfArticles") or {})
    gf_article: dict[str, object] | None = None
    identification: Identification | None = None
    if plant.gf is not None:
        if plant.id not in gf_articles:
            raise HerbalSourceError(
                f"{plant.id}: no ГФ article; run fetch-herbal-sources --gf-only"
            )
        gf_article = gf_articles[plant.id]
        identification = gf_identification(raw_root / str(gf_article["path"]))
    manuals = cast("dict[str, dict[str, object]]", raw_manifest.get("manuals") or {})
    files = {
        str(item["path"]): str(item["sha256"])
        for item in cast("list[dict[str, object]]", raw_manifest["files"])
    }
    ema_entry = _monograph_entry(plant, raw_manifest)
    ema_paths = [
        str(item["path"])
        for item in cast("dict[str, dict[str, object]]", ema_entry["documents"]).values()
    ]
    checksum = _digest(
        {
            **({"grls": str(grls_front["pdfSha256"])} if choice is not None else {}),
            **({"plate": files[str(plate["path"])]} if plate is not None else {}),
            **(
                {"redBook": _sha256_bytes(plant.red_book.model_dump_json().encode())}
                if plant.red_book is not None
                else {}
            ),
            **({"safety": _safety_digest(safety, raw_root, files)} if safety is not None else {}),
            **(
                {"conflicts": _sha256_bytes(conflicts.model_dump_json().encode())}
                if conflicts is not None
                else {}
            ),
            **(
                {"regions": _sha256_bytes(regions[1].model_dump_json().encode())}
                if regions is not None
                else {}
            ),
            **{path: files[path] for path in ema_paths},
            **({"emaExtraction": extraction_sha256} if extraction_sha256 else {}),
            **(
                {
                    "gfIdentification": _sha256_bytes(
                        json.dumps(asdict(identification), ensure_ascii=False).encode()
                    )
                }
                if identification is not None
                else {}
            ),
            **(
                {"lookalikes": _sha256_bytes(manual.model_dump_json().encode())}
                if manual is not None
                else {}
            ),
        }
    )
    aliases = _aliases(plant)
    ema_updated = str(ema_entry.get("lastUpdated") or "").replace("/", ".")
    brew = parse_brew(sections.get("dosage", []))
    metadata: dict[str, object] = {
        "id": plant.document_id,
        "title": plant.ru,
        "short_title": plant.ru,
        "version_label": f"grls-{grls_front.get('catalogEdition')}"
        if choice is not None
        else f"ema-{ema_updated}"
        if plant.ema is not None
        else f"who-{plant.who.volume if plant.who else ''}",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": ["phytotherapy"],
        "age_groups": [],
        "source_file": str(grls_front["officialSourceUrl"])
        if choice is not None
        else plant.ema.page
        if plant.ema is not None
        else str(_who_volume(plant, raw_manifest)["handle"]),
        "source_checksum": checksum,
        "synthetic_fixture": False,
        "metadata": {
            "authorityTier": "official-regulatory-act",
            "jurisdiction": "RU",
            "documentKind": "травник",
            "contentMode": "verbatim",
            "rightsStatus": RIGHTS_STATUS,
            "rightsBasis": RIGHTS_BASIS,
            "publicationState": "experimental-preview",
            "publicationDecision": PUBLICATION_DECISION,
            "requiresReview": True,
            "calculationRequired": False,
            "clinicalContextRequired": True,
            "herbal": {
                "plantId": plant.id,
                "latin": plant.latin,
                "family": plant.family,
                "partRu": plant.part.ru,
                "partLa": plant.part.la,
                "actions": action_chips(sections),
                "brew": brew,
                "thumbnail": thumbnail_data_url(raw_root / str(plate["path"]))
                if plate is not None
                else None,
                "plate": {
                    "asset": f"plates/{plant.id}.jpg",
                    "book": PLATE_BOOKS[plant.plate.book],
                    "credit": _plate_credit(plant, plate),
                    "artist": plate.get("artist"),
                    "date": plate.get("date"),
                    "licence": plate.get("licence"),
                    "commonsPage": plate.get("commonsPage"),
                    **({"species": plant.plate.species} if plant.plate.species else {}),
                }
                if plate is not None and plant.plate is not None
                else None,
                "ema": _ema_metadata(plant, extraction, raw_manifest),
                "redBook": _red_book_metadata(plant, raw_manifest),
                "safety": _safety_metadata(safety, raw_root) if safety is not None else None,
                "regionalRedBooks": _regions_metadata(*regions) if regions is not None else None,
                "conflicts": _conflicts_metadata(plant, conflicts, raw_manifest)
                if conflicts is not None
                else None,
                "identification": _identification_metadata(
                    identification, gf_article, manual, manuals
                )
                if identification is not None and gf_article is not None
                else None,
                "grls": {
                    "registrationNumber": choice.registration_number,
                    "tradeName": choice.trade_name,
                    "holder": choice.holder,
                    "dosageForm": grls_front.get("dosageForm"),
                    "instructionLabel": choice.instruction_label,
                    "officialSourceUrl": grls_front["officialSourceUrl"],
                    "pdfSha256": grls_front["pdfSha256"],
                    "sourceDocument": choice.source_id,
                    "catalogEdition": grls_front.get("catalogEdition"),
                    "ocr": choice.ocr,
                    "otherRegistrations": choice.alternatives,
                }
                if choice is not None
                else None,
            },
            "navigationAliases": aliases,
        },
    }
    blocks: list[str] = [f"# {plant.ru}"]
    recognise = (
        _identification_blocks(identification, gf_article, manual, manuals)
        if identification is not None and gf_article is not None
        else []
    )
    if choice is not None:
        grls = _grls_blocks(choice, sections, str(grls_front["officialSourceUrl"]))
        # «Как узнать» follows the recipe: the first ГРЛС section ends at the second heading.
        second = next(
            (index for index, block in enumerate(grls) if index and block.startswith("## ")),
            len(grls),
        )
        blocks += grls[:second] + recognise + grls[second:]
    else:
        blocks += recognise
    blocks.append("## Источники")
    blocks.append(_marker({"contentMode": "editorial-note"}))
    blocks.append(
        "\n".join(
            _source_lines(
                plant,
                choice,
                plate,
                ema_entry,
                gf_article,
                manual,
                manuals,
                _who_volume(plant, raw_manifest) if plant.who is not None else None,
                cast("dict[str, dict[str, object]]", raw_manifest.get("redBook") or {}),
                safety,
            )
        )
    )
    markdown = f"---\n{_front(metadata)}\n---\n\n" + "\n\n".join(blocks) + "\n"
    return Chapter(plant.document_id, plant.ru, markdown, aliases)


_GF_EDITIONS = {14: "XIV изд.", 15: "XV изд."}
# «в) Хвощ речной (синонимы: …) (Equisetum fluviatile L.) имеет …» → up to the Latin name.
_LOOKALIKE_NAME = re.compile(r"^[а-я]\)\s*(.+?\([A-Z][a-z]+ [a-z]+[^)]*\))")


def _lookalike_name(item: str) -> str:
    found = _LOOKALIKE_NAME.match(item)
    return found.group(1) if found else item.split(".", 1)[0]


def _manual_label(manuals: dict[str, dict[str, object]], source: str, page: int) -> str:
    return f"{manuals[source]['short']}, с. {page}"


def _manual_lookalikes(
    entry: PlantLookalikes | None, manuals: dict[str, dict[str, object]]
) -> list[dict[str, object]]:
    if entry is None:
        return []
    return [
        {
            "name": f"{item.name} ({item.latin})",
            "text": item.quote,
            "source": "manual",
            "sourceLabel": _manual_label(manuals, item.source, item.page),
            **({"poisonous": True} if item.poisonous else {}),
        }
        for item in entry.lookalikes
    ]


def _identification_metadata(
    identification: Identification,
    gf_article: dict[str, object],
    manual: PlantLookalikes | None,
    manuals: dict[str, dict[str, object]],
) -> dict[str, object]:
    return {
        "source": {
            "number": gf_article["number"],
            "title": gf_article["title"],
            "edition": gf_article["edition"],
            "url": gf_article["page"],
        },
        "definition": identification.definition,
        "lookalikes": [
            {"name": _lookalike_name(item), "text": item, "source": "gf"}
            for item in identification.lookalikes
        ]
        + _manual_lookalikes(manual, manuals),
        **(
            {
                "key": {
                    "text": manual.key.quote,
                    "sourceLabel": _manual_label(manuals, manual.key.source, manual.key.page),
                }
            }
            if manual is not None and manual.key is not None
            else {}
        ),
    }


def _identification_blocks(
    identification: Identification,
    gf_article: dict[str, object],
    manual: PlantLookalikes | None,
    manuals: dict[str, dict[str, object]],
) -> list[str]:
    """«Как узнать»: the ГФ article's definition, the whole raw material and its look-alikes."""
    base: dict[str, object] = {
        "contentMode": "verbatim",
        "officialUrl": gf_article["page"],
        "documentNumber": gf_article["number"],
    }
    blocks = ["## Как узнать", _marker({**base, "sourceSection": "definition"})]
    blocks.append(identification.definition)
    for text in identification.features:
        blocks += [_marker({**base, "sourceSection": "appearance"}), text]
    if identification.lookalike_note or manual is not None:
        blocks.append("### Не спутать")
    if identification.lookalike_note:
        for text in (identification.lookalike_note, *identification.lookalikes):
            blocks += [_marker({**base, "sourceSection": "admixtures"}), text]
    if manual is not None:
        quoted: list[tuple[ManualQuote, str]] = []
        if manual.key is not None:
            quoted.append((manual.key, manual.key.quote))
        quoted += [
            (item, f"{item.name} ({item.latin}): {item.quote}") for item in manual.lookalikes
        ]
        for item, text in quoted:
            book = manuals[item.source]
            blocks += [
                _marker(
                    {
                        "contentMode": "verbatim",
                        "sourceBook": book["citation"],
                        "page": item.page,
                        "sourceSection": "admixtures",
                    }
                ),
                text,
            ]
    return blocks


def _grls_blocks(
    choice: GrlsChoice, sections: dict[str, list[Paragraph]], official_url: str
) -> list[str]:
    blocks: list[str] = []
    marker_base: dict[str, object] = {
        "contentMode": "verbatim",
        "sourceDocument": choice.source_id,
        "registrationNumber": choice.registration_number,
        "officialUrl": official_url,
    }
    for title, keys in SECTION_LAYOUT:
        present = [key for key in keys if sections.get(key)]
        if not present:
            continue
        blocks.append(f"## {title}")
        for key in present:
            if key != keys[0] and key in _SUBTITLES:
                blocks.append(f"### {_SUBTITLES[key]}")
            for paragraph in sections[key]:
                span: dict[str, object] = {**marker_base, "sourceSection": key}
                if paragraph.pages:
                    span["page"] = paragraph.pages[0]
                    if len(paragraph.pages) > 1:
                        span["pageEnd"] = paragraph.pages[-1]
                if paragraph.blocks:
                    span["blocks"] = paragraph.blocks
                blocks.append(_marker(span))
                blocks.append(paragraph.text)
    return blocks


def _source_lines(
    plant: Plant,
    choice: GrlsChoice | None,
    plate: dict[str, object] | None,
    ema_entry: dict[str, object],
    gf_article: dict[str, object] | None,
    manual: PlantLookalikes | None = None,
    manuals: dict[str, dict[str, object]] | None = None,
    who_volume: dict[str, object] | None = None,
    red_book: dict[str, dict[str, object]] | None = None,
    safety: PlantSafety | None = None,
) -> list[str]:
    lines: list[str] = []
    if choice is not None:
        lines.append(
            f"- Инструкция ГРЛС «{choice.trade_name}», {choice.instruction_label}, {choice.holder}"
            + (" (распознана OCR)" if choice.ocr else "")
        )
    updated = ema_entry.get("lastUpdated")
    if plant.ema is not None:
        lines.append(
            f"- EMA/HMPC: {plant.ema.page}"
            + (f" (обновлено {updated})" if updated else "")
            + ". © European Medicines Agency"
        )
    if plant.who is not None and who_volume is not None:
        first, last = plant.who.pages
        lines.append(
            f"- ВОЗ: {who_volume['title']} ({who_volume['year']}), «{plant.who.title}», "
            f"с. {first}–{last} PDF: {who_volume['handle']}. © World Health Organization"
            + (f"; файл — копия {who_volume['mirror']}" if who_volume.get("mirror") else "")
        )
    if plate is not None and plant.plate is not None and plant.plate.book == "owner":
        lines.append("- Иллюстрация предоставлена владельцем приложения")
    elif plate is not None and plant.plate is not None:
        lines.append(
            f"- Иллюстрация: {PLATE_BOOKS[plant.plate.book]} — общественное достояние "
            f"(Wikimedia Commons: {plate.get('commonsPage')})"
        )
    if plant.red_book is not None and red_book:
        listing = red_book["list"]
        lines.append(
            f"- Красная книга РФ: {listing['title']}, № {plant.red_book.number} перечня "
            f"(с. {plant.red_book.page} PDF): {listing['page']}; категории — "
            f"{red_book['categories']['title']}, п. 3.7"
        )
    if safety is not None:
        lines.extend(_safety_source_lines(safety))
    if gf_article is not None:
        lines.append(
            f"- Государственная фармакопея РФ {_GF_EDITIONS[int(str(gf_article['edition']))]}, "
            f"{gf_article['number']} «{gf_article['title']}»: {gf_article['page']}"
        )
    if manual is not None and manuals:
        used = sorted(
            {item.source for item in manual.lookalikes}
            | ({manual.key.source} if manual.key is not None else set())
        )
        lines += [f"- Не спутать: {manuals[key]['citation']}" for key in used]
    return lines


INFUSION_ALIASES = ("как приготовить настой", "как приготовить отвар", "настой", "отвар")


def render_infusions(raw_root: Path, raw_manifest: dict[str, object]) -> Chapter:
    gf15 = cast("dict[str, dict[str, object]]", raw_manifest["gf15"])["nastoi-i-otvary"]
    order = cast("dict[str, str]", gf15["order"])
    paragraphs = gf15_paragraphs(raw_root / str(gf15["path"]))
    try:
        start = paragraphs.index("Настои и отвары")
    except ValueError as error:
        raise HerbalSourceError("ГФ XV page has no «Настои и отвары» article") from error
    body = paragraphs[start + 1 :]
    text_digest = _sha256_bytes("\n".join(body).encode())
    document_id = DOCUMENT_PREFIX + "guide.infusions"
    title = "Настои и отвары: общие правила"
    metadata: dict[str, object] = {
        "id": document_id,
        "title": title,
        "short_title": "Настои и отвары",
        "version_label": "gf15-ofs-1.4.1.0018",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": ["phytotherapy"],
        "age_groups": [],
        "source_file": str(gf15["page"]),
        "source_checksum": text_digest,
        "synthetic_fixture": False,
        "metadata": {
            "authorityTier": "official-regulatory-act",
            "jurisdiction": "RU",
            "documentKind": "общая фармакопейная статья",
            "documentNumber": "ОФС.1.4.1.0018",
            "approvedBy": order["title"],
            "officialSourceUrl": gf15["page"],
            "contentMode": "verbatim",
            "rightsStatus": RIGHTS_STATUS,
            "rightsBasis": RIGHTS_BASIS,
            "publicationState": "experimental-preview",
            "publicationDecision": PUBLICATION_DECISION,
            "requiresReview": True,
            "calculationRequired": False,
            "clinicalContextRequired": False,
            "herbal": {"guide": "infusions"},
            "navigationAliases": list(INFUSION_ALIASES),
        },
    }
    marker = _marker(
        {
            "contentMode": "verbatim",
            "officialUrl": str(gf15["page"]),
            "documentNumber": "ОФС.1.4.1.0018",
        }
    )
    blocks: list[str] = [f"# {title}"]
    skipped = False
    heading_levels = {"Особенности технологии": 2, "Хранение": 2, "Срок годности": 3}
    for text in body:
        if text in {"Взамен ОФС.1.4.1.0018", "ОФС.1.4.1.0018"}:
            continue
        if text in heading_levels:
            blocks.append(f"{'#' * heading_levels[text]} {text}")
            continue
        # The recalculation formula is an image on the page; its variable list is left out.
        if (
            text in {"где", "-", "–"}
            or text.endswith(", %;")
            or text.endswith(", %.")
            or text.endswith(", г;")
        ):
            if not skipped:
                blocks.append(_marker({"contentMode": "editorial-note"}))
                blocks.append(
                    "Формула пересчёта на сырьё со стандартным содержанием действующих веществ "
                    "дана в статье изображением и здесь не приводится."
                )
                skipped = True
            continue
        blocks.append(marker)
        blocks.append(text)
    blocks.append("## Источник")
    blocks.append(_marker({"contentMode": "editorial-note"}))
    blocks.append(
        f"- Государственная фармакопея РФ XV изд., ОФС.1.4.1.0018 «Настои и отвары», "
        f"{order['title']}: {gf15['page']}"
    )
    markdown = f"---\n{_front(metadata)}\n---\n\n" + "\n\n".join(blocks) + "\n"
    return Chapter(document_id, title, markdown, list(INFUSION_ALIASES))


# ---------------------------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class PrepareReport:
    documents: int
    plants: int
    emaExtracted: list[str]
    emaMissing: list[str]
    ocrInstructions: list[str]
    grlsMissing: list[str]
    brewIncomplete: dict[str, list[str]]
    instructions: dict[str, str]
    output: str


def _load_manifest(paths: Sequence[Path]) -> dict[str, list[dict[str, object]]]:
    """Text-manifest rows per registration; later files (targeted additions) extend earlier ones."""
    result: dict[str, list[dict[str, object]]] = {}
    for path in paths:
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                row = cast("dict[str, object]", json.loads(line))
                result.setdefault(str(row["registrationNumber"]), []).append(row)
    return result


def _alias_rows(chapters: Iterable[Chapter]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for chapter in chapters:
        for index, alias in enumerate(chapter.aliases):
            rows.append(
                {
                    "id": "herbal-"
                    + hashlib.sha256(
                        f"{chapter.document_id}|{alias.casefold()}".encode()
                    ).hexdigest()[:12],
                    "canonicalTerm": chapter.title,
                    "alias": alias,
                    "category": "reference",
                    "weight": 1.5 if index == 0 else 1.3,
                }
            )
    return rows


def prepare_herbal_book(
    *,
    plants_path: Path,
    catalog: Path,
    instruction_manifest: Sequence[Path],
    instructions_root: Sequence[Path],
    raw_root: Path,
    ema_dir: Path,
    output: Path,
    lookalikes_path: Path | None = None,
    who_dir: Path = Path("content/herbal/who"),
    safety_dir: Path = Path("content/herbal/safety"),
    conflicts_dir: Path = Path("content/herbal/conflicts"),
    regional_red_books: Path = Path("content/herbal/regional-red-books.yaml"),
) -> PrepareReport:
    plants = load_plants(plants_path)
    manual_lookalikes = load_lookalikes(lookalikes_path) if lookalikes_path else {}
    problems = check_lookalikes(
        manual_lookalikes, manual_paths(raw_root), {plant.id for plant in plants}
    )
    if problems:
        raise HerbalSourceError(f"look-alikes do not match their manuals: {problems}")
    raw_manifest = cast(
        "dict[str, object]", json.loads((raw_root / "MANIFEST.json").read_text(encoding="utf-8"))
    )
    records = cast(
        "list[dict[str, object]]", json.loads(catalog.read_text(encoding="utf-8"))["records"]
    )
    manifest = _load_manifest(instruction_manifest)
    regional = load_regional_red_books(regional_red_books) if regional_red_books.is_file() else None
    if regional is not None and (unknown := set(regional.plants) - {p.id for p in plants}):
        raise HerbalSourceError(f"regional Red Books name unknown plants: {sorted(unknown)}")
    chapters: list[Chapter] = []
    extracted: list[str] = []
    missing: list[str] = []
    ocr: list[str] = []
    incomplete: dict[str, list[str]] = {}
    no_grls: list[str] = []
    chosen: dict[str, str] = {}
    for plant in plants:
        choice: GrlsChoice | None = None
        sections: dict[str, list[Paragraph]] = {}
        # A registration file can hold only an amendment notice; take the best text with a dosage.
        for candidate in instruction_candidates(plant, records, manifest, instructions_root):
            sections = instruction_sections(candidate.markdown)
            if sections.get("dosage"):
                choice = candidate
                break
        if choice is None:
            sections = {}
            no_grls.append(plant.id)
        else:
            chosen[plant.id] = f"{choice.registration_number} {choice.source_id}"
            if choice.ocr:
                ocr.append(plant.id)
        extraction_path = (ema_dir if plant.ema is not None else who_dir) / f"{plant.id}.yaml"
        extraction: EmaExtraction | None = None
        extraction_sha: str | None = None
        if extraction_path.is_file():
            extraction = load_extraction(extraction_path)
            if plant.who is not None:
                problems = validate_who_extraction(
                    extraction,
                    who_documents(raw_root, plant.who.volume),
                    plant.who.pages,
                )
            else:
                problems = validate_ema_extraction(extraction, ema_documents(raw_root, plant.id))
            if problems:
                raise HerbalSourceError(f"{plant.id}: monograph facts fail their check: {problems}")
            extraction_sha = _sha256_bytes(extraction_path.read_bytes())
            extracted.append(plant.id)
        else:
            missing.append(plant.id)
        safety_path = safety_dir / f"{plant.id}.yaml"
        safety = load_safety(safety_path) if safety_path.is_file() else None
        if safety is not None and (problems := validate_safety(safety, raw_root)):
            raise HerbalSourceError(f"{plant.id}: safety lines fail their check: {problems}")
        conflicts_path = conflicts_dir / f"{plant.id}.yaml"
        conflicts = load_conflicts(conflicts_path) if conflicts_path.is_file() else None
        if conflicts is not None:
            documents = (
                who_documents(raw_root, plant.who.volume)
                if plant.who is not None
                else ema_documents(raw_root, plant.id)
            )
            texts = [paragraph.text for paragraphs in sections.values() for paragraph in paragraphs]
            pages = plant.who.pages if plant.who is not None else None
            if problems := validate_conflicts(conflicts, texts, documents, pages):
                raise HerbalSourceError(f"{plant.id}: ГРЛС/monograph conflicts fail: {problems}")
        chapter = render_plant(
            plant,
            choice,
            sections,
            extraction,
            raw_root,
            raw_manifest,
            extraction_sha,
            manual_lookalikes.get(plant.id),
            safety,
            conflicts,
            (regional, regional.plants[plant.id])
            if regional is not None and plant.id in regional.plants
            else None,
        )
        brew = parse_brew(sections.get("dosage", []))
        lacking = [name for name in ("kind", "herb", "water", "dose") if name not in brew]
        if lacking:
            incomplete[plant.id] = lacking
        chapters.append(chapter)
    chapters.append(render_infusions(raw_root, raw_manifest))
    digest = _digest(
        {chapter.document_id: _sha256_bytes(chapter.markdown.encode()) for chapter in chapters}
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        manifest_path = output / "manifest.yaml"
        if not manifest_path.is_file() or PACK_ID not in manifest_path.read_text(encoding="utf-8"):
            raise HerbalSourceError(f"{output} exists and is not a {PACK_ID} workspace")
    with tempfile.TemporaryDirectory(prefix=f".{output.name}.", dir=output.parent) as temporary:
        workspace = Path(temporary)
        for chapter in chapters:
            (workspace / f"{chapter.document_id}.md").write_text(chapter.markdown, encoding="utf-8")
        pack_manifest = {
            "id": PACK_ID,
            "version": f"0.1.0-{digest.removeprefix('sha256:')[:8]}",
            "schemaVersion": 2,
            "title": "Травник: лекарственные растения",
            "builtAt": str(raw_manifest.get("updatedAt")),
            "publicationState": "local-dev",
        }
        (workspace / "manifest.yaml").write_text(
            yaml.safe_dump(pack_manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        (workspace / "aliases.yaml").write_text(
            yaml.dump(
                {"aliases": _alias_rows(chapters)},
                Dumper=_Dumper,
                allow_unicode=True,
                sort_keys=False,
                width=1_000_000,
            ),
            encoding="utf-8",
        )
        if output.exists():
            shutil.rmtree(output)
        workspace.rename(output)
    return PrepareReport(
        documents=len(chapters),
        plants=len(plants),
        emaExtracted=extracted,
        emaMissing=missing,
        ocrInstructions=ocr,
        grlsMissing=no_grls,
        brewIncomplete=incomplete,
        instructions=chosen,
        output=str(output),
    )


def report_json(report: PrepareReport) -> str:
    return json.dumps(asdict(report), ensure_ascii=False, indent=2)
