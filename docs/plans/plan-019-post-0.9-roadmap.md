# Plan 019: After 0.9.0

**Status (2026-10-24):** 0.9.3 is released to npm and GitHub, with fresh registry smoke
passing. Step 2, MCP hardening and SDK tour result parity on SDK v1, is implemented
and pushed with the Settings tooltip fix, operation help and schema-size reduction.
The maintainer authorized review, testing and release of 0.10.0; release gates are in progress.
Later version numbers are proposals, not publication approval; every release must pass
the [release gates](../RELEASE.md).
**Sources:** [product vision](../product-vision-2026-09.md) (moves and the 2026-10-19 sequence),
[design.md build plan](../design.md#build-plan) (Waves 4, 5, Later),
[plan 009](plan-009-tech-debt-backlog.md) (open debt),
[design gaps](design-gaps-2026-10-08.md) (drawn, not built).

**Evaluations come last (maintainer, 2026-10-19).** The curation-effect benchmark and its
per-release reruns move to step 6, the last step of this plan and before the separately
scheduled hosted work. They do not precede or gate steps 1–5. Release gates in `RELEASE.md`,
including `bun run test:e2e-cli`, are not evaluations in this sense and still run every
release. **Accepted risk:** steps 1–5 build on the curation claim before its effect is
measured; the maintainer carries that risk rather than reinstating an earlier gate.

## Sequence

| Step | Proposed version | Scope | Vision | Size |
|---|---|---|---|---|
| 1 | 0.9.3 | Cleanup: tour debt, large-board costs, bounded due evaluator, MCP reconnect, lint | 12, 1 | S–M |
| 2 | 0.10 | MCP hardening, operation help and bounded discovery-schema reduction | 6a, 1 | M |
| 3 | 0.11 | One frame host, proportional spatial zoom, Wave-0 design pass | 5, 9 | M–L |
| 4 | 0.12 | Wave 5: agent output as nodes, make/inline board, group drill-in, relations sketch parity | 3, 0 | L |
| 5 | later | Trust (M half), journal, concurrent boards, binary | 7, 4, 8 | L–XL |
| 6 | end | Curation-effect baseline and reruns; skill-prompt benchmark | Part 1 item 4 | S–M |

Each step starts after the previous release ships, except that a concrete defect found in
use can be fixed narrowly in a patch release without pulling later scope forward.

## Step 1: 0.9.3 cleanup

Debt deliberately kept out of 0.9.0, plus measured performance leads.

**Local checkpoint, 2026-10-24 (not release approval):**
- Camera moves now persist only the viewport. A headed browser regression failed on the
  baseline's two full-card geometry writes, then passed without them; the complete seven-case
  presentation/recording file passes. Both camera paths use one animation driver while retaining
  their existing interpolation. Tour resolution reads geometry without hydrating card contents.
- Tour reads share one result builder. HTTP and MCP return `{ tour, derived, position }`;
  the SDK preserves its existing direct tour result (`.stops`). Result-shape parity is
  deferred to 0.10 because changing the SDK to `.tour.stops` breaks callers.
- `bun run scripts/probe-mcp-reconnect.ts` opened 12 local stdio fixture apps concurrently,
  then restored them through five server restarts and queried every replacement session's live
  tool catalog. All 60 restored sessions passed, with no `-32001` timeout. The native-host/remote
  backend failure remains open; this probe is not evidence that it is fixed.
- Saved Markdown skips unused reference parsing; saved targets, unresolved links, drafts and
  inline images retain their behavior. The measurements below leave serialization, offscreen
  rendering and SSE unchanged because each needs a separate contract or lifecycle decision.
- Lifecycle-get, node-get and review qualification use the dependency/portal closure, including
  incoming cross-board sources and unsaved active-board edges. Latest evidence and retirement
  summaries use indexed queries; requested audit history remains complete. Home counts are
  unchanged. **Deferred:** aggregate-only Home reads, per-card storage reads within closure boards,
  and whole-library mutation broadcasts. The current Home client consumes `knowledge.list.cards`.
- Lint passes with 55 warnings and 12 infos, down from 63 warnings and 12 infos. Eight unused
  import diagnostics were removed in the touched SDK module. Remaining diagnostics are listed below.
- Combined checkout verification passed: `bun run build`, `bun run typecheck`, `bun run test`
  (1,503 tests), `bun run test:client` (332 tests), and
  `xvfb-run -a bash scripts/run-playwright.sh --headed` (333 tests). The final node-get
  integration assertion also passed its 32-case relation suite, typecheck and lint. The inspected
  tour recording shows both stops and the restored editor after exit. These are local source
  checks, not release smoke, CI, installed-adapter or native-host verification. The patch-only
  decision is settled; release gates are being run against the final 0.9.3 candidate.

**Reproducible measurements (local Bun 1.4.4, synthetic data):**

| Workload and command | Before | After | Limits |
|---|---|---|---|
| 12 Markdown cards, five decodable 400×300 PNGs, 2,459,314 source bytes; `bun run scripts/benchmark-markdown-load.ts --browser --expect-no-reference-lex` | 24 extra reference parses scanning 4,918,628 bytes | Zero extra reference parses; all 12 normalized HTML hashes match | Three warmups and nine HTTP samples; headed Chromium at 1440×900, 2×, one warmup and three reloads. Timing varied on the shared orb, so no board-load speedup claim |
| Same Markdown board, public state serialization | 4,927,936 bytes | Unchanged | 2,460,294 bytes are duplicated top-level content; removing that alias is only a counterfactual measurement |
| Same Markdown board, offscreen rendering | Six offscreen POSTs, 508,608 source bytes | Unchanged | All 12 cards render; all five images decode |
| Same Markdown board, one-character edit | First layout SSE frame: 2,466,713 bytes, 12 nodes | Unchanged | First frame only, not total event traffic |
| 12 boards × 24 cards × 32 reviews; `bun run scripts/benchmark-lifecycle.ts` | 13 board reads and 9,248 full-history records per request | Two board reads and 32 records per request | One independent inactive-card request; all 32 requested audit records returned. Closure boards still load whole board bodies |
| Same lifecycle workload, warm medians from three independent runs | 16.016 / 14.938 / 16.648 ms | 0.832 / 1.101 / 0.609 ms | Five warmups and 20 samples per run. First request initializes indexes and was not consistently faster; no cold-start claim |

Remove `--expect-no-reference-lex` when running the Markdown script against the baseline.
Both benchmarks isolate their databases in disposable workspaces. Dependency-heavy lifecycle
behavior is covered by cycle, provenance, missing-source and cross-board tests, not this timing workload.

**Remaining lint diagnostics:** `bunx --no-install biome check . --max-diagnostics=200`
lists the exact locations. These remain outside the narrow behavioral fixes:

| Diagnostics | Count | Reason retained |
|---|---:|---|
| Unused imports / variables / parameters / private members | 11 / 8 / 6 / 1 | Spread across unrelated client, server and test modules; remove with their owning cleanup |
| Optional-chain suggestions | 23 | Existing style suggestions, including untouched regions of changed files |
| Literal template placeholders | 3 | Tests intentionally exercise literal `${…}` text |
| Global `isNaN`, confusing `void`, comma operator | 1 each | Existing chart coercion, frame callback and presence expressions need individual semantic review |
| Infos: template strings / switch cases / index lookup / config deprecation | 6 / 3 / 2 / 1 | Non-gating style/config follow-up, no rule disabled |

- **Tour debt** ([vision move 12](../product-vision-2026-09.md#12-tours-the-board-is-the-presentation-m)):
  a tour camera move saves every node's layout (`commitViewport` → `persistLayout` from the SSE
  camera handler) and re-reads the whole layout (`tour-control.ts`); `animateCameraPath`
  duplicates `animateViewport` (`canvas-store.ts`); current-tour logic is repeated in
  `tour-control.ts`, `index.ts` and the viewport operation; the SDK's `getTour()` omits the
  tour position HTTP and MCP return.
- **Large-board cost** ([WI-01](plan-009-tech-debt-backlog.md)): measure each remaining
  amplifier separately on a large real-shaped board: duplicated source in
  `canvas-serialization.ts`, offscreen `/api/render` posts from `MarkdownNode.tsx`, the double
  lex in `handleRender`, full-layout SSE. Fix only what the measurements implicate.
- **Bounded due evaluator** ([plan 009](plan-009-tech-debt-backlog.md), "Before larger-library
  scaling"): a one-card lifecycle request reads only its dependency closure; batch review
  summaries; separate Home folder aggregates from card detail.
- **MCP `-32001`** (plan 009 Finding U): try to reproduce the stressed-reconnect timeout. Fix
  if reproduced; otherwise record the attempt and keep it open.
- **Lint**: burn down the remaining Biome warnings.

**Done when**
- A tour step changes the viewport and writes no node layout: a test asserts the intended
  viewport change and that no layout-persistence write occurs during `tour go`/`next`
  (unchanged positions alone would also pass a needless identical rewrite). The SDK keeps its
  existing tour shape; result-shape parity moves to step 2. One camera-animation path remains.
- Each WI-01 amplifier has a reproducible measurement script and a before/after number on the
  same workload, per the measurement rules in `CLAUDE.md`; unimplicated ones are recorded, not changed.
- A one-card lifecycle request on a board with populated review histories reads only its
  closure (counted in a test), and Home's folder counts are unchanged.
- `bun run lint` reports zero warnings, or the remaining ones are listed with a reason.

## Step 2: 0.10 MCP hardening

[Vision move 6a](../product-vision-2026-09.md#6a-make-the-tool-surface-cheap-s--staged-follow-up)
and move 1's context delivery, on the current SDK v1.

**Local implementation checkpoint (2026-10-24):**
- All 24 tools advertise output schemas and explicit effect hints. Registry results use
  `{ result: { operation, outcome, data } }`; handwritten interaction, activity and screenshot
  tools retain their direct objects. Existing model-facing text/projections stay unchanged.
  Schemas distinguish batch success, empty failure and retained partial outcomes.
- Cancellation reaches AX waits and webpage I/O through local and HTTP invokers. Batches
  retain completed receipts and stop before subsequent operations. Progress is opt-in through
  MCP tokens and HTTP NDJSON. External runtime/build calls and local WebView captures remain
  noninterruptible mid-call. Disconnects may lose the response, never undo completed writes.
- Subscriptions belong to each connection, include exact parameterized URIs, and dispose
  on unsubscribe/close. Local state and workbench events cover library-only changes as well
  as active nodes; remote SSE reconnects invalidate subscribed resources. Notifications never
  record reads or advance cursors. A library-only-change regression failed before integration
  and passes with the shared event source.
- SDK `getTour()` now returns `{ tour, derived, position }`; `.tour.stops` is documented as
  the minor-version breaking change. No SDK/dependency upgrade or frame-host work.

**Approved follow-up, 2026-10-24:** `canvas_help { op }` derives one operation's
public arguments, required fields, routing selectors and guidance from the registry.
Omitting `op` lists MCP registry names; internal/human-only and non-registry tools are
excluded. Metadata reads neither boot a canvas nor record content delivery. The catalog
now has 25 tools. Conditional handler validation still applies; no lazy host discovery
or smaller input schemas are claimed.

Equivalent success schemas shared by identity are grouped within each tool. Distinct
payload contracts, error branches and batch partial receipts remain unchanged. Two
real stdio measurements with `bun run scripts/measure-mcp-catalog.ts` were byte-identical:
the previous 24-tool candidate's 144,680 UTF-8 JSON bytes become 137,381 for the same
tools (7,299 fewer, 5.05%). Existing output schemas drop from 77,105 to 69,806 bytes.
Adding help costs 1,156 catalog bytes including its separator: 138,537 bytes total,
6,143 fewer than the previous candidate (4.25%). Input-schema byte counts are unchanged.
This remains larger than published 0.9.3's 65,219 bytes. Bytes are not tokens, latency
or measured agent effectiveness. `session.start` and composite-input redesign remain deferred.

**Follow-up verification:** build, typecheck and `bun run test` pass (1,546 tests).
Real SDK stdio checks enumerate help for every exposed registry operation, validate
required fields, aliases and gate selectors, and create/remove a card using returned
arguments. Schema controls reject mismatched operations, malformed receipts and extra
envelope fields while accepting extensible payloads. Lint passes with 55 warnings and
12 infos. The first combined run caught a second frozen tool list still expecting 24;
that assertion now includes help. Test-fixture/typecheck failures were corrected, with
first-failure logs retained.

**Full candidate rerun requested by the maintainer:** `bun run test:coverage` passes
1,546 tests (67.27% lines, 73.62% functions, above the 60%/64% floors);
`bun run test:client` passes 332; `xvfb-run -a bash scripts/run-playwright.sh --headed`
passes all 333 desktop and 600/1024/1920 reference cases. Headed `test:e2e-cli`,
`release:smoke`, `pack:dry-run`, build, typecheck, lint and generated-catalog mirror
checks pass. A fresh packed MCP consumer discovers 25 tools, reads help without
creating state, and validates add/get results. Its allowed dependency versions
(SDK 1.32.2, Zod 4.6.7 versus checkout 1.28.0/4.3.6) encode nullable primitive schemas
as type arrays instead of `anyOf`. The initial byte-identity assertion failed;
comparison passes when only that equivalent encoding is normalized. No dependency changed.

The live portal serves the exact rebuilt bundle. Real stdio help-guided calls and
headed browser checks pass human pin → notification → explicit read → rendered edit,
unsubscribe, numeric progress tokens, cancelled approval waits, partial batch receipts
and refresh persistence. Both minimap toggles leave no tooltip and preserve Settings
focus. The first recording encoder fell behind; a later recording with the large suite
finished and a smaller viewport succeeded and was inspected frame by frame.
Native Amp/Copilot acceptance, Windows/macOS and remote/native reconnect remain unverified.

**Initial hardening verification:** build and typecheck pass; `bun run test` passes 1,544 tests and
`bun run test:client` passes 332. `xvfb-run -a bash scripts/run-playwright.sh --headed`
passes 333 cases; three pin/viewport/polling controls also pass after the final local
subscription event hook. `bun run release:smoke` passes on a disposable packed install,
not a registry publication. Lint passes with the same 55 warnings and 12 infos; generated
tool catalogs match. Real stdio tests cover local and daemon-attached progress/cancellation
and resource isolation. Initial test typing/SDK error-envelope failures and the red
library-notification regression were corrected; this is not a first-run-green claim.
Native 0.10 host acceptance, Windows/macOS and remote/native reconnect remain unverified.
Bounded simplify/harden review found no further blockers and made no additional changes.

**Independent baseline evidence:** the
[0.9.3 test thread](https://ampcode.com/threads/T-01a048cf-adb3-71bd-a7c6-472053b691d1)
reports no new confirmed functional defect after reruns, including installed SDK direct-tour
compatibility and native Amp pin/read/edit/ack acceptance. It does not establish 0.10 MCP
structured-output, cancellation or subscription conformance. Its low-severity KaTeX advisory,
unresolved first-run coverage timeout and remote/native reconnect gap remain separate from
this candidate; no dependency or reconnect fix is claimed here.

**Discovery cost:** `bun run scripts/measure-mcp-catalog.ts` measures UTF-8 bytes of the
real SDK client's `tools/list` JSON in a disposable stdio workspace, without canvas reads.
The 0.9.3 baseline is 65,219 bytes; the initial hardening candidate was 144,680 bytes, both 24 tools.
Output schemas contributed 77,105 bytes before the follow-up above. This is an increase in discovery overhead, not a
claim of cheaper prompts or a token estimate. Existing result text is unchanged; structured
results duplicate that projection for machine consumers. Host-specific prompt costs are unmeasured.

| Tool | 0.9.3 bytes | Initial hardening bytes |
|---|---:|---:|
| `canvas_pin_nodes` | 782 | 2227 |
| `canvas_invoke_command` | 804 | 2312 |
| `canvas_batch` | 1367 | 5184 |
| `canvas_import` | 1152 | 4251 |
| `canvas_snapshot` | 2238 | 6365 |
| `canvas_board` | 5859 | 14803 |
| `canvas_node` | 8184 | 13485 |
| `canvas_render` | 6321 | 11165 |
| `canvas_edge` | 2186 | 4423 |
| `canvas_group` | 1953 | 4532 |
| `canvas_history` | 494 | 2430 |
| `canvas_view` | 4341 | 12821 |
| `canvas_query` | 2476 | 7000 |
| `canvas_app` | 4729 | 7496 |
| `canvas_webview` | 1810 | 4834 |
| `canvas_ax_state` | 4462 | 7652 |
| `canvas_ax_work` | 2074 | 4527 |
| `canvas_ax_gate` | 2417 | 8285 |
| `canvas_ax_timeline` | 2637 | 6135 |
| `canvas_ax_delivery` | 1366 | 3284 |
| `canvas_intent` | 3127 | 5453 |
| `canvas_ax_interaction` | 1460 | 1969 |
| `canvas_ingest_activity` | 2341 | 2872 |
| `canvas_screenshot` | 604 | 1140 |

1. Remeasure `tools/list` size per tool before any schema change.
2. `outputSchema` + `structuredContent` for stable results (IDs, revisions, mutation
   outcomes); compact model-facing content; UI-only payloads in `_meta` where supported.
3. Accurate read-only / destructive / idempotent / external-access annotations. A composite
   with any write action is not read-only.
4. Cancellation carried through the operation layer into waits and cancellable I/O; progress
   for long operations where the host supports it; partial outcomes reported honestly.
5. Resource subscriptions: advertise the capability, track subscribed URIs per connection,
   notify only subscribers. Explicit context reads keep working for hosts without them.
6. Align SDK tour reads with HTTP/MCP `{ tour, derived, position }`; document the breaking
   change from `.stops` to `.tour.stops` at this minor-version boundary.

7. Approved follow-up: `canvas_help { op }` and bounded output-schema deduplication, as above.

Candidates, not automatic scope: `session.start`, composite-input redesign.

**Done when**
- Representative read and mutation results validate against their advertised schemas.
- An annotation audit test fails if a composite with a write action is marked read-only.
- Cancelling an in-flight wait releases it immediately instead of at timeout.
- Subscribe, unsubscribe and connection isolation are tested with two connections; actual
  reads are measured separately from notifications.
- Local stdio works unchanged; `docs/mcp.md`, the skill reference and the tool count are updated.

## Step 3: 0.11 frame host and design pass

[Vision moves 5 and 9](../product-vision-2026-09.md#5-keep-every-node-type-unify-how-they-render-m),
[design.md Wave 4](../design.md#build-plan).

**Local implementation checkpoint (not a release):** the maintainer's 2026-10-25
correction removes the third target's alternate grid and experimental CSS zoom.
The native board and its contents scale proportionally using the original matrix.
The other visual improvements and Markdown README-menu override remain in scope.
The shared viewer host replaces the ext-app recovery
ladder, keeps painted content during replacement, and owns explicit Retry for both
preparation and loading failures. JSON drafts survive theme and focus changes;
Mermaid's inline and standalone surfaces share the renderer. Preview mounting is
automatic at every zoom with no lifetime cap; visited documents remain mounted
for arbitrary app state. Initial documents load without a shared queue or user gate.
See [implementation decisions](../design.md#011-implementation-notes).
Oracle and Claude Code reviewed the combined change and its fixes. Claude and
the owning thread independently reproduced CSS-zoom sizing errors in Linux
WebKit26; transforms preserve inner dimensions in that probe and Chromium.
The earlier complete headed aggregate132 passed all 372 tests on the focus
and file-tooltip fixes, using Chromium 145.0.7632.6 across all four projects.
The original aggregate120 remains recorded as 371 pass / 1 fail: deferred modal
focus restoration dismissed a newly opened relation menu. Both that race and
the fresh Oracle review's file-header tooltip clipping have red/green regressions.
Oracle's follow-up accepts the repair. After its quota reset, Claude reviewed
snapshot137 read-only, verified all 531 source-manifest entries, and reported no
blockers. Its actionable findings are resolved below; review severity does
not close introduced debt or establish native-host acceptance. Peter requires new
Oracle and Claude reviews of the final integrated snapshot after its complete gate.
Aggregate153 remains 372 pass / 1 clipboard-test failure. Retrying the entire
clipboard read/parse/assertion, seeded with non-JSON text, fixes that test race
without changing the expected payload or deadline. Aggregate167 remains 372 pass /
1 startup-focus failure. Its trace and deterministic regression identify an older
buffered layout overwriting a newer camera while the first catalog is delayed.
The bounded fix passes the original theme/heading browser case at all three widths
in171. Aggregate174 remains 372 pass / 1 HTML-refresh failure. It exposed the initial
document's paint acknowledgement being cancelled when a replacement starts. The
document-owned readiness repair has controlled red/green unit and browser evidence;
aggregate182 passed all 373 headed cases. Gate182 passed typecheck, 1,515 unit tests
and 349 client tests. Bounded Oracle/Claude review183 then identified the additional
lifecycle interleavings below. Their fixes pass gate191 (typecheck, 1,515 unit tests,
353 client tests). Aggregate194 remains 374 pass / 2 fail: one forced app click hit
the loading overlay, and one long poll stalled across the test's `unrouteAll` while
the node deletion itself returned success. The tests now use ordinary pointer
actionability and keep interception stable while toggling refusal. Both pass five
headed repetitions in195. Aggregate196 remains 375 pass / 1 hosted-review failure:
the test entered evidence before the save's precondition reload finished, and that
reload correctly cleared the observation. Waiting for the dialog's enabled Save
control before entering new evidence passes three repetitions in197. The product's
input-reset behavior is unchanged. Both bounded reviewers confirm a separate,
pre-existing defect: evidence remains editable during that reload and can be lost.
`LifecyclePanel.tsx` is unchanged; the harness wait is not a product fix. This test's
whole-test ceiling was raised from 30 to 60 seconds; assertion deadlines are unchanged.
Aggregate198 passes all 376 headed cases. Bounded review198 then found that queued
tour requests can outlive a board activation, and a stalled exit blocks later Present.
The tour-specific server intent fence below replaces that queue. Build205 and gate207
pass: typecheck, 1,518 unit tests, 357 client tests and all 378 headed browser cases
across four projects. The source manifest is unchanged after the run. Fresh complete
Oracle and Claude reviews209 inspected that passing snapshot independently. Oracle
requested a generic-viewer theme repair; Claude accepted with a clipboard-permission
fix recommended. Both accept the bounded repair216, with no required fixes remaining.
Build213 and nine headed viewer/form cases214 pass. Gate215 passes typecheck,
1,518 unit tests, 359 client tests and lint; its full headed aggregate passes all
380 cases across four projects (27.7 minutes). The 537-entry source manifest still
matches after verification. Final portal218/219/221 serves the same built bundle:
70 cards, native board and first-stop screenshots at1440/600px, plus a pointer-visible
Present/Next/Next/Back/Escape recording with settled transitions. The captures and
full five-frame-per-second contact sheet were inspected. Saved nodes, edges,
viewport, tour and board/README metadata are unchanged; the unrelated control-room
artifact is unchanged. Narrow native fit intentionally scales content down rather
than reflowing it. Resize alone preserves the current camera; invoking Present at
the new width fits the selected stop. No native-host or performance acceptance is
inferred from these checks.
Lint exits zero with
54 warnings and 12 informational diagnostics, all with baseline identities;
the earlier McpAppNode void-union warning is gone.
The earlier populated-viewer slowdown is not reproduced in benchmark180,
described below. The self-contained MCP document grows from 1.32 MB to 4.78 MB, and
visited documents retain arbitrary app state and its memory cost. These remain
explicit tradeoffs; native WKWebView boot and paint are unverified.
The approved installed-consumer helper repair now stages complete built asset
trees; its default no-override installed-package case passes. Populated portal
workflows, current-state primitive copying, eight-stop presentation navigation
and standalone offline export have been exercised and visually inspected.
Native host acceptance remains separate. No commit, push or release is implied.
The dim heading, neighboring offscreen title and focus tooltip observations
were traced to existing view states. Overview-overlay clearance is superseded
by removal of the rejected overview, not claimed solved by tile nonoverlap.

**Fresh review dispositions (2026-10-25):**
- **Complete209 and bounded216:** both reviewers verified all 537 source-manifest
  entries. Only JSON/graph use named-theme messages and retain drafts across theme
  changes. Generic hosted viewers again consume dark/light queries and navigate on
  scheme changes, preserving baseline behavior rather than promising draft retention.
  Shared frames default to no delegated permissions; MCP explicitly keeps its existing
  clipboard policy. Client212 reproduces both regressions, client213 passes all21 cases,
  and headed214 passes all9 generic/JSON cases in src/srcdoc modes. Test213's theme
  override intentionally suppressed server changes; removing that test setup error
  preserves the original rendered-theme assertions. Original red evidence is retained.
- **Security/platform probes211:** three authored Mermaid CSS break-out cases leave
  the body and toolbar visible in headed Chromium145 and Linux WebKit26; captured
  selectors stay diagram-scoped. This does not establish CSS safety in general.
  Card content already has paint containment. Author CSP `script-src 'none'` leaves
  HTML visible without a fallback after11s because the bridge precedes the meta tag.
  Both engines enumerate all37 canvas custom properties. Claude closes those concrete
  cases and the documented full-build export precondition; native WKWebView remains
  unverified. No speculative renderer or export fallback was added.
- **Fixed repeated edge layout:** the three paint layers predate this work; repeated
  collision placement was introduced here. One shared scale/font/node/edge computation
  now serves all three layers without rebuilding for pan. In three headed Chromium145
  runs of 60 camera updates over 200 cards/150 labelled edges, text measurements fell
  from 54,000 to zero for pan and 17,400 for zoom. All six final paint geometries match.
  Instrumented frame medians overlap: pan155–172 ms before/140–160 ms after,
  zoom449–468 ms before/407–472 ms after. No smoothness, boot-speed or load-cause claim.
  Reproduce with `scripts/benchmark-edge-navigation.mjs`; profiles140/142 are retained.
- **28% marked-edge case verified:** the populated file/diff mark clears cards and
  hovered handles, remains in the adjacent row gap, and supports pointer/keyboard menus
  through39→28→60→28% plus real wheel/pan. Its side gap is about11px, smaller than
  the14px mark even before clearance, so below-card placement is necessary. The
  emitted paint/hit regression now includes28%. No handle shrinking or speculative
  hover-dependent placement was added. Probe148 preserves the clone's saved state.
- **Documented source-build precondition:** exports require built CSS, fonts and
  viewer assets; the package includes them. Missing assets are not a supported mode.
- **Fixed Copy JSON owner coupling:** explicit expanded ownership replaces reverse
  registration order. Regression144 copies the wrong inline draft before the fix;
  145 passes expanded-first, later inline re-registration and close-to-inline fallback.
  The card menu remains behind the modal; this removes incidental ordering without
  inventing a new modal copying flow or weakening sandbox reply validation.
- **Retained Copy JSON behavior:** an unloaded viewer keeps the action and reports
  an honest failure. It never substitutes stale server data or claims success.
- **Fixed presentation delivery ordering:** missing tour echoes reproduced dead
  buttons in145. The initial HTTP fallback introduced cross-stream ordering races.
  Steps and exits now share one server sequence, catalog epoch and board generation.
  The client separates observed/applied deliveries and local cancellation/remote
  hiding. Regressions154/158/161/163 reproduce stale steps, stale exits and hidden
  echoes. Client163 and all six headed cases164 pass the final repair, including
  both exit/restart orders. Oracle's bounded recheck found no remaining tour issue.
  Actual-portal173 exercises Present, Next and Escape on the served final bundle;
  inspected wide/narrow captures and pointer recording show control clearance.
  Saved nodes, edges, viewport, tour and board/README metadata remain unchanged.
- **Fixed startup focus:** the layout/catalog buffering path exists in 0.10.0 by
  source comparison. Aggregate167 exposes it when a focus event overtakes the first
  catalog response. Regression170 reproduces the camera reverting from y=96 to y=-47;
  updating the buffered layout's camera on the newer event makes all 27 board-state
  cases pass. The original theme/heading browser test passes unchanged at 600, 1024
  and 1920px in171. No delayed test focus or longer assertion deadline hides the race.
- **Fixed initial viewer readiness:** aggregate174 exposed a race introduced by the
  shared host. A replacement cancelled the retained document's first paint reply;
  a late load could also use the replacement's token. Readiness now belongs to each
  document, and only the current load can own Retry. Unit176 and controlled headed
  browser177 fail before the repair; unit180 and both src/srcdoc browser180/181 pass.
  Initial-load-before/after-update controls preserve the replacement's failure banner,
  and an old document error cannot redirect Retry to obsolete content. The prior
  11-case viewer suite179 passes; full integrated acceptance remains separate.
- **Review183 lifecycle repairs:** Retry now cancels removed entries even when their
  source key is unchanged. The initial tour repair made local Present wait for earlier Exit requests.
  Unit184 reproduces both failures and passes after the fixes; browser187 exercises
  the held-exit restart and all four navigation cases. The exit request race also
  exists in 0.10.0 by source comparison; the readiness leak belongs to the shared host.
- **Review198 tour request ownership:** both reviewers helped replace the exit wait
  with an atomic server-side document intent fence. Old/duplicate requests emit no
  event, earlier activations cannot affect the current board, and a pending resume
  cannot overtake a newer gesture. Client199 has four red cases before the fix and
  all seven pass after; server199 has two red cases before and all14 pass after.
  Additional capacity, invalid-input, SDK and MCP controls pass in202 (15 cases).
  Headed202 verifies a held-before-execution exit over both HTTP and hosted MCP:
  the restart paints before release, the old exit is superseded, and Next still works.
  Browser199 stalls before restart with the old client. Browser201 reaches the new
  restart but stalls reading Chromium's intercepted response body;202 reads the same
  actual response through route.fetch before fulfilling it. Both attempts are retained.
  The fence is latest-intent-wins within one document, not FIFO or cancellation across
  reloads. Different documents/agents retain arrival-order control. See the
  [public contract](../http-api.md#board-tours); no generic request framework was added.
  Both bounded203 rechecks accept the fence. A current superseded startup now explains
  the missing stop while the catalog is delayed: client/browser204 fail before the
  feedback fix, client205 and headed206/209 pass after. Run205's route-teardown error
  is retained; waiting for pending handlers fixes teardown without changing assertions.
- **Authored JSON ownership:** readiness and draft ownership have separate lifetimes.
  A retained document may finish painting after a spec change but cannot supply the
  replacement's drafts. Unit185 fails both initial-load orderings before the fix.
  Browser188 passes src/srcdoc with a held initial load; deliberately removing the
  authored-identity check makes both cases copy `Old user draft` into the new spec
  in189. That mutation is removed. Browser187's earlier image-blocking probe instead
  waited for content before the required parent restore; it was a harness error.
- **Complete connection snapshot:** browser185 reproduces a lost remote tour command
  while the initial catalog HTTP request is held. The shared SSE/poll snapshot now
  sends the catalog before its layout, rather than adding another client event queue.
  The same browser case and the snapshot API test pass in186. This closes the startup
  gap exposed by the new tour identity check, without assuming reordered transport.
- **Review183 reconciliation:** Claude withdrew hidden-port displacement, hypothetical
  polling reordering and Copy JSON's intentional replacement refusal as defects after
  inspecting the existing profiles, probe148 and supported contracts. Neither reviewer
  found another concrete edge-cache or Copy JSON ownership failure. Zoom layout time
  differs between the profiled bundles; no cause or user-visible slowdown is established.
- **Populated loading comparison before review183 repairs:** benchmark180 uses identical 70-card states,
  33 visible viewers at18%, headed Chromium145 at1440×900/2x, and alternating builds
  over three cold-browser/warm-reload pairs each. Server/OS caches are warm; no build
  or test suite runs concurrently. Candidate bundle1f19d305 takes7.55–7.82s cold and
  7.86–7.94s warm versus0.10.0's7.63–7.99s and7.95–8.09s. All33 viewers report content
  ready, with no missing viewers, page errors or timeouts; states remain identical.
  This does not reproduce run79's earlier candidate slowdown. Small samples and
  instrumented readiness, rather than native paint, do not establish a speedup,
  equivalence or a cause. The four subsequent lifecycle fixes are not measured by
  this comparison. Reproduce with `scripts/benchmark-populated-canvas.mjs`.

**Independent Copilot evidence for released0.10.0, not this source:** its final
report records source330 pass/1 toolbar-resize failure/2 platform skips and
registry319 pass/11 teardown failures/2 skips. Unchanged targeted reruns pass;
the original gates remain red and causes unresolved. Current verification overlaps
the resized multi-agent toolbar and script-only hosted forms. It cannot explain
those Mac failures without the raw traces, which remain on Copilot's machine.
Scoped public contracts, documents and persistence pass separately. Native steering
queued despite installed immediate-mode send sites; Peter observed manual submission
was required. The original probe arrived about91 minutes later, with manual send
versus automatic draining unknown. That is not active-run or idle-wake acceptance.
Fresh extension activation and native WKWebView remain unverified. This report
does not justify speculative adapter changes or upgrade current native acceptance.

**Independent Codex evidence for released0.10.0, not this source:** its final
addendum records source325 pass/6 fail/2 platform skips and registry329 pass/1 fail/2
skips. Unchanged isolated passes do not clear either aggregate. The registry footer
Home failure (`scrollTop: 3019`) repeats an earlier Amp finding. Source failures
overlap file saves, hosted draft replay, HTML/Mermaid, hosted Clear and wide Home;
five are teardown timeouts. Concurrent broad runs confound load attribution.

- **C01, reproduced platform defect:** macOS foreground PTY Ctrl-C twice retained
  PNGs but exited1 without `recording.json`; normal-duration capture finalized.
  Linux recording checks do not close this. Introduction and root layer are unknown.
- **C02, guidance/API mismatch:** swept expired intents permit unlinked leaf writes;
  top-level batch linkage rejects standalone but is discarded attached/HTTP.
  Leaf linkage and veto controls work. This is not an established authorization
  bypass. Correcting those skill promises is separate from the UI changes here.
- **C03, integration limitation:** terminal progress arrived40/40 on the wire but
  31/40 through SDK1.32.2 callbacks, with nine unknown tokens. SDK cleanup is a
  hypothesis, not an established PMX cause or a durable completion signal.
- **C04, guidance discoverability:** the main skill needs a response-shape reference
  with direct-tool/help exceptions, not a universal unwrap. No skill edit is implied.
- **Native scope:** Codex paint/actions, selected inline/expanded drafts and imports
  passed on released code. Configured discovery still shows24 tools/no help versus
  fresh25. Graph Open in tab was unobserved before permission blocked inspection;
  remaining graph/Excalidraw/keyboard checks are incomplete. These results do not
  verify the changed viewer host in native WKWebView. Raw traces remain external.

These are separate acceptance findings, not authorization to broaden product fixes
or weaken the current source gates. Native activation, PTY finalization and aggregate
reliability remain explicit gaps alongside the current viewer-host limitations.

**Inherited 0.10.0 evidence, not 0.11 acceptance:** the [pinned independent audit](https://github.com/pskoett/personalclaude/commit/42b22f863214be48ef8b90b4050323b060ee558f)'s original
portal aggregate remains 324 pass / 8 fail. Six failures were harness defects; the
isolated eight-case pass does not replace the aggregate. Footer Home scrolling and
the lifecycle warning after reload remain unexplained intermittent failures, as
does the receipt Undo/unpin CI retry. The audit's supplemental portal, renderer,
nine-theme, extraction, keyboard, minimap and registry-SDLC checks passed. Native
Amp passed the pin/read/steer/edit/visible-result/ack sequence and negative controls,
whole-board context, help-guided creation, AX gating and Bun.WebView lifecycle.
Native reconnect/subscriptions, Copilot/WebKit, idle wake-up, persistent pumps and
native Skills activation remain unestablished. Existing skill packaging/guidance
debt and the low KaTeX advisory GHSA-238p-pmpm-9mq7 are outside this UI change.
No cancellation behavior changes here: aborted MCP requests may suppress final
responses even when writes already persisted.

- **One frame host** for `html`, `mcp-app`, `json-render`, `graph`, `webpage`, `mermaid`: lazy
  mount near the viewport, independent loading, one loading deadline, one visible fallback with
  retry, full theme tokens passed in. Reuse the shared AX bridge. Replaces the recovery
  machinery in `ExtAppFrame.tsx`. Mermaid renders inline.
- **Native spatial scaling** (maintainer override): restore the common world transform.
  No alternate grid, content enlargement or iframe counter-scaling. The historical native
  WKWebView black-tile issue remains unverified; do not infer compositor health from DOM readiness.
- **Wave-0 design pass** ([design gaps](design-gaps-2026-10-08.md) suggested order 4): section
  labels (#2), the 44 px floating-chrome lane and Updates chip (#3), node header fill/title
  (#7), then the token sweep (#4 type floor, #5 radii/elevation, #6 Harbor drift, #9 raw
  `rgba()`), then the per-type pass (#8).

**Done when**
- Viewers inherit the canvas palette and automatically render as their regions become visible.
  Fit-all keeps the same board geometry and proportional contents. Retention costs memory.
- Authored drafts, input state, offscreen replacements and the painted-refresh handoff still
  pass their existing browser cases.
- Each design-gap item matches its drawing at 600, 1024 and 1920 px in all nine themes; the
  demo board is regenerated and `tests/unit/demo.test.ts` passes.
- WebKit remains best-effort and the limitation stays explicit. Per vision move 5, a WebKit
  project joins the gate at the hosted share link or the next WebKit-only bug that reaches a
  release, whichever comes first.

## Step 4: 0.12 Wave 5 and relations sketch parity

[Vision move 3](../product-vision-2026-09.md#3-the-agents-output-moves-onto-the-board-m), move 0's
make board / inline board, [design.md Wave 5](../design.md#build-plan) and the remaining
Relations/Flows/Uses sketch parity.

**Before building:** decide how board-qualified relations, provenance and review records move
when a card moves into or out of a board (plan 009 "Wave 5, groups and agent output"), and the
move 3 open questions (decision 3).

- Work items as `status` nodes; gates, elicitations and mode requests as one `ask` node with an
  attributed answer (new node type: follow the "Adding New Node Types" checklist in `CLAUDE.md`).
- Make board / inline board; group drill-in with breadcrumbs and outside endpoint stubs.
- Relations sketch parity: inline edge editor, amber stale-lineage strokes, pair/cycle/affected
  badges, Show lineage / Show on canvas.

**Done when**
- design.md's Wave 5 check: agent output uses the same shell and tokens; a group opened as a
  board shows its outside stubs.
- Moving a card preserves its outside links and audit identity; copying a claim does not
  copy its validation.
- A changed source turns downstream edges amber on the board, not only the card footer.
- The `ask` node renders in a live browser board (DOM check), not only in unit tests.

## Step 5: later

In dependency order, each starting only when the previous one is in use:

1. **Trust, M half** (move 7): per-writer tokens, `--listen` with a token, file confinement
   with a per-board allow-root list (decision 5).
2. **Journal** (move 4), then stage-2 concurrent boards.
3. **Binary** (move 8). README changes need explicit approval.

Move 7 is built here for remote agents and as the authorization model hosting reuses; local
PMX stays single-user, and static export is its sharing path.

## Step 6: evaluations (end)

- First run of [curation-effect](../evals/curation-effect.md) on the then-current release;
  resume its per-release reruns from there.
- Benchmark the 17 skill eval prompts against a baseline (plan 009, skill-mirror row).

## After this plan: the hosted version

Not scheduled here. All account and team work belongs to the hosted version (vision Part 4,
decided 2026-10-19): the read-only share link (with a WebKit project added to the gate),
comments, a second writer, accounts, per-board roles and org/team/personal scopes. There is
no supported self-hosted multi-user edition; local and self-hosted PMX stay single-user.

**Built for both hosted editions.** The ChatGPT Sites version ships first and the standalone
Cloudflare version (Part 5) follows, so this work lives in the shared product per
[ADR-002](../adr-002-shared-product-separate-runtimes.md): roles, membership, scopes,
publication and per-board read filtering are shared rules keyed on an edition-neutral
principal; each edition supplies runtime adapters, including identity, storage, lifecycle and
external capabilities (decisions 2–3). Editions reuse domain rules, schemas and contracts but
own independent records, without synchronization; memberships never import as authority
(decision 7). Dependency checks establish source separation only: verify supported behavior
and lifecycle guarantees on Sites, and on standalone Cloudflare when that edition is
implemented. Cloudflare is not a prerequisite for Sites.

**Order inside the hosted version:** authenticated identity and per-board permissions before
the first share link; full account administration and scopes can follow. Validate browser
board sharing separately from plugin installation for each intended audience: Sites documents
external invitations and public publishing for the browser, while Site-hosted plugin sharing
is narrower (vision Part 4).

**Prerequisites from this plan:** move 7's authorization model (step 5.1), the vision's
extraction gate (one complete read/edit/commit/reconnect slice), and the journal (step 5.2)
before the hosted second writer. Decision 6 must be settled before accounts and scopes.

## Open decisions

| # | Decision | Blocks | Proposal |
|---|---|---|---|
| 1 | MCP hardening before the frame host | Steps 2–3 order | **Decided 2026-10-19:** yes, MCP is the agent half. A narrow WebKit fix can still ship as a patch |
| 2 | Version numbers and batch size | Every release | One minor per step, as above |
| 3 | Keep the `policy` singleton, `host-capability`, the command registry; ghost intents opt-in? | Step 4 | Decide before Wave 5 |
| 4 | Gate a release on native Copilot/WebKit, Windows, the Amp context pill or npm-installed execution? | Steps 2–3 | None gates 0.10; revisit for the hosted version |
| 5 | File-confinement default | Step 5.1 | Per-board allow-root list |
| 6 | Context vision: personal- or team-first wiki, personal-space owner, who publishes, default wiki entry, assistant defaults | Hosted accounts and scopes | Decide before hosted accounts |
| 7 | Move 6b, generated surfaces | Not blocking; 6a stands alone | Still undecided |
