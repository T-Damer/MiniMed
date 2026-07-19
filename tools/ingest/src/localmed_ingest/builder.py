from __future__ import annotations

import hashlib
import json
from pathlib import Path

import yaml

from .embedding import PORTABLE_HASH_PROFILE, build_chunk_embedding
from .markdown_parser import parse_markdown_document
from .models import Alias, BuildReport, ContentPack, PackManifest
from .sqlite_builder import inspect_integrity, write_sqlite_pack


def read_yaml_mapping(path: Path) -> dict[str, object]:
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected YAML mapping: {path}")
    return value


def calculate_pack_checksum(input_dir: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(input_dir.glob("*")):
        if path.is_file():
            digest.update(path.name.encode("utf-8"))
            digest.update(path.read_bytes())
    return f"sha256:{digest.hexdigest()}"


def load_content_pack(input_dir: Path) -> ContentPack:
    manifest_data = read_yaml_mapping(input_dir / "manifest.yaml")
    manifest_data["checksum"] = calculate_pack_checksum(input_dir)
    manifest = PackManifest.model_validate(manifest_data)
    aliases_data = read_yaml_mapping(input_dir / "aliases.yaml")
    raw_aliases = aliases_data.get("aliases", [])
    if not isinstance(raw_aliases, list):
        raise ValueError("aliases.yaml must contain an aliases list.")
    aliases = [Alias.model_validate(item) for item in raw_aliases]
    documents = [
        parse_markdown_document(path, extracted_at=manifest.built_at)
        for path in sorted(input_dir.glob("*.md"))
    ]
    if not documents:
        raise ValueError("No Markdown documents found.")
    document_ids = [document.id for document in documents]
    if len(document_ids) != len(set(document_ids)):
        raise ValueError("Duplicate document id in content pack.")
    embeddings = [
        build_chunk_embedding(
            chunk.id,
            "\n".join([document.title, *section.section_path, chunk.original_text]),
        )
        for document in documents
        for section in document.sections
        for chunk in section.chunks
    ]
    return ContentPack(
        manifest=manifest,
        documents=documents,
        aliases=aliases,
        embedding_profiles=[PORTABLE_HASH_PROFILE],
        embeddings=embeddings,
    )


def lint_content_pack(pack: ContentPack) -> list[str]:
    errors: list[str] = []
    anchors: set[str] = set()
    chunk_ids: set[str] = set()
    for document in pack.documents:
        if not document.sections:
            errors.append(f"{document.id}: no sections")
        for section in document.sections:
            if section.anchor in anchors:
                errors.append(f"duplicate anchor: {section.anchor}")
            anchors.add(section.anchor)
            for chunk in section.chunks:
                if chunk.anchor in anchors:
                    errors.append(f"duplicate anchor: {chunk.anchor}")
                anchors.add(chunk.anchor)
                if chunk.id in chunk_ids:
                    errors.append(f"duplicate chunk id: {chunk.id}")
                chunk_ids.add(chunk.id)
                if not chunk.normalized_text:
                    errors.append(f"{chunk.id}: empty normalized text")
    return errors


def collect_content_warnings(pack: ContentPack) -> list[str]:
    warnings: list[str] = []
    for document in pack.documents:
        synthetic = bool(document.metadata.get("syntheticFixture", False))
        source_file = document.metadata.get("sourceFile")
        chunks = [chunk for section in document.sections for chunk in section.chunks]
        chunks_with_spans = sum(bool(chunk.metadata.get("sourceSpans")) for chunk in chunks)
        if not synthetic and not source_file:
            warnings.append(f"{document.id}: non-synthetic document has no sourceFile metadata")
        if not synthetic and chunks and chunks_with_spans == 0:
            warnings.append(f"{document.id}: imported document has no chunk source spans")
        extraction = document.metadata.get("extraction")
        if isinstance(extraction, dict) and extraction.get("requiresReview") is True:
            warnings.append(f"{document.id}: extraction diagnostics require spot review")
    return warnings


def build_content_pack(
    input_dir: Path,
    output: Path,
    json_output: Path | None = None,
    report_path: Path | None = None,
) -> tuple[ContentPack, BuildReport]:
    pack = load_content_pack(input_dir)
    errors = lint_content_pack(pack)
    if errors:
        raise ValueError("Content lint failed:\n" + "\n".join(errors))
    write_sqlite_pack(pack, output)
    integrity, foreign_keys, chunk_count, fts_rows, profile_count, embedding_count = (
        inspect_integrity(output)
    )
    if (
        integrity != "ok"
        or foreign_keys
        or chunk_count != fts_rows
        or profile_count != len(pack.embedding_profiles)
        or embedding_count != chunk_count * profile_count
    ):
        raise ValueError("Generated SQLite pack failed integrity checks.")
    output_checksum = f"sha256:{hashlib.sha256(output.read_bytes()).hexdigest()}"
    report = BuildReport(
        documents=len(pack.documents),
        sections=sum(len(document.sections) for document in pack.documents),
        chunks=chunk_count,
        aliases=len(pack.aliases),
        embedding_profiles=len(pack.embedding_profiles),
        embeddings=len(pack.embeddings),
        warnings=collect_content_warnings(pack),
        errors=[],
        output_checksum=output_checksum,
        sqlite_integrity=integrity,
        foreign_key_violations=foreign_keys,
    )
    if json_output:
        json_output.parent.mkdir(parents=True, exist_ok=True)
        json_output.write_text(
            json.dumps(pack.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(report.model_dump(by_alias=True, mode="json"), ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
    return pack, report
