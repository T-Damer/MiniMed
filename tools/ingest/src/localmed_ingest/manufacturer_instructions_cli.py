from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, cast

import typer

from .manufacturer_instructions import (
    SITES,
    CrawlOptions,
    PoliteFetcher,
    crawl_site,
    holder_distribution,
    load_targets,
    rebuild_manifest,
    site_by_key,
)

app = typer.Typer(
    no_args_is_help=True,
    help="Official instructions from manufacturers' sites for registrations GRLS has not given us.",
)

_PLAN = Annotated[Path, typer.Option("--plan", exists=True, dir_okay=False)]
_STATE = Annotated[Path, typer.Option("--grls-state", exists=True, dir_okay=False)]
_CATALOG = Annotated[Path, typer.Option("--catalog", exists=True, dir_okay=False)]
_GRLS_RAW = Annotated[Path, typer.Option("--grls-raw-root", exists=True, file_okay=False)]


@app.command("missing-report")
def missing_report_command(
    plan: _PLAN,
    grls_state: _STATE,
    catalog: _CATALOG,
    grls_raw_root: _GRLS_RAW,
    output: Annotated[Path, typer.Option("--output")],
    top: Annotated[int, typer.Option("--top")] = 40,
) -> None:
    """Missing registrations (no GRLS PDF on disk) grouped by holder, with the coverage curve."""
    targets = load_targets(plan, grls_state, grls_raw_root, catalog)
    rows = holder_distribution(targets)
    total = len(targets)
    curve = {
        f"holdersFor{int(share * 100)}pct": next(
            (
                int(cast(int, row["rank"]))
                for row in rows
                if float(cast(float, row["cumulativeShare"])) >= share
            ),
            None,
        )
        for share in (0.5, 0.8, 0.9)
    }
    summary: dict[str, object] = {
        "missing": total,
        "essential": sum(target.essential for target in targets),
        "holders": len(rows),
        **curve,
        "topHolders": rows[:top],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    typer.echo(
        json.dumps({k: v for k, v in summary.items() if k != "topHolders"}, ensure_ascii=False)
    )


@app.command("crawl")
def crawl_command(
    plan: _PLAN,
    grls_state: _STATE,
    catalog: _CATALOG,
    grls_raw_root: _GRLS_RAW,
    site: Annotated[list[str], typer.Option("--site", help="Site key; repeatable.")],
    raw_root: Annotated[Path, typer.Option("--raw-root")] = Path(
        "data/raw/manufacturer-instructions"
    ),
    max_documents: Annotated[int, typer.Option("--max-documents", min=1)] = 100,
    delay: Annotated[
        float, typer.Option("--delay", min=2.0, help="Seconds between requests per host.")
    ] = 4.0,
) -> None:
    """Resumable crawl of the listed manufacturer sites; one request at a time per host."""
    targets = load_targets(plan, grls_state, grls_raw_root, catalog)
    fetcher = PoliteFetcher(min_delay=delay)
    options = CrawlOptions(raw_root=raw_root, max_documents=max_documents)
    for key in site:
        typer.echo(f"{key}: {json.dumps(crawl_site(site_by_key(key), targets, fetcher, options))}")


@app.command("sites")
def sites_command() -> None:
    """List the configured per-holder adapters."""
    for entry in SITES:
        typer.echo(f"{entry.key}\t{entry.name}\t{entry.base}")


@app.command("rebuild-manifest")
def rebuild_manifest_command(
    plan: _PLAN,
    grls_state: _STATE,
    catalog: _CATALOG,
    grls_raw_root: _GRLS_RAW,
    raw_root: Annotated[Path, typer.Option("--raw-root")] = Path(
        "data/raw/manufacturer-instructions"
    ),
) -> None:
    """Offline: re-match every downloaded document and rewrite manifest.jsonl."""
    targets = load_targets(plan, grls_state, grls_raw_root, catalog)
    summary = rebuild_manifest(targets, CrawlOptions(raw_root=raw_root))
    typer.echo(json.dumps(summary, ensure_ascii=False))
