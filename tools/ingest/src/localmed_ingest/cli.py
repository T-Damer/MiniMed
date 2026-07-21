from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Annotated

import typer

from .builder import build_content_pack, lint_content_pack, load_content_pack
from .clinical_queries import import_real_pocqi_benchmark
from .drug_sources import collect_drug_sources
from .knowledge import (
    approve_knowledge,
    export_chatgpt_tasks,
    import_chatgpt_responses,
    knowledge_summary,
    load_knowledge_workspace,
    load_workspace_documents,
)
from .pdf_import import import_pdf
from .source_registry import prepare_registry
from .source_sync import sync_source_manifest
from .text_import import import_text

app = typer.Typer(no_args_is_help=True, help="Build and inspect LocalMed content packs.")


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
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 60.0,
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
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 60.0,
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
    timeout_seconds: Annotated[float, typer.Option("--timeout-seconds", min=1)] = 60.0,
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
) -> None:
    """Prepare private PDF/TXT sources as a build-ready Markdown workspace."""
    prepare_report = prepare_registry(registry, source_root, output, force=force)
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
) -> None:
    """Build a SQLite pack and optional JSON seed from Markdown sources."""
    _, build_report = build_content_pack(input_dir, output, json_output, report)
    typer.echo(json.dumps(build_report.model_dump(by_alias=True), ensure_ascii=False, indent=2))


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
