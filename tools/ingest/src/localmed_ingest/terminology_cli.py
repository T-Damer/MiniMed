"""Explicit collect -> prepare -> measure/build commands. No runtime or paid API side effects."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

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
    for_redistribution: Annotated[bool, typer.Option("--for-redistribution")] = False,
) -> None:
    result = build_terminology_packs(
        prepared,
        output,
        version=version,
        built_at=built_at,
        sections=section,
        include_core=include_core,
        for_redistribution=for_redistribution,
    )
    typer.echo(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    app()
