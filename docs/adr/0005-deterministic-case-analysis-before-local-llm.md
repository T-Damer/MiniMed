# ADR-0005: Deterministic case analysis before a local LLM

- Status: accepted
- Date: 2026-07-17

## Context

A long clinical narrative contains demographics, timeline, measurements, investigations,
medications, negative findings, and several possible search intents. Sending the whole text through
one lexical query loses structure, while making a local LLM mandatory would reduce device coverage
and make retrieval harder to reproduce.

## Decision

Implement a deterministic `analyzeQuery` stage in the portable TypeScript core. It preserves the
original text, emits source-linked facts and warnings, and creates a bounded set of weighted lexical
branches. Each branch is searched independently and fused with a scoring rule that preserves the
strongest lexical evidence while capping corroboration from similar branches.

A future local model may add proposals behind an adapter, but its output must satisfy the same
`QueryAnalysis` contract and the deterministic path remains the fallback.

## Consequences

- long-case search works offline on devices without an LLM;
- extracted facts and branch decisions are inspectable and testable;
- negations and uncertainty can be regression-tested;
- coverage is finite and must be expanded using benchmark failures;
- semantic retrieval can be added without changing UI or source-navigation contracts.
