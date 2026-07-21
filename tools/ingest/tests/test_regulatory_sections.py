from localmed_ingest.markdown_parser import infer_section_type


def test_regulatory_section_types_are_first_class() -> None:
    assert infer_section_type("Круг диспансерного наблюдения") == "eligibility"
    assert infer_section_type("Срок постановки под наблюдение") == "timeline"
    assert infer_section_type("Организация и план наблюдения") == "organization"
    assert infer_section_type("Цели и согласие") == "consent"
    assert infer_section_type("Информирование и защита несовершеннолетнего") == "information"
    assert infer_section_type("Планирование и направление") == "planning"
    assert infer_section_type("Маршрутизация к специалисту") == "routing"
