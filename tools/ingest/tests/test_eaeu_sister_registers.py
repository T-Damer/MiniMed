from __future__ import annotations

import json
import urllib.parse
from pathlib import Path
from typing import cast

from localmed_ingest.eaeu_sister_registers import (
    BY_FORM_URL,
    BY_RESULTS_URL,
    KZ_LIST_URL,
    SOURCE_CLASS,
    Candidate,
    CollectOptions,
    DocKind,
    SisterEntry,
    build_manifest,
    by_list_entries,
    candidates_for,
    check_text,
    collect,
    coverage_summary,
    dossier_of,
    fetch_odata_index,
    kz_file_url,
    kz_list_entries,
    parse_by_results,
    parse_kz_list,
    parse_odata_page,
    read_entries,
    read_index,
    write_entries,
)
from localmed_ingest.manufacturer_instructions import Fetched, HostBlocked, Target, read_jsonl

FIXTURES = Path(__file__).parent / "fixtures" / "eaeu_sister"
PDF = b"%PDF-1.5\n% fixture body\n"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def target(number: str, name: str, inn: str = "", essential: bool = False) -> Target:
    return Target(
        registration_number=number,
        trade_name=name,
        inn=inn,
        dosage_form="раствор",
        release_forms="",
        holder="Санофи",
        manufacturer="",
        country="Франция",
        essential=essential,
        prescription="По рецепту",
        status="Действующий",
        covered_numbers=(number,),
    )


def ok(url: str, body: bytes, content_type: str, **headers: str) -> Fetched:
    return Fetched(url, url, 200, {"content-type": content_type, **headers}, body)


class FakeHttp:
    """GET/POST answers keyed by URL; records every call and the POST bodies."""

    def __init__(
        self,
        gets: dict[str, Fetched | list[Fetched]] | None = None,
        posts: list[Fetched] | None = None,
    ) -> None:
        self.gets = gets or {}
        self.posts = list(posts or [])
        self.get_log: list[str] = []
        self.post_log: list[tuple[str, dict[str, list[str]]]] = []

    def get(self, url: str) -> Fetched:
        self.get_log.append(url)
        answer = self.gets.get(url)
        if isinstance(answer, list):
            return answer.pop(0)
        if answer is None:
            return Fetched(url, url, 404, {}, b"")
        return answer

    def post(self, url: str, body: bytes, content_type: str) -> Fetched:
        del content_type
        text = body.decode("utf-8")
        parsed = urllib.parse.parse_qs(text) if "=" in text and not text.startswith("{") else {}
        self.post_log.append((url, parsed if parsed else {"json": [text]}))
        return self.posts.pop(0)


def test_dossier_of_reads_every_member_state_format() -> None:
    assert dossier_of("ЛП-№(000092)-(РГ-RU)") == ("000092", "RU")
    assert dossier_of("ЛП-№000092-РГ-BY") == ("000092", "BY")
    assert dossier_of("ЛП-№000022-ГП-KZ") == ("000022", "KZ")
    assert dossier_of("ЛП-№(22)-(РГ-RU)") is None  # fewer than four digits is not a dossier
    assert dossier_of("РК-ЛС-5№000022") is None
    assert dossier_of("П N014329/01") is None


def test_odata_page_keeps_registered_dossiers_only() -> None:
    dossiers = parse_odata_page(json.loads(fixture("odata_page_1.json")))
    assert [d.number for d in dossiers] == ["000554"]  # the application without a number is skipped
    assert set(dossiers[0].countries) == {"RU", "BY", "KZ"}
    assert dossiers[0].countries["RU"].certificate_id == "ЛП-№(000554)-(РГ-RU)"
    assert dossiers[0].countries["BY"].certificate_id is None


def test_fetch_odata_index_pages_writes_meta_and_round_trips(tmp_path: Path) -> None:
    pages = [json.loads(fixture("odata_page_1.json")), json.loads(fixture("odata_page_2.json"))]
    urls: list[str] = []
    sleeps: list[float] = []

    def get_json(url: str) -> dict[str, object]:
        urls.append(url)
        return cast(dict[str, object], pages[len(urls) - 1])

    output = tmp_path / "union-index.jsonl"
    meta = fetch_odata_index(get_json, output, page_size=2, pause=3.0, sleep=sleeps.append)
    assert meta["dossiers"] == 2 and meta["pages"] == 2
    assert "%24skip=0" in urls[0] and "%24skip=2" in urls[1] and "%24top=2" in urls[0]
    assert sleeps == [3.0]
    stored = json.loads(output.with_suffix(".jsonl.meta.json").read_text(encoding="utf-8"))
    assert stored["sourceClass"] == "eaeu-union-register-index"
    assert len(stored["sha256"]) == 64 and stored["fetchedAt"].endswith("Z")
    index = read_index(output)
    assert set(index) == {"000554", "000022"}  # the page-2 number is zero-padded to six digits
    assert index["000554"].countries["BY"].trade_name == "КОРДАРОН®"


def test_parse_by_results_extracts_numbers_names_and_document_links() -> None:
    entries = parse_by_results(fixture("by_results_1.html"))
    assert [e.dossier for e in entries] == ["000554", "000022"]  # the national РБ- row is skipped
    cordaron = entries[0]
    assert cordaron.country == "BY" and cordaron.certificate == "ЛП-№000554-РГ-BY"
    assert cordaron.trade_name == "КОРДАРОН®" and cordaron.inn == "амиодарон"
    assert cordaron.documents == {
        "leaflet": "https://www.rceth.by/NDfiles/pdfeaec/000554/LV.pdf",
        "ohlp": "https://www.rceth.by/NDfiles/pdfeaec/000554/OHLP.pdf",
    }
    assert set(entries[1].documents) == {"leaflet"}  # only the patient leaflet is published


def test_by_list_entries_searches_once_then_pages_with_the_query_token() -> None:
    http = FakeHttp(
        gets={BY_FORM_URL: ok(BY_FORM_URL, fixture("by_form.html").encode(), "text/html")},
        posts=[
            ok(BY_RESULTS_URL, fixture("by_results_1.html").encode(), "text/html"),
            ok(BY_RESULTS_URL, fixture("by_results_2.html").encode(), "text/html"),
        ],
    )
    entries = by_list_entries(http)
    assert [e.dossier for e in entries] == ["000554", "000022", "006489"]
    first, second = http.post_log
    assert first[1]["FProps[6].CritElems[0].Val"] == ["-BY"]
    assert first[1]["FOpt.VFiles"] == [
        "true",
        "false",
    ]  # checkbox defaults kept as a browser posts them
    assert second[1]["PropSubmit"] == ["FOpt_PageN"] and second[1]["ValueSubmit"] == ["2"]
    assert second[1]["IsPostBack"] == ["true"]
    assert second[1]["QueryStringFind"] == ["Rk9wdC5W&x"]  # unescaped from the first page


def test_parse_kz_list_takes_eaeu_rows_and_builds_file_urls() -> None:
    entries = parse_kz_list(json.loads(fixture("kz_list_1.json")))
    assert [e.certificate for e in entries] == ["ЛП-№000022-РГ-KZ", "ЛП-№006489-ГП-KZ"]
    assert entries[0].documents["leaflet"] == (
        "https://register.ndda.kz/register/api/v1/PharmaRegister/"
        "getRegisterInstructionFile?registerId=99000803&lang=ru"
    )
    assert kz_file_url(99000803, "ohlp").endswith("GetRegisterOhlpFile?registerId=99000803&lang=ru")


def test_kz_list_entries_walks_to_the_last_page() -> None:
    http = FakeHttp(
        posts=[
            ok(KZ_LIST_URL, fixture("kz_list_1.json").encode(), "application/json"),
            ok(KZ_LIST_URL, fixture("kz_list_2.json").encode(), "application/json"),
        ]
    )
    entries = kz_list_entries(http, per_page=2)
    assert [e.dossier for e in entries] == ["000022", "006489", "000554"]
    bodies = [json.loads(call[1]["json"][0]) for call in http.post_log]
    assert [b["currentPage"] for b in bodies] == [1, 2]
    assert all(b["registrationCertificateNumber"] == "-KZ" and b["perPage"] == 2 for b in bodies)


def entry(
    country: str, dossier: str, kinds: tuple[DocKind, ...] = ("leaflet", "ohlp")
) -> SisterEntry:
    documents: dict[DocKind, str] = {
        kind: f"https://sister.example/{country}/{dossier}/{kind}" for kind in kinds
    }
    return SisterEntry(
        country, dossier, f"ЛП-№{dossier}-РГ-{country}", "Кордарон®", "амиодарон", documents
    )


def test_candidates_cover_only_missing_eaeu_registrations_essential_first() -> None:
    targets = [
        target("ЛП-№(000554)-(РГ-RU)", "Кордарон", "амиодарон"),
        target("ЛП-№(000022)-(РГ-RU)", "Ликсиана", "эдоксабан", essential=True),
        target("ЛП-006417", "Старый номер"),  # national number: never matched by a dossier
        target("ЛП-№(009999)-(РГ-RU)", "Без сестры"),
    ]
    entries = [entry("BY", "000554"), entry("KZ", "000554"), entry("KZ", "000022")]
    found = candidates_for(targets, entries)
    assert [(c.target.trade_name, c.entry.country) for c in found] == [
        ("Ликсиана", "KZ"),
        ("Кордарон", "BY"),
        ("Кордарон", "KZ"),
    ]
    summary = coverage_summary(targets, entries)
    assert summary["missingEaeu"] == 3 and summary["coveredRegistrations"] == 2
    assert summary["coveredEssentialRegistrations"] == 1 and summary["bothCountries"] == 1
    assert summary["byCountry"] == {"KZ": 2, "BY": 1}


def test_entries_snapshot_round_trips_with_checksum(tmp_path: Path) -> None:
    entries = [entry("KZ", "000022"), entry("KZ", "000554")]
    meta = write_entries(entries, tmp_path / "entries-KZ.jsonl", KZ_LIST_URL)
    assert meta["entries"] == 2 and meta["sourceClass"] == SOURCE_CLASS
    assert read_entries(tmp_path / "entries-KZ.jsonl") == entries


def test_collect_stores_pdfs_skips_html_error_pages_and_resumes(tmp_path: Path) -> None:
    options = CollectOptions(tmp_path)
    candidate = Candidate(target("ЛП-№(000554)-(РГ-RU)", "Кордарон"), entry("BY", "000554"))
    leaflet, ohlp = candidate.entry.documents["leaflet"], candidate.entry.documents["ohlp"]
    http = FakeHttp(
        gets={
            leaflet: ok(leaflet, PDF, "application/pdf", **{"last-modified": "Fri, 17 Apr 2026"}),
            # rceth.by answers a missing file with an HTML page and status 200
            ohlp: ok(ohlp, b"<html>error</html>", "text/html; charset=utf-8"),
        }
    )
    counters = collect([candidate], http, options)
    assert counters == {"stored": 1, "not-pdf": 1}
    ledger = read_jsonl(options.state_path)
    stored = next(r for r in ledger if r["outcome"] == "stored")
    assert stored["sourceClass"] == SOURCE_CLASS and stored["country"] == "BY"
    assert stored["url"] == leaflet and stored["httpLastModified"] == "Fri, 17 Apr 2026"
    assert str(stored["fetchedAt"]).endswith("Z") and len(str(stored["sha256"])) == 64
    assert (tmp_path / "files" / "BY" / f"{stored['sha256']}.pdf").read_bytes() == PDF
    # a second run asks for nothing: both URLs have an outcome
    again = FakeHttp()
    assert collect([candidate], again, options) == {}
    assert again.get_log == []


def test_collect_keeps_docx_responses_of_kazakhstan(tmp_path: Path) -> None:
    docx_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    candidate = Candidate(
        target("ЛП-№(000022)-(РГ-RU)", "Ликсиана"), entry("KZ", "000022", ("leaflet",))
    )
    url = candidate.entry.documents["leaflet"]
    docx = b"PK\x03\x04 fixture"
    options = CollectOptions(tmp_path)
    assert collect([candidate], FakeHttp(gets={url: ok(url, docx, docx_type)}), options) == {
        "stored": 1
    }
    stored = read_jsonl(options.state_path)[0]
    assert stored["suffix"] == ".docx"
    assert (tmp_path / "files" / "KZ" / f"{stored['sha256']}.docx").read_bytes() == docx
    # a zip that claims to be a PDF, or an HTML page, is not a document
    other = Candidate(candidate.target, entry("KZ", "000023", ("leaflet",)))
    bad = other.entry.documents["leaflet"]
    assert collect([other], FakeHttp(gets={bad: ok(bad, docx, "application/pdf")}), options) == {
        "not-pdf": 1
    }


def test_collect_stops_after_repeated_failures_and_on_a_blocked_host(tmp_path: Path) -> None:
    options = CollectOptions(tmp_path / "a")
    candidates = [
        Candidate(target(f"ЛП-№(00055{n})-(РГ-RU)", "X"), entry("BY", f"00055{n}"))
        for n in range(4)
    ]
    failing = FakeHttp(
        gets={
            url: Fetched(url, url, 503, {}, b"")
            for c in candidates
            for url in c.entry.documents.values()
        }
    )
    counters = collect(candidates, failing, options)
    assert counters["failed"] == 3 and counters["stopped-after-failures"] == 1

    # a record whose file endpoint answers 500 (seen at register.ndda.kz) does not stop the run
    broken = candidates[0].entry.documents
    mixed = FakeHttp(
        gets={
            url: (
                Fetched(url, url, 500, {}, b"")
                if url in broken.values()
                else ok(url, PDF + url.encode(), "application/pdf")
            )
            for c in candidates
            for url in c.entry.documents.values()
        }
    )
    counters = collect(candidates, mixed, CollectOptions(tmp_path / "c"))
    assert counters == {"failed": 2, "stored": 6}

    class Blocked(FakeHttp):
        def get(self, url: str) -> Fetched:
            raise HostBlocked("www.rceth.by")

    assert collect(candidates, Blocked(), CollectOptions(tmp_path / "b")) == {"host-blocked": 1}


def test_collect_respects_the_document_cap(tmp_path: Path) -> None:
    candidates = [
        Candidate(target(f"ЛП-№(00055{n})-(РГ-RU)", "X"), entry("KZ", f"00055{n}", ("leaflet",)))
        for n in range(3)
    ]
    http = FakeHttp(
        gets={
            url: ok(url, PDF + str(url).encode(), "application/pdf")
            for c in candidates
            for url in c.entry.documents.values()
        }
    )
    counters = collect(candidates, http, CollectOptions(tmp_path, max_documents=2))
    assert counters == {"stored": 2}


def test_check_text_guards_against_a_wrong_file() -> None:
    body = "Инструкция по медицинскому применению препарата. " * 12
    name = target("ЛП-№(000554)-(РГ-RU)", "Кордарон®", "амиодарон")
    assert check_text("Кордарон® таблетки. " + body, name) == "trade-name"
    assert check_text("Амиодарон 200 мг. " + body, name) == "inn"
    assert check_text(body + " совсем другой препарат", name) == "mismatch"
    assert check_text("скан", name) == "no-text-layer"
    # a combination written with "+" does not match a single-ingredient name
    combo = target("ЛП-№(000555)-(РГ-RU)", "Кордарон", "амиодарон")
    assert check_text("Кордарон + Плавикс. " + body, combo) == "mismatch"


def test_build_manifest_records_provenance_and_rejects_mismatches(tmp_path: Path) -> None:
    options = CollectOptions(tmp_path)
    right = Candidate(
        target("ЛП-№(000554)-(РГ-RU)", "Кордарон", "амиодарон"), entry("BY", "000554", ("leaflet",))
    )
    wrong = Candidate(
        target("ЛП-№(000022)-(РГ-RU)", "Ликсиана", "эдоксабан"), entry("KZ", "000022", ("leaflet",))
    )
    http = FakeHttp(
        gets={
            right.entry.documents["leaflet"]: ok(
                right.entry.documents["leaflet"], PDF, "application/pdf"
            ),
            wrong.entry.documents["leaflet"]: ok(
                wrong.entry.documents["leaflet"], PDF + b"other", "application/pdf"
            ),
        }
    )
    collect([right, wrong], http, options)

    def extract(path: Path) -> str:
        text = "Кордарон. " if path.read_bytes() == PDF else "Совсем иной препарат. "
        return text * 40

    summary = build_manifest([right, wrong], options, extract)
    assert summary == {"accepted": 1, "rejected-mismatch": 1, "rows": 2, "registrations": 1}
    rows = {str(r["registrationNumber"]): r for r in read_jsonl(options.manifest_path)}
    good = rows["ЛП-№(000554)-(РГ-RU)"]
    assert good["accepted"] is True and good["textCheck"] == "trade-name"
    assert good["matchMethod"] == "shared-dossier-number" and good["country"] == "BY"
    assert good["sourceClass"] == SOURCE_CLASS and good["documentKind"] == "leaflet"
    assert str(good["url"]).startswith("https://sister.example/BY/000554/")
    assert len(str(good["sha256"])) == 64 and str(good["fetchedAt"]).endswith("Z")
    assert rows["ЛП-№(000022)-(РГ-RU)"]["accepted"] is False


def test_collect_only_failed_retries_each_failed_url_once(tmp_path: Path) -> None:
    candidates = [
        Candidate(target(f"ЛП-№(00055{n})-(РГ-RU)", "X"), entry("KZ", f"00055{n}", ("leaflet",)))
        for n in range(3)
    ]
    urls = [c.entry.documents["leaflet"] for c in candidates]
    first = FakeHttp(
        gets={
            urls[0]: ok(urls[0], PDF, "application/pdf"),
            urls[1]: Fetched(urls[1], urls[1], 500, {}, b""),
        }
    )
    options = CollectOptions(tmp_path, max_documents=1)
    assert collect(candidates, first, options) == {"stored": 1}
    first.gets[urls[1]] = Fetched(urls[1], urls[1], 500, {}, b"")
    assert collect(candidates[1:2], first, options) == {"failed": 1}
    # the retry asks only for the failed URL (not the never-tried third one), once
    retry = FakeHttp(gets={urls[1]: ok(urls[1], PDF + b"1", "application/pdf")})
    retry_options = CollectOptions(tmp_path, only_failed=True, max_record_failures=100)
    assert collect(candidates, retry, retry_options) == {"stored": 1}
    assert retry.get_log == [urls[1]]
