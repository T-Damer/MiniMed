from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from .clinical_aliases import enrich_clinical_aliases
from .clinical_medication_relations import (
    write_clinical_medication_relation_batch,
    write_clinical_medication_relation_candidates,
)
from .esklp_catalog import build_esklp_coverage_ledger, write_esklp_coverage_ledger
from .esklp_release import prepare_esklp_release
from .grls_products import build_grls_product_workspace
from .legal_catalog import collect_legal_catalog
from .medication_catalog import (
    build_medication_coverage_ledger,
    write_medication_coverage_ledger,
)
from .official_grls_registry import (
    build_grls_instruction_plan,
    build_grls_instruction_source_registry,
    collect_official_grls_registry,
    run_grls_instruction_batch,
    sync_selected_grls_instructions,
)

app = typer.Typer(
    no_args_is_help=True,
    help="Build medication and regulatory coverage ledgers for loadable MiniMed modules.",
)


@app.command("clinical-medication-relations")
def clinical_medication_relations_command(
    clinical_database: Annotated[Path, typer.Option("--clinical-db", exists=True, dir_okay=False)],
    medication_index: Annotated[
        Path, typer.Option("--medication-index", exists=True, dir_okay=False)
    ],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Extract source-exact proposed MNN relations from one clinical module."""
    result = write_clinical_medication_relation_candidates(
        clinical_database,
        medication_index,
        output,
    )
    typer.echo(json.dumps(result.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("clinical-medication-relations-batch")
def clinical_medication_relations_batch_command(
    clinical_databases: Annotated[
        Path, typer.Option("--clinical-dir", exists=True, file_okay=False)
    ],
    medication_index: Annotated[
        Path, typer.Option("--medication-index", exists=True, dir_okay=False)
    ],
    output_directory: Annotated[Path, typer.Option("--output-dir")],
    workers: Annotated[int, typer.Option("--workers", min=1, max=8)] = 4,
    resume: Annotated[bool, typer.Option("--resume")] = False,
) -> None:
    """Extract independent clinical relation candidates concurrently."""
    result = write_clinical_medication_relation_batch(
        clinical_databases,
        medication_index,
        output_directory,
        workers=workers,
        resume=resume,
    )
    typer.echo(json.dumps(result.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("clinical-aliases")
def clinical_aliases_command(
    ledger: Annotated[Path, typer.Option("--ledger", exists=True, dir_okay=False)],
    databases: Annotated[Path, typer.Option("--databases", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    report: Annotated[Path, typer.Option("--report")],
    medication_relations: Annotated[
        Path | None,
        typer.Option("--medication-relations", exists=True, file_okay=False),
    ] = None,
) -> None:
    """Enrich a copied clinical ledger with traceable aliases and exact module ids."""
    result = enrich_clinical_aliases(
        ledger,
        databases,
        output,
        report,
        medication_relations,
    )
    typer.echo(
        json.dumps(
            {
                "output": str(output),
                "report": str(report),
                "records": result.summary.records_total,
                "recordsWithAliases": result.summary.records_with_aliases,
                "aliases": result.summary.aliases_total,
                "recordsWithKeywords": result.summary.records_with_keywords,
                "keywords": result.summary.keywords_total,
                "recordsWithDefinitions": result.summary.records_with_definitions,
                "recordsWithMedicationLinks": result.summary.records_with_medication_links,
                "medicationLinks": result.summary.medication_links_total,
                "matchedDatabases": result.summary.matched_databases,
                "unmatchedRecords": result.summary.unmatched_records,
                "unmatchedDatabases": result.summary.unmatched_databases,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


@app.command("esklp")
def esklp_command(
    archive: Annotated[Path, typer.Option("--archive", exists=True, dir_okay=False)],
    taxonomy: Annotated[Path, typer.Option("--taxonomy", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    generated_at: Annotated[str | None, typer.Option("--generated-at")] = None,
) -> None:
    """Normalize an official ESKLP archive into an MNN-centric coverage ledger."""
    ledger = build_esklp_coverage_ledger(
        archive,
        taxonomy,
        generated_at=generated_at,
    )
    write_esklp_coverage_ledger(ledger, output)
    typer.echo(
        json.dumps(
            {
                "output": str(output),
                "records": ledger.summary.total_records,
                "sourceEdition": ledger.source_edition,
                "warnings": ledger.warnings,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


@app.command("esklp-release")
def esklp_release_command(
    db_dir: Annotated[Path, typer.Option("--db-dir", exists=True, file_okay=False)],
    manifests_dir: Annotated[Path, typer.Option("--manifests-dir", exists=True, file_okay=False)],
    reports_dir: Annotated[Path, typer.Option("--reports-dir", exists=True, file_okay=False)],
    release_tag: Annotated[str, typer.Option("--release-tag")],
    release_base_url: Annotated[str, typer.Option("--release-base-url")],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Validate 15 built ESKLP modules and write downloadable catalog updates."""
    result = prepare_esklp_release(
        db_dir=db_dir,
        manifests_dir=manifests_dir,
        reports_dir=reports_dir,
        release_tag=release_tag,
        release_base_url=release_base_url,
        output=output,
    )
    typer.echo(
        json.dumps(
            {
                "output": str(result.output),
                "sizeBytes": result.size_bytes,
                "moduleCount": len(result.module_ids),
                "moduleIds": result.module_ids,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


@app.command("grls-sync")
def grls_sync_command(
    output: Annotated[Path, typer.Option("--output")],
    archive_output: Annotated[Path | None, typer.Option("--archive-output")] = None,
    report: Annotated[Path | None, typer.Option("--report")] = None,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 180.0,
    generated_at: Annotated[str | None, typer.Option("--generated-at")] = None,
) -> None:
    """Download and normalize the complete official GRLS export."""
    summary = collect_official_grls_registry(
        output,
        archive_output=archive_output,
        report_output=report,
        timeout_seconds=timeout_seconds,
        generated_at=generated_at,
    )
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


@app.command("grls-instructions")
def grls_instructions_command(
    registry: Annotated[Path, typer.Option("--registry", exists=True, dir_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    report: Annotated[Path, typer.Option("--report")],
    resolved_registry: Annotated[Path | None, typer.Option("--resolved-registry")] = None,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 180.0,
) -> None:
    """Refresh selected official instruction PDFs from GRLS."""
    summary = sync_selected_grls_instructions(
        registry,
        output_root,
        report,
        resolved_registry_output=resolved_registry,
        timeout_seconds=timeout_seconds,
    )
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


@app.command("grls-instruction-plan")
def grls_instruction_plan_command(
    catalog: Annotated[Path, typer.Option("--catalog", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Plan active GRLS instruction downloads from a local catalog snapshot."""
    summary = build_grls_instruction_plan(catalog, output)
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


@app.command("grls-instruction-batch")
def grls_instruction_batch_command(
    plan: Annotated[Path, typer.Option("--plan", exists=True, dir_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    state: Annotated[Path, typer.Option("--state")],
    limit: Annotated[int, typer.Option("--limit", min=1)] = 100,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 30.0,
    workers: Annotated[int, typer.Option("--workers", min=1, max=8)] = 4,
    max_attempts: Annotated[int, typer.Option("--max-attempts", min=1)] = 3,
    registration: Annotated[
        list[str] | None,
        typer.Option("--registration", help="Exact active registration number; repeatable."),
    ] = None,
) -> None:
    """Fetch one resumable GRLS instruction batch; failures remain in state."""
    summary = run_grls_instruction_batch(
        plan,
        output_root,
        state,
        limit=limit,
        timeout_seconds=timeout_seconds,
        workers=workers,
        max_attempts=max_attempts,
        registrations=registration,
    )
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


@app.command("grls-instruction-registry")
def grls_instruction_registry_command(
    plan: Annotated[Path, typer.Option("--plan", exists=True, dir_okay=False)],
    state: Annotated[Path, typer.Option("--state", exists=True, dir_okay=False)],
    catalog: Annotated[Path, typer.Option("--catalog", exists=True, dir_okay=False)],
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    report: Annotated[Path | None, typer.Option("--report")] = None,
) -> None:
    """Create a prepared-source registry from checksum-validated current PDFs."""
    summary = build_grls_instruction_source_registry(
        plan, state, catalog, raw_root, output, report_output=report
    )
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


@app.command("grls-products")
def grls_products_command(
    catalog: Annotated[Path, typer.Option("--catalog", exists=True, dir_okay=False)],
    registry: Annotated[Path, typer.Option("--registry", exists=True, dir_okay=False)],
    workspace: Annotated[Path, typer.Option("--workspace", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    report: Annotated[Path | None, typer.Option("--report")] = None,
    esklp_pack: Annotated[
        list[Path] | None,
        typer.Option(
            "--esklp-pack",
            exists=True,
            help="Read-only ESKLP SQLite pack, pack directory, or JSON catalog; repeatable.",
        ),
    ] = None,
) -> None:
    """Build normalized drug entities and official registry cards for selected instructions."""
    summary = build_grls_product_workspace(
        catalog,
        registry,
        workspace,
        output,
        report_output=report,
        esklp_packs=esklp_pack,
    )
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


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
