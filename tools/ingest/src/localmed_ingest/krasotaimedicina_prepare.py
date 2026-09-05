from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import yaml
from bs4 import BeautifulSoup
from bs4.element import NavigableString, Tag

_SPACE = re.compile(r"\s+")
_ICD10 = re.compile(
    r"(?<![A-ZА-Я0-9])[A-Z]\d{2}(?:\.\d+)?(?:-[A-Z]?\d{2}(?:\.\d+)?)?(?![A-ZА-Я0-9])"
)
_SYNDROME = re.compile(r"(^|[\s(—-])синдром", re.IGNORECASE)


@dataclass(frozen=True)
class KrasotaimedicinaPrepareReport:
    records_seen: int
    documents_prepared: int
    syndromes_prepared: int
    records_skipped: int
    output: str


def _text(node: Tag) -> str:
    return _SPACE.sub(" ", node.get_text(" ", strip=True)).strip()


def _inline_markdown(node: Tag, page_url: str) -> str:
    parts: list[str] = []
    for child in node.children:
        if isinstance(child, NavigableString):
            parts.append(str(child))
            continue
        if not isinstance(child, Tag):
            continue
        text = _inline_markdown(child, page_url)
        if child.name == "a" and text:
            href = child.get("href")
            target = urljoin(page_url, href) if isinstance(href, str) else ""
            parsed = urlsplit(target)
            parts.append(f"[{text}]({target})" if parsed.scheme in {"http", "https"} else text)
        elif child.name in {"strong", "b"} and text:
            parts.append(f"**{text}**")
        elif child.name in {"em", "i"} and text:
            parts.append(f"*{text}*")
        elif child.name == "br":
            parts.append("\n")
        else:
            parts.append(text)
    return _SPACE.sub(" ", "".join(parts)).strip()


def _source_marker(record: dict[str, object], selector: str) -> str:
    payload = {
        "sourceUrl": record["url"],
        "rawPath": record["rawPath"],
        "rawSha256": record["rawSha256"],
        "selector": selector,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"<!-- localmed:source {encoded} -->"


def _article_markdown(soup: BeautifulSoup, record: dict[str, object]) -> str:
    page_url = str(record["url"])
    article = soup.select_one(".detailTextDis")
    if not isinstance(article, Tag):
        return ""
    for navigation in article.select(".relatedMaterialBody"):
        navigation.decompose()

    lines: list[str] = []
    preview = soup.select_one(".previewTextDis [itemprop='description']")
    if isinstance(preview, Tag) and (summary := _inline_markdown(preview, page_url)):
        lines.extend(
            ["# Краткое описание", "", _source_marker(record, ".previewTextDis"), summary, ""]
        )

    block_index = 0
    for block in article.select("h2, h3, h4, p, ul, ol, .imageBlock"):
        if not isinstance(block, Tag):
            continue
        if block.name == "p" and block.find_parent(["ul", "ol"]) is not None:
            continue
        if block.name in {"ul", "ol"} and block.find_parent(["ul", "ol"]) is not None:
            continue
        block_index += 1
        selector = f".detailTextDis:block-{block_index}"
        if block.name in {"h2", "h3", "h4"}:
            level = int(block.name[1]) - 1
            lines.extend([f"{'#' * max(level, 1)} {_text(block)}", ""])
            continue
        if "imageBlock" in (block.get("class") or []):
            image = block.find("img")
            anchor = block.find("a", href=True)
            if not isinstance(image, Tag):
                continue
            source = image.get("src")
            if isinstance(anchor, Tag) and isinstance(anchor.get("href"), str):
                source = anchor.get("href")
            if not isinstance(source, str):
                continue
            source_url = urljoin(page_url, source)
            alt = str(image.get("alt") or record["title"]).strip()
            lines.extend(
                [
                    _source_marker(record, selector),
                    f"![{alt}]({source_url})",
                    "",
                    f"[Источник изображения]({source_url})",
                    "",
                ]
            )
            continue
        if block.name in {"ul", "ol"}:
            items = block.find_all("li", recursive=False)
            rendered = [
                f"{'1.' if block.name == 'ol' else '-'} {_inline_markdown(item, page_url)}"
                for item in items
                if _inline_markdown(item, page_url)
            ]
            if rendered:
                lines.extend([_source_marker(record, selector), *rendered, ""])
            continue
        paragraph = _inline_markdown(block, page_url)
        if paragraph:
            lines.extend([_source_marker(record, selector), paragraph, ""])
    return "\n".join(lines).strip()


def _record(path: Path) -> dict[str, object]:
    value: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected record mapping: {path}")
    record = {str(key): item for key, item in value.items()}
    for key in ("entityType", "fetchedAt", "rawPath", "rawSha256", "title", "url"):
        if not isinstance(record.get(key), str) or not str(record[key]).strip():
            raise ValueError(f"{path}: {key} must be a non-empty string")
    return record


def _document_markdown(record: dict[str, object], raw_root: Path) -> tuple[str, bool] | None:
    if record["entityType"] != "disease":
        return None
    raw_path = raw_root / str(record["rawPath"])
    payload = raw_path.read_bytes()
    checksum = hashlib.sha256(payload).hexdigest()
    if checksum != record["rawSha256"]:
        raise ValueError(f"Raw checksum mismatch: {raw_path}")
    soup = BeautifulSoup(payload, "html.parser")
    body = _article_markdown(soup, record)
    if not body:
        return None

    title = str(record["title"]).strip()
    syndrome = _SYNDROME.search(title) is not None
    codes = list(
        dict.fromkeys(
            match.group(0).upper()
            for node in soup.select(".diseaseMkbItem")
            for match in _ICD10.finditer(_text(node))
        )
    )
    url_digest = hashlib.sha256(str(record["url"]).encode()).hexdigest()[:16]
    images = record.get("images") if isinstance(record.get("images"), list) else []
    metadata = {
        "id": f"krasotaimedicina.disease.{url_digest}",
        "title": title,
        "short_title": title,
        "version_label": f"site-{checksum[:12]}",
        "source_type": "krasotaimedicina_reference",
        "status": "active",
        "specialties": ["medical-reference"],
        "source_file": str(record["url"]),
        "source_checksum": f"sha256:{checksum}",
        "synthetic_fixture": False,
        "metadata": {
            "publisher": "Красота и медицина",
            "officialSourceUrl": record["url"],
            "sourceKind": "disease-reference",
            "entityType": "syndrome" if syndrome else "disease",
            "icd10Codes": codes,
            "rawPath": record["rawPath"],
            "images": images,
            "requiresReview": True,
            "rightsStatus": record.get("rightsStatus", "unresolved"),
            "publicationState": record.get("publicationState", "blocked"),
        },
    }
    front_matter = yaml.safe_dump(
        metadata, allow_unicode=True, sort_keys=False, default_flow_style=False
    ).rstrip()
    return f"---\n{front_matter}\n---\n\n{body}\n", syndrome


def prepare_krasotaimedicina(raw_root: Path, output: Path) -> KrasotaimedicinaPrepareReport:
    record_paths = sorted((raw_root / "records").glob("*.json"))
    if not record_paths:
        raise ValueError(f"No crawl records found under {raw_root}")

    prepared: list[tuple[str, str]] = []
    fetched_at: list[str] = []
    syndromes = 0
    skipped = 0
    digest = hashlib.sha256()
    for path in record_paths:
        record = _record(path)
        result = _document_markdown(record, raw_root)
        if result is None:
            skipped += 1
            continue
        markdown, syndrome = result
        document_id = hashlib.sha256(str(record["url"]).encode()).hexdigest()[:16]
        prepared.append((f"krasotaimedicina.disease.{document_id}.md", markdown))
        fetched_at.append(str(record["fetchedAt"]))
        digest.update(str(record["rawSha256"]).encode())
        syndromes += syndrome
    if not prepared:
        raise ValueError("The crawl snapshot contains no disease articles")

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{output.name}.", dir=output.parent) as temporary:
        workspace = Path(temporary)
        for name, markdown in prepared:
            (workspace / name).write_text(markdown, encoding="utf-8")
        version = digest.hexdigest()[:12]
        manifest = {
            "id": "minimed.krasotaimedicina.diseases",
            "version": f"0.1.0-{version}",
            "schemaVersion": 2,
            "title": "Справочник заболеваний — Красота и медицина",
            "builtAt": max(fetched_at),
            "publicationState": "local-dev",
        }
        (workspace / "manifest.yaml").write_text(
            yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        (workspace / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
        report = KrasotaimedicinaPrepareReport(
            records_seen=len(record_paths),
            documents_prepared=len(prepared),
            syndromes_prepared=syndromes,
            records_skipped=skipped,
            output=str(output),
        )
        (workspace / "prepare-report.json").write_text(
            json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        if output.exists():
            shutil.rmtree(output)
        workspace.rename(output)
    return report
