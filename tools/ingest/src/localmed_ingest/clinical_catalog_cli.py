from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from .clinical_catalog import build_clinical_coverage_ledger, write_clinical_coverage_ledger

app = typer.Typer(
    no_args_is_help=True,
    help="Inventory and categorize a Russian clinical-recommendation catalog export.",
)


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
