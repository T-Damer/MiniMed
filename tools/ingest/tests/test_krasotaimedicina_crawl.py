from localmed_ingest.krasotaimedicina_crawl import (
    canonicalize_krasotaimedicina_url,
    classify_krasotaimedicina_url,
)


def test_krasotaimedicina_scope_is_bounded_and_canonical() -> None:
    assert canonicalize_krasotaimedicina_url("/diseases/neurology/acnes?utm_source=x") == (
        "https://www.krasotaimedicina.ru/diseases/neurology/acnes"
    )
    assert canonicalize_krasotaimedicina_url("/diseases/neurology?PAGEN_1=2&PAGEN_2=7") == (
        "https://www.krasotaimedicina.ru/diseases/neurology?PAGEN_1=2"
    )
    assert canonicalize_krasotaimedicina_url("/diseases/?azfilter=Д&PAGEN_1=2") == (
        "https://www.krasotaimedicina.ru/diseases/?azfilter=%D0%94&PAGEN_1=2"
    )
    assert canonicalize_krasotaimedicina_url("/diseases/?azfilter=Q") == (
        "https://www.krasotaimedicina.ru/diseases/"
    )
    assert canonicalize_krasotaimedicina_url("/treatment/neurology/") is None
    assert canonicalize_krasotaimedicina_url("/doctor/neurologist/") is None
    assert canonicalize_krasotaimedicina_url("https://example.com/diseases/a/b") is None
    assert (
        classify_krasotaimedicina_url("https://www.krasotaimedicina.ru/symptom/digestive/ammonia")
        == "symptom"
    )
