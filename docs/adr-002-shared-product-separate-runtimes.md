# ADR-002: Shared product core, separate runtime editions

**Status:** Accepted architectural direction; implementation remains staged
**Date:** 2026-10-15
**Context for:** Local PMX Canvas, ChatGPT Sites and the later standalone Cloudflare edition
**Relationship:** Narrows [ADR-001](adr-001-bun-only-runtime.md) to the local runtime and SDK; does not replace it

## Context

The [product vision](product-vision-2026-09.md#likely-repository-structure-shared-product-separate-runtimes)
keeps local PMX usable offline while adding hosted editions in stages. Boards, mutation
rules, context compilation and renderers should remain one product across those editions.
Sharing source code must not imply shared live state or a cloud dependency for local users.

Today's application couples product behavior to Bun, synchronous SQLite, process-wide state
and import-time wiring. Moving those modules into packages would not establish runtime
independence. Conversely, separate product forks would duplicate rules and let editions drift.
The architecture must separate runtime ownership without introducing distributed transactions
between closely related board, context and relation operations.

## Decision

1. **Keep one modular product in one repository.** Reuse product rules and contracts across
   editions. Establish package boundaries from demonstrated reuse, not a speculative folder
   split. Shared contracts and rules must not depend on runtime entrypoints or concrete
   storage; remote clients must not import local execution machinery.
2. **Give each edition an explicit composition root.** Local, Sites and later standalone
   Cloudflare entrypoints construct their dependencies and own startup, shutdown and recovery.
   Importing shared code must not install global listeners or start local services.
3. **Keep runtime capabilities behind explicit boundaries.** Authentication supplies a caller
   and grants to shared permission rules. Persistence, temporary session services and external
   effects belong to runtime adapters. Files, network fetches, subprocess MCP, builds and
   browser automation are capabilities, not assumptions of the shared core. Document unsupported
   behavior per edition; preserve distinct iframe sandbox and host-protocol requirements.
4. **Keep ownership explicit.** Requests target a workspace, board and caller independently
   of a viewer's navigation. Durable board state and audit records have different lifetimes
   from presence, connections, timers and waits. Every supported writer follows the relevant
   mutation policy and commit guarantees defined in the vision.
5. **Share three contracts:** operation requests/results, the workbench request/event/asset
   protocol, and the editable board archive. MCP adapts product operations to supported host
   capabilities; common registration code does not establish support for every resource,
   subscription or embedded application on every host.
6. **Separate editions, not every domain into a service.** Keep board, context and relation
   consistency together initially. A separate deployment needs a concrete security,
   execution-lifetime, scaling or failure-isolation reason. Package boundaries alone do not
   justify network boundaries.
7. **Preserve independent editions.** Local retains Bun, SQLite and offline-capable local
   features without hosted credentials. Sites and standalone hosting own their respective
   storage and operational integrations. Boards move through deliberate export/import copies,
   not automatic synchronization. Local is not a thin client, and Sites is not a disposable fork.

## Consequences

- Shared fixes can reach all editions, but each runtime needs contract and lifecycle checks.
  Host support and platform limits must be verified on the actual platform, not inferred from
  a portable build or simulated asynchronous storage.
- ADR-001's rejection of a Node dual-build remains valid for the local distribution. This
  decision permits runtime-neutral product code and hosted adapters, not compatibility shims.
- Policy parity does not require every local SDK method to become asynchronous. Durable
  completion across asynchronous storage is a separate contract; any SDK API change needs
  its own versioned decision rather than a second permanent command implementation.
- Exact packages, interfaces, storage mechanisms, journal schema and archive version/upgrade
  policy remain scoped implementation decisions. This ADR does not select services or promise
  indefinite format compatibility.

## Alternatives considered

- **Separate product forks per edition:** simpler initial porting, but duplicated permission,
  revision and context behavior would drift. Rejected in favor of shared product rules.
- **Microservices for boards, context and relations:** independent deployment at the cost of
  network failures and cross-service consistency. Rejected without a demonstrated need.
- **Package migration first:** creates release and import churn without proving isolation.
  Rejected in favor of extracting a complete working slice first.
- **Hosted backend required by local PMX:** reduces runtime variants by sacrificing offline
  ownership and existing local workflows. Rejected by the product vision.

## Delivery and revisit gates

Owner acceptance remains first. Curation-effect runs and reruns are deferred to
[plan 019](plans/plan-019-post-0.9-roadmap.md) step 6 (2026-10-19); preceding work is not
evaluation-gated. Release and runtime-verification gates remain unchanged. Fix demonstrated
defects narrowly; this ADR does not authorize a broad refactor, deployment or release.

When the second runtime needs extraction, prove one read/edit/commit/reconnect slice with a
browser and agent conflict, a lost-response retry, persistence failure, restart, independent
board navigation and an unreadable linked source. Verify isolated runtime instances and the
installed local offline path. Prove the slice on the target platform before expanding the port;
package the boundaries once they are established.

Revisit deployment boundaries when measured requirements justify separate security, scaling
or execution lifetimes. Revisit adapter boundaries if a verified platform constraint cannot
preserve the shared product guarantees. Neither trigger automatically authorizes product forks
or a cloud dependency for local operation; changes require a new explicit decision.
