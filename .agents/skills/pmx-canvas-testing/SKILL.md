---
name: pmx-canvas-testing
description: >
  Repo-standard test and verification workflow for PMX Canvas. Use when you change code, add
  tests, debug regressions, prepare handoff, or need to decide which local verification commands
  to run. This skill defines the default test ladder, when to run Bun tests vs. browser tests,
  how to handle pre-existing failures, and what evidence to report back.
---

# PMX Canvas Testing

Use this skill whenever you touch code in this repo and need a consistent verification path.

## When To Use

- Any code change that should be validated before handoff
- Adding or updating tests
- Debugging a regression or flaky behavior
- Updating CI or coverage commands
- Deciding the minimum acceptable verification for a task

## Default Verification Ladder

Pick the narrowest command that proves the change, then escalate if the change crosses layers.

```bash
bun run test                # Fast Bun suite for server/state/API coverage
bun run test:coverage       # Same Bun suite with coverage output
bun run test:web-canvas     # Browser smoke against a real running app
bun run test:all            # Bun suite + browser smoke
```

## Which Command To Run

- Server/state/API-only changes: run `bun run test`
- Test-only changes: run `bun run test` and `bun run test:coverage` if coverage matters
- Client/UI/browser interaction changes: run `bun run test:web-canvas`
- Cross-stack or non-trivial changes: run `bun run test:all`
- Before changing browser-visible behavior under `src/client/`: rebuild with `bun run build`
  Manual browser validation also requires a fresh client bundle. `bun run test:web-canvas`
  already does this for you.

## Current Project Test Surface

- Bun tests live under `tests/unit/`
- Playwright browser smoke lives under `tests/e2e/`
- CI runs coverage plus the browser smoke flow

Prefer extending the existing suites before inventing a one-off script.

## Test Authoring Rules

- Keep unit tests isolated. Reset singleton server state between tests.
- Test public behavior first: HTTP endpoints, persisted state, visible UI outcomes
- Use browser tests for interactions the user actually performs: node creation, pins, snapshots,
  loading the workbench, and other sync-sensitive flows
- Avoid brittle selectors. Prefer stable text, roles, titles, or deliberate component hooks
- If a change spans server and client, add at least one server-side assertion and one browser or
  API-level proof

## Failure Handling

- Never wave away a failure without checking whether your change caused it
- If the failure is truly pre-existing, say that explicitly and include the failing command
- If a command cannot run in the environment, say what blocked it
- If browser tests fail after a client change, confirm the bundle was rebuilt and the server
  started from the updated code

## Handoff Standard

Before marking work done, report:

- Which verification command(s) you ran
- Whether they passed
- Any meaningful gaps, skipped checks, or known pre-existing failures

For non-trivial changes, the default expectation is `bun run test:all` unless there is a clear
reason to scope verification more narrowly.
