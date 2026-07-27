from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from .clinical_catalog import build_clinical_coverage_ledger, write_clinical_coverage_ledger
from .clinical_source_plan import (
    build_clinical_source_plan,
    build_individual_clinical_documents,
    package_clinical_snapshot,
)
from .official_clinical_registry import (
    check_selected_clinical_sources,
    collect_official_clinical_registry,
    import_official_clinical_registry_pages,
)

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
    raw_input: Annotated[
        Path | None, typer.Option("--raw-input", exists=True, dir_okay=False)
    ] = None,
    raw_output: Annotated[Path | None, typer.Option("--raw-output")] = None,
    report: Annotated[Path | None, typer.Option("--report")] = None,
    page_size: Annotated[int, typer.Option("--page-size", min=1, max=1000)] = 200,
    max_pages: Annotated[int, typer.Option("--max-pages", min=1)] = 100,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 180.0,
    generated_at: Annotated[str | None, typer.Option("--generated-at")] = None,
) -> None:
    """Collect or import the complete official Minzdrav registry."""
    if raw_input is None:
        summary = collect_official_clinical_registry(
            output,
            raw_output=raw_output,
            report_output=report,
            page_size=page_size,
            max_pages=max_pages,
            timeout_seconds=timeout_seconds,
            generated_at=generated_at,
        )
    else:
        summary = import_official_clinical_registry_pages(
            raw_input,
            output,
            raw_output=raw_output,
            report_output=report,
            generated_at=generated_at,
        )
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


@app.command("check-selected")
def check_selected_command(
    catalog: Annotated[Path, typer.Option("--catalog", exists=True, dir_okay=False)],
    registry: Annotated[Path, typer.Option("--registry", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Fail when a selected recommendation is no longer in the active official catalog."""
    report = check_selected_clinical_sources(catalog, registry)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))
    if report["updates"]:
        raise typer.Exit(code=1)


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


@app.command("plan-sources")
def plan_sources_command(
    ledger: Annotated[Path, typer.Option("--ledger", exists=True, dir_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    version: Annotated[str, typer.Option("--version")],
    generated_at: Annotated[str | None, typer.Option("--generated-at")] = None,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Generate the complete official JSON mirror plan and one-document registries."""
    report = build_clinical_source_plan(
        ledger,
        output_root,
        version=version,
        generated_at=generated_at,
        force=force,
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("build-documents")
def build_documents_command(
    plan_root: Annotated[Path, typer.Option("--plan-root", exists=True, file_okay=False)],
    source_root: Annotated[Path, typer.Option("--source-root", exists=True, file_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    official_ids: Annotated[list[str] | None, typer.Option("--official-id")] = None,
    category_id: Annotated[str | None, typer.Option("--category-id")] = None,
    all_documents: Annotated[bool, typer.Option("--all")] = False,
    allow_partial: Annotated[bool, typer.Option("--allow-partial")] = False,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Build immutable one-recommendation SQLite modules."""
    report = build_individual_clinical_documents(
        plan_root,
        source_root,
        output_root,
        official_ids=official_ids,
        category_id=category_id,
        all_documents=all_documents,
        allow_partial=allow_partial,
        force=force,
    )
    typer.echo(
        json.dumps(
            {key: value for key, value in report.items() if key != "artifacts"},
            ensure_ascii=False,
            indent=2,
        )
    )


@app.command("package-snapshot")
def package_snapshot_command(
    plan_root: Annotated[Path, typer.Option("--plan-root", exists=True, file_okay=False)],
    build_root: Annotated[Path, typer.Option("--build-root", exists=True, file_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    snapshot_id: Annotated[str, typer.Option("--snapshot-id")],
    release_base_url: Annotated[str, typer.Option("--release-base-url")],
    allow_partial: Annotated[bool, typer.Option("--allow-partial")] = False,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Package immutable databases, source archives and the catalog fragment."""
    report = package_clinical_snapshot(
        plan_root,
        build_root,
        output_root,
        snapshot_id=snapshot_id,
        release_base_url=release_base_url,
        allow_partial=allow_partial,
        force=force,
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))
