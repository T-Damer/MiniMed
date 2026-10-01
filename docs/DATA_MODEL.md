# Data model

The canonical runtime schema is generated from `schema/sql/001_initial.sql` plus numbered migrations such as `schema/sql/002_embeddings.sql`. The SQLite database is
read-oriented. It stores original source text and structure; FTS5 is a derived index.

## Tables

### `content_packs`

One installed module or corpus release.

| Field | Meaning |
|---|---|
| `id` | Stable pack ID |
| `version` | Pack semantic version |
| `schema_version` | Required SQL schema |
| `checksum` | Deterministic content checksum |
| `installed_at` | Build/install timestamp |
| `enabled` | Runtime activation flag |

### `documents`

Stable identity and current version pointer.

Important fields: `id`, `content_pack_id`, `title`, `short_title`, `source_type`, `status`,
`specialty_json`, `metadata_json`, `current_version_id`.

### `document_versions`

Versioned source metadata. Updating a recommendation adds a version and changes the current pointer
instead of mutating historical identity.

### `sections`

Hierarchical document structure. `path_json` contains the complete human-readable heading path.
`anchor` is stable for deep links. `parent_section_id`, `depth`, and `order_index` preserve order.

### `chunks`

Searchable source fragments. A chunk stores:

- original text for rendering;
- normalized text for indexing;
- source section and document version;
- stable anchor;
- order index;
- previous and next chunk IDs;
- optional page and character ranges;
- technical metadata.

A chunk is not an LLM token. It is a stable, human-meaningful retrieval unit, usually one or more
paragraphs under a heading.

### `aliases`

Small, transparent query expansion dictionary. Examples include a colloquial phrase, abbreviation,
or trade name mapped to a canonical term. Aliases are part of the content pack and therefore
versionable and testable.

### `embedding_profiles`

Immutable description of one vector space. It freezes profile/model identity, revision, fingerprint,
dimensions, normalization, vector format, and whether the profile is a development scaffold or a
validated neural profile.

### `chunk_embeddings`

One vector per `(profile_id, chunk_id)`. The current alpha stores signed `int8` values as a BLOB plus
the vector norm. Corpus vectors are generated off-device; runtime computes only the user-query
vector. Foreign keys tie every vector back to an original source chunk.

### `chunks_fts`

Direct FTS5 index over:

- document title;
- section path;
- normalized chunk text.

Identity fields are `UNINDEXED`. The index can be deleted and rebuilt from relational data.

Since migration 010 the index is external-content over the `chunks_fts_source` view (no second copy
of the indexed strings). A finished **module** pack may additionally have `chunks.normalized_text`
emptied (`app_metadata.search_text_state = normalized-text-emptied`, migration 013 /
`medbase compact-module-search`, or `medbase build --compact-search-text`): the text is only read by
an index rebuild, nothing at runtime uses it, and such a pack refuses to be re-indexed or composed.
`original_text`, offsets, anchors and ids are never touched. Inputs of `compose` and of the core
build keep their normalized text.

## Stable identifiers

IDs are generated deterministically from document identity, heading path, and ordered text. Rebuilds
of unchanged input must preserve IDs and checksums. This is essential for bookmarks, diffs,
benchmark expectations, and later content-pack updates.

## Source anchors

A result resolves through this chain:

```text
SearchResult.chunkId
  -> chunks.section_id
  -> sections.document_version_id
  -> document_versions.document_id
  -> documents.id
```

The UI receives both the technical IDs and a stable anchor. Page numbers are optional metadata, not
the primary navigation mechanism, because PDF pagination can change across editions.

## Draft versus production

For the MVP, Markdown fixtures are authoring inputs and SQLite/JSON are generated outputs. When real
content processing grows, add a separate authoring database for extraction jobs and draft metadata.
Do not make the mobile runtime database the mutable editorial source of truth.

Recommended future split:

```text
authoring.db
  source documents / spans / extraction jobs / draft labels / conflicts

pack.db
  approved original text / structure / aliases / indexes
```

## Migrations

Every schema change requires:

1. a numbered SQL migration;
2. regenerated TypeScript schema source;
3. builder compatibility change;
4. storage adapter tests;
5. a documented content-pack compatibility decision.
