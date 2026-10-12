# ruff: noqa: E501
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from localmed_ingest.builder import build_content_pack, lint_content_pack, load_content_pack
from localmed_ingest.diets_distribution import package_diets_module
from localmed_ingest.diets_official import (
    OFFICIAL_NUMBERED_DIETS,
    VARIANTS,
    DietsSourceError,
    gfm_tables,
    number_sign,
    prepare_diets_official,
    read_extracted,
)

NAMES_330 = [
    "Основной вариант стандартной диеты",
    "Вариант диеты с механическим и химическим щажением",
    "Вариант диеты с повышенным количеством белка (высокобелковая диета)",
    "Вариант диеты с пониженным количеством белка (низкобелковая диета)",
    "Вариант диеты с пониженной калорийностью (низкокалорийная диета)",
    "Вариант диеты с повышенной калорийностью (высококалорийная диета)",
]
ABBREVIATIONS = ["ОВД", "ЩД", "ВБД", "НБД", "НКД", "ВКД"]
KEYS = ["ovd", "shd", "vbd", "nbd", "nkd", "vkd"]
ADULT_NAMES = [
    "Основной вариант стандартной диеты",
    "Вариант диеты с механическим и химическим щажением",
    "Вариант диеты с повышенным количеством белка (высокобелковая диета)",
    "Вариант диеты с пониженным количеством белка (низкобелковая диета)",
    "Вариант диеты с пониженной калорийностью (низкокалорийная диета)",
    "Вариант диеты с повышенной калорийностью (высококалорийная диета)",
]
CHILD_ROWS = [
    ("Основной вариант стандартной диеты<br>(ОВД)", ""),
    (
        "Вариант диеты с химическим и механическим щажением<br>(ЩЦ)"
        "<br>Используется как основа для индивидуальных диет",
        "",
    ),
    (
        "Вариант диеты с повышенным количеством белка и повышенной калорийностью "
        "(высокобелковая высококалорийная диета)<br>(ВБКД)",
        "",
    ),
    ("Вариант диеты с пониженным количеством белка (НБД)", ""),
    ("Вариант диеты с пониженной калорийностью (низкокалорийная диета)<br>(НКД)", ""),
    ("Вариант стандартной диеты для беременных и кормящих женщин", ""),
]
FOOTER = "| Продукт | брутто | нетто |"


def _table_330() -> str:
    head = (
        "| Стандартные диеты | Диеты номерной системы (диеты N N 1 - 15) | Показания к применению "
        "| Общая характеристика, кулинарная обработка | Белки, в т.ч. животные, г "
        "| Жиры общие, в т.ч. растительные, г | Углеводы общие, в т.ч. моно- и дисахариды, г "
        "| Энергетическая ценность, ккал |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |\n|---|---|---|---|---|---|---|---|\n"
    )
    rows: list[str] = []
    for name, key in zip(NAMES_330, KEYS, strict=True):
        codes = ", ".join(OFFICIAL_NUMBERED_DIETS[key])
        rows.append(
            f"| {name} | {codes} | Показание {key} один.<br>Показание {key} два. "
            f"| Характеристика {key} один.<br>Характеристика {key} два. "
            "| 85 - 90<br>-------<br>40 - 45 | 70 - 80<br>-------<br>25 - 30 "
            "| 300 - 330<br>---------<br>30 - 40<br>(сахар исключается) | 2170 - 2400 |"
        )
    return head + "\n".join(rows) + "\n"


def _table_1a() -> str:
    lines = [
        "| Диеты | Белки, в том числе животные, г | Жиры, г | Углеводы, г | Энергетическая ценность, ккал |",
        "|---|---|---|---|---|",
    ]
    for name in NAMES_330:
        lines += [
            f"| {name} |  |  |  |  |",
            "| Химический состав и энергетическая ценность диеты | 85 - 90<br>(40 - 45) | 70 - 80 | 300 | 2170 |",
            "| Натуральные продукты питания | 69 - 72 | 62 - 71 | 288 | 1990 |",
            "| Специализированные пищевые продукты (смесь белковая композитная сухая) | 16 | 8 | 12 | 180 |",
        ]
    return "\n".join(lines) + "\n"


def _extracted_330() -> str:
    return f"""# Order 330 (synthetic)

---

С целью оптимизации лечебного питания вводится новая номенклатура диет.
Ранее применявшиеся диеты номерной системы (диеты N N 1 - 15) объединяются.
Наряду с основной стандартной диетой используются:
- хирургические диеты;
- специализированные диеты;
- разгрузочные диеты;
- специальные рационы.
Индивидуализация химического состава и калорийности стандартных диет осуществляется иначе.
Таблица 1
к Инструкции по организации
лечебного питания
в лечебно-профилактических
учреждениях
ХАРАКТЕРИСТИКА СТАНДАРТНЫХ ДИЕТ

<!-- Таблица 1 of the Instruction -->
{_table_330()}
Таблица 1а
к Инструкции по организации
лечебного питания
в лечебно-профилактических
учреждениях
Соотношение натуральных продуктов питания

<!-- Таблица 1а -->
{_table_1a()}
Таблица 2
к Инструкции по организации
Утратил силу.
Таблица 2а
к Инструкции по организации
лечебного питания
в лечебно-профилактических
учреждениях
Набор продуктов в противотуберкулезных учреждениях

<!-- Таблица 2а -->
| Наименование продуктов | Количество продуктов в граммах | ^< |
|---|---|---|
|  | брутто | нетто |
| 1 | 2 | 3 |
| Хлеб ржаной | 150 | 150 |
| Картофель: |  |  |
| с 1 марта | 500 | 300 |
| Другие овощи<br>из них:<br>капуста белокочанная | 505<br>275 | 500<br>220 |
|  | ^< | ^< |
| Сахар <*> | 50 | 50 |

--------------------------------
<*> Рафинированные углеводы исключаются.
Примечания:
1. Набор дополняется смесью.
Таблица 3
к Инструкции по организации
лечебного питания
в лечебно-профилактических
учреждениях
НАБОР ДЛЯ ВЗРОСЛЫХ

<!-- Таблица 3 (adult) -->
| Наименование продуктов | Количество продуктов в граммах | ^< |
|---|---|---|
|  | брутто | нетто |
| 1 | 2 | 3 |
| Картофель:<br>с 1 сентября<br>с 1 ноября | 275<br>294 | 206<br>206 |
Таблица 4
к Инструкции по организации
лечебного питания
в лечебно-профилактических
учреждениях
НАБОРЫ ДЛЯ ДЕТЕЙ

<!-- Таблица 4 (children) -->
| Продукты | Количество в сутки на одного ребенка в возрасте | ^< | ^< |
|---|---|---|---|
|  | 1 - 3 года | 4 - 6 лет | 7 - 10 лет |
| 1 | 2 | 3 | 4 |
| Хлеб пшеничный | 60 | 100 | 150 |
Таблица 5
к Инструкции по организации
лечебного питания
в лечебно-профилактических
учреждениях
НАБОРЫ ПРИ РАДИАЦИИ

<!-- Таблица 5 (radiation) -->
| Продукты | Количество в сутки на одного ребенка в возрасте | ^< | ^< |
|---|---|---|---|
|  | 4 - 6 лет | 7 - 10 лет | 11 - 17 лет |
| 1 | 2 | 3 | 4 |
| Хлеб пшеничный | 100 | 100 | 150 |
Таблица 6
к Инструкции по организации
лечебного питания
в лечебно-профилактических
учреждениях
ВЗАИМОЗАМЕНЯЕМОСТЬ ПРОДУКТОВ

<!-- Таблица 6 (interchangeability) -->
| Заменяемые | Масса, кг | Заменяющие | Эквивалент, кг | Использование |
|---|---|---|---|---|
| 1 | 2 | 3 | 4 | 5 |
| Яйца без скорлупы | 1,00 | Яичный меланж | 1,00 | В блюдах |
Примечания. 1. Масла одинаково.
Таблица 7
к Инструкции по организации
лечебного питания
в лечебно-профилактических
учреждениях
ЗАМЕНА ПРОДУКТОВ

<!-- Таблица 7 (substitution) -->
| Наименование продуктов | Кол-во, г | Химический состав | ^< | ^< | Добавить |
|---|---|---|---|---|---|
|  |  | Белки, г | Жиры, г | Углеводы, г |  |
| 1 | 2 | 3 | 4 | 5 | 6 |
| Замена хлеба | ^< | ^< | ^< | ^< | ^< |
| Хлеб пшеничный | 100 | 7,5 | 2,9 | 51,4 |  |
| Замена мяса | ^< | ^< | ^< | ^< | ^< |
| Говядина II к. | 90 | 18,0 | 8,82 | - | масло<br>+7 г |
"""


def _extracted_395() -> str:
    header = (
        "| Наименования продуктов | "
        + " | ^< | ".join(
            f"Нормы при соблюдении {name}"
            for name in (
                "стандартной диеты",
                "диеты с щажением",
                "диеты с повышенным количеством белка",
                "диеты с пониженным количеством белка",
                "диеты с пониженной калорийностью",
                "диеты с повышенной калорийностью",
            )
        )
        + " | ^< |\n"
    )
    width = "| --- " * 13
    rows = [
        "|  | " + " | ".join(["Брутто", "Нетто"] * 6) + " |",
        f"|{width[1:]}|",
        "| Хлеб ржаной | 150 | 150 | - | - | 150 | 150 | 100 | 100 | 100 | 100 | 150 | 150 |",
        "|  | " + " | ".join(["^<"] * 12) + " |",
        "| Колбаса | 12 | 12 | 12 | 12 | 12 | 12 | - | - | - | - | 16 | 16 |",
    ]
    return "<!-- Приложение: Нормы -->\n" + header + "\n".join(rows) + "\n"


def _adult_rows() -> str:
    return "\n".join(
        f"| {i}. | {name}<br>({abbr}) | Показания взрослых {abbr}. | Характеристика взрослых {abbr}. |"
        for i, (name, abbr) in enumerate(zip(ADULT_NAMES, ABBREVIATIONS, strict=True), start=1)
    )


def _extracted_1008() -> str:
    items = "\n".join(
        f"{n}. "
        + ("Настоящий Порядок" if n == 1 else "Пункт")
        + f" {n} порядка."
        + ("\nПродолжение пункта 10." if n == 10 else "")
        for n in range(1, 16)
    )
    child = "\n".join(
        f"| {i}. | {label} | Показания детей {i}. | Характеристика детей {i}. |"
        for i, (label, _x) in enumerate(CHILD_ROWS, start=1)
    )
    return f"""# Order 1008n (synthetic)

ПОРЯДОК
{items}
Приложение N 1
к порядку

<!-- Приложение N 2: nomenclature -->
| N | Номенклатура стандартных диет | Показания к применению | Общая характеристика |
|---|---|---|---|
{_adult_rows()}

Приложение N 3

<!-- Приложение N 3: children -->
| N | Номенклатура стандартных диет | Показания к применению | Общая характеристика |
|---|---|---|---|
{child}
"""


def _source_json(files: dict[str, str]) -> str:
    return json.dumps(
        {
            "files": [
                {
                    "file": name,
                    "url": url,
                    "fetched_at": "2026-10-12T17:00:00Z",
                    "sha256": "0" * 64,
                }
                for name, url in files.items()
            ]
        }
    )


def _raw(root: Path, *, corrupt_codes: bool = False) -> Path:
    raw = root / "raw"
    spec = {
        "order-330-2003": (
            _extracted_330(),
            {
                "legalacts_prikaz-330_ed-2024-02-19.html": "https://legalacts.ru/330",
                "consultant_cons_doc_LAW_44323_toc.html": "https://www.consultant.ru/330",
            },
        ),
        "order-395n-2013": (
            _extracted_395(),
            {
                "legalacts_prikaz-395n_ed-2024-02-19.html": "https://legalacts.ru/395",
                "minzdrav_documents_5407_page.html": "https://minzdrav.gov.ru/395",
            },
        ),
        "order-1008n-2020": (
            _extracted_1008(),
            {
                "legalacts_prikaz-1008n.html": "https://legalacts.ru/1008",
                "publication_pravo_gov_0001202010010037.html": "https://publication.pravo.gov.ru/1008",
            },
        ),
        "order-70n-2024": (
            "# 70n\n",
            {
                "garant_prime_408653843.html": "https://garant.ru/70",
                "publication_pravo_gov_0001202403220011.html": "https://publication.pravo.gov.ru/70",
            },
        ),
    }
    for slug, (text, files) in spec.items():
        folder = raw / slug
        folder.mkdir(parents=True)
        if corrupt_codes and slug == "order-330-2003":
            text = text.replace("7б, 7а", "7б")
        (folder / "extracted.md").write_text(text, encoding="utf-8")
        (folder / "SOURCE.json").write_text(_source_json(files), encoding="utf-8")
    return raw


def test_number_sign_restores_the_sign_before_numbers() -> None:
    assert number_sign("диеты N N 1 - 15") == "диеты №№ 1 - 15"
    assert number_sign("приложению N 3") == "приложению № 3"
    assert number_sign("R-I и Norm") == "R-I и Norm"


def test_gfm_tables_split_long_tables_and_repeat_the_header() -> None:
    rows = [[f"Продукт {i}", "x" * 200] for i in range(30)]
    pieces = gfm_tables(["А", "Б"], rows)
    assert len(pieces) > 1
    assert all(piece.startswith("| А | Б |") for piece in pieces)
    assert all(len(piece) <= 2800 + 220 for piece in pieces)
    assert sum(piece.count("\n| Продукт") for piece in pieces) == 30
    with pytest.raises(DietsSourceError):
        gfm_tables(["А"], [["1", "2"]])


def test_read_extracted_finds_tables_titles_and_notes(tmp_path: Path) -> None:
    raw = _raw(tmp_path)
    parsed = read_extracted(raw / "order-330-2003" / "extracted.md")
    table_2a = parsed.tables["Таблица 2а"]
    assert table_2a.title == "Набор продуктов в противотуберкулезных учреждениях"
    assert [cell for row in table_2a.header for cell in row][:3] == [
        "Наименование продуктов",
        "Количество продуктов в граммах",
        "^<",
    ]
    assert table_2a.notes == (
        "<*> Рафинированные углеводы исключаются.",
        "Примечания:",
        "1. Набор дополняется смесью.",
    )
    assert parsed.tables["Таблица 3"].title == "Набор для взрослых"
    assert "Таблица 2" not in parsed.tables
    assert parsed.tables["Таблица 7"].rows[0][0] == "Замена хлеба"


def test_prepare_writes_documents_aliases_and_applies_the_scan_correction(tmp_path: Path) -> None:
    raw = _raw(tmp_path)
    output = tmp_path / "workspace"
    report = prepare_diets_official(raw, output)
    assert report.documents == 10
    assert [item["official"] for item in report.corrections] == ["(ЩД)"]
    names = sorted(path.name for path in output.glob("*.md"))
    assert names == sorted(
        f"reference.diets.{key}.md"
        for key in [*KEYS, "system", "children-pregnancy", "norms-395n", "instruction-tables"]
    )

    ovd = (output / "reference.diets.ovd.md").read_text(encoding="utf-8")
    assert "Диеты номерной системы: Стол №1, Стол №2, Стол №3, Стол №5" in ovd
    assert "- Показание ovd один.\n- Показание ovd два." in ovd
    assert "| Белки, г | 85 - 90 | животные: 40 - 45 |" in ovd
    assert "моно- и дисахариды: 30 - 40; сахар исключается" in ovd
    assert "| Хлеб ржаной | 150 | 150 |" in ovd
    assert "Колбаса" in ovd
    assert "Приказ Минздрава России №330 от 05.08.2003, ред. от 19.02.2024" in ovd
    shd = (output / "reference.diets.shd.md").read_text(encoding="utf-8")
    assert "Хлеб ржаной" not in shd  # dash in both columns: not in this variant's set
    nbd = (output / "reference.diets.nbd.md").read_text(encoding="utf-8")
    assert "Колбаса" not in nbd

    children = (output / "reference.diets.children-pregnancy.md").read_text(encoding="utf-8")
    assert "(ЩД)" in children and "(ЩЦ)" not in children
    assert "Продолжение пункта 10." in children
    assert "Используется как основа для индивидуальных диет" in children

    system = (output / "reference.diets.system.md").read_text(encoding="utf-8")
    assert "| Стол №11 | ВБД, ВКД |" in system
    assert "Диеты №12 в таблице нет." in system

    norms = (output / "reference.diets.norms-395n.md").read_text(encoding="utf-8")
    assert "| ОВД брутто | ОВД нетто |" in norms
    assert norms.count("| Колбаса |") == 1

    tables = (output / "reference.diets.instruction-tables.md").read_text(encoding="utf-8")
    assert "| капуста белокочанная | 275 | 220 |" in tables
    assert "| Другие овощи | 505 | 500 |" in tables
    assert "| с 1 ноября | 294 | 206 |" in tables
    assert "Количество в сутки на одного ребенка в возрасте\n\n| Продукты | 1 - 3 года |" in tables
    assert "Химический состав: Белки, г" in tables
    assert "| Говядина II к. | 90 | 18,0 | 8,82 | - | масло +7 г |" in tables
    assert tables.count("не сверены построчно") == 1

    metadata = yaml.safe_load(ovd.split("\n---\n", 1)[0].removeprefix("---\n"))
    assert metadata["id"] == "reference.diets.ovd"
    assert metadata["metadata"]["navigationAliases"][0] == "стол 1"
    assert metadata["metadata"]["rightsStatus"] == "official-act-not-copyrighted"
    alias_file = yaml.safe_load((output / "aliases.yaml").read_text(encoding="utf-8"))
    pairs = {(row["alias"], row["canonicalTerm"]) for row in alias_file["aliases"]}
    assert ("стол 5", "Основной вариант стандартной диеты (ОВД)") in pairs
    assert ("395н", "Нормы лечебного питания (приказ №395н)") in pairs
    ids = [row["id"] for row in alias_file["aliases"]]
    assert len(ids) == len(set(ids))


def test_prepare_is_deterministic_and_replaces_only_its_own_workspace(tmp_path: Path) -> None:
    raw = _raw(tmp_path)
    first = tmp_path / "one"
    second = tmp_path / "two"
    prepare_diets_official(raw, first)
    prepare_diets_official(raw, second)
    assert {p.name: p.read_bytes() for p in first.iterdir()} == {
        p.name: p.read_bytes() for p in second.iterdir()
    }
    prepare_diets_official(raw, first)  # replaces its own workspace
    foreign = tmp_path / "foreign"
    foreign.mkdir()
    (foreign / "keep.txt").write_text("x", encoding="utf-8")
    with pytest.raises(DietsSourceError, match=r"not a minimed\.diets\.official workspace"):
        prepare_diets_official(raw, foreign)
    assert (foreign / "keep.txt").exists()


def test_a_changed_numbered_diet_list_stops_the_preparer(tmp_path: Path) -> None:
    raw = _raw(tmp_path, corrupt_codes=True)
    with pytest.raises(DietsSourceError, match="numbered diets differ"):
        prepare_diets_official(raw, tmp_path / "workspace")


def test_workspace_lints_builds_and_packages(tmp_path: Path) -> None:
    raw = _raw(tmp_path)
    workspace = tmp_path / "workspace"
    prepare_diets_official(raw, workspace)
    assert lint_content_pack(load_content_pack(workspace)) == []
    database = tmp_path / "diets.db"
    build_content_pack(workspace, database, include_embeddings=False, compact_search_text=True)
    report = package_diets_module(
        database, tmp_path / "release", version="2026.10.12", min_app_version="0.6.59"
    )
    assert report["documents"] == 10
    entry = json.loads(Path(str(report["catalogEntry"])).read_text(encoding="utf-8"))
    assert entry["id"] == "minimed.reference.diets.ru"
    assert entry["collection"] == "diets"
    assert entry["kind"] == "reference"
    assert entry["releaseState"] == "preview"
    assert entry["compatibility"]["minAppVersion"] == "0.6.59"
    assert len(entry["documents"]) == 10
    assert {variant.abbreviation for variant in VARIANTS} <= set(report["dietVariants"])  # type: ignore[arg-type]
