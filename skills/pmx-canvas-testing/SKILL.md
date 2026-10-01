---
name: pmx-canvas-testing
description: >
  Repo-standard test and verification workflow for PMX Canvas. Use when you change code, add
  tests, debug regressions, prepare handoff, or need to decide which local verification commands
  to run. This skill defines the default test ladder, when to run Bun tests vs. browser tests,
  how to handle pre-existing failures, and what evidence to report back.
---

# PMX Canvas Testing

Use this skill when changing the PMX Canvas product checkout and you need a consistent verification
path. The commands and paths below refer to that source checkout, not to a workspace that merely
has the published package and skills installed.

For an isolated consumer workspace, do not expect the package to contain this checkout's
`tests/`, source-only scripts, or Playwright configuration. Validate package transports and host
integration through their public CLI, MCP, HTTP, and SDK surfaces; use the
`published-consumer-e2e` skill when a packed-install outside-in check is required.

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

- In the product source checkout, Bun tests live under `tests/unit/`.
- In the product source checkout, Playwright browser smoke lives under `tests/e2e/`.
- Playwright runs two projects: `desktop` (1440×900, the whole suite) and `pane-600` (600×900,
  `tests/e2e/reference-pane.pw.ts` only). `pane-600` is the release reference surface: every node
  type must paint there. A new node type fails its coverage test until it gets a reference case.
  Run it alone with `bash scripts/run-playwright.sh --project=pane-600`.
- Product CI runs those checkout suites: Bun coverage plus the browser smoke flow.
- An isolated installed consumer instead tests the package's public transports and host behavior;
  it does not run or depend on the product checkout's source suites.

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
- For JSON focus transitions, edit a bound input and load a multi-item runtime list inline,
  expand and verify both, edit/replace them in focus mode, then close and verify both again.
  Exercise `src` and `srcdoc`, including AX-disabled JSON. No save, spec edit or reload belongs
  between those assertions. Separately verify a real spec revision resets to authored state,
  and that local drafts never entered the server spec. See `tests/e2e/json-render-forms.pw.ts`.
  Eval definitions are not evidence of executing this browser regression or a model benchmark.
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

### Keep first-failure evidence before rerunning

Use a separate directory for each attempt, including non-browser probes. Save the exact
command, target/version, exit status, stdout and stderr; keep credentials out of logs.
Before rerunning Playwright, copy its failure traces/screenshots and results out of the
runner's overwritten output directory. Never overwrite an initial failure log with a rerun.
For a shell gate, capture its status even with `set -e`, for example:

```bash
attempt_dir=$(mktemp -d /tmp/pmx-check.XXXXXX)
printf '%s\n' 'bun run test' > "$attempt_dir/command.txt"
status=0
bun run test > "$attempt_dir/stdout.log" 2> "$attempt_dir/stderr.log" || status=$?
printf '%s\n' "$status" > "$attempt_dir/exit-status.txt"
# Inspect this attempt before rerunning; return the gate's original exit status.
(exit "$status")
```

Record what changed between attempts. Distinguish harness corrections, product fixes,
unchanged retries and host approval. A corrected pass does not make the original attempt
green. If logs were lost, say so; never reconstruct them or claim first-run success.

## Native-host verification is separate from transport checks

Record source, packed-package, registry-package, portal and native-host results separately.
An SDK subprocess's MCP handshake/catalog is not evidence that Amp discovered tools.
For Amp setup/trust and the pin → read → addressed steer → edit → visible result → ack
procedure, follow the bundled [installation reference](../pmx-canvas/references/installing-pmx-canvas.md#amp-connect-the-agent-separately-from-the-portal).
MCP-only consumers should read `skill://pmx-canvas/references/installing-pmx-canvas.md`
directly with `resources/read`, not traverse outside the testing skill's resource tree.
Workspace trust approval belongs to the human; report a blocked native check until approved.
Include a different-recipient negative control for addressed delivery on a disposable board.
Verify the rendered edit before acknowledging; detach only test-owned sessions afterward.
Do not label active-agent polling as idle-thread wake-up, a persistent pump, or automatic
import-agent launch. Native MCP tools do not prove native Skills-extension discovery.

List unexercised surfaces explicitly: native Copilot/WebKit, Windows-native behavior,
physical mobile, OCR and Office extraction need their own evidence. Source adapter tests
or a source helper pointed at a published server do not establish installed-adapter execution.
Sampled resource digests are not a full-catalog audit; eval definitions are not scored model
results; a skipped mirror check is not validation. Do not change the product merely to
turn an untested surface into a claimed pass.

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
- Do not categorically infer Browser-pane behavior from the host name. Probe the actual surface:
  record `document.visibilityState`, race a `requestAnimationFrame` callback against a short
  timeout, and capture a screenshot of the claimed rendered state. If hidden or rAF times out,
  use the pane only for static checks and run animation/drag/drop/edge-preview assertions in
  Playwright. If the probe succeeds, it is still scheduling evidence rather than paint proof;
  retain screenshot evidence for a visual pass, especially for iframe-backed or native-host
  surfaces.
- Selection is shift-click on the node BODY (the titlebar drags); groups have no ports and
  their drag handle is the edge row; the selection bar and command bar both float bottom-center
  (the selection bar lifts during a session).
