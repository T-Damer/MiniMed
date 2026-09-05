# Local search assistant

Status: retired from the product search path on 4 September 2026.

MiniMed search now returns at most 20 document groups and exact source fragments from deterministic
FTS/vector retrieval. It does not run a local generative model for query planning, reranking, or
answer writing. Clinical-case search puts clinical recommendations before reference material, and a
model failure can never affect source availability because no model is required.

The former `GroundedMedicalCore` wrapper asked a compact model for query terms and coarse H/M/L
relevance labels over already-retrieved candidates. It was removed after the E5 comparison showed no
Recall@20 gain over the deterministic baseline and the generative path added a second model lifecycle
without producing an answer the product needed.

Any future cloud answer is a separate, explicit action over documents selected from local retrieval.
Personal notes and patient records are excluded by default. Reintroducing model-based local ranking
requires clinician-reviewed retrieval gains and physical-device qualification.
