# ADR 0013: Connect L-Note through the MedicalCore boundary

- Status: accepted
- Date: 2026-07-30

## Context

MiniMed already keeps the browser UI behind the `MedicalCore` contract. L-Note is a separate,
domain-neutral knowledge system and its protocol is not stable enough to make it a required MiniMed
dependency. Copying generic retrieval code into MiniMed would create two divergent implementations,
while replacing MiniMed's core wholesale would discard medical query analysis, source validation, and
clinical safety restrictions.

## Decision

Add a transport-agnostic L-Note compatibility adapter to `@localmed/core` that maps a minimal
`LNoteClient` to `MedicalCore`. Add one optional external-core registration point to the browser
composition root. If no provider is registered, or if its factory fails, MiniMed uses its existing
SQLite/FTS5 stores unchanged.

The initial adapter covers:

- initialization and capability reporting;
- document, section, chunk, and context navigation;
- lexical/semantic result mapping and score normalization;
- optional `ask` and content-pack installation methods;
- stable conversion of L-Note failures into `LocalMedError` values.

The adapter reports `localCaseExtraction: false`. Connecting a generic backend does not imply that it
implements MiniMed's medical case parser or that its results satisfy MiniMed's clinical safety gates.
The browser registration boundary additionally marks every registered external core with
`searchExecution: 'direct-only'`. This prevents MiniMed's built-in search Worker from replacing the
external backend's own execution context. The Worker remains the default for MiniMed cores that do not
request direct execution.

## Integration example

```ts
import { createLNoteMedicalCoreAdapter } from '@localmed/core';
import { registerExternalMedicalCoreFactory } from '@/composition/external-medical-core';

registerExternalMedicalCoreFactory(async () =>
  createLNoteMedicalCoreAdapter(lNoteClient, { platform: 'web' }),
);
```

Registration must happen before the application initializes its active core. Only one external
provider may be registered at a time; a second provider is rejected instead of silently replacing the
backend.

## Consequences

- MiniMed remains usable with no L-Note code, account, server, or network.
- L-Note can be tested against the same UI and `MedicalCore` lifecycle without becoming the default.
- Registered external cores keep ownership of query analysis and search execution.
- Medical safety, corpus provenance, and benchmark gates remain MiniMed responsibilities.
- The adapter is intentionally approximate until L-Note publishes a versioned protocol. Protocol
  changes should be isolated inside the adapter module rather than propagated through the application.
