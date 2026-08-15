from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

from .sqlite_composer import _rebuild_knowledge_fts

MIGRATION_ID = "mkb-professional-reference-v1"


def upgrade_mkb_reference_database(source: Path, output: Path) -> dict[str, int | str]:
    """Promote exact RLS evidence in an existing MKB pack without rebuilding Markdown."""
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)
    shutil.copy2(source, temporary)
    try:
        connection = sqlite3.connect(temporary)
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            with connection:
                updated = connection.execute(
                    """UPDATE knowledge_relations
                    SET authority_tier = 'professional-reference'
                    WHERE authority_tier = 'third-party'
                      AND relation_status = 'reference-only'
                      AND predicate = 'listed-on-rls-mkb-page'
                      AND EXISTS (
                        SELECT 1
                        FROM knowledge_evidence evidence
                        JOIN documents document ON document.id = evidence.document_id
                        WHERE evidence.relation_id = knowledge_relations.id
                          AND document.source_type = 'rls_mkb_reference'
                      )"""
                ).rowcount
                _rebuild_knowledge_fts(connection)
                connection.execute(
                    """INSERT OR REPLACE INTO app_metadata(key, value)
                    VALUES ('mkb_reference_migration', ?)""",
                    (MIGRATION_ID,),
                )
            knowledge_fts_rows = int(
                connection.execute("SELECT count(*) FROM knowledge_fts").fetchone()[0]
            )
            relation_rows = int(
                connection.execute("SELECT count(*) FROM knowledge_relations").fetchone()[0]
            )
            integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
            foreign_keys = len(connection.execute("PRAGMA foreign_key_check").fetchall())
        finally:
            connection.close()
        if integrity != "ok" or foreign_keys:
            raise ValueError("MKB reference upgrade failed integrity checks.")
        temporary.replace(output)
        return {
            "migration": MIGRATION_ID,
            "relationsUpdated": int(updated),
            "relations": relation_rows,
            "knowledgeFtsRows": knowledge_fts_rows,
        }
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def write_upgrade_report(output: Path, report: dict[str, int | str]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
