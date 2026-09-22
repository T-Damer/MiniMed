from __future__ import annotations

import copy
import gzip
import hashlib
import json
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_pack import Projection, encoded, obj, seq
from localmed_ingest.specialist_journal_collect import replay
from localmed_ingest.specialist_journal_reference import (
    article_url,
    capture_page,
    definition_label,
    project_article,
    source_units,
)

HTML = """<!doctype html><html><head>
<meta name="DC.Identifier" content="1001"><meta name="citation_language" content="ru">
<meta name="citation_title" content="Synthetic source"><meta name="citation_title" content="Учебная статья">
<meta name="citation_journal_title" content="Synthetic Journal">
<meta name="citation_journal_title" content="Синтетический медицинский журнал">
<meta name="DC.Date.issued" content="2017-12-15"><meta name="DC.Date.modified" content="2026-09-22">
<meta name="citation_doi" content="10.0000/synthetic1001">
<meta name="citation_author" content="Автор примера"><meta name="DC.Type.articleType" content="Лекции">
<meta name="DC.Rights" content="Автор примера, 2017">
<meta name="DC.Rights" content="http://creativecommons.org/licenses/by-nc-sa/4.0">
</head><body><nav>НЕ ДОЛЖНО ПОПАСТЬ В ОПРЕДЕЛЕНИЯ</nav><article class="article">
<h1>Учебная статья</h1><div id="tabs-1"><h2>Аннотация</h2><p>КРАТКАЯ АННОТАЦИЯ</p></div>
<div id="tabs-2"><h2 class="label">Полный текст</h2>
<h3>Введение</h3><p>Это синтетический материал для проверки программы. Никакие медицинские выводы
из него делать нельзя. В этом предложении достаточно русского текста для проверки языка,
но оно не является самостоятельным медицинским термином или определением.</p>
<h3>Синдром примера</h3>
<p>Синдром примера — это синтетическое описание. Оговорка автора сохраняется полностью.</p>
<ol start="3"><li>Признак альфа — условный термин, используемый только в проверке.</li>
<li value="8">Последующий пункт со знаком α и символом 🔬.</li></ol>
<table><caption>Таблица примера</caption><tr><th rowspan="2">Категория</th><th>Пояснение</th></tr>
<tr><td>Исходная ячейка <sub>2</sub></td></tr></table>
<p>Ограничение применимости всей представленной конструкции остаётся частью исходного раздела.</p>
<h3>Заключение</h3><p>Заключение не превращается в новый медицинский термин.</p></div>
<div id="tabs-4"><h2>Список литературы</h2><ol><li>Синтетический источник, 2017.</li></ol></div>
</article><a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">License</a>
<script>НЕ СОХРАНЯТЬ КАК ТЕКСТ СТАТЬИ</script></body></html>"""


def snapshot(html: str = HTML) -> dict[str, object]:
    return capture_page(html.encode(), "RFD", "1001", "2026-09-22T00:00:00+00:00")


def test_capture_uses_full_text_not_abstract_or_chrome() -> None:
    captured = snapshot()
    assert "КРАТКАЯ АННОТАЦИЯ" not in str(captured["fullTextHtml"])
    assert "НЕ ДОЛЖНО" not in str(captured["fullTextHtml"])
    assert "НЕ СОХРАНЯТЬ" not in str(captured["fullTextHtml"])
    assert "Оговорка автора" in str(captured["fullTextHtml"])
    source = obj(seq(project_article(captured)["sources"], 10)[0])
    assert source["publicationDate"] == "2017-12-15"
    assert source["nonCommercialOnly"] is True
    assert source["releaseEligible"] is False
    assert source["license"] == "CC-BY-NC-SA-4.0"


def test_projection_preserves_context_tables_citations_and_numeric_source() -> None:
    payload = project_article(snapshot())
    projection = Projection()
    projection.add(payload, hashlib.sha256(encoded(payload).encode()).hexdigest())
    blocks = [obj(v) for v in seq(payload["blocks"], 1000)]
    text = "\n".join(str(b["text"]) for b in blocks)
    assert "3. Признак альфа" in text and "8. Последующий" in text
    assert "rowspan=2" in text and "Исходная ячейка _(2)" in text
    assert "Оговорка автора сохраняется полностью." in text
    assert "Ограничение применимости" in text and "Синтетический источник, 2017." in text
    terms = [obj(v) for v in seq(payload["terms"], 1000)]
    assert terms[0]["recordRole"] == "article-overview-not-independent-term"
    assert not any(t["title"] in {"Введение", "Заключение", "Список литературы"} for t in terms)
    for term in terms[1:]:
        evidence = obj(term["labelEvidence"])
        block = blocks[int(str(evidence["block"])) - 1]
        assert (
            str(block["text"])[int(str(evidence["start"])) : int(str(evidence["end"]))]
            == term["title"]
        )
    assert any(t["title"] == "Признак альфа" for t in terms)
    assert all(b["source"] == 1 for b in blocks)


@pytest.mark.parametrize(
    ("old", "new"),
    [
        ('content="1001"', 'content="1002"'),
        ('name="citation_language" content="ru"', 'name="citation_language" content="en"'),
        ("<h1>Учебная статья</h1>", "<h1>Другая статья</h1>"),
        ('id="tabs-2"', 'id="unavailable-fulltext"'),
        (">Полный текст</h2>", ">Аннотация</h2>"),
        ("http://creativecommons.org/licenses/by-nc-sa/4.0", "All rights reserved"),
        (
            'href="https://creativecommons.org/licenses/by-nc-sa/4.0/"',
            'href="https://example.org/"',
        ),
    ],
)
def test_capture_rejects_mismatched_identity_language_container_or_rights(
    old: str, new: str
) -> None:
    with pytest.raises(ValueError):
        snapshot(HTML.replace(old, new))


def test_ambiguous_licenses_are_not_selected_opportunistically() -> None:
    altered = HTML.replace(
        "</head>",
        '<meta name="DC.Rights" content="https://creativecommons.org/licenses/by/4.0/"></head>',
    )
    with pytest.raises(ValueError, match="license"):
        snapshot(altered)


def test_snapshot_tamper_is_rejected() -> None:
    captured = snapshot()
    captured["fullTextHtml"] = str(captured["fullTextHtml"]) + "<p>Unrecorded addition</p>"
    with pytest.raises(ValueError, match="checksum"):
        project_article(captured)


def test_publication_date_is_not_inferred_from_upload_date() -> None:
    captured = snapshot()
    obj(captured["metadata"]).pop("DC.Date.issued")
    with pytest.raises(ValueError, match="publication"):
        project_article(captured)


def test_no_russian_title_means_no_generated_translation() -> None:
    captured = snapshot()
    obj(captured["metadata"])["citation_title"] = ["English-only title"]
    with pytest.raises(ValueError, match="Russian"):
        project_article(captured)


@pytest.mark.parametrize(
    "value",
    [
        "Это — описание",
        "В статье — три примера",
        "При симптоме — другое",
        "Классификация:",
        "Выводы",
        "Одна фраза без определения",
    ],
)
def test_nondefinitions_are_not_padded_into_terms(value: str) -> None:
    assert definition_label(value) is None


@pytest.mark.parametrize(
    "value",
    [
        "Признак альфа — описание",
        "3.1. Признак альфа — описание",
        "Признак альфа проявляется устойчивым сочетанием",
    ],
)
def test_source_definition_clauses(value: str) -> None:
    assert definition_label(value) == "Признак альфа"


def test_nested_table_requires_review_instead_of_cell_loss() -> None:
    with pytest.raises(ValueError, match="Nested"):
        source_units(
            "<table><tr><td>Outer<table><tr><td>Inner</td></tr></table></td></tr></table>",
            "#tabs-2",
        )


def test_frame_is_not_mistaken_for_a_complete_source() -> None:
    with pytest.raises(ValueError, match="Embedded"):
        source_units('<p>Before <iframe src="https://example.org/"></iframe> after</p>', "#tabs-2")


@pytest.mark.parametrize(
    ("journal", "aid"), [("..", "1001"), ("RFD", "1/2"), ("https:evil", "1001")]
)
def test_only_explicit_publisher_article_paths(journal: str, aid: str) -> None:
    with pytest.raises(ValueError):
        article_url(journal, aid)


def test_archive_replay_exact_and_corruption_rejected(tmp_path: Path) -> None:
    snap = snapshot()
    prepared = encoded(project_article(snap)).encode()
    archive = gzip.compress(encoded(snap).encode(), mtime=0)
    (tmp_path / "article.json").write_bytes(prepared)
    (tmp_path / "article.json.gz").write_bytes(archive)
    report = {
        "articles": [
            {
                "status": "prepared-requires-review",
                "evidence": "article.json.gz",
                "prepared": "article.json",
                "evidenceSha256": hashlib.sha256(archive).hexdigest(),
                "preparedSha256": hashlib.sha256(prepared).hexdigest(),
            }
        ]
    }
    (tmp_path / "collection-report.json").write_text(json.dumps(report))
    assert replay(tmp_path)["exactPreparedReplay"] is True
    (tmp_path / "article.json").write_text("{}")
    with pytest.raises(ValueError, match="receipt"):
        replay(tmp_path)


def test_source_alias_comes_only_from_literal_parenthesized_name() -> None:
    captured = snapshot(HTML.replace("Признак альфа —", "Признак альфа (alpha) —"))
    terms = [obj(v) for v in seq(project_article(captured)["terms"], 1000)]
    term = next(t for t in terms if t["title"] == "Признак альфа (alpha)")
    assert term["aliases"] == ["Признак альфа"]


def test_same_source_replay_is_deterministic() -> None:
    captured = snapshot()
    assert encoded(project_article(captured)) == encoded(project_article(copy.deepcopy(captured)))
