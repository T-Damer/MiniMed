"""Prepare the herbal book («Травник») chapters: one per plant plus the ГФ XV infusion rules.

Inputs, all deterministic:

* ``content/herbal/plants.yaml`` — the plant list (ГРЛС names, EMA page, plate);
* ГРЛС: the registry catalog and the prepared instruction texts (``grls-full-final``). One
  representative instruction per plant is chosen (active registration, the plain raw material, a
  text-layer PDF before OCR, loose herb before filter bags, the newest edition); its sections are
  copied verbatim, each paragraph with its PDF pages and blocks;
* EMA: the reviewed extraction ``content/herbal/ema/<plant>.yaml`` (Russian fields with the exact
  English quote, re-checked against the PDF page here); the English text itself is not copied;
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

from .herbal_ema import (
    EmaExtraction,
    ema_documents,
    load_extraction,
    validate_ema_extraction,
)
from .herbal_plants import PLATE_AUTHORS, PLATE_BOOKS, Plant, load_plants

PACK_ID = "minimed.herbal.book"
DOCUMENT_PREFIX = "herbal."
SOURCE_TYPE = "herbal_monograph"
RIGHTS_STATUS = "official-and-attributed-sources"
RIGHTS_BASIS = (
    "ГРЛС: official instructions approved by the Ministry of Health of Russia; EMA/HMPC: "
    "«Reproduction is authorised provided the source is acknowledged»; botanical plates: public "
    "domain (Wikimedia Commons licence checked at fetch time); ГФ XV: official pharmacopoeia"
)
PUBLICATION_DECISION = {
    "decidedAt": "2026-10-18",
    "decidedBy": "project owner",
    "basis": (
        "Herbal book pilot of 30 plants (ГРЛС raw material, EMA/HMPC monographs, public-domain "
        "plates) as an experimental downloadable module for self-education; EMA limits and doses "
        "as Russian structured fields with the English quote on tap"
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
    instructions_root: Path,
) -> list[GrlsChoice]:
    """Prepared national instructions of the plant's plain raw material, best first."""
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
            path = instructions_root / f"{source_id}.md"
            if not path.is_file():
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

    for text, page, block in read_blocks(path):
        text = text.lstrip("#").strip()
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


def _ema_metadata(
    plant: Plant, extraction: EmaExtraction | None, raw_manifest: dict[str, object]
) -> dict[str, object] | None:
    entry = cast("dict[str, dict[str, object]]", raw_manifest["ema"])[plant.id]
    documents = cast("dict[str, dict[str, object]]", entry["documents"])
    base: dict[str, object] = {
        "page": plant.ema.page,
        "lastUpdated": entry.get("lastUpdated"),
        "species": plant.ema.species,
        "documents": {
            kind: {"url": item["url"], "draft": bool(item.get("draft"))}
            for kind, item in documents.items()
        },
    }
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
    year = re.search(r"\b(1[6-9]\d\d)\b", str(plate.get("date") or ""))
    author = PLATE_AUTHORS[plant.plate.book]
    return f"{author}, {year.group(1)}" if year else author


def _aliases(plant: Plant) -> list[str]:
    binomial = " ".join(plant.latin.replace("×", "").split()[:2])
    names = [plant.ru, plant.ru.split()[0].lower(), binomial, *plant.grls.inn]
    names.append(plant.ema.slug.replace("-", " "))
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
) -> Chapter:
    grls_front = (
        cast("dict[str, object]", _front_matter(choice.markdown)["metadata"])
        if choice is not None
        else {}
    )
    plate = cast("dict[str, dict[str, object]]", raw_manifest["plates"])[plant.id]
    files = {
        str(item["path"]): str(item["sha256"])
        for item in cast("list[dict[str, object]]", raw_manifest["files"])
    }
    ema_entry = cast("dict[str, dict[str, object]]", raw_manifest["ema"])[plant.id]
    ema_paths = [
        str(item["path"])
        for item in cast("dict[str, dict[str, object]]", ema_entry["documents"]).values()
    ]
    checksum = _digest(
        {
            **({"grls": str(grls_front["pdfSha256"])} if choice is not None else {}),
            "plate": files[str(plate["path"])],
            **{path: files[path] for path in ema_paths},
            **({"emaExtraction": extraction_sha256} if extraction_sha256 else {}),
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
        else f"ema-{ema_updated}",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": ["phytotherapy"],
        "age_groups": [],
        "source_file": str(grls_front["officialSourceUrl"])
        if choice is not None
        else plant.ema.page,
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
                "thumbnail": thumbnail_data_url(raw_root / str(plate["path"])),
                "plate": {
                    "asset": f"plates/{plant.id}.jpg",
                    "book": PLATE_BOOKS[plant.plate.book],
                    "credit": _plate_credit(plant, plate),
                    "artist": plate.get("artist"),
                    "date": plate.get("date"),
                    "licence": plate.get("licence"),
                    "commonsPage": plate.get("commonsPage"),
                    **({"species": plant.plate.species} if plant.plate.species else {}),
                },
                "ema": _ema_metadata(plant, extraction, raw_manifest),
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
    if choice is not None:
        blocks += _grls_blocks(choice, sections, str(grls_front["officialSourceUrl"]))
    blocks.append("## Источники")
    blocks.append(_marker({"contentMode": "editorial-note"}))
    blocks.append("\n".join(_source_lines(plant, choice, plate, ema_entry)))
    markdown = f"---\n{_front(metadata)}\n---\n\n" + "\n\n".join(blocks) + "\n"
    return Chapter(plant.document_id, plant.ru, markdown, aliases)


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
    plate: dict[str, object],
    ema_entry: dict[str, object],
) -> list[str]:
    lines: list[str] = []
    if choice is not None:
        lines.append(
            f"- Инструкция ГРЛС «{choice.trade_name}», {choice.instruction_label}, {choice.holder}"
            + (" (распознана OCR)" if choice.ocr else "")
        )
    updated = ema_entry.get("lastUpdated")
    lines.append(
        f"- EMA/HMPC: {plant.ema.page}"
        + (f" (обновлено {updated})" if updated else "")
        + ". © European Medicines Agency"
    )
    lines.append(
        f"- Иллюстрация: {plate.get('artist') or PLATE_BOOKS[plant.plate.book]}, "
        f"{plate.get('date') or ''} — {plate.get('licence')}".rstrip(", ")
    )
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


def _load_manifest(path: Path) -> dict[str, list[dict[str, object]]]:
    result: dict[str, list[dict[str, object]]] = {}
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
    instruction_manifest: Path,
    instructions_root: Path,
    raw_root: Path,
    ema_dir: Path,
    output: Path,
) -> PrepareReport:
    plants = load_plants(plants_path)
    raw_manifest = cast(
        "dict[str, object]", json.loads((raw_root / "MANIFEST.json").read_text(encoding="utf-8"))
    )
    records = cast(
        "list[dict[str, object]]", json.loads(catalog.read_text(encoding="utf-8"))["records"]
    )
    manifest = _load_manifest(instruction_manifest)
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
        extraction_path = ema_dir / f"{plant.id}.yaml"
        extraction: EmaExtraction | None = None
        extraction_sha: str | None = None
        if extraction_path.is_file():
            extraction = load_extraction(extraction_path)
            problems = validate_ema_extraction(extraction, ema_documents(raw_root, plant.id))
            if problems:
                raise HerbalSourceError(f"{plant.id}: EMA extraction fails its check: {problems}")
            extraction_sha = _sha256_bytes(extraction_path.read_bytes())
            extracted.append(plant.id)
        else:
            missing.append(plant.id)
        chapter = render_plant(
            plant, choice, sections, extraction, raw_root, raw_manifest, extraction_sha
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
