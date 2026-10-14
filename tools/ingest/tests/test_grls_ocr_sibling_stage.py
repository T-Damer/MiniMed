from __future__ import annotations

from pathlib import Path
from typing import Any

from localmed_ingest.grls_ocr_requality import plain_text, split_markdown
from localmed_ingest.grls_ocr_sibling_stage import (
    native_index,
    sibling_markdown,
    sibling_replacement,
)

TEXT = (
    "Препарат принимают внутрь после еды по 500 мг два раза в сутки. "
    "Максимальная суточная доза 2000 мг. Курс лечения 14 дней. "
    "Хранить при температуре не выше 25 °С в защищённом от света месте. "
) * 12
HEAD = (
    "---\nid: {id}\ntitle: 'Тест'\nsource_checksum: {sha}\nmetadata:\n"
    "  tradeName: Тест\n  inn: Тестовое\n  holder: ООО Тест\n  dosageForm: таблетки\n"
    "  pdfSha256: {sha}\n  extraction:\n    format: pdf\n    pageCount: 4\n    ocrQuality: low\n---\n"
)


def write(tmp_path: Path, name: str, sha: str, body: str) -> Path:
    path = tmp_path / f"{name}.md"
    path.write_text(HEAD.format(id=name, sha=sha) + body, encoding="utf-8")
    return path


def manifest_row(source_id: str, sha: str, *, ocr: bool, words: int = 800) -> dict[str, Any]:
    return {
        "sourceId": source_id,
        "pdfSha256": sha,
        "workspace": "w",
        "extraction": "prepared",
        "ocr": ocr,
        "searchable": True,
        "documentKind": "national-instruction",
        "wordCount": words,
    }


def test_native_index_holds_native_instructions_only_by_product_key(tmp_path: Path) -> None:
    write(tmp_path, "native", "sha256:n", "\n# Текст\n\n" + TEXT)
    write(tmp_path, "scan", "sha256:s", "\n# Текст\n\n" + TEXT)
    rows = [
        manifest_row("native", "sha256:n", ocr=False),
        manifest_row("scan", "sha256:s", ocr=True),
        manifest_row("short", "sha256:x", ocr=False, words=100),
    ]
    # the workspace is resolved against <root>/tools/ingest/<workspace>
    root = tmp_path / "root"
    workspace = root / "tools" / "ingest" / "w"
    workspace.mkdir(parents=True)
    for name in ("native", "scan"):
        (workspace / f"{name}.md").write_text(
            (tmp_path / f"{name}.md").read_text(encoding="utf-8"), encoding="utf-8"
        )
    index = native_index(rows, root)
    (key,) = index
    assert key == ("тест", "тестовое", "ооо тест", "таблетки")
    assert [c.source_id for c in index[key]] == ["native"]


def test_the_same_text_replaces_ocr_and_keeps_the_scan_identity(tmp_path: Path) -> None:
    native = write(tmp_path, "native", "sha256:n", "\n# Текст\n\n" + TEXT)
    scan = write(tmp_path, "scan", "sha256:s", "\n# Текст\n\n" + TEXT.replace("беременности", "x"))
    root = tmp_path / "root"
    workspace = root / "tools" / "ingest" / "w"
    workspace.mkdir(parents=True)
    (workspace / "native.md").write_text(native.read_text(encoding="utf-8"), encoding="utf-8")
    (candidate,) = native_index([manifest_row("native", "sha256:n", ocr=False)], root).popitem()[1]
    match = sibling_replacement(scan.read_text(encoding="utf-8"), [candidate])
    assert match is not None
    chosen, comparison = match
    result = sibling_markdown(scan.read_text(encoding="utf-8"), chosen, comparison)
    front, body = split_markdown(result)
    assert front["id"] == "scan" and front["source_checksum"] == "sha256:s"
    extraction = front["metadata"]["extraction"]
    assert extraction["textSource"] == "sibling-text-layer"
    assert extraction["textSourcePdfSha256"] == "sha256:n"
    assert extraction["textSourceDocumentId"] == "native"
    assert extraction["replacesOcr"]["ocrQuality"] == "low"
    assert extraction["textExtractionMode"] == "pdf_text_layer"
    assert (
        plain_text(body).strip() == TEXT.strip().replace("\n", " ")
        or "Курс лечения 14 дней" in body
    )


def test_a_different_dose_is_not_replaced(tmp_path: Path) -> None:
    native = write(tmp_path, "native", "sha256:n", "\n# Текст\n\n" + TEXT)
    scan = write(
        tmp_path,
        "scan",
        "sha256:s",
        "\n# Текст\n\n" + TEXT.replace("500 мг", "250 мг").replace("2000", "1000"),
    )
    root = tmp_path / "root"
    workspace = root / "tools" / "ingest" / "w"
    workspace.mkdir(parents=True)
    (workspace / "native.md").write_text(native.read_text(encoding="utf-8"), encoding="utf-8")
    candidates = native_index([manifest_row("native", "sha256:n", ocr=False)], root).popitem()[1]
    assert sibling_replacement(scan.read_text(encoding="utf-8"), candidates) is None
