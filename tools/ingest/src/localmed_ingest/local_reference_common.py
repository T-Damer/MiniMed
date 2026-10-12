"""Shared plumbing of the personal-use reference modules (lab norms, TNM).

The inputs of these modules are shared with the owner for personal use only. Nothing derived from
them may enter git or be uploaded: every writer here refuses an output path that git does not
ignore, and the preparers record ``rightsStatus = personal-use-only`` in every document.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import yaml

from .module_distribution import (
    ModuleDescriptor,
    package_module,
    plural_ru,
    read_pack_membership,
    required_text,
)

RIGHTS_STATUS = "personal-use-only"
SOURCE_TYPE = "medical_reference"
SOURCE_LABEL = "medsolutions-spravochnik-vracha/databases"
_YAML_DUMPER = getattr(yaml, "CSafeDumper", yaml.SafeDumper)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def text_sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def ensure_gitignored(path: Path) -> None:
    """Refuse to write personal-use data to a path that git would track."""
    resolved = path.resolve()
    anchor = resolved
    while not anchor.exists():
        anchor = anchor.parent
    probe = resolved if resolved.exists() else resolved / ".probe"
    result = subprocess.run(
        [
            "git",
            "-C",
            str(anchor if anchor.is_dir() else anchor.parent),
            "check-ignore",
            "-q",
            "--",
            str(probe),
        ],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        raise ValueError(
            f"{path} is not ignored by git; personal-use data may only be written to ignored paths"
        )


def source_marker(raw_path: str, selector: str, kind: str) -> str:
    payload = {"rawPath": raw_path, "selector": selector, "sourceKind": kind}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"<!-- localmed:source {encoded} -->"


def front_matter_document(metadata: Mapping[str, object], body: list[str]) -> str:
    front = yaml.dump(
        dict(metadata),
        Dumper=_YAML_DUMPER,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=1_000_000,
    ).rstrip()
    return f"---\n{front}\n---\n\n" + "\n\n".join(body).rstrip() + "\n"


@dataclass(frozen=True)
class AliasRow:
    id: str
    canonical_term: str
    alias: str
    category: str
    weight: float

    def as_yaml(self) -> dict[str, object]:
        return {
            "id": self.id,
            "canonicalTerm": self.canonical_term,
            "alias": self.alias,
            "category": self.category,
            "weight": self.weight,
        }


def write_workspace(
    output: Path,
    documents: Mapping[str, str],
    *,
    pack_id: str,
    title: str,
    version: str,
    built_at: str,
    aliases: list[AliasRow],
    report: Mapping[str, object],
) -> None:
    """Markdown workspace: one file per document, manifest, aliases and the prepare report."""
    if not documents:
        raise ValueError("Nothing to write: no documents were prepared")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{output.name}.", dir=output.parent) as temporary:
        workspace = Path(temporary)
        for name, markdown in documents.items():
            (workspace / name).write_text(markdown, encoding="utf-8")
        manifest = {
            "id": pack_id,
            "version": version,
            "schemaVersion": 2,
            "title": title,
            "builtAt": built_at,
            "publicationState": "local-dev",
        }
        (workspace / "manifest.yaml").write_text(
            yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        (workspace / "aliases.yaml").write_text(
            yaml.dump(
                {"aliases": [row.as_yaml() for row in aliases]},
                Dumper=_YAML_DUMPER,
                allow_unicode=True,
                sort_keys=False,
                width=1_000_000,
            ),
            encoding="utf-8",
        )
        (workspace / "prepare-report.json").write_text(
            json.dumps(dict(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        if output.exists():
            shutil.rmtree(output)
        workspace.rename(output)


@dataclass(frozen=True)
class LocalModuleSpec:
    module_id: str
    file_stem: str
    title: str
    collection: str
    document_prefix: str
    source_name: str
    description_head: str
    tags: tuple[str, ...]


def package_local_module(
    spec: LocalModuleSpec,
    database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
) -> dict[str, object]:
    """Gzip a built personal-use pack and write its catalog entry (documents are not listed)."""
    counted = {"documents": 0}

    def validate(document_id: str, source_checksum: str, metadata: dict[str, object]) -> None:
        if not source_checksum.startswith("sha256:"):
            raise ValueError(f"{document_id}: version has no SHA-256 source checksum")
        if metadata.get("rightsStatus") != RIGHTS_STATUS:
            raise ValueError(f"{document_id}: rights status is not {RIGHTS_STATUS}")
        if metadata.get("localOnly") is not True:
            raise ValueError(f"{document_id}: not marked localOnly")
        required_text(metadata.get("sourceName"), f"{document_id} sourceName")
        counted["documents"] += 1

    membership = read_pack_membership(
        database, document_prefixes=(spec.document_prefix,), validate=validate
    )
    description = (
        f"{spec.description_head} "
        f"{plural_ru(len(membership.documents), 'документ', 'документа', 'документов')}. "
        "Личный набор: источник передан владельцу только для личного пользования, "
        "не распространяется и не публикуется."
    )
    return package_module(
        database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=spec.module_id,
            release_tag=f"{spec.collection}-{version}",
            file_stem=spec.file_stem,
            title=spec.title,
            tags=spec.tags,
            structured_tables=True,
            collection=spec.collection,
            list_documents=False,
        ),
        version=version,
        min_app_version=min_app_version,
        membership=membership,
        description=description,
        report_extra={"sourceName": spec.source_name, "rightsStatus": RIGHTS_STATUS},
    )
