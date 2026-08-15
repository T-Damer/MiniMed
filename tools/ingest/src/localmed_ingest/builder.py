from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import yaml

from .edition_manifest import (
    build_edition_manifest,
    validate_pack_publication,
    write_edition_manifest,
)
from .embedding import PORTABLE_HASH_PROFILE, build_chunk_embedding
from .knowledge import (
    KnowledgeWorkspace,
    apply_search_projection,
    knowledge_summary,
    write_knowledge_sqlite,
)
from .knowledge_modules import load_knowledge_modules
from .markdown_parser import parse_markdown_document
from .models import Alias, BuildReport, ContentPack, PackDocument, PackManifest
from .normalization import normalize_for_index
from .sqlite_builder import inspect_integrity, write_sqlite_pack
from .text_encoding import (
    expects_russian_clinical_text,
    lint_english_dominant_russian_text,
    lint_garbled_russian_text,
)

_ICD10_CODE_PATTERN = re.compile(
    r"(?<![A-ZА-Я0-9])(?P<code>[A-ZА-Я]?\s*\d{2}(?:[.\-\s]\s*\d+|\d+)?)(?![A-ZА-Я0-9])",
    re.IGNORECASE,
)


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


def apply_icd10_search_projection(documents: list[PackDocument]) -> None:
    for document in documents:
        raw_codes = document.metadata.get("icd10Codes")
        if not isinstance(raw_codes, list):
            continue
        codes = [code.strip() for code in raw_codes if isinstance(code, str) and code.strip()]
        if not codes:
            continue
        compact_codes: list[str] = []
        for code in codes:
            for match in _ICD10_CODE_PATTERN.finditer(code):
                compact = re.sub(r"[.\-\s]", "", match.group("code")).casefold()
                numeric = re.sub(r"^[a-zа-я]", "", compact)
                if len(compact) >= 3:
                    compact_codes.append(compact)
                if len(numeric) >= 3:
                    compact_codes.append(numeric)
        projection = " ".join(dict.fromkeys(compact_codes))
        if not projection:
            continue
        for section in document.sections:
            for chunk in section.chunks:
                chunk.normalized_text = " ".join(
                    value
                    for value in [chunk.normalized_text, normalize_for_index(projection)]
                    if value
                )
                chunk.metadata["icd10Codes"] = codes


def _load_content_pack(
    input_dir: Path, *, include_embeddings: bool = True
) -> tuple[ContentPack, KnowledgeWorkspace]:
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

    knowledge = load_knowledge_modules(input_dir, documents)
    apply_search_projection(documents, knowledge)
    apply_icd10_search_projection(documents)

    embeddings = (
        [
            build_chunk_embedding(
                chunk.id,
                "\n".join(
                    value
                    for value in [
                        document.title,
                        *section.section_path,
                        chunk.original_text,
                        str(chunk.metadata.get("knowledgeProjectionText", "")),
                    ]
                    if value
                ),
            )
            for document in documents
            for section in document.sections
            for chunk in section.chunks
        ]
        if include_embeddings
        else []
    )
    pack = ContentPack(
        manifest=manifest,
        documents=documents,
        aliases=aliases,
        embedding_profiles=[PORTABLE_HASH_PROFILE] if include_embeddings else [],
        embeddings=embeddings,
    )
    validate_pack_publication(pack)
    return pack, knowledge


def load_content_pack(input_dir: Path, *, include_embeddings: bool = True) -> ContentPack:
    pack, _knowledge = _load_content_pack(input_dir, include_embeddings=include_embeddings)
    return pack


def lint_content_pack(pack: ContentPack) -> list[str]:
    errors: list[str] = []
    anchors: set[str] = set()
    chunk_ids: set[str] = set()
    for document in pack.documents:
        if not document.sections:
            errors.append(f"{document.id}: no sections")
        expects_russian = expects_russian_clinical_text(
            document.title,
            source_type=document.source_type,
        )
        document_text: list[str] = []
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
                if expects_russian:
                    document_text.append(chunk.original_text)
        if expects_russian:
            combined_text = "\n".join(document_text)
            garbled = lint_garbled_russian_text(combined_text, context=document.id)
            if garbled:
                errors.append(garbled)
            english_dominant = lint_english_dominant_russian_text(
                combined_text,
                context=document.id,
            )
            if english_dominant:
                errors.append(english_dominant)
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
        if expects_russian_clinical_text(
            document.title,
            source_type=document.source_type,
        ):
            suspicious_chunk_ids = [
                chunk.id
                for chunk in chunks
                if lint_garbled_russian_text(
                    chunk.original_text,
                    context=f"{document.id}/{chunk.id}",
                )
                is not None
            ]
            if suspicious_chunk_ids:
                visible_ids = ", ".join(suspicious_chunk_ids[:8])
                suffix = "" if len(suspicious_chunk_ids) <= 8 else ", …"
                warnings.append(
                    f"{document.id}: {len(suspicious_chunk_ids)} isolated chunks look garbled and "
                    f"require spot review ({visible_ids}{suffix})"
                )
    return warnings


def build_content_pack(
    input_dir: Path,
    output: Path,
    json_output: Path | None = None,
    report_path: Path | None = None,
    edition_manifest_output: Path | None = None,
    include_embeddings: bool = True,
) -> tuple[ContentPack, BuildReport]:
    pack, knowledge = _load_content_pack(input_dir, include_embeddings=include_embeddings)
    errors = lint_content_pack(pack)
    if errors:
        raise ValueError("Content lint failed:\n" + "\n".join(errors))
    write_sqlite_pack(pack, output, vacuum=False)
    write_knowledge_sqlite(output, knowledge)
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
    warnings = collect_content_warnings(pack)
    summary = knowledge_summary(knowledge)
    if summary.entities or summary.review_tasks:
        warnings.append(
            "knowledge: "
            f"{summary.entities} entities, {summary.facts} facts "
            f"({summary.reviewed_facts} reviewed), {summary.relations} relations "
            f"({summary.reviewed_relations} reviewed), {summary.review_tasks} review tasks"
        )
    report = BuildReport(
        documents=len(pack.documents),
        sections=sum(len(document.sections) for document in pack.documents),
        chunks=chunk_count,
        aliases=len(pack.aliases),
        embedding_profiles=len(pack.embedding_profiles),
        embeddings=len(pack.embeddings),
        warnings=warnings,
        errors=[],
        output_checksum=output_checksum,
        sqlite_integrity=integrity,
        foreign_key_violations=foreign_keys,
    )
    if json_output:
        json_output.parent.mkdir(parents=True, exist_ok=True)
        json_output.write_text(
            json.dumps(
                pack.model_dump(by_alias=True, mode="json"),
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(
                report.model_dump(by_alias=True, mode="json"),
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    if edition_manifest_output:
        write_edition_manifest(
            edition_manifest_output,
            build_edition_manifest(pack, output),
        )
    return pack, report
