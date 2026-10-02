from __future__ import annotations

import json
from pathlib import Path

from localmed_ingest.grls_text_manifest import build_text_manifest

NATIVE_WORDS = "показания противопоказания дозирование побочные действия "


def write_workspace(root: Path, stem: str, checksum: str, mode: str, body: str) -> None:
    (root / ".localmed" / "diagnostics").mkdir(parents=True, exist_ok=True)
    (root / f"{stem}.md").write_text(f"---\nid: {stem}\n---\n{body}\n", encoding="utf-8")
    diagnostics: dict[str, object] = {
        "sourceChecksum": checksum,
        "pageCount": 2,
        "characterCount": len(body),
        "textExtractionMode": mode,
        "qualityScore": 1.0,
        "requiresReview": mode == "ocr",
    }
    if mode == "ocr":
        diagnostics.update({"ocrEngine": "macos-vision", "ocrMeanConfidence": 0.9})
    (root / ".localmed" / "diagnostics" / f"{stem}.json").write_text(json.dumps(diagnostics))


def test_manifest_keeps_ocr_flag_and_reports_coverage(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    for index in range(4):
        write_workspace(
            workspace, f"native{index}", f"sha256:n{index}", "pdf_text_layer", NATIVE_WORDS * 5
        )
    write_workspace(workspace, "scan", "sha256:scan", "ocr", NATIVE_WORDS + "пок4зания дoзирование")
    plan = tmp_path / "plan.json"
    names = ["N0", "N1", "N2", "N3", "SCAN", "MISSING"]
    plan.write_text(
        json.dumps(
            {
                "catalogEdition": "02.10.2026",
                "catalogChecksum": "sha256:p",
                "items": [
                    {
                        "registrationNumber": name,
                        "target": f"pdf/{name}.pdf",
                        "requestedRegistrationNumbers": [name, name + "-EAEU"],
                    }
                    for name in names
                ],
                "deferredItems": [{"registrationNumber": "OLD", "deferredReason": "legacy"}],
            }
        )
    )
    checksums = {"N0": "n0", "N1": "n1", "N2": "n2", "N3": "n3", "SCAN": "scan"}
    state = tmp_path / "state.jsonl"
    lines = [
        {
            "registrationNumber": name,
            "state": "success",
            "pdfSha256": f"sha256:{checksum}",
            "target": f"pdf/{name}.pdf",
            "recordedAt": "2026-10-02T06:00:00Z",
        }
        for name, checksum in checksums.items()
    ]
    lines.append(
        {
            "registrationNumber": "MISSING",
            "state": "failed",
            "error": "<urlopen error timed out>",
            "recordedAt": "2026-10-02T06:00:00Z",
        }
    )
    state.write_text("".join(json.dumps(line) + "\n" for line in lines))

    report = build_text_manifest(
        [plan], state, tmp_path, [workspace], tmp_path / "manifest.jsonl", tmp_path / "report.json"
    )
    rows = {
        json.loads(line)["registrationNumber"]: json.loads(line)
        for line in (tmp_path / "manifest.jsonl").read_text().splitlines()
    }
    assert rows["SCAN"]["ocr"] is True and rows["SCAN"]["ocrEngine"] == "macos-vision"
    assert rows["N0"]["ocr"] is False
    after = report["after"]
    assert isinstance(after, dict)
    assert after["texts"]["ocrShare"] == 0.2  # 1 of 5
    assert after["coverage"]["registrationsWithInstructionText"] == 10
    assert after["coverage"]["activeRegistrations"] == 13
    assert after["coverage"]["failuresByReason"]["transient"] == 1
