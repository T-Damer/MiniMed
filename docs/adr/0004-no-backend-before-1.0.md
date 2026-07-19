# ADR-0004: No mandatory backend before 1.0

- Status: accepted
- Date: 2026-07-16

## Context

The product hypothesis is that local retrieval over Russian medical sources is useful by itself. Introducing accounts, synchronization and hosted inference would add operations, privacy and availability concerns before this hypothesis is tested.

## Decision

The base application remains offline-first and serverless through the personal MVP. Optional BYOK cloud generation may be added behind an adapter, but search, document viewing and content-pack loading must not depend on it.

## Consequences

- The MVP can be transferred and run without cloud infrastructure.
- Authentication, central telemetry and synchronization are intentionally deferred.
- A future backend must implement the existing core boundary rather than leak HTTP concerns into UI features.
