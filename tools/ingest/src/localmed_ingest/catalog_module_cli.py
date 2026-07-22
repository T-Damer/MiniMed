from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from .catalog_module_builder import CatalogFamily, build_catalog_metadata_modules

app = typer.Typer(
    no_args_is_help=True,
    help="Generate build-ready loadable metadata modules from a MiniMed coverage ledger.",
)


@app.command("build")
def build_command(
    ledger: Annotated[Path, typer.Option("--ledger", exists=True, dir_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    family: Annotated[CatalogFamily, typer.Option("--family")],
    version: Annotated[str, typer.Option("--version")],
    built_at: Annotated[str | None, typer.Option("--built-at")] = None,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Generate one metadata workspace for every module in the coverage ledger."""
    report = build_catalog_metadata_modules(
        ledger,
        output_root,
        family=family,
        version=version,
        built_at=built_at,
        force=force,
    )
    typer.echo(
        json.dumps(
            {
                "outputRoot": str(output_root),
                "family": report.family,
                "version": report.version,
                "modules": len(report.modules),
                "documents": report.total_documents,
                "warnings": report.warnings,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
