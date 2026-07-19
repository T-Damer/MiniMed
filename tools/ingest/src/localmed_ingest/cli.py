from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Annotated

import typer

from .builder import build_content_pack, lint_content_pack, load_content_pack
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
    """Validate source metadata, stable identifiers, anchors, and chunks."""
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
