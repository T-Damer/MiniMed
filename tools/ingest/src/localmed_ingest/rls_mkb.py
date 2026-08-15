from __future__ import annotations

import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from threading import Lock
from typing import cast
from urllib.parse import urlencode, urljoin, urlparse

import yaml

from .knowledge import (
    KnowledgeEntity,
    KnowledgeEvidence,
    KnowledgeName,
    KnowledgeRelation,
    KnowledgeWorkspace,
    MedicationProfile,
    RelationWeightComponents,
)
from .markdown_parser import parse_markdown_document

RLS_MKB_INDEX_URL = "https://www.rlsnet.ru/mkb"
RLS_MKB_DETAIL_URL = "https://www.rlsnet.ru/mkb/cerebrovaskulyarnaya-bolezn-neutocnennaya-158"
RLS_HOST = "www.rlsnet.ru"
RLS_MKB_MAX_ATTEMPTS = 3
RLS_MKB_FAILURES_FILENAME = "rls-mkb-failures.json"
RLS_MKB_DETAILS_DIRNAME = "details"
RLS_MKB_REQUEST_DELAY_SECONDS = 0.5
RLS_MKB_DETAIL_WORKERS = 4

_REQUEST_THROTTLE_LOCK = Lock()
_NEXT_REQUEST_AT = 0.0
_CODE_PATTERN = re.compile(
    r"^(?P<code>[A-ZА-Я]\d{2}(?:\.\d+)?(?:-[A-ZА-Я]\d{2}(?:\.\d+)?)?)\s+(?P<title>.+?)\s*$",
    re.IGNORECASE,
)
_SPACE_PATTERN = re.compile(r"\s+")

HtmlFetcher = Callable[[str, float], bytes]
PackingFetcher = Callable[[str, str, float], bytes]


@dataclass(frozen=True)
class RlsMkbNode:
    code: str
    title: str
    url: str


@dataclass(frozen=True)
class RlsMkbMedicine:
    tradename_id: str
    name: str
    url: str
    presentations: tuple[RlsMkbPresentation, ...] = ()
    packing_checksum: str | None = None


@dataclass(frozen=True)
class RlsMkbPresentation:
    inn: str
    dosage_form: str
    dosage: str
    packaging: str
    manufacturer: str


@dataclass(frozen=True)
class RlsMkbDetail:
    code: str
    title: str
    url: str
    checksum: str
    synonyms: tuple[str, ...]
    medicines: tuple[RlsMkbMedicine, ...]


@dataclass(frozen=True)
class RlsMkbScrapeReport:
    classification_nodes: int
    detail_pages: int
    medicines: int
    presentations: int
    output: str
    raw_files: tuple[str, ...]
    failures: int
    failures_file: str


@dataclass(frozen=True)
class _RlsMkbDetailResult:
    detail: RlsMkbDetail | None
    detail_bytes: bytes | None
    packing_failures: tuple[dict[str, object], ...]
    error: str | None


def _clean_text(value: str) -> str:
    return _SPACE_PATTERN.sub(" ", value.replace("\xa0", " ")).strip()


def _attribute(attrs: list[tuple[str, str | None]], name: str) -> str:
    wanted = name.casefold()
    return next(
        (value or "" for key, value in attrs if key.casefold() == wanted),
        "",
    )


def _class_names(attrs: list[tuple[str, str | None]]) -> set[str]:
    return set(_attribute(attrs, "class").split())


def _parse_node_text(value: str) -> tuple[str, str] | None:
    match = _CODE_PATTERN.match(_clean_text(value))
    if not match:
        return None
    code = match.group("code").upper()
    title = match.group("title").removesuffix(", МКБ-10").strip()
    return code, title


def _is_mkb_url(value: str) -> bool:
    parsed = urlparse(value)
    return (
        parsed.scheme == "https" and parsed.hostname == RLS_HOST and parsed.path.startswith("/mkb/")
    )


def _is_rls_drug_url(value: str) -> bool:
    parsed = urlparse(value)
    return (
        parsed.scheme == "https"
        and parsed.hostname == RLS_HOST
        and parsed.path.startswith("/drugs/")
    )


class _MkbIndexParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.nodes: list[RlsMkbNode] = []
        self._tree_divs = 0
        self._div_stack: list[bool] = []
        self._anchor_url: str | None = None
        self._anchor_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.casefold()
        if lowered == "div":
            is_tree = "b-tree__collapse" in _class_names(attrs)
            self._div_stack.append(is_tree)
            if is_tree:
                self._tree_divs += 1
        if lowered == "a" and self._tree_divs > 0:
            href = urljoin(RLS_MKB_INDEX_URL, _attribute(attrs, "href"))
            if _is_mkb_url(href):
                self._anchor_url = href
                self._anchor_parts = []

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.casefold()
        if lowered == "a" and self._anchor_url is not None:
            parsed = _parse_node_text("".join(self._anchor_parts))
            if parsed is not None:
                code, title = parsed
                self.nodes.append(RlsMkbNode(code=code, title=title, url=self._anchor_url))
            self._anchor_url = None
            self._anchor_parts = []
        if lowered == "div" and self._div_stack and self._div_stack.pop():
            self._tree_divs -= 1

    def handle_data(self, data: str) -> None:
        if self._anchor_url is not None:
            self._anchor_parts.append(data)


class _MkbDetailParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.synonyms: list[str] = []
        self.medicines: list[RlsMkbMedicine] = []
        self._contexts: list[str] = []
        self._tradename_ids: list[str] = []
        self._capture_tag: str | None = None
        self._capture_parts: list[str] = []
        self._capture_href: str | None = None

    def _in_context(self, value: str) -> bool:
        return value in self._contexts

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.casefold()
        if lowered == "div":
            element_id = _attribute(attrs, "id")
            self._contexts.append(element_id)
            self._tradename_ids.append(
                _attribute(attrs, "name") if element_id == "tradenamesList" else ""
            )
        if lowered == "h1":
            self._start_capture("h1")
        elif lowered == "li" and self._in_context("synonyms"):
            self._start_capture("li")
        elif (
            lowered == "a"
            and self._in_context("tableWithFilters-mkb")
            and _attribute(attrs, "name") == "tradename-link"
        ):
            self._capture_tag = "a"
            self._capture_parts = []
            self._capture_href = urljoin(RLS_MKB_DETAIL_URL, _attribute(attrs, "href"))

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.casefold()
        if self._capture_tag == lowered:
            text = _clean_text("".join(self._capture_parts))
            if self._capture_tag == "h1":
                self.title = text
            elif self._capture_tag == "li" and text:
                self.synonyms.append(text)
            elif self._capture_tag == "a" and text and self._capture_href:
                tradename_id = next(
                    (value for value in reversed(self._tradename_ids) if value),
                    "",
                )
                self.medicines.append(
                    RlsMkbMedicine(
                        tradename_id=tradename_id,
                        name=text,
                        url=self._capture_href,
                    )
                )
            self._capture_tag = None
            self._capture_parts = []
            self._capture_href = None
        if lowered == "div" and self._contexts:
            self._contexts.pop()
            self._tradename_ids.pop()

    def handle_data(self, data: str) -> None:
        if self._capture_tag is not None:
            self._capture_parts.append(data)

    def _start_capture(self, tag: str) -> None:
        if self._capture_tag is None:
            self._capture_tag = tag
            self._capture_parts = []


def parse_mkb_index(html: str, *, base_url: str = RLS_MKB_INDEX_URL) -> tuple[RlsMkbNode, ...]:
    parser = _MkbIndexParser()
    parser.feed(html)
    parser.close()
    nodes: list[RlsMkbNode] = []
    seen: set[str] = set()
    for node in parser.nodes:
        url = urljoin(base_url, node.url)
        if node.code in seen:
            continue
        seen.add(node.code)
        nodes.append(RlsMkbNode(code=node.code, title=node.title, url=url))
    return tuple(nodes)


def parse_mkb_detail(html: str, *, url: str, checksum: str | None = None) -> RlsMkbDetail:
    parser = _MkbDetailParser()
    parser.feed(html)
    parser.close()
    parsed_title = _parse_node_text(parser.title)
    if parsed_title is None:
        raise ValueError(f"RLS MKB page has no code-bearing h1: {url}")
    code, title = parsed_title
    synonyms = tuple(dict.fromkeys(value for value in parser.synonyms if value))
    medicines = tuple(
        dict.fromkeys(
            medicine
            for medicine in parser.medicines
            if medicine.name and _is_rls_drug_url(medicine.url)
        )
    )
    return RlsMkbDetail(
        code=code,
        title=title,
        url=url,
        checksum=checksum or f"sha256:{hashlib.sha256(html.encode('utf-8')).hexdigest()}",
        synonyms=synonyms,
        medicines=medicines,
    )


class _MkbPackingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.presentations: list[RlsMkbPresentation] = []
        self._row_cells: list[str] | None = None
        self._cell_parts: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lowered = tag.casefold()
        if lowered == "tr" and self._row_cells is None:
            self._row_cells = []
        elif lowered in {"td", "th"} and self._row_cells is not None:
            self._cell_parts = []

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.casefold()
        if lowered in {"td", "th"} and self._row_cells is not None and self._cell_parts is not None:
            self._row_cells.append(_clean_text("".join(self._cell_parts)))
            self._cell_parts = None
        elif lowered == "tr" and self._row_cells is not None:
            if (
                len(self._row_cells) >= 5
                and self._row_cells[0].casefold() != "действующее вещество"
            ):
                self.presentations.append(
                    RlsMkbPresentation(
                        inn=self._row_cells[0],
                        dosage_form=self._row_cells[1],
                        dosage=self._row_cells[2],
                        packaging=self._row_cells[3],
                        manufacturer=self._row_cells[4],
                    )
                )
            self._row_cells = None
            self._cell_parts = None

    def handle_data(self, data: str) -> None:
        if self._cell_parts is not None:
            self._cell_parts.append(data)


def parse_mkb_packings(html: str) -> tuple[RlsMkbPresentation, ...]:
    parser = _MkbPackingParser()
    parser.feed(html)
    parser.close()
    unique: dict[tuple[str, str, str, str, str], RlsMkbPresentation] = {}
    for presentation in parser.presentations:
        key = (
            presentation.inn.casefold(),
            presentation.dosage_form.casefold(),
            presentation.dosage.casefold(),
            presentation.packaging.casefold(),
            presentation.manufacturer.casefold(),
        )
        unique.setdefault(key, presentation)
    return tuple(unique.values())


def _throttle_rls_request() -> None:
    global _NEXT_REQUEST_AT
    with _REQUEST_THROTTLE_LOCK:
        now = time.monotonic()
        delay = max(0.0, _NEXT_REQUEST_AT - now)
        _NEXT_REQUEST_AT = now + delay + RLS_MKB_REQUEST_DELAY_SECONDS
    if delay:
        time.sleep(delay)


def _default_fetcher(url: str, timeout_seconds: float) -> bytes:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {RLS_HOST, "aurora.rlsnet.ru"}:
        raise ValueError(f"RLS source URL must use an HTTPS RLS host: {url}")
    _throttle_rls_request()
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "MiniMed-content-import/0.1"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = response.read(64 * 1024 * 1024 + 1)
    if len(payload) > 64 * 1024 * 1024:
        raise ValueError(f"RLS response exceeds the 64 MiB safety limit: {url}")
    return payload


def _default_packing_fetcher(detail_url: str, tradename_id: str, timeout_seconds: float) -> bytes:
    endpoint = urljoin(detail_url, "/api/table-change-packings")
    _throttle_rls_request()
    payload = urlencode(
        {
            "aph_id": "0",
            "pharmgroup_id": "0",
            "atc_id": "0",
            "dosageform_id": "0",
            "dosage_id": "0",
            "firm_id": "0",
            "sort": "alph01",
            "typeName": "mkb",
            "tradename": tradename_id,
            "status_id": "0",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "MiniMed-content-import/0.1",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        response_payload = response.read(64 * 1024 * 1024 + 1)
    if len(response_payload) > 64 * 1024 * 1024:
        raise ValueError(f"RLS response exceeds the 64 MiB safety limit: {endpoint}")
    return response_payload


def _fetch_with_retries(action: Callable[[], bytes]) -> bytes:
    last_error: Exception | None = None
    for attempt in range(RLS_MKB_MAX_ATTEMPTS):
        try:
            return action()
        except Exception as error:
            last_error = error
            if (
                attempt + 1 < RLS_MKB_MAX_ATTEMPTS
                and isinstance(error, urllib.error.HTTPError)
                and (error.code == 429 or error.code >= 500)
            ):
                retry_after = error.headers.get("Retry-After")
                try:
                    delay = float(retry_after) if retry_after else 5.0 * (attempt + 1)
                except ValueError:
                    delay = 5.0 * (attempt + 1)
                time.sleep(min(delay, 60.0))
    raise RuntimeError(
        f"request failed after {RLS_MKB_MAX_ATTEMPTS} attempts: {last_error}"
    ) from last_error


def _enrich_mkb_detail(
    detail: RlsMkbDetail,
    packing_fetcher: PackingFetcher,
    timeout_seconds: float,
    *,
    previous: RlsMkbDetail | None = None,
    packing_cache: dict[str, tuple[tuple[RlsMkbPresentation, ...], str]] | None = None,
) -> tuple[RlsMkbDetail, list[dict[str, object]]]:
    previous_medicines = {
        medicine.tradename_id: medicine
        for medicine in (previous.medicines if previous is not None else ())
        if medicine.tradename_id
    }
    medicines: list[RlsMkbMedicine] = []
    failures: list[dict[str, object]] = []
    for medicine in detail.medicines:
        if not medicine.tradename_id:
            medicines.append(medicine)
            continue
        cached = packing_cache.get(medicine.tradename_id) if packing_cache is not None else None
        if cached is not None:
            medicines.append(
                replace(
                    medicine,
                    presentations=cached[0],
                    packing_checksum=cached[1],
                )
            )
            continue
        try:
            packing_bytes = _fetch_with_retries(
                lambda medicine=medicine: packing_fetcher(
                    detail.url, medicine.tradename_id, timeout_seconds
                )
            )
            presentations = parse_mkb_packings(packing_bytes.decode("utf-8-sig"))
            medicines.append(
                replace(
                    medicine,
                    presentations=presentations,
                    packing_checksum=f"sha256:{hashlib.sha256(packing_bytes).hexdigest()}",
                )
            )
            if packing_cache is not None:
                packing_cache[medicine.tradename_id] = (
                    presentations,
                    f"sha256:{hashlib.sha256(packing_bytes).hexdigest()}",
                )
        except Exception as error:
            old_medicine = previous_medicines.get(medicine.tradename_id)
            medicines.append(
                replace(
                    medicine,
                    presentations=old_medicine.presentations if old_medicine else (),
                    packing_checksum=old_medicine.packing_checksum if old_medicine else None,
                )
            )
            failures.append(
                {
                    "url": detail.url,
                    "stage": "packings",
                    "tradenameId": medicine.tradename_id,
                    "attempts": RLS_MKB_MAX_ATTEMPTS,
                    "error": str(error),
                }
            )
    return replace(detail, medicines=tuple(medicines)), failures


def _detail_from_payload(payload: object) -> RlsMkbDetail:
    if not isinstance(payload, dict):
        raise ValueError("MKB detail state must be an object")
    raw = cast(dict[str, object], payload)
    raw_medicines = raw.get("medicines")
    if not isinstance(raw_medicines, list):
        raise ValueError("MKB detail state medicines must be a list")
    medicines: list[RlsMkbMedicine] = []
    for raw_medicine in raw_medicines:
        if not isinstance(raw_medicine, dict):
            raise ValueError("MKB medicine state must be an object")
        medicine = cast(dict[str, object], raw_medicine)
        raw_presentations = medicine.get("presentations", [])
        if not isinstance(raw_presentations, list):
            raise ValueError("MKB presentations state must be a list")
        presentations: list[RlsMkbPresentation] = []
        for raw_presentation in raw_presentations:
            if not isinstance(raw_presentation, dict):
                raise ValueError("MKB presentation state must be an object")
            presentation = cast(dict[str, object], raw_presentation)
            fields = {
                field: presentation.get(field)
                for field in ("inn", "dosage_form", "dosage", "packaging", "manufacturer")
            }
            if not all(isinstance(value, str) for value in fields.values()):
                raise ValueError("MKB presentation state has invalid fields")
            presentations.append(RlsMkbPresentation(**cast(dict[str, str], fields)))
        optional_checksum = medicine.get("packing_checksum")
        if optional_checksum is not None and not isinstance(optional_checksum, str):
            raise ValueError("MKB medicine packing checksum must be a string or null")
        medicine_fields = {field: medicine.get(field) for field in ("tradename_id", "name", "url")}
        if not all(isinstance(value, str) for value in medicine_fields.values()):
            raise ValueError("MKB medicine state has invalid fields")
        medicines.append(
            RlsMkbMedicine(
                **cast(dict[str, str], medicine_fields),
                presentations=tuple(presentations),
                packing_checksum=optional_checksum,
            )
        )
    raw_synonyms = raw.get("synonyms")
    if not isinstance(raw_synonyms, list) or not all(
        isinstance(value, str) for value in raw_synonyms
    ):
        raise ValueError("MKB detail synonyms state must be a list of strings")
    fields = {field: raw.get(field) for field in ("code", "title", "url", "checksum")}
    if not all(isinstance(value, str) for value in fields.values()):
        raise ValueError("MKB detail state has invalid fields")
    return RlsMkbDetail(
        **cast(dict[str, str], fields),
        synonyms=tuple(cast(list[str], raw_synonyms)),
        medicines=tuple(medicines),
    )


def _load_detail_state(details_dir: Path) -> dict[str, RlsMkbDetail]:
    details: dict[str, RlsMkbDetail] = {}
    for path in sorted(details_dir.glob("*.json")):
        detail = _detail_from_payload(json.loads(path.read_text(encoding="utf-8")))
        details[detail.url] = detail
    return details


def _write_detail_state(details_dir: Path, detail: RlsMkbDetail) -> None:
    details_dir.mkdir(parents=True, exist_ok=True)
    (details_dir / f"{_document_id(detail.code)}.json").write_text(
        json.dumps(asdict(detail), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _reset_generated_workspace(output: Path) -> Path:
    for path in output.glob("rls.mkb.node.*.md"):
        if path.is_file():
            path.unlink()
    for filename in (
        "manifest.yaml",
        "aliases.yaml",
        "knowledge.json",
        "rls-mkb-classification.md",
    ):
        path = output / filename
        if path.is_file():
            path.unlink()
    details_dir = output / RLS_MKB_DETAILS_DIRNAME
    details_dir.mkdir(parents=True, exist_ok=True)
    for path in details_dir.glob("*.json"):
        if path.is_file():
            path.unlink()
    return details_dir


def _load_failure_records(path: Path) -> dict[tuple[str, str], dict[str, object]]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("failures"), list):
        raise ValueError(f"Invalid RLS MKB failure log: {path}")
    records: dict[tuple[str, str], dict[str, object]] = {}
    for value in payload["failures"]:
        if not isinstance(value, dict) or not isinstance(value.get("url"), str):
            raise ValueError(f"Invalid RLS MKB failure record: {path}")
        record = cast(dict[str, object], value)
        url = cast(str, record["url"])
        tradename_id = record.get("tradenameId")
        if tradename_id is not None and not isinstance(tradename_id, str):
            raise ValueError(f"Invalid RLS MKB failure tradenameId: {path}")
        records[(url, tradename_id or "")] = record
    return records


def _write_failure_records(
    path: Path,
    records: dict[tuple[str, str], dict[str, object]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "maxAttempts": RLS_MKB_MAX_ATTEMPTS,
                "failures": [records[key] for key in sorted(records)],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _scrape_detail(
    detail_url: str,
    fetcher: HtmlFetcher,
    packing_fetcher: PackingFetcher,
    timeout_seconds: float,
    previous: RlsMkbDetail | None,
    packing_cache: dict[str, tuple[tuple[RlsMkbPresentation, ...], str]],
) -> _RlsMkbDetailResult:
    try:
        detail_bytes = _fetch_with_retries(lambda: fetcher(detail_url, timeout_seconds))
        detail_html = detail_bytes.decode("utf-8-sig")
        detail_checksum = f"sha256:{hashlib.sha256(detail_bytes).hexdigest()}"
        detail = parse_mkb_detail(detail_html, url=detail_url, checksum=detail_checksum)
        detail, packing_failures = _enrich_mkb_detail(
            detail,
            packing_fetcher,
            timeout_seconds,
            previous=previous,
            packing_cache=packing_cache,
        )
    except Exception as error:
        return _RlsMkbDetailResult(
            detail=None,
            detail_bytes=None,
            packing_failures=(),
            error=str(error),
        )
    return _RlsMkbDetailResult(
        detail=detail,
        detail_bytes=detail_bytes,
        packing_failures=tuple(packing_failures),
        error=None,
    )


def _version_id(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def _document_id(code: str) -> str:
    return f"rls.mkb.node.{code.lower().replace('.', '-')}"


def _source_marker(url: str, **values: str) -> str:
    payload = {"sourceUrl": url, **values}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"<!-- localmed:source {encoded} -->"


def _front_matter(detail: RlsMkbDetail) -> dict[str, object]:
    return {
        "id": _document_id(detail.code),
        "title": f"{detail.code} {detail.title}, МКБ-10",
        "short_title": f"{detail.code} {detail.title}",
        "version_label": f"rls-{_version_id(detail.checksum)}",
        "source_type": "rls_mkb_reference",
        "status": "active",
        "specialties": ["medical-reference"],
        "source_file": detail.url,
        "source_checksum": detail.checksum,
        "synthetic_fixture": False,
        "metadata": {
            "publisher": "Регистр лекарственных средств России",
            "officialSourceUrl": detail.url,
            "sourceKind": "icd-10",
            "mkbCode": detail.code,
            "icd10Codes": [detail.code],
            "requiresReview": True,
            "rightsStatus": "unknown",
            "rights": {
                "licenseId": "rlsnet-site-terms",
                "allowsOfflineStorage": False,
                "allowsDerivativeProcessing": False,
                "allowsRedistribution": False,
            },
        },
    }


def _medicine_inns(medicine: RlsMkbMedicine) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            presentation.inn for presentation in medicine.presentations if presentation.inn
        )
    )


def _search_alias(value: str) -> str:
    return re.sub(r"[®™]", "", value).strip()


def _normalized_medication(value: str) -> str:
    return _SPACE_PATTERN.sub(" ", re.sub(r"[®™]", "", value).casefold().replace("ё", "е")).strip()


def _medication_id(prefix: str, value: str) -> str:
    digest = hashlib.sha256(_normalized_medication(value).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}.{digest}"


def _detail_markdown(detail: RlsMkbDetail) -> str:
    body: list[str] = [
        "# Код и название",
        "",
        _source_marker(detail.url, mkbCode=detail.code, sourceKind="classification"),
        f"Код МКБ-10: {detail.code}. Наименование: {detail.title}.",
        "",
        "# Синонимы",
        "",
        _source_marker(detail.url, mkbCode=detail.code, sourceKind="synonyms"),
    ]
    body.extend(f"- {synonym}" for synonym in detail.synonyms)
    if not detail.synonyms:
        body.append("Синонимы на странице не указаны.")
    body.extend(
        [
            "",
            "# Препараты на странице РЛС",
            "",
            _source_marker(detail.url, mkbCode=detail.code, sourceKind="medicines"),
        ]
    )
    for medicine in detail.medicines:
        body.extend([f"- {medicine.name} — {medicine.url}"])
        inns = _medicine_inns(medicine)
        body.append(f"  МНН: {'; '.join(inns) if inns else 'не указано'}")
        if medicine.presentations:
            body.extend(
                [
                    _source_marker(
                        detail.url,
                        mkbCode=detail.code,
                        sourceKind="medicine-packings",
                        tradenameId=medicine.tradename_id,
                        packingChecksum=medicine.packing_checksum or "",
                    ),
                    "  Формы, дозировки, упаковки и производители:",
                    "",
                    "  | Лекарственная форма | Дозировка | Упаковка | Производитель |",
                    "  | --- | --- | --- | --- |",
                ]
            )
            body.extend(
                f"  | {presentation.dosage_form} | {presentation.dosage} | "
                f"{presentation.packaging} | {presentation.manufacturer} |"
                for presentation in medicine.presentations
            )
        body.append("")
    if not detail.medicines:
        body.append("Препараты на странице не указаны.")
    body.extend(
        [
            "",
            "# Источник и ограничения",
            "",
            _source_marker(detail.url, mkbCode=detail.code, sourceKind="limitations"),
            "Страница РЛС использована как справочная привязка к коду МКБ-10. "
            "Список препаратов не является клинической рекомендацией, назначением или "
            "доказательством "
            "применимости препарата конкретному пациенту.",
        ]
    )
    front_matter = yaml.safe_dump(
        _front_matter(detail),
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).rstrip()
    return f"---\n{front_matter}\n---\n\n" + "\n".join(body) + "\n"


def _classification_markdown(
    nodes: Sequence[RlsMkbNode],
    *,
    url: str,
    checksum: str,
) -> str:
    metadata = {
        "id": "rls.mkb.classification",
        "title": "Международная классификация болезней (МКБ-10) — РЛС",
        "short_title": "Классификация МКБ-10",
        "version_label": f"rls-{_version_id(checksum)}",
        "source_type": "medical_reference",
        "status": "active",
        "specialties": ["medical-reference"],
        "source_file": url,
        "source_checksum": checksum,
        "synthetic_fixture": False,
        "metadata": {
            "publisher": "Регистр лекарственных средств России",
            "officialSourceUrl": url,
            "sourceKind": "icd-10",
            "coverage": "full-index",
            "requiresReview": True,
            "rightsStatus": "unknown",
            "rights": {
                "licenseId": "rlsnet-site-terms",
                "allowsOfflineStorage": False,
                "allowsDerivativeProcessing": False,
                "allowsRedistribution": False,
            },
        },
    }
    body = [
        "# Международная классификация болезней (МКБ-10)",
        "",
        _source_marker(url, sourceKind="classification-index"),
        "Полный индекс узлов МКБ-10, извлеченный из дерева классификации РЛС. "
        "Каждая строка сохраняет код, название и ссылку на исходный узел.",
        "",
        "# Узлы классификации",
        "",
    ]
    for node in nodes:
        body.extend(
            [
                _source_marker(node.url, mkbCode=node.code, sourceKind="classification-node"),
                f"## {node.code} {node.title}",
                f"Код МКБ-10: {node.code}. Источник: {node.url}",
                "",
            ]
        )
    front_matter = yaml.safe_dump(
        metadata,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).rstrip()
    return f"---\n{front_matter}\n---\n\n" + "\n".join(body) + "\n"


def _knowledge_workspace(
    details: Iterable[RlsMkbDetail],
    documents_dir: Path,
    *,
    built_at: str,
) -> KnowledgeWorkspace:
    entities_by_id: dict[str, KnowledgeEntity] = {}
    relations: list[KnowledgeRelation] = []
    relation_ids: set[str] = set()
    for detail in details:
        code_entity_id = f"rls.mkb.entity.{detail.code.lower().replace('.', '-')}"
        entities_by_id.setdefault(
            code_entity_id,
            KnowledgeEntity(
                id=code_entity_id,
                entity_type="condition",
                canonical_name=detail.code,
                names=[
                    KnowledgeName(name=detail.title, name_type="preferred"),
                    *(KnowledgeName(name=value) for value in detail.synonyms),
                ],
                external_ids={"mkb10": detail.code},
                metadata={"sourceUrl": detail.url, "reviewStatus": "proposed"},
            ),
        )
        document = parse_markdown_document(
            documents_dir / f"{_document_id(detail.code)}.md",
            extracted_at=built_at,
        )
        section = next(
            (item for item in document.sections if item.title == "Препараты на странице РЛС"),
            None,
        )
        if section is None:
            continue
        for medicine in detail.medicines:
            evidence_chunk = next(
                (
                    chunk
                    for chunk in section.chunks
                    if medicine.name in chunk.original_text and medicine.url in chunk.original_text
                ),
                None,
            )
            if evidence_chunk is None:
                continue
            brand_id = _medication_id("medication.brand", _search_alias(medicine.name))
            brand = entities_by_id.setdefault(
                brand_id,
                KnowledgeEntity(
                    id=brand_id,
                    entity_type="medication",
                    canonical_name=medicine.name,
                    names=[KnowledgeName(name=medicine.name, name_type="trade-name", weight=1.1)],
                    external_ids={"rlsUrl": medicine.url},
                    medication=MedicationProfile(
                        concept_level="brand",
                        inn="; ".join(_medicine_inns(medicine)) or None,
                        metadata={"sourceUrl": medicine.url, "sourceKind": "rls-mkb"},
                    ),
                ),
            )
            if brand.medication is not None:
                known_presentations = brand.medication.metadata.setdefault("presentations", [])
                if isinstance(known_presentations, list):
                    for presentation in medicine.presentations:
                        payload = {
                            "inn": presentation.inn,
                            "dosageForm": presentation.dosage_form,
                            "dosage": presentation.dosage,
                            "packaging": presentation.packaging,
                            "manufacturer": presentation.manufacturer,
                        }
                        if payload not in known_presentations:
                            known_presentations.append(payload)

            locator: dict[str, object] = {
                "url": detail.url,
                "endpoint": "/api/table-change-packings",
                "tradenameId": medicine.tradename_id,
            }
            if medicine.packing_checksum:
                locator["responseChecksum"] = medicine.packing_checksum
            relation_id = _version_id(f"{detail.code}|listed-on-rls-mkb-page|{brand_id}")
            if relation_id not in relation_ids:
                relations.append(
                    KnowledgeRelation(
                        id=f"rls.mkb.relation.{relation_id}",
                        subject_entity_id=code_entity_id,
                        predicate="listed-on-rls-mkb-page",
                        object_entity_id=brand_id,
                        relation_status="reference-only",
                        authority_tier="third-party",
                        review_status="proposed",
                        jurisdiction="RU",
                        weights=RelationWeightComponents(
                            authority=0.45,
                            evidence_quality=0.75,
                            applicability=0.25,
                            recency=0.5,
                            editorial_review=0.0,
                        ),
                        evidence=[
                            KnowledgeEvidence(
                                document_id=document.id,
                                document_version_id=document.version.id,
                                section_id=section.id,
                                chunk_id=evidence_chunk.id,
                                quote=medicine.name,
                                source_locator=locator,
                            )
                        ],
                    )
                )
                relation_ids.add(relation_id)

            for inn in _medicine_inns(medicine):
                substance_id = _medication_id("medication.substance", inn)
                entities_by_id.setdefault(
                    substance_id,
                    KnowledgeEntity(
                        id=substance_id,
                        entity_type="medication",
                        canonical_name=inn,
                        names=[KnowledgeName(name=inn, name_type="inn", weight=1.2)],
                        medication=MedicationProfile(concept_level="substance", inn=inn),
                    ),
                )
                relation_id = _version_id(f"{substance_id}|active-ingredient-of|{brand_id}")
                if relation_id in relation_ids:
                    continue
                relations.append(
                    KnowledgeRelation(
                        id=f"rls.mkb.relation.{relation_id}",
                        subject_entity_id=substance_id,
                        predicate="active-ingredient-of",
                        object_entity_id=brand_id,
                        relation_status="reference-only",
                        authority_tier="third-party",
                        review_status="proposed",
                        jurisdiction="RU",
                        weights=RelationWeightComponents(
                            authority=0.45,
                            evidence_quality=0.75,
                            applicability=0.25,
                            recency=0.5,
                            editorial_review=0.0,
                        ),
                        evidence=[
                            KnowledgeEvidence(
                                document_id=document.id,
                                document_version_id=document.version.id,
                                section_id=section.id,
                                chunk_id=evidence_chunk.id,
                                quote=inn,
                                source_locator=locator,
                            )
                        ],
                    )
                )
                relation_ids.add(relation_id)
    return KnowledgeWorkspace(entities=list(entities_by_id.values()), relations=relations)


def scrape_rls_mkb(
    output: Path,
    *,
    raw_output: Path,
    classification_url: str = RLS_MKB_INDEX_URL,
    detail_urls: Sequence[str] = (),
    all_details: bool = False,
    detail_limit: int | None = None,
    built_at: str | None = None,
    timeout_seconds: float = 60.0,
    fetcher: HtmlFetcher | None = None,
    packing_fetcher: PackingFetcher | None = None,
    retry_failures: bool = False,
    failures_file: Path | None = None,
    resume: bool = False,
) -> RlsMkbScrapeReport:
    fetch = fetcher or _default_fetcher
    fetch_packings = packing_fetcher or _default_packing_fetcher
    timestamp = built_at or datetime.now(UTC).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )
    output.mkdir(parents=True, exist_ok=True)
    raw_output.mkdir(parents=True, exist_ok=True)
    failure_path = failures_file or raw_output / RLS_MKB_FAILURES_FILENAME
    stateful_run = retry_failures or resume
    failure_records = _load_failure_records(failure_path) if stateful_run else {}
    details_dir = (
        output / RLS_MKB_DETAILS_DIRNAME if stateful_run else _reset_generated_workspace(output)
    )
    details_by_url = _load_detail_state(details_dir) if stateful_run else {}
    packing_cache: dict[str, tuple[tuple[RlsMkbPresentation, ...], str]] = {
        medicine.tradename_id: (medicine.presentations, medicine.packing_checksum)
        for detail in details_by_url.values()
        for medicine in detail.medicines
        if medicine.tradename_id and medicine.packing_checksum
    }

    classification_bytes = _fetch_with_retries(lambda: fetch(classification_url, timeout_seconds))
    classification_html = classification_bytes.decode("utf-8-sig")
    classification_checksum = f"sha256:{hashlib.sha256(classification_bytes).hexdigest()}"
    classification_nodes = parse_mkb_index(classification_html, base_url=classification_url)
    if not classification_nodes:
        raise ValueError(f"No MKB nodes found in RLS classification page: {classification_url}")

    if retry_failures:
        requested_detail_urls = tuple(
            dict.fromkeys(cast(str, record["url"]) for record in failure_records.values())
        )
    elif resume:
        pending_urls = [node.url for node in classification_nodes if node.url not in details_by_url]
        requested_detail_urls = tuple(dict.fromkeys(pending_urls))
    else:
        requested_detail_urls = tuple(dict.fromkeys(detail_urls))
        if all_details:
            requested_detail_urls = tuple(node.url for node in classification_nodes)
        if detail_limit is not None:
            requested_detail_urls = requested_detail_urls[:detail_limit]

    raw_files: list[str] = []
    with ThreadPoolExecutor(max_workers=RLS_MKB_DETAIL_WORKERS) as executor:
        futures = {
            executor.submit(
                _scrape_detail,
                detail_url,
                fetch,
                fetch_packings,
                timeout_seconds,
                details_by_url.get(detail_url),
                packing_cache,
            ): detail_url
            for detail_url in requested_detail_urls
        }
        for future in as_completed(futures):
            detail_url = futures[future]
            previous_failure_keys = tuple(key for key in failure_records if key[0] == detail_url)
            for key in previous_failure_keys:
                failure_records.pop(key)
            try:
                result = future.result()
            except Exception as error:
                result = _RlsMkbDetailResult(None, None, (), str(error))
            if result.detail is None:
                failure_records[(detail_url, "")] = {
                    "url": detail_url,
                    "stage": "detail",
                    "attempts": RLS_MKB_MAX_ATTEMPTS,
                    "error": result.error or "detail worker failed",
                }
                _write_failure_records(failure_path, failure_records)
                continue
            for failure in result.packing_failures:
                failure_records[(detail_url, str(failure["tradenameId"]))] = failure
            details_by_url[detail_url] = result.detail
            _write_detail_state(details_dir, result.detail)
            if result.packing_failures or previous_failure_keys:
                _write_failure_records(failure_path, failure_records)
    _write_failure_records(failure_path, failure_records)
    details = sorted(details_by_url.values(), key=lambda item: (item.code, item.url))

    (output / "manifest.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "minimed.rls.mkb",
                "version": f"0.1.0-{_version_id(classification_checksum)}",
                "schemaVersion": 2,
                "title": "МКБ-10 и привязки РЛС",
                "builtAt": timestamp,
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    aliases: list[dict[str, object]] = []
    seen_medication_aliases: set[tuple[str, str]] = set()
    for detail in details:
        code_slug = detail.code.lower().replace(".", "-")
        aliases.extend(
            {
                "id": f"alias.rls.mkb.{code_slug}.{index}",
                "canonicalTerm": detail.code,
                "alias": synonym,
                "category": "diagnosis",
                "weight": 1.0,
            }
            for index, synonym in enumerate(detail.synonyms)
        )
        for medicine in detail.medicines:
            trade_name = _search_alias(medicine.name)
            for inn in _medicine_inns(medicine):
                if not trade_name or _normalized_medication(trade_name) == _normalized_medication(
                    inn
                ):
                    continue
                alias_key = (_normalized_medication(trade_name), _normalized_medication(inn))
                if alias_key in seen_medication_aliases:
                    continue
                seen_medication_aliases.add(alias_key)
                aliases.append(
                    {
                        "id": (f"alias.rls.mkb.medication.{_version_id(trade_name + '|' + inn)}"),
                        "canonicalTerm": inn,
                        "alias": trade_name,
                        "category": "medication",
                        "weight": 1.0,
                    }
                )
    (output / "aliases.yaml").write_text(
        yaml.safe_dump(
            {"aliases": aliases},
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (output / "rls-mkb-classification.md").write_text(
        _classification_markdown(
            classification_nodes,
            url=classification_url,
            checksum=classification_checksum,
        ),
        encoding="utf-8",
    )
    for detail in details:
        (output / f"{_document_id(detail.code)}.md").write_text(
            _detail_markdown(detail),
            encoding="utf-8",
        )
    knowledge = _knowledge_workspace(details, output, built_at=timestamp)
    (output / "knowledge.json").write_text(
        json.dumps(knowledge.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return RlsMkbScrapeReport(
        classification_nodes=len(classification_nodes),
        detail_pages=len(details),
        medicines=sum(len(detail.medicines) for detail in details),
        presentations=sum(
            len(medicine.presentations) for detail in details for medicine in detail.medicines
        ),
        output=str(output),
        raw_files=tuple(raw_files),
        failures=len(failure_records),
        failures_file=str(failure_path),
    )
