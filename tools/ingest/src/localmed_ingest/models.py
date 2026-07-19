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
    format: Literal["auto", "pdf", "text", "markdown"] = "auto"
    extraction: ExtractionOptions = Field(default_factory=ExtractionOptions)
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
        return self


BlockKind = Literal[
    "heading",
    "paragraph",
    "list",
    "table_candidate",
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
    source_format: Literal["pdf", "text", "markdown"]
    page_count: int = Field(ge=0)
    block_count: int = Field(ge=0)
    included_block_count: int = Field(ge=0)
    character_count: int = Field(ge=0)
    low_text_pages: list[int] = Field(default_factory=list)
    removed_repeated_blocks: int = Field(ge=0)
    heading_candidates: int = Field(ge=0)
    table_candidates: int = Field(ge=0)
    body_font_size: float | None = None
    quality_score: float = Field(ge=0, le=1)
    requires_review: bool
    review_reasons: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ExtractedSource(CamelModel):
    schema_version: int = Field(default=2, ge=1)
    source_file: str
    source_checksum: str
    source_format: Literal["pdf", "text", "markdown"]
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
