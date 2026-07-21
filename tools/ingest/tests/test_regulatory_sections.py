from localmed_ingest.markdown_parser import infer_section_type


def test_regulatory_section_types_are_first_class() -> None:
    assert infer_section_type("Общая информация") == "definition"
