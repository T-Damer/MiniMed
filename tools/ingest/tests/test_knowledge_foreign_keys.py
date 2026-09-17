"""Recomposition must not scan every child row for every source entity deletion."""

import sqlite3

from localmed_ingest.sqlite_builder import schema_sql, secondary_indexes_sql


def test_all_knowledge_cascade_foreign_keys_have_indexed_lookups() -> None:
    with sqlite3.connect(":memory:") as db:
        db.executescript(schema_sql(include_indexes=False))
        for statement in secondary_indexes_sql():
            db.execute(statement)
        for table in (
            "knowledge_names",
            "knowledge_facts",
            "knowledge_relations",
            "knowledge_evidence",
            "knowledge_document_links",
            "medication_profiles",
            "chunks",
            "sections",
        ):
            for foreign_key in db.execute(f"PRAGMA foreign_key_list({table})"):
                column = foreign_key[3]
                plan = db.execute(
                    f"EXPLAIN QUERY PLAN SELECT rowid FROM {table} WHERE {column} = ?",
                    ("unmatched-identity",),
                ).fetchall()
                assert any("SEARCH" in row[3] for row in plan), (table, column, plan)
