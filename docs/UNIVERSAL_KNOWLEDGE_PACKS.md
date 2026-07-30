# Universal knowledge packs

MiniMed already implements an offline-first document runtime: downloadable SQLite modules, FTS5 and deterministic vector retrieval, exact source navigation, personal notes, and optional browser-local GGUF inference. This document defines the domain-neutral layer that can later be extracted into L-Note.

## Goal

A user installs only the knowledge packs they need. Search and source reading remain available offline. Packs may be produced by the project toolchain, by a third party, or by a user on a local computer or server.

```text
catalog
  -> selected pack download
  -> checksum and schema verification
  -> local installation
  -> lexical/vector retrieval
  -> linked entities, claims and evidence
  -> optional local model synthesis
```

## Pack boundary

A pack contains six independent but connected layers:

1. source documents and versions;
2. sections and addressable text chunks;
3. aliases and abbreviations;
4. entities;
5. evidence-linked claims and claim-to-claim links;
6. optional embeddings.

Generation never replaces source text. Every claim must include at least one exact evidence locator containing a document, chunk, quote and anchor.

## Domain-neutral records

### Entity

An entity is a stable concept, person, organization, product, place, procedure, rule or other pack-defined type. Entity types are strings so a pack can introduce its own ontology without changing the application.

### Claim

A claim describes a subject, predicate and either another entity or a typed value. Qualifiers hold scope such as population, jurisdiction, operating system, date or experimental conditions.

Claims distinguish four source kinds:

- `reference`: reviewed reference material;
- `personal`: a user observation or note;
- `computed`: deterministic or model-assisted derived data;
- `imported`: structured external data.

Reference and personal claims are not silently merged. `claimLinks` represent `supports`, `contradicts`, `refines`, `supersedes` and `duplicates` relationships.

### Relation

Relations provide lightweight graph navigation between entities. They may have their own evidence or act as pack-authored navigation edges.

## Update and override policy

Reference packs are immutable after publication. A new release installs beside the previous version until validation succeeds. User notes and user claims live in a separate local store and survive pack replacement.

A personal claim may refine or contradict a reference claim. The UI must label both sources and apply an explicit ranking policy instead of deleting either record.

## Offline web target

The current web runtime is the first client:

- service worker application shell;
- IndexedDB or native storage for installed pack bytes;
- SQLite WASM for module search;
- local notes in device storage;
- optional browser-local GGUF model;
- no hosted query backend required.

The same pack contract is intended for a later Android-native client. Pack production stays outside the mobile device when expensive extraction or model work is required.

## User-produced packs

A future generic compiler should accept an authored intermediate directory and build the same SQLite artifact used by official packs:

```text
knowledge source files
  -> deterministic extraction and provenance
  -> optional local/remote LLM proposals
  -> schema and evidence validation
  -> review queue
  -> pack build and checksum
```

Provider integrations, including Replicate, must only produce proposed records. They cannot directly publish a pack or overwrite source text.

## Extraction path

The next implementation steps are:

1. persist entities, claims, relations and claim links in the SQLite builder;
2. expose read-only graph and claim queries through the core ports;
3. render entity backlinks, abbreviations and conflicting claims in the browser;
4. publish a small general-reference example pack beside the medical pack;
5. extract the contracts, storage and generic UI into `l-note` after that repository has an initial commit.
