# Reference sources: preserve concepts, qualify medical content

Latest user clarification: 2026-09-23. This document supersedes the earlier blanket
Wikipedia-exclusion wording in AGENTS.md, DEFINITION_REFERENCE_PLAN.md and historical
CURRENT_STATE.md sections. Work remains in draft PR #180, stacked on #174. Research notes
do not authorize a framework migration, automatic model download, merge or release.

## Names are not definitions

Do not remove a medical concept or useful search name merely because it was first discovered
in Wikipedia, Wiktionary or another general reference. Preserve its source-local identity,
name, explicitly evidenced variants and discovery provenance. These are vocabulary/discovery
records, not automatically reviewed canonical concepts, synonyms or diagnostic facts.

The user prefers medical definitions, criteria, classifications and scale content from clinical
recommendations, medical dictionaries, textbooks, specialist sites, Russian clinics/polyclinics
and sources such as Krasota i Meditsina. A definition source and a name-discovery source can
therefore be different. Rejecting a definition must not delete the name or its coverage task.

Maintain separate, accurately counted states:

- A discovered name, with no adequate medical definition yet: retained, marked as needing a
  definition/source review, and never presented as a completed clinical card.
- A source-backed definition or instrument description, with author/date/version and exact
  location: available as an attributed draft, not automatically clinically reviewed.
- A reviewed canonical relationship or executable scale: requires its own evidence and checks.

A dictionary view can filter to completed definitions; it is not the entire knowledge base.
Do not repeat the earlier mistake of treating a narrower dictionary counter as the full concept
inventory. Short aliases, names of scales and source-specific senses must not disappear merely
because their records are not labelled `definition` or `explicit-definition`.

## Current implementation versus this policy

As of reviewed MiniMed head `e9966a3af8ac249217ae4917af528b8005e9037f`:

- The ordinary preparer defaults to a definitions-only projection: 8,410 candidates out of
  18,357 selected non-Wikipedia source/reference records, according to the dated build report.
- Earlier Wikipedia inputs (7,637 records) are preserved in authoring files and the archived
  `source-inputs.with-wikipedia-2026.09.22.json` manifest, but are absent from the active manifest.
- The code-level source policy still rejects Wikipedia content inputs. This prevents accidental
  reinstatement of those clinical texts; it does not implement the required name-discovery path.

This documentation correction is not a claim that those names are already restored to the app.
Next content work must recover the names with provenance, without copying old wiki medical
bodies into the preferred-definition layer or padding the definition counter with empty cards.
Keep input snapshots and old measurements intact. Report restored names and acquired medical
definitions separately, and test both missing-definition and ambiguous-name cases.

## Medical source selection

Select the actual passage needed, not the prestige of a domain or the length of an article.
A clear attributed definition on a Russian clinic site may be more useful for a term card than
a journal research article that only mentions it. Clinical recommendations, named teaching
works, medical dictionaries, specialty societies, journals and suitable secondary medical sites
are all eligible acquisition candidates. No entire domain is automatically medically approved.

For each source retain available author/editor, date/edition, specialty, intended audience,
patient group, classification/scale version and references. Record missing fields as missing.
Keep source-fidelity review, medical review and redistribution status separate. A `requires-review`
badge is not a substitute for any of these checks.

Use recommendations and original instrument publications for rules and scoring where available.
A clinic's explanation may support a definition without establishing a validated scoring cutoff.
Original research findings, one author's classification and historical teaching language remain
explicitly attributed rather than becoming universal current clinical rules.

Previously checked candidate families include the NCPZ library, named medical university
materials, the journal Psychiatry, S. S. Korsakov Journal of Neurology and Psychiatry,
Psychiatry and Psychopharmacotherapy/Consilium Medicum, RMJ, Lechaschi Vrach, official clinical
recommendations and Krasota i Meditsina. These are candidates, not a claim of complete collection,
current endorsement or blanket redistribution clearance. Clinic/polyclinic sites are now
explicit candidates too. New acquisition should close named definition gaps, not grow article counts.

## Uploaded sources belong to the same knowledge-base pipeline

The user does not want a separate personal ZIP/viewer workflow as the endpoint. Prepared material
from supplied textbooks and pediatric scales must feed the same source registry, concept/term
identities, definition blocks, instrument records, citations and normal search/reader used by the
rest of MiniMed. Do not build a second personal dictionary, storage owner or disconnected corpus.

Intended flow:

```text
supplied or acquired source
  -> checksum-bound preparation and source/rights record
  -> candidate definitions / instrument structure / source annotations
  -> existing knowledge-base build and review queue
  -> normal MiniMed lookup and source reader
```

A source-specific acquisition adapter is fine; a separate source-specific product is not.
Definition, terminology, scale, history and etymology views may share the same base without
being conflated. Downloadable content modules may still follow the existing installer, but
users should not have to assemble ad hoc personal archives to use contributed knowledge.

Integration into the knowledge base and public redistribution are different decisions. Preserve
original files and extraction fidelity; do not automatically publish a supplied book, derived
full text, patient data or restricted instrument in a public repository/CI. Source rights and
export eligibility remain metadata/gates of the unified pipeline, not a reason to strand content
in a separate viewer. An integrated local build can use the same schema and search without
claiming the source is cleared for a public release.

This policy does not claim that previous private packages were imported into the active build.
That integration, its source receipt validation and a real normal-reader test remain work to do.
Do not report delivery of another ZIP as completion of that work.

## Preserve source meaning and structure

Keep exact definition text, source-specific senses, complete criterion lists and necessary
qualifications. Preserve table cells, ordering, units, age groups, notes and version boundaries.
Do not silently replace a source classification with another school's scheme or a model's
preferred wording. Conflicting sources stay separately attributed; no synthetic consensus.

For the supplied Semenov/Bersenev textbook, retain its 2006 organization and terminology, not an
unlabelled modernization. For the pediatric slides, distinguish the named NICE table, the Yale
Observation Scale presentation and the separate biomarker algorithm. The latter does not acquire
NICE authority simply because it appears in the same PDF. Source interpretations are not
validated executable decisions merely because extraction is accurate.

For instruments distinguish name/mention, description, complete form, scoring instructions and
reviewed executable implementation. Historical person identity, eponym attribution and priority
of discovery are separate claims. Etymology needs source-supported language, spelling and sense;
never infer a root from superficial letter similarity. Missing information remains a gap.

## Storage, evaluation and reporting boundaries

Use existing numeric source/block references and immutable source receipts. Do not duplicate
bibliography on every term, require whole books to display short definitions, or load the whole
corpus into UI memory. Respect access rules and do not evade authentication/paywalls or invent
unavailable full text. This is a content-policy correction, not a storage framework replacement.

Measure restored names, previously missing definitions, fuller source variants, complete
instrument sections and unresolved items separately. Same title is not proof of equivalence.
Content coverage, exact-name lookup, reverse-description retrieval and clinical evidence support
are distinct evaluations. Models may assist selection experimentally; their scores do not change
source authenticity, clinical review, quotation fidelity or publication eligibility.
