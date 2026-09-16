"""Compile licensed Russian lexical senses into the existing downloadable SQLite contract."""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path

import yaml

from .builder import build_content_pack
from .knowledge import (
    KnowledgeDocumentLink,
    KnowledgeEntity,
    KnowledgeEvidence,
    KnowledgeFact,
    KnowledgeName,
    KnowledgeWorkspace,
)
from .markdown_parser import parse_markdown_document
from .models import SourceMetadata, SourceProvenance, SourceRights
from .russian_dictionary import (
    ATTRIBUTION,
    LICENSE_URL,
    SUBJECT_TITLES,
    TERMS_URL,
    RussianDictionarySense,
    RussianDictionarySource,
)
from .terminology_packs import _compress_database, _source_body
from .terminology_prepare import json_bytes
from .terminology_sources import sha256_file

INDEX_ID = "minimed.terminology.ruwiktionary.index"


def section_id(subject: str) -> str:
    if subject not in SUBJECT_TITLES:
        raise ValueError("Unknown source dictionary subject")
    return f"minimed.terminology.ruwiktionary.{subject}"


def _write_sense(
    root: Path, sense: RussianDictionarySense, version: str, *, discovery: bool
) -> None:
    target = f"medical.term.{sense.id}"
    document_id = f"discovery.{target}" if discovery else target
    owner = section_id(sorted(sense.subjects)[0])
    entity_id = "core.concept." + hashlib.sha256(target.encode()).hexdigest()[:24]
    provenance = SourceProvenance(
        source_id=sense.id,
        publisher="Русский Викисловарь",
        official_locator=sense.source_url,
        jurisdiction="international",
        rights_status="verified",
        raw_checksum=sense.record_sha256,
        rights=SourceRights(
            owner="Russian Wiktionary contributors",
            license_id="CC-BY-SA-4.0",
            allows_offline_storage=True,
            allows_derivative_processing=True,
            allows_redistribution=True,
            attribution=ATTRIBUTION,
            notes=(
                "Selected source-labelled medical senses; whitespace-normalized search projection. "
                "No examples/media imported. Adapted dictionary data remains CC-BY-SA-4.0. "
                + LICENSE_URL
            ),
        ),
    )
    metadata: dict[str, object] = {
        "catalogFamily": "reference",
        "entityType": "term",
        "terminology": {
            "version": 1,
            "edition": version,
            "conceptId": sense.id,
            "names": [sense.word],
            "relatedConceptIds": [],
            "definitionLanguages": ["ru"],
            "discovery": discovery,
            "targetDocumentId": target,
        },
        "conceptId": entity_id,
        "terminologyId": sense.id,
        "terminologySections": sense.subjects,
        "definitionLanguages": ["ru"],
        "sourceTitleLanguage": "ru",
        "nameLanguage": "ru",
        "authorityTier": "third-party",
        "referenceKind": "community-lexical-reference",
        "notClinicalGuidance": True,
        "reviewStatus": "proposed",
        "clinicalApproval": False,
        "contentMode": "terminology-reference",
        "definitionStatus": "source-backed",
        "provenance": provenance.model_dump(by_alias=True),
        "sourceGlosses": sense.glosses,
        "sourceCategories": sense.categories,
        "sourceArchiveSha256": sense.source_sha256,
        "sourceRecordSha256": sense.record_sha256,
        "sourceLine": sense.source_line,
        "sourceSenseIndex": sense.sense_index,
        "partOfSpeech": sense.part_of_speech,
        "attribution": ATTRIBUTION,
        "sourceTerms": TERMS_URL,
        "licenseId": "CC-BY-SA-4.0",
        "licenseUrl": LICENSE_URL,
    }
    if discovery:
        metadata.update(
            {
                "contentMode": "module-pointer",
                "pointerKind": "terminology",
                "targetDocumentId": target,
                "primaryModuleId": owner,
                "moduleIds": [owner],
                "clinicalSourceType": "medical_terminology",
            }
        )
    source = SourceMetadata(
        id=document_id,
        title=sense.word,
        short_title=sense.word,
        version_label=version,
        source_type="core_catalog_pointer" if discovery else "medical_terminology",
        status="active",
        specialties=["medical-reference" if s == "medicine" else s for s in sense.subjects],
        source_file=f"ru-extract.jsonl#line={sense.source_line};sense={sense.sense_index}",
        source_checksum=sense.record_sha256,
        metadata=metadata,
    )
    body = ["# Термин", _source_body(sense.word)]
    for i, gloss in enumerate(sense.glosses):
        body.extend([f"# Определение {i + 1} (ru)", _source_body(gloss)])
    body.extend(
        [
            "# Источник и лицензия",
            "Лексическое определение сообщества Русского Викисловаря, не клиническая рекомендация. "
            "Источник и история авторства: " + sense.source_url + ". "
            "Авторы Русского Викисловаря; извлечение Wiktextract/Kaikki.org. "
            "Лицензия CC-BY-SA-4.0: " + LICENSE_URL + ". "
            "Изменения: отбор медицинских значений и нормализация пробелов. "
            "Исходные определения сохранены; примеры и изображения не включены.",
        ]
    )
    (root / f"{sense.id}.md").write_text(
        "---\n"
        + yaml.safe_dump(source.model_dump(), allow_unicode=True, sort_keys=False)
        + "---\n\n"
        + "\n\n".join(body)
        + "\n",
        encoding="utf-8",
    )


def _build_pack(
    root: Path,
    senses: list[RussianDictionarySense],
    pack_id: str,
    version: str,
    built_at: str,
    *,
    discovery: bool,
) -> dict[str, object]:
    workspace = root / "workspaces" / pack_id
    workspace.mkdir(parents=True)
    title = "Русские медицинские термины — " + (
        "индекс и определения" if discovery else SUBJECT_TITLES[pack_id.rsplit(".", 1)[1]]
    )
    (workspace / "manifest.yaml").write_text(
        yaml.safe_dump(
            {
                "id": pack_id,
                "version": version,
                "schemaVersion": 2,
                "title": title,
                "builtAt": built_at,
                "publicationState": "published",
            },
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    (workspace / "aliases.yaml").write_text("aliases: []\n")
    for sense in senses:
        _write_sense(workspace, sense, version, discovery=discovery)
    entities: list[KnowledgeEntity] = []
    facts: list[KnowledgeFact] = []
    links: list[KnowledgeDocumentLink] = []
    for sense in senses:
        document = parse_markdown_document(workspace / f"{sense.id}.md", extracted_at=built_at)
        entity_id = (
            "core.concept." + hashlib.sha256(f"medical.term.{sense.id}".encode()).hexdigest()[:24]
        )
        entities.append(
            KnowledgeEntity(
                id=entity_id,
                entity_type="medical-concept",
                canonical_name=sense.word,
                names=[KnowledgeName(name=sense.word, language="ru", name_type="preferred")],
                external_ids={"ruwiktionary-sense": sense.id},
                metadata={
                    "terminologyId": sense.id,
                    "reviewStatus": "proposed",
                    "referenceKind": "community-lexical-reference",
                },
            )
        )
        links.append(
            KnowledgeDocumentLink(
                id=f"terminology-link.{document.id}",
                entity_id=entity_id,
                document_id=document.id,
                document_version_id=document.version.id,
            )
        )
        for section in document.sections:
            if not section.title.startswith("Определение "):
                continue
            for chunk in section.chunks:
                facts.append(
                    KnowledgeFact(
                        id=f"terminology-definition.{chunk.id}",
                        entity_id=entity_id,
                        fact_type="definition",
                        text=chunk.original_text,
                        authority_tier="third-party",
                        evidence=[
                            KnowledgeEvidence(
                                document_id=document.id,
                                document_version_id=document.version.id,
                                section_id=section.id,
                                chunk_id=chunk.id,
                                quote=chunk.original_text,
                                source_locator={
                                    "url": sense.source_url,
                                    "line": sense.source_line,
                                    "senseIndex": sense.sense_index,
                                    "recordSha256": sense.record_sha256,
                                    "archiveSha256": sense.source_sha256,
                                },
                            )
                        ],
                        metadata={"clinicalApproval": False, "sourceBacked": True},
                    )
                )
    knowledge = KnowledgeWorkspace(entities=entities, facts=facts, document_links=links)
    (workspace / "knowledge.json").write_text(knowledge.model_dump_json(by_alias=True), "utf-8")
    db = root / f"{pack_id}.db"
    pack, report = build_content_pack(
        workspace,
        db,
        report_path=root / f"{pack_id}.report.json",
        include_embeddings=False,
    )
    compressed = _compress_database(db)
    membership_path = root / f"{pack_id}.membership.json"
    membership_path.write_bytes(
        json_bytes(
            [
                {
                    "documentId": d.id,
                    "documentVersionId": d.version.id,
                    "sourceChecksum": d.version.source_checksum,
                }
                for d in pack.documents
            ]
        )
    )
    return {
        "moduleId": pack_id,
        "title": title,
        "version": version,
        "database": db.name,
        "documents": report.documents,
        "chunks": report.chunks,
        "bytes": db.stat().st_size,
        "sha256": sha256_file(db),
        "gzipBytes": compressed.stat().st_size,
        "gzipSha256": sha256_file(compressed),
        "membership": membership_path.name,
        "membershipSha256": sha256_file(membership_path),
        "publicationState": "published",
        "downloadUrl": None,
    }


def build_russian_dictionary(
    prepared: Path, output: Path, *, version: str, built_at: str
) -> dict[str, object]:
    """Build immutable, distributable data; does not itself publish or activate an app catalog."""
    if output.exists() or not version.strip() or not built_at.strip():
        raise ValueError("Choose a new output and explicit version/timestamp")
    report = json.loads((prepared / "report.json").read_text())
    source = RussianDictionarySource.model_validate_json((prepared / "source.json").read_text())
    path = prepared / "senses.jsonl"
    if sha256_file(path) != report["preparedSha256"]:
        raise ValueError("Prepared dictionary checksum mismatch")
    senses = [
        RussianDictionarySense.model_validate_json(line) for line in path.read_text().splitlines()
    ]
    if not senses or len({s.id for s in senses}) != len(senses):
        raise ValueError("Empty or duplicate dictionary senses")
    if any(s.source_sha256 != f"sha256:{source.sha256}" for s in senses):
        raise ValueError("Dictionary source fingerprint mismatch")
    for sense in senses:
        if not set(sense.subjects) <= set(SUBJECT_TITLES):
            raise ValueError("Unknown dictionary subject")
        expected_id = (
            "ruwikt."
            + hashlib.sha256(
                json_bytes([sense.word, sense.part_of_speech, sense.glosses])
            ).hexdigest()[:24]
        )
        if sense.id != expected_id:
            raise ValueError("Dictionary identity does not match source sense")
    senses.sort(key=lambda s: s.id)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent, prefix="russian-packs-") as name:
        root = Path(name) / "packs"
        root.mkdir()
        packs = [_build_pack(root, senses, INDEX_ID, version, built_at, discovery=True)]
        sections = []
        for subject, title in sorted(SUBJECT_TITLES.items()):
            members = [s for s in senses if subject in s.subjects]
            owned = [s for s in senses if sorted(s.subjects)[0] == subject]
            if owned:
                packs.append(
                    _build_pack(
                        root, owned, section_id(subject), version, built_at, discovery=False
                    )
                )
            sections.append(
                {
                    "id": subject,
                    "title": title,
                    "memberCount": len(members),
                    "memberTermIds": [s.id for s in members],
                    "ownerModuleIds": sorted({section_id(sorted(s.subjects)[0]) for s in members}),
                }
            )
        result: dict[str, object] = {
            "schemaVersion": 1,
            "version": version,
            "russianDefinitionCount": report["russianDefinitionCount"],
            "senses": len(senses),
            "source": source.model_dump(by_alias=True),
            "license": "CC-BY-SA-4.0",
            "authority": "community-lexical-reference",
            "packs": packs,
            "sections": sections,
            "runtimeChanged": False,
        }
        (root / "pack-size-report.json").write_bytes(json_bytes(result))
        # Distribute the adapted source data and attribution alongside the SQLite projections.
        (root / "senses.jsonl").write_bytes(path.read_bytes())
        (root / "source.json").write_bytes(json_bytes(source.model_dump(by_alias=True)))
        (root / "ATTRIBUTION.txt").write_text(
            ATTRIBUTION + "\nCC-BY-SA-4.0\n" + LICENSE_URL + "\n" + TERMS_URL + "\n"
            "Per-sense source URLs link the authors' history; "
            "exact source hashes/locators in senses.jsonl.\n"
            "Changes: selected medical senses, whitespace-normalized searchable projection.\n"
            "No generated definitions, imported quotations or clinical approval. "
            "Adapted data is CC-BY-SA-4.0.\n",
            encoding="utf-8",
        )
        root.rename(output)
    return result
