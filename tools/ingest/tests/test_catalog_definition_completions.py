from pathlib import Path

import pytest

from localmed_ingest import catalog_definition_completions as batch


def html(body: str) -> bytes:
    return f'<html><meta charset="utf-8"><h1>Термин</h1>{body}</html>'.encode()


def test_catalog_excludes_external_query_and_ambiguous_targets() -> None:
    raw = html(
        '<a href="/simptomy/odin/">Первый</a>'
        '<a href="https://evil.example/simptomy/dva/">Второй</a>'
        '<a href="/simptomy/tri/?track=1">Третий</a>'
        '<a href="/simptomy/a/">Неоднозначный</a>'
        '<a href="/simptomy/b/">Неоднозначный</a>'
    )
    assert batch.catalog_links(raw) == {"первый": "simptomy/odin/"}


def test_only_literal_complete_short_sentence_is_selected() -> None:
    raw = html("<p>Термин — определение в источнике. Следующая фраза не импортируется.</p>")
    assert batch.select_sentence(raw, "Термин") == "Термин — определение в источнике."


def test_markup_whitespace_is_not_a_paraphrase() -> None:
    raw = html("<p>Термин — <b>определение</b>\n в источнике.</p>")
    assert batch.select_sentence(raw, "Термин") == "Термин — определение в источнике."


@pytest.mark.parametrize(
    "body",
    [
        "<script><p>Термин — скрытый текст.</p></script>",
        "<p>Другое название — определение в источнике.</p>",
        "<p>Термин упоминается без определения.</p>",
        "<p>Термин — незавершенное определение</p>",
        "<p>Термин — " + "слово " * 26 + ".</p>",
    ],
)
def test_no_unrelated_hidden_truncated_or_over_budget_text(body: str) -> None:
    assert batch.select_sentence(html(body), "Термин") is None


def test_parenthetical_initial_does_not_end_a_sentence() -> None:
    raw = html("<p>Термин (лат. test) — определение в источнике.</p>")
    assert batch.select_sentence(raw, "Термин") == "Термин (лат. test) — определение в источнике."


def test_seed_prefix_selects_text_but_never_generates_it() -> None:
    raw = html("<p>Термином называют явление в источнике.</p>")
    assert batch.select_sentence(raw, "Термин", "Термином называют") == (
        "Термином называют явление в источнике."
    )


@pytest.mark.parametrize("tag", ["div", "section", "article", "li"])
def test_legacy_blocks_preserve_the_literal_sentence(tag: str) -> None:
    raw = html(f"<{tag}>Определение<br>Термином называют явление в источнике.</{tag}>")
    assert batch.select_sentence(raw, "Термин", "Термином называют") == (
        "Термином называют явление в источнике."
    )


def test_repeated_prefix_is_not_an_unambiguous_source_locator() -> None:
    raw = html("<div>Термином называют одно. Термином называют другое.</div>")
    assert batch.select_sentence(raw, "Термин", "Термином называют") is None


def test_oversized_container_is_not_a_source_paragraph() -> None:
    raw = html("<div>" + "Текст " * 1400 + "Термином называют явление в источнике.</div>")
    assert batch.select_sentence(raw, "Термин", "Термином называют") is None


@pytest.mark.parametrize("name,limit", [("../escape", 1), ("valid", 0), ("valid", 61)])
def test_rejects_invalid_batch(tmp_path: Path, name: str, limit: int) -> None:
    with pytest.raises(ValueError, match="Invalid batch"):
        batch.run(tmp_path, name, limit)
