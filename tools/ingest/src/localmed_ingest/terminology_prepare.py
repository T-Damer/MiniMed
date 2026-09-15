"""Placement-neutral discovery/section plan over a single canonical terminology vocabulary."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import tempfile
from collections import defaultdict
from pathlib import Path

from .terminology_mesh import evidence, parse_mesh
from .terminology_models import (
    LocalizedConcept,
    MedicalTerm,
    TermDefinition,
    TerminologyReview,
    TerminologySource,
    TerminologySources,
    TermName,
    TermSection,
)
from .terminology_sources import (
    MAX_WIKIDATA_ROWS,
    json_list,
    json_object,
    read_json,
    read_sources,
    sha256_file,
    source_path,
)


def json_bytes(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode("utf-8")


def term_document_id(term: MedicalTerm) -> str:
    return f"medical.term.{term.id}"


def module_id(section: str) -> str:
    return f"minimed.terminology.mesh.{section.lower()}"


def term_sections(term: MedicalTerm) -> list[str]:
    return sorted({number.split(".")[0] for number in term.tree_numbers}) or ["unclassified"]


def _binding(row: dict[str, object], field: str, language: str | None = None) -> str:
    value = json_object(row.get(field), field)
    text = value.get("value")
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"Empty Wikidata binding: {field}.")
    if language is not None and (
        value.get("xml:lang") != language or value.get("type") != "literal"
    ):
        raise ValueError("Wikidata label language/type does not match the Russian query.")
    return text


def apply_wikidata_names(
    terms: list[MedicalTerm],
    path: Path,
    source: TerminologySource,
) -> list[TerminologyReview]:
    payload = json_object(read_json(path), "Wikidata response")
    rows = json_list(
        json_object(payload.get("results"), "Wikidata results").get("bindings"), "bindings"
    )
    if len(rows) > MAX_WIKIDATA_ROWS:
        raise ValueError(
            "Wikidata result reached the row ceiling; do not use a truncated vocabulary."
        )
    preferred = {descriptor: term for term in terms for descriptor in term.preferred_for}
    candidates: dict[str, dict[str, list[tuple[str, str, int]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    item_descriptors: dict[str, set[str]] = defaultdict(set)
    for index, value in enumerate(rows):
        row = json_object(value, f"Wikidata row {index}")
        descriptor = _binding(row, "mesh")
        item = _binding(row, "item")
        if (
            re.fullmatch(r"D[0-9]+", descriptor) is None
            or re.fullmatch(r"https?://www.wikidata.org/entity/Q[0-9]+", item) is None
        ):
            raise ValueError("Unexpected Wikidata MeSH/entity identifier.")
        label = _binding(row, "label", "ru")
        candidates[descriptor][item].append((label, "candidate-label", index))
        if "alias" in row:
            candidates[descriptor][item].append(
                (_binding(row, "alias", "ru"), "candidate-alias", index)
            )
        item_descriptors[item].add(descriptor)
    reviews: list[TerminologyReview] = []
    for descriptor, items in sorted(candidates.items()):
        term = preferred.get(descriptor)
        if term is None:
            reviews.append(
                TerminologyReview(
                    reason="wikidata-unmatched-descriptor",
                    source_id=source.id,
                    details={"descriptorId": descriptor},
                )
            )
            continue
        if len(items) != 1 or any(len(item_descriptors[item]) != 1 for item in items):
            reviews.append(
                TerminologyReview(
                    reason="wikidata-ambiguous-crosswalk",
                    term_ids=[term.id],
                    source_id=source.id,
                    details={"descriptorId": descriptor, "items": sorted(items)},
                )
            )
            continue
        item, names = next(iter(items.items()))
        labels = {text for text, kind, _ in names if kind == "candidate-label"}
        if len(labels) != 1:
            reviews.append(
                TerminologyReview(
                    reason="wikidata-conflicting-labels", term_ids=[term.id], source_id=source.id
                )
            )
            continue
        seen: set[tuple[str, str]] = set()
        for text, kind, index in names:
            if (text, kind) in seen:
                continue
            seen.add((text, kind))
            term.names.append(
                TermName(
                    text=text,
                    language="ru",
                    kind="candidate-label" if kind == "candidate-label" else "candidate-alias",
                    external_id=item.rsplit("/", 1)[-1],
                    evidence=evidence(
                        source,
                        f"/results/bindings/{index}/"
                        + ("label" if kind == "candidate-label" else "alias"),
                    ),
                )
            )
    return reviews


def apply_localized_concepts(
    terms: list[MedicalTerm],
    path: Path,
    source: TerminologySource,
) -> list[TerminologyReview]:
    """A supplied, rights-declared normalized export; text is never machine-translated here."""
    by_id = {term.mesh_concept_id: term for term in terms}
    seen: set[str] = set()
    for index, line in enumerate(path.read_text("utf-8").splitlines()):
        if not line.strip():
            continue
        record = LocalizedConcept.model_validate_json(line)
        if record.concept_id in seen:
            raise ValueError(f"Duplicate localized concept: {record.concept_id}")
        seen.add(record.concept_id)
        term = by_id.get(record.concept_id)
        if term is None:
            raise ValueError(f"Localized concept is absent from MeSH: {record.concept_id}")
        for text, kind in [
            (record.preferred_name, "preferred"),
            *((name, "alias") for name in record.aliases),
        ]:
            if not text.strip():
                raise ValueError("A localized concept name must not be blank.")
            term.names.append(
                TermName(
                    text=text,
                    language="ru",
                    kind="preferred" if kind == "preferred" else "alias",
                    evidence=evidence(source, f"line:{index + 1}"),
                )
            )
        if record.definition is not None:
            term.definitions.append(
                TermDefinition(
                    text=record.definition,
                    language="ru",
                    kind="source-definition",
                    evidence=evidence(source, f"line:{index + 1}/definition"),
                )
            )
    return []


def display_name(term: MedicalTerm) -> TermName:
    return min(
        term.names,
        key=lambda n: (
            0
            if n.language == "ru" and n.kind == "preferred"
            else 1
            if n.language == "ru" and n.kind == "candidate-label"
            else 2
            if n.kind == "preferred"
            else 3,
            n.text,
            n.evidence.source_id,
            n.evidence.locator,
        ),
    )


def definition(term: MedicalTerm) -> TermDefinition | None:
    return (
        min(
            term.definitions,
            key=lambda d: (
                d.language != "ru",
                d.language,
                d.evidence.source_id,
                d.evidence.locator,
            ),
        )
        if term.definitions
        else None
    )


def _sections(terms: list[MedicalTerm]) -> list[TermSection]:
    members: dict[str, list[str]] = defaultdict(list)
    owners: dict[str, str] = {}
    labels: dict[str, str] = {}
    for term in terms:
        sections = term_sections(term)
        owners[term.id] = sections[0]
        for section in sections:
            members[section].append(term.id)
            if section in term.tree_numbers and term.preferred_for:
                labels.setdefault(section, display_name(term).text)
    result: list[TermSection] = []
    for section, ids in sorted(members.items()):
        # MeSH F is explicitly the Psychiatry and Psychology category. This is a navigation tag,
        # not a clinical inference or an exclusive assignment of the concept to one specialty.
        specialties = (
            ["psychiatry", "psychology"] if section.startswith("F") else ["medical-reference"]
        )
        result.append(
            TermSection(
                id=section,
                label=labels.get(section, section),
                specialties=specialties,
                owned_term_ids=sorted(term_id for term_id in ids if owners[term_id] == section),
                member_term_ids=sorted(ids),
                required_module_ids=sorted({module_id(owners[i]) for i in ids}),
            )
        )
    return result


def _write_jsonl(path: Path, records: list[dict[str, object]]) -> dict[str, object]:
    with path.open("wb") as stream:
        for record in records:
            stream.write(json_bytes(record))
    data = path.read_bytes()
    zipped = gzip.compress(data, mtime=0)
    path.with_suffix(path.suffix + ".gz").write_bytes(zipped)
    return {
        "path": path.name,
        "bytes": len(data),
        "gzipBytes": len(zipped),
        "sha256": "sha256:" + hashlib.sha256(data).hexdigest(),
        "gzipSha256": "sha256:" + hashlib.sha256(zipped).hexdigest(),
    }


def read_terms(root: Path) -> tuple[list[MedicalTerm], TerminologySources, list[TermSection]]:
    manifest = TerminologySources.model_validate_json((root / "sources.json").read_text("utf-8"))
    report = json_object(read_json(root / "size-report.json"), "size report")
    artifacts = json_object(report.get("artifacts"), "artifact report")
    entry = json_object(artifacts.get("terms"), "term artifact")
    if sha256_file(root / "sources.json") != report.get("sourcesSha256"):
        raise ValueError("Prepared terminology sources manifest checksum mismatch.")
    for source in manifest.sources:
        rights = source.provenance.rights
        if (
            source.provenance.rights_status == "revoked"
            or not rights.allows_offline_storage
            or not rights.allows_derivative_processing
        ):
            raise ValueError("Prepared terminology source is not eligible for processing.")
    data = (root / "terms.jsonl").read_bytes()
    if "sha256:" + hashlib.sha256(data).hexdigest() != entry.get("sha256"):
        raise ValueError("Prepared terminology checksum mismatch.")
    terms = [MedicalTerm.model_validate_json(line) for line in data.splitlines() if line]
    if not terms or len({term.id for term in terms}) != len(terms):
        raise ValueError("Prepared terminology requires unique concepts.")
    by_source = {source.id: source for source in manifest.sources}
    ids = {term.id for term in terms}
    for term in terms:
        for item in [*term.names, *term.definitions, *term.relations]:
            source = by_source.get(item.evidence.source_id)
            if (
                source is None
                or item.evidence.source_checksum != source.sha256
                or item.evidence.source_url != source.provenance.official_locator
            ):
                raise ValueError("Prepared term evidence does not match its declared source.")
        if any(relation.object_id not in ids for relation in term.relations):
            raise ValueError("Prepared terminology has a dangling concept relation.")
    return terms, manifest, _sections(terms)


def prepare_terminology(input_root: Path, output: Path) -> dict[str, object]:
    if output.exists():
        raise ValueError("Prepared output exists; use a new immutable output path.")
    manifest = read_sources(input_root)
    mesh = next(s for s in manifest.sources if s.format == "mesh-descriptors")
    terms = parse_mesh(source_path(input_root, mesh.path), mesh)
    reviews: list[TerminologyReview] = []
    for source in manifest.sources:
        if source.format == "wikidata-ru":
            reviews.extend(
                apply_wikidata_names(terms, source_path(input_root, source.path), source)
            )
        elif source.format == "localized-concepts":
            apply_localized_concepts(terms, source_path(input_root, source.path), source)
    sections = _sections(terms)
    discovery: list[dict[str, object]] = []
    for term in terms:
        primary = term_sections(term)[0]
        chosen = display_name(term)
        chosen_definition = definition(term)
        discovery.append(
            {
                "id": term.id,
                "documentId": term_document_id(term),
                "name": chosen.text,
                "nameLanguage": chosen.language,
                "nameStatus": chosen.kind,
                "names": sorted({n.text for n in term.names}),
                "definition": chosen_definition.model_dump(by_alias=True)
                if chosen_definition
                else None,
                "sections": term_sections(term),
                "primaryModuleId": module_id(primary),
                "descriptorIds": term.descriptor_ids,
                "definitionStatus": "source-backed" if chosen_definition else "missing-in-source",
            }
        )
        if not term.definitions:
            reviews.append(
                TerminologyReview(reason="missing-source-definition", term_ids=[term.id])
            )
        if len({d.text for d in term.definitions if d.language == "ru"}) > 1:
            reviews.append(
                TerminologyReview(reason="multiple-russian-definitions", term_ids=[term.id])
            )
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="terminology-prepare-", dir=output.parent) as temporary:
        staging = Path(temporary) / "prepared"
        staging.mkdir()
        full = _write_jsonl(
            staging / "terms.jsonl", [term.model_dump(by_alias=True) for term in terms]
        )
        core = _write_jsonl(staging / "core-discovery.jsonl", discovery)
        _write_jsonl(staging / "review.jsonl", [r.model_dump(by_alias=True) for r in reviews])
        (staging / "sources.json").write_text(
            manifest.model_dump_json(by_alias=True, indent=2) + "\n", "utf-8"
        )
        (staging / "sections.json").write_bytes(
            json_bytes([s.model_dump(by_alias=True) for s in sections])
        )
        by_id = {term.id: term for term in terms}
        by_discovery = {str(item["id"]): item for item in discovery}
        report: dict[str, object] = {
            "schemaVersion": 1,
            "meshEdition": mesh.edition,
            "sourcesSha256": sha256_file(staging / "sources.json"),
            "descriptors": len({d for t in terms for d in t.descriptor_ids}),
            "concepts": len(terms),
            "names": sum(len(t.names) for t in terms),
            "definitions": sum(len(t.definitions) for t in terms),
            "conceptsWithRussianNames": sum(
                any(n.language == "ru" for n in t.names) for t in terms
            ),
            "conceptsWithRussianDefinitions": sum(
                any(d.language == "ru" for d in t.definitions) for t in terms
            ),
            "conceptsWithoutDefinition": sum(not t.definitions for t in terms),
            "reviewTasks": len(reviews),
            "runtimeChanged": False,
            "artifacts": {"terms": full, "coreDiscovery": core},
            "sizeMeaning": "Measured UTF-8 JSONL and gzip bytes, "
            "not an estimated SQLite or APK size.",
            "sections": [
                {
                    "id": s.id,
                    "label": s.label,
                    "members": len(s.member_term_ids),
                    "owned": len(s.owned_term_ids),
                    "requiredModuleIds": s.required_module_ids,
                    "ownedJsonlBytes": sum(
                        len(json_bytes(by_id[i].model_dump(by_alias=True)))
                        for i in s.owned_term_ids
                    ),
                    "discoveryBytes": sum(
                        len(json_bytes(by_discovery[i])) for i in s.owned_term_ids
                    ),
                }
                for s in sections
            ],
        }
        (staging / "size-report.json").write_bytes(json_bytes(report))
        read_terms(staging)
        staging.rename(output)
    return report
