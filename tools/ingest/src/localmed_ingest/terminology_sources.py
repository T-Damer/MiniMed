"""Explicit, free public-source collection; no model provider or clinical input is used."""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from urllib.parse import urlencode

import yaml

from .models import SourceProvenance, SourceRights
from .source_sync import sync_source_manifest
from .terminology_models import TerminologySource, TerminologySources

NLM_TERMS = "https://www.nlm.nih.gov/databases/download/terms_and_conditions_mesh.html"
NLM_ATTRIBUTION = "Courtesy of the U.S. National Library of Medicine"
WIKIDATA_TERMS = "https://www.wikidata.org/wiki/Wikidata:Licensing"
WIKIDATA_QUERY = """PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?item ?mesh ?label WHERE {
  ?item wdt:P486 ?mesh; rdfs:label ?label.
  FILTER(STRSTARTS(?mesh, "D") && LANG(?label) = "ru")
} LIMIT 250001"""
MAX_WIKIDATA_ROWS = 250000


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()


def source_path(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root.resolve()) or candidate == root.resolve():
        raise ValueError("Terminology source path escapes the collection root.")
    if not candidate.is_file():
        raise ValueError(f"Terminology input is missing: {relative}")
    return candidate


def read_sources(root: Path) -> TerminologySources:
    manifest = TerminologySources.model_validate_json((root / "sources.json").read_text("utf-8"))
    for source in manifest.sources:
        if sha256_file(source_path(root, source.path)) != source.sha256:
            raise ValueError(f"Terminology checksum mismatch: {source.id}")
        rights = source.provenance.rights
        if source.provenance.rights_status == "revoked":
            raise ValueError(f"Revoked terminology source: {source.id}")
        if not rights.allows_offline_storage or not rights.allows_derivative_processing:
            raise ValueError(f"Terminology source lacks offline/processing permission: {source.id}")
    return manifest


def collect_terminology(
    output: Path,
    cache_root: Path,
    *,
    year: int = 2026,
    network: bool = False,
    with_wikidata: bool = False,
    offline: bool = False,
) -> TerminologySources:
    if year < 2020 or year > 2099:
        raise ValueError("A supported explicit MeSH production year is required.")
    if offline:
        manifest = read_sources(output)
        mesh = next(source for source in manifest.sources if source.format == "mesh-descriptors")
        if mesh.edition != str(year):
            raise ValueError("Cached terminology edition does not match the requested year.")
        if with_wikidata and not any(s.format == "wikidata-ru" for s in manifest.sources):
            raise ValueError("The offline collection does not contain Russian Wikidata labels.")
        return manifest
    if not network:
        raise ValueError(
            "Public downloads require --network; use --offline to verify saved inputs."
        )
    if output.exists():
        raise ValueError("Collection output already exists. Use --offline or a new snapshot path.")
    output.parent.mkdir(parents=True, exist_ok=True)
    mesh_url = f"https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc{year}.gz"
    plans: list[dict[str, object]] = [
        {
            "id": f"nlm-mesh-{year}",
            "location": mesh_url,
            "target": f"desc{year}.gz",
            "content_type": "binary",
            "max_bytes": 64 * 1024 * 1024,
        }
    ]
    if with_wikidata:
        plans.append(
            {
                "id": "wikidata-ru",
                "location": "https://query.wikidata.org/sparql?"
                + urlencode({"query": WIKIDATA_QUERY, "format": "json"}),
                "target": "wikidata-ru.json",
                "content_type": "text",
                "max_bytes": 64 * 1024 * 1024,
            }
        )
    with tempfile.TemporaryDirectory(prefix="terminology-collect-", dir=output.parent) as temporary:
        staging = Path(temporary) / "snapshot"
        sync_manifest = Path(temporary) / "sync.yaml"
        sync_manifest.write_text(yaml.safe_dump({"version": 1, "sources": plans}), "utf-8")
        report = sync_source_manifest(sync_manifest, staging, cache_root, timeout_seconds=60)
        sources: list[TerminologySource] = []
        for synced in report.sources:
            is_mesh = synced.id.startswith("nlm-mesh-")
            checksum = "sha256:" + synced.sha256.removeprefix("sha256:")
            publisher = "U.S. National Library of Medicine" if is_mesh else "Wikidata contributors"
            sources.append(
                TerminologySource(
                    id=synced.id,
                    format="mesh-descriptors" if is_mesh else "wikidata-ru",
                    path=synced.target,
                    edition=str(year) if is_mesh else report.generated_at,
                    sha256=checksum,
                    provenance=SourceProvenance(
                        source_id=synced.id,
                        publisher=publisher,
                        official_locator=mesh_url if is_mesh else synced.location,
                        jurisdiction="US" if is_mesh else "international",
                        raw_checksum=checksum,
                        rights_status="verified",
                        rights=SourceRights(
                            owner=publisher,
                            license_id="NLM-MeSH-terms" if is_mesh else "CC0-1.0",
                            allows_offline_storage=True,
                            allows_derivative_processing=True,
                            allows_redistribution=True,
                            attribution=NLM_ATTRIBUTION
                            if is_mesh
                            else "Wikidata (CC0); unreviewed name candidates, "
                            "not clinical definitions.",
                            notes=NLM_TERMS if is_mesh else WIKIDATA_TERMS,
                        ),
                    ),
                )
            )
        manifest = TerminologySources(sources=sources)
        (staging / "sources.json").write_text(
            manifest.model_dump_json(by_alias=True, indent=2) + "\n", "utf-8"
        )
        (staging / "source-sync-report.json").write_text(
            report.model_dump_json(indent=2) + "\n", "utf-8"
        )
        (staging / "ATTRIBUTION.txt").write_text(
            f"{NLM_ATTRIBUTION}\nMeSH production year: {year}. "
            "This snapshot may not reflect the latest NLM data.\n"
            f"No NLM endorsement is implied. Source conditions: {NLM_TERMS}\n"
            f"Optional Wikidata names: CC0-1.0, {WIKIDATA_TERMS}. Not clinical definitions.\n",
            "utf-8",
        )
        # Validate before atomically exposing a resumable collection.
        read_sources(staging)
        staging.rename(output)
    return manifest


def json_object(value: object, context: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {context}.")
    return {str(key): item for key, item in value.items()}


def json_list(value: object, context: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"Expected a JSON list: {context}.")
    return list(value)


def read_json(path: Path) -> object:
    return json.loads(path.read_text("utf-8"))
