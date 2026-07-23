from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from .clinical_catalog import build_clinical_coverage_ledger, write_clinical_coverage_ledger
from .official_clinical_registry import collect_official_clinical_registry

app = typer.Typer(
    no_args_is_help=True,
    help="Inventory and categorize the Russian clinical-recommendation catalog.",
)


@app.callback()
def main() -> None:
    """Collect, inventory and categorize clinical-recommendation catalog records."""


@app.command("official-sync")
def official_sync_command(
    output: Annotated[Path, typer.Option("--output")],
    raw_output: Annotated[Path | None, typer.Option("--raw-output")] = None,
    report: Annotated[Path | None, typer.Option("--report")] = None,
    page_size: Annotated[int, typer.Option("--page-size", min=1, max=1000)] = 200,
    max_pages: Annotated[int, typer.Option("--max-pages", min=1)] = 100,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 180.0,
    generated_at: Annotated[str | None, typer.Option("--generated-at")] = None,
) -> None:
    """Collect the complete official Minzdrav registry through its public API."""
    summary = collect_official_clinical_registry(
        output,
        raw_output=raw_output,
        report_output=report,
        page_size=page_size,
        max_pages=max_pages,
        timeout_seconds=timeout_seconds,
        generated_at=generated_at,
    )
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


@app.command("build")
def build_command(
    source: Annotated[Path, typer.Option("--source", exists=True, dir_okay=False)],
    taxonomy: Annotated[Path, typer.Option("--taxonomy", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    overrides: Annotated[
        Path | None, typer.Option("--overrides", exists=True, dir_okay=False)
    ] = None,
    generated_at: Annotated[str | None, typer.Option("--generated-at")] = None,
    fail_on_warning: Annotated[bool, typer.Option("--fail-on-warning")] = False,
) -> None:
    """Build a deterministic coverage ledger and specialty module plan."""
    ledger = build_clinical_coverage_ledger(
        source,
        taxonomy,
        overrides_path=overrides,
        generated_at=generated_at,
    )
    write_clinical_coverage_ledger(ledger, output)
    typer.echo(
        json.dumps(
            {
                "output": str(output),
                "records": ledger.summary.total_records,
                "coverage": ledger.summary.coverage_counts,
                "modules": ledger.summary.module_counts,
                "warnings": ledger.warnings,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if fail_on_warning and ledger.warnings:
        raise typer.Exit(code=1)
