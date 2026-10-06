"""DDInter 2.0 severity labels as an optional module (INT2, owner decision 2026-10-06).

Input is the bulk CSV the DDInter site offers for download (`data/raw/ddinter/`, 14 files, one
per ATC level-1 letter; a pair that involves two letters appears in both files). A row holds only
the two DDInter drug ids, their English names and one level: `Major`, `Moderate`, `Minor` or
`Unknown`. There are no ATC codes, no descriptions and no mechanism text in the bulk files, and
none is fetched.

What is built is a LABEL table and nothing else:

1. DDInter drug name → ATC level-5 codes, through the English names of the НСИ «АТХ» dictionary
   (`ATC_NAME_ENG`, `data/raw/nsi/atc`). Exact normalised name first; then the same name with salt
   words dropped on both sides; then a small, listed table of USAN → INN spellings
   (`USAN_TO_INN`), each refused if its INN is not an НСИ name. A name with a qualifier in
   parentheses («Dexamethasone (topical)») is a route or formulation variant and is not joined.
2. ATC codes → ЕСКЛП МНН cards of one substance (no combinations): the card's own level-5 codes plus
   the level-5 codes whose Russian НСИ name equals the card's МНН.
3. A DDInter pair becomes a card pair when both drugs reach a card. When several DDInter pairs reach
   the same card pair with different levels the most severe level is kept and the conflict counted.

The pack holds one document per card that is the smaller slug of at least one labelled pair; the
document lists `<partner slug> TAB <level code>`. Documents carry `definitionReference: 1`, which
keeps them out of the ordinary search index, and a source type of their own. No DDInter text is
stored but the level; the module manifest document names the source, the licence (CC BY-NC-SA 4.0)
and the date.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from .models import (
    ContentPack,
    PackChunk,
    PackDocument,
    PackManifest,
    PackSection,
    PackVersion,
)
from .sqlite_builder import repository_root, write_sqlite_pack

REPO_ROOT = repository_root()
RAW_ROOT = REPO_ROOT / "data" / "raw" / "ddinter"
NSI_ATC_ROWS = REPO_ROOT / "data" / "raw" / "nsi" / "atc" / "v3.8" / "rows.json"
ESKLP_DIRECTORY = REPO_ROOT / "data" / "build" / "release-esklp"

MODULE_ID = "minimed.reference.ddinter-severity.ru"
MODULE_TITLE = "Уровни риска взаимодействий по DDInter 2.0"
PACK_VERSION = "ddinter-2.0.2026.10.06"
BUILT_AT = "2026-10-06T00:00:00Z"
SOURCE_URL = "https://ddinter2.scbdd.com/download/"
SITE_URL = "https://ddinter2.scbdd.com/"
TERMS_URL = "https://ddinter2.scbdd.com/terms/"
LICENSE_ID = "CC-BY-NC-SA-4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/"
FILE_URL = "https://ddinter2.scbdd.com/static/media/download/{name}"
DOCUMENT_PREFIX = "ddinter.severity."
MANIFEST_DOCUMENT_ID = f"{DOCUMENT_PREFIX}manifest"
SOURCE_TYPE = "drug_interaction_severity"
CARD_PREFIX = "esklp.mnn."
FORMAT_VERSION = 1
LETTERS = "ABCDGHJLMNPRSV"
CSV_COLUMNS = ("DDInterID_A", "Drug_A", "DDInterID_B", "Drug_B", "Level")

#: DDInter's vocabulary, most severe last, with the one-character code stored in the pack.
LEVELS: tuple[str, ...] = ("Unknown", "Minor", "Moderate", "Major")
LEVEL_CODES: Mapping[str, str] = {"Unknown": "0", "Minor": "1", "Moderate": "2", "Major": "3"}

#: Words that name a salt, ester or hydrate rather than the active moiety; dropped from both sides
#: of the second matching step.
SALT_WORDS: frozenset[str] = frozenset(
    {
        *("hydrochloride", "hcl", "sodium", "potassium", "calcium", "magnesium", "sulfate"),
        *("sulphate", "phosphate", "acetate", "maleate", "fumarate", "tartrate", "citrate"),
        *("succinate", "mesylate", "besylate", "bromide", "chloride", "nitrate", "lactate"),
        *("gluconate", "anhydrous", "monohydrate", "dihydrate", "hydrobromide", "disoproxil"),
        *("dipropionate", "propionate", "valerate", "benzoate", "carbonate", "bicarbonate"),
        *("oxide", "hydroxide"),
    }
)

#: USAN / BAN spellings DDInter uses where the WHO ATC (INN) spelling differs. Each target must be
#: an НСИ «АТХ» English name; `resolve_aliases` refuses the build otherwise. Basis: the target is
#: the INN spelling of the same substance (acetaminophen/paracetamol, glyburide/glibenclamide, …).
USAN_TO_INN: Mapping[str, str] = {
    "acetaminophen": "paracetamol",
    "acyclovir": "aciclovir",
    "albuterol": "salbutamol",
    "amphetamine": "amfetamine",
    "chlorthalidone": "chlortalidone",
    "cholecalciferol": "colecalciferol",
    "cholestyramine": "colestyramine",
    "cyclosporine": "ciclosporin",
    "dextroamphetamine": "dexamfetamine",
    "ethinyl estradiol": "ethinylestradiol",
    "glyburide": "glibenclamide",
    "hydroxyurea": "hydroxycarbamide",
    "indomethacin": "indometacin",
    "isoproterenol": "isoprenaline",
    "lithium carbonate": "lithium",
    "meperidine": "pethidine",
    "methamphetamine": "metamfetamine",
    "methotrimeprazine": "levomepromazine",
    "nitroglycerin": "glyceryl trinitrate",
    "phytonadione": "phytomenadione",
    "picosulfuric acid": "sodium picosulfate",
}


def normalize_name(value: str) -> str:
    """Lower case, letters and digits only, single spaces: «St. John's Wort» → `st john s wort`."""
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def salt_key(value: str) -> str:
    return " ".join(word for word in normalize_name(value).split() if word not in SALT_WORDS)


def normalize_russian(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower().replace("ё", "е")).strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# ---------------------------------------------------------------------------------------- raw


@dataclass(frozen=True)
class RawFile:
    name: str
    sha256: str
    size_bytes: int
    rows: int


@dataclass
class DdinterTable:
    """Every drug and pair of the bulk files."""

    drugs: dict[str, str] = field(default_factory=lambda: {})
    #: Unordered DDInter id pair (sorted) → most severe level seen.
    pairs: dict[tuple[str, str], str] = field(default_factory=lambda: {})
    rows: int = 0
    #: Pairs listed in two files with different levels (should be 0).
    file_conflicts: int = 0
    files: list[RawFile] = field(default_factory=lambda: [])


def severity_rank(level: str) -> int:
    return LEVELS.index(level)


def raw_file_names() -> list[str]:
    return [f"ddinter_downloads_code_{letter}.csv" for letter in LETTERS]


def write_raw_manifest(root: Path, *, retrieved_on: str) -> dict[str, Any]:
    """The checksum manifest of the downloaded files (`MANIFEST.json`)."""
    files: list[dict[str, Any]] = []
    for name in raw_file_names():
        path = root / name
        files.append(
            {
                "name": name,
                "url": FILE_URL.format(name=name),
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
        )
    manifest: dict[str, Any] = {
        "source": "DDInter 2.0",
        "siteUrl": SITE_URL,
        "downloadPage": SOURCE_URL,
        "termsUrl": TERMS_URL,
        "license": LICENSE_ID,
        "licenseUrl": LICENSE_URL,
        "retrievedOn": retrieved_on,
        "note": (
            "The download page links 8 files (A, B, D, H, L, P, R, V); the other six ATC letters "
            "(C, G, J, M, N, S) are served from the same path and are the same format."
        ),
        "files": files,
    }
    (root / "MANIFEST.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def verify_raw_manifest(root: Path) -> dict[str, Any]:
    manifest = cast(dict[str, Any], json.loads((root / "MANIFEST.json").read_text("utf-8")))
    listed = {item["name"]: item for item in cast(list[dict[str, Any]], manifest["files"])}
    if sorted(listed) != sorted(raw_file_names()):
        raise ValueError("MANIFEST.json does not list exactly the 14 DDInter files.")
    for name, item in listed.items():
        path = root / name
        if sha256_file(path) != item["sha256"]:
            raise ValueError(f"{name}: SHA-256 differs from MANIFEST.json.")
    return manifest


def read_table(root: Path) -> DdinterTable:
    """Reads the 14 files; the manifest must match them."""
    verify_raw_manifest(root)
    table = DdinterTable()
    for name in raw_file_names():
        path = root / name
        rows = 0
        with path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            if tuple(reader.fieldnames or ()) != CSV_COLUMNS:
                raise ValueError(f"{name}: unexpected columns {reader.fieldnames}.")
            for row in reader:
                rows += 1
                add_row(table, row)
        table.files.append(RawFile(name, sha256_file(path), path.stat().st_size, rows))
    return table


def add_row(table: DdinterTable, row: Mapping[str, str]) -> None:
    level = row["Level"]
    if level not in LEVEL_CODES:
        raise ValueError(f"Unknown DDInter level {level!r}.")
    first, second = row["DDInterID_A"], row["DDInterID_B"]
    if first == second:
        raise ValueError(f"A DDInter pair of one drug: {first}.")
    for drug_id, name in ((first, row["Drug_A"]), (second, row["Drug_B"])):
        if table.drugs.setdefault(drug_id, name) != name:
            raise ValueError(f"DDInter id {drug_id} has two names.")
    key = (first, second) if first < second else (second, first)
    seen = table.pairs.get(key)
    if seen is not None and seen != level:
        table.file_conflicts += 1
    if seen is None or severity_rank(level) > severity_rank(seen):
        table.pairs[key] = level
    table.rows += 1


# ---------------------------------------------------------------------------------------- ATC


@dataclass(frozen=True)
class AtcSubstance:
    code: str
    name_ru: str
    name_en: str


def read_atc_substances(path: Path = NSI_ATC_ROWS) -> list[AtcSubstance]:
    """The level-5 (7-character) rows of the НСИ «АТХ» dictionary."""
    rows = cast(list[list[dict[str, str]]], json.loads(path.read_text("utf-8")))
    result: list[AtcSubstance] = []
    for row in rows:
        fields = {cell["column"]: cell["value"] for cell in row}
        code = fields["ATC_CODE"]
        if len(code) == 7:
            result.append(AtcSubstance(code, fields["ATC_NAME"], fields["ATC_NAME_ENG"]))
    return sorted(result, key=lambda item: item.code)


@dataclass(frozen=True)
class AtcIndex:
    exact: Mapping[str, frozenset[str]]
    salt: Mapping[str, frozenset[str]]
    by_russian: Mapping[str, frozenset[str]]
    #: Level-5 code → normalised Russian НСИ name.
    russian_of: Mapping[str, str]


def build_atc_index(substances: Iterable[AtcSubstance]) -> AtcIndex:
    exact: dict[str, set[str]] = defaultdict(set)
    salt: dict[str, set[str]] = defaultdict(set)
    by_russian: dict[str, set[str]] = defaultdict(set)
    russian_of: dict[str, str] = {}
    for item in substances:
        russian_of[item.code] = normalize_russian(item.name_ru)
        exact[normalize_name(item.name_en)].add(item.code)
        key = salt_key(item.name_en)
        if key:
            salt[key].add(item.code)
        by_russian[normalize_russian(item.name_ru)].add(item.code)
    return AtcIndex(
        {key: frozenset(value) for key, value in exact.items()},
        {key: frozenset(value) for key, value in salt.items()},
        {key: frozenset(value) for key, value in by_russian.items()},
        russian_of,
    )


def resolve_aliases(index: AtcIndex) -> dict[str, str]:
    """`USAN_TO_INN` with every target checked against the НСИ names."""
    unknown = [
        target
        for target in USAN_TO_INN.values()
        if normalize_name(target) not in index.exact and salt_key(target) not in index.salt
    ]
    if unknown:
        raise ValueError(f"USAN_TO_INN targets that are not НСИ English names: {sorted(unknown)}")
    return {normalize_name(source): target for source, target in USAN_TO_INN.items()}


@dataclass(frozen=True)
class DrugMatch:
    codes: frozenset[str]
    #: `exact`, `salt`, `alias`, `qualifier` (not joined) or `none`.
    method: str


def match_drug_to_atc(name: str, index: AtcIndex, aliases: Mapping[str, str]) -> DrugMatch:
    if "(" in name:
        return DrugMatch(frozenset(), "qualifier")
    normalized = normalize_name(name)
    codes = index.exact.get(normalized)
    if codes:
        return DrugMatch(codes, "exact")
    codes = index.salt.get(salt_key(name)) if salt_key(name) else None
    if codes:
        return DrugMatch(codes, "salt")
    target = aliases.get(normalized)
    if target is not None:
        codes = index.exact.get(normalize_name(target)) or index.salt.get(salt_key(target))
        if codes:
            return DrugMatch(codes, "alias")
    return DrugMatch(frozenset(), "none")


# --------------------------------------------------------------------------------------- cards


@dataclass(frozen=True)
class Card:
    """A ЕСКЛП МНН card, reduced to what the join needs."""

    slug: str
    name: str
    atc_codes: tuple[str, ...]
    components: tuple[str, ...]
    registrations: int = 0

    @property
    def single(self) -> bool:
        return len(self.components) <= 1 and "+" not in self.name


def read_cards(directory: Path = ESKLP_DIRECTORY) -> list[Card]:
    cards: list[Card] = []
    for path in sorted(directory.glob("*.db")):
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
            for card_id, title, metadata_json in connection.execute(
                "SELECT id, title, metadata_json FROM documents WHERE id LIKE 'esklp.mnn.%'"
            ):
                metadata = cast(dict[str, Any], json.loads(metadata_json))
                registrations: set[str] = set()
                for node in cast(list[dict[str, Any]], metadata.get("smnnNodes") or []):
                    for key in ("tradeNames", "klpPositions"):
                        for item in cast(list[dict[str, Any]], node.get(key) or []):
                            number = item.get("registrationNumber")
                            if isinstance(number, str) and number:
                                registrations.add(number)
                name = metadata.get("standardizedInn")
                cards.append(
                    Card(
                        slug=str(card_id)[len(CARD_PREFIX) :],
                        name=name if isinstance(name, str) and name else str(title),
                        atc_codes=tuple(_strings(metadata.get("atcCodes"))),
                        components=tuple(_strings(metadata.get("componentInns"))),
                        registrations=len(registrations),
                    )
                )
    return sorted(cards, key=lambda card: card.slug)


def _strings(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in cast(list[object], value) if isinstance(item, str)]


def first_word(value: str) -> str:
    words = normalize_russian(value).split()
    return words[0] if words else ""


def card_codes(card: Card, index: AtcIndex) -> frozenset[str]:
    """The level-5 ATC codes of one single-substance card.

    The ЕСКЛП card lists every ATC code of every registration it groups, and that list can carry a
    neighbour's code (a caffeine card with a dexamethasone code), so a code counts only when the
    НСИ name agrees with the card: the codes whose Russian НСИ name equals the card's МНН; or, when
    none does («ТЕСТОСТЕРОН [СМЕСЬ ЭФИРОВ]»), the card's own level-5 codes whose НСИ name starts
    with the same first word. Anything else is left unjoined.
    """
    named = index.by_russian.get(normalize_russian(card.name))
    if named:
        return named
    head = first_word(card.name)
    own = {
        code
        for code in card.atc_codes
        if len(code) == 7 and head and first_word(index.russian_of.get(code, "")) == head
    }
    return frozenset(own)


# ---------------------------------------------------------------------------------------- join


@dataclass
class JoinResult:
    #: (smaller slug, larger slug) → level.
    labels: dict[tuple[str, str], str]
    drug_methods: dict[str, str]
    drug_cards: dict[str, frozenset[str]]
    pairs_total: int
    pairs_joined_to_cards: int
    card_conflicts: int


def join_table(
    table: DdinterTable,
    cards: Sequence[Card],
    index: AtcIndex,
    aliases: Mapping[str, str],
) -> JoinResult:
    cards_by_code: dict[str, set[str]] = defaultdict(set)
    single = [card for card in cards if card.single]
    for card in single:
        for code in card_codes(card, index):
            cards_by_code[code].add(card.slug)
    drug_methods: dict[str, str] = {}
    drug_cards: dict[str, frozenset[str]] = {}
    for drug_id, name in table.drugs.items():
        match = match_drug_to_atc(name, index, aliases)
        drug_methods[drug_id] = match.method
        found: set[str] = set()
        for code in match.codes:
            found |= cards_by_code.get(code, set())
        drug_cards[drug_id] = frozenset(found)
    labels: dict[tuple[str, str], str] = {}
    joined = 0
    conflicts = 0
    for (first, second), level in table.pairs.items():
        left, right = drug_cards[first], drug_cards[second]
        if not left or not right:
            continue
        joined += 1
        for a in left:
            for b in right:
                if a == b:
                    continue
                key = (a, b) if a < b else (b, a)
                seen = labels.get(key)
                if seen is not None and seen != level:
                    conflicts += 1
                if seen is None or severity_rank(level) > severity_rank(seen):
                    labels[key] = level
    return JoinResult(labels, drug_methods, drug_cards, len(table.pairs), joined, conflicts)


# ----------------------------------------------------------------------------------------- pack


def severity_document_text(partners: Sequence[tuple[str, str]]) -> str:
    """`<partner slug> TAB <level code>` lines, sorted by slug."""
    return "\n".join(f"{slug}\t{LEVEL_CODES[level]}" for slug, level in sorted(partners))


def parse_severity_text(text: str) -> dict[str, str]:
    """The reverse of `severity_document_text`: partner slug → level name (for tests and checks)."""
    names = {code: level for level, code in LEVEL_CODES.items()}
    result: dict[str, str] = {}
    for line in text.splitlines():
        slug, _, code = line.partition("\t")
        if slug and code in names:
            result[slug] = names[code]
    return result


def _document(
    document_id: str,
    title: str,
    section_title: str,
    text: str,
    metadata: dict[str, object],
    source_checksum: str,
) -> PackDocument:
    version_id = f"{document_id}@{PACK_VERSION}"
    section_id = f"{version_id}/section-1"
    chunk_id = f"{section_id}/chunk-1"
    return PackDocument(
        id=document_id,
        title=title,
        short_title=None,
        source_type=SOURCE_TYPE,
        status="active",
        specialties=[],
        metadata={"definitionReference": 1, "ddinterSeverity": True, **metadata},
        version=PackVersion(
            id=version_id,
            label=PACK_VERSION,
            source_checksum=source_checksum,
            extracted_at=BUILT_AT,
        ),
        sections=[
            PackSection(
                id=section_id,
                title=section_title,
                normalized_title=section_title.lower(),
                section_type="data",
                depth=1,
                order_index=0,
                anchor=f"{version_id}/section-1",
                section_path=[section_title],
                chunks=[
                    PackChunk(
                        id=chunk_id,
                        order_index=0,
                        original_text=text,
                        normalized_text=text.lower(),
                        anchor=f"{version_id}/section-1/chunk-1",
                    )
                ],
            )
        ],
    )


def manifest_text(summary: Mapping[str, object]) -> str:
    return "\n".join(
        [
            "Метки степени риска взаимодействий лекарственных средств из базы DDInter 2.0.",
            "Это международная база данных, а не инструкции препаратов. В модуле хранятся только "
            "метки (Major / Moderate / Minor / Unknown) для пар веществ; описаний, механизмов и "
            "рекомендаций базы здесь нет.",
            f"Источник: DDInter 2.0, {SITE_URL} (Xiangya Hospital / Computational Biology & Drug "
            "Design Group, Central South University); файлы получены "
            f"{summary['retrievedOn']}.",
            f"Лицензия: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 ({LICENSE_ID}), "
            f"{LICENSE_URL}. Использование некоммерческое; производные данные распространяются на "
            "тех же условиях.",
            f"Пар с метками: {summary['labelledPairs']}; веществ ЕСКЛП с метками: "
            f"{summary['cardsWithLabels']}.",
        ]
    )


def build_pack(
    join: JoinResult,
    raw_manifest: Mapping[str, Any],
    summary: Mapping[str, object],
) -> ContentPack:
    by_first: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for (first, second), level in join.labels.items():
        by_first[first].append((second, level))
    manifest_checksum = hashlib.sha256(
        json.dumps(raw_manifest, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    documents = [
        _document(
            MANIFEST_DOCUMENT_ID,
            MODULE_TITLE,
            "Источник и лицензия",
            manifest_text(summary),
            {
                "formatVersion": FORMAT_VERSION,
                "levelCodes": dict(LEVEL_CODES),
                "source": "DDInter 2.0",
                "sourceUrl": SITE_URL,
                "license": LICENSE_ID,
                "licenseUrl": LICENSE_URL,
                "retrievedOn": summary["retrievedOn"],
                "labelledPairs": summary["labelledPairs"],
            },
            f"sha256:{manifest_checksum}",
        )
    ]
    for slug in sorted(by_first):
        text = severity_document_text(by_first[slug])
        documents.append(
            _document(
                f"{DOCUMENT_PREFIX}{slug}",
                MODULE_TITLE,
                "Пары",
                text,
                {"cardSlug": slug, "pairs": len(by_first[slug])},
                f"sha256:{hashlib.sha256(text.encode('utf-8')).hexdigest()}",
            )
        )
    return ContentPack(
        manifest=PackManifest(
            id=MODULE_ID,
            version=PACK_VERSION,
            schema_version=2,
            title=MODULE_TITLE,
            built_at=BUILT_AT,
        ),
        documents=documents,
    )


def summarize(
    table: DdinterTable,
    cards: Sequence[Card],
    join: JoinResult,
    index: AtcIndex,
    retrieved_on: str,
) -> dict[str, object]:
    singles = [card for card in cards if card.single]
    labelled_cards = {slug for pair in join.labels for slug in pair}
    methods = Counter(join.drug_methods.values())
    matched_drugs = sum(1 for found in join.drug_cards.values() if found)
    pair_counts: Counter[str] = Counter()
    for first, second in table.pairs:
        pair_counts[first] += 1
        pair_counts[second] += 1
    unmatched = sorted(
        (
            (pair_counts[drug_id], table.drugs[drug_id], join.drug_methods[drug_id])
            for drug_id, found in join.drug_cards.items()
            if not found
        ),
        reverse=True,
    )
    top_cards = sorted(singles, key=lambda card: (-card.registrations, card.slug))[:200]
    top_labelled = [card for card in top_cards if card.slug in labelled_cards]
    top_slugs = {card.slug for card in top_cards}
    top_pairs = sum(1 for a, b in join.labels if a in top_slugs and b in top_slugs)
    ready = sum(1 for card in singles if card_codes(card, index))
    return {
        "retrievedOn": retrieved_on,
        "rows": table.rows,
        "ddinterDrugs": len(table.drugs),
        "ddinterPairs": len(table.pairs),
        "ddinterPairLevels": dict(Counter(table.pairs.values())),
        "fileConflicts": table.file_conflicts,
        "drugJoinMethods": dict(methods),
        "ddinterDrugsJoinedToACard": matched_drugs,
        "ddinterDrugsJoinedShare": round(matched_drugs / len(table.drugs), 4),
        "esklpCards": len(cards),
        "esklpSingleSubstanceCards": len(singles),
        "singleCardsWithALevel5Code": ready,
        "cardsWithLabels": len(labelled_cards),
        "singleCardsWithLabelsShare": round(len(labelled_cards) / len(singles), 4),
        "top200Substances": len(top_cards),
        "top200WithLabels": len(top_labelled),
        "top200PairsLabelled": top_pairs,
        "top200PairsTotal": len(top_cards) * (len(top_cards) - 1) // 2,
        "ddinterPairsJoinedToCards": join.pairs_joined_to_cards,
        "ddinterPairsJoinedShare": round(join.pairs_joined_to_cards / len(table.pairs), 4),
        "labelledPairs": len(join.labels),
        "labelledPairLevels": dict(Counter(join.labels.values())),
        "cardPairConflicts": join.card_conflicts,
        "unmatchedDrugsByPairCount": [
            {"pairs": count, "name": name, "method": method}
            for count, name, method in unmatched[:60]
        ],
    }


def build_module(
    out_dir: Path,
    *,
    raw_root: Path = RAW_ROOT,
    atc_rows: Path = NSI_ATC_ROWS,
    esklp_directory: Path = ESKLP_DIRECTORY,
) -> dict[str, object]:
    """Builds `OUT/raw/<module id>.db` and `OUT/report.json`; the output must not exist yet."""
    target = out_dir / "raw" / f"{MODULE_ID}.db"
    if target.exists():
        raise ValueError(f"{target} exists; the output is immutable, choose a new directory.")
    raw_manifest = verify_raw_manifest(raw_root)
    table = read_table(raw_root)
    index = build_atc_index(read_atc_substances(atc_rows))
    cards = read_cards(esklp_directory)
    join = join_table(table, cards, index, resolve_aliases(index))
    summary = summarize(table, cards, join, index, str(raw_manifest["retrievedOn"]))
    write_sqlite_pack(build_pack(join, raw_manifest, summary), target)
    report = {
        "moduleId": MODULE_ID,
        "version": PACK_VERSION,
        "rawFiles": [
            {"name": item.name, "sha256": item.sha256, "bytes": item.size_bytes, "rows": item.rows}
            for item in table.files
        ],
        **summary,
    }
    (out_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report
