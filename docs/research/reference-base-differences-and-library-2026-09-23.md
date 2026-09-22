# Compact concept cards and the Med source folder

User decision, 23 September 2026. Same draft PR #180; search and content take priority over model experiments.

## One readable base, not repeated variants

Present one base definition for an explicitly established concept. Store the selected source-record
ID in `baseDefinitionRef`; do not copy the same definition into each classification variant.
For each genuine difference, keep a short `differences[]` record with classification name, edition,
jurisdiction/population, changed aspect, concise addition/exception and exact supporting references.
Resolve those references through the ordinary source registry. Hide this section until expanded.
Source text remains intact in authoring evidence; a readable summary is an explicitly editorial field.

Choose the base by documented suitability for the app's target use (Russian clinical practice for
relevant entries), source quality, definition completeness and edition. Do not claim 'most used'
without evidence, count duplicate web copies as popularity, or always choose the shortest text.
Equivalent wording needs extra citations, not extra displayed paragraphs. Materially different
meanings, instruments or versions must not be merged by their title alone.

An RF/WHO adaptation relationship must be documented for the particular classification. Store the
base and actual additions/changes, not an invented universal statement that all RF classifications
are WHO adaptations. Preserve incompatible criteria and populations; a compact card must not hide
clinically important distinctions. These presentation fields are an authoring contract/plan here,
not a claim that all existing source variants have already been clinically reconciled.

## Archive located in the repository description

The source folder is **`Med/`**, described in [LITERATURE_BANK.md](../LITERATURE_BANK.md), with
candidate priorities in [CONTENT_BACKLOG.md](../CONTENT_BACKLOG.md) and an extraction inventory in
[AMBULATORY_CORPUS_V1.md](../AMBULATORY_CORPUS_V1.md). The folder itself is not committed to Git.
The user states their archive is 12 GB; the documentation identifies the folder and contents, not
an independently measured 12 GB archive available to this runner.

Relevant already-described paths include:

- `Med/ПДБ/PDB_Kapitan_n.pdf` (PDF counterpart of the originally listed DjVu).
- `Med/ПДБ/pochivalov-_db_uchebnik.pdf` and `Med/ПДБ/ПДБМетодичка_less.pdf`.
- `Med/Психиатрия/obschaya_psikhopatologia_2.pdf` (listed by the existing extraction scripts).
- `Med/Нео/Литература/` (Шабалов, Володин and Гомелла editions; inspect actual files before citing).
- `Med/Поликлиника/Тесты поликлиника 2012/НПР.doc` and the child-health-assessment document.

The old literature-bank exclusions reflect a pediatric-calculator milestone, not the present
broad terminology scope. Anatomy, physiology, pathology, microbiology, pharmacology and Latin
materials can now supply definitions/etymology when the actual author/edition/source is identified.
Administrative coursework remains outside clinical content unless a separately requested use exists.

Do not ask for the whole 12 GB merely to start. First use the existing inventory, select relevant
books/chapters, and read native text. Inspect page images for tables and damaged text; OCR is a last
resort. Existing OCR drafts are candidates requiring source verification, not newly acquired texts.
Their documented local paths do not prove that bytes are in Git or accessible in this environment.
The ordinary knowledge pipeline is the destination; another standalone personal ZIP is not delivery.

## Current implementation priorities

1. Preserve discovered names independently of medical definition sources. Restore archived name
   identities with `needs-definition`, not Wikipedia prose or fabricated medical definitions.
2. Fill actual definition gaps from suitable Russian medical sources and selected Med materials.
3. Group proven equivalent definitions behind a documented base reference; add only substantive
   classification differences. Do not infer same-as relations from normalized-title collisions.
4. Run a bounded Laya multilingual experiment separately and record failures as well as successes.
   No runtime adoption, clinical probabilities, automatic source rewriting or UI migration.
