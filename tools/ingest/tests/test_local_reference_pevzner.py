"""Tests with a tiny synthetic mes.sqlite: no row of the real compilation is used."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

import localmed_ingest.local_reference_common as common
import localmed_ingest.local_reference_pevzner as pevzner
from localmed_ingest.builder import build_content_pack, lint_content_pack, load_content_pack
from localmed_ingest.local_reference_common import RIGHTS_STATUS, package_local_module
from localmed_ingest.local_reference_pevzner import (
    SPEC,
    prepare_pevzner_diets,
    variant_line,
    variants_of,
)

SCHEMA = """
CREATE TABLE therapeutic_diets (id integer PRIMARY KEY, title text, indications text,
  purpose text, general text, composition text, diet text, products text, menu text,
  indications_upper text, memo text);
CREATE TABLE standard_diets (id integer PRIMARY KEY, title text, indications text, general text,
  composition text, diet text, indications_upper text);
CREATE TABLE standard_therapeutic_diets (id integer PRIMARY KEY, title text,
  standard_diet_id text, therapeutic_diet_id text);
"""


def _allow_any_path(_path: Path) -> None:
    return None


@pytest.fixture(autouse=True)
def tmp_outputs_are_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    """The guard needs a git checkout; the tests write under pytest's temporary directory."""
    monkeypatch.setattr(common, "ensure_gitignored", _allow_any_path)
    monkeypatch.setattr(pevzner, "ensure_gitignored", _allow_any_path)


def make_database(path: Path, *, extra_mapping: bool = False) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(SCHEMA)
    connection.executemany(
        "INSERT INTO therapeutic_diets VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                1,
                "5",
                "<ol><li>Синтетическое показание один.</li><li>Показание два.</li></ol>",
                "<p>Синтетическая цель.</p>",
                "<p>Характеристика.</p><p>Вторая строка.</p>",
                "<p>Белки – 1 г.</p>",
                "дробный, 4 раза в день",
                "<ul><li><em>Хлеб.</em> Вчерашний. Исключают: свежий.</li></ul>",
                "<ul><li><em>Завтрак:</em> каша.</li></ul>",
                "",
                None,
            ),
            (
                2,
                "5п",
                "<p>Показание.</p>",
                "<p>Цель.</p>",
                "<p>Х.</p>",
                "<p>С.</p>",
                "5 раз",
                None,
                None,
                "",
                None,
            ),
            (
                3,
                "1а",
                "<p>Без варианта.</p>",
                "<p>Цель.</p>",
                "<p>Х.</p>",
                "<p>С.</p>",
                "6 раз",
                "<p>П.</p>",
                "<p>М.</p>",
                "",
                "<p>памятка</p>",
            ),
        ],
    )
    connection.executemany(
        "INSERT INTO standard_diets (id, title) VALUES (?,?)",
        [(1, "Основной вариант стандартной диеты (ОВД)"), (2, "Щадящая (ЩД)"), (3, "Белок (ВБД)")],
    )
    mapping = [
        (1, "5", "1", "1"),
        (2, "5п (I вариант)", "2", "2"),
        (3, "5п (II вариант)", "3", "2"),
    ]
    if extra_mapping:
        mapping.append((4, "1а", "1", "3"))
    connection.executemany("INSERT INTO standard_therapeutic_diets VALUES (?,?,?,?)", mapping)
    connection.commit()
    connection.close()


def test_variants_follow_the_official_mapping() -> None:
    assert variants_of("5") == [("ОВД", "")]
    assert variants_of("5п") == [("ЩД", "I вариант"), ("ВБД", "II вариант")]
    assert variants_of("11") == [("ВБД", ""), ("ВКД", "")]
    assert variants_of("1а") == []
    assert variant_line("7б") == "Стандартная диета по приказу №330: НБД."
    assert variant_line("5п") == (
        "Стандартная диета по приказу №330: ЩД (I вариант), ВБД (II вариант)."
    )
    assert variant_line("4") is None


def test_workspace_documents_are_clean_markdown_and_marked_personal(tmp_path: Path) -> None:
    database = tmp_path / "mes.sqlite"
    make_database(database)
    output = tmp_path / "workspace"
    report = prepare_pevzner_diets(database, output)
    assert report.documents == 3
    assert report.documents_without_variant == ["1а"]
    assert report.ignored_memo_rows == 1
    assert report.empty_fields == {"products": 1, "menu": 1}
    assert report.mapping_only_in_database == []
    assert "7б -> НБД" in report.mapping_only_in_official

    text = (output / "local.pevzner.diet.1.md").read_text(encoding="utf-8")
    assert "title: Стол №5\n" in text
    assert "short_title: Стол №5 (Певзнер)" in text
    assert "rightsStatus: personal-use-only" in text
    assert "localOnly: true" in text
    assert "Стандартная диета по приказу №330: ОВД." in text
    assert "<ol>" not in text and "<li>" not in text and "<p>" not in text
    assert "# Показания" in text and "# Режим питания" in text
    assert "# Рекомендуемые и исключаемые продукты" in text
    assert "- *Хлеб.* Вчерашний. Исключают: свежий." in text
    assert "дробный, 4 раза в день" in text
    no_variant = (output / "local.pevzner.diet.3.md").read_text(encoding="utf-8")
    assert "# Стандартная диета" not in no_variant
    assert "памятка" not in no_variant
    assert "# Примерное меню" in no_variant
    assert "# Примерное меню" not in (output / "local.pevzner.diet.2.md").read_text(
        encoding="utf-8"
    )


def test_mapping_differences_with_the_official_text_are_reported(tmp_path: Path) -> None:
    database = tmp_path / "mes.sqlite"
    make_database(database, extra_mapping=True)
    report = prepare_pevzner_diets(database, tmp_path / "workspace")
    assert report.mapping_only_in_database == ["1а -> ОВД"]


def test_pack_lints_builds_and_packages_as_local_only(tmp_path: Path) -> None:
    database = tmp_path / "mes.sqlite"
    make_database(database)
    workspace = tmp_path / "workspace"
    prepare_pevzner_diets(database, workspace)
    assert lint_content_pack(load_content_pack(workspace)) == []
    pack_db = tmp_path / "pevzner.db"
    build_content_pack(workspace, pack_db, include_embeddings=False, compact_search_text=True)
    release = package_local_module(
        SPEC, pack_db, tmp_path / "out", version="2026.10.12", min_app_version="0.6.59"
    )
    assert release["documents"] == 3
    assert release["rightsStatus"] == RIGHTS_STATUS
    entry = json.loads(Path(str(release["catalogEntry"])).read_text(encoding="utf-8"))
    assert entry["id"] == "minimed.local.pevzner-diets.ru"
    assert entry["collection"] == "local-pevzner-diets"
    assert entry["title"] == "Диеты по Певзнеру (личное)"
    assert entry["compatibility"]["minAppVersion"] == "0.6.59"
    assert entry["documents"] == []


def test_writers_refuse_a_tracked_output_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.undo()
    database = tmp_path / "mes.sqlite"
    make_database(database)
    root = Path(__file__).resolve().parents[3]
    with pytest.raises(ValueError, match="not ignored"):
        prepare_pevzner_diets(database, root / "docs" / "pevzner-copy")
    assert not (root / "docs" / "pevzner-copy").exists()
