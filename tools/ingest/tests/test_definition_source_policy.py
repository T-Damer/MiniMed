from __future__ import annotations

import pytest

from localmed_ingest.definition_source_policy import (
    is_wikipedia_input,
    require_active_definition_source,
)


@pytest.mark.parametrize(
    "source",
    [
        {"baseUrl": "https://ru.wikipedia.org/wiki/"},
        {"url": "https://en.wikipedia.org/wiki/Example"},
        {"sourceUrl": "https://ru.m.wikipedia.org/wiki/Example"},
        {"baseUrl": "https://RU.WIKIPEDIA.ORG./wiki/"},
        {"baseUrl": "//wikipedia.org/wiki/Example"},
        {"sourceProject": "ru.wikipedia.org"},
        {"sourceProject": "Wikipedia"},
        {"sourceType": "wikipedia-api-parsed-sections"},
        {"sourceType": "wikipedia_api_extracts"},
        {"baseUrl": "https://mirror.example/", "sourceProject": "ru.wikipedia.org"},
    ],
)
def test_direct_and_declared_wikipedia_sources_are_excluded(source: dict[str, str]) -> None:
    payload: dict[str, object] = {"sources": [source], "terms": []}
    assert is_wikipedia_input(payload)
    with pytest.raises(ValueError, match="Wikipedia is excluded"):
        require_active_definition_source(payload)


@pytest.mark.parametrize(
    "source",
    [
        {"baseUrl": "https://www.psychiatry.ru/lib/"},
        {"baseUrl": "https://www.mediasphera.ru/"},
        {"baseUrl": "https://www.rmj.ru/"},
        {"baseUrl": "https://ru.wiktionary.org/wiki/"},
        {"sourceProject": "ru.wiktionary.org"},
        {"baseUrl": "https://wikipedia.org.example.org/"},
        {"baseUrl": "https://example.org/?reference=https://ru.wikipedia.org"},
        {"url": "https://ru.wikipedia.org@example.org/path"},
    ],
)
def test_not_excluded_does_not_mean_medically_approved(source: dict[str, str]) -> None:
    payload: dict[str, object] = {"sources": [source], "terms": []}
    assert not is_wikipedia_input(payload)
    assert require_active_definition_source(payload) is None


def test_source_record_identity_cannot_be_hidden_by_relabelling_descriptor() -> None:
    payload: dict[str, object] = {
        "sources": [{"title": "Relabelled source", "baseUrl": "https://example.org/"}],
        "terms": [{"id": "ruwiki.definition.123"}],
    }
    with pytest.raises(ValueError):
        require_active_definition_source(payload)


def test_wiktionary_is_not_silently_treated_as_wikipedia() -> None:
    payload: dict[str, object] = {
        "sources": [{"sourceProject": "ru.wiktionary.org"}],
        "terms": [{"id": "ruwikt.0123456789abcdef01234567"}],
    }
    assert not is_wikipedia_input(payload)


def test_a_journal_bibliography_can_mention_wikipedia_without_being_its_source() -> None:
    payload: dict[str, object] = {
        "sources": [{"baseUrl": "https://example.org/journal/", "title": "Medical journal"}],
        "terms": [{"id": "journal.term", "definition": "Discussion of Wikipedia"}],
        "blocks": [{"text": "Bibliography: https://ru.wikipedia.org/wiki/Example"}],
    }
    assert not is_wikipedia_input(payload)


def test_mixed_source_input_requires_an_explicit_split_not_silent_partial_text_deletion() -> None:
    payload: dict[str, object] = {
        "sources": [{"baseUrl": "https://example.org/"}, {"baseUrl": "https://ru.wikipedia.org/"}],
        "terms": [{"id": "journal.term"}],
    }
    with pytest.raises(ValueError):
        require_active_definition_source(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"sources": "invalid"},
        {"sources": ["invalid"]},
        {"terms": "invalid"},
        {"terms": ["invalid"]},
    ],
)
def test_malformed_source_collections_are_not_silently_accepted(payload: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        require_active_definition_source(payload)
