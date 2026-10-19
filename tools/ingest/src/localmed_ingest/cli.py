from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Annotated

import typer
from pydantic import TypeAdapter

from .allmed_images import build_allmed_image_pack
from .allmed_reference import (
    export_allmed_reference,
    load_esklp_mnn_identities,
    prepare_allmed_medications,
)
from .builder import build_content_pack, lint_content_pack, load_content_pack
from .catalog_module_builder import (
    CatalogFamily,
    build_core_catalog_pointers,
    build_core_reference_pointers,
)
from .clinical_queries import import_real_pocqi_benchmark
from .code_reference import prepare_medical_services
from .code_reference import report_json as code_reference_report_json
from .code_reference_distribution import package_medical_services_module
from .diets_distribution import package_diets_module
from .diets_official import prepare_diets_official
from .diets_official import report_json as diets_report_json
from .drug_sources import collect_drug_sources
from .feeding_distribution import package_feeding_module
from .feeding_norms import FeedingSourceError, prepare_feeding_norms, verify_feeding_sources
from .feeding_norms import report_json as feeding_report_json
from .herbal_conflicts import check_conflicts
from .herbal_distribution import package_herbal_module, package_herbal_plates
from .herbal_ema import check_ema_extractions, check_who_extractions
from .herbal_plants import load_plants
from .herbal_prepare import prepare_herbal_book
from .herbal_prepare import report_json as herbal_prepare_report_json
from .herbal_regions import fetch_regional_red_books
from .herbal_safety import check_safety
from .herbal_sources import fetch_herbal_sources
from .herbal_sources import report_json as herbal_sources_report_json
from .icd11_api_fetch import fetch_icd11_api
from .icd11_distribution import package_icd11_module
from .icd11_fetch import fetch_icd11_release
from .icd11_prepare import prepare_icd11
from .instruction_card_drafts import export_instruction_card_drafts
from .knowledge import (
    approve_knowledge,
    export_ai_fact_review_tasks,
    export_chatgpt_tasks,
    import_ai_fact_reviews,
    import_chatgpt_responses,
    knowledge_summary,
    load_knowledge_workspace,
    load_workspace_documents,
)
from .krasotaimedicina_crawl import DEFAULT_SEEDS, crawl_krasotaimedicina
from .krasotaimedicina_distribution import package_krasotaimedicina_module
from .krasotaimedicina_prepare import prepare_krasotaimedicina
from .local_module_bundle import bundle_local_module
from .local_reference_common import ensure_gitignored, package_local_module
from .local_reference_lab import SPEC as LOCAL_LAB_SPEC
from .local_reference_lab import prepare_lab_reference
from .local_reference_pevzner import SPEC as LOCAL_PEVZNER_SPEC
from .local_reference_pevzner import prepare_pevzner_diets
from .local_reference_tnm import SPEC as LOCAL_TNM_SPEC
from .local_reference_tnm import prepare_tnm
from .local_reference_vidal import (
    DEFAULT_DB_VERSION,
    load_esklp_identities_from_modules,
    prepare_vidal_medications,
)
from .mkb_reference_upgrade import upgrade_mkb_reference_database, write_upgrade_report
from .module_search_compaction import MIGRATION_ID, migrate_module_search
from .pdf_import import import_pdf
from .publication import PublicationDecision
from .regulatory_distribution import package_regulatory_module
from .regulatory_light import write_light_sources
from .rls_mkb import RLS_MKB_DETAIL_URL, RLS_MKB_INDEX_URL, scrape_rls_mkb
from .rls_mkb_distribution import package_rls_mkb_modules
from .rls_mkb_modules import split_rls_mkb_workspace
from .source_registry import prepare_registry
from .source_sync import sync_source_manifest
from .sqlite_composer import compose_sqlite_packs
from .text_import import import_text
from .tool_modules import build_tool_module

app = typer.Typer(no_args_is_help=True, help="Build and inspect LocalMed content packs.")


@app.command("build-tool-module")
def build_tool_module_command(
    source: Annotated[Path, typer.Option("--source", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Build a validated SQLite module containing downloadable calculators and assessments."""
    report = build_tool_module(source, output)
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("export-allmed-reference")
def export_allmed_reference_command(
    input_path: Annotated[Path, typer.Option("--input", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Export raw Allmed rows as review-only reference candidates."""
    report = export_allmed_reference(input_path, output)
    typer.echo(json.dumps(report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("prepare-allmed-medications")
def prepare_allmed_medications_command(
    input_path: Annotated[Path, typer.Option("--input", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    esklp_ledger: Annotated[
        Path | None,
        typer.Option(
            "--esklp-ledger",
            exists=True,
            dir_okay=False,
            help="JSON identity ledger or validated ESKLP pointer SQLite database.",
        ),
    ] = None,
) -> None:
    """Prepare one local Allmed snapshot as a lexical medications workspace."""
    identities = load_esklp_mnn_identities(esklp_ledger) if esklp_ledger else None
    report = prepare_allmed_medications(
        input_path,
        output,
        esklp_identities=identities,
    )
    typer.echo(json.dumps(report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("build-allmed-image-pack")
def build_allmed_image_pack_command(
    input_path: Annotated[Path, typer.Option("--input", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    workers: Annotated[int, typer.Option("--workers", min=1, max=64)] = 16,
    retries: Annotated[int, typer.Option("--retries", min=0, max=8)] = 3,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 30.0,
    resume: Annotated[bool, typer.Option("--resume")] = False,
    mirror_tag: Annotated[str | None, typer.Option("--mirror-tag")] = None,
) -> None:
    """Download Allmed packaging images and build a resumable source-assets pack."""
    report = build_allmed_image_pack(
        input_path,
        output,
        workers=workers,
        retries=retries,
        timeout_seconds=timeout_seconds,
        resume=resume,
        mirror_tag=mirror_tag,
    )
    typer.echo(json.dumps(report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("build-core-catalog-pointers")
def build_core_catalog_pointers_command(
    ledger: Annotated[Path, typer.Option("--ledger", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    version: Annotated[str, typer.Option("--version")],
    family: Annotated[CatalogFamily, typer.Option("--family")] = "medication",
    core_module_id: Annotated[str, typer.Option("--core-module-id")] = "minimed.core.ru",
    core_module_title: Annotated[str, typer.Option("--core-module-title")] = "Ядро MiniMed",
    built_at: Annotated[str | None, typer.Option("--built-at")] = None,
    force: Annotated[bool, typer.Option("--force")] = False,
) -> None:
    """Build compact core pointers for one catalog-family ledger."""
    report = build_core_catalog_pointers(
        ledger,
        output,
        family=family,
        version=version,
        core_module_id=core_module_id,
        core_module_title=core_module_title,
        built_at=built_at,
        force=force,
    )
    typer.echo(json.dumps(report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("build-core-reference-pointers")
def build_core_reference_pointers_command(
    source: Annotated[Path, typer.Option("--source", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    version: Annotated[str, typer.Option("--version")],
    module_id: Annotated[str, typer.Option("--module-id")],
    module_title: Annotated[str, typer.Option("--module-title")],
    built_at: Annotated[str | None, typer.Option("--built-at")] = None,
    force: Annotated[bool, typer.Option("--force")] = False,
    target_modules: Annotated[
        Path | None, typer.Option("--target-modules", exists=True, dir_okay=False)
    ] = None,
) -> None:
    """Build compact core pointers from a MiniMed reference-pack SQLite database."""
    report = build_core_reference_pointers(
        source,
        output,
        module_id=module_id,
        module_title=module_title,
        version=version,
        built_at=built_at,
        force=force,
        target_modules=TypeAdapter(dict[str, list[str]]).validate_json(
            target_modules.read_text(encoding="utf-8")
        )
        if target_modules is not None
        else None,
    )
    typer.echo(json.dumps(report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("export-instruction-card-drafts")
def export_instruction_card_drafts_command(
    input_path: Annotated[Path, typer.Option("--input", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Export exact official-instruction excerpts as review-only card drafts."""
    report = export_instruction_card_drafts(input_path, output)
    typer.echo(json.dumps(report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("import")
def import_command(
    source: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", "-o")],
    source_format: Annotated[
        str, typer.Option("--format", help="auto, pdf, text, or markdown")
    ] = "auto",
) -> None:
    """Extract a PDF/TXT/Markdown source into deterministic block JSON."""
    resolved_format = source_format.lower()
    if resolved_format == "auto":
        if source.suffix.lower() == ".pdf":
            resolved_format = "pdf"
        elif source.suffix.lower() in {".md", ".markdown"}:
            resolved_format = "markdown"
        elif source.suffix.lower() in {".txt", ".text"}:
            resolved_format = "text"
        else:
            raise typer.BadParameter(f"Cannot infer source format from {source.name}")
    if resolved_format == "pdf":
        import_pdf(source, output)
    elif resolved_format == "text":
        import_text(source, output, "text")
    elif resolved_format == "markdown":
        import_text(source, output, "markdown")
    else:
        raise typer.BadParameter("--format must be auto, pdf, text, or markdown")
    typer.echo(str(output))


@app.command("scrape-rls-mkb")
def scrape_rls_mkb_command(
    output: Annotated[Path, typer.Option("--output")],
    raw_output: Annotated[Path, typer.Option("--raw-output")],
    classification_url: Annotated[str, typer.Option("--classification-url")] = RLS_MKB_INDEX_URL,
    detail_urls: Annotated[list[str] | None, typer.Option("--detail-url")] = None,
    all_details: Annotated[bool, typer.Option("--all-details")] = False,
    detail_limit: Annotated[int | None, typer.Option("--detail-limit", min=1)] = None,
    built_at: Annotated[str | None, typer.Option("--built-at")] = None,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 60.0,
    retry_failures: Annotated[bool, typer.Option("--retry-failures")] = False,
    failures_file: Annotated[Path | None, typer.Option("--failures-file")] = None,
    resume: Annotated[bool, typer.Option("--resume")] = False,
) -> None:
    """Prepare a local-dev MKB workspace from RLS HTML pages."""
    report = scrape_rls_mkb(
        output,
        raw_output=raw_output,
        classification_url=classification_url,
        detail_urls=detail_urls or ([] if all_details else [RLS_MKB_DETAIL_URL]),
        all_details=all_details,
        detail_limit=detail_limit,
        built_at=built_at,
        timeout_seconds=timeout_seconds,
        retry_failures=retry_failures,
        failures_file=failures_file,
        resume=resume,
    )
    typer.echo(json.dumps(report.__dict__, ensure_ascii=False, indent=2))
    if report.failures:
        raise typer.Exit(code=1)


@app.command("crawl-krasotaimedicina")
def crawl_krasotaimedicina_command(
    output: Annotated[Path, typer.Option("--output")],
    seed_urls: Annotated[list[str] | None, typer.Option("--seed-url")] = None,
    max_pages: Annotated[int, typer.Option("--max-pages", min=1)] = 25_000,
    requests_per_minute: Annotated[int, typer.Option("--requests-per-minute", min=1, max=120)] = 30,
    download_images: Annotated[bool, typer.Option("--download-images/--skip-images")] = True,
) -> None:
    """Crawl the public medical-reference sections into private resumable raw staging."""
    report = asyncio.run(
        crawl_krasotaimedicina(
            output,
            seeds=tuple(seed_urls or DEFAULT_SEEDS),
            max_pages=max_pages,
            requests_per_minute=requests_per_minute,
            download_images=download_images,
        )
    )
    typer.echo(json.dumps(report.__dict__, ensure_ascii=False, indent=2))


@app.command("prepare-krasotaimedicina")
def prepare_krasotaimedicina_command(
    raw_input: Annotated[Path, typer.Option("--raw-input", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    publication_decision_date: Annotated[
        str | None,
        typer.Option(
            "--publication-decision-date",
            help="Date (YYYY-MM-DD) of the owner's decision to distribute as experimental-preview.",
        ),
    ] = None,
    publication_decision_basis: Annotated[
        str | None, typer.Option("--publication-decision-basis")
    ] = None,
) -> None:
    """Prepare checksummed disease articles from private crawl staging."""
    if (publication_decision_date is None) != (publication_decision_basis is None):
        raise typer.BadParameter("Supply both the publication decision date and its basis.")
    publication = (
        PublicationDecision(
            decided_at=publication_decision_date,
            decided_by="project owner",
            basis=publication_decision_basis,
        )
        if publication_decision_date is not None and publication_decision_basis is not None
        else None
    )
    report = prepare_krasotaimedicina(raw_input, output, publication)
    typer.echo(json.dumps(report.__dict__, ensure_ascii=False, indent=2))


@app.command("split-rls-mkb")
def split_rls_mkb_command(
    input_dir: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    code_output: Annotated[Path, typer.Option("--code-output")],
    packaging_output: Annotated[Path, typer.Option("--packaging-output")],
    publication_decision_date: Annotated[str, typer.Option("--publication-decision-date")],
    publication_decision_basis: Annotated[str, typer.Option("--publication-decision-basis")],
) -> None:
    """Split the RLS MKB workspace into a compact code workspace and a packaging workspace."""
    report = split_rls_mkb_workspace(
        input_dir,
        code_output,
        packaging_output,
        PublicationDecision(
            decided_at=publication_decision_date,
            decided_by="project owner",
            basis=publication_decision_basis,
        ),
    )
    typer.echo(json.dumps(report.__dict__, ensure_ascii=False, indent=2))


@app.command("package-rls-mkb")
def package_rls_mkb_command(
    code_database: Annotated[Path, typer.Option("--code-database", exists=True, dir_okay=False)],
    packaging_database: Annotated[
        Path, typer.Option("--packaging-database", exists=True, dir_okay=False)
    ],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
    core_database: Annotated[
        Path | None, typer.Option("--core-database", exists=True, dir_okay=False)
    ] = None,
) -> None:
    """Gzip both RLS packs, verify core pointer membership and write their catalog entries."""
    report = package_rls_mkb_modules(
        code_database,
        packaging_database,
        output,
        version=version,
        min_app_version=min_app_version,
        core_database=core_database,
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("package-krasotaimedicina")
def package_krasotaimedicina_command(
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
    core_database: Annotated[
        Path | None, typer.Option("--core-database", exists=True, dir_okay=False)
    ] = None,
) -> None:
    """Gzip the built pack, verify core pointer membership and write its catalog entry."""
    report = package_krasotaimedicina_module(
        database,
        output,
        version=version,
        min_app_version=min_app_version,
        core_database=core_database,
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("fetch-icd11")
def fetch_icd11_command(
    release: Annotated[str, typer.Option("--release", help="WHO release, e.g. 2026-01.")],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
) -> None:
    """Download WHO's public ICD-11 MMS Russian tabulation and ICD-10/11 mapping tables."""
    manifest = fetch_icd11_release(release, output)
    typer.echo(json.dumps(manifest, ensure_ascii=False, indent=2))


@app.command("fetch-icd11-api")
def fetch_icd11_api_command(
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)],
    release: Annotated[str, typer.Option("--release", help="WHO release, e.g. 2026-01.")],
    container_image: Annotated[
        str, typer.Option("--container-image", help="Image reference with digest, for provenance.")
    ],
    data_release: Annotated[
        str, typer.Option("--data-release", help="Data release the container logged at start.")
    ],
    base_url: Annotated[str, typer.Option("--base-url")] = "http://127.0.0.1:8382",
    concurrency: Annotated[int, typer.Option("--concurrency", min=1, max=8)] = 4,
) -> None:
    """Cache the Russian entity text served by the local WHO ICD-API container (loopback only)."""
    report = fetch_icd11_api(
        raw_root,
        release=release,
        base_url=base_url,
        container_image=container_image,
        data_release=data_release,
        concurrency=concurrency,
    )
    typer.echo(json.dumps(report.__dict__, ensure_ascii=False, indent=2))


@app.command("prepare-icd11")
def prepare_icd11_command(
    raw_input: Annotated[Path, typer.Option("--raw-input", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    publication_decision_date: Annotated[str, typer.Option("--publication-decision-date")],
    publication_decision_basis: Annotated[str, typer.Option("--publication-decision-basis")],
    mkb10_database: Annotated[
        Path | None,
        typer.Option(
            "--mkb10-database",
            exists=True,
            dir_okay=False,
            help="ICD-10 module database; only used to check which ICD-10 cards exist for links.",
        ),
    ] = None,
    api_text: Annotated[
        bool,
        typer.Option(
            "--api-text/--no-api-text",
            help="Merge the cached Russian ICD-API entity text (run fetch-icd11-api first).",
        ),
    ] = True,
) -> None:
    """Prepare the WHO ICD-11 MMS (Russian) workspace; ICD-10 data is never modified."""
    report = prepare_icd11(
        raw_input,
        output,
        PublicationDecision(
            decided_at=publication_decision_date,
            decided_by="project owner",
            basis=publication_decision_basis,
        ),
        mkb10_database=mkb10_database,
        with_api_text=api_text,
    )
    typer.echo(json.dumps(report.__dict__, ensure_ascii=False, indent=2))


@app.command("package-icd11")
def package_icd11_command(
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
    raw_root: Annotated[
        Path | None,
        typer.Option(
            "--raw-root",
            exists=True,
            file_okay=False,
            help="Raw ICD-11 directory; its checksums are recorded in the release report.",
        ),
    ] = None,
) -> None:
    """Gzip the built ICD-11 pack and write its catalog entry."""
    report = package_icd11_module(
        database, output, version=version, min_app_version=min_app_version, raw_root=raw_root
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("prepare-code-reference")
def prepare_code_reference_command(
    raw_input: Annotated[Path, typer.Option("--raw-input", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Prepare the NSI medical-services nomenclature (OID 1.2.643.5.1.13.13.11.1070) as Markdown."""
    typer.echo(code_reference_report_json(prepare_medical_services(raw_input, output)))


@app.command("package-code-reference")
def package_code_reference_command(
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
) -> None:
    """Gzip the built medical-services pack and write its catalog entry."""
    report = package_medical_services_module(
        database, output, version=version, min_app_version=min_app_version
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("prepare-diets")
def prepare_diets_command(
    raw_input: Annotated[Path, typer.Option("--raw-input", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Prepare the official therapeutic-nutrition Markdown (orders 330, 395n, 1008n, 70n)."""
    typer.echo(diets_report_json(prepare_diets_official(raw_input, output)))


@app.command("fetch-herbal-sources")
def fetch_herbal_sources_command(
    plants: Annotated[Path, typer.Option("--plants", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    refresh: Annotated[bool, typer.Option("--refresh")] = False,
    only: Annotated[list[str] | None, typer.Option("--only", help="Plant id; repeatable.")] = None,
    gf_only: Annotated[
        bool, typer.Option("--gf-only", help="Fetch only the ГФ articles (no EMA, no plates).")
    ] = False,
) -> None:
    """Download EMA herbal documents, public-domain plates and the ГФ articles."""
    manifest = fetch_herbal_sources(
        plants, output, refresh=refresh, only=frozenset(only) if only else None, gf_only=gf_only
    )
    typer.echo(herbal_sources_report_json(manifest))


@app.command("check-herbal-ema")
def check_herbal_ema_command(
    directory: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)],
) -> None:
    """Check every EMA quote of the herbal extraction files against the downloaded PDF pages."""
    results = check_ema_extractions(directory, raw_root)
    typer.echo(json.dumps(results, ensure_ascii=False, indent=2))
    if any(results.values()):
        raise typer.Exit(1)


@app.command("check-herbal-who")
def check_herbal_who_command(
    directory: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)],
    plants: Annotated[Path, typer.Option("--plants", exists=True, dir_okay=False)] = Path(
        "content/herbal/plants.yaml"
    ),
) -> None:
    """Check every WHO quote of the herbal extraction files against its volume and page range."""
    monographs = {
        plant.id: (plant.who.volume, plant.who.pages)
        for plant in load_plants(plants)
        if plant.who is not None
    }
    results = check_who_extractions(directory, raw_root, monographs)
    typer.echo(json.dumps(results, ensure_ascii=False, indent=2))
    if any(results.values()):
        raise typer.Exit(1)


@app.command("check-herbal-safety")
def check_herbal_safety_command(
    directory: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)],
    plants: Annotated[Path, typer.Option("--plants", exists=True, dir_okay=False)] = Path(
        "content/herbal/plants.yaml"
    ),
) -> None:
    """Check every safety line of the herbal book against its saved NCCIH/LactMed/LiverTox source
    and every TR CU 021/2011 row against its page."""
    results = check_safety(directory, raw_root, {plant.id for plant in load_plants(plants)})
    typer.echo(json.dumps(results, ensure_ascii=False, indent=2))
    if any(results.values()):
        raise typer.Exit(1)


@app.command("check-herbal-conflicts")
def check_herbal_conflicts_command(
    directory: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)],
    book: Annotated[Path, typer.Option("--book", exists=True, file_okay=False)] = Path(
        "content/herbal/book"
    ),
    plants: Annotated[Path, typer.Option("--plants", exists=True, dir_okay=False)] = Path(
        "content/herbal/plants.yaml"
    ),
) -> None:
    """Check every ГРЛС-against-monograph conflict: the ГРЛС sentence in the built chapter, the
    monograph sentence on its page, every number of the Russian line in one of the two."""
    plant_list = load_plants(plants)
    who = {plant.id: (plant.who.volume, plant.who.pages) for plant in plant_list if plant.who}
    results = check_conflicts(directory, raw_root, book, who, {plant.id for plant in plant_list})
    typer.echo(json.dumps(results, ensure_ascii=False, indent=2))
    if any(results.values()):
        raise typer.Exit(1)


@app.command("fetch-regional-red-books")
def fetch_regional_red_books_command(
    raw_root: Annotated[Path, typer.Option("--raw-root", file_okay=False)] = Path(
        "data/raw/herbal/plantarium"
    ),
    output: Annotated[Path, typer.Option("--output", dir_okay=False)] = Path(
        "content/herbal/regional-red-books.yaml"
    ),
    plants: Annotated[Path, typer.Option("--plants", exists=True, dir_okay=False)] = Path(
        "content/herbal/plants.yaml"
    ),
) -> None:
    """Read each herbal plant's Plantarium taxon page (about 150 requests, 1.5 s apart) and write
    the regions whose newest Red Book lists it; rows checked by hand keep their `checked`."""
    plant_list = [(plant.id, plant.latin) for plant in load_plants(plants)]
    counts = fetch_regional_red_books(
        plant_list, raw_root, output, datetime.now().astimezone().date().isoformat()
    )
    typer.echo(json.dumps(counts, ensure_ascii=False, indent=2))


@app.command("prepare-herbal")
def prepare_herbal_command(
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    plants: Annotated[Path, typer.Option("--plants", exists=True, dir_okay=False)] = Path(
        "content/herbal/plants.yaml"
    ),
    catalog: Annotated[Path, typer.Option("--catalog", exists=True, dir_okay=False)] = Path(
        "data/raw/official-grls-registry/catalog.json"
    ),
    instruction_manifest: Annotated[
        list[Path] | None,
        typer.Option(
            "--instruction-manifest",
            exists=True,
            dir_okay=False,
            help="Text manifest; repeatable (targeted additions after the main one).",
        ),
    ] = None,
    instructions: Annotated[
        list[Path] | None,
        typer.Option(
            "--instructions",
            exists=True,
            file_okay=False,
            help="Prepared instruction workspace; repeatable.",
        ),
    ] = None,
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)] = Path(
        "data/raw/herbal"
    ),
    ema: Annotated[Path, typer.Option("--ema", exists=True, file_okay=False)] = Path(
        "content/herbal/ema"
    ),
    lookalikes: Annotated[Path, typer.Option("--lookalikes", exists=True, dir_okay=False)] = Path(
        "content/herbal/lookalikes.yaml"
    ),
    who: Annotated[Path, typer.Option("--who", file_okay=False)] = Path("content/herbal/who"),
) -> None:
    """Write the herbal book chapters (ГРЛС text, EMA facts, plate records) as prepared Markdown."""
    report = prepare_herbal_book(
        plants_path=plants,
        catalog=catalog,
        instruction_manifest=instruction_manifest
        or [Path("data/build/grls-instruction-text-manifest.jsonl")],
        instructions_root=instructions or [Path("data/intermediate/grls-full-final")],
        raw_root=raw_root,
        ema_dir=ema,
        output=output,
        lookalikes_path=lookalikes,
        who_dir=who,
    )
    typer.echo(herbal_prepare_report_json(report))


@app.command("package-herbal")
def package_herbal_command(
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
) -> None:
    """Gzip the built herbal book pack and write its catalog entry."""
    report = package_herbal_module(
        database, output, version=version, min_app_version=min_app_version
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("package-herbal-plates")
def package_herbal_plates_command(
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
    plants: Annotated[Path, typer.Option("--plants", exists=True, dir_okay=False)] = Path(
        "content/herbal/plants.yaml"
    ),
    raw_root: Annotated[Path, typer.Option("--raw-root", exists=True, file_okay=False)] = Path(
        "data/raw/herbal"
    ),
) -> None:
    """Write the herbal plates ZIP, its index pack and the plates module catalog entry."""
    report = package_herbal_plates(
        plants, raw_root, output, version=version, min_app_version=min_app_version
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("package-diets")
def package_diets_command(
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
) -> None:
    """Gzip the built therapeutic-nutrition pack and write its catalog entry."""
    report = package_diets_module(
        database, output, version=version, min_app_version=min_app_version
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("package-regulatory")
def package_regulatory_command(
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
    transport: Annotated[str, typer.Option("--transport")] = "zstd",
) -> None:
    """Package the verified regulatory pack (zstd by default) and write its catalog entry."""
    report = package_regulatory_module(
        database, output, version=version, min_app_version=min_app_version, transport=transport
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("prepare-regulatory-light")
def prepare_regulatory_light_command(
    directory: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
) -> None:
    """Write the bundled regulatory sources: 323-FZ in full text, a module-pointer card per act."""
    cards = write_light_sources(directory, output)
    typer.echo(
        json.dumps(
            [
                {
                    "documentId": card.document_id,
                    "fullText": card.full_text,
                    "outlineEntries": card.outline_entries,
                    "fullChars": card.full_chars,
                    "cardChars": card.card_chars,
                }
                for card in cards
            ],
            ensure_ascii=False,
            indent=2,
        )
    )


@app.command("prepare-feeding")
def prepare_feeding_command(
    directory: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
) -> None:
    """Validate the book-cited feeding-norms Markdown and write its manifest and aliases."""
    try:
        typer.echo(feeding_report_json(prepare_feeding_norms(directory)))
    except FeedingSourceError as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(1) from error


@app.command("verify-feeding")
def verify_feeding_command(
    directory: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    library: Annotated[Path, typer.Option("--library", exists=True, file_okay=False)],
) -> None:
    """Check every verbatim block against the PDF text layer in the private library."""
    report = verify_feeding_sources(directory, library)
    typer.echo(
        f"checked {report.checked} blocks, {report.weak} weak, {len(report.failures)} failed; "
        f"{report.scan_blocks} scan blocks transcribed from images (no text layer)"
    )
    for failure in report.failures:
        typer.echo(failure, err=True)
    if report.failures:
        raise typer.Exit(1)


@app.command("package-feeding")
def package_feeding_command(
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
) -> None:
    """Gzip the built feeding-norms pack and write its catalog entry."""
    report = package_feeding_module(
        database, output, version=version, min_app_version=min_app_version
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("bundle-local-module")
def bundle_local_module_command(
    entry: Annotated[Path, typer.Option("--entry", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", dir_okay=False)],
    artifacts_dir: Annotated[
        Path | None,
        typer.Option(
            "--artifacts-dir",
            exists=True,
            file_okay=False,
            help="Directory of the artifact files; defaults to the entry's directory.",
        ),
    ] = None,
) -> None:
    """Wrap a packaged module into a personal-use <stem>.minimed-module.zip (never published)."""
    report = bundle_local_module(entry, output, artifacts_dir=artifacts_dir)
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("prepare-local-lab")
def prepare_local_lab_command(
    raw_input: Annotated[Path, typer.Option("--raw-input", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Personal-use lab norms workspace from analyzes.sqlite (output must be gitignored)."""
    ensure_gitignored(output)
    report = prepare_lab_reference(raw_input, output)
    typer.echo(json.dumps(report.__dict__, ensure_ascii=False, indent=2))


@app.command("prepare-local-tnm")
def prepare_local_tnm_command(
    raw_input: Annotated[Path, typer.Option("--raw-input", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Personal-use TNM workspace from tnm.sqlite (output must be gitignored)."""
    ensure_gitignored(output)
    report = prepare_tnm(raw_input, output)
    typer.echo(json.dumps(report.__dict__, ensure_ascii=False, indent=2))


@app.command("prepare-local-vidal")
def prepare_local_vidal_command(
    raw_input: Annotated[Path, typer.Option("--raw-input", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    db_version: Annotated[
        int, typer.Option("--db-version", min=1, help="Vidal database version of the download.")
    ] = DEFAULT_DB_VERSION,
    esklp_modules: Annotated[
        Path | None,
        typer.Option(
            "--esklp-modules",
            exists=True,
            file_okay=False,
            help="Directory of released ESKLP module databases (links documents to a substance).",
        ),
    ] = None,
    esklp_ledger: Annotated[
        Path | None,
        typer.Option(
            "--esklp-ledger",
            exists=True,
            dir_okay=False,
            help="JSON identity ledger or ESKLP pointer SQLite (instead of --esklp-modules).",
        ),
    ] = None,
) -> None:
    """Personal-use Vidal drug workspace from vidal.db (output must be gitignored)."""
    ensure_gitignored(output)
    identities = (
        load_esklp_identities_from_modules(esklp_modules)
        if esklp_modules
        else load_esklp_mnn_identities(esklp_ledger)
        if esklp_ledger
        else None
    )
    report = prepare_vidal_medications(
        raw_input, output, db_version=db_version, esklp_identities=identities
    )
    typer.echo(json.dumps(report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("prepare-local-pevzner")
def prepare_local_pevzner_command(
    raw_input: Annotated[Path, typer.Option("--raw-input", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Personal-use Pevzner diets workspace from mes.sqlite (output must be gitignored)."""
    ensure_gitignored(output)
    report = prepare_pevzner_diets(raw_input, output)
    typer.echo(json.dumps(report.__dict__, ensure_ascii=False, indent=2))


@app.command("package-local-pevzner")
def package_local_pevzner_command(
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
) -> None:
    """Gzip a built personal Pevzner pack and write its catalog entry (gitignored output)."""
    report = package_local_module(
        LOCAL_PEVZNER_SPEC, database, output, version=version, min_app_version=min_app_version
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("package-local-reference")
def package_local_reference_command(
    module: Annotated[str, typer.Option("--module", help="lab or tnm")],
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output", file_okay=False)],
    version: Annotated[str, typer.Option("--version")],
    min_app_version: Annotated[str, typer.Option("--min-app-version")],
) -> None:
    """Gzip a built personal-use lab/TNM pack and write its catalog entry (gitignored output)."""
    specs = {"lab": LOCAL_LAB_SPEC, "tnm": LOCAL_TNM_SPEC}
    if module not in specs:
        raise typer.BadParameter("Use --module lab or --module tnm")
    ensure_gitignored(output)
    report = package_local_module(
        specs[module], database, output, version=version, min_app_version=min_app_version
    )
    typer.echo(json.dumps(report, ensure_ascii=False, indent=2))


@app.command("sync")
def sync_command(
    manifest: Annotated[Path, typer.Option("--manifest", exists=True, dir_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    cache_root: Annotated[Path, typer.Option("--cache-root")] = Path(".cache/localmed/sources"),
    input_root: Annotated[
        Path | None, typer.Option("--input-root", exists=True, file_okay=False)
    ] = None,
    report: Annotated[Path | None, typer.Option("--report")] = None,
    force_refresh: Annotated[bool, typer.Option("--force-refresh")] = False,
    offline: Annotated[bool, typer.Option("--offline")] = False,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 180.0,
) -> None:
    """Synchronize URL or local-file inputs into a validated, cache-backed source workspace."""
    sync_report = sync_source_manifest(
        manifest,
        output_root,
        cache_root,
        input_root=input_root,
        force_refresh=force_refresh,
        offline=offline,
        timeout_seconds=timeout_seconds,
    )
    payload = sync_report.model_dump(mode="json")
    if report is not None:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))


@app.command("collect-drugs")
def collect_drugs_command(
    catalog: Annotated[Path, typer.Option("--catalog", exists=True, dir_okay=False)],
    output_root: Annotated[Path, typer.Option("--output-root")],
    cache_root: Annotated[Path, typer.Option("--cache-root")] = Path(".cache/localmed/drugs"),
    input_root: Annotated[
        Path | None, typer.Option("--input-root", exists=True, file_okay=False)
    ] = None,
    report: Annotated[Path | None, typer.Option("--report")] = None,
    force_refresh: Annotated[bool, typer.Option("--force-refresh")] = False,
    offline: Annotated[bool, typer.Option("--offline")] = False,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 180.0,
) -> None:
    """Collect explicitly licensed drug sources without crawling or scraping public interfaces."""
    result = collect_drug_sources(
        catalog,
        output_root,
        cache_root,
        input_root=input_root,
        force_refresh=force_refresh,
        offline=offline,
        timeout_seconds=timeout_seconds,
        report_path=report,
    )
    typer.echo(
        json.dumps(result.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
    )


@app.command("benchmark-import-real-pocqi")
def benchmark_import_real_pocqi_command(
    output: Annotated[Path, typer.Option("--output")],
    report: Annotated[Path | None, typer.Option("--report")] = None,
    snapshot: Annotated[
        Path | None, typer.Option("--snapshot", exists=True, dir_okay=False)
    ] = None,
    cache_root: Annotated[Path, typer.Option("--cache-root")] = Path(
        ".cache/localmed/clinical-queries"
    ),
    count: Annotated[int, typer.Option("--count", min=1)] = 120,
    seed: Annotated[str, typer.Option("--seed")] = "minimed-real-pocqi-v1",
    offline: Annotated[bool, typer.Option("--offline")] = False,
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 180.0,
) -> None:
    """Import an attributed, deterministic sample of real point-of-care clinician queries."""
    import_report = import_real_pocqi_benchmark(
        output,
        report_path=report,
        snapshot=snapshot,
        cache_root=cache_root,
        count=count,
        seed=seed,
        offline=offline,
        timeout_seconds=timeout_seconds,
    )
    typer.echo(json.dumps(import_report.model_dump(mode="json"), ensure_ascii=False, indent=2))


@app.command("prepare")
def prepare_command(
    registry: Annotated[Path, typer.Option("--registry", exists=True, dir_okay=False)],
    source_root: Annotated[Path, typer.Option("--source-root", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    force: Annotated[bool, typer.Option("--force")] = False,
    workers: Annotated[int, typer.Option("--workers", min=1, max=8)] = 1,
    reuse_from: Annotated[
        Path | None,
        typer.Option(
            "--reuse-from",
            exists=True,
            file_okay=False,
            help="Reuse checksum-matched extraction JSON from a prepared workspace.",
        ),
    ] = None,
) -> None:
    """Prepare private PDF/TXT sources as a build-ready Markdown workspace."""
    prepare_report = prepare_registry(
        registry,
        source_root,
        output,
        force=force,
        workers=workers,
        reuse_from=reuse_from,
    )
    typer.echo(json.dumps(prepare_report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("ai-export")
def ai_export_command(
    input_dir: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Export source-preserving JSONL tasks for manual processing in ChatGPT chat."""
    tasks = export_chatgpt_tasks(input_dir, output)
    typer.echo(json.dumps({"tasks": tasks, "output": str(output)}, ensure_ascii=False, indent=2))


@app.command("ai-import")
def ai_import_command(
    input_dir: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    responses: Annotated[Path, typer.Option("--responses", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    base: Annotated[Path | None, typer.Option("--base", exists=True, dir_okay=False)] = None,
) -> None:
    """Validate ChatGPT JSONL proposals and write a proposed knowledge workspace."""
    report = import_chatgpt_responses(input_dir, responses, output, base_path=base)
    typer.echo(
        json.dumps(report.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
    )


@app.command("ai-fact-review-export")
def ai_fact_review_export_command(
    input_dir: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    source: Annotated[Path, typer.Option("--source", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Export immutable proposed dosage facts for independent AI review."""
    tasks = export_ai_fact_review_tasks(input_dir, source, output)
    typer.echo(json.dumps({"tasks": tasks, "output": str(output)}, ensure_ascii=False, indent=2))


@app.command("ai-fact-review-import")
def ai_fact_review_import_command(
    input_dir: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    source: Annotated[Path, typer.Option("--source", exists=True, dir_okay=False)],
    responses: Annotated[list[Path], typer.Option("--responses", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    reviewed_at: Annotated[str | None, typer.Option("--reviewed-at")] = None,
) -> None:
    """Apply dual independent AI consensus to immutable dosage facts."""
    report = import_ai_fact_reviews(
        input_dir,
        source,
        responses,
        output,
        reviewed_at=reviewed_at,
    )
    typer.echo(
        json.dumps(report.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
    )


@app.command("knowledge-lint")
def knowledge_lint_command(
    input_dir: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
) -> None:
    """Validate knowledge ids, graph references, source chunks, and exact evidence quotes."""
    documents = load_workspace_documents(input_dir)
    workspace = load_knowledge_workspace(input_dir, documents)
    typer.echo(
        json.dumps(
            knowledge_summary(workspace).model_dump(by_alias=True, mode="json"),
            ensure_ascii=False,
            indent=2,
        )
    )


@app.command("knowledge-approve")
def knowledge_approve_command(
    source: Annotated[Path, typer.Option("--source", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    identifiers: Annotated[
        list[str], typer.Option("--id", help="Fact/relation/link id to approve")
    ],
    reviewer: Annotated[str, typer.Option("--reviewer")],
) -> None:
    """Record explicit human approval; AI imports can never mark records reviewed."""
    summary = approve_knowledge(source, output, set(identifiers), reviewer)
    typer.echo(
        json.dumps(summary.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
    )


@app.command()
def build(
    input_dir: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    json_output: Annotated[Path | None, typer.Option("--json-output")] = None,
    report: Annotated[Path | None, typer.Option("--report")] = None,
    edition_manifest: Annotated[Path | None, typer.Option("--edition-manifest")] = None,
    lexical_only: Annotated[bool, typer.Option("--lexical-only")] = False,
    include_unreviewed_knowledge: Annotated[
        bool,
        typer.Option(
            "--include-unreviewed-knowledge",
            help="Demo-only: include proposed knowledge in search projections.",
        ),
    ] = False,
    compact_search_text: Annotated[
        bool,
        typer.Option(
            "--compact-search-text",
            help=(
                "Finished module packs only: empty chunks.normalized_text after the final index "
                "rebuild (the pack can no longer be re-indexed or composed)."
            ),
        ),
    ] = False,
) -> None:
    """Build a SQLite pack and optional JSON seed from Markdown sources."""
    _, build_report = build_content_pack(
        input_dir,
        output,
        json_output,
        report,
        edition_manifest,
        include_embeddings=not lexical_only,
        include_unreviewed_knowledge=include_unreviewed_knowledge,
        compact_search_text=compact_search_text,
    )
    typer.echo(json.dumps(build_report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("compact-module-search")
def compact_module_search_command(
    source: Annotated[Path, typer.Option("--input", exists=True)],
    output: Annotated[Path, typer.Option("--output")],
    report: Annotated[Path, typer.Option("--report")],
) -> None:
    """External-content FTS and empty normalized_text for finished module packs (migration 013)."""
    pairs = (
        [(path, output / path.name) for path in sorted(source.glob("*.db"))]
        if source.is_dir()
        else [(source, output)]
    )
    if not pairs:
        raise typer.BadParameter(f"No .db files in {source}")
    results = [migrate_module_search(path, target) for path, target in pairs]
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(
        json.dumps({"migration": MIGRATION_ID, "modules": results}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    typer.echo(f"{len(results)} pack(s) compacted → {output}")


@app.command("upgrade-mkb-reference")
def upgrade_mkb_reference_command(
    source: Annotated[Path, typer.Option("--source", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    report: Annotated[Path | None, typer.Option("--report")] = None,
) -> None:
    """Apply the MKB reference-tier upgrade to an existing SQLite pack."""
    upgrade_report = upgrade_mkb_reference_database(source, output)
    if report:
        write_upgrade_report(report, upgrade_report)
    typer.echo(json.dumps(upgrade_report, ensure_ascii=False, indent=2))


@app.command("compose")
def compose_command(
    inputs: Annotated[
        list[Path],
        typer.Option("--input", exists=True, help="SQLite database or directory of databases"),
    ],
    output: Annotated[Path, typer.Option("--output")],
    edition_manifest: Annotated[Path, typer.Option("--edition-manifest")],
    edition_id: Annotated[str, typer.Option("--edition-id")],
    edition_version: Annotated[str, typer.Option("--edition-version")],
    title: Annotated[str, typer.Option("--title")],
    built_at: Annotated[str, typer.Option("--built-at")],
    schema_version: Annotated[int, typer.Option("--schema-version", min=1)] = 2,
    compact: Annotated[bool, typer.Option("--compact")] = False,
    resume: Annotated[bool, typer.Option("--resume")] = False,
) -> None:
    """Compose existing compatible SQLite packs into one local-development edition."""
    report = compose_sqlite_packs(
        inputs,
        output,
        edition_manifest,
        edition_id=edition_id,
        edition_version=edition_version,
        title=title,
        built_at=built_at,
        schema_version=schema_version,
        compact=compact,
        resume=resume,
    )
    typer.echo(json.dumps(report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


@app.command("lint")
def lint_command(
    input_dir: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
) -> None:
    """Validate source metadata, knowledge evidence, stable identifiers, anchors, and chunks."""
    errors = lint_content_pack(load_content_pack(input_dir))
    if errors:
        for error in errors:
            typer.echo(error, err=True)
        raise typer.Exit(code=1)
    typer.echo("ok")


@app.command()
def inspect(
    database: Annotated[Path, typer.Option("--database", exists=True, dir_okay=False)],
    document_id: Annotated[str, typer.Argument()],
) -> None:
    """Print a document section tree and chunk anchors from a built pack."""
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """SELECT s.title, s.depth, s.anchor, c.id AS chunk_id, c.anchor AS chunk_anchor
            FROM sections s
            JOIN document_versions dv ON dv.id = s.document_version_id
            LEFT JOIN chunks c ON c.section_id = s.id
            WHERE dv.document_id = ?
            ORDER BY s.order_index, c.order_index""",
            (document_id,),
        ).fetchall()
    finally:
        connection.close()
    if not rows:
        raise typer.BadParameter(f"Document not found: {document_id}")
    for row in rows:
        indent = "  " * max(0, int(row["depth"]) - 1)
        typer.echo(f"{indent}{row['title']} [{row['anchor']}]")
        if row["chunk_id"]:
            typer.echo(f"{indent}  - {row['chunk_id']} [{row['chunk_anchor']}]")


@app.command()
def report(
    path: Annotated[Path, typer.Argument(exists=True, dir_okay=False)],
) -> None:
    """Pretty-print a saved build report."""
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))
