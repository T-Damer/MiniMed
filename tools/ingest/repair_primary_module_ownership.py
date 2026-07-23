# One-shot validated repair; this file deletes itself after applying the patch.
from __future__ import annotations

import subprocess
import textwrap
from pathlib import Path


def indented(source: str, prefix: str) -> str:
    return textwrap.indent(textwrap.dedent(source).strip("\n") + "\n", prefix)


builder_path = Path("tools/ingest/src/localmed_ingest/catalog_module_builder.py")
builder = builder_path.read_text(encoding="utf-8")

validator_start = builder.index(
    "        known = set(record_ids)\n",
    builder.index("    def validate_records"),
)
validator_end = builder.index("        return self\n", validator_start) + len(
    "        return self\n"
)
validator = indented(
    """
    known = set(record_ids)
    module_ids = [module.module_id for module in self.modules]
    if len(module_ids) != len(set(module_ids))):
        raise ValueError("Coverage ledger contains duplicate moduleId values.")
    module_records = {
        module.module_id: set(module.record_ids) for module in self.modules
    }
    for module in self.modules:
        if len(module.record_ids) != len(set(module.record_ids)):
            raise ValueError(
                f"Module {module.module_id} contains duplicate record references."
            )
        missing = [
            record_id for record_id in module.record_ids if record_id not in known
        ]
        if missing:
            raise ValueError(
                f"Module {module.module_id} references unknown records: "
                f"{', '.join(missing)}"
            )
    for record, record_id in zip(self.records, record_ids, strict=True):
        primary_value = record.get("primaryModuleId")
        primary = primary_value.strip() if isinstance(primary_value, str) else ""
        if not primary:
            raise ValueError(
                f"Coverage-ledger record {record_id} requires primaryModuleId."
            )
        if primary not in module_records:
            raise ValueError(
                f"Record {record_id} references unknown primary module {primary}."
            )
        if record_id not in module_records[primary]:
            raise ValueError(
                f"Primary module {primary} does not include record {record_id}."
            )
    return self
    """,
    "        ",
)
builder = builder[:validator_start] + validator + builder[validator_end:]

build_start = builder.index(
    "    builds: list[CatalogModuleBuild] = []\n",
    builder.index("def build_catalog_metadata_modules"),
)
build_end = builder.index(
    '    (target / "module-build-report.json").write_text(',
    build_start,
)
build = indented(
    r"""
    builds: list[CatalogModuleBuild] = []
    warnings: list[str] = []
    packaged_ids: list[str] = []
    for module in ledger.modules:
        primary_record_ids = [
            record_id
            for record_id in module.record_ids
            if _clean(records[record_id].get("primaryModuleId")) == module.module_id
        ]
        if not primary_record_ids:
            warnings.append(
                f"module skipped without primary records: {module.module_id}"
            )
            continue
        module_dir = target / _safe_stem(module.module_id)
        module_dir.mkdir(parents=True)
        (module_dir / "manifest.yaml").write_text(
            yaml.safe_dump(
                _module_manifest(module, version, timestamp),
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        aliases: list[dict[str, object]] = []
        document_ids: list[str] = []
        coverage_counts: dict[str, int] = {}
        for record_id in primary_record_ids:
            record = records[record_id]
            document_id, front, body, record_aliases = _render_record(family, record)
            document_ids.append(document_id)
            packaged_ids.append(document_id)
            aliases.extend(record_aliases)
            coverage = _clean(record.get("coverageState")) or "metadata-only"
            coverage_counts[coverage] = coverage_counts.get(coverage, 0) + 1
            document_path = module_dir / f"{_safe_stem(document_id)}.md"
            document_path.write_text(
                f"---\n{front}\n---\n\n{body}",
                encoding="utf-8",
            )
        unique_aliases: dict[str, dict[str, object]] = {}
        for alias in aliases:
            alias_id = cast(str, alias["id"])
            if alias_id in unique_aliases:
                warnings.append(f"duplicate alias ignored: {alias_id}")
                continue
            unique_aliases[alias_id] = alias
        (module_dir / "aliases.yaml").write_text(
            yaml.safe_dump(
                {"aliases": list(unique_aliases.values())},
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        builds.append(
            CatalogModuleBuild(
                module_id=module.module_id,
                title=module.title,
                directory=str(module_dir.relative_to(target)),
                record_count=len(document_ids),
                document_ids=document_ids,
                coverage_counts=coverage_counts,
            )
        )
    if len(packaged_ids) != len(set(packaged_ids)):
        raise ValueError("Catalog module generation produced duplicate document IDs.")
    if set(packaged_ids) != set(records):
        missing = sorted(set(records) - set(packaged_ids))
        unexpected = sorted(set(packaged_ids) - set(records))
        raise ValueError(
            "Catalog module generation did not preserve canonical ownership: "
            f"missing={missing}, unexpected={unexpected}."
        )
    report = CatalogModuleBuildReport(
        family=family,
        version=version,
        built_at=timestamp,
        source_ledger_checksum=_sha256_file(ledger_path),
        modules=builds,
        total_documents=len(packaged_ids),
        warnings=warnings,
    )
    """,
    "    ",
)
builder = builder[:build_start] + build + builder[build_end:]
builder_path.write_text(builder, encoding="utf-8")

test_path = Path("tools/ingest/tests/test_catalog_module_builder.py")
test = test_path.read_text(encoding="utf-8")
if "def test_secondary_categories_do_not_duplicate_documents" not in test:
    test += textwrap.dedent(
        '''

        def test_secondary_categories_do_not_duplicate_documents(tmp_path: Path) -> None:
            ledger = tmp_path / "secondary.json"
            record_id = "kr.rf.secondary"
            primary = "minimed.clinical.respiratory.ru"
            secondary = "minimed.clinical.pediatrics.ru"
            write_ledger(
                ledger,
                [
                    {
                        "recordId": record_id,
                        "officialId": "secondary",
                        "title": "Тестовая рекомендация",
                        "versionLabel": "2026",
                        "status": "active",
                        "coverageState": "metadata-only",
                        "rights": "unknown",
                        "moduleIds": [primary, secondary],
                        "primaryModuleId": primary,
                        "specialties": ["pediatrics", "pulmonology"],
                    }
                ],
                [
                    {
                        "moduleId": primary,
                        "title": "Пульмонология",
                        "recordIds": [record_id],
                        "coverageCounts": {"metadata-only": 1},
                    },
                    {
                        "moduleId": secondary,
                        "title": "Общая педиатрия",
                        "recordIds": [record_id],
                        "coverageCounts": {"metadata-only": 1},
                    },
                ],
            )
            output = tmp_path / "secondary-modules"

            report = build_catalog_metadata_modules(
                ledger,
                output,
                family="clinical",
                version="2026.07.1",
                built_at="2026-07-23T00:00:00Z",
            )

            assert report.total_documents == 1
            assert [module.module_id for module in report.modules] == [primary]
            assert report.modules[0].document_ids == [record_id]
            assert not (output / secondary).exists()
            assert any(secondary in warning for warning in report.warnings)
        '''
    )
test_path.write_text(test, encoding="utf-8")

workflow_path = Path(".github/workflows/catalog-metadata-modules.yml")
workflow = workflow_path.read_text(encoding="utf-8")
old = """          if report['totalDocuments'] < 6:
              raise SystemExit('Fixture metadata modules lost catalog records.')
          databases = list(Path('data/build/fixture-clinical-databases').glob('*.db'))
"""
new = """          document_ids = [
              document_id
              for module in report['modules']
              for document_id in module['documentIds']
          ]
          if report['totalDocuments'] != 6 or len(document_ids) != 6:
              raise SystemExit('Fixture metadata modules lost catalog records.')
          if len(document_ids) != len(set(document_ids)):
              raise SystemExit('Fixture metadata modules duplicated catalog records.')
          databases = list(Path('data/build/fixture-clinical-databases').glob('*.db'))
"""
if old not in workflow:
    raise SystemExit("Fixture report assertion block not found.")
workflow_path.write_text(workflow.replace(old, new, 1), encoding="utf-8")

subprocess.run(
    [
        "uv",
        "run",
        "--project",
        "tools/ingest",
        "ruff",
        "format",
        str(builder_path),
        str(test_path),
    ],
    check=True,
)
Path(__file__).unlink()
