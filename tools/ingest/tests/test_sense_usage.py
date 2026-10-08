from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_pack import Projection, digest
from localmed_ingest.definition_senses import annotate_shards, authority, sense_rows
from localmed_ingest.sense_usage import (
    Corpus,
    CorpusDocument,
    SenseText,
    cluster_senses,
    measure_usage,
    stems,
    term_stems,
)

FRACTURE = (
    "Депрессия – процесс формирования перелома суставной поверхности кости вследствие "
    "избыточного давления сочленяющейся кости, при котором зона импрессии отделяется."
)
MOOD = "Депрессия – психическое расстройство, проявляющееся устойчивым снижением настроения."
MOOD_DICTIONARY = "психиатр. то же, что депрессивное расстройство; психическое расстройство."


def _paragraph(text: str) -> tuple[str, ...]:
    return tuple(stems(text))


def _corpus(documents: dict[str, list[str]], fields: dict[str, str | None] | None = None) -> Corpus:
    corpus = Corpus()
    for code, paragraphs in documents.items():
        corpus.add(
            CorpusDocument(
                code, (fields or {}).get(code), tuple(_paragraph(item) for item in paragraphs)
            )
        )
    return corpus


def test_stems_drop_inflection_and_short_words() -> None:
    assert stems("Депрессия и депрессивного эпизода") == ["депре", "депре", "эпизо"]
    assert term_stems("Депрессия (ДЭ)") == ("депре",)
    assert term_stems("ДЭ") == ()


def test_similar_definitions_are_one_meaning() -> None:
    corpus = _corpus({"1": ["психическое расстройство настроение", "перелом кость сустав"]})
    sets = {
        "kim": frozenset(stems(MOOD)),
        "dict": frozenset(stems(MOOD_DICTIONARY)),
        "fracture": frozenset(stems(FRACTURE)),
    }
    clusters = cluster_senses(sets, corpus)
    assert sorted(map(sorted, clusters)) == [["dict", "kim"], ["fracture"]]


def test_each_paragraph_goes_to_the_sense_whose_context_it_shares() -> None:
    mood = [
        "Депрессия проявляется устойчивым снижением настроения, психическое расстройство.",
        "У пациента психическое расстройство: депрессия со снижением настроения.",
    ]
    bone = ["Депрессия суставной поверхности: перелом кости, зона импрессии, давление."]
    other = ["Депрессия упомянута без пояснений."]
    filler = [f"заметка{index} о лечении и наблюдении пациента" for index in range(400)]
    corpus = _corpus(
        {"a": [*mood, *filler], "b": [*mood, *filler], "c": [*bone, *filler], "d": other}
    )
    usage = measure_usage(
        corpus,
        {"депрессия": ("Депрессия", [SenseText("mood", MOOD), SenseText("bone", FRACTURE)])},
    )["депрессия"]
    assert usage.term_usage == 4
    assert (usage.senses["mood"].usage, usage.senses["bone"].usage) == (2, 1)


def test_a_single_sense_needs_no_measurement() -> None:
    corpus = _corpus({"a": ["Депрессия"]})
    assert measure_usage(corpus, {"депрессия": ("Депрессия", [SenseText("mood", MOOD)])}) == {}


def _shard(
    title: str, text: str, field: str | None, section: str, source: dict[str, object]
) -> dict:
    block: dict[str, object] = {
        "id": 1,
        "source": 1,
        "text": text,
        "documentId": "kr.rf.904_1",
        "sectionTitle": section,
    }
    if field:
        block["field"] = field
    return {
        "version": 3,
        "sources": [{"id": 1, **source}],
        "blocks": [block],
        "terms": [
            {
                "id": "x.1",
                "title": title,
                "kind": "term",
                "aliases": [],
                "blockIds": [1],
                "coverage": "explicit-definition",
            }
        ],
    }


def test_sense_rows_read_field_authority_and_documents() -> None:
    shard = _shard(
        "Депрессия",
        FRACTURE,
        "traumatology",
        "Термины и определения",
        {"authority": "official", "sourceType": "official-clinical-recommendation"},
    )
    (row,) = sense_rows(0, shard)
    assert (row.field, row.authority, row.documents, row.group) == (
        "traumatology",
        3,
        1,
        "депрессия",
    )


def test_authority_orders_glossary_above_sites_above_dictionaries() -> None:
    official = {"authority": "official"}
    assert authority(official, "Термины и определения", "explicit-definition") == 3
    assert authority(official, "1.1 Определение заболевания", "explicit-definition") == 2
    assert authority({"authority": "professional-reference"}, None, "definition") == 2
    assert authority({"authority": "third-party"}, None, "explicit-definition") == 1
    assert authority({"authority": "third-party"}, None, "gloss") == 0


def test_annotation_writes_signals_without_touching_text() -> None:
    mood_paragraph = "Депрессия: психическое расстройство со снижением настроения."
    filler = [f"заметка{index} о лечении и наблюдении пациента" for index in range(400)]
    corpus = _corpus({"a": [mood_paragraph, *filler], "b": [mood_paragraph, *filler]})
    first = _shard(
        "Депрессия",
        FRACTURE,
        "traumatology",
        "Термины и определения",
        {"authority": "official"},
    )
    second = _shard("Депрессия", MOOD, "psychiatry", "", {"authority": "third-party"})
    second["terms"][0]["id"] = "y.1"
    shards = [first, second]
    report = annotate_shards(shards, corpus)
    fracture, mood = (shard["terms"][0]["sense"] for shard in shards)
    assert fracture["field"] == "traumatology" and fracture["fieldLabel"] == "травматология"
    assert (fracture["usage"], mood["usage"]) == (0, 2)
    assert mood["termUsage"] == 2 and mood["authority"] == 1
    assert fracture["meaning"] != mood["meaning"]
    assert shards[0]["blocks"][0]["text"] == FRACTURE
    assert report["ambiguousHeadwords"] == 1


def test_alike_wordings_count_their_sources_together_as_one_meaning() -> None:
    mood_paragraph = "Депрессия: психическое расстройство со снижением настроения."
    filler = [f"заметка{index} о лечении и наблюдении пациента" for index in range(400)]
    corpus = _corpus({"a": [mood_paragraph, *filler]})
    first = _shard("Депрессия", MOOD, "psychiatry", "", {"authority": "third-party"})
    second = _shard(
        "Депрессия",
        "Депрессия – психическое расстройство со снижением настроения и мышления.",
        "psychiatry",
        "Термины и определения",
        {"authority": "official"},
    )
    second["terms"][0]["id"] = "y.1"
    third = _shard("Депрессия", FRACTURE, "traumatology", "", {"authority": "third-party"})
    third["terms"][0]["id"] = "z.1"
    shards = [first, second, third]
    annotate_shards(shards, corpus)
    one, two, other = (shard["terms"][0]["sense"] for shard in shards)
    assert one["meaning"] == two["meaning"] != other["meaning"]
    assert (one["documents"], two["documents"], other["documents"]) == (2, 2, 1)
    assert one["usage"] == two["usage"] == 1


def test_projection_stores_sense_signals_with_the_entity_and_rejects_unknown_keys(
    tmp_path: Path,
) -> None:
    shard = _shard(
        "Депрессия",
        FRACTURE,
        "traumatology",
        "Термины и определения",
        {
            "id": 1,
            "title": "Клинические рекомендации",
            "baseUrl": "https://cr.minzdrav.gov.ru/",
            "authority": "official",
            "releaseEligible": False,
        },
    )
    shard.update(
        reviewStatus="requires-review", publicationState="local-dev", textKind="source-excerpt"
    )
    shard["sources"] = [shard["sources"][0] | {"id": 1}]
    shard["blocks"][0].update(textSha256=digest(FRACTURE), path="preview-cr/904_1", locator="x")
    shard["terms"][0]["sense"] = {"field": "traumatology", "documents": 1, "authority": 3}
    projection = Projection()
    projection.add(shard, "1" * 64)
    output = tmp_path / "reference.db"
    projection.build(output, edition_id="minimed.definition.reference.t", version="t", built_at="t")
    with closing(sqlite3.connect(output)) as database:
        metadata, annotations = database.execute(
            "SELECT e.metadata_json, "
            "(SELECT count(*) FROM knowledge_document_links l "
            " WHERE l.entity_id = e.id AND l.link_type = 'reference:annotation') "
            "FROM knowledge_entities e"
        ).fetchone()
    assert json.loads(metadata)["sense"] == {
        "field": "traumatology",
        "documents": 1,
        "authority": 3,
    }
    assert annotations == 0  # the signals are entity metadata, not a raw-JSON annotation block
    broken = json.loads(json.dumps(shard))
    broken["terms"][0].update(id="x.2", sense={"favourite": 1})
    with pytest.raises(ValueError, match="Unsupported sense signal"):
        Projection().add(broken, "2" * 64)
