"""Official instruction texts from manufacturers' sites for registrations GRLS has not given us.

Separate source class (``manufacturer-site``): raw files live under their own root and are never
written into the GRLS raw tree. A document is accepted only when it is a manufacturer-published
instruction (ОХЛП / листок-вкладыш / ИМП) that matches a missing registration by evidence that is
stored with it. Fetching is sequential per host, robots.txt-aware (RFC 9309 longest match with
``*`` and ``$``), paced, TLS-verified and sends a truthful User-Agent; there is no login and no
CAPTCHA handling (a CAPTCHA or an access refusal stops the host).
"""

from __future__ import annotations

import hashlib
import html
import json
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, cast
from zipfile import BadZipFile, ZipFile

from .grls_collect import classify_state_record, load_merged_state
from .official_grls_registry import read_instruction_plan
from .text_encoding import is_likely_garbled_russian_pdf_text

USER_AGENT = (
    "MiniMed-manufacturer-instructions/1.0 (personal single-user offline medical reference; "
    "sequential, rate-limited)"
)
SOURCE_CLASS = "manufacturer-site"
PUBLISHER_KIND = "manufacturer-site"
_ROBOTS_AGENT = "minimed-manufacturer-instructions"
_MAX_BODY = 40 * 1024 * 1024
_CAPTCHA_MARKERS = ("captcha", "g-recaptcha", "smartcaptcha", "hcaptcha")
_DOC_EXTENSION = re.compile(r"\.(pdf|docx?)(?:$|\?)", re.IGNORECASE)
_NOT_INSTRUCTION = re.compile(
    r"политик|policy|соглашен|согласие|cookie|куки|privacy|персональн|сводн|СОУТ|перечень|"
    r"сертификат|лицензи|прайс|price|каталог|catalog|презентац|брошюр|буклет",
    re.IGNORECASE,
)
_LEGAL_FORMS = re.compile(
    r"^(общество с ограниченной ответственностью|акционерное общество|закрытое акционерное общество"
    r"|открытое акционерное общество|публичное акционерное общество"
    r"|непубличное акционерное общество|федеральное государственное унитарное предприятие"
    r"|ооо|ао|зао|оао|пао|нао|фгуп)\s*",
    re.IGNORECASE,
)
_SHORT_NAME = re.compile(r"\((?:ООО|АО|ЗАО|ОАО|ПАО|НАО|ФГУП)\s*(.+?)\s*\)\s*$")
# ruff: noqa: RUF003
# Registration numbers as printed in instructions: ЛП-№(011241)-(РГ-RU), ЛП-006417, ЛСР-001234/08,
# П N014329/01, Р N003581/01, ЛС-000123. The digits core is five or six digits, optional /yy.
_REGISTRATION_IN_TEXT = re.compile(
    r"(?P<prefix>ЛП|ЛСР|ЛС|П|Р)\s*-?\s*(?:N[º°o]?|№|#)?\s*[-=]?\s*\(?\s*"
    r"(?P<core>\d{5,6}(?:/\d{2})?)\s*\)?"
    r"(?P<eaeu>\s*-?\s*\(?\s*[РP]\s*[ГG]\s*-?\s*[RР]\s*[UУ]\s*\)?)?"
)
_DATE_TEXT = r"(?:\d{2}[./]\d{2}[./]\d{4}|\d{4}-\d{2}-\d{2})"
# Version/date statements as the manufacturer prints them: «пересмотрен … dd.mm.yyyy»,
# «дата утверждения …», «ЛП-№(…)-(РГ-RU) от dd.mm.yyyy», a leading yyyy-mm-dd in the file name.
_REVISION_CONTEXT = re.compile(
    r"(?:пересмотр\w*|утвержд\w*|согласован\w*|дата\s+(?:последнего\s+)?изменени\w*)"
    rf"[^\n]{{0,40}}?{_DATE_TEXT}"
    rf"|(?:РГ\s*-?\s*RU\)?|N\s*\d{{6}}/\d{{2}})\s*от\s*{_DATE_TEXT}",
    re.IGNORECASE,
)

_SECTION_MARKERS = (
    r"показани",
    r"противопоказани",
    r"способ\s+применения|как\s+применять|прием\s+препарата",
    r"побочн|нежелательн",
    r"состав|действующе\w+\s+вещество",
    r"хранени",
)


def usability(text: str) -> dict[str, object]:
    """Cheap signals that the extracted text is a readable instruction (not a scan failure)."""
    lowered = text.casefold()
    return {
        "textLikelyGarbled": is_likely_garbled_russian_pdf_text(text),
        "standardSectionMarkers": sum(
            1 for marker in _SECTION_MARKERS if re.search(marker, lowered)
        ),
        "sectionMarkersExpected": len(_SECTION_MARKERS),
    }


MatchLevel = Literal["text-number", "page-number", "label-unique", "label-ambiguous"]


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


# --------------------------------------------------------------------------------------
# Missing registrations (targets)
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Target:
    registration_number: str
    trade_name: str
    inn: str
    dosage_form: str
    release_forms: str
    holder: str
    manufacturer: str
    country: str
    essential: bool
    prescription: str
    status: str
    covered_numbers: tuple[str, ...]

    @property
    def key(self) -> tuple[str, str]:
        return registration_key(self.registration_number)

    @property
    def holder_key(self) -> str:
        return holder_key(self.holder)

    def to_json(self) -> dict[str, object]:
        return {
            "registrationNumber": self.registration_number,
            "tradeName": self.trade_name,
            "inn": self.inn,
            "dosageForm": self.dosage_form,
            "releaseForms": self.release_forms,
            "holder": self.holder,
            "holderKey": self.holder_key,
            "manufacturer": self.manufacturer,
            "holderCountry": self.country,
            "essentialDrug": self.essential,
            "prescriptionStatus": self.prescription,
            "status": self.status,
            "coveredRegistrationNumbers": list(self.covered_numbers),
        }


def holder_key(holder: str | None) -> str:
    """Comparable holder name: the parenthesised short form or the name without legal form."""
    text = (holder or "?").replace("«", '"').replace("»", '"').replace("“", '"').replace("”", '"')
    text = " ".join(text.replace("ё", "е").replace("Ё", "Е").split())
    short = _SHORT_NAME.search(text)
    if short:
        text = short.group(1)
    text = _LEGAL_FORMS.sub("", text)
    text = re.sub(r"^(фирма|производственно-коммерческая фирма)\s+", "", text, flags=re.IGNORECASE)
    return text.strip(' "').casefold()


def registration_key(number: str) -> tuple[str, str]:
    """(class, digits core): EAEU numbers are class ``E``, others keep their prefix."""
    core = re.search(r"\d{5,6}(?:/\d{2})?", number)
    digits = core.group(0) if core else number
    if "РГ" in number:
        return ("E", digits)
    prefix = re.match(r"[А-ЯA-Z]+", number)
    return (prefix.group(0) if prefix else "", digits)


def load_targets(
    plan_path: Path,
    state_path: Path,
    grls_raw_root: Path,
    catalog_path: Path,
    *,
    include_substances: bool = False,
) -> list[Target]:
    """Registrations of the instruction plan without a GRLS PDF on disk (``ФС-`` skipped)."""
    plan = read_instruction_plan(plan_path)
    state = load_merged_state(state_path)
    catalog_decoded: object = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    records = cast(list[object], cast(dict[str, object], catalog_decoded)["records"])
    by_number: dict[str, dict[str, object]] = {}
    for raw in records:
        if isinstance(raw, dict):
            record = cast(dict[str, object], raw)
            number = record.get("registrationNumber")
            if isinstance(number, str):
                by_number.setdefault(number, record)
    targets: list[Target] = []
    for raw in cast(list[object], plan["items"]):
        item = cast(dict[str, object], raw)
        number = str(item["registrationNumber"])
        if not include_substances and number.startswith("ФС"):
            continue
        record = state.get(number)
        if classify_state_record(record) == "success" and record is not None:
            existing = grls_raw_root / str(record.get("target") or item["target"])
            if existing.is_file():
                continue
        covered = tuple(
            str(value)
            for value in cast(list[object], item.get("requestedRegistrationNumbers") or [number])
        )
        row = by_number.get(number, {})
        essential = any(by_number.get(value, {}).get("essentialDrug") == "Да" for value in covered)

        def text(field_name: str, row: dict[str, object] = row) -> str:
            value = row.get(field_name)
            return str(value) if isinstance(value, str) else ""

        targets.append(
            Target(
                registration_number=number,
                trade_name=str(item.get("tradeName") or text("tradeName")),
                inn=text("inn"),
                dosage_form=text("dosageForm"),
                release_forms=text("releaseForms"),
                holder=text("holder"),
                manufacturer=text("manufacturer"),
                country=text("holderCountry"),
                essential=essential,
                prescription=text("prescriptionStatus"),
                status=text("status"),
                covered_numbers=covered,
            )
        )
    return targets


def holder_distribution(targets: list[Target]) -> list[dict[str, object]]:
    """Holders by missing count with cumulative share, ЖНВЛП counts and top INNs."""
    groups: dict[str, list[Target]] = {}
    for target in targets:
        groups.setdefault(target.holder_key, []).append(target)
    ordered = sorted(groups.items(), key=lambda entry: (-len(entry[1]), entry[0]))
    total = len(targets)
    cumulative = 0
    rows: list[dict[str, object]] = []
    for rank, (key, members) in enumerate(ordered, 1):
        cumulative += len(members)
        top_inn = Counter(member.inn for member in members if member.inn not in ("", "~"))
        rows.append(
            {
                "rank": rank,
                "holderKey": key,
                "holder": members[0].holder,
                "country": members[0].country,
                "missing": len(members),
                "essential": sum(member.essential for member in members),
                "cumulativeShare": round(cumulative / total, 4) if total else 0.0,
                "topInn": [name for name, _ in top_inn.most_common(3)],
            }
        )
    return rows


# --------------------------------------------------------------------------------------
# robots.txt and the polite fetcher
# --------------------------------------------------------------------------------------


def _robots_pattern(path: str) -> re.Pattern[str]:
    anchored = path.endswith("$")
    body = path[:-1] if anchored else path
    expression = "".join(
        ".*" if part == "*" else re.escape(part) for part in re.split(r"(\*)", body)
    )
    return re.compile(expression + ("$" if anchored else ""))


@dataclass(frozen=True)
class RobotsRules:
    rules: tuple[tuple[bool, str], ...]  # (allow, path)

    @classmethod
    def parse(cls, body: str, token: str = _ROBOTS_AGENT) -> RobotsRules:
        groups: list[tuple[list[str], list[tuple[bool, str]]]] = []
        agents: list[str] = []
        rules: list[tuple[bool, str]] = []
        collecting_agents = True
        for raw_line in body.splitlines():
            line = raw_line.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            name, _, value = line.partition(":")
            name = name.strip().casefold()
            value = value.strip()
            if name == "user-agent":
                if not collecting_agents:
                    groups.append((agents, rules))
                    agents, rules = [], []
                    collecting_agents = True
                agents.append(value.casefold())
            elif name in ("allow", "disallow"):
                collecting_agents = False
                if value:
                    rules.append((name == "allow", value))
        groups.append((agents, rules))
        specific = [g for g in groups if any(a != "*" and a in token for a in g[0])]
        chosen = specific or [g for g in groups if "*" in g[0]]
        merged: list[tuple[bool, str]] = []
        for _, group_rules in chosen:
            merged.extend(group_rules)
        return cls(tuple(merged))

    def allowed(self, url: str) -> bool:
        parts = urllib.parse.urlsplit(url)
        path = urllib.parse.unquote(parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        best: tuple[int, bool] = (-1, True)
        for allow, rule in self.rules:
            if _robots_pattern(urllib.parse.unquote(rule)).match(path):
                length = len(rule.replace("*", ""))
                if (length, allow) > best:
                    best = (length, allow)
        return best[1]


@dataclass(frozen=True)
class Fetched:
    url: str
    final_url: str
    status: int
    headers: dict[str, str]
    body: bytes
    error: str | None = None


class HostBlocked(Exception):
    """A host answered with 429/403 repeatedly or showed a CAPTCHA: stop for this host."""


@dataclass
class PoliteFetcher:
    """One request at a time per host, paced, robots-aware. Thread-safe per host."""

    min_delay: float = 4.0
    jitter: float = 2.0
    timeout: float = 30.0
    user_agent: str = USER_AGENT
    _last: dict[str, float] = field(default_factory=lambda: dict[str, float]())
    _robots: dict[str, RobotsRules | None] = field(
        default_factory=lambda: dict[str, RobotsRules | None]()
    )
    _refusals: dict[str, int] = field(default_factory=lambda: dict[str, int]())
    _locks: dict[str, threading.Lock] = field(default_factory=lambda: dict[str, threading.Lock]())
    _guard: threading.Lock = field(default_factory=threading.Lock)

    def _lock(self, host: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(host, threading.Lock())

    def _wait(self, host: str) -> None:
        pause = self._last.get(host, 0.0) + self.min_delay + random.uniform(0, self.jitter)
        delay = pause - time.monotonic()
        if delay > 0:
            time.sleep(delay)

    def _request(self, url: str) -> Fetched:
        parts = urllib.parse.urlsplit(url)
        quoted = urllib.parse.urlunsplit(
            (
                parts.scheme,
                parts.netloc,
                urllib.parse.quote(parts.path, safe="/%:@!$&'()*+,;=-._~"),
                urllib.parse.quote(parts.query, safe="=&%+/:;,-._~"),
                "",
            )
        )
        request = urllib.request.Request(
            quoted, headers={"User-Agent": self.user_agent, "Accept-Language": "ru"}
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read(_MAX_BODY + 1)
                headers = {key.lower(): value for key, value in response.headers.items()}
                return Fetched(url, response.geturl(), response.status, headers, body[:_MAX_BODY])
        except urllib.error.HTTPError as error:
            headers = {key.lower(): value for key, value in error.headers.items()}
            return Fetched(url, url, error.code, headers, b"")
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            return Fetched(url, url, 0, {}, b"", str(error)[:200])

    def robots(self, scheme: str, host: str) -> RobotsRules | None:
        key = f"{scheme}://{host}"
        if key not in self._robots:
            result = self._request(f"{key}/robots.txt")
            self._last[host] = time.monotonic()
            if result.status == 200:
                self._robots[key] = RobotsRules.parse(result.body.decode("utf-8", "replace"))
            elif result.status in (404, 410) or 400 <= result.status < 500:
                self._robots[key] = RobotsRules(())
            else:
                self._robots[key] = None  # unreachable: treat as disallowed
        return self._robots[key]

    def get(self, url: str) -> Fetched:
        parts = urllib.parse.urlsplit(url)
        host = parts.netloc
        with self._lock(host):
            if self._refusals.get(host, 0) >= 3:
                raise HostBlocked(host)
            rules = self.robots(parts.scheme, host)
            if rules is None or not rules.allowed(url):
                return Fetched(url, url, 0, {}, b"", "disallowed-by-robots")
            self._wait(host)
            result = self._request(url)
            self._last[host] = time.monotonic()
            # A CAPTCHA wall is a small interstitial; ordinary pages may embed a feedback-form
            # captcha script, so the marker only counts on short HTML bodies.
            captcha = (
                result.status in (200, 403)
                and "html" in result.headers.get("content-type", "")
                and len(result.body) < 30_000
                and any(
                    marker in result.body.decode("utf-8", "replace").lower()
                    for marker in _CAPTCHA_MARKERS
                )
            )
            if result.status in (403, 429, 503) or captcha:
                self._refusals[host] = self._refusals.get(host, 0) + 1
                if captcha:
                    self._refusals[host] = 3
            else:
                self._refusals[host] = 0
            return result


# --------------------------------------------------------------------------------------
# Sites
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Site:
    key: str
    name: str
    base: str
    holder_keys: tuple[str, ...]  # substrings of holder_key() this site speaks for
    sitemaps: tuple[str, ...]
    page_pattern: str  # regex on page URLs taken from the sitemaps


SITES: tuple[Site, ...] = (
    Site(
        "vertex",
        "АО «ВЕРТЕКС»",
        "https://vertex.spb.ru",
        ("вертекс",),
        ("https://vertex.spb.ru/sitemap.xml",),
        r"/products/(?:prescription|otc)-medicines/[^/]+/$",
    ),
    Site(
        "promomed",
        "ООО «ПРОМОМЕД РУС»",
        "https://promomed.pro",
        ("промомед",),
        ("https://promomed.pro/sitemap-iblock-catalog-1c.xml",),
        r"/catalog/[^/]+/$",
    ),
    Site(
        "usolpharm",
        "АО «Усолье-Сибирский химфармзавод»",
        "https://www.usolpharm.ru",
        ("усолье-сибирский",),
        ("https://usolpharm.ru/sitemap.xml",),
        r"/catalog/[^/]+/$",
    ),
    Site(
        "microgen",
        "АО «НПО «Микроген»",
        "https://microgen.ru",
        ("микроген",),
        ("https://microgen.ru/sitemap.xml",),
        r"/products/[^/]+/[^/]+/$",
    ),
    Site(
        "renewal",
        "АО «ПФК Обновление» (Renewal)",
        "https://www.renewal.ru",
        ("обновление",),
        ("https://www.renewal.ru/sitemap.xml",),
        r"/products/[^/]+/$",
    ),
    Site(
        "akrikhin",
        "АО «АКРИХИН»",
        "https://akrikhin.ru",
        ("акрихин",),
        ("https://akrikhin.ru/sitemap.xml",),
        r"/catalog/[^/]+/[^/]+/$",
    ),
    Site(
        "krka",
        "АО «КРКА, д.д., Ново место»",
        "https://www.krka.ru",
        ("крка",),
        ("https://www.krka.ru/sitemap.xml",),
        r"/produkciya/nasa-produkciya/(?:recepturnye|bezrecepturnye)-preparaty/[^/]+/$",
    ),
)


def site_by_key(key: str) -> Site:
    for site in SITES:
        if site.key == key:
            return site
    raise KeyError(key)


def _locs(xml_bytes: bytes) -> list[str]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []
    return [
        element.text.strip()
        for element in root.iter()
        if element.tag.endswith("}loc") and element.text
    ]


def _same_origin(site: Site, url: str) -> str:
    """Sitemaps may list ``http://``/``www.`` variants of the host: use the site's own origin."""
    parts = urllib.parse.urlsplit(url)
    base = urllib.parse.urlsplit(site.base)
    if parts.netloc.removeprefix("www.") != base.netloc.removeprefix("www."):
        return url
    return urllib.parse.urlunsplit((base.scheme, base.netloc, parts.path, parts.query, ""))


def discover_pages(site: Site, fetcher: PoliteFetcher, limit_sitemaps: int = 40) -> list[str]:
    """Product page URLs from the site's sitemaps (one level of sitemap index)."""
    pattern = re.compile(site.page_pattern)
    queue = list(site.sitemaps)
    pages: list[str] = []
    seen: set[str] = set()
    while queue and len(seen) < limit_sitemaps:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        result = fetcher.get(url)
        if result.status != 200:
            continue
        for loc in (_same_origin(site, value) for value in _locs(result.body)):
            if loc.endswith(".xml"):
                queue.append(loc)
            elif pattern.search(urllib.parse.urlsplit(loc).path):
                pages.append(loc)
    return list(dict.fromkeys(pages))


@dataclass(frozen=True)
class PageDocument:
    url: str
    anchor_text: str


@dataclass(frozen=True)
class ParsedPage:
    title: str
    text: str
    documents: tuple[PageDocument, ...]
    registrations: tuple[str, ...]


def parse_page(page_url: str, body: bytes) -> ParsedPage:
    markup = body.decode("utf-8", "replace")
    title_match = re.search(r"<h1[^>]*>(.*?)</h1>", markup, re.DOTALL | re.IGNORECASE) or re.search(
        r"<title[^>]*>(.*?)</title>", markup, re.DOTALL | re.IGNORECASE
    )
    title = _plain(title_match.group(1)) if title_match else ""
    documents: list[PageDocument] = []
    for href, inner in re.findall(
        r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", markup, re.DOTALL | re.IGNORECASE
    ):
        anchor = _plain(inner)
        absolute = urllib.parse.urljoin(page_url, html.unescape(href))
        file_name = urllib.parse.unquote(urllib.parse.urlsplit(absolute).path.rsplit("/", 1)[-1])
        if not _DOC_EXTENSION.search(absolute) or _NOT_INSTRUCTION.search(anchor + " " + file_name):
            continue
        documents.append(PageDocument(absolute, anchor))
    cleaned = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", markup, flags=re.DOTALL | re.IGNORECASE)
    text = _plain(cleaned)
    registrations = tuple(
        dict.fromkeys(m.group(0).strip() for m in _REGISTRATION_IN_TEXT.finditer(text))
    )
    return ParsedPage(title, text, tuple(dict.fromkeys(documents)), registrations)


def _plain(fragment: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).replace("\xa0", " ").split())


# --------------------------------------------------------------------------------------
# Text extraction and matching
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class DocumentText:
    text: str
    mode: str  # pdf_text_layer | ocr | docx
    ocr_engine: str | None = None
    ocr_pages: int = 0
    ocr_mean_confidence: float | None = None
    pages: int = 0


def docx_text(payload: bytes) -> str:
    from io import BytesIO

    try:
        with ZipFile(BytesIO(payload)) as archive:
            xml_bytes = archive.read("word/document.xml")
    except (BadZipFile, KeyError):
        return ""
    root = ET.fromstring(xml_bytes)
    paragraphs: list[str] = []
    for paragraph in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
        runs = [
            node.text or ""
            for node in paragraph.iter(
                "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
            )
        ]
        paragraphs.append("".join(runs))
    return "\n".join(paragraphs)


def extract_document_text(path: Path) -> DocumentText:
    """Text via the project PDF path (text layer, macOS Vision OCR fallback) or the docx body."""
    suffix = path.suffix.casefold()
    if suffix == ".docx":
        return DocumentText(docx_text(path.read_bytes()), "docx")
    if suffix != ".pdf":
        return DocumentText("", "unsupported")
    from .pdf_import import extract_pdf

    extracted = extract_pdf(path)
    text = "\n".join(
        block.text for page in extracted.pages for block in page.blocks if not block.removed
    )
    diagnostics = extracted.diagnostics
    return DocumentText(
        text,
        diagnostics.text_extraction_mode,
        diagnostics.ocr_engine,
        len(diagnostics.ocr_pages),
        diagnostics.ocr_mean_confidence,
        len(extracted.pages),
    )


def _fold(value: str) -> str:
    return re.sub(r"[^0-9a-zа-я]+", "", value.casefold().replace("ё", "е"))


def numbers_in(text: str) -> dict[tuple[str, str], str]:
    """Registration numbers printed in text, keyed by (class, digits)."""
    found: dict[tuple[str, str], str] = {}
    for match in _REGISTRATION_IN_TEXT.finditer(text):
        klass = "E" if match.group("eaeu") else match.group("prefix")
        found.setdefault((klass, match.group("core")), match.group(0).strip())
    return found


def revision_dates(text: str, file_name: str = "", limit: int = 3) -> list[str]:
    """Version/date statements kept as printed (revision, approval, registration-date lines)."""
    found = [" ".join(m.group(0).split()) for m in _REVISION_CONTEXT.finditer(text)][:limit]
    leading = re.match(rf"({_DATE_TEXT})[_ -]", file_name)
    if leading:
        found.append(f"file name date {leading.group(1)}")
    return found


@dataclass(frozen=True)
class Match:
    registration_number: str
    trade_name: str
    level: MatchLevel
    evidence: dict[str, object]

    def to_json(self) -> dict[str, object]:
        return {
            "registrationNumber": self.registration_number,
            "tradeName": self.trade_name,
            "matchLevel": self.level,
            "evidence": self.evidence,
        }


_STRENGTH = re.compile(
    r"\d+(?:[.,]\d+)?\s*(?:мг/мл|мг/г|мкг/мл|мкг/доз[аы]?|мг|мкг|г|мл|ме|ед|%)(?![а-яa-z])",
    re.IGNORECASE,
)


def _tokens(value: str) -> list[str]:
    """Lower-case word tokens; ``+`` is kept so a combination is not mistaken for a part."""
    cleaned = re.sub(r"[®™©]", " ", value.casefold().replace("ё", "е"))
    cleaned = cleaned.replace("+", " + ")
    return re.findall(r"[0-9a-zа-я]+|\+", cleaned)


def _contains_name(head_tokens: list[str], name_tokens: list[str]) -> bool:
    """The trade name as a contiguous token run not glued to a ``+`` combination."""
    size = len(name_tokens)
    if size == 0:
        return False
    for index in range(len(head_tokens) - size + 1):
        if head_tokens[index : index + size] != name_tokens:
            continue
        before = head_tokens[index - 1] if index else ""
        after = head_tokens[index + size] if index + size < len(head_tokens) else ""
        if before != "+" and after != "+":
            return True
    return False


def _strengths(value: str) -> set[str]:
    return {_fold(match.group(0)) for match in _STRENGTH.finditer(value)}


def match_document(
    text: str,
    page_text: str,
    candidates: list[Target],
    holder_tokens: tuple[str, ...],
) -> list[Match]:
    """Match one document to the missing registrations of its holder.

    ``text-number``: the registration number and the trade name are both printed in the document
    and the holder is named. ``page-number``: the number is printed on the page that links the
    document, and trade name and holder are in the document. ``label-unique`` /
    ``label-ambiguous``: no number anywhere (EAEU листок-вкладыш usually prints none); the trade
    name heads the document, the holder is named and the dosage form agrees; unique when exactly one
    missing registration fits the form and strengths. Only the first two meet the owner's rule
    (number printed); the label tiers are provisional and stored apart.
    """
    folded = _fold(text)
    head_text = text[:1500]
    head_tokens = _tokens(head_text)
    head_strengths = _strengths(head_text)
    holder_in_text = any(token in folded for token in (_fold(t) for t in holder_tokens))
    in_text = numbers_in(text)
    on_page = set(numbers_in(page_text))
    matches: list[Match] = []
    label_hits: list[tuple[Target, int, bool]] = []
    for target in candidates:
        name_tokens = _tokens(re.sub(r"\(.*?\)", "", target.trade_name))
        keys = {target.key, *(registration_key(n) for n in target.covered_numbers)}
        name_in_text = bool(name_tokens) and _contains_name(_tokens(text), name_tokens)
        if not name_in_text:
            continue
        if keys & set(in_text):
            if holder_in_text:
                matches.append(
                    Match(
                        target.registration_number,
                        target.trade_name,
                        "text-number",
                        {"numberInText": True, "tradeNameInText": True, "holderInText": True},
                    )
                )
            continue
        if holder_in_text and keys & on_page:
            matches.append(
                Match(
                    target.registration_number,
                    target.trade_name,
                    "page-number",
                    {"numberOnPage": True, "tradeNameInText": True, "holderInText": True},
                )
            )
            continue
        if not holder_in_text or not _contains_name(head_tokens, name_tokens):
            continue
        form = _fold(target.dosage_form.split(",")[0]) if target.dosage_form else ""
        form_in_head = bool(form) and form[:8] in _fold(head_text)
        if not form_in_head:
            continue
        overlap = len(_strengths(target.release_forms) & head_strengths)
        full_form = bool(target.dosage_form) and _fold(target.dosage_form) in _fold(head_text)
        label_hits.append((target, overlap, full_form))
    if label_hits:
        best = max((hit[1], hit[2]) for hit in label_hits)
        top = [hit for hit in label_hits if (hit[1], hit[2]) == best]
        level: MatchLevel = "label-unique" if len(top) == 1 else "label-ambiguous"
        for target, overlap, full_form in top:
            matches.append(
                Match(
                    target.registration_number,
                    target.trade_name,
                    level,
                    {
                        "numberInText": False,
                        "tradeNameHeadsDocument": True,
                        "holderInText": True,
                        "dosageForm": target.dosage_form,
                        "dosageFormMatchesHead": full_form,
                        "strengthsMatchedInHead": overlap,
                        "sameNameCandidates": len(top),
                    },
                )
            )
    return matches


def relevant(candidates: list[Target], *haystack: str) -> bool:
    """Cheap prefilter so documents of products we already have are not downloaded."""
    folded = _fold(" ".join(haystack))
    stems: set[str] = set()
    for target in candidates:
        for token in re.findall(r"[а-яё]{5,}", f"{target.trade_name} {target.inn}".casefold()):
            stems.add(_fold(token)[:5])
    return any(stem in folded for stem in stems)


# --------------------------------------------------------------------------------------
# Crawl (network) and manifest (derived offline from the state ledger and the raw files)
# --------------------------------------------------------------------------------------


@dataclass
class CrawlOptions:
    raw_root: Path
    max_documents: int = 100
    prefilter: bool = True

    @property
    def state_path(self) -> Path:
        return self.raw_root / "state.jsonl"

    @property
    def manifest_path(self) -> Path:
        return self.raw_root / "manifest.jsonl"


def _append(path: Path, record: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def read_jsonl(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        return []
    return [
        cast(dict[str, object], json.loads(line))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _store(root: Path, folder: str, payload: bytes, suffix: str) -> Path:
    path = root / folder / f"{sha256_hex(payload)}{suffix}"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(payload)
    return path


def crawl_site(
    site: Site,
    targets: list[Target],
    fetcher: PoliteFetcher,
    options: CrawlOptions,
) -> dict[str, int]:
    """Resumable crawl of one site; the ledger keeps one line per fetched page/document URL."""
    candidates = [t for t in targets if any(token in t.holder_key for token in site.holder_keys)]
    candidates.sort(key=lambda target: (not target.essential, target.registration_number))
    state = {
        str(r["url"]): r
        for r in read_jsonl(options.state_path)
        if r.get("site") == site.key and r.get("status") == 200
    }
    counters: Counter[str] = Counter()
    site_root = options.raw_root / site.key
    pages = discover_pages(site, fetcher)
    counters["pages-listed"] = len(pages)
    for page_url in pages:
        if counters["documents-downloaded"] >= options.max_documents:
            break
        previous = state.get(page_url)
        if previous is not None:
            page_path = site_root / "pages" / f"{previous['sha256']}.html"
            if not page_path.is_file():
                continue
            body = page_path.read_bytes()
        else:
            result = fetcher.get(page_url)
            _append(
                options.state_path,
                {
                    "site": site.key,
                    "kind": "page",
                    "url": page_url,
                    "status": result.status,
                    "error": result.error,
                    "fetchedAt": utc_now(),
                    "sha256": sha256_hex(result.body) if result.body else None,
                },
            )
            counters[f"page-{result.status}"] += 1
            if result.status != 200:
                continue
            body = result.body
            _store(site_root, "pages", body, ".html")
        parsed = parse_page(page_url, body)
        for document in parsed.documents:
            if document.url in state:
                continue
            if options.prefilter and not relevant(
                candidates, parsed.title, document.anchor_text, urllib.parse.unquote(document.url)
            ):
                counters["documents-prefiltered"] += 1
                continue
            result = fetcher.get(document.url)
            record: dict[str, object] = {
                "site": site.key,
                "kind": "document",
                "url": document.url,
                "pageUrl": page_url,
                "pageTitle": parsed.title,
                "anchorText": document.anchor_text,
                "status": result.status,
                "error": result.error,
                "fetchedAt": utc_now(),
                "contentType": result.headers.get("content-type"),
                "httpLastModified": result.headers.get("last-modified"),
                "httpEtag": result.headers.get("etag"),
                "sha256": None,
            }
            if result.status == 200 and result.body:
                suffix = Path(urllib.parse.urlsplit(document.url).path).suffix.casefold() or ".bin"
                _store(site_root, "files", result.body, suffix)
                record["sha256"] = sha256_hex(result.body)
                record["bytes"] = len(result.body)
                counters["documents-downloaded"] += 1
            else:
                counters["documents-failed"] += 1
            _append(options.state_path, record)
            if counters["documents-downloaded"] >= options.max_documents:
                break
    return dict(counters)


def _cached_text(site_root: Path, raw_path: Path, digest: str) -> DocumentText:
    cache = site_root / "text" / f"{digest}.json"
    if cache.is_file():
        data = cast(dict[str, object], json.loads(cache.read_text(encoding="utf-8")))
        return DocumentText(
            str(data["text"]),
            str(data["mode"]),
            cast(str | None, data.get("ocrEngine")),
            int(cast(int, data.get("ocrPages", 0))),
            cast(float | None, data.get("ocrMeanConfidence")),
            int(cast(int, data.get("pages", 0))),
        )
    extracted = extract_document_text(raw_path)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(
        json.dumps(
            {
                "text": extracted.text,
                "mode": extracted.mode,
                "ocrEngine": extracted.ocr_engine,
                "ocrPages": extracted.ocr_pages,
                "ocrMeanConfidence": extracted.ocr_mean_confidence,
                "pages": extracted.pages,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return extracted


def rebuild_manifest(targets: list[Target], options: CrawlOptions) -> dict[str, int]:
    """Re-derive ``manifest.jsonl`` offline: one row per downloaded document with its matches.

    Page and document bytes come from the raw files named by the ledger; extracted text is cached.
    Documents without any match stay in the ledger only (negative evidence), not in the manifest.
    """
    sites = {site.key: site for site in SITES}
    records = read_jsonl(options.state_path)
    pages = {
        (str(r["site"]), str(r["url"])): r
        for r in records
        if r.get("kind") == "page" and r.get("status") == 200
    }
    rows: list[dict[str, object]] = []
    counters: Counter[str] = Counter()
    for record in records:
        if record.get("kind") != "document" or record.get("status") != 200:
            continue
        site = sites[str(record["site"])]
        site_root = options.raw_root / site.key
        digest = str(record["sha256"])
        suffix = Path(urllib.parse.urlsplit(str(record["url"])).path).suffix.casefold() or ".bin"
        raw_path = site_root / "files" / f"{digest}{suffix}"
        page_record = pages.get((site.key, str(record["pageUrl"])))
        page_path = site_root / "pages" / f"{page_record['sha256']}.html" if page_record else None
        if not raw_path.is_file() or page_path is None or not page_path.is_file():
            counters["missing-file"] += 1
            continue
        candidates = [
            t for t in targets if any(token in t.holder_key for token in site.holder_keys)
        ]
        extracted = _cached_text(site_root, raw_path, digest)
        page = parse_page(str(record["pageUrl"]), page_path.read_bytes())
        matches = match_document(
            extracted.text, page.text, candidates, (site.name, *site.holder_keys)
        )
        counters["documents"] += 1
        if not matches:
            counters["unmatched"] += 1
            continue
        for level in {m.level for m in matches}:
            counters[f"matched-{level}"] += 1
        rows.append(
            {
                "schemaVersion": 1,
                "sourceClass": SOURCE_CLASS,
                "publisherKind": PUBLISHER_KIND,
                "site": site.key,
                "publisher": site.name,
                "sourceUrl": record["url"],
                "pageUrl": record["pageUrl"],
                "pageTitle": record.get("pageTitle"),
                "fetchedAt": record["fetchedAt"],
                "sha256": f"sha256:{digest}",
                "bytes": record.get("bytes"),
                "contentType": record.get("contentType"),
                "httpLastModified": record.get("httpLastModified"),
                "httpEtag": record.get("httpEtag"),
                "rawPath": str(raw_path),
                "textExtractionMode": extracted.mode,
                "ocrEngine": extracted.ocr_engine,
                "ocrPages": extracted.ocr_pages,
                "ocrMeanConfidence": extracted.ocr_mean_confidence,
                "textChars": len(extracted.text),
                **usability(extracted.text),
                "documentRevision": revision_dates(
                    extracted.text, urllib.parse.unquote(str(record["url"]).rsplit("/", 1)[-1])
                ),
                "matches": [match.to_json() for match in matches],
            }
        )
    options.manifest_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    return dict(counters)
