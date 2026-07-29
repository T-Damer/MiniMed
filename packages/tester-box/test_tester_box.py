from tester_box import Evidence, extract_json, validate_contract

EVIDENCE = [
    Evidence(
        citation_id="C1",
        chunk_id="chunk-1",
        document_id="doc-1",
        title="Документ",
        source_type="clinical-guideline",
        version_label="1",
        section_title="Лечение",
        section_path="Лечение",
        text="Рекомендуется 100 мкг препарата.",
        source_db="source.db",
        rank=-1,
    )
]


def test_contract_rejects_invented_number() -> None:
    parsed = extract_json(
        '{"status":"answer","missingFacts":[],"claims":[{"text":"Назначить 200 мг",'
        '"citationIds":["C1"],"exactQuotes":["Рекомендуется 100 мкг препарата."]}],'
        '"conflicts":[]}'
    )

    errors = validate_contract(parsed, EVIDENCE, [])

    assert any("200 мг" in error for error in errors)
    assert extract_json('[{"status":"answer"}]') is None


def test_contract_accepts_exact_quote() -> None:
    parsed = extract_json(
        '{"status":"answer","missingFacts":[],"claims":[{"text":"Источник указывает 100 мкг",'
        '"citationIds":["C1"],"exactQuotes":["Рекомендуется 100 мкг препарата."]}],'
        '"conflicts":[]}'
    )

    assert validate_contract(parsed, EVIDENCE, []) == []


def test_contract_requires_conflict_status_for_conflicting_doses() -> None:
    evidence = [
        EVIDENCE[0],
        Evidence(
            citation_id="C2",
            chunk_id="chunk-2",
            document_id="doc-1",
            title="Документ",
            source_type="clinical-guideline",
            version_label="1",
            section_title="Лечение",
            section_path="Лечение",
            text="Сальбутамол: 200 мг через спейсер.",
            source_db="source.db",
            rank=-2,
        ),
        Evidence(
            citation_id="C3",
            chunk_id="chunk-3",
            document_id="doc-1",
            title="Документ",
            source_type="clinical-guideline",
            version_label="1",
            section_title="Лечение",
            section_path="Лечение",
            text="Сальбутамол: 100 мкг в дозированном аэрозольном ингаляторе.",
            source_db="source.db",
            rank=-3,
        ),
    ]
    parsed = extract_json(
        '{"status":"answer","missingFacts":[],"claims":[],"conflicts":[]}'
    )

    errors = validate_contract(parsed, evidence, ["сальбутамол"])

    assert any("конфликт доз" in error for error in errors)
