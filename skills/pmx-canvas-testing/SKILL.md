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

**Direct `bun test` is side-effect-guarded by `tests/preload.ts`** (wired via `bunfig.toml`
`[test].preload`): it defaults `PMX_CANVAS_DISABLE_BROWSER_OPEN=1` so the suite's open-as-site
tests cannot launch the developer's real browser, whichever way the tests are invoked. The
preload covers `bun test` only — when you boot a server yourself (`bun run src/cli/index.ts`),
pass `--no-open` and set `PMX_CANVAS_DISABLE_BROWSER_OPEN=1` explicitly.

**Never pipe a gating command through `tail`, `head`, or `grep`.** The pipeline reports the exit
code of the LAST command, so `bun run test | tail -5` exits 0 on a red suite. Redirect to a file
and check `$?`, then read the file.

## Which Command To Run

- Server/state/API-only changes: run `bun run test`
- Test-only changes: run `bun run test` and `bun run test:coverage` if coverage matters
- Client/UI/browser interaction changes: run `bun run test:web-canvas`
- Cross-stack or non-trivial changes: run `bun run test:all`
- Before changing browser-visible behavior under `src/client/`: rebuild with `bun run build`
  Manual browser validation also requires a fresh client bundle. `bun run test:web-canvas`
  already does this for you.

## Coverage Notes

- `bun run test:coverage` covers the Bun unit suite under `tests/unit/`
- Coverage output is written to `coverage/lcov.info` and also printed as a text summary
- CI currently uses that same unit-test coverage command, then runs browser smoke separately
- Do not describe `test:coverage` as full-stack coverage; Playwright coverage is not wired in here

## Current Project Test Surface

- Bun tests live under `tests/unit/`
- Playwright browser smoke lives under `tests/e2e/`
- CI runs Bun coverage plus the browser smoke flow

## WebView Automation Caveat

- Some Linux/CI environments expose `Bun.WebView` but still cannot start a usable automation
  session within the timeout window
- When testing WebView automation, treat a cleanly reported unsupported/timeout runtime boundary
  as distinct from a product regression

Prefer extending the existing suites before inventing a one-off script.

## Test Authoring Rules

- Keep unit tests isolated. Reset singleton server state between tests.
- Test public behavior first: HTTP endpoints, persisted state, visible UI outcomes
- Use browser tests for interactions the user actually performs: node creation, pins, snapshots,
  loading the workbench, and other sync-sensitive flows
- Avoid brittle selectors. Prefer stable text, roles, titles, or deliberate component hooks
- If a change spans server and client, add at least one server-side assertion and one browser or
  API-level proof
- MCP harnesses using the official SDK must wind down BOTH halves: call `client.close()` AND
  `transport.close()` on the `StdioClientTransport`. Closing only the client leaves the spawned
  stdio server process alive after the test exits (0.4.0 cycle finding)
- Before a version-test cycle, run `pmx-canvas skills sync --check` in the consumer workspace —
  exit 1 means the installed skill copies are stale against the package; run
  `pmx-canvas skills sync --yes` to refresh them (whole trees, whatever agent layout owns them) before
  trusting skill-guided results

## Tests That Cannot Fail

A test that passes against the broken code is worse than no test — it certifies the bug. Every
regression test must be shown to discriminate: run it against the unfixed code (or hard-code the
broken value) and watch it go red BEFORE you trust the green.

Four ways a test silently stops discriminating in this repo:

- **Polled assertions pass on the first sample.** `expect.poll(fn).toBeGreaterThanOrEqual(180)`
  succeeds the instant one sample qualifies, so it never observes the failure window. Wait for the
  settle condition, then assert once.
- **Committed fixtures embed generated output.** `src/server/demo-state.json` carries each
  primitive's generated markup; count and coverage assertions are satisfied by stale markup just
  as well as fresh. Guard generated fixtures by rebuilding from the generator's INPUT and
  byte-comparing against the current renderer.
- **Absolute assertions about globally-wired side effects are order-dependent.** Anything flowing
  through a single-slot listener (architecture rule 8 in `CLAUDE.md`) is wired or not depending on
  whether an earlier test file booted a server — so the test passes alone and fails in the suite,
  or vice versa. Assert DIFFERENTIALLY: run the action disarmed and armed, require the deltas to
  match. Always run the full suite before trusting a new test; a single-file run hides this.
- **A new node type passes every test and renders nothing.** Server, API, and client-unit
  assertions all pass while `isCanvasNodeType` drops the type during layout apply. Only a DOM
  census on a live board catches it.

## Layout And Embedded Content Checks

- For seeded or generated boards, add API-level geometry assertions: expected node/edge counts,
  group counts, valid edge endpoints, no visible node overlaps, and group children contained with
  header/padding space.
- For grouped layouts, test non-group node overlap separately from group containment. Group frames
  are allowed to contain children; children should not overlap each other or collide with headers.
- For edge-heavy layouts, assert endpoints exist and long cross-board edges are intentional. If a
  user says an edge “comes from nowhere,” add a regression check for missing endpoints or excessive
  edge distance in that board.
- For `graph`, `json-render`, `mcp-app`, webpage, and image nodes, API geometry is not enough.
  Verify the rendered browser frame when changing sizing: iframe/body `scrollHeight` and
  `scrollWidth` should fit the available frame unless scrolling is the intended behavior.
- When checking embedded frame fit manually, start from a clean seeded state, rebuild stale bundles,
  and inspect the actual iframe document in a browser. Server dimensions can look correct while the
  embedded content is still clipped.
- **A node's stored content is not render evidence.** An html/primitive node's stored HTML holds
  every conditional branch — hidden banners, error states, empty states — so a content-level read
  (search hit, pinned context, `node get`, any text summary) quotes strings the user never saw.
  The 0.4.7 report filed an "AX bridge unavailable" banner as a live product gap on exactly this
  basis; the served surface had the bridge injected ahead of the check and the banner was `hidden`
  in the document. Before filing a rendering bug, fetch the served surface or inspect the DOM.
- User-facing creation flows must end with the new nodes visible: after the create (plus the
  skill-mandated focus/fit), a screenshot must show them without any manual pan. A `panned: true`
  API result alone is not proof — verify the frame is on-screen and unobscured.

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

## Presence, sessions, and the redesigned chrome (rail-chrome-v2)

- Agent/human presence is in-memory and TTL-swept. An e2e reset must detach any attached
  session (`POST /api/canvas/ax/presence { attached: false }` per attached presence), clear the
  scope fence, and mark its own writes with `x-pmx-workbench: 1` — otherwise the harness reads
  as an external writer and a leftover fence refuses the next test's `clear`. Unattached writers
  from earlier tests can still be live (90 s): assert about YOUR writers, not exact totals.
- Assert SSE frames as received (`readSseEvent` in `tests/unit/agent-presence-api.test.ts`), not
  the object handed to the emitter — the envelope overwrites `sessionId` and `timestamp`.
- Two-tab behaviour (human cursors, the edit lock) needs two browser contexts; name them with
  `/workbench?name=…` so assertions can target a cursor by its tag.
- The Browser pane reports `visibility: hidden` and never fires rAF: drags, drop pills, edge
  previews and presence animations only work under Playwright. Use the pane for static checks.
- Selection is shift-click on the node BODY (the titlebar drags); groups have no ports and
  their drag handle is the edge row; the selection bar and command bar both float bottom-center
  (the selection bar lifts during a session).
