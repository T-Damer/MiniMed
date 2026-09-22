"""Original specialist-journal HTML to source-bound V3 reference inputs.

Only an explicit full-text container is admitted, never an abstract or site navigation.
The existing pure HTML renderer is reused as formatting code; no Wikipedia source/API is used.
Definitions are conservative source-local proposals, not medical adjudication or scoring rules.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from bs4 import BeautifulSoup, Tag

from .definition_reference_pack import digest, encoded, normalized_name, obj, seq, text
from .wikipedia_reference_sections import (
    Element,
    SourceHtml,
    compact,
    descendants,
    omitted,
    render,
    table_grid,
)

HOST = "https://journals.eco-vector.com"
MAX_PAGE_BYTES = 6 * 1024 * 1024
LICENSES = {
    "https://creativecommons.org/licenses/by/4.0/": "CC-BY-4.0",
    "https://creativecommons.org/licenses/by-sa/4.0/": "CC-BY-SA-4.0",
    "https://creativecommons.org/licenses/by-nc-sa/4.0/": "CC-BY-NC-SA-4.0",
}
GENERIC_HEADINGS = re.compile(
    r"^(?:введение|заключение|выводы|обсуждение|результаты|цель|методы|материалы|"
    r"аннотация|список литературы|литература|библиограф|финансирование|конфликт|"
    r"вклад авторов|дополнительная информация|благодарност|references|abstract)",
    re.I,
)
CLINICAL_HEADING = re.compile(
    r"синдром|симптом|расстройств|головокружен|вестибулопат|стенокард|инфаркт|"
    r"мигрен|головн\w* бол|болезн|кататон|галлюцин|аутиз|шкал|критери|классификац|"
    r"нейронит|афази|дизартри|дисфази|дислал|дислекс|атакси|нистагм|проб[аы]|"
    r"феномен|бред|соматоформ|диссоциатив",
    re.I,
)
DEFINITION = re.compile(
    r"^(.{3,150}?)\s+(?:[—–]\s+(?:это\s+)?|представля(?:ет|ют) собой\s+|"
    r"характеризуется\s+|проявляется\s+|выражается\s+|развивается\s+|означает\s+)",
    re.I,
)
BAD_START = re.compile(
    r"^(?:это|эта|эти|этот|такой|такая|такие|они|она|оно|мы|он|в|во|на|при|"
    r"с|со|к|от|из|для|после|через|по|если|когда|как|однако|поскольку|так|"
    r"важно|вопрос|статья|пациент|больной|следует|необходимо|например|врач|"
    r"результат|данный|данная|данное|данные|основу|один|одним)\b",
    re.I,
)
LEADING_NUMBER = re.compile(r"^\s*(?:\d+(?:\.\d+)*[.)]?\s+|[•–—]\s*)")


@dataclass
class Unit:
    body: str
    locator: str
    headings: tuple[str, ...]
    tag: str
    tables: list[object]
    definitions: list[tuple[str, str]]


def article_url(journal: str, article_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9-]{1,40}", journal) or not re.fullmatch(
        r"[1-9]\d{0,11}", article_id
    ):
        raise ValueError("Invalid explicit journal/article identity")
    return f"{HOST}/{journal}/article/view/{article_id}/ru_RU"


def _attr(node: Tag, key: str) -> str:
    value = node.get(key)
    return value if isinstance(value, str) else ""


def metadata(soup: BeautifulSoup) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for node in soup.select("meta[name]"):
        name, value = _attr(node, "name"), _attr(node, "content")
        if name.startswith(("citation_", "DC.")) and value.strip():
            result.setdefault(name, []).append(value)
    return result


def _russian(values: list[str], label: str) -> str:
    selected = list(dict.fromkeys(v for v in values if re.search("[А-Яа-яЁё]", v)))
    if len(selected) != 1:
        raise ValueError(f"Missing or ambiguous Russian {label}")
    return text(selected[0])


def capture_page(raw: bytes, journal: str, article_id: str, accessed: str) -> dict[str, object]:
    if len(raw) > MAX_PAGE_BYTES or b"\0" in raw:
        raise ValueError("Invalid or oversized journal response")
    soup = BeautifulSoup(raw.decode("utf-8"), "html.parser")
    meta = metadata(soup)
    if meta.get("DC.Identifier") != [article_id] or "ru" not in meta.get("citation_language", []):
        raise ValueError("Wrong article identity or source language")
    heading = soup.select_one("article.article > h1")
    title = _russian(meta.get("citation_title", []), "article title")
    if heading is None or compact(heading.get_text()) != compact(title):
        raise ValueError("Article heading differs from bibliographic identity")
    license_urls = {
        v.replace("http://", "https://").rstrip("/") + "/"
        for v in meta.get("DC.Rights", [])
        if "creativecommons.org/licenses/" in v
    }
    if len(license_urls) != 1:
        raise ValueError("Missing or conflicting article-specific license")
    license_url = next(iter(license_urls))
    if license_url not in LICENSES or not any(
        _attr(a, "href").replace("http://", "https://").rstrip("/") + "/" == license_url
        for a in soup.select("a[href]")
    ):
        raise ValueError("Reuse license lacks matching publisher declaration")
    body = soup.select("article.article #tabs-2")
    if len(body) != 1:
        raise ValueError("Missing or ambiguous original full-text container")
    label = body[0].find(["h2", "h3"], recursive=False)
    if label is None or label.get_text(" ", strip=True).lower() not in {
        "полный текст",
        "full text",
    }:
        raise ValueError("Full-text container has an unexpected label")
    label.extract()
    visible = body[0].get_text(" ", strip=True)
    if len(visible) < 300 or len(re.findall("[А-Яа-яЁё]", visible)) < len(visible) * 0.25:
        raise ValueError("No substantive Russian full text; abstract-only is not admitted")
    references = soup.select("article.article #tabs-4")
    if len(references) > 1:
        raise ValueError("Ambiguous bibliography container")
    bibliography = str(references[0]) if references else ""
    fragment = str(body[0])
    return {
        "version": 1,
        "journal": journal,
        "articleId": article_id,
        "url": article_url(journal, article_id),
        "accessed": accessed,
        "responseSha256": __import__("hashlib").sha256(raw).hexdigest(),
        "metadata": meta,
        "licenseUrl": license_url,
        "fullTextHtml": fragment,
        "fullTextHtmlSha256": digest(fragment),
        "bibliographyHtml": bibliography,
        "bibliographyHtmlSha256": digest(bibliography),
        "archiveBoundary": "Publisher metadata and exact serialized article DOM fragments, not site chrome or cookies.",
    }


def definition_label(value: str) -> str | None:
    cleaned = LEADING_NUMBER.sub("", compact(value))
    match = DEFINITION.match(cleaned)
    if not match:
        return None
    label = match[1].strip()
    if BAD_START.search(label) or len(label.split()) > 16 or any(c in label for c in ":;!?"):
        return None
    if not re.match("[А-Яа-яЁёA-Za-z]", label) or not re.search("[а-яё]", label, re.I):
        return None
    if label.count("(") != label.count(")") or label.count("«") != label.count("»"):
        return None
    return label


def _geometry(node: Element) -> list[object]:
    tables = [node] if node.tag == "table" else descendants(node, "table")
    result: list[object] = []
    for table in tables:
        result.append(
            [
                [[cell["rowspan"], cell["colspan"], int(cell["header"] is True)] for cell in row]
                for row in table_grid(table)
            ]
        )
    return result


def source_units(fragment: str, container: str) -> tuple[list[Unit], dict[str, int]]:
    tree = SourceHtml(fragment).root
    units: list[Unit] = []
    omissions: dict[str, int] = {}
    headings: list[tuple[int, str]] = []
    atomic = {"p", "ol", "ul", "dl", "table", "blockquote", "pre"}

    def walk(node: Element | str, locator: str) -> None:
        if isinstance(node, str):
            if node.strip():
                units.append(
                    Unit(node.strip(), locator, tuple(v for _, v in headings), "text", [], [])
                )
            return
        if omitted(node):
            key = "media" if node.tag in {"img", "svg", "figure", "audio", "video"} else "layout"
            omissions[key] = omissions.get(key, 0) + 1
            return
        if node.tag in {"iframe", "object", "embed", "canvas"}:
            raise ValueError("Embedded source material needs separate extraction review")
        if re.fullmatch(r"h[1-6]", node.tag):
            label = compact(render(node))
            if label:
                depth = int(node.tag[1])
                while headings and headings[-1][0] >= depth:
                    headings.pop()
                headings.append((depth, label))
                units.append(Unit(label, locator, tuple(v for _, v in headings), "heading", [], []))
            return
        if node.tag in atomic:
            body = compact(render(node))
            if not body:
                return
            # Reject embedded tables/frames rather than flattening a partial or invented method.
            for tag in ("iframe", "object", "embed", "canvas"):
                if descendants(node, tag):
                    raise ValueError("Embedded source material needs separate extraction review")
            for tag in ("img", "svg", "figure", "audio", "video"):
                omissions["media"] = omissions.get("media", 0) + len(descendants(node, tag))
            probes = [body] if node.tag not in {"ol", "ul", "table"} else []
            if node.tag in {"ol", "ul"}:
                probes = [compact(render(li)) for li in descendants(node, "li")]
            proposals = [(label, probe) for probe in probes if (label := definition_label(probe))]
            units.append(
                Unit(
                    body,
                    locator,
                    tuple(v for _, v in headings),
                    node.tag,
                    _geometry(node),
                    proposals,
                )
            )
            return
        for index, child in enumerate(node.children):
            walk(child, f"{locator}/{node.tag}[{index}]")

    walk(tree, container)
    if not units or len(units) > 1000 or any(len(u.body) > 262144 for u in units):
        raise ValueError("Source unit budget exceeded or no readable full text")
    return units, omissions


def proposed_kind(label: str) -> str:
    value = label.lower()
    for needle, kind in (
        ("классификац", "classification"),
        ("критери", "criterion_set"),
        ("шкал", "scale"),
        ("синдром", "syndrome"),
        ("симптом", "symptom"),
    ):
        if needle in value:
            return kind
    return "term"


def project_article(snapshot: object, source_number: int = 1) -> dict[str, object]:
    snap = obj(snapshot)
    journal, aid = text(snap.get("journal"), 40), text(snap.get("articleId"), 12)
    url = article_url(journal, aid)
    if snap.get("version") != 1 or snap.get("url") != url:
        raise ValueError("Invalid original article snapshot")
    meta = obj(snap.get("metadata"))

    def values(key: str) -> list[str]:
        return [text(v, 65536) for v in seq(meta.get(key, []), 100)]

    title = _russian(values("citation_title"), "title")
    if values("DC.Identifier") != [aid] or "ru" not in values("citation_language"):
        raise ValueError("Snapshot no longer matches the source article")
    license_url = text(snap.get("licenseUrl"))
    declared = {
        v.replace("http://", "https://").rstrip("/") + "/"
        for v in values("DC.Rights")
        if "creativecommons.org/licenses/" in v
    }
    if license_url not in LICENSES or declared != {license_url}:
        raise ValueError("Snapshot license differs from the article declaration")
    full, bib = (
        text(snap.get("fullTextHtml"), 4 * 1024 * 1024),
        text(snap.get("bibliographyHtml"), 2 * 1024 * 1024, empty=True),
    )
    if digest(full) != snap.get("fullTextHtmlSha256") or digest(bib) != snap.get(
        "bibliographyHtmlSha256"
    ):
        raise ValueError("Archived source fragment checksum mismatch")
    if not re.fullmatch("[a-f0-9]{64}", text(snap.get("responseSha256"), 64)):
        raise ValueError("Missing original response receipt")
    publication = values("DC.Date.issued")
    doi = values("citation_doi")
    if (
        len(publication) != 1
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", publication[0])
        or len(doi) != 1
    ):
        raise ValueError("Missing unambiguous publication date or DOI")
    body, omissions = source_units(full, "#tabs-2")
    bibliography, bib_omissions = source_units(bib, "#tabs-4") if bib else ([], {})
    all_units = body + bibliography
    source = {
        "id": source_number,
        "title": title,
        "baseUrl": HOST + "/" + journal + "/",
        "path": "article/view/" + aid + "/ru_RU",
        "sourceType": "specialist-journal",
        "authority": "authored-specialist-publication",
        "releaseEligible": False,
        "journal": _russian(values("citation_journal_title"), "journal title"),
        "authors": values("citation_author"),
        "publicationDate": publication[0],
        "articleType": values("DC.Type.articleType"),
        "doi": doi[0],
        "volume": values("citation_volume"),
        "issue": values("citation_issue"),
        "pages": values("DC.Identifier.pageNumber"),
        "accessed": text(snap.get("accessed"), 40),
        "license": LICENSES[license_url],
        "licenseUrl": license_url,
        "nonCommercialOnly": "by-nc-" in license_url,
        "copyright": values("DC.Rights"),
        "sourceUrl": url,
        "responseSha256": snap["responseSha256"],
        "articleFragmentSha256": digest(full),
        "changes": "HTML to plain text, whitespace normalization, explicit list markers and physical table geometry. No medical rewriting, translation or scoring.",
        "reviewStatus": "requires-review",
        "applicability": "Author discussion at the publication date; not automatically a current guideline.",
    }
    blocks: list[dict[str, object]] = []
    for number, unit in enumerate(all_units, 1):
        blocks.append(
            {
                "id": number,
                "source": source_number,
                "text": unit.body,
                "textSha256": digest(unit.body),
                "path": source["path"],
                "locator": unit.locator,
                "sectionPath": list(unit.headings),
                "sourceElement": unit.tag,
                "tables": unit.tables,
                "tableStatus": "requires-review" if unit.tables else "not-a-table",
            }
        )
    stem = f"journal.reference.{journal.lower()}.{aid}"
    first = next((i + 1 for i, unit in enumerate(body) if unit.tag != "heading"), None)
    if first is None:
        raise ValueError("Source full text contains only headings")
    records: list[dict[str, object]] = [
        {
            "id": stem,
            "title": title,
            "kind": "term",
            "aliases": [],
            "coverage": "source-description",
            "blockIds": [first],
            "detailBlocks": [i for i in range(1, len(all_units) + 1) if i != first],
            "recordRole": "article-overview-not-independent-term",
        }
    ]
    seen: set[tuple[str, int]] = set()
    for index, unit in enumerate(body):
        number = index + 1
        labels = list(unit.definitions)
        if (
            unit.tag == "heading"
            and len(unit.body) <= 180
            and not GENERIC_HEADINGS.search(unit.body)
            and CLINICAL_HEADING.search(unit.body)
        ):
            labels.append((unit.body, unit.body))
        for label, evidence in labels:
            key = (normalized_name(label), number)
            if key in seen:
                continue
            seen.add(key)
            if label not in unit.body:
                raise ValueError("Proposed name no longer occurs verbatim in its source block")
            start = unit.body.index(label)
            related = [
                i + 1
                for i, other in enumerate(body)
                if other.headings[: len(unit.headings)] == unit.headings and i != index
            ]
            aliases: list[str] = []
            short = re.sub(r"\s*\([^()]+\)$", "", label)
            if short != label and len(short) >= 3:
                aliases.append(short)
            records.append(
                {
                    "id": stem + ".entry." + digest(encoded([unit.locator, label]))[:24],
                    "title": label,
                    "kind": proposed_kind(label),
                    "aliases": aliases,
                    "coverage": "section-excerpt"
                    if unit.tag == "heading"
                    else "explicit-definition",
                    "blockIds": [number],
                    "detailBlocks": related,
                    "labelEvidence": {"block": number, "start": start, "end": start + len(label)},
                    "proposalMethod": "source-heading"
                    if unit.tag == "heading"
                    else "source-definition-clause",
                    "articleRecordId": stem,
                }
            )
    return {
        "version": 3,
        "id": stem + ".input",
        "publicationState": "local-dev",
        "reviewStatus": "requires-review",
        "textKind": "source-excerpt",
        "sources": [source],
        "blocks": blocks,
        "terms": records,
        "extraction": {
            "bodyBlocks": len(body),
            "bibliographyBlocks": len(bibliography),
            "omissions": omissions,
            "bibliographyOmissions": bib_omissions,
            "clinicalReview": "not-performed",
            "instrumentScoring": "not-created",
        },
    }
