from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class PackManifest(CamelModel):
    id: str
    version: str
    schema_version: int = Field(ge=1)
    title: str
    built_at: str
    checksum: str = ""
    publication_state: Literal["local-dev", "published"] = "local-dev"


class SourceRights(CamelModel):
    owner: str
    license_id: str
    allows_offline_storage: bool = False
    allows_derivative_processing: bool = False
    allows_redistribution: bool = False
    attribution: str | None = None
    expires_at: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_identifiers(self) -> SourceRights:
        for label, value in (("owner", self.owner), ("license_id", self.license_id)):
            if not value.strip():
                raise ValueError(f"Source rights {label} must not be blank.")
        return self


class SourceProvenance(CamelModel):
    source_id: str
    publisher: str
    official_locator: str
    jurisdiction: str
    rights_status: Literal["verified", "unknown", "revoked"] = "unknown"
    rights: SourceRights
    raw_checksum: str | None = None

    @model_validator(mode="after")
    def validate_publishable_rights(self) -> SourceProvenance:
        for label, value in (
            ("source_id", self.source_id),
            ("publisher", self.publisher),
            ("official_locator", self.official_locator),
            ("jurisdiction", self.jurisdiction),
        ):
            if not value.strip():
                raise ValueError(f"Source provenance {label} must not be blank.")
        if self.rights_status == "verified" and not self.rights.allows_offline_storage:
            raise ValueError("Verified source rights must permit offline storage.")
        return self


class SourceMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str
    short_title: str | None = None
    version_label: str
    source_type: str
    status: str
    specialties: list[str] = Field(default_factory=list)
    age_groups: list[str] = Field(default_factory=list)
    effective_from: str | None = None
    effective_to: str | None = None
    source_file: str | None = None
    source_checksum: str | None = None
    synthetic_fixture: bool = False
    metadata: dict[str, object] = Field(default_factory=dict)


class PackChunk(CamelModel):
    id: str
    order_index: int = Field(ge=0)
    original_text: str
    normalized_text: str
    page_start: int | None = None
    page_end: int | None = None
    char_start: int | None = None
    char_end: int | None = None
    anchor: str
    metadata: dict[str, object] = Field(default_factory=dict)


class PackSection(CamelModel):
    id: str
    parent_section_id: str | None = None
    title: str
    normalized_title: str
    section_type: str | None = None
    depth: int = Field(ge=1)
    order_index: int = Field(ge=0)
    page_start: int | None = None
    page_end: int | None = None
    anchor: str
    section_path: list[str]
    chunks: list[PackChunk]


class PackVersion(CamelModel):
    id: str
    label: str
    effective_from: str | None = None
    effective_to: str | None = None
    source_checksum: str
    extracted_at: str


class PackDocument(CamelModel):
    id: str
    title: str
    short_title: str | None = None
    source_type: str
    status: str
    specialties: list[str]
    metadata: dict[str, object]
    version: PackVersion
    sections: list[PackSection]


class Alias(CamelModel):
    id: str
    canonical_term: str
    alias: str
    category: str | None = None
    weight: float = Field(default=1.0, gt=0)


class EmbeddingProfile(CamelModel):
    id: str
    dimensions: int = Field(gt=0)
    vector_format: Literal["int8"] = "int8"
    normalization: Literal["l2"] = "l2"
    generator: str
    generator_version: str
    fingerprint: str
    metadata: dict[str, object] = Field(default_factory=dict)


class ChunkEmbedding(CamelModel):
    profile_id: str
    chunk_id: str
    values: list[int]
    norm: float = Field(ge=0)

    @model_validator(mode="after")
    def validate_int8_values(self) -> ChunkEmbedding:
        if any(value < -127 or value > 127 for value in self.values):
            raise ValueError("Embedding values must fit signed int8 without -128.")
        return self


class ContentPack(CamelModel):
    manifest: PackManifest
    documents: list[PackDocument]
    aliases: list[Alias] = Field(default_factory=list)
    embedding_profiles: list[EmbeddingProfile] = Field(default_factory=list)
    embeddings: list[ChunkEmbedding] = Field(default_factory=list)


class BuildReport(CamelModel):
    documents: int
    sections: int
    chunks: int
    aliases: int
    embedding_profiles: int
    embeddings: int
    warnings: list[str]
    errors: list[str]
    output_checksum: str
    sqlite_integrity: str
    foreign_key_violations: int


class ExtractionOptions(CamelModel):
    top_margin_ratio: float = Field(default=0.12, ge=0, le=0.35)
    bottom_margin_ratio: float = Field(default=0.10, ge=0, le=0.35)
    repeated_block_page_ratio: float = Field(default=0.50, gt=0, le=1)
    min_repeated_pages: int = Field(default=2, ge=2)
    min_page_characters: int = Field(default=40, ge=0)
    min_heading_font_ratio: float = Field(default=1.12, ge=1)
    max_heading_characters: int = Field(default=180, ge=20)
    remove_repeated_marginalia: bool = True
    join_hyphenated_lines: bool = True
    ocr_fallback: bool = True
    ocr_language: str = "rus+eng"
    ocr_dpi: int = Field(default=200, ge=72, le=600)

    @model_validator(mode="after")
    def validate_margins(self) -> ExtractionOptions:
        if self.top_margin_ratio + self.bottom_margin_ratio >= 0.75:
            raise ValueError("Top and bottom margins leave too little page body.")
        return self


class RegistryPack(CamelModel):
    id: str
    version: str
    schema_version: int = Field(default=2, ge=1)
    title: str
    built_at: str
    publication_state: Literal["local-dev", "published"] = "local-dev"


class RegistrySource(CamelModel):
    id: str
    path: str
    title: str
    short_title: str | None = None
    version_label: str
    source_type: str = "clinical_recommendation"
    status: str = "draft"
    specialties: list[str] = Field(default_factory=list)
    age_groups: list[str] = Field(default_factory=list)
    effective_from: str | None = None
    effective_to: str | None = None
    format: Literal["auto", "pdf", "text", "markdown", "html", "clinical_json"] = "auto"
    extraction: ExtractionOptions = Field(default_factory=ExtractionOptions)
    provenance: SourceProvenance | None = None
    metadata: dict[str, object] = Field(default_factory=dict)


class SourceRegistry(CamelModel):
    pack: RegistryPack
    sources: list[RegistrySource]
    aliases: list[Alias] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_unique_sources(self) -> SourceRegistry:
        ids = [source.id for source in self.sources]
        if len(ids) != len(set(ids)):
            raise ValueError("Source registry contains duplicate source ids.")
        paths = [source.path for source in self.sources]
        if len(paths) != len(set(paths)):
            raise ValueError("Source registry contains duplicate source paths.")
        if not self.sources:
            raise ValueError("Source registry must contain at least one source.")
        if self.pack.publication_state == "published":
            for source in self.sources:
                provenance = source.provenance
                if provenance is None:
                    raise ValueError(f"Published source {source.id} has no typed provenance.")
                if provenance.rights_status != "verified":
                    raise ValueError(
                        f"Published source {source.id} rights are {provenance.rights_status}."
                    )
                if not provenance.rights.allows_redistribution:
                    raise ValueError(
                        f"Published source {source.id} does not permit redistribution."
                    )
        return self


BlockKind = Literal[
    "heading",
    "paragraph",
    "list",
    "table_candidate",
    "image",
    "repeated_marginalia",
    "noise",
]


class ExtractedBlock(CamelModel):
    id: str
    page: int | None = None
    order_index: int = Field(ge=0)
    kind: BlockKind
    text: str
    bbox: list[float] | None = None
    font_size: float | None = None
    font_name: str | None = None
    bold: bool = False
    heading_level: int | None = Field(default=None, ge=1, le=6)
    line_count: int = Field(default=1, ge=1)
    removed: bool = False
    metadata: dict[str, object] = Field(default_factory=dict)


class ExtractedPage(CamelModel):
    page: int = Field(ge=1)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    blocks: list[ExtractedBlock]
    character_count: int = Field(ge=0)
    low_text: bool = False


class ExtractionDiagnostics(CamelModel):
    source_checksum: str
    source_format: Literal["pdf", "text", "markdown", "html", "clinical_json"]
    page_count: int = Field(ge=0)
    block_count: int = Field(ge=0)
    included_block_count: int = Field(ge=0)
    character_count: int = Field(ge=0)
    low_text_pages: list[int] = Field(default_factory=list)
    removed_repeated_blocks: int = Field(ge=0)
    heading_candidates: int = Field(ge=0)
    table_candidates: int = Field(ge=0)
    body_font_size: float | None = None
    text_extraction_mode: Literal["pdf_text_layer", "ocr"] = "pdf_text_layer"
    quality_score: float = Field(ge=0, le=1)
    requires_review: bool
    review_reasons: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ExtractedSource(CamelModel):
    schema_version: int = Field(default=2, ge=1)
    source_file: str
    source_checksum: str
    source_format: Literal["pdf", "text", "markdown", "html", "clinical_json"]
    pages: list[ExtractedPage]
    diagnostics: ExtractionDiagnostics


class PreparedSourceReport(CamelModel):
    source_id: str
    source_file: str
    markdown_file: str
    extraction_file: str
    diagnostic_file: str
    source_checksum: str
    included_blocks: int = Field(ge=0)
    pages: int = Field(ge=0)
    requires_review: bool
    warnings: list[str] = Field(default_factory=list)


class PrepareReport(CamelModel):
    pack_id: str
    pack_version: str
    sources: int = Field(ge=0)
    review_required: int = Field(ge=0)
    warnings: list[str] = Field(default_factory=list)
    prepared: list[PreparedSourceReport] = Field(default_factory=list)
