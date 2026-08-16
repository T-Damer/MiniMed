from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .sqlite_builder import schema_sql


class ToolSource(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    kind: Literal["clinical-recommendation", "literature", "guideline", "regulatory"]
    relation: Literal["methodology", "interpretation", "clinical-context"]
    title: str
    module_id: str | None = Field(default=None, alias="moduleId")
    document_id: str | None = Field(default=None, alias="documentId")
    url: str | None = None
    reviewed_at: str = Field(alias="reviewedAt")


class ToolEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    kind: Literal["calculator", "assessment"]
    version: str
    slug: str
    title: str
    short_title: str = Field(alias="shortTitle")
    aliases: list[str] = []
    bank_id: str = Field(alias="bankId")
    bank_label: str = Field(alias="bankLabel")
    category: str
    description: str
    estimated_minutes: int | None = Field(default=None, alias="estimatedMinutes")
    audience: str
    definition: dict[str, object]
    sources: list[ToolSource] = []


class ToolModule(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str
    version: str
    title: str
    schema_version: int = Field(alias="schemaVersion")
    built_at: str = Field(alias="builtAt")
    tools: list[ToolEntry]


def repository_root() -> Path:
    configured = os.environ.get("LOCALMED_REPO_ROOT")
    if configured:
        return Path(configured).resolve()
    return Path(__file__).resolve().parents[4]


def load_tool_module(source: Path) -> tuple[ToolModule, str]:
    raw = source.read_bytes()
    module = ToolModule.model_validate_json(raw)
    if not module.tools:
        raise ValueError("A tool module must contain at least one tool.")
    ids = [tool.id for tool in module.tools]
    if len(set(ids)) != len(ids):
        raise ValueError("Tool ids must be unique inside a module.")
    slugs = [tool.slug for tool in module.tools]
    if len(set(slugs)) != len(slugs):
        raise ValueError("Tool slugs must be unique inside a module.")
    return module, f"sha256:{hashlib.sha256(raw).hexdigest()}"


def build_tool_module(source: Path, output: Path) -> dict[str, object]:
    module, source_digest = load_tool_module(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)
    connection = sqlite3.connect(temporary)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = OFF")
        connection.execute("PRAGMA synchronous = OFF")
        connection.executescript(schema_sql())
        with connection:
            connection.execute(
                "INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                (module.schema_version, module.built_at),
            )
            connection.execute(
                "INSERT OR REPLACE INTO app_metadata(key, value) VALUES ('schema_version', ?)",
                (str(module.schema_version),),
            )
            connection.execute(
                """INSERT INTO content_packs(
                    id, version, schema_version, title, checksum, installed_at, enabled
                ) VALUES (?, ?, ?, ?, ?, ?, 1)""",
                (
                    module.id,
                    module.version,
                    module.schema_version,
                    module.title,
                    source_digest,
                    module.built_at,
                ),
            )
            for tool in sorted(module.tools, key=lambda item: item.id):
                connection.execute(
                    """INSERT INTO tool_definitions(
                        id, kind, version, slug, title, short_title, aliases_json,
                        bank_id, bank_label, category, description, estimated_minutes,
                        audience, definition_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        tool.id,
                        tool.kind,
                        tool.version,
                        tool.slug,
                        tool.title,
                        tool.short_title,
                        json.dumps(tool.aliases, ensure_ascii=False, separators=(",", ":")),
                        tool.bank_id,
                        tool.bank_label,
                        tool.category,
                        tool.description,
                        tool.estimated_minutes,
                        tool.audience,
                        json.dumps(tool.definition, ensure_ascii=False, separators=(",", ":")),
                    ),
                )
                for source_link in sorted(tool.sources, key=lambda item: item.id):
                    connection.execute(
                        """INSERT INTO tool_sources(
                            id, tool_id, source_kind, relation, title, module_id,
                            document_id, url, reviewed_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            source_link.id,
                            tool.id,
                            source_link.kind,
                            source_link.relation,
                            source_link.title,
                            source_link.module_id,
                            source_link.document_id,
                            source_link.url,
                            source_link.reviewed_at,
                        ),
                    )
        connection.execute("VACUUM")
    finally:
        connection.close()
    temporary.replace(output)
    with sqlite3.connect(output) as check:
        integrity = str(check.execute("PRAGMA integrity_check").fetchone()[0])
        tool_count = int(check.execute("SELECT count(*) FROM tool_definitions").fetchone()[0])
        source_count = int(check.execute("SELECT count(*) FROM tool_sources").fetchone()[0])
    if integrity != "ok":
        raise ValueError(f"Generated tool module failed integrity check: {integrity}")
    return {
        "moduleId": module.id,
        "version": module.version,
        "sourceSetDigest": source_digest,
        "toolCount": tool_count,
        "sourceCount": source_count,
        "outputBytes": output.stat().st_size,
    }
