# MiniMed KD1 query encoder

On-device query encoder for MiniMed's semantic search (STATE KD1). It is
`intfloat/multilingual-e5-small` (MIT) fine-tuned to place a query where
`ai-sage/Giga-Embeddings-instruct-480M-0826` (MIT, revision `1763d603`) places it, with a 384×384
head folded into the graph. Module passages are encoded by Giga at build time and projected to 384
dimensions with `giga480m-projection-384.npy`; queries are encoded by this model. Measurements and
method: `docs/research/embedding-distillation-2026-10-09.md` in the MiniMed repository.

| File | Purpose |
|---|---|
| `config.json`, `tokenizer.json`, `tokenizer_config.json` | transformers.js model files |
| `onnx/model_quantized.onnx.part-0`, `.part-1` | the int8 ONNX graph in two parts (each below the 100 MB git blob limit); join them in order, SHA-256 `14019498821496b8248f1a172994110758161ba1d1ea2d0e9472338e4096b671` |
| `giga480m-projection-384.npy` | the passage projection (build input, SHA-256 `097ec0357f7c8fde2535189a0a7172faf3fcc4b509cb4ba0662631281931174d`) |
| `distill-train.json` | training configuration and loss log |

Input: `"query: " + text`; output: `last_hidden_state`, mean-pooled over the attention mask and
L2-normalised, as for e5.

Training texts: complaints and histories of RuMedPrimeData (Starovoytova E.A. et al., Zenodo,
doi:10.5281/zenodo.5765873, CC BY 3.0) outside the RuMedTop3 dev/test ids; conclusions and
annotated phrases of the RuCCoD train split (Nesterov A. et al., RuCCoD, EMNLP 2025, CC BY 4.0) and
its ICD-10 names; titles, section names and fragments of the Russian Ministry of Health clinical
recommendations; drug names and indication fragments of the ГРЛС and Allmed instructions. No benchmark query was used.

Research model for a personal offline reference tool; not a medical device and not validated for
clinical decisions.
