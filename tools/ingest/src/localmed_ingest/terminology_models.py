"""Build-time terminology records; reuse the existing provenance and knowledge contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from .models import CamelModel, SourceProvenance


class TerminologySource(CamelModel):
    id: str = Field(min_length=1)
    format: Literal["mesh-descriptors", "wikidata-ru", "localized-concepts"]
    path: str = Field(min_length=1)
    edition: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    provenance: SourceProvenance

    @model_validator(mode="after")
    def matching_provenance(self) -> TerminologySource:
        if self.provenance.source_id != self.id:
            raise ValueError("Terminology source/provenance IDs must match.")
        if self.provenance.raw_checksum != self.sha256:
            raise ValueError("Terminology raw checksum/provenance must match.")
        return self


class TerminologySources(CamelModel):
    schema_version: Literal[1] = 1
    sources: list[TerminologySource] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_sources(self) -> TerminologySources:
        for values in ([s.id for s in self.sources], [s.path for s in self.sources]):
            if len(values) != len(set(values)):
                raise ValueError("Duplicate terminology source ID or path.")
        if sum(s.format == "mesh-descriptors" for s in self.sources) != 1:
            raise ValueError("Exactly one MeSH descriptor edition is required.")
        return self


class TermEvidence(CamelModel):
    source_id: str
    source_checksum: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    source_url: str
    locator: str = Field(min_length=1)


class TermName(CamelModel):
    text: str = Field(min_length=1, max_length=2000)
    language: str = Field(pattern=r"^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$")
    kind: Literal["preferred", "alias", "candidate-label", "candidate-alias"]
    external_id: str | None = None
    evidence: TermEvidence


class TermDefinition(CamelModel):
    text: str = Field(min_length=1, max_length=100000)
    language: str = Field(pattern=r"^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$")
    kind: Literal["scope-note", "source-definition"]
    evidence: TermEvidence


class TermRelation(CamelModel):
    subject_id: str
    predicate: Literal["BRD", "NRW", "REL"]
    object_id: str
    evidence: TermEvidence


class MedicalTerm(CamelModel):
    id: str = Field(pattern=r"^mesh\.M[0-9]+$")
    mesh_concept_id: str = Field(pattern=r"^M[0-9]+$")
    descriptor_ids: list[str] = Field(min_length=1)
    preferred_for: list[str]
    names: list[TermName] = Field(min_length=1)
    definitions: list[TermDefinition]
    tree_numbers: list[str]
    semantic_types: list[str]
    relations: list[TermRelation]
    source_notes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def consistent_identity(self) -> MedicalTerm:
        if self.id != f"mesh.{self.mesh_concept_id}":
            raise ValueError("Terminology identity differs from its source ConceptUI.")
        if not set(self.preferred_for).issubset(self.descriptor_ids):
            raise ValueError("Preferred descriptor must be in concept membership.")
        if any(r.subject_id != self.id for r in self.relations):
            raise ValueError("Relation subject differs from the owning concept.")
        return self


class LocalizedConcept(CamelModel):
    """Normalized licensed/local export, not an invented universal MeSH-Russian XML format."""

    concept_id: str = Field(pattern=r"^M[0-9]+$")
    language: Literal["ru"] = "ru"
    preferred_name: str = Field(min_length=1, max_length=2000)
    aliases: list[str] = Field(default_factory=list)
    definition: str | None = Field(default=None, min_length=1, max_length=100000)


class TermSection(CamelModel):
    id: str = Field(pattern=r"^[A-Z][0-9]{2}$|^unclassified$")
    label: str
    specialties: list[str]
    owned_term_ids: list[str]
    member_term_ids: list[str]
    required_module_ids: list[str]


class TerminologyReview(CamelModel):
    reason: str
    term_ids: list[str] = Field(default_factory=list)
    source_id: str | None = None
    locator: str | None = None
    details: dict[str, object] = Field(default_factory=dict)
