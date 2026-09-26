# Query-parser LLM/NER POC — 2026-09-26

Measured proof of concept; nothing here is wired into the app.


- `tools/benchmarks/src/export-parser-llm-cases.ts` exports the 29 parser fixtures, the 72 generated
  CI-seed cases, and 40 agent-authored realistic case narratives
  (`tools/benchmarks/parser-llm-ood-cases.json`, not clinician-written) with the deterministic
  parser's prediction. `parser_llm_poc.py` runs a loopback llama-server with grammar-constrained
  JSON (`--reasoning off`, two few-shot examples) and scores every system in one coarse fact schema
  with relaxed value matching; `parser_gliner_poc.py` is a zero-shot GLiNER2 baseline. A `+guard`
  variant applies deterministic post-checks: negation/suspicion cues in the fact span or clause set
  polarity, and sex requires an explicit sex word. Weights stay in the ignored `.cache/`.
- On the 40 realistic narratives (lenient-type F1 / negated-fact recall; Apple M2 Max Metal p50):
  deterministic parser `0.669` / `0.50`; GLiNER2.5-multi zero-shot `0.748` (`0.58` strict-type) /
  `0.67`, 337 ms; Qwen3 0.6B+guard `0.786`; Qwen3.5 0.8B Q8+guard `0.830` / `0.67`, 1.3 s;
  QVikhr 3 1.7B Q4+guard `0.880` / `0.83`, 1.6 s; Qwen3.5 2B Q4+guard `0.861` / `0.67`, 1.8 s;
  Qwen3.5 4B Q4+guard `0.910` / `0.94`, 6.3 s. Vikhr Qwen 2.5 0.5B stayed below the parser.
  Model gains are mostly recall of symptoms, diagnoses, and laboratory results the parser misses.
- Without guards, every model flips negation (for example `сыпи нет` returned as a positive
  `сыпь`); on the generated set, untouched while writing the guards, the guard raised Qwen3.5 2B
  negated-fact recall from `0.70` to `1.00` and removed all 24 forbidden-fact violations. On the
  parser's own fixtures and generated set no model reaches the deterministic parser (best `0.79`
  versus `0.985`), and a regex+model union keeps recall `1.00` there but adds regex errors such as
  `34 г` read as a strength on realistic text.
- CPU-only, four threads on the same machine (a generous phone proxy), p50 was 4.7 s for Qwen3.5
  0.8B, 8.8 s for Qwen3.5 2B, and 12.1 s for QVikhr 1.7B per query. No model, runtime, or adapter
  was added to the app; the numbers set the target for a fine-tuned small NER plus deterministic
  normalizers and polarity checks.
