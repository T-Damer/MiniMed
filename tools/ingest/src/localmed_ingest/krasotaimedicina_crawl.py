from __future__ import annotations

import asyncio
import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from bs4.element import Tag
from crawlee import ConcurrencySettings, Request
from crawlee.configuration import Configuration
from crawlee.crawlers import (
    BasicCrawlingContext,
    BeautifulSoupCrawler,
    BeautifulSoupCrawlingContext,
)
from crawlee.events import LocalEventManager
from crawlee.storage_clients import FileSystemStorageClient
from crawlee.storages import RequestQueue

BASE_URL = "https://www.krasotaimedicina.ru"
DISEASE_INITIALS = tuple("АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЭЮЯ")
DEFAULT_SEEDS = (
    f"{BASE_URL}/diseases/",
    f"{BASE_URL}/symptom/",
    f"{BASE_URL}/diagnostics/",
    *(f"{BASE_URL}/diseases/?{urlencode({'azfilter': initial})}" for initial in DISEASE_INITIALS),
)
USER_AGENT = "MiniMedResearchCrawler/0.1 (+https://github.com/T-Damer/MiniMed)"
QUEUE_NAME = "krasotaimedicina-reference"
_CONTENT_PATH = re.compile(r"^/(?:diseases|symptom|diagnostics)(?:/[^/?#]+){0,2}/?$", re.I)
_TREATMENT_PATH = re.compile(r"^/treatment/[^/?#]+/[^/?#]+/?$", re.I)
_IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"})
_CONTENT_TYPE_SUFFIXES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
}


@dataclass(frozen=True)
class CrawlReport:
    output: str
    pages_seen: int
    requests_finished: int
    requests_failed: int


def canonicalize_krasotaimedicina_url(value: str, *, base_url: str = BASE_URL) -> str | None:
    parsed = urlsplit(urljoin(base_url, value))
    hostname = (parsed.hostname or "").casefold()
    if parsed.scheme not in {"http", "https"} or hostname not in {
        "krasotaimedicina.ru",
        "www.krasotaimedicina.ru",
    }:
        return None
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if not (_CONTENT_PATH.fullmatch(path) or _TREATMENT_PATH.fullmatch(path)):
        return None

    parts = [part for part in path.split("/") if part]
    query: list[tuple[str, str]] = []
    if path.rstrip("/") == "/diseases":
        initial = next(
            (
                item
                for key, item in parse_qsl(parsed.query, keep_blank_values=False)
                if key == "azfilter" and item in DISEASE_INITIALS
            ),
            None,
        )
        if initial is not None:
            query.append(("azfilter", initial))
    pagination = [
        (key, page)
        for key, page in parse_qsl(parsed.query, keep_blank_values=False)
        if key == "PAGEN_1" and page.isdecimal() and len(parts) <= 2
    ]
    query.extend(pagination[:1])
    return urlunsplit(("https", "www.krasotaimedicina.ru", path, urlencode(query), ""))


def classify_krasotaimedicina_url(url: str) -> str:
    parts = [part for part in urlsplit(url).path.split("/") if part]
    if len(parts) < 3:
        return "catalog"
    return {
        "diseases": "disease",
        "symptom": "symptom",
        "diagnostics": "diagnostic_method",
        "treatment": "treatment_method",
    }[parts[0].casefold()]


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _url_digest(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _write_json(path: Path, value: object) -> None:
    _write_atomic(
        path,
        (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(),
    )


def _discover_page_urls(context: BeautifulSoupCrawlingContext, page_url: str) -> list[str]:
    urls = {
        canonical
        for anchor in context.soup.select("a[href]")
        if isinstance(anchor, Tag)
        and isinstance((href := anchor.get("href")), str)
        and (canonical := canonicalize_krasotaimedicina_url(href, base_url=page_url)) is not None
    }
    return sorted(urls)


def _discover_image_urls(
    context: BeautifulSoupCrawlingContext, page_url: str
) -> list[dict[str, str]]:
    images: dict[str, dict[str, str]] = {}
    for anchor in context.soup.select(
        ".detailGalleryRightBlock a[href], .detailTextDis .imageBlock a[href]"
    ):
        if not isinstance(anchor, Tag) or not isinstance((href := anchor.get("href")), str):
            continue
        image_url = urljoin(page_url, href)
        parsed = urlsplit(image_url)
        if parsed.hostname != "www.krasotaimedicina.ru" or not parsed.path.startswith("/upload/"):
            continue
        image = anchor.find("img")
        alt = image.get("alt", "") if isinstance(image, Tag) else ""
        images[image_url] = {"sourceUrl": image_url, "alt": str(alt).strip()}
    return list(images.values())


def _asset_suffix(url: str, content_type: str) -> str:
    normalized_type = content_type.partition(";")[0].strip().casefold()
    if normalized_type in _CONTENT_TYPE_SUFFIXES:
        return _CONTENT_TYPE_SUFFIXES[normalized_type]
    suffix = Path(urlsplit(url).path).suffix.casefold()
    return suffix if suffix in _IMAGE_SUFFIXES else ".bin"


async def _download_images(
    context: BeautifulSoupCrawlingContext,
    images: list[dict[str, str]],
    output: Path,
) -> list[dict[str, object]]:
    saved: list[dict[str, object]] = []
    for image in images:
        url = image["sourceUrl"]
        digest = _url_digest(url)
        existing = next((path for path in (output / "assets").glob(f"{digest}.*")), None)
        if existing is not None:
            payload = existing.read_bytes()
            saved.append(
                {
                    **image,
                    "path": str(existing.relative_to(output)),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "bytes": len(payload),
                }
            )
            continue
        await asyncio.sleep(1)
        try:
            response = await context.send_request(url, headers={"User-Agent": USER_AGENT})
            payload = await response.read()
        except Exception as error:
            saved.append(
                {
                    **image,
                    "errorType": type(error).__name__,
                    "error": str(error),
                }
            )
            continue
        content_type = str(response.headers.get("content-type", ""))
        if not content_type.casefold().startswith("image/") or len(payload) > 25 * 1024 * 1024:
            saved.append(
                {
                    **image,
                    "error": "Response is not an image or exceeds the 25 MiB asset limit",
                    "contentType": content_type,
                    "bytes": len(payload),
                }
            )
            continue
        path = output / "assets" / f"{digest}{_asset_suffix(url, content_type)}"
        _write_atomic(path, payload)
        saved.append(
            {
                **image,
                "path": str(path.relative_to(output)),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "bytes": len(payload),
            }
        )
    return saved


async def crawl_krasotaimedicina(
    output: Path,
    *,
    seeds: tuple[str, ...] = DEFAULT_SEEDS,
    max_pages: int = 25_000,
    requests_per_minute: int = 30,
    download_images: bool = True,
) -> CrawlReport:
    if max_pages < 1 or requests_per_minute < 1:
        raise ValueError("max_pages and requests_per_minute must be positive")
    canonical_seeds = tuple(
        canonical
        for seed in seeds
        if (canonical := canonicalize_krasotaimedicina_url(seed)) is not None
    )
    if not canonical_seeds:
        raise ValueError("At least one seed must be within the supported krasotaimedicina.ru scope")

    output.mkdir(parents=True, exist_ok=True)
    configuration = Configuration(storage_dir=str(output / "crawl-state"), purge_on_start=False)
    storage_client = FileSystemStorageClient()
    event_manager = LocalEventManager.from_config(configuration)
    queue = await RequestQueue.open(
        name=QUEUE_NAME,
        configuration=configuration,
        storage_client=storage_client,
    )
    crawler = BeautifulSoupCrawler(
        configuration=configuration,
        event_manager=event_manager,
        storage_client=storage_client,
        request_manager=queue,
        respect_robots_txt_file=True,
        concurrency_settings=ConcurrencySettings(
            min_concurrency=1,
            desired_concurrency=1,
            max_concurrency=1,
            max_tasks_per_minute=requests_per_minute,
        ),
        max_request_retries=3,
        max_requests_per_crawl=max_pages,
        request_handler_timeout=timedelta(minutes=3),
    )

    @crawler.router.default_handler
    async def handle_page(context: BeautifulSoupCrawlingContext) -> None:
        page_url = canonicalize_krasotaimedicina_url(
            context.request.loaded_url or context.request.url
        )
        if page_url is None:
            raise ValueError("Response redirected outside the configured crawl scope")
        payload = await context.http_response.read()
        digest = _url_digest(page_url)
        raw_path = output / "pages" / f"{digest}.html"
        _write_atomic(raw_path, payload)
        image_candidates = _discover_image_urls(context, page_url)
        images = (
            await _download_images(context, image_candidates, output) if download_images else []
        )
        title_node = context.soup.find("h1") or context.soup.find("title")
        _write_json(
            output / "records" / f"{digest}.json",
            {
                "schemaVersion": 1,
                "sourceId": "krasotaimedicina.ru",
                "entityType": classify_krasotaimedicina_url(page_url),
                "url": page_url,
                "requestedUrl": context.request.url,
                "fetchedAt": _utc_now(),
                "statusCode": context.http_response.status_code,
                "contentType": str(context.http_response.headers.get("content-type", "")),
                "title": title_node.get_text(" ", strip=True)
                if isinstance(title_node, Tag)
                else "",
                "rawPath": str(raw_path.relative_to(output)),
                "rawSha256": hashlib.sha256(payload).hexdigest(),
                "rawBytes": len(payload),
                "images": images,
                "imageCandidates": image_candidates if not download_images else [],
                "rightsStatus": "unresolved",
                "publicationState": "blocked",
            },
        )
        await context.add_requests(
            [
                Request.from_url(url, headers={"User-Agent": USER_AGENT})
                for url in _discover_page_urls(context, page_url)
            ]
        )

    @crawler.failed_request_handler
    async def handle_failure(
        context: BeautifulSoupCrawlingContext | BasicCrawlingContext, error: Exception
    ) -> None:
        digest = _url_digest(context.request.url)
        _write_json(
            output / "failures" / f"{digest}.json",
            {
                "schemaVersion": 1,
                "url": context.request.url,
                "failedAt": _utc_now(),
                "retryCount": context.request.retry_count,
                "errorType": type(error).__name__,
                "error": str(error),
            },
        )

    _write_json(
        output / "source.json",
        {
            "schemaVersion": 1,
            "sourceId": "krasotaimedicina.ru",
            "startedAt": _utc_now(),
            "seeds": canonical_seeds,
            "requestsPerMinute": requests_per_minute,
            "maxPagesThisRun": max_pages,
            "userAgent": USER_AGENT,
            "robotsPolicy": "enforced-by-crawlee",
            "rightsStatus": "unresolved",
            "publicationState": "blocked",
        },
    )
    statistics = await crawler.run(
        [Request.from_url(url, headers={"User-Agent": USER_AGENT}) for url in canonical_seeds],
        purge_request_queue=False,
    )
    report = CrawlReport(
        output=str(output),
        pages_seen=len(list((output / "records").glob("*.json"))),
        requests_finished=statistics.requests_finished,
        requests_failed=statistics.requests_failed,
    )
    _write_json(output / "last-run.json", asdict(report) | {"finishedAt": _utc_now()})
    return report
