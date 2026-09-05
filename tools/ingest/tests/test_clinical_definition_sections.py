from localmed_ingest.clinical_aliases import _candidate_section, _canonical_definition, _SourceChunk


def test_definition_section_preserves_parenthetical_label_and_source_anchor() -> None:
    text = (
        "Крапивница (от лат. Urtica – крапива) – группа заболеваний, "
        "характеризующихся развитием волдырей и ангиоотеков."
    )
    chunk = _SourceChunk(
        document_version_id="kr.fixture@v1",
        section_id="definition",
        section_title="1.1 Определение заболевания или состояния",
        section_type=None,
        chunk_id="definition.chunk",
        anchor="definition#chunk",
        source_text=text,
        page_start=7,
        page_end=7,
        char_start=0,
        char_end=len(text),
        source_spans=[],
    )
    assert _candidate_section(chunk.section_title)
    definition = _canonical_definition(
        record_id="kr.fixture", official_id="fixture", chunks=[chunk], title_variants=["Крапивница"]
    )
    assert definition is not None
    assert definition.text == (
        "группа заболеваний, характеризующихся развитием волдырей и ангиоотеков."
    )
    assert definition.source_quote == text
    assert definition.source_anchor == "definition#chunk"
    assert definition.page_start == 7
    assert (
        _canonical_definition(
            record_id="kr.other", official_id="other", chunks=[chunk], title_variants=["Аллергия"]
        )
        is None
    )
