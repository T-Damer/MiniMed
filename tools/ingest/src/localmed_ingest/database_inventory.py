"""Read-only inventory of SQLite database artifacts."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import cast
from urllib.parse import quote

REPORT_SCHEMA_VERSION = 1
_SQLITE_HEADER = b"SQLite format 3\x00"
_BLOCK_SIZE = 1024 * 1024
_COUNT_TABLES = (
    ("documents", ("documents",)),
    ("knowledge_entities", ("knowledge_entities",)),
    ("medications", ("medications", "medication_profiles")),
)


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_safe(value: object) -> object:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return {"type": "blob", "sizeBytes": len(value)}
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return str(value)


def _camel_case(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


def _identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _parse_json_column(
    column: str,
    value: object,
    diagnostics: list[dict[str, str]],
    context: str,
) -> tuple[str, object]:
    report_column = _camel_case(column.removesuffix("_json"))
    if not column.endswith("_json") or not isinstance(value, str):
        return report_column, _json_safe(value)
    try:
        return report_column, _json_safe(json.loads(value))
    except json.JSONDecodeError:
        diagnostics.append(
            {
                "code": "invalid-metadata-json",
                "context": context,
                "column": column,
            }
        )
        return report_column, value


def _table_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in connection.execute(f"PRAGMA table_info({_identifier(table)})")]


def _table_rows(
    connection: sqlite3.Connection,
    table: str,
    diagnostics: list[dict[str, str]],
) -> list[dict[str, object]]:
    columns = _table_columns(connection, table)
    if not columns:
        return []
    order_column = next((column for column in ("id", "key", "name") if column in columns), None)
    order = f" ORDER BY {_identifier(order_column)}" if order_column else " ORDER BY rowid"
    rows = connection.execute(f"SELECT * FROM {_identifier(table)}{order}").fetchall()
    result: list[dict[str, object]] = []
    for row in rows:
        item: dict[str, object] = {}
        for index, column in enumerate(columns):
            report_column, report_value = _parse_json_column(
                column,
                row[index],
                diagnostics,
                f"{table}[{len(result)}]",
            )
            item[report_column] = report_value
        result.append(item)
    return result


def _table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
    }


def _group_counts(
    connection: sqlite3.Connection,
    table: str,
    column: str,
) -> dict[str, int]:
    result: dict[str, int] = {}
    rows = connection.execute(
        f"SELECT {_identifier(column)}, count(*) FROM {_identifier(table)} "
        f"GROUP BY {_identifier(column)} ORDER BY {_identifier(column)}"
    )
    for value, count in rows:
        key = "(missing)" if value is None else str(value)
        result[key] = int(count)
    return result


def _count_rows(connection: sqlite3.Connection, table: str) -> int:
    row = connection.execute(f"SELECT count(*) FROM {_identifier(table)}").fetchone()
    return int(row[0]) if row is not None else 0


def _first_column(columns: set[str], *candidates: str) -> str | None:
    return next((candidate for candidate in candidates if candidate in columns), None)


def _coverage_state_counts(
    connection: sqlite3.Connection,
    table: str,
    columns: set[str],
    diagnostics: list[dict[str, str]],
) -> dict[str, int]:
    direct_column = _first_column(columns, "coverage_state", "coverageState")
    if direct_column is not None:
        return _group_counts(connection, table, direct_column)

    metadata_column = _first_column(columns, "metadata_json", "metadataJson")
    if metadata_column is None:
        return {}

    result: dict[str, int] = {}
    rows = connection.execute(
        f"SELECT {_identifier(metadata_column)} FROM {_identifier(table)} ORDER BY rowid"
    )
    for index, (value,) in enumerate(rows):
        if not isinstance(value, str):
            continue
        try:
            metadata = json.loads(value)
        except json.JSONDecodeError:
            diagnostics.append(
                {
                    "code": "invalid-metadata-json",
                    "context": f"{table}[{index}]",
                    "column": metadata_column,
                }
            )
            continue
        if not isinstance(metadata, dict):
            continue
        coverage_state = metadata.get("coverageState")
        if isinstance(coverage_state, str):
            result[coverage_state] = result.get(coverage_state, 0) + 1
    return dict(sorted(result.items()))


def _version_coverage(
    connection: sqlite3.Connection,
    table: str,
) -> dict[str, object]:
    columns = set(_table_columns(connection, table))
    result: dict[str, object] = {"count": _count_rows(connection, table)}
    version_column = _first_column(columns, "version_label", "versionLabel")
    if version_column is not None:
        result["byVersionLabel"] = _group_counts(connection, table, version_column)

    checksum_column = _first_column(columns, "source_checksum", "sourceChecksum")
    if checksum_column is not None:
        checksums = connection.execute(
            f"SELECT DISTINCT {_identifier(checksum_column)} FROM {_identifier(table)} "
            f"WHERE {_identifier(checksum_column)} IS NOT NULL "
            f"ORDER BY {_identifier(checksum_column)}"
        )
        digest = hashlib.sha256()
        checksum_count = 0
        for (checksum,) in checksums:
            digest.update(str(checksum).encode("utf-8"))
            digest.update(b"\n")
            checksum_count += 1
        result["sourceChecksumCount"] = checksum_count
        result["sourceChecksumDigest"] = f"sha256:{digest.hexdigest()}"
    return result


def _pack_metadata(
    connection: sqlite3.Connection,
    tables: set[str],
    diagnostics: list[dict[str, str]],
) -> dict[str, object]:
    metadata: dict[str, object] = {}
    if "content_packs" in tables:
        metadata["packs"] = _table_rows(connection, "content_packs", diagnostics)
    if "app_metadata" in tables:
        columns = _table_columns(connection, "app_metadata")
        if "key" in columns and "value" in columns:
            values: dict[str, object] = {}
            for key, value in connection.execute(
                "SELECT key, value FROM app_metadata ORDER BY key"
            ):
                values[str(key)] = _json_safe(value)
            metadata["appMetadata"] = values
        else:
            metadata["appMetadata"] = _table_rows(connection, "app_metadata", diagnostics)
    return metadata


def _source_coverage(
    connection: sqlite3.Connection,
    tables: set[str],
    diagnostics: list[dict[str, str]],
) -> dict[str, object]:
    coverage: dict[str, object] = {}
    if "documents" in tables:
        document_columns = set(_table_columns(connection, "documents"))
        coverage["documentCount"] = _count_rows(connection, "documents")
        source_type_column = _first_column(document_columns, "source_type", "sourceType")
        if source_type_column is not None:
            coverage["bySourceType"] = _group_counts(connection, "documents", source_type_column)
        status_column = _first_column(document_columns, "status")
        if status_column is not None:
            coverage["byStatus"] = _group_counts(connection, "documents", status_column)
        coverage_states = _coverage_state_counts(
            connection, "documents", document_columns, diagnostics
        )
        if coverage_states:
            coverage["byCoverageState"] = coverage_states
    if "document_versions" in tables:
        coverage["versions"] = _version_coverage(connection, "document_versions")
    if "tool_sources" in tables:
        tool_columns = set(_table_columns(connection, "tool_sources"))
        tool_summary: dict[str, object] = {"count": _count_rows(connection, "tool_sources")}
        source_kind_column = _first_column(tool_columns, "source_kind", "sourceKind")
        if source_kind_column is not None:
            tool_summary["bySourceKind"] = _group_counts(
                connection, "tool_sources", source_kind_column
            )
        coverage["toolSources"] = tool_summary
    return coverage


def _counts(
    connection: sqlite3.Connection,
    tables: set[str],
    diagnostics: list[dict[str, str]],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for report_name, candidate_tables in _COUNT_TABLES:
        for table in candidate_tables:
            if table not in tables:
                continue
            try:
                counts[report_name] = int(
                    connection.execute(f"SELECT count(*) FROM {_identifier(table)}").fetchone()[0]
                )
                break
            except sqlite3.DatabaseError as error:
                diagnostics.append(
                    {
                        "code": "count-query-failed",
                        "table": table,
                        "errorType": type(error).__name__,
                    }
                )
    return counts


def _readonly_connection(path: Path) -> sqlite3.Connection:
    uri_path = quote(str(path), safe="/:\\")
    connection = sqlite3.connect(f"file:{uri_path}?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only = ON")
    except Exception:
        connection.close()
        raise
    return connection


def _fingerprint(path: Path) -> tuple[int, str, bytes]:
    digest = hashlib.sha256()
    size = 0
    header = b""
    with path.open("rb") as source:
        header = source.read(len(_SQLITE_HEADER))
        digest.update(header)
        size += len(header)
        while block := source.read(_BLOCK_SIZE):
            digest.update(block)
            size += len(block)
    return size, f"sha256:{digest.hexdigest()}", header


def _diagnostic(code: str, **values: str) -> dict[str, str]:
    return {"code": code, **values}


def _base_artifact(
    relative_path: str,
    size_bytes: int,
    checksum: str | None,
    role: str,
    status: str,
    header: str | None,
    result: str,
    diagnostics: list[dict[str, str]],
) -> dict[str, object]:
    return {
        "relativePath": relative_path,
        "sizeBytes": size_bytes,
        "sha256": checksum,
        "role": role,
        "status": status,
        "sqliteHeader": header,
        "sqliteResult": result,
        "schemaVersion": None,
        "userVersion": None,
        "quickCheck": None,
        "diagnostics": diagnostics,
    }


def _classify_role(path: Path, root: Path) -> str:
    relative = path.relative_to(root)
    locations = (relative.parts, path.parts)
    if any(_contains_parts(parts, ("data", "build")) for parts in locations):
        return "generated-build"
    if any(_contains_parts(parts, ("apps", "app", "public", "content")) for parts in locations):
        return "packaged-runtime"
    if any(_contains_parts(parts, ("packages", "test-fixtures")) for parts in locations):
        return "test-fixture"
    return "local-unknown"


def _contains_parts(parts: tuple[str, ...], expected: tuple[str, ...]) -> bool:
    width = len(expected)
    return any(parts[index : index + width] == expected for index in range(len(parts) - width + 1))


def _symlink_target_inside(path: Path, root: Path) -> bool:
    try:
        return path.resolve(strict=False).is_relative_to(root)
    except (OSError, RuntimeError):
        return False


def _inspect_database(path: Path, root: Path) -> dict[str, object]:
    relative_path = path.relative_to(root).as_posix()
    role = _classify_role(path, root)
    if path.is_symlink() and not _symlink_target_inside(path, root):
        try:
            size_bytes = path.lstat().st_size
        except OSError:
            size_bytes = 0
        return _base_artifact(
            relative_path,
            size_bytes,
            None,
            role,
            "skipped",
            None,
            "symlink-outside-root",
            [_diagnostic("symlink-outside-root")],
        )

    try:
        size_bytes, checksum, header_bytes = _fingerprint(path)
    except OSError as error:
        return _base_artifact(
            relative_path,
            0,
            None,
            role,
            "error",
            None,
            "unreadable",
            [_diagnostic("file-read-failed", errorType=type(error).__name__)],
        )

    header = "SQLite format 3" if header_bytes == _SQLITE_HEADER else "not-sqlite"
    artifact = _base_artifact(
        relative_path,
        size_bytes,
        checksum,
        role,
        "invalid" if header != "SQLite format 3" else "ok",
        header,
        "not-sqlite" if header != "SQLite format 3" else "unopened",
        [_diagnostic("not-sqlite-header")] if header != "SQLite format 3" else [],
    )
    if header != "SQLite format 3":
        return artifact

    connection: sqlite3.Connection | None = None
    diagnostics = cast(list[dict[str, str]], artifact["diagnostics"])
    try:
        connection = _readonly_connection(path)
        schema_row = connection.execute("PRAGMA schema_version").fetchone()
        user_row = connection.execute("PRAGMA user_version").fetchone()
        artifact["schemaVersion"] = int(schema_row[0]) if schema_row is not None else None
        artifact["userVersion"] = int(user_row[0]) if user_row is not None else None
        quick_row = connection.execute("PRAGMA quick_check").fetchone()
        quick_check = str(quick_row[0]) if quick_row is not None else "no-result"
        artifact["quickCheck"] = quick_check
        artifact["sqliteResult"] = "ok" if quick_check == "ok" else quick_check
        if quick_check != "ok":
            artifact["status"] = "invalid"
            diagnostics.append(_diagnostic("quick-check-failed"))
        tables = _table_names(connection)
        pack_metadata = _pack_metadata(connection, tables, diagnostics)
        if pack_metadata:
            artifact["packMetadata"] = pack_metadata
        source_coverage = _source_coverage(connection, tables, diagnostics)
        if source_coverage:
            artifact["sourceCoverage"] = source_coverage
        counts = _counts(connection, tables, diagnostics)
        if counts:
            artifact["counts"] = counts
    except (OSError, sqlite3.DatabaseError) as error:
        artifact["status"] = "invalid"
        artifact["sqliteResult"] = "error"
        diagnostics.append(
            _diagnostic("sqlite-open-or-query-failed", errorType=type(error).__name__)
        )
    finally:
        if connection is not None:
            connection.close()
    return artifact


def _discover_databases(root: Path) -> list[Path]:
    discovered: list[Path] = []

    def visit(directory: Path) -> None:
        with os.scandir(directory) as entries:
            children = sorted(entries, key=lambda entry: entry.name)
        for entry in children:
            path = Path(entry.path)
            if entry.is_dir(follow_symlinks=False):
                visit(path)
            elif path.suffix.lower() == ".db" and (
                entry.is_file(follow_symlinks=False) or entry.is_symlink()
            ):
                discovered.append(path)

    visit(root)
    return sorted(discovered, key=lambda path: path.relative_to(root).as_posix())


def inventory_databases(root: Path, *, generated_at: str | None = None) -> dict[str, object]:
    """Collect a deterministic, read-only inventory for every database under ``root``."""
    root_path = Path(root).expanduser()
    if not root_path.is_dir():
        raise ValueError(f"Inventory root is not a directory: {root_path}")
    resolved_root = root_path.resolve()
    artifacts = [
        _inspect_database(path, resolved_root) for path in _discover_databases(resolved_root)
    ]
    totals: dict[str, int] = {
        "artifacts": len(artifacts),
        "sizeBytes": sum(cast(int, artifact["sizeBytes"]) for artifact in artifacts),
        "ok": sum(artifact["status"] == "ok" for artifact in artifacts),
        "invalid": sum(artifact["status"] == "invalid" for artifact in artifacts),
        "skipped": sum(artifact["status"] == "skipped" for artifact in artifacts),
        "errors": sum(artifact["status"] == "error" for artifact in artifacts),
    }
    for report_name, _ in _COUNT_TABLES:
        values: list[int] = []
        for artifact in artifacts:
            counts = artifact.get("counts")
            if not isinstance(counts, dict):
                continue
            value = counts.get(report_name)
            if isinstance(value, int):
                values.append(value)
        if values:
            totals[report_name] = sum(values)
    return {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "generatedAt": generated_at or _utc_now(),
        "root": str(resolved_root),
        "artifacts": artifacts,
        "totals": totals,
    }


def write_inventory_report(report: dict[str, object], output: Path) -> None:
    """Write an already-collected report with an atomic replace."""
    output_path = Path(output)
    if output_path.suffix.lower() == ".db":
        raise ValueError("Inventory output must not use the .db extension.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output_path.parent,
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(report, temporary, ensure_ascii=False, indent=2, sort_keys=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, output_path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


__all__ = ["inventory_databases", "write_inventory_report"]
