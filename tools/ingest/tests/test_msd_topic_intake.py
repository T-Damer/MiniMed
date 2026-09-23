from __future__ import annotations

import gzip

import pytest

from localmed_ingest.msd_topic_intake import (
    NS,
    ORIGIN,
    Robots,
    checked_url,
    first_definition,
    parse_topic,
    sitemap_locations,
    topic_sitemap_children,
    topic_url,
)

URL = ORIGIN + "/ru/professional/раздел/глава/пример"
TEXT = "Пример — это вымышленное явление для проверки программы."


def page(body: str = TEXT, *, prefix: str = "", canonical: str = URL) -> bytes:
    return (
        '<html lang="ru"><head><meta name="VasontID" content="v123_ru">'
        f'<link rel="canonical" href="{canonical}"></head><body>{prefix}'
        '<h1 id="topicHeaderTitle"><span>Пример</span></h1>'
        f'<p data-testid="topicDefinition"><span>{body}</span></p></body></html>'
    ).encode()


@pytest.mark.parametrize(
    "value",
    [
        "http://www.msdmanuals.com/ru/test",
        "https://other.test/ru/test",
        "https://user:secret@www.msdmanuals.com/ru/test",
        "https://www.msdmanuals.com:90/test",
        ORIGIN + "/a/../b",
        ORIGIN + "/a/%2e%2e/b",
        ORIGIN + "/a/%252e%252e/b",
        ORIGIN + "/ru/test#fragment",
        ORIGIN + "/ru/te\x00st",
        ORIGIN + "/a\\b",
    ],
)
def test_untrusted_source_url_never_escapes_the_origin(value: str) -> None:
    with pytest.raises(ValueError):
        checked_url(value)


def test_unicode_url_round_trip_and_topic_scope() -> None:
    assert checked_url(checked_url(URL)) == checked_url(URL)
    assert topic_url(URL)
    assert not topic_url(ORIGIN + "/ru/professional/authors/test")
    assert not topic_url(ORIGIN + "/ru/professional/multimedia/table/test")
    assert not topic_url(ORIGIN + "/professional/section/chapter/topic")
    assert not topic_url(ORIGIN + "/ru/professional/health-topics")


def test_robots_wildcards_delay_and_agent_groups() -> None:
    policy = Robots(
        "User-agent: *\nCrawl-delay: 7\nDisallow: */sitecore/\n"
        "Disallow: */downloadtextFile*\nDisallow: /a/\nAllow: /a/public/\n"
        "User-agent: Googlebot-Image\nDisallow: /\n"
        f"Sitemap: {ORIGIN}/ru/sitemap.xml\n"
    )
    assert policy.delay == 7
    assert policy.allowed(URL)
    assert not policy.allowed(ORIGIN + "/ru/sitecore/a")
    assert not policy.allowed(ORIGIN + "/ru/downloadtextFile?id=1")
    assert not policy.allowed(ORIGIN + "/a/private")
    assert policy.allowed(ORIGIN + "/a/public/item")
    assert policy.sitemaps == [ORIGIN + "/ru/sitemap.xml"]


def test_sitemap_scopes_duplicates_and_gzip() -> None:
    encoded = checked_url(URL)
    xml = (
        f'<urlset xmlns="{NS[1:-1]}"><url><loc>{encoded}</loc></url>'
        f"<url><loc>{encoded}</loc></url></urlset>"
    ).encode()
    assert sitemap_locations(xml, index=False) == [encoded]
    assert sitemap_locations(gzip.compress(xml), index=False) == [encoded]
    with pytest.raises(ValueError, match="root"):
        sitemap_locations(xml, index=True)
    with pytest.raises(ValueError):
        sitemap_locations(b'<!DOCTYPE x [<!ENTITY y "bad">]><x/>', index=False)
    with pytest.raises(ValueError):
        sitemap_locations(
            f'<urlset xmlns="{NS[1:-1]}">'
            "<url><loc>https://other.test/a</loc></url></urlset>".encode(),
            index=False,
        )


def index_fixture(locale: str, names: tuple[str, ...]) -> bytes:
    children = "".join(
        f"<sitemap><loc>{ORIGIN}/{locale}/sitemaps/{name}-topic.xml.gz</loc></sitemap>"
        for name in names
    )
    return f'<sitemapindex xmlns="{NS[1:-1]}">{children}</sitemapindex>'.encode()


def test_advertised_russian_root_indexes_have_different_edition_sets() -> None:
    ordinary = index_fixture("ru", ("home", "professional"))
    local = index_fixture("ru-ru", ("professional",))
    assert len(topic_sitemap_children(ordinary, ORIGIN + "/ru/sitemap.xml")) == 2
    assert len(topic_sitemap_children(local, ORIGIN + "/ru-ru/sitemap.xml")) == 1
    with pytest.raises(ValueError, match="changed"):
        topic_sitemap_children(local, ORIGIN + "/ru/sitemap.xml")
    with pytest.raises(ValueError, match="changed"):
        topic_sitemap_children(index_fixture("ru", ("home",)), ORIGIN + "/ru/sitemap.xml")
    with pytest.raises(ValueError, match="Unknown"):
        topic_sitemap_children(ordinary, ORIGIN + "/en/sitemap.xml")


def test_visible_short_source_sentence_and_receipts() -> None:
    raw = page(TEXT + " Это продолжение не входит в короткое определение.")
    result = parse_topic(raw, URL, "2026-09-23T00:00:00Z")
    assert result["definition"] == TEXT
    assert result["title"] == "Пример"
    assert result["topicId"] == "v123_ru"
    proof = result["sourceVerification"]
    assert isinstance(proof, dict)
    assert proof["start"] == 0 and proof["end"] == len(TEXT)
    assert proof["method"] == "visible-paragraph-exact-v1"
    assert proof["responseSha256"] != proof["paragraphSha256"]
    assert result["authorIds"] is None


def test_hidden_content_and_markup_do_not_change_definition() -> None:
    prefix = (
        '<div style="display: none"><h1 id="topicHeaderTitle">Ложное имя</h1>'
        '<p data-testid="topicDefinition">Ложный текст.</p></div>'
    )
    body = (
        "Пример <b>— это</b> вымышленное явление <span hidden>скрыто</span>для проверки программы."
    )
    assert parse_topic(page(body, prefix=prefix), URL, "2026-09-23")["definition"] == TEXT
    with pytest.raises(ValueError, match="ambiguous"):
        parse_topic(page(prefix='<p data-testid="topicDefinition">Другое.</p>'), URL, "2026-09-23")


def test_canonical_identity_is_verified_without_blind_redirect_merging() -> None:
    variant = URL.replace("/ru/", "/ru-ru/")
    assert parse_topic(page(canonical=variant), URL, "2026-09-23")["definition"] == TEXT
    with pytest.raises(ValueError, match="identity"):
        parse_topic(page(canonical=URL + "-другой"), URL, "2026-09-23")
    with pytest.raises(ValueError, match="identity"):
        parse_topic(page().replace(b"v123_ru", b"v123_en"), URL, "2026-09-23")


@pytest.mark.parametrize(
    "body,title",
    [
        ("Пример — это " + "слово " * 26 + ".", "Пример"),
        ("Пример — это обрывок…", "Пример"),
        ("Пример — это фрагмент без точки", "Пример"),
        ("Называние — это другое явление.", "Пример"),
        ("Обзор — это обзор методов.", "Обзор"),
        ("Пример встречается очень часто.", "Пример"),
    ],
)
def test_overlong_truncated_nondefinitional_text_is_not_rewritten(body: str, title: str) -> None:
    assert first_definition(body, title) is None


def test_parenthetical_abbreviations_and_decimal_points_are_not_sentence_boundaries() -> None:
    text = "Пример (напр. ситуация) — это число 2.5 в вымышленной задаче. Далее другой текст."
    assert first_definition(text, "Пример") == text.split(" Далее", 1)[0]
