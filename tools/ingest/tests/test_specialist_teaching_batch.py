from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_pack import digest, obj, seq
from localmed_ingest.specialist_journal_bundles import bundle_articles, remap_article
from localmed_ingest.specialist_teaching_discovery import (
    issue_links,
    publisher_path,
    teaching_articles,
)


def article(index: int = 1) -> dict[str, object]:
    body = "Тестовый термин — синтетическое определение. Оговорка автора сохраняется."
    label = "Тестовый термин"
    return {
        "version": 3,
        "id": f"journal.fixture.{index}",
        "textKind": "source-excerpt",
        "publicationState": "local-dev",
        "reviewStatus": "requires-review",
        "sources": [
            {
                "id": 1,
                "title": f"Synthetic article {index}",
                "baseUrl": "https://journals.eco-vector.com/RFD/",
                "path": f"article/view/{index}/ru_RU",
                "sourceType": "specialist-journal",
                "releaseEligible": False,
                "license": "CC-BY-4.0",
                "publicationDate": "2020-01-01",
            }
        ],
        "blocks": [
            {
                "id": 1,
                "source": 1,
                "text": body,
                "textSha256": digest(body),
                "path": f"article/view/{index}/ru_RU",
                "locator": "p[0]",
            },
            {
                "id": 2,
                "source": 1,
                "text": label,
                "textSha256": digest(label),
                "path": f"article/view/{index}/ru_RU",
                "locator": "p[0]; 0:15",
                "sourceSpan": {"parentBlock": 1, "start": 0, "end": len(label)},
            },
        ],
        "terms": [
            {
                "id": f"journal.fixture.{index}.term",
                "title": label,
                "kind": "term",
                "aliases": [],
                "coverage": "explicit-definition",
                "blockIds": [2],
                "detailBlocks": [1],
                "labelEvidence": {"block": 2, "start": 0, "end": len(label)},
            }
        ],
        "extraction": {"clinicalReview": "not-performed"},
    }


def test_archive_selects_unique_same_journal_issue_ids() -> None:
    raw = b"""<a href="https://journals.eco-vector.com/RFD/issue/view/12">Issue</a>
    <a href="https://journals.eco-vector.com/rfd/issue/view/12/ru_RU">Again</a>
    <a href="https://journals.eco-vector.com/pediatr/issue/view/42">Other journal</a>
    <a href="https://evil.example/RFD/issue/view/50">No</a>
    <a href="https://journals.eco-vector.com/RFD/issue/view/13">Next</a>"""
    assert issue_links(raw, "RFD") == ["12", "13"]


def test_issue_selection_respects_publisher_sections_and_title_links() -> None:
    raw = """<h2>Лекции</h2><h3><a href="/RFD/article/view/101">Диагностика синдромов</a></h3>
    <a href="/RFD/article/view/101">Полный текст</a>
    <a href="/RFD/article/view/101/12345">PDF file</a>
    <h2>Оригинальные исследования</h2>
    <h3><a href="/RFD/article/view/102">Изменение показателя</a></h3>
    <h2>Обзоры</h2><h3><a href="/RFD/article/view/103">Классификация расстройств</a></h3>
    <h3><a href="/RFD/article/view/104">Юбилей исследователя</a></h3>""".encode()
    rows = teaching_articles(raw, "RFD", "12")
    assert [row["articleId"] for row in rows] == ["101", "103"]
    assert obj(rows[0]["discovery"])["section"] == "Лекции"
    assert len(str(obj(rows[0]["discovery"])["issueResponseSha256"])) == 64


def test_english_contents_discover_russian_candidate_without_translating_it() -> None:
    raw = b'<h2>Reviews</h2><h3><a href="/RFD/article/view/101">Original source title</a></h3>'
    assert teaching_articles(raw, "RFD", "12")[0]["title"] == "Original source title"


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/RFD/article/view/1",
        "http://journals.eco-vector.com/RFD/article/view/1",
        "https://journals.eco-vector.com.evil.example/RFD/article/view/1",
        "https://user@journals.eco-vector.com/RFD/article/view/1",
        "https://journals.eco-vector.com/RFD/article/view/1/42",
        "https://journals.eco-vector.com/RFD/article/view/1?download=1",
        "https://journals.eco-vector.com/RFD/article/view/1#references",
        "/RFD/article/view/0",
        "/other/article/view/1",
    ],
)
def test_resource_urls_do_not_expand_the_source_boundary(url: str) -> None:
    assert publisher_path(url, "RFD", "article") is None


def test_unknown_journal_is_not_accepted() -> None:
    with pytest.raises(ValueError):
        publisher_path("/arbitrary/article/view/1", "arbitrary", "article")


def test_source_namespace_mapping_is_reversible_and_does_not_mutate_input() -> None:
    original = article()
    before = copy.deepcopy(original)
    mapped = remap_article(original, {1: 7}, {1: 40, 2: 41})
    assert original == before
    assert obj(seq(mapped["blocks"], 10)[1])["sourceSpan"] == {
        "parentBlock": 40,
        "start": 0,
        "end": 15,
    }
    assert obj(seq(mapped["terms"], 10)[0])["labelEvidence"] == {"block": 41, "start": 0, "end": 15}
    assert remap_article(mapped, {7: 1}, {40: 1, 41: 2}) == before


def test_bundles_keep_source_descriptions_once_and_rebind_local_blocks() -> None:
    inputs = [article(1), article(2)]
    snapshots = copy.deepcopy(inputs)
    result = bundle_articles(inputs, "journal.batch.fixture")
    assert inputs == snapshots
    assert len(result) == 1
    payload = result[0]
    assert len(seq(payload["sources"], 10)) == 2
    assert len(seq(payload["blocks"], 10)) == 4
    terms = [obj(v) for v in seq(payload["terms"], 10)]
    assert terms[0]["blockIds"] == [2] and terms[1]["blockIds"] == [4]
    assert terms[1]["detailBlocks"] == [3]
    assert obj(seq(payload["blocks"], 10)[3])["sourceSpan"] == {
        "parentBlock": 3,
        "start": 0,
        "end": 15,
    }
    assert [obj(v)["text"] for v in seq(payload["blocks"], 10)] == [
        obj(block)["text"] for source in inputs for block in seq(source["blocks"], 10)
    ]


def test_duplicate_article_is_not_counted_twice() -> None:
    with pytest.raises(ValueError, match="twice"):
        bundle_articles([article(), article()], "journal.fixture.batch")


def test_missing_parent_reference_is_not_silently_dropped() -> None:
    payload = article()
    obj(obj(seq(payload["blocks"], 10)[1])["sourceSpan"])["parentBlock"] = 99
    with pytest.raises(ValueError, match="unresolved"):
        bundle_articles([payload], "journal.fixture.batch")


def test_unknown_optional_annotation_is_not_passed_with_stale_ids() -> None:
    payload = article()
    payload["historicalMentions"] = [{"block": 1}]
    with pytest.raises(ValueError, match="dedicated"):
        bundle_articles([payload], "journal.fixture.batch")


def test_declared_source_type_cannot_be_relabelled_as_a_journal() -> None:
    payload = article()
    obj(seq(payload["sources"], 10)[0])["sourceType"] = "lexical-dictionary"
    with pytest.raises(ValueError, match="specialist article"):
        bundle_articles([payload], "journal.fixture.batch")


def test_empty_batch_cannot_enter_runtime() -> None:
    with pytest.raises(ValueError):
        bundle_articles([], "journal.fixture.batch")


def test_empty_acquisition_preserves_reasons_without_publishing_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from localmed_ingest import specialist_journal_collect as collector

    def read(url: str) -> bytes:
        return b"User-agent: *\nAllow: /\n" if url.endswith("robots.txt") else b"<html></html>"

    def unavailable(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise ValueError("Synthetic unavailable rights")

    def pause(_seconds: float) -> None:
        return None

    monkeypatch.setattr(collector, "read_original", read)
    monkeypatch.setattr(collector, "capture_page", unavailable)
    monkeypatch.setattr(collector.time, "sleep", pause)
    selection = tmp_path / "selection.json"
    selection.write_text(
        json.dumps(
            {
                "version": 1,
                "sourcePolicy": "specialist-medical-sources-2026-09-22",
                "articles": [{"journal": "RFD", "articleId": "1001", "focus": "fixture"}],
            }
        )
    )
    output = tmp_path / "pending"
    with pytest.raises(ValueError, match="diagnostics preserved"):
        collector.collect(selection, output)
    report = json.loads((output / "collection-report.json").read_text())
    assert report["articles"][0]["status"] == "pending-source-review"
    assert not list((output / "records").iterdir())
    assert [p.name for p in (output / "evidence").iterdir()] == ["robots.txt"]
    assert (output / "evidence/robots.txt").read_bytes() == read("robots.txt")


def test_issue_offset_is_bounded_before_any_network_request(tmp_path: Path) -> None:
    from localmed_ingest.specialist_teaching_discovery import discover

    for value in (-1, 201):
        with pytest.raises(ValueError, match="offset"):
            discover(tmp_path, tmp_path / "output", issue_offset=value)
