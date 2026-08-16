import sqlite3
from pathlib import Path

from localmed_ingest.tool_modules import build_tool_module


def test_build_tool_module_keeps_tools_and_sources(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[3]
    output = tmp_path / "gastroenterology.db"

    report = build_tool_module(root / "content/tool-modules/gastroenterology.json", output)

    assert report["toolCount"] == 3
    assert report["sourceCount"] == 6
    with sqlite3.connect(output) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("SELECT count(*) FROM tool_definitions").fetchone() == (3,)
        assert connection.execute("SELECT count(*) FROM tool_sources").fetchone() == (6,)


def test_build_core_clinical_tool_module_keeps_all_calculators(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[3]
    output = tmp_path / "core-clinical.db"

    report = build_tool_module(root / "content/tool-modules/core-clinical.json", output)

    assert report["toolCount"] == 17
    assert report["sourceCount"] == 17
    with sqlite3.connect(output) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute(
            "SELECT count(*) FROM tool_definitions WHERE kind = 'calculator'"
        ).fetchone() == (17,)
