"""Command line of the full-text pipeline for the regulatory acts (LEGAL1).

    medbase-legal-texts sources   --data-root /path/to/MiniMed/data     # record + checksum of every official file
    medbase-legal-texts reconcile --data-root … [STEM …]                # flagged pages per act (reports/)
    medbase-legal-texts images    --data-root … STEM --pages 3,5        # PNG of pages for the image review
    medbase-legal-texts assemble  --data-root … [STEM …] [--strict]    # cards + provenance
    medbase-legal-texts check                                           # gate on the committed texts

`--data-root` is the main checkout's gitignored `data/` (read by absolute path, never linked into a worktree).
A STEM names an act's files: the portal `eoNumber`, or `minzdrav-<number>` for a file from minzdrav.gov.ru.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, Final, NoReturn

import typer

from .legal_cards import assemble_card
from .legal_reconcile import act_identity
from .legal_text_sources import docx_to_markdown, ips_html_to_markdown, rg_html_to_markdown
from .legal_texts import (
    ActText,
    Review,
    build_act_text,
    build_text_source_act,
    read_marker_pages,
    read_vision_pages,
    reconcile_act,
)
from .regulatory_verify import load_cards

REPO: Final = Path(__file__).resolve().parents[4]
CARDS: Final = REPO / "content/regulatory-rf-pilot"
TEXTS: Final = REPO / "content/regulatory-rf-texts"
SOURCES: Final = TEXTS / "sources.json"
SCAN_READERS: Final = frozenset({"scan", "tiff-zip"})
READERS: Final = {
    "layer": "PDF text layer and ruled tables (PyMuPDF), reconciled page by page with macOS Vision OCR (1800 px)",
    "docx": "Word file of minzdrav.gov.ru (text, no OCR)",
    "rg": "HTML of rg.ru (text, no OCR)",
    "ips": "HTML of the IPS of pravo.gov.ru, consolidated edition (text, no OCR)",
}
READER: Final = "Marker 2.0.0 (fast) reconciled page by page with macOS Vision OCR (1800 px)"

_STATIC: Final = "https://static-0.minzdrav.gov.ru/system/attachments/attaches"
MANUAL_ACTS: Final[dict[str, dict[str, str]]] = {
    "521н": {
        "stem": "minzdrav-521n",
        "file": "minzdrav-521n.pdf",
        "reader": "scan",
        "layer": "yes",
        "fileUrl": f"{_STATIC}/000/028/224/original/",
        "name": "Об утверждении Порядка оказания медицинской помощи детям с инфекционными заболеваниями",
    },
    "366н": {
        "stem": "minzdrav-366n",
        "file": "minzdrav-366n.pdf",
        "reader": "scan",
        "layer": "yes",
        "fileUrl": f"{_STATIC}/000/028/303/original/",
        "name": "Об утверждении Порядка оказания педиатрической помощи",
    },
    "157-ФЗ": {
        "stem": "ips-157fz",
        "file": "ips-157fz.html",
        "reader": "ips",
        "fileUrl": "http://pravo.gov.ru/proxy/ips/?doc_itself=&nd=102055517&page=1&rdk=26",
        "name": "Об иммунопрофилактике инфекционных болезней",
        "kind": "Федеральный закон",
        "textNote": "Текст — редакция Официального интернет-портала правовой информации pravo.gov.ru с изменениями по № 635-ФЗ от 25.12.2023; принятые позднее изменения в него не включены.",
    },
    "255-ФЗ": {
        "stem": "rg-255fz",
        "file": "rg-255fz.html",
        "reader": "rg",
        "fileUrl": "https://rg.ru/documents/2006/12/31/beremennost-dok.html",
        "name": "Об обеспечении пособиями по временной нетрудоспособности, по беременности и родам граждан, подлежащих обязательному социальному страхованию",
        "kind": "Федеральный закон",
        "textNote": "Текст — первоначальная публикация в «Российской газете» от 31.12.2006; последующие изменения в него не внесены.",
    },
    "323-ФЗ": {
        "stem": "rg-323fz",
        "file": "rg-323fz.html",
        "reader": "rg",
        "fileUrl": "https://rg.ru/documents/2011/11/23/zdorovie-dok.html",
        "name": "Об основах охраны здоровья граждан в Российской Федерации",
        "kind": "Федеральный закон",
        "textNote": "Текст — первоначальная публикация в «Российской газете» от 23.11.2011, совпадающая с официальной публикацией на publication.pravo.gov.ru; последующие изменения в него не внесены.",
    },
    "1346н": {
        "stem": "minzdrav-1346n",
        "file": "minzdrav-1346n.docx",
        "reader": "docx",
        "fileUrl": f"{_STATIC}/000/012/460/original/Prikaz__1346n.docx",
        "name": "О Порядке прохождения несовершеннолетними медицинских осмотров, в том числе при поступлении в образовательные учреждения и в период обучения в них",
    },
}

app = typer.Typer(no_args_is_help=True, help=__doc__)


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def raw(self) -> Path:
        return self.root / "raw/regulatory-sources"

    @property
    def work(self) -> Path:
        return self.root / "build/marker-legal"


DataRoot = Annotated[Path, typer.Option("--data-root", help="the main checkout's data/ directory")]


def _fail(message: str) -> NoReturn:
    typer.echo(message, err=True)
    raise typer.Exit(1)


def _load_sources() -> dict[str, Any]:
    return json.loads(SOURCES.read_text(encoding="utf-8"))


def _review(slug: str) -> Review:
    path = TEXTS / f"{slug}.review.json"
    return (
        Review.from_json(json.loads(path.read_text(encoding="utf-8")))
        if path.exists()
        else Review()
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@app.command()
def sources(data_root: DataRoot, pause: float = 1.0) -> None:
    """Write sources.json: portal record, file name, SHA-256 and size of each official file on disk."""
    import time

    from .medical_form_updates import PortalClient

    paths = Paths(data_root)
    client = PortalClient()
    previous = _load_sources()["acts"] if SOURCES.exists() else []
    manual = {row["documentId"]: row for row in previous if row.get("kind") != "portal"}
    rows: list[dict[str, Any]] = []
    for card in load_cards():
        meta = card["metadata"]
        eo = str(meta.get("officialPublicationNumber", ""))
        slug = Path(card["path"]).stem
        if re.fullmatch(r"\d{16}", eo) and str(meta["documentNumber"]) not in MANUAL_ACTS:
            record = client.document(eo)
            time.sleep(pause)
            file = next(paths.raw.glob(f"{eo}.*"), None)
            if file is None:
                raise typer.BadParameter(f"{eo}: no file in {paths.raw}")
            rows.append(
                {
                    "documentId": card["id"],
                    "card": card["path"],
                    "slug": slug,
                    "stem": eo,
                    "kind": "portal",
                    "reader": "scan" if file.suffix == ".pdf" else "tiff-zip",
                    "file": file.name,
                    "sha256": _sha256(file),
                    "bytes": file.stat().st_size,
                    "officialUrl": meta["officialSourceUrl"],
                    "record": {
                        key: record.get(key)
                        for key in (
                            "eoNumber",
                            "number",
                            "documentDate",
                            "name",
                            "complexName",
                            "jdRegNumber",
                            "jdRegDate",
                            "pagesCount",
                            "publishDateShort",
                        )
                    },
                }
            )
        elif str(meta["documentNumber"]) in MANUAL_ACTS:
            spec = MANUAL_ACTS[str(meta["documentNumber"])]
            file = paths.raw / spec["file"]
            issuer = str(meta["issuer"])
            date = str(meta["signedAt"])
            year, month, day = date.split("-")
            reg_date = meta.get("minjustRegistrationDate")
            rows.append(
                {
                    "documentId": card["id"],
                    "card": card["path"],
                    "slug": slug,
                    "stem": spec["stem"],
                    "kind": "minzdrav",
                    **({"textNote": spec["textNote"]} if "textNote" in spec else {}),
                    "reader": spec["reader"],
                    **({"markerSource": "pdf-layer"} if spec.get("layer") else {}),
                    "file": spec["file"],
                    "sha256": _sha256(file),
                    "bytes": file.stat().st_size,
                    "officialUrl": meta["officialSourceUrl"],
                    "fileUrl": spec["fileUrl"],
                    "record": {
                        "number": meta["documentNumber"],
                        "documentDate": f"{date}T00:00:00",
                        "name": spec["name"],
                        "complexName": (
                            f"{spec['kind']} от {day}.{month}.{year} № {meta['documentNumber']}"
                            if "kind" in spec
                            else f"Приказ {issuer.replace('Министерство', 'Министерства')} от {day}.{month}.{year} № {meta['documentNumber']}"
                        ),
                        "jdRegNumber": meta.get("minjustRegistrationNumber"),
                        "jdRegDate": f"{reg_date}T00:00:00" if reg_date else None,
                    },
                }
            )
        elif card["id"] in manual:
            rows.append(manual[card["id"]])
    kept = {row["documentId"]: row for row in previous}
    for (
        row
    ) in rows:  # what other commands recorded about an act survives a refresh of the checksums
        for key in ("rotatedPages", "rotatedPagesManual", "labelRows"):
            if key in kept.get(row["documentId"], {}):
                row[key] = kept[row["documentId"]][key]
    SOURCES.parent.mkdir(parents=True, exist_ok=True)
    SOURCES.write_text(
        json.dumps({"schemaVersion": 1, "acts": rows}, ensure_ascii=False, indent=1) + "\n"
    )
    typer.echo(f"{len(rows)} acts with a recorded official file -> {SOURCES}")


def rotated_pages(vision: dict[int, list[dict[str, Any]]]) -> list[int]:
    """Pages whose text lines are mostly taller than wide: a landscape table scanned sideways."""
    found: list[int] = []
    for page, lines in vision.items():
        long_lines = [x for x in lines if len(str(x["text"])) > 6]
        tall = [x for x in long_lines if x["bbox"][3] > x["bbox"][2] * 1.2]
        if len(long_lines) >= 3 and len(tall) >= 0.6 * len(long_lines):
            found.append(page)
    return sorted(found)


@app.command()
def upright(
    data_root: DataRoot, names: Annotated[list[str] | None, typer.Argument()] = None
) -> None:
    """Find sideways pages, write an upright copy of the PDF (derived/<stem>-upright.pdf) and read it with Vision.

    Marker and Vision both read a table scanned sideways badly; the upright copy is what they read instead.
    The page numbers are those of the original; `rotatedPages` is recorded in sources.json.
    """
    import json as _json
    import subprocess

    import pymupdf

    paths = Paths(data_root)
    sources_doc = _load_sources()
    wanted = set(names or [])
    for row in sources_doc["acts"]:
        if row["reader"] not in SCAN_READERS or (
            wanted and not {row["stem"], row["slug"]} & wanted
        ):
            continue
        raw = _json.loads((paths.work / f"vision/{row['stem']}.json").read_text())
        vision = {int(p["page"]): p["lines"] for p in raw["pages"]}
        # `rotatedPagesManual`: sideways pages with too little text for the detector (read by eye from the image)
        sideways = sorted({*rotated_pages(vision), *row.get("rotatedPagesManual", [])})
        row["rotatedPages"] = sideways
        if not sideways:
            continue
        derived = paths.work / "derived"
        derived.mkdir(parents=True, exist_ok=True)
        source = (
            paths.work / f"derived/{row['stem']}.pdf"
            if row["reader"] == "tiff-zip"
            else paths.raw / row["file"]
        )
        document = pymupdf.open(source)
        for number in sideways:
            page = document[number - 1]
            page.set_rotation((page.rotation + 90) % 360)
        target = derived / f"{row['stem']}-upright.pdf"
        document.save(target)
        result = subprocess.run(
            [str(paths.work / "bin/vision_ocr"), str(target)], capture_output=True, check=True
        )
        (paths.work / f"vision/{row['stem']}-upright.json").write_bytes(result.stdout)
        typer.echo(f"{row['slug']}: {len(sideways)} sideways pages {sideways}")
    SOURCES.write_text(_json.dumps(sources_doc, ensure_ascii=False, indent=1) + "\n")


@app.command()
def unlabel(
    data_root: DataRoot, names: Annotated[list[str] | None, typer.Argument()] = None
) -> None:
    """Paint the label column of the two-column requirement tables white and read the copy with Vision.

    The copy is `derived/<stem>-nolabel.pdf`, its Vision reading `vision/<stem>-nolabel.json`; Marker reads
    the copy as the job `<stem>-nolabel` (see `legal_unlabel`). Acts are those with `labelRows` in sources.json.
    """
    import subprocess

    from .legal_unlabel import paint_labels

    paths = Paths(data_root)
    for row in _load_sources()["acts"]:
        if not row.get("labelRows") or (names and not {row["stem"], row["slug"]} & set(names)):
            continue
        derived = paths.work / "derived"
        derived.mkdir(parents=True, exist_ok=True)
        source = paths.raw / row["file"]
        # a rotated scan is painted in its upright copy
        upright = derived / f"{row['stem']}-upright.pdf"
        base = upright if upright.exists() and row.get("rotatedPages") else source
        target = derived / f"{row['stem']}-nolabel.pdf"
        vision_in = (
            paths.work / f"vision/{row['stem']}-upright.json"
            if base == upright
            else paths.work / f"vision/{row['stem']}.json"
        )
        column = row.get("labelColumn", {})
        foreign = paint_labels(
            base,
            vision_in,
            target,
            left=column.get("left", 0.15),
            right=column.get("right", 0.305),
        )
        result = subprocess.run(
            [str(paths.work / "bin/vision_ocr"), str(target)], capture_output=True, check=True
        )
        (paths.work / f"vision/{row['stem']}-nolabel.json").write_bytes(result.stdout)
        typer.echo(
            f"{row['slug']}: painted copy {target.name}; left-edge lines that are not labels:"
        )
        for page, lines in sorted(foreign.items()):
            typer.echo(f"  page {page}: {lines}")


@app.command("fetch-text")
def fetch_text(data_root: DataRoot) -> None:
    """Download the text sources (rg.ru HTML, IPS HTML) that are not scans; the checksum goes into sources.json."""
    import urllib.request

    paths = Paths(data_root)
    paths.raw.mkdir(parents=True, exist_ok=True)
    for spec in MANUAL_ACTS.values():
        if spec["reader"] not in ("rg", "ips"):
            continue
        request = urllib.request.Request(spec["fileUrl"], headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data: bytes = response.read()
        (paths.raw / spec["file"]).write_bytes(data)
        typer.echo(f"{spec['file']}: {len(data)} bytes")


@app.command()
def cells(data_root: DataRoot, names: Annotated[list[str] | None, typer.Argument()] = None) -> None:
    """Read the cells of every ruled table of a scanned act one by one with Vision (see `legal_cells`).

    Writes `derived/<stem>-cells.pdf` (one page per cell), `vision/<stem>-cells.json` (Vision's reading of it)
    and `vision/<stem>-cells-layout.json` (the cells of each page). `reconcile` and `assemble` then take the
    cell reading as the second reading of those pages.
    """
    import subprocess

    import pymupdf

    from .legal_cells import MIN_INK, cells_pdf, retry_pdf

    paths = Paths(data_root)
    for row in _load_sources()["acts"]:
        if row["reader"] not in SCAN_READERS or (
            names and not {row["stem"], row["slug"]} & set(names)
        ):
            continue
        stem = row["stem"]
        derived = paths.work / "derived"
        derived.mkdir(parents=True, exist_ok=True)
        plain = paths.raw / row["file"]
        if row["reader"] == "tiff-zip":
            plain = derived / f"{stem}.pdf"
        upright_path = derived / f"{stem}-upright.pdf"
        sideways = set(row.get("rotatedPages", [])) if upright_path.exists() else set()
        documents = {"plain": pymupdf.open(plain)}
        if sideways:
            documents["upright"] = pymupdf.open(upright_path)
        pages = list(range(1, len(documents["plain"]) + 1))
        target = derived / f"{stem}-cells.pdf"
        layout, order = cells_pdf(
            _page_source(documents, sideways),
            pages,
            target,
        )
        result = subprocess.run(
            [str(paths.work / "bin/vision_ocr"), str(target)], capture_output=True, check=True
        )
        (paths.work / f"vision/{stem}-cells.json").write_bytes(result.stdout)
        first = json.loads(result.stdout)["pages"]
        # a cell with ink that Vision read as empty (a lone digit) is cropped again in several ways
        empty = [
            (number, index)
            for entry, (number, index) in zip(first, order, strict=True)
            if not entry.get("lines") and layout[number]["cells"][index]["ink"] >= MIN_INK
        ]
        retry_order: list[tuple[int, int]] = []
        if empty:
            retry_target = derived / f"{stem}-cells-retry.pdf"
            retry_order = retry_pdf(_page_source(documents, sideways), layout, empty, retry_target)
            again = subprocess.run(
                [str(paths.work / "bin/vision_ocr"), str(retry_target)],
                capture_output=True,
                check=True,
            )
            (paths.work / f"vision/{stem}-cells-retry.json").write_bytes(again.stdout)
            retry_target.unlink()
        (paths.work / f"vision/{stem}-cells-layout.json").write_text(
            json.dumps(
                {
                    "order": [list(item) for item in order],
                    "retryOrder": [list(item) for item in retry_order],
                    "layout": layout,
                },
                ensure_ascii=False,
            )
        )
        target.unlink()
        typer.echo(
            f"{row['slug']}: {len(layout)} pages with a table, {len(order)} cells read,"
            f" {len(empty)} empty cells with ink cropped again"
        )


def _page_source(documents: dict[str, Any], sideways: set[int]) -> Callable[[int], Any]:
    """The document that holds a page upright: the upright copy for the sideways pages."""

    def source(number: int) -> Any:
        return documents["upright" if number in sideways else "plain"]

    return source


def _apply_cells(
    paths: Paths,
    row: dict[str, Any],
    vision: dict[int, list[str]],
    marker: dict[int, str | None],
) -> None:
    """Replace the second reading of each page that has a cell reading by «lines outside the table, cells, lines below»."""
    from .legal_cells import MIN_INK, harmonize, merge_lines, read_cells

    stem = row["stem"]
    layout_path = paths.work / f"vision/{stem}-cells-layout.json"
    cells_path = paths.work / f"vision/{stem}-cells.json"
    if not (layout_path.exists() and cells_path.exists()):
        return

    def raw(name: str) -> dict[int, list[dict[str, Any]]]:
        file = paths.work / f"vision/{name}.json"
        if not file.exists():
            return {}
        pages = json.loads(file.read_text(encoding="utf-8"))["pages"]
        return {int(page["page"]): page.get("lines", []) for page in pages}

    plain = raw(stem)
    upright = raw(f"{stem}-upright")
    sideways = set(row.get("rotatedPages", []))
    retry_path = paths.work / f"vision/{stem}-cells-retry.json"
    for page, (layout, texts) in read_cells(layout_path, cells_path, retry_path).items():
        lines = (upright if page in sideways else plain).get(page)
        if lines is not None:
            reading = marker.get(page)
            vision[page] = merge_lines(
                lines,
                layout,
                harmonize(reading, texts, [cell["ink"] >= MIN_INK for cell in layout["cells"]])
                if reading
                else texts,
            )


def _act(stem_or_slug: str) -> dict[str, Any]:
    for row in _load_sources()["acts"]:
        if stem_or_slug in (row["stem"], row["slug"]):
            return row
    raise typer.BadParameter(f"unknown act {stem_or_slug}")


def _inputs(
    paths: Paths, row: dict[str, Any]
) -> tuple[dict[int, str | None], dict[int, list[str]]]:
    stem = row["stem"]
    painted = row.get("labelRows") and (paths.work / f"marker/{stem}-nolabel").exists()
    vision = read_vision_pages(
        paths.work / (f"vision/{stem}-nolabel.json" if painted else f"vision/{stem}.json")
    )
    if row.get("markerSource") == "pdf-layer":
        from .legal_layer import document_pages

        layer = document_pages(str(paths.raw / row["file"]))
        marker: dict[int, str | None] = {page: layer.get(page) for page in vision}
    else:
        marker = read_marker_pages(paths.work / f"marker/{stem}", len(vision))
        if (
            painted
        ):  # the painted copy replaces the plain reading page by page (it is upright already)
            copy = read_marker_pages(paths.work / f"marker/{stem}-nolabel", len(vision))
            marker = {
                page: copy[page] if copy[page] is not None else text
                for page, text in marker.items()
            }
    sideways = [] if painted else row.get("rotatedPages", [])
    if sideways:  # a table scanned sideways is read from its upright copy
        upright = read_vision_pages(paths.work / f"vision/{stem}-upright.json")
        for page in sideways:
            vision[page] = upright[page]
            copy = paths.work / f"marker/{stem}-rot/p{page:04d}.md"
            marker[page] = copy.read_text(encoding="utf-8") if copy.exists() else None
    if not painted:
        _apply_cells(paths, row, vision, marker)
    return marker, vision


def _text_act(paths: Paths, row: dict[str, Any]) -> ActText:
    """The act of a text source (Word, rg.ru HTML, IPS HTML), read from its file with the recorded checksum."""
    file = paths.raw / row["file"]
    if _sha256(file) != row["sha256"]:
        raise typer.BadParameter(f"{row['file']} differs from the checksum in sources.json")
    identity = act_identity(row["record"])
    if row["reader"] == "docx":
        return build_text_source_act(
            docx_to_markdown(file.read_bytes()), identity, cut_header=False
        )
    if row["reader"] == "rg":
        return build_text_source_act(
            rg_html_to_markdown(file.read_text(encoding="utf-8")), identity, cut_header=False
        )
    if row["reader"] == "ips":
        html = file.read_bytes().decode("cp1251", errors="replace")
        return build_text_source_act(ips_html_to_markdown([html]), identity, cut_header=True)
    raise typer.BadParameter(f"unknown reader {row['reader']}")


def _exact(row: dict[str, Any]) -> bool:
    return row.get("markerSource") == "pdf-layer"


def _selected(names: list[str]) -> list[dict[str, Any]]:
    rows = _load_sources()["acts"]
    return [_act(n) for n in names] if names else list(rows)


@app.command()
def reconcile(
    data_root: DataRoot, names: Annotated[list[str] | None, typer.Argument()] = None
) -> None:
    """Reconcile the acts' pages and report the flagged ones (reports/<stem>.json under the work dir)."""
    paths = Paths(data_root)
    out = paths.work / "reports"
    out.mkdir(parents=True, exist_ok=True)
    for row in _selected(names or []):
        if row["reader"] not in SCAN_READERS:
            continue
        marker, vision = _inputs(paths, row)
        identity = act_identity(row["record"])
        results, pending = reconcile_act(
            marker, vision, identity, _review(row["slug"]), exact_primary=_exact(row)
        )
        flagged = [r for r in results if r.flags]
        report = {
            "stem": row["stem"],
            "pages": len(results),
            "pending": pending,
            "flagged": [
                {
                    "page": r.page,
                    "status": r.status,
                    "confidence": r.confidence,
                    "flags": [f.__dict__ for f in r.flags],
                }
                for r in flagged
            ],
        }
        (out / f"{row['stem']}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
        typer.echo(
            f"{row['slug']:55} pages {len(results):4} flagged {len(flagged):4} pending {len(pending):4}"
        )


@app.command()
def show(
    data_root: DataRoot,
    name: str,
    pages: Annotated[str, typer.Option(help="comma separated pages")],
    lines: Annotated[
        bool, typer.Option("--lines", help="numbered repr lines, to build exact corrections")
    ] = False,
    first: int = 0,
    last: int = 100000,
    no_images: bool = False,
) -> None:
    """Print flags and the reconciled text of pages, and render their images (for the image review)."""
    paths = Paths(data_root)
    row = _act(name)
    marker, vision = _inputs(paths, row)
    identity = act_identity(row["record"])
    wanted = {int(p) for p in pages.split(",")}
    results, _pending = reconcile_act(
        {p: t for p, t in marker.items() if p in wanted},
        {p: t for p, t in vision.items() if p in wanted},
        identity,
        Review(verdicts={p: "" for p in wanted}) if lines else Review(),
        exact_primary=_exact(row),
    )
    for result in results:
        typer.echo(f"=== page {result.page}: {result.status} {result.confidence} {result.reading}")
        for flag in result.flags:
            typer.echo(f"  ! {flag.kind}: {flag.detail}")
        if lines:
            for number, text in enumerate(result.text.split("\n")):
                if first <= number <= last:
                    typer.echo(f"{number} {text!r}")
        else:
            typer.echo(result.text)
    if not no_images:
        images(data_root, name, pages)


@app.command()
def ctx(
    data_root: DataRoot,
    name: str,
    pages: Annotated[str, typer.Option(help="comma separated pages")],
    width: int = 90,
) -> None:
    """Short review view: the flags of pages with the lines of both readings around each disputed token."""
    paths = Paths(data_root)
    row = _act(name)
    marker, vision = _inputs(paths, row)
    identity = act_identity(row["record"])
    wanted = {int(p) for p in pages.split(",")}
    results, _pending = reconcile_act(
        {p: t for p, t in marker.items() if p in wanted},
        {p: t for p, t in vision.items() if p in wanted},
        identity,
        Review(),
        exact_primary=_exact(row),
    )
    for result in results:
        typer.echo(f"=== page {result.page}: {result.confidence} {result.reading}")
        vlines = vision[result.page]
        for flag in result.flags:
            typer.echo(f"  ! {flag.kind}: {flag.detail[:300]}")
            tokens = (
                re.findall(r"(?:only in (?:Vision|Marker): )?([^;]+)", flag.detail)
                if flag.kind == "number-mismatch"
                else []
            )
            for chunk in tokens:
                for token in [t.strip().split("×")[0] for t in chunk.split(",")][:6]:
                    if not token or not re.fullmatch(r"[\d.,]+", token):
                        continue
                    for label, source in (("M", result.text.split("\n")), ("V", vlines)):
                        hits = [
                            line
                            for line in source
                            if re.search(rf"(?<![\d.,]){re.escape(token)}(?![\d])", line)
                        ]
                        for line in hits[:2]:
                            at = re.search(rf"(?<![\d.,]){re.escape(token)}(?![\d])", line)
                            start = max(0, (at.start() if at else 0) - width // 2)
                            typer.echo(f"      {token:>7} {label}: …{line[start : start + width]}")
    typer.echo(f"images: {paths.work}/images/{row['stem']}/ (run `images` for the pages)")


@app.command()
def images(
    data_root: DataRoot,
    name: str,
    pages: Annotated[str, typer.Option(help="comma separated 1-based pages")],
    width: int = 1300,
) -> None:
    """Render pages of an act's PDF to PNG for the image review (deleted when the review is done)."""
    import pymupdf

    paths = Paths(data_root)
    row = _act(name)
    out = paths.work / f"images/{row['stem']}"
    out.mkdir(parents=True, exist_ok=True)
    source = paths.raw / row["file"]
    if row["reader"] == "tiff-zip":
        source = paths.work / f"derived/{row['stem']}.pdf"
    document = pymupdf.open(source)
    upright_path = paths.work / f"derived/{row['stem']}-upright.pdf"
    upright = pymupdf.open(upright_path) if upright_path.exists() else None
    for number in sorted({int(p) for p in pages.split(",")}):
        page = (
            upright if upright is not None and number in row.get("rotatedPages", []) else document
        )[number - 1]
        zoom = width / page.rect.width
        page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).save(out / f"p{number:04d}.png")
        typer.echo(out / f"p{number:04d}.png")


@app.command()
def assemble(
    data_root: DataRoot,
    names: Annotated[list[str] | None, typer.Argument()] = None,
    strict: bool = False,
) -> None:
    """Write the full-text card and the provenance of each act; --strict refuses unreviewed flagged pages."""
    paths = Paths(data_root)
    TEXTS.mkdir(parents=True, exist_ok=True)
    for row in _selected(names or []):
        identity = act_identity(row["record"])
        review = _review(row["slug"])
        if row["reader"] in SCAN_READERS:
            marker, vision = _inputs(paths, row)
            results, pending = reconcile_act(
                marker, vision, identity, review, exact_primary=_exact(row)
            )
            if pending and strict:
                _fail(f"{row['slug']}: flagged pages without a review verdict: {pending}")
            act = build_act_text(results, identity, label_rows=tuple(row.get("labelRows", ())))
            if act.unfit:
                typer.echo(f"{row['slug']}: requirement blocks not labelled: {act.unfit}")
            page_count: int | None = len(results)
            flagged = sum(1 for r in results if r.flags)
            reviewed = sum(1 for r in results if r.status == "reviewed")
        else:
            act = _text_act(paths, row)
            page_count, flagged, reviewed = None, 0, 0
        card_path = CARDS / row["card"]
        old = card_path.read_text(encoding="utf-8")
        meta_text = old.partition("\n---\n")[0]
        amended = (
            "с изменениями" in meta_text
            and "первоначальная" not in meta_text.split("edition:")[-1][:80]
        )
        extra: dict[str, object] = {
            "textReading": READERS["layer"]
            if row.get("markerSource") == "pdf-layer"
            else READER
            if row["reader"] in SCAN_READERS
            else READERS[row["reader"]]
        }
        if page_count is not None:
            extra.update(
                {
                    "textPages": page_count,
                    "textFlaggedPages": flagged,
                    "textPagesReviewed": reviewed,
                }
            )
        card_path.write_text(
            assemble_card(
                old,
                act.body,
                pages=page_count,
                amended=amended,
                extra=extra,
                text_note=row.get("textNote"),
            ),
            encoding="utf-8",
        )
        provenance = {
            "documentId": row["documentId"],
            "source": {
                "file": row["file"],
                "sha256": row["sha256"],
                "bytes": row["bytes"],
                "pages": page_count,
                "officialUrl": row["officialUrl"],
            },
            "identityFromPortal": {
                "number": identity.number,
                "date": identity.date,
                "name": identity.name,
                "registrationNumber": identity.registration_number,
                "registrationDate": identity.registration_date,
            },
            "reader": READER,
            "review": {
                "reviewer": review.reviewer,
                "reviewedAt": review.reviewed_at,
                "corrections": len(review.corrections),
            },
            "pages": act.pages,
        }
        (TEXTS / f"{row['slug']}.provenance.json").write_text(
            json.dumps(provenance, ensure_ascii=False, indent=1) + "\n"
        )
        typer.echo(
            f"{row['slug']}: {page_count} pages, {flagged} flagged, {len(act.pending_pages)} pending"
        )


@app.command()
def check() -> None:
    """Gate: every text card has provenance with no pending page and a matching source checksum."""
    problems: list[str] = []
    for row in _load_sources()["acts"]:
        path = TEXTS / f"{row['slug']}.provenance.json"
        if not path.exists():
            problems.append(f"{row['slug']}: no provenance (full text not assembled)")
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["source"]["sha256"] != row["sha256"]:
            problems.append(f"{row['slug']}: provenance checksum differs from sources.json")
        for page in data["pages"]:
            if page["status"] == "review":
                problems.append(
                    f"{row['slug']} p.{page['page']}: flagged page without a review verdict"
                )
    if problems:
        _fail("\n".join(problems))
    typer.echo("all full texts have provenance and no pending page")


if __name__ == "__main__":
    app()
