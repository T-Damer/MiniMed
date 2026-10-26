from __future__ import annotations

import json
import urllib.request
from pathlib import Path
from typing import Annotated, cast

import typer

from .eaeu_sister_registers import (
    BY_FORM_URL,
    KZ_LIST_URL,
    USER_AGENT,
    CollectOptions,
    SisterHttp,
    build_manifest,
    by_list_entries,
    candidates_for,
    collect,
    coverage_summary,
    fetch_odata_index,
    kz_list_entries,
    read_entries,
    write_entries,
)
from .manufacturer_instructions import extract_document_text, load_targets
from .models import ExtractionOptions
from .pdf_import import extract_pdf

app = typer.Typer(
    no_args_is_help=True,
    help="Official dossier texts from the Belarus and Kazakhstan registers for EAEU registrations.",
)

_PLAN = Annotated[Path, typer.Option("--plan", exists=True, dir_okay=False)]
_STATE = Annotated[Path, typer.Option("--grls-state", exists=True, dir_okay=False)]
_CATALOG = Annotated[Path, typer.Option("--catalog", exists=True, dir_okay=False)]
_GRLS_RAW = Annotated[Path, typer.Option("--grls-raw-root", exists=True, file_okay=False)]
_ROOT = Annotated[Path, typer.Option("--raw-root")]
_DEFAULT_ROOT = Path("data/raw/eaeu-sister-registers")


def _http(delay: float) -> SisterHttp:
    return SisterHttp(min_delay=delay)


@app.command("index")
def index_command(
    raw_root: _ROOT = _DEFAULT_ROOT,
    pause: Annotated[float, typer.Option("--pause", min=2.0)] = 3.0,
) -> None:
    """Dump the Union register (dossier → countries); ~56 requests of 1000 records."""

    def get_json(url: str) -> dict[str, object]:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=170) as response:
            return cast(dict[str, object], json.loads(response.read()))

    meta = fetch_odata_index(get_json, raw_root / "union-index.jsonl", pause=pause)
    typer.echo(json.dumps(meta, ensure_ascii=False))


@app.command("lists")
def lists_command(
    country: Annotated[list[str], typer.Option("--country", help="BY or KZ; repeatable.")],
    raw_root: _ROOT = _DEFAULT_ROOT,
    delay: Annotated[float, typer.Option("--delay", min=2.0)] = 4.0,
) -> None:
    """Snapshot of the EAEU registrations listed by rceth.by and register.ndda.kz."""
    http = _http(delay)
    for code in country:
        if code == "BY":
            entries = by_list_entries(http)
            meta = write_entries(entries, raw_root / "entries-BY.jsonl", BY_FORM_URL)
        elif code == "KZ":
            entries = kz_list_entries(http)
            meta = write_entries(entries, raw_root / "entries-KZ.jsonl", KZ_LIST_URL)
        else:
            raise typer.BadParameter("country must be BY or KZ")
        typer.echo(f"{code}: {json.dumps(meta, ensure_ascii=False)}")


@app.command("report")
def report_command(
    plan: _PLAN,
    grls_state: _STATE,
    catalog: _CATALOG,
    grls_raw_root: _GRLS_RAW,
    output: Annotated[Path, typer.Option("--output")],
    raw_root: _ROOT = _DEFAULT_ROOT,
) -> None:
    """Coverage of the missing registrations by the listed sister entries."""
    targets = load_targets(plan, grls_state, grls_raw_root, catalog)
    entries = [
        entry for path in sorted(raw_root.glob("entries-*.jsonl")) for entry in read_entries(path)
    ]
    summary = coverage_summary(targets, entries)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    typer.echo(json.dumps(summary, ensure_ascii=False))


@app.command("collect")
def collect_command(
    plan: _PLAN,
    grls_state: _STATE,
    catalog: _CATALOG,
    grls_raw_root: _GRLS_RAW,
    country: Annotated[list[str], typer.Option("--country", help="BY or KZ; repeatable.")],
    raw_root: _ROOT = _DEFAULT_ROOT,
    max_documents: Annotated[int, typer.Option("--max-documents", min=1)] = 50,
    delay: Annotated[float, typer.Option("--delay", min=2.0)] = 4.0,
    only_failed: Annotated[
        bool, typer.Option("--only-failed", help="Retry each previously failed URL once.")
    ] = False,
    max_record_failures: Annotated[int, typer.Option("--max-record-failures", min=1)] = 12,
) -> None:
    """Resumable download of the dossier PDFs (one request at a time per host)."""
    targets = load_targets(plan, grls_state, grls_raw_root, catalog)
    entries = [
        entry for code in country for entry in read_entries(raw_root / f"entries-{code}.jsonl")
    ]
    candidates = candidates_for(targets, entries)
    options = CollectOptions(raw_root, max_documents, only_failed, max_record_failures)
    summary = collect(candidates, _http(delay), options)
    typer.echo(json.dumps({"candidates": len(candidates), **summary}, ensure_ascii=False))


@app.command("manifest")
def manifest_command(
    plan: _PLAN,
    grls_state: _STATE,
    catalog: _CATALOG,
    grls_raw_root: _GRLS_RAW,
    raw_root: _ROOT = _DEFAULT_ROOT,
    text_layer_only: Annotated[
        bool,
        typer.Option(
            "--text-layer-only",
            help="No OCR: a scan is recorded as no-text-layer and re-checked by the module "
            "builder on the preparer's OCR text (scans are OCRed once, not twice).",
        ),
    ] = False,
) -> None:
    """Offline: extract text, check it against the target and write manifest.jsonl."""
    targets = load_targets(plan, grls_state, grls_raw_root, catalog)
    entries = [
        entry for path in sorted(raw_root.glob("entries-*.jsonl")) for entry in read_entries(path)
    ]
    candidates = candidates_for(targets, entries)

    def extract(path: Path) -> str:
        if text_layer_only and path.suffix.casefold() == ".pdf":
            extracted = extract_pdf(path, ExtractionOptions(ocr_fallback=False))
            return "\n".join(
                block.text for page in extracted.pages for block in page.blocks if not block.removed
            )
        return extract_document_text(path).text

    summary = build_manifest(candidates, CollectOptions(raw_root), extract)
    typer.echo(json.dumps(summary, ensure_ascii=False))
