"""Official instruction texts of EAEU dossiers from the sister registers of Belarus and Kazakhstan.

A drug registered under the EAEU rules has one dossier number shared by every member state
(``ЛП-№(000092)-(РГ-RU)`` = ``ЛП-№000092-РГ-BY`` = ``ЛП-№000092-РГ-KZ``). The national registers of
Belarus (rceth.by) and Kazakhstan (register.ndda.kz) publish the dossier's patient leaflet (ЛВ) and
the professional text (ОХЛП) as plain PDFs without login or CAPTCHA, so they can fill registrations
the Russian GRLS gives us only a few per day. The documents are the dossier's common texts; a
member state may stamp them with its own approval, so they are stored as their own source class
(``eaeu-sister-register``) with the country, URL, checksum and fetch time of every file and are
never written into the GRLS raw tree.

Access rules: sequential, paced, TLS-verified, truthful User-Agent, ``robots.txt`` honoured
(RFC 9309), a CAPTCHA or repeated refusals stop the host. The index of dossiers that exist in more
than one country comes from the Union's open-data OData service (``opendata.eaeunion.org``,
"reuse with minimal restrictions"); it carries no document texts itself
(``drugDocumentsDetails`` is empty in every record checked).
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Literal, Protocol, cast

from .manufacturer_instructions import (
    Fetched,
    HostBlocked,
    PoliteFetcher,
    RobotsRules,
    Target,
    _contains_name,  # pyright: ignore[reportPrivateUsage]
    _tokens,  # pyright: ignore[reportPrivateUsage]
    read_jsonl,
    sha256_hex,
    utc_now,
)

USER_AGENT = (
    "MiniMed-eaeu-sister-registers/1.0 (personal single-user offline medical reference; "
    "sequential, rate-limited)"
)
SOURCE_CLASS = "eaeu-sister-register"
ODATA_URL = "https://opendata.eaeunion.org/odata/DrugRegistrationDetailsType"
BY_ORIGIN = "https://www.rceth.by"
BY_FORM_URL = f"{BY_ORIGIN}/Refbank/reestr_lekarstvennih_sredstv"
BY_RESULTS_URL = f"{BY_ORIGIN}/Refbank/reestr_lekarstvennih_sredstv/results"
KZ_ORIGIN = "https://register.ndda.kz"
KZ_LIST_URL = f"{KZ_ORIGIN}/register/api/v1/PharmaRegister/list/paged"
KZ_FILE_URL = f"{KZ_ORIGIN}/register/api/v1/PharmaRegister"

Country = Literal["BY", "KZ"]
DocKind = Literal["leaflet", "ohlp"]
TextCheck = Literal["trade-name", "inn", "no-text-layer", "mismatch"]

_ODATA_SELECT = (
    "registrationNumberId,"
    "drugCountryRegistrationDetails/unifiedCountryCode,"
    "drugCountryRegistrationDetails/drugTradeName,"
    "drugCountryRegistrationDetails/drugRegistrationCertificateDetails/registrationCertificateId"
)
_DOSSIER = re.compile(r"№\s*\(?\s*0*(\d{4,6})\s*\)?\s*-\s*\(?\s*(?:РГ|ГП)\s*-\s*([A-Z]{2})\s*\)?")
_MIN_TEXT_CHARS = 200
_MAX_FAILURES = 3  # consecutive network errors / refusals before the run stops
_MAX_RECORD_FAILURES = 12  # consecutive per-record server errors (a broken record is not the host)


def dossier_of(registration_number: str) -> tuple[str, str] | None:
    """(dossier, country) of an EAEU number such as ``ЛП-№(000092)-(РГ-RU)`` or ``…-ГП-KZ``."""
    match = _DOSSIER.search(registration_number)
    if match is None:
        return None
    return match.group(1).zfill(6), match.group(2)


# --------------------------------------------------------------------------------------
# HTTP: GET and POST with the polite fetcher's pacing, robots and refusal rules
# --------------------------------------------------------------------------------------


class Http(Protocol):
    def get(self, url: str) -> Fetched: ...

    def post(self, url: str, body: bytes, content_type: str) -> Fetched: ...


@dataclass
class SisterHttp(PoliteFetcher):
    """``PoliteFetcher`` plus POST (the registers' search forms are POST-only)."""

    user_agent: str = USER_AGENT
    timeout: float = 60.0

    def robots(self, scheme: str, host: str) -> RobotsRules | None:
        """Like the parent, but an unreachable robots.txt is retried on the next request."""
        rules = super().robots(scheme, host)
        if rules is None:
            self._robots.pop(f"{scheme}://{host}", None)
        return rules

    def post(self, url: str, body: bytes, content_type: str) -> Fetched:
        parts = urllib.parse.urlsplit(url)
        host = parts.netloc
        with self._lock(host):
            if self._refusals.get(host, 0) >= _MAX_FAILURES:
                raise HostBlocked(host)
            rules = self.robots(parts.scheme, host)
            if rules is None or not rules.allowed(url):
                return Fetched(url, url, 0, {}, b"", "disallowed-by-robots")
            self._wait(host)
            request = urllib.request.Request(
                url,
                data=body,
                headers={
                    "User-Agent": self.user_agent,
                    "Content-Type": content_type,
                    "Accept-Language": "ru",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    result = Fetched(
                        url,
                        response.geturl(),
                        response.status,
                        {key.lower(): value for key, value in response.headers.items()},
                        response.read(),
                    )
            except urllib.error.HTTPError as error:
                result = Fetched(
                    url, url, error.code, {key.lower(): v for key, v in error.headers.items()}, b""
                )
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                result = Fetched(url, url, 0, {}, b"", str(error)[:200])
            self._last[host] = time.monotonic()
            if result.status in (403, 429, 503):
                self._refusals[host] = self._refusals.get(host, 0) + 1
            else:
                self._refusals[host] = 0
            return result


# --------------------------------------------------------------------------------------
# Union OData index: which dossiers exist in which country
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class CountryEntry:
    trade_name: str
    certificate_id: str | None


@dataclass(frozen=True)
class Dossier:
    number: str  # six digits
    countries: dict[str, CountryEntry]

    def to_json(self) -> dict[str, object]:
        return {
            "dossier": self.number,
            "countries": {
                code: {"tradeName": entry.trade_name, "certificateId": entry.certificate_id}
                for code, entry in sorted(self.countries.items())
            },
        }


def parse_odata_page(payload: dict[str, object]) -> list[Dossier]:
    """Dossiers of one OData page; applications without a registration number are skipped."""
    dossiers: list[Dossier] = []
    for raw in cast(list[object], payload.get("value") or []):
        if not isinstance(raw, dict):
            continue
        record = cast(dict[str, object], raw)
        number = record.get("registrationNumberId")
        if not isinstance(number, str) or not number.strip():
            continue
        countries: dict[str, CountryEntry] = {}
        for raw_country in cast(list[object], record.get("drugCountryRegistrationDetails") or []):
            if not isinstance(raw_country, dict):
                continue
            entry = cast(dict[str, object], raw_country)
            code_node = entry.get("unifiedCountryCode")
            code = (
                cast(dict[str, object], code_node).get("value")
                if isinstance(code_node, dict)
                else None
            )
            if not isinstance(code, str):
                continue
            certificate = entry.get("drugRegistrationCertificateDetails")
            certificate_id = (
                cast(dict[str, object], certificate).get("registrationCertificateId")
                if isinstance(certificate, dict)
                else None
            )
            countries[code] = CountryEntry(
                trade_name=str(entry.get("drugTradeName") or ""),
                certificate_id=certificate_id if isinstance(certificate_id, str) else None,
            )
        dossiers.append(Dossier(number.strip().zfill(6), countries))
    return dossiers


def fetch_odata_index(
    get_json: Callable[[str], dict[str, object]],
    output: Path,
    *,
    page_size: int = 1000,
    pause: float = 3.0,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, object]:
    """Page through the Union register (minimal fields) and write ``<output>`` + ``.meta.json``."""
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    digest = hashlib.sha256()
    count = 0
    pages = 0
    skip = 0
    with temporary.open("w", encoding="utf-8") as handle:
        while True:
            query = urllib.parse.urlencode(
                {"$top": page_size, "$skip": skip, "$orderby": "Id", "$select": _ODATA_SELECT}
            )
            payload = get_json(f"{ODATA_URL}?{query}")
            rows = cast(list[object], payload.get("value") or [])
            pages += 1
            for dossier in parse_odata_page(payload):
                line = json.dumps(dossier.to_json(), ensure_ascii=False, sort_keys=True) + "\n"
                handle.write(line)
                digest.update(line.encode("utf-8"))
                count += 1
            if len(rows) < page_size:
                break
            skip += page_size
            sleep(pause)
    temporary.replace(output)
    meta: dict[str, object] = {
        "sourceClass": "eaeu-union-register-index",
        "url": ODATA_URL,
        "select": _ODATA_SELECT,
        "fetchedAt": utc_now(),
        "pages": pages,
        "dossiers": count,
        "sha256": digest.hexdigest(),
        "note": "registered dossiers only; the source carries no document texts",
    }
    output.with_suffix(output.suffix + ".meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return meta


def read_index(path: Path) -> dict[str, Dossier]:
    index: dict[str, Dossier] = {}
    for record in read_jsonl(path):
        countries = {
            code: CountryEntry(
                str(cast(dict[str, object], entry).get("tradeName") or ""),
                cast("str | None", cast(dict[str, object], entry).get("certificateId")),
            )
            for code, entry in cast(dict[str, object], record["countries"]).items()
        }
        number = str(record["dossier"])
        index[number] = Dossier(number, countries)
    return index


# --------------------------------------------------------------------------------------
# Belarus: rceth.by (HTML search, static PDFs named after the dossier)
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class SisterEntry:
    country: str
    dossier: str
    certificate: str
    trade_name: str
    inn: str
    documents: dict[DocKind, str]  # kind -> absolute URL

    def to_json(self) -> dict[str, object]:
        return {
            "country": self.country,
            "dossier": self.dossier,
            "certificate": self.certificate,
            "tradeName": self.trade_name,
            "inn": self.inn,
            "documents": dict(self.documents),
        }


class _ByRows(HTMLParser):
    """Rows of the rceth.by result table: name, INN, number cell and the NDfiles links."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[dict[str, object]] = []
        self._row: dict[str, object] | None = None
        self._cell: list[str] | None = None
        self._cells: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "tr":
            self._row = {"cells": [], "links": []}
            self._cells = []
        elif tag == "td" and self._row is not None:
            self._cell = []
        elif tag == "a" and self._row is not None:
            href = values.get("href") or ""
            if "NDfiles/pdfeaec/" in href:
                cast(list[str], self._row["links"]).append(href)

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._cell is not None and self._row is not None:
            cast(list[str], self._row["cells"]).append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row["cells"]:
                self.rows.append(self._row)
            self._row = None


def parse_by_results(page: str) -> list[SisterEntry]:
    """Registrations on one rceth.by result page (``ЛП-№…-РГ-BY`` rows with their PDF links)."""
    parser = _ByRows()
    parser.feed(page)
    entries: list[SisterEntry] = []
    for row in parser.rows:
        cells = cast(list[str], row["cells"])
        certificate = next((cell for cell in cells if cell.startswith("ЛП-")), "")
        parsed = dossier_of(certificate)
        if parsed is None:
            continue
        documents: dict[DocKind, str] = {}
        for href in cast(list[str], row["links"]):
            name = href.rsplit("/", 1)[-1].casefold()
            kind: DocKind | None = (
                "leaflet" if name == "lv.pdf" else "ohlp" if name == "ohlp.pdf" else None
            )
            if kind is not None:
                documents[kind] = urllib.parse.urljoin(BY_ORIGIN + "/", href)
        name_cell = cells[1] if len(cells) > 1 else ""
        # the trade-name cell also holds the link captions «инструкция пациента/специалиста»
        trade_name = re.sub(r"\s*инструкция\s+\w+.*$", "", name_cell).strip()
        entries.append(
            SisterEntry(
                country="BY",
                dossier=parsed[0],
                certificate=certificate,
                trade_name=trade_name,
                inn=cells[2] if len(cells) > 2 else "",
                documents=documents,
            )
        )
    return entries


def _form_fields(page: str) -> list[tuple[str, str]]:
    """Default fields of the rceth.by search form (hidden values, checked boxes, selects)."""
    start = page.find('<form action="/Refbank/reestr_lekarstvennih_sredstv/results"')
    if start < 0:
        return []
    form = page[start : page.find("</form>", start)]
    fields: list[tuple[str, str]] = []
    for tag in re.finditer(r"<input\b[^>]*>", form):
        text = tag.group(0)
        name = re.search(r'name="([^"]*)"', text)
        if name is None:
            continue
        kind = (re.search(r'type="([^"]*)"', text) or ("", "text"))[1].casefold()
        value = html.unescape((re.search(r'value="([^"]*)"', text) or ("", ""))[1])
        if kind in ("button", "submit", "reset"):
            continue
        if kind == "checkbox":
            if "checked" in text:
                fields.append((name.group(1), value))
            continue
        fields.append((name.group(1), value))
    for select in re.finditer(r'<select\b[^>]*name="([^"]*)"[^>]*>(.*?)</select>', form, re.S):
        chosen = re.search(r'<option selected="selected" value="([^"]*)"', select.group(2))
        fields.append((select.group(1), chosen.group(1) if chosen else ""))
    return fields


def _by_page_count(page: str) -> int:
    numbers = [int(value) for value in re.findall(r'id="FOpt_PageN"[^>]*propval="?(\d+)', page)]
    return max(numbers, default=1)


def by_list_entries(http: Http, *, max_pages: int = 40) -> list[SisterEntry]:
    """Every EAEU registration of Belarus: one search by number ``-BY``, then its result pages."""
    form = http.get(BY_FORM_URL)
    if form.status != 200:
        raise RuntimeError(f"rceth.by form: HTTP {form.status} {form.error or ''}")
    base = _form_fields(form.body.decode("utf-8", "replace"))
    if not base:
        raise RuntimeError("rceth.by form not recognised")

    def post(extra: dict[str, str]) -> str:
        fields = [(key, extra.get(key, value)) for key, value in base]
        known = {key for key, _ in fields}
        fields.extend((key, value) for key, value in extra.items() if key not in known)
        body = urllib.parse.urlencode(fields).encode("utf-8")
        result = http.post(BY_RESULTS_URL, body, "application/x-www-form-urlencoded")
        if result.status != 200:
            raise RuntimeError(f"rceth.by results: HTTP {result.status} {result.error or ''}")
        return result.body.decode("utf-8", "replace")

    first = post({"FProps[6].CritElems[0].Val": "-BY"})
    query = re.search(r'id="QueryStringFind"[^>]*value="([^"]*)"', first)
    entries = parse_by_results(first)
    pages = min(_by_page_count(first), max_pages)
    for number in range(2, pages + 1):
        extra = {
            "FProps[6].CritElems[0].Val": "-BY",
            "QueryStringFind": html.unescape(query.group(1)) if query else "",
            "IsPostBack": "true",
            "PropSubmit": "FOpt_PageN",
            "ValueSubmit": str(number),
        }
        entries.extend(parse_by_results(post(extra)))
    unique: dict[str, SisterEntry] = {}
    for entry in entries:
        unique.setdefault(entry.certificate, entry)
    return list(unique.values())


# --------------------------------------------------------------------------------------
# Kazakhstan: register.ndda.kz (JSON list, PDFs by register id)
# --------------------------------------------------------------------------------------


def kz_search_body(page: int, per_page: int = 200) -> bytes:
    body: dict[str, object] = {
        "tradeName": "",
        "registrationCertificateNumber": "-KZ",
        "dosageForm": "",
        "manufacturer": "",
        "country": "",
        "innOrOtherName": "",
        "atcCodeOrName": "",
        "recipeSign": None,
        "registrationDate": {"mode": 0, "dateFrom": None, "dateTo": None},
        "expirationDate": {"mode": 0, "dateFrom": None, "dateTo": None},
        "registrationStatusCodes": [],
        "drugKindCodes": [],
        "additionalFeatureCodes": [],
        "authorizationHolderNames": [],
        "currentPage": page,
        "perPage": per_page,
    }
    return json.dumps(body, ensure_ascii=False).encode("utf-8")


def kz_file_url(register_id: int | str, kind: DocKind) -> str:
    endpoint = "getRegisterInstructionFile" if kind == "leaflet" else "GetRegisterOhlpFile"
    return f"{KZ_FILE_URL}/{endpoint}?registerId={register_id}&lang=ru"


def parse_kz_list(payload: dict[str, object]) -> list[SisterEntry]:
    """EAEU rows (``sourceType == "Eaes"``) of a register.ndda.kz list page."""
    entries: list[SisterEntry] = []
    for raw in cast(list[object], payload.get("data") or []):
        if not isinstance(raw, dict):
            continue
        row = cast(dict[str, object], raw)
        if row.get("sourceType") != "Eaes":
            continue
        certificate = str(row.get("regNumber") or "")
        parsed = dossier_of(certificate)
        identifier = row.get("id")
        if parsed is None or identifier is None:
            continue
        entries.append(
            SisterEntry(
                country="KZ",
                dossier=parsed[0],
                certificate=certificate,
                trade_name=str(row.get("drugTradeName") or ""),
                inn=str(row.get("mnn") or ""),
                documents={
                    "leaflet": kz_file_url(str(identifier), "leaflet"),
                    "ohlp": kz_file_url(str(identifier), "ohlp"),
                },
            )
        )
    return entries


def kz_list_entries(http: Http, *, per_page: int = 200, max_pages: int = 40) -> list[SisterEntry]:
    entries: list[SisterEntry] = []
    page = 1
    while page <= max_pages:
        result = http.post(KZ_LIST_URL, kz_search_body(page, per_page), "application/json")
        if result.status != 200:
            raise RuntimeError(f"register.ndda.kz list: HTTP {result.status} {result.error or ''}")
        payload = cast(dict[str, object], json.loads(result.body))
        entries.extend(parse_kz_list(payload))
        last = payload.get("lastPage")
        if not isinstance(last, int) or page >= last:
            break
        page += 1
    return entries


# --------------------------------------------------------------------------------------
# Candidates: missing Russian registrations that have a sister entry
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Candidate:
    target: Target
    entry: SisterEntry

    @property
    def key(self) -> str:
        return f"{self.entry.country}:{self.entry.dossier}"


def candidates_for(targets: list[Target], entries: list[SisterEntry]) -> list[Candidate]:
    """Missing EAEU registrations whose dossier has a sister entry; essential drugs first."""
    by_dossier: dict[str, list[SisterEntry]] = {}
    for entry in entries:
        by_dossier.setdefault(entry.dossier, []).append(entry)
    found: list[Candidate] = []
    for target in targets:
        klass, digits = target.key
        if klass != "E":
            continue
        for entry in by_dossier.get(digits.zfill(6), []):
            found.append(Candidate(target, entry))
    found.sort(
        key=lambda c: (not c.target.essential, c.target.registration_number, c.entry.country)
    )
    return found


def coverage_summary(targets: list[Target], entries: list[SisterEntry]) -> dict[str, object]:
    """How much of the missing set the sister registers cover (numbers for the research note)."""
    found = candidates_for(targets, entries)
    by_country: Counter[str] = Counter()
    essential_by_country: Counter[str] = Counter()
    registrations: dict[str, set[str]] = {}
    for candidate in found:
        country = candidate.entry.country
        by_country[country] += 1
        if candidate.target.essential:
            essential_by_country[country] += 1
        registrations.setdefault(candidate.target.registration_number, set()).add(country)
    essential = {n for n in registrations if _is_essential(targets, n)}
    return {
        "missingTargets": len(targets),
        "missingEaeu": sum(1 for t in targets if t.key[0] == "E"),
        "entries": dict(Counter(entry.country for entry in entries)),
        "coveredRegistrations": len(registrations),
        "coveredEssentialRegistrations": len(essential),
        "byCountry": dict(by_country),
        "essentialByCountry": dict(essential_by_country),
        "bothCountries": sum(1 for v in registrations.values() if len(v) > 1),
    }


def _is_essential(targets: list[Target], number: str) -> bool:
    return any(t.essential for t in targets if t.registration_number == number)


# --------------------------------------------------------------------------------------
# Collection (ledger + raw files) and the manifest with provenance
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class CollectOptions:
    raw_root: Path
    max_documents: int = 50

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


_DOCX_TYPE = "wordprocessingml.document"


def _document_suffix(result: Fetched) -> str | None:
    """``.pdf`` or ``.docx`` when the response really is such a file, else ``None``.

    rceth.by answers a missing file with an HTML page and status 200, so the body is checked too.
    """
    if result.status != 200:
        return None
    content_type = result.headers.get("content-type", "").casefold()
    if result.body[:5] == b"%PDF-" and "pdf" in content_type:
        return ".pdf"
    if result.body[:4] == b"PK\x03\x04" and _DOCX_TYPE in content_type:
        return ".docx"
    return None


def collect(
    candidates: list[Candidate],
    http: Http,
    options: CollectOptions,
) -> dict[str, int]:
    """Fetch the documents of the candidates (resumable; one ledger line per URL)."""
    done = {
        str(record["url"])
        for record in read_jsonl(options.state_path)
        if record.get("outcome") in ("stored", "no-document", "not-pdf")
    }
    counters: Counter[str] = Counter()
    failures = 0
    record_failures = 0
    seen: set[str] = set()
    for candidate in candidates:
        if counters["stored"] >= options.max_documents:
            break
        for kind, url in candidate.entry.documents.items():
            if url in done or url in seen:
                continue
            seen.add(url)
            try:
                result = http.get(url)
            except HostBlocked:
                counters["host-blocked"] += 1
                return dict(counters)
            record: dict[str, object] = {
                "sourceClass": SOURCE_CLASS,
                "country": candidate.entry.country,
                "dossier": candidate.entry.dossier,
                "kind": kind,
                "url": url,
                "finalUrl": result.final_url,
                "status": result.status,
                "error": result.error,
                "fetchedAt": utc_now(),
                "contentType": result.headers.get("content-type"),
                "httpLastModified": result.headers.get("last-modified"),
                "httpEtag": result.headers.get("etag"),
                "sha256": None,
            }
            suffix = _document_suffix(result)
            if suffix is not None:
                digest = sha256_hex(result.body)
                path = options.raw_root / "files" / candidate.entry.country / f"{digest}{suffix}"
                path.parent.mkdir(parents=True, exist_ok=True)
                if not path.exists():
                    path.write_bytes(result.body)
                record.update(
                    sha256=digest, bytes=len(result.body), suffix=suffix, outcome="stored"
                )
                counters["stored"] += 1
                failures = record_failures = 0
            elif result.status == 200:
                # rceth.by answers a missing file with an HTML page and status 200
                record["outcome"] = "not-pdf"
                counters["not-pdf"] += 1
                failures = record_failures = 0
            elif result.status in (404, 410):
                record["outcome"] = "no-document"
                counters["no-document"] += 1
                failures = record_failures = 0
            else:
                record["outcome"] = "failed"
                counters["failed"] += 1
                if result.status in (0, 403, 429, 503):
                    failures += 1
                else:
                    record_failures += 1
            _append(options.state_path, record)
            if failures >= _MAX_FAILURES or record_failures >= _MAX_RECORD_FAILURES:
                counters["stopped-after-failures"] += 1
                return dict(counters)
    return dict(counters)


def check_text(text: str, target: Target) -> TextCheck:
    """Does the document talk about this registration's drug? (dossier number is the key; this
    only guards against a wrong file, it does not widen the match)."""
    if len(text.strip()) < _MIN_TEXT_CHARS:
        return "no-text-layer"
    tokens = _tokens(text)
    name = _tokens(target.trade_name)
    if name and _contains_name(tokens, name):
        return "trade-name"
    stems = {
        token[:6]
        for part in re.split(r"[,;+/()]", target.inn.casefold().replace("ё", "е"))
        for token in _tokens(part)
        if len(token) >= 6
    }
    if stems and any(token[:6] in stems for token in tokens if len(token) >= 6):
        return "inn"
    return "mismatch"


ExtractText = Callable[[Path], str]


def build_manifest(
    candidates: list[Candidate],
    options: CollectOptions,
    extract_text: ExtractText,
) -> dict[str, int]:
    """Offline: join stored files with the targets they serve and rewrite ``manifest.jsonl``.

    One row per (missing registration, document). ``textCheck == "mismatch"`` rows are kept with
    ``accepted: false`` so a wrong file never reaches a module.
    """
    stored: dict[str, list[dict[str, object]]] = {}
    for record in read_jsonl(options.state_path):
        if record.get("outcome") == "stored":
            stored.setdefault(f"{record['country']}:{record['dossier']}", []).append(record)
    rows: list[dict[str, object]] = []
    counters: Counter[str] = Counter()
    text_cache: dict[str, str] = {}
    for candidate in candidates:
        for record in stored.get(candidate.key, []):
            digest = str(record["sha256"])
            if digest not in text_cache:
                suffix = str(record.get("suffix") or ".pdf")
                path = options.raw_root / "files" / str(record["country"]) / f"{digest}{suffix}"
                text_cache[digest] = extract_text(path)
            check = check_text(text_cache[digest], candidate.target)
            accepted = check != "mismatch"
            rows.append(
                {
                    "sourceClass": SOURCE_CLASS,
                    "registrationNumber": candidate.target.registration_number,
                    "coveredRegistrationNumbers": list(candidate.target.covered_numbers),
                    "tradeName": candidate.target.trade_name,
                    "inn": candidate.target.inn,
                    "essentialDrug": candidate.target.essential,
                    "country": record["country"],
                    "dossier": record["dossier"],
                    "sisterCertificate": candidate.entry.certificate,
                    "sisterTradeName": candidate.entry.trade_name,
                    "documentKind": record["kind"],
                    "url": record["url"],
                    "sha256": digest,
                    "bytes": record.get("bytes"),
                    "fetchedAt": record["fetchedAt"],
                    "httpLastModified": record.get("httpLastModified"),
                    "matchMethod": "shared-dossier-number",
                    "textCheck": check,
                    "accepted": accepted,
                }
            )
            counters["accepted" if accepted else "rejected-mismatch"] += 1
    options.manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = options.manifest_path.with_suffix(".tmp")
    temporary.write_text(
        "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    temporary.replace(options.manifest_path)
    counters["rows"] = len(rows)
    counters["registrations"] = len({str(r["registrationNumber"]) for r in rows if r["accepted"]})
    return dict(counters)


def write_entries(entries: list[SisterEntry], output: Path, source_url: str) -> dict[str, object]:
    """Snapshot of one country's EAEU listing with its fetch time and checksum."""
    output.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(
        json.dumps(entry.to_json(), ensure_ascii=False, sort_keys=True) + "\n"
        for entry in sorted(entries, key=lambda e: e.certificate)
    )
    output.write_text(body, encoding="utf-8")
    meta: dict[str, object] = {
        "sourceClass": SOURCE_CLASS,
        "url": source_url,
        "fetchedAt": utc_now(),
        "entries": len(entries),
        "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
    }
    output.with_suffix(output.suffix + ".meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return meta


def read_entries(path: Path) -> list[SisterEntry]:
    return [
        SisterEntry(
            country=str(record["country"]),
            dossier=str(record["dossier"]),
            certificate=str(record["certificate"]),
            trade_name=str(record["tradeName"]),
            inn=str(record["inn"]),
            documents=cast("dict[DocKind, str]", record["documents"]),
        )
        for record in read_jsonl(path)
    ]
