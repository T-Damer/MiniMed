# Needle fine-tune: tool-calling model for MiniMed

A Cactus Needle 2 (~45M parameters) LoRA fine-tune that maps a Russian clinician
utterance to exactly one deterministic MiniMed tool call with grounded
arguments. The model never computes anything: calculators run in application
code, retrieval runs through `MedicalCore.search`, and invalid output falls back
to the ordinary deterministic path.

```text
user text → Needle (tool + evidenced arguments) → deterministic MiniMed tools → local DB/RAG → UI
```

## Layout

```text
tools/needle/
  minimed_tools.json     # tool schemas — single source of truth (Needle format)
  src/needle_med/dataset.py  # deterministic dataset generator + validator
  tests/test_dataset.py      # generator invariants (pytest)
  eval_model.py              # checkpoint evaluation on the held-out split
data/needle/                # generated train.jsonl / val.jsonl (gitignored)
```

## Tool contract

Nine tools; every argument must be copied from user text except catalog
selections (`calculator_id`, `assessment_id`, `scope`, `section`), which are
validated against real catalogs:

- `search_medical_documents(query, scope?, section?)` — scope ids match
  `ScopedMedicalCore` (`diagnosis | guidelines | medications | legal`), section
  matches `SearchResultCategory`;
- `lookup_drug(name, age_years?, weight_kg?)`
- `run_calculator(calculator_id, …flat numeric inputs)` — ids come from
  `content/tool-modules/*.json` without the `minimed.calculator.` prefix;
  inputs are a flat union mapped from schema calculator inputs;
- `run_assessment(assessment_id)` — id is an enum compiled into the decode
  grammar, so hallucinated ids cannot be emitted;
- `extract_labs(…14 optional values)`, `extract_vitals(…8 optional values)`
  copy only evidenced numbers and omit everything else;
- `find_icd(query)`, `find_interaction(drug_a, drug_b)`,
- `create_note(title, body)`.

Deliberate v1 omissions: `open_drug_monograph` / `link_document` need a
document id that is never present in raw user text — they belong to a later
multi-turn slice where the id comes back from a previous tool result.
`dose-by-weight` is a synthetic calculator id for the flagship «ребёнок N кг,
препарат X мг/кг» case; the runtime schema calculator still has to be added to
the pediatrics tool module before this call can execute.

## Dataset

Generated deterministically (seeded) from repository content:

- ~20 real calculators × sampled in-domain values and Russian phrasing frames,
  plus dose-by-weight examples;
- all 19 assessment slugs from the shipped tool modules;
- search queries taken verbatim from `tools/benchmarks/*` with their expected
  scope/section metadata as labels;
- lab/vital extraction sentences with decimal-comma variants;
- off-topic samples (`answers: []`) including medical traps («поставь диагноз»)
  that no declared tool may serve;
- hand-written ambiguous near-pairs between similar tools.

Every sample passes validation before writing:

1. answers reference tools declared in the sample's own context;
2. arguments satisfy JSON-schema type/enum/range constraints;
3. non-selection argument values appear in the query text (grounding);
4. off-topic samples have empty answers;
5. no duplicate `(query, answers)` pairs.

Current volume: ~1045 samples (~935 train / ~110 val).

## Commands

```bash
bun run needle:data    # regenerate data/needle/{train,val}.jsonl
bun run needle:check   # ruff + pyright strict + pytest
uv sync --project tools/needle --group train   # install cactus-needle
uv run --project tools/needle --group train \
  python -m cactus_needle.cli finetune data/needle/train.jsonl --epochs 8
# or the needle CLI entrypoint:
uv run --project tools/needle --group train needle finetune data/needle/train.jsonl --epochs 8
bun run needle:eval -- --weights checkpoints/<tuned>.cact
```

## Safety boundary

The tuned model only routes and copies. It cannot compute doses, answer free
text, or alter corpus content; empty `function_calls` remains the refusal
contract, and the deterministic search result order stays untouched when
validation fails.
