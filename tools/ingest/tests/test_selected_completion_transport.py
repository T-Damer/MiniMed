from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from localmed_ingest.clinic_definition_completions import (
    CONSUMER_EXCERPT_WORDS,
    SPECIALIZED_EXCERPT_WORDS,
    excerpt_word_budget,
    fetch_public,
    verify_excerpt,
)


def test_inspected_manual_uses_ascii_http_path_without_changing_source_authority() -> None:
    response = MagicMock()
    response.status = 200
    response.read.return_value = b"<h1>Source</h1>"
    response.getheader.return_value = "text/html"
    connection = MagicMock()
    connection.getresponse.return_value = response
    with patch("http.client.HTTPSConnection", return_value=connection) as factory:
        status, _, _ = fetch_public("https://www.msdmanuals.com/ru/professional/нефрология")
    assert status == 200
    factory.assert_called_once_with("www.msdmanuals.com", timeout=20)
    sent_path = connection.request.call_args.args[1]
    assert isinstance(sent_path, str)
    assert sent_path.isascii() and "%D0%BD" in sent_path
    connection.close.assert_called_once()


@pytest.mark.parametrize(
    "url",
    [
        "https://www.msdmanuals.com.evil.example/ru/",
        "https://user:password@www.msdmanuals.com/ru/",
        "http://www.msdmanuals.com/ru/",
        "https://www.msdmanuals.com/ru/?token=secret",
        "https://www.msdmanuals.com:444/ru/",
    ],
)
def test_manual_does_not_relax_authority_boundary(url: str) -> None:
    with (
        patch("http.client.HTTPSConnection") as factory,
        pytest.raises(ValueError, match="allowlist"),
    ):
        fetch_public(url)
    factory.assert_not_called()


def test_source_thresholds_and_author_remain_exact_not_rewritten() -> None:
    excerpt = "Тестовый показатель < 136 единиц."
    raw = f"<h1>Источник</h1><p>Проверенный автор</p><p>{excerpt.replace('<', '&lt;')}</p>".encode()
    result = verify_excerpt(raw, excerpt, "Проверенный автор")
    assert result["end"] == len(excerpt)
    with pytest.raises(ValueError, match="absent"):
        verify_excerpt(raw, excerpt.replace("136", "135"), "Проверенный автор")
    with pytest.raises(ValueError, match="author"):
        verify_excerpt(raw, excerpt, "Другой автор")


def test_excerpt_word_budget_is_host_scoped() -> None:
    assert excerpt_word_budget("www.msdmanuals.com") == SPECIALIZED_EXCERPT_WORDS
    assert excerpt_word_budget("www.invitro.ru") == CONSUMER_EXCERPT_WORDS
    assert excerpt_word_budget("www.smclinic.ru") == CONSUMER_EXCERPT_WORDS


def test_long_specialized_quote_is_accepted_only_with_the_specialized_budget() -> None:
    # A single continuous 38-word MSD-style definition (real length sampled from the acute
    # hypoxemic respiratory failure / ARDS article) that the old 25-word budget rejected outright,
    # with no shorter self-contained clause available.
    excerpt = (
        "Синдромы короткого интервала QT (СКИQT) представляют собой чрезвычайно редкие "
        "врожденные или очень редко приобретенные нарушения функции или регуляции ионных "
        "каналов сердца, которые укорачивают продолжительность потенциала действия миоцитов "
        "желудочков, что отражается укорочением интервала QT на ЭКГ."
    )
    assert len(excerpt.split()) > CONSUMER_EXCERPT_WORDS
    assert len(excerpt.split()) <= SPECIALIZED_EXCERPT_WORDS
    raw = f"<h1>Синдром короткого интервала QT</h1><p>{excerpt}</p>".encode()
    with pytest.raises(ValueError, match="budget"):
        verify_excerpt(raw, excerpt, max_words=CONSUMER_EXCERPT_WORDS)
    result = verify_excerpt(raw, excerpt, max_words=SPECIALIZED_EXCERPT_WORDS)
    assert result["end"] == len(excerpt)


def test_specialized_quote_must_still_be_one_continuous_fragment() -> None:
    # "No splicing pieces together": two separate sentences from two different paragraphs must
    # not be concatenated into one artificial excerpt -- verify_excerpt only accepts text that
    # appears verbatim, contiguously, inside a single visible paragraph.
    first = "Первое предложение из первого абзаца."
    second = "Второе предложение из другого абзаца."
    raw = f"<h1>Заголовок</h1><p>{first}</p><p>{second}</p>".encode()
    spliced = f"{first} {second}"
    with pytest.raises(ValueError, match="absent"):
        verify_excerpt(raw, spliced, max_words=SPECIALIZED_EXCERPT_WORDS)
