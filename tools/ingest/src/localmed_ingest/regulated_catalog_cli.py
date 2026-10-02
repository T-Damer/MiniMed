from __future__ import annotations

import json
from datetime import datetime
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
from .grls_collect import MAX_WORKERS, CollectOptions, export_url_ledger, run_collection
from .grls_daily import DailyOptions, run_daily_loop
from .grls_products import build_grls_product_workspace
from .grls_text_manifest import build_additions_registry, build_text_manifest
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


@app.command("grls-collect")
def grls_collect_command(
    plan: Annotated[Path, typer.Option("--plan", exists=True, dir_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    state: Annotated[Path, typer.Option("--state")],
    log_dir: Annotated[Path, typer.Option("--log-dir")],
    limit: Annotated[int | None, typer.Option("--limit", min=1)] = None,
    workers: Annotated[int, typer.Option("--workers", min=1, max=MAX_WORKERS)] = 1,
    min_request_delay: Annotated[float, typer.Option("--min-request-delay", min=0.2)] = 0.8,
    max_request_delay: Annotated[float, typer.Option("--max-request-delay", min=0.2)] = 2.0,
    min_item_pause: Annotated[float, typer.Option("--min-item-pause", min=0.2)] = 1.5,
    max_item_pause: Annotated[float, typer.Option("--max-item-pause", min=0.2)] = 4.0,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 45.0,
    backoff_base_seconds: Annotated[float, typer.Option("--backoff-base-seconds", min=1)] = 60.0,
    max_run_seconds: Annotated[float | None, typer.Option("--max-run-seconds", min=1)] = None,
    max_attempts: Annotated[int, typer.Option("--max-attempts", min=1)] = 3,
    include_substances: Annotated[bool, typer.Option("--include-substances")] = False,
    include_exhausted: Annotated[bool, typer.Option("--include-exhausted")] = False,
    registration: Annotated[
        list[str] | None,
        typer.Option("--registration", help="Exact registration number; repeatable."),
    ] = None,
) -> None:
    """Polite resumable GRLS instruction collection (transient failures first, then new)."""
    options = CollectOptions(
        min_request_delay=min_request_delay,
        max_request_delay=max(max_request_delay, min_request_delay),
        min_item_pause=min_item_pause,
        max_item_pause=max(max_item_pause, min_item_pause),
        timeout_seconds=timeout_seconds,
        backoff_base_seconds=backoff_base_seconds,
        workers=workers,
        limit=limit,
        max_run_seconds=max_run_seconds,
        max_attempts=max_attempts,
        registrations=tuple(registration or ()),
        include_substances=include_substances,
        include_exhausted=include_exhausted,
    )
    summary = run_collection(plan, output_root, state, log_dir, options, log=typer.echo)
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


@app.command("grls-collect-daily")
def grls_collect_daily_command(
    plan: Annotated[Path, typer.Option("--plan", exists=True, dir_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    state: Annotated[Path, typer.Option("--state")],
    log_dir: Annotated[Path, typer.Option("--log-dir")],
    catalog: Annotated[
        Path | None,
        typer.Option("--catalog", exists=True, dir_okay=False, help="Registry for priorities."),
    ] = None,
    batch_cap: Annotated[int, typer.Option("--batch-cap", min=1)] = 50,
    wait_hours: Annotated[float, typer.Option("--wait-hours", min=0.001)] = 24.0,
    first_attempt_at: Annotated[
        str | None, typer.Option("--first-attempt-at", help="UTC ISO time of the first probe.")
    ] = None,
    min_request_delay: Annotated[float, typer.Option("--min-request-delay", min=0.2)] = 10.0,
    max_request_delay: Annotated[float, typer.Option("--max-request-delay", min=0.2)] = 20.0,
    backoff_base_seconds: Annotated[float, typer.Option("--backoff-base-seconds", min=1)] = 300.0,
    max_windows: Annotated[int | None, typer.Option("--max-windows", min=1)] = None,
) -> None:
    """Daily-batch loop: batch until the first CAPTCHA or the cap, wait 24 h, probe with one."""
    options = DailyOptions(
        batch_cap=batch_cap,
        wait_seconds=wait_hours * 3600,
        first_attempt_at=(
            datetime.fromisoformat(first_attempt_at.replace("Z", "+00:00"))
            if first_attempt_at
            else None
        ),
        max_windows=max_windows,
        collect=CollectOptions(
            min_request_delay=min_request_delay,
            max_request_delay=max(max_request_delay, min_request_delay),
            min_item_pause=0.2,
            max_item_pause=0.2,
            workers=1,
            backoff_base_seconds=backoff_base_seconds,
            include_exhausted=True,
            catalog_path=catalog,
        ),
    )
    summary = run_daily_loop(plan, output_root, state, log_dir, options, log=typer.echo)
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2, default=str))


@app.command("grls-url-ledger")
def grls_url_ledger_command(
    state: Annotated[Path, typer.Option("--state", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Export registration -> idReg/routingGuid/PDF URL(s)/checksum/fetch time."""
    typer.echo(json.dumps(export_url_ledger(state, output), ensure_ascii=False, indent=2))


@app.command("grls-additions-registry")
def grls_additions_registry_command(
    plan: Annotated[Path, typer.Option("--plan", exists=True, dir_okay=False)],
    state: Annotated[Path, typer.Option("--state", exists=True, dir_okay=False)],
    catalog: Annotated[list[Path], typer.Option("--catalog", exists=True, dir_okay=False)],
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)],
    prepared: Annotated[list[Path], typer.Option("--prepared", help="Prepared workspace.")],
    output: Annotated[Path, typer.Option("--output")],
    limit: Annotated[int | None, typer.Option("--limit", min=1)] = None,
) -> None:
    """Registry of downloaded GRLS PDFs that no prepared workspace has extracted yet."""
    summary = build_additions_registry(
        plan, state, catalog, raw_root, prepared, output, limit=limit
    )
    typer.echo(json.dumps(summary, ensure_ascii=False, indent=2))


@app.command("grls-text-manifest")
def grls_text_manifest_command(
    plan: Annotated[list[Path], typer.Option("--plan", exists=True, dir_okay=False)],
    state: Annotated[Path, typer.Option("--state", exists=True, dir_okay=False)],
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)],
    prepared: Annotated[list[Path], typer.Option("--prepared", help="Prepared workspace.")],
    manifest: Annotated[Path, typer.Option("--manifest")],
    report: Annotated[Path, typer.Option("--report")],
    before_cutoff: Annotated[str | None, typer.Option("--before-cutoff")] = None,
) -> None:
    """Per-PDF text manifest (OCR flag and quality signals) and coverage report."""
    summary = build_text_manifest(
        plan,
        state,
        raw_root,
        prepared,
        manifest,
        report,
        before_cutoff=before_cutoff,
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
