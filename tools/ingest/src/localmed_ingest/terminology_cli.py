"""Explicit collect -> prepare -> measure/build commands. No runtime or paid API side effects."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from .sqlite_composer import compose_sqlite_packs
from .terminology_mentions import write_occurrence_index
from .terminology_packs import build_terminology_packs
from .terminology_prepare import prepare_terminology
from .terminology_sources import collect_terminology

app = typer.Typer(
    no_args_is_help=True, help="Source-backed medical terminology; no LLM or runtime edits."
)


@app.callback()
def main() -> None:
    """Collect and prepare a separately measured terminology edition."""


@app.command("collect")
def collect_command(
    output: Annotated[Path, typer.Option("--output")],
    cache: Annotated[Path, typer.Option("--cache")],
    year: Annotated[int, typer.Option("--year")] = 2026,
    network: Annotated[bool, typer.Option("--network")] = False,
    with_wikidata: Annotated[bool, typer.Option("--with-wikidata")] = False,
    offline: Annotated[bool, typer.Option("--offline")] = False,
) -> None:
    result = collect_terminology(
        output, cache, year=year, network=network, with_wikidata=with_wikidata, offline=offline
    )
    typer.echo(
        json.dumps({"sources": len(result.sources), "output": str(output)}, ensure_ascii=False)
    )


@app.command("prepare")
def prepare_command(
    source: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    result = prepare_terminology(source, output)
    typer.echo(json.dumps(result, ensure_ascii=False, indent=2))


@app.command("build")
def build_command(
    prepared: Annotated[Path, typer.Option("--input", exists=True, file_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    version: Annotated[str, typer.Option("--version")],
    built_at: Annotated[str, typer.Option("--built-at")],
    section: Annotated[list[str] | None, typer.Option("--section")] = None,
    include_core: Annotated[bool, typer.Option("--core/--no-core")] = True,
    discovery_only: Annotated[bool, typer.Option("--discovery-only")] = False,
    for_redistribution: Annotated[bool, typer.Option("--for-redistribution")] = False,
) -> None:
    if discovery_only and (section or not include_core):
        raise typer.BadParameter("--discovery-only cannot be combined with --section or --no-core")
    result = build_terminology_packs(
        prepared,
        output,
        version=version,
        built_at=built_at,
        sections=[] if discovery_only else section,
        include_core=include_core,
        for_redistribution=for_redistribution,
    )
    typer.echo(json.dumps(result, ensure_ascii=False, indent=2))


@app.command("index-mentions")
def index_mentions_command(
    terminology: Annotated[Path, typer.Option("--terminology", exists=True, dir_okay=False)],
    source_pack: Annotated[list[Path], typer.Option("--source-pack", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Write exact first source-label occurrences, without editing any input pack."""
    typer.echo(json.dumps(write_occurrence_index(terminology, source_pack, output), indent=2))


@app.command("integrate")
def integrate_command(
    core: Annotated[Path, typer.Option("--core", exists=True, dir_okay=False)],
    discovery: Annotated[Path, typer.Option("--discovery", exists=True, dir_okay=False)],
    output: Annotated[Path, typer.Option("--output")],
    manifest: Annotated[Path, typer.Option("--manifest")],
    version: Annotated[str, typer.Option("--version")],
    built_at: Annotated[str, typer.Option("--built-at")],
    source_pack: Annotated[
        list[Path] | None, typer.Option("--source-pack", exists=True, dir_okay=False)
    ] = None,
) -> None:
    """Compose an unpublished discovery core; no active catalog or download URL changes."""
    if output.exists() or manifest.exists():
        raise typer.BadParameter("Choose new output paths; existing editions are immutable.")
    result = compose_sqlite_packs(
        [core, discovery],
        output,
        manifest,
        edition_id="minimed.terminology.core",
        edition_version=version,
        title="MiniMed — core with source-backed terminology",
        built_at=built_at,
        terminology_sources=source_pack or [core],
        compact=True,
    )
    typer.echo(result.model_dump_json(by_alias=True, indent=2))


if __name__ == "__main__":
    app()
