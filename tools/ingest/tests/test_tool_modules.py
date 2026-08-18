import sqlite3
from pathlib import Path

from localmed_ingest.tool_modules import build_tool_module, load_tool_module


def test_build_tool_module_keeps_tools_and_sources(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[3]
    source = root / "content/tool-modules/gastroenterology.json"
    module, _checksum = load_tool_module(source)
    output = tmp_path / "gastroenterology.db"
    tool_count = len(module.tools)
    source_count = sum(len(tool.sources) for tool in module.tools)

    report = build_tool_module(source, output)

    assert tool_count >= 3
    assert report["toolCount"] == tool_count
    assert report["sourceCount"] == source_count
    with sqlite3.connect(output) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute("SELECT count(*) FROM tool_definitions").fetchone() == (
            tool_count,
        )
        assert connection.execute("SELECT count(*) FROM tool_sources").fetchone() == (source_count,)


def test_build_core_clinical_tool_module_keeps_all_calculators(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[3]
    source = root / "content/tool-modules/core-clinical.json"
    module, _checksum = load_tool_module(source)
    output = tmp_path / "core-clinical.db"
    calculator_count = sum(1 for tool in module.tools if tool.kind == "calculator")
    source_count = sum(len(tool.sources) for tool in module.tools)

    report = build_tool_module(source, output)

    assert calculator_count >= 17
    assert calculator_count == len(module.tools)
    assert report["toolCount"] == calculator_count
    assert report["sourceCount"] == source_count
    with sqlite3.connect(output) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert connection.execute(
            "SELECT count(*) FROM tool_definitions WHERE kind = 'calculator'"
        ).fetchone() == (calculator_count,)
