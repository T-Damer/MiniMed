"""Local update check of the official orders the form schemas are built from (docs/FORMS_PLAN.md).

`bun run forms:check-updates` reads the committed registry of source orders
(`tools/ingest/medical-form-sources.json`: eoNumber, title, SHA-256 of the PDF, the forms built
from it) and asks the official portal (publication.pravo.gov.ru) for

* the current record and file of each order — a different SHA-256, size or page count means the
  published file changed (`changed`);
* amending or replacing orders («О внесении изменений в приказ … № 274н», «О признании
  утратившим силу …») published after it that nobody has acknowledged in the registry (`new`);
* other new Минздрав orders whose title matches the registry's `watchTerms` and `watchRequire`
  phrases (a possible replacement set of forms; listed for a human, never acted on).

With `--rebuild` a `changed` source is fetched again, recognised again (macOS Vision) and run
through every form blueprint built from it. The reviewed blueprints fail the build when a printed
caption, a cited paragraph or a reviewed OCR correction no longer matches: that outcome is printed
as «HUMAN REVIEW REQUIRED» and nothing in the repository is overwritten. Only a rebuild that
matched everything and changed no cited paragraph updates the schemas and the registry; a rebuild
that matched but changed paragraph texts is staged in `data/build/forms-updates/` for review.

Network failures are reported per order (`status: error`) and make the exit code non-zero; they
are never swallowed. The report is written to `data/build/forms-update-check.json`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from localmed_ingest.medical_forms import (
    FORM_BLUEPRINT_MODULES,
    PRAVO_API,
    PRAVO_PAGE,
    PRAVO_PDF,
    FormSourceError,
    load_blueprint,
    prepare_form,
    run_ocr,
    sha256_file,
    write_schema,
)

REPO: Final = Path(__file__).resolve().parents[4]
DEFAULT_REGISTRY: Final = REPO / "tools/ingest/medical-form-sources.json"
DEFAULT_REPORT: Final = REPO / "data/build/forms-update-check.json"
DEFAULT_RAW: Final = REPO / "data/raw/medical-forms"
DEFAULT_STAGING: Final = REPO / "data/build/forms-updates"
DEFAULT_SCHEMAS: Final = REPO / "apps/app/src/features/forms/schemas"
OCR_SWIFT: Final = REPO / "tools/ingest/macos_vision_ocr.swift"
PAGE_SIZE: Final = 200
MAX_PAGES: Final = 20

MONTHS_GENITIVE: Final = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)


class PortalError(RuntimeError):
    """The official portal could not be reached or answered something unusable."""


# ------------------------------------------------------------------------------ portal client


@dataclass
class PortalClient:
    """Thin client of publication.pravo.gov.ru; the transports are injectable for tests."""

    get_json: Callable[[str], Any] = field(default=lambda url: _http_json(url))
    get_bytes: Callable[[str], bytes] = field(default=lambda url: _http_bytes(url))

    def documents(self, **params: str) -> list[dict[str, Any]]:
        """Every page of `/api/Documents` for the given filters."""
        items: list[dict[str, Any]] = []
        for index in range(1, MAX_PAGES + 1):
            query = urllib.parse.urlencode({**params, "PageSize": PAGE_SIZE, "index": index})
            payload = self.get_json(f"{PRAVO_API}/Documents?{query}")
            if not isinstance(payload, dict) or "items" not in payload:
                raise PortalError(f"unexpected answer of the documents API: {str(payload)[:120]}")
            page_items = payload["items"]
            items.extend(page_items)
            if index >= int(payload.get("pagesTotalCount", 1)) or not page_items:
                return items
        raise PortalError(f"more than {MAX_PAGES} result pages for {params}")

    def document(self, eo_number: str) -> dict[str, Any]:
        items = self.documents(eoNumber=eo_number)
        if len(items) != 1:
            raise PortalError(f"the portal returned {len(items)} records for {eo_number}")
        return items[0]

    def pdf(self, eo_number: str) -> bytes:
        payload = self.get_bytes(f"{PRAVO_PDF}{eo_number}")
        if not payload.startswith(b"%PDF"):
            raise PortalError(f"the portal download of {eo_number} is not a PDF")
        return payload


def _http_bytes(url: str, attempts: int = 2) -> bytes:
    last: Exception | None = None
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=120) as response:
                data: bytes = response.read()
            return data
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = error
    raise PortalError(f"network failure for {url}: {last}") from last


def _http_json(url: str) -> Any:
    try:
        return json.loads(_http_bytes(url))
    except json.JSONDecodeError as error:
        raise PortalError(f"the portal answered non-JSON for {url}: {error}") from error


# ------------------------------------------------------------------------------ related orders


def russian_date(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day} {MONTHS_GENITIVE[month - 1]} {year}"


_AMENDING: Final = re.compile(
    r"внесени[ие]\s+изменени|признани[ие]\s+утратив|утратившим[иь]?\s+силу|об\s+отмене",
    re.IGNORECASE,
)


def references_order(name: str, number: str, iso_date: str) -> bool:
    """Whether an order title names the base order by number and date, in words or digits."""
    flat = re.sub(r"\s+", " ", name.replace("\xa0", " "))
    year, month, day = iso_date.split("-")
    spoken = f"{int(day)} {MONTHS_GENITIVE[int(month) - 1]} {year}"
    dotted = f"{day}.{month}.{year}"
    number_pattern = re.escape(number)
    for date in (spoken, dotted):
        pattern = rf"{re.escape(date)}(?:\s*г\.?)?\s*(?:№|N)\s*{number_pattern}(?![0-9а-яa-z])"
        if re.search(pattern, flat, re.IGNORECASE):
            return True
    return False


def find_related_orders(
    client: PortalClient, source: dict[str, Any]
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Amending/repealing orders of the source and other new orders that look like a replacement."""
    published = str(source.get("publishedAt", "0000-00-00"))
    acknowledged = {str(item) for item in source.get("acknowledgedOrders", [])}
    amending: list[dict[str, str]] = []
    for item in client.documents(Name=str(source["orderNumber"])):
        name = str(item.get("name") or item.get("complexName") or "")
        complex_name = str(item.get("complexName") or name)
        if item.get("eoNumber") == source["eoNumber"] or item["eoNumber"] in acknowledged:
            continue
        if not _AMENDING.search(name):
            continue
        if not references_order(complex_name, str(source["orderNumber"]), str(source["orderDate"])):
            continue
        amending.append(_brief(item))
    similar: list[dict[str, str]] = []
    for term in source.get("watchTerms", []):
        for item in client.documents(Name=str(term)):
            complex_name = str(item.get("complexName") or "")
            if (
                item["eoNumber"] == source["eoNumber"]
                or item["eoNumber"] in acknowledged
                or "Министерства здравоохранения Российской Федерации" not in complex_name
                or any(
                    phrase.lower() not in complex_name.lower()
                    for phrase in source.get("watchRequire", [])
                )
                or str(item.get("publishDateShort", ""))[:10] <= published
            ):
                continue
            brief = _brief(item)
            if brief not in similar and brief not in amending:
                similar.append(brief)
    return amending, similar


def _brief(item: dict[str, Any]) -> dict[str, str]:
    title = re.sub(r"\s+", " ", str(item.get("complexName") or item.get("name") or "")).strip()
    return {
        "eoNumber": str(item["eoNumber"]),
        "number": str(item.get("number", "")),
        "documentDate": str(item.get("documentDate", ""))[:10],
        "publishedAt": str(item.get("publishDateShort", ""))[:10],
        "title": title[:300],
        "url": f"{PRAVO_PAGE}{item['eoNumber']}",
    }


# ------------------------------------------------------------------------------------ the check


@dataclass
class SourceResult:
    eo_number: str
    title: str
    status: str = "unchanged"  # unchanged | changed | new | error
    file: dict[str, Any] = field(default_factory=dict)
    amending_orders: list[dict[str, str]] = field(default_factory=list)
    possible_replacements: list[dict[str, str]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    rebuild: dict[str, Any] | None = None

    def as_json(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "eoNumber": self.eo_number,
            "title": self.title,
            "status": self.status,
            "file": self.file,
            "amendingOrders": self.amending_orders,
            "possibleReplacements": self.possible_replacements,
            "errors": self.errors,
        }
        if self.rebuild is not None:
            result["rebuild"] = self.rebuild
        return result


def check_source(
    client: PortalClient,
    source: dict[str, Any],
    *,
    download: bool,
    pdf_out: dict[str, bytes] | None = None,
) -> SourceResult:
    result = SourceResult(str(source["eoNumber"]), str(source["title"]))
    try:
        record = client.document(str(source["eoNumber"]))
        observed: dict[str, Any] = {
            "pagesCount": record.get("pagesCount"),
            "pdfFileLength": record.get("pdfFileLength"),
            "number": record.get("number"),
            "documentDate": str(record.get("documentDate", ""))[:10],
        }
        differences: list[str] = []
        if observed["pagesCount"] != source.get("pagesCount"):
            differences.append(f"pages {source.get('pagesCount')} → {observed['pagesCount']}")
        if observed["pdfFileLength"] != source.get("bytes"):
            differences.append(f"bytes {source.get('bytes')} → {observed['pdfFileLength']}")
        if download:
            payload = client.pdf(str(source["eoNumber"]))
            observed["sha256"] = hashlib.sha256(payload).hexdigest()
            observed["bytes"] = len(payload)
            if observed["sha256"] != source["sha256"]:
                differences.append("sha256 differs")
            if pdf_out is not None:
                pdf_out[str(source["eoNumber"])] = payload
        observed["differences"] = differences
        result.file = observed
        if differences:
            result.status = "changed"
    except PortalError as error:
        result.errors.append(f"file check: {error}")
    try:
        result.amending_orders, result.possible_replacements = find_related_orders(client, source)
        if result.amending_orders and result.status == "unchanged":
            result.status = "new"
    except PortalError as error:
        result.errors.append(f"related orders: {error}")
    if result.errors:
        result.status = "error" if result.status == "unchanged" else result.status
    return result


# ---------------------------------------------------------------------------------- the rebuild


def _paragraph_hashes(schema: dict[str, Any]) -> dict[str, str]:
    return {rule["id"]: rule["textSha256"] for rule in schema["rules"]}


def rebuild_source(
    source: dict[str, Any],
    payload: bytes,
    *,
    raw_dir: Path = DEFAULT_RAW,
    schemas_dir: Path = DEFAULT_SCHEMAS,
    staging_dir: Path = DEFAULT_STAGING,
    registry_path: Path = DEFAULT_REGISTRY,
    ocr: Callable[[Path, Path], None] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Re-run OCR and the reviewed blueprints on a changed file; see the module docstring."""
    eo_number = str(source["eoNumber"])
    stage = staging_dir / eo_number
    stage.mkdir(parents=True, exist_ok=True)
    pdf_path = stage / f"{eo_number}.pdf"
    pdf_path.write_bytes(payload)
    ocr_path = stage / f"{eo_number}.ocr.json"
    recogniser = ocr or (lambda pdf, out: run_ocr(pdf, out, OCR_SWIFT))
    try:
        recogniser(pdf_path, ocr_path)
    except Exception as error:
        return {"outcome": "failed", "humanReviewRequired": False, "error": f"OCR: {error}"}
    retrieved = (now or datetime.now(UTC)).date().isoformat()
    sha = sha256_file(pdf_path)
    source_record = {
        "publicationUrl": f"{PRAVO_PAGE}{eo_number}",
        "pdfUrl": f"{PRAVO_PDF}{eo_number}",
        "retrievedAt": retrieved,
        "sha256": sha,
    }
    outcomes: list[dict[str, Any]] = []
    staged: dict[str, dict[str, Any]] = {}
    for form in source["forms"]:
        blueprint = load_blueprint(str(form["key"]))
        try:
            schema = prepare_form(blueprint, source_record, ocr_path)
        except FormSourceError as error:
            outcomes.append({"form": form["formNumber"], "matched": False, "error": str(error)})
            continue
        committed_path = schemas_dir / str(form["schemaFile"])
        committed = json.loads(committed_path.read_text(encoding="utf-8"))
        before, after = _paragraph_hashes(committed), _paragraph_hashes(schema)
        changed = sorted(
            number for number in set(before) | set(after) if before.get(number) != after.get(number)
        )
        outcomes.append({"form": form["formNumber"], "matched": True, "changedParagraphs": changed})
        staged[str(form["schemaFile"])] = schema
    failed = [outcome for outcome in outcomes if not outcome["matched"]]
    changed_any = [outcome for outcome in outcomes if outcome.get("changedParagraphs")]
    report: dict[str, Any] = {"forms": outcomes, "stagedIn": str(stage)}
    if failed:
        report.update(
            outcome="failed",
            humanReviewRequired=True,
            message=(
                "HUMAN REVIEW REQUIRED: a reviewed caption, cited paragraph or OCR correction no "
                "longer matches the new official file. Nothing in the repository was changed; "
                "compare the new scan with the blueprints (tools/ingest/src/localmed_ingest/"
                "medical_form_*.py) and update them by hand."
            ),
        )
        return report
    for name, schema in staged.items():
        write_schema(schema, stage / name)
    if changed_any:
        report.update(
            outcome="staged",
            humanReviewRequired=True,
            message=(
                "HUMAN REVIEW REQUIRED: the blueprints matched, but the text of cited paragraphs "
                "changed. The rebuilt schemas are staged, the repository is untouched; review the "
                "changed paragraphs against the new scan, then copy the schemas and update the "
                "registry."
            ),
        )
        return report
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / f"{eo_number}.pdf").write_bytes(payload)
    (raw_dir / f"{eo_number}.ocr.json").write_bytes(ocr_path.read_bytes())
    for name, schema in staged.items():
        write_schema(schema, schemas_dir / name)
    update_registry_entry(registry_path, eo_number, payload, retrieved)
    raw_source = raw_dir / f"{eo_number}.source.json"
    if raw_source.exists():
        record = json.loads(raw_source.read_text(encoding="utf-8"))
        record.update(sha256=sha, bytes=len(payload), retrievedAt=retrieved)
        raw_source.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", "utf-8")
    report.update(
        outcome="updated",
        humanReviewRequired=False,
        message="The schemas and the registry were updated; every caption and paragraph matched.",
    )
    return report


def update_registry_entry(
    registry_path: Path, eo_number: str, payload: bytes, retrieved: str
) -> None:
    """Rewrite only the three changed values so the committed file keeps its formatting."""
    text = registry_path.read_text(encoding="utf-8")
    registry = json.loads(text)
    entry = next(item for item in registry["sources"] if item["eoNumber"] == eo_number)
    for key, new in (
        ("sha256", hashlib.sha256(payload).hexdigest()),
        ("bytes", len(payload)),
        ("retrievedAt", retrieved),
    ):
        pattern = re.compile(rf'("{key}": )(?:"{re.escape(str(entry[key]))}"|{entry[key]})')
        replacement = f'"{new}"' if isinstance(new, str) else str(new)
        text, count = pattern.subn(rf"\g<1>{replacement}", text, count=1)
        if count != 1:
            raise FormSourceError(f"cannot update {key} of {eo_number} in {registry_path}")
    registry_path.write_text(text, encoding="utf-8")


# ------------------------------------------------------------------------------------- the CLI


def validate_registry(registry: dict[str, Any]) -> None:
    keys = [str(form["key"]) for source in registry["sources"] for form in source["forms"]]
    unknown = sorted(set(keys) - set(FORM_BLUEPRINT_MODULES))
    missing = sorted(set(FORM_BLUEPRINT_MODULES) - set(keys))
    if unknown or missing:
        raise FormSourceError(
            f"registry and blueprints disagree: unknown {unknown}, not registered {missing}"
        )


def run_check(
    registry_path: Path,
    report_path: Path,
    *,
    rebuild: bool,
    download: bool,
    client: PortalClient | None = None,
    now: datetime | None = None,
    rebuild_kwargs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    validate_registry(registry)
    portal = client or PortalClient()
    results: list[SourceResult] = []
    for source in registry["sources"]:
        pdfs: dict[str, bytes] = {}
        result = check_source(portal, source, download=download or rebuild, pdf_out=pdfs)
        if rebuild and result.status == "changed" and str(source["eoNumber"]) in pdfs:
            result.rebuild = rebuild_source(
                source,
                pdfs[str(source["eoNumber"])],
                registry_path=registry_path,
                **(rebuild_kwargs or {}),
            )
        results.append(result)
    counts = {
        status: sum(1 for result in results if result.status == status)
        for status in ("unchanged", "changed", "new", "error")
    }
    report: dict[str, Any] = {
        "checkedAt": (now or datetime.now(UTC)).isoformat(timespec="seconds"),
        "registry": str(registry_path.relative_to(REPO))
        if registry_path.is_relative_to(REPO)
        else str(registry_path),
        "mode": {"download": download or rebuild, "rebuild": rebuild},
        "summary": counts,
        "needsHumanReview": any(
            result.rebuild and result.rebuild.get("humanReviewRequired") for result in results
        )
        or counts["new"] > 0
        or counts["changed"] > 0,
        "sources": [result.as_json() for result in results],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return report


def format_report(report: dict[str, Any]) -> str:
    lines = [f"Official forms update check, {report['checkedAt']}"]
    for source in report["sources"]:
        lines.append(f"- {source['eoNumber']} {source['status'].upper()}: {source['title'][:90]}")
        for difference in source["file"].get("differences", []):
            lines.append(f"    file: {difference}")
        for order in source["amendingOrders"]:
            lines.append(
                f"    amending/repealing order {order['number']} of {order['documentDate']} "
                f"({order['eoNumber']}): {order['title'][:110]}"
            )
        for order in source["possibleReplacements"]:
            lines.append(
                f"    possibly a replacement set {order['number']} of {order['documentDate']} "
                f"({order['eoNumber']}): {order['title'][:110]}"
            )
        for error in source["errors"]:
            lines.append(f"    ERROR {error}")
        rebuild = source.get("rebuild")
        if rebuild:
            lines.append(f"    rebuild: {rebuild['outcome']}")
            if rebuild.get("message"):
                lines.append(f"    {rebuild['message']}")
            for form in rebuild.get("forms", []):
                detail = form.get("error") or f"changed paragraphs {form.get('changedParagraphs')}"
                lines.append(
                    f"      {form['form']}: {'ok' if form['matched'] else 'MISMATCH'} {detail}"
                )
            if rebuild.get("error"):
                lines.append(f"      {rebuild['error']}")
    summary = report["summary"]
    lines.append("summary: " + ", ".join(f"{name} {count}" for name, count in summary.items()))
    if report["needsHumanReview"]:
        lines.append(
            "A human review is needed: compare the new official text with the reviewed blueprints."
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="medical_form_updates", description=__doc__)
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="re-fetch, re-run OCR and the reviewed blueprints for changed sources",
    )
    parser.add_argument(
        "--metadata-only",
        action="store_true",
        help="do not download the PDFs; compare the portal record (pages, size) only",
    )
    args = parser.parse_args(argv)
    report = run_check(
        args.registry, args.report, rebuild=args.rebuild, download=not args.metadata_only
    )
    print(format_report(report))
    print(f"report: {args.report}")
    if report["summary"]["error"] > 0 or any(source["errors"] for source in report["sources"]):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
