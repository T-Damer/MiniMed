from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from .legal_catalog import collect_legal_catalog
from .medication_catalog import (
    build_medication_coverage_ledger,
    write_medication_coverage_ledger,
)

app = typer.Typer(
    no_args_is_help=True,
    help="Build medication and regulatory coverage ledgers for loadable MiniMed modules.",
)


@app.command("medications")
def medications_command(
    source: Annotated[Path, typer.Option("--source", exists=True, dir_okay=False)],
    taxonomy: Annotated[Path, typer.Option("--taxonomy", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    overrides: Annotated[
        Path | None, typer.Option("--overrides", exists=True, dir_okay=False)
    ] = None,
    generated_at: Annotated[str | None, typer.Option("--generated-at")] = None,
    fail_on_warning: Annotated[bool, typer.Option("--fail-on-warning")] = False,
) -> None:
    """Normalize a declared medication export and create ATC module plans."""
    ledger = build_medication_coverage_ledger(
        source,
        taxonomy,
        overrides_path=overrides,
        generated_at=generated_at,
    )
    write_medication_coverage_ledger(ledger, output)
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


@app.command("laws")
def laws_command(
    config: Annotated[Path, typer.Option("--config", exists=True, dir_okay=False)],
    taxonomy: Annotated[Path, typer.Option("--taxonomy", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    raw_output: Annotated[Path | None, typer.Option("--raw-output")] = None,
    include_details: Annotated[bool, typer.Option("--include-details/--list-only")] = True,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 60.0,
    generated_at: Annotated[str | None, typer.Option("--generated-at")] = None,
) -> None:
    """Collect health-related acts from the official read-only publication API."""
    ledger = collect_legal_catalog(
        config,
        taxonomy,
        output,
        raw_output=raw_output,
        include_details=include_details,
        timeout_seconds=timeout_seconds,
        generated_at=generated_at,
    )
    typer.echo(
        json.dumps(
            {
                "output": str(output),
                "records": ledger.summary.total_records,
                "coverage": ledger.summary.coverage_counts,
                "modules": ledger.summary.module_counts,
                "queries": ledger.summary.query_counts,
                "warnings": ledger.warnings,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
