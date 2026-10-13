# Wave 2: connected memory

**Status:** Implemented and stabilized with the Wave 3 foundation. Not released.

Build on the local wave-1 stabilization batch. SQLite remains authoritative; Home is a view,
not a board, and folders are independent of the many-to-many link graph. The exported
HomeMap/HomeGraph artboards supply the visual model; newer neutral-folder decisions override
their category hues, synthetic Home and derived levels.

## Contract

- Resolve Markdown `[[Board]]`, `[[Board#Card]]` and optional `|label` aliases on save.
  Store durable, board-qualified targets separately from the authored text. Preserve unchanged
  bindings across renames, never guess an ambiguous title, and keep deleted targets visibly broken.
  Code spans and fenced code do not create links. Unresolved board links offer explicit creation.
- Extend native edges with an optional target board ID. The source remains on the active board;
  this does not permit writes on another board. Qualify both ends in the graph, including when
  two boards contain the same card ID. Preserve edges in snapshots, undo and persistence.
- Project boards, cards, membership, portals, wiki links, native edges and previous-board chains
  once on the server. Home Graph, Map, board backlinks and agent graph reads consume it.
  Summaries count as seen, not full reads. Missing targets are explicit and unlinked boards remain visible.
- Home Map groups boards in neutral folder regions; human-dragged positions persist in SQLite.
  Map and Graph use the existing workspace board pins. Graph supports focus and bounded depth,
  search/type/context filters and direct board/card navigation without switching boards on read.
- Existing qualified library search stays. The brief discovers linked boards from the same
  projection; wave 3 adds richer kinds, reasons, downstream review and lifecycle.

## Build and verify

1. Durable links/edge persistence and one projection across HTTP, SDK, MCP and CLI.
   Verify renamed, duplicate-ID, ambiguous, missing, inactive-board and restart cases.
2. Home Map/Graph and wiki navigation to the drawings, with responsive controls.
   Verify human gestures and agent exploration against the same disposable library.
3. Update public contracts and bundled skills; run unit/client/type/lint/build/browser gates,
   inspect rendered states at 600, 1024 and 1920 pixels and in all nine themes, then review.

No release or deployment is part of this work. Stabilization changes and unrelated board artifacts
must be preserved; wave 3 follows this checkpoint as a separate batch.

## Original Wave 2 checkpoint (before the Wave 3 foundation)

- `bun run test`: 1,418 passed; `bun run test:client`: 276 passed.
- `DISPLAY=:88 bash scripts/run-playwright.sh --headed`: 248 passed on the final bundle,
  including the 600, 1024 and 1920 px reference projects and all-nine-theme coverage.
- Build, typecheck and `git diff --check` pass. Lint has no errors; 64 warnings and 12 infos remain.
- Live human gestures exercised create/edit/Save, wiki creation and navigation, remote-card
  connection, delete/Undo/Redo, Map drag/reload, Graph discovery/pin/unpin and receipt See change/Undo.
  Source and rich-editor drafts and selections survive agent relation changes and missing/restored
  targets; delayed file-backed previews cannot overwrite a subsequently saved draft.
- Real CLI graph and stdio MCP exploration match the same library without moving the human's
  active board. Read accounting preserves captured revisions and never acknowledges omitted links.
- Adversarial review findings were reproduced and fixed; Oracle's final focused follow-up found
  no blocker. Inspected live screenshots are in `.amp/in/artifacts/w2-final-human/`.

This checks the orb's real local stack, not a released package or a native host installation.

## Combined stabilization

The later foundation exposed reconnect attribution, native save-lineage, board ownership,
inactive-board scope and catalog replay races. Their fixes are implemented and documented
in the public contracts. Oracle's final focused follow-up found no remaining race blocker.
The final unit/client gates pass (1,437/302), and the clean full headed run passes all 266
cases, including the 600, 1024 and 1920 px reference projects and all-nine-theme coverage.
Real browser restore/late-ACK and catalog replay probes also pass. The previous full run
had 264 passes and two failures: its race-test interceptors did not match the new
board-qualified state URL. Correcting that harness, without a product change, made both
isolated cases and the subsequent full run pass. Earlier failure evidence is retained.
`bun run test:coverage` passes with 64.71% lines and 72.10% functions, above the CI floors;
the fresh-workspace CLI E2E flow passes with headed browser verification. Build, typecheck,
bundled-skill checks and diff-check pass. Lint has zero errors (64 warnings and 12 infos);
`CLAUDE.md` and `AGENTS.md` match.
Live human gestures cover wiki creation/navigation, Map drag/reload, Graph context/details,
narrow scrolling, daemon reconnect and restored unsaved drafts. Real CLI and stdio MCP
exploration preserve the active board; lifecycle retain/retire/restore preserves content,
validation and attributed audit history. Inspected screenshots are in
`.amp/in/artifacts/w3-final-human/`. Native Copilot/WebKit, native Windows and registry-installed
execution remain separate unverified surfaces; absent skill mirrors were skipped, not validated.

## Remaining Wave 3 stabilization (2026-10-11)

The remaining relationship and lifecycle work starts from the published foundation, with
`fb3554bddd0565d94a8747c79b30866f4d1c434b` verified as an ancestor. The owner requested
adversarial self-review instead of Oracle. This batch is unreleased at 0.8.2. Commit and push
are authorized after stabilization; release, tagging, publishing and deployment are not.

Reproduced findings and fixes include lost authored provenance, lifecycle-only changes omitted
from incremental briefs, stale review drafts acquiring new source preconditions, duplicate
source entries masking an unavailable observation, and a Markdown due footer below the visible
card. Live browser inspection also found a scrolling relation legend and Fit placing cards under
the new controls. Each has a failing reproduction and a passing focused check. A full preliminary
headed run passed 267 cases and failed the packed-consumer selector: its whole-card text matched
the new source warning as well as the target card. Targeting the card title fixed that harness.

Owner portal feedback caught the preset selector resetting to “Vocabulary…”. The final legend
keeps all four preset names across reload, reports “Custom vocabulary” after a kind edit, and
uses the `Uses` drawing's 24 px selector, rounded count chips and one highlight per vocabulary.
The reset reproduction failed; the corrected headed relation case passes.

The latest serial gates pass 1,443 unit and 302 client tests, typecheck, build and lint (zero
errors, 64 warnings, 12 infos). Unit coverage is 64.68% lines and 72.16% functions, above the CI
floors. The final full headed suite passes 268 cases; fresh-workspace CLI E2E passes with
headed browser verification. Bundled-skill checks pass and the guidance twins match. Agent-skill
mirrors are absent, so that check skipped rather than validated. The post-debt serial run is
`/tmp/pmx-w3-post-debt.gM8WHG`; its CLI workspace is `/tmp/pmx-canvas-e2e.IyKnoE`.

Published foundation CI had failures despite the preceding local passes. Review of
[that run](https://github.com/pskoett/pmx-canvas/actions/runs/38153215292) found Windows subprocess
imports using URL pathnames instead of filesystem paths, plus test-order contamination: an MCP
case replaced the shared intent emitter and then disabled it. The local ordered reproduction
failed in `/tmp/pmx-w3-ci-order-red.FpSrwd`; the same three cases pass in
`/tmp/pmx-w3-ci-order-green.QSzLU1` after reading the public workbench event stream instead.
The subprocess imports now use `fileURLToPath`. No assertions were removed and no retries added.
These are test-harness fixes, not a native Windows UI verification claim.

Live human-style browser gestures cover source editing/Save, relation reason and vocabulary
editing, preset adoption, category editing, folder inheritance, evidence review, retirement/Undo,
and explicit recipe handoff. Real stdio MCP and CLI checks cover stale-source rejection,
qualified briefs and search, retired pinned-resource exclusion, restore preserving validation,
and relation round-tripping. A second real MCP client reads the human's pinned source and recipe
steering after restart. Recipe requests do not execute tools or renew validation.

Inspected captures in `.amp/in/artifacts/w3-acceptance/` cover 600/1024/1920 px and all nine themes.
Failed-run evidence remains in separate `/tmp/pmx-w3-*` directories, including `draft-repro`,
`duplicate-red`, `legend-red`, `footer-red`, `fit-red`, `preset-red` and the preliminary full run.
The [maintainability review](plan-009-tech-debt-backlog.md#wave-3-maintainability-review-2026-10-11)
removed repeated request-local qualification/layout reads. Its measured scaling costs and future
frame-host, move/audit, journal and runtime boundaries are now checkpoints in the vision.
These are Chromium/source and local-packed-consumer checks, not native Copilot/WebKit, native
Windows or registry-install verification. No tag, publish, deploy or version bump is authorized.
After push, the owner still needs to E2E-test the complete change since 0.8.2 from the updated
checkout. Running the unchanged registry package at 0.8.2 does not exercise these changes.

## Home acceptance integration (2026-10-12)

The combined batch starts from `0fbc593ac99a7ba34ed6cc59ccc0c49e14ccc606`, with the requested
foundation verified as an ancestor. The frozen parent source patch was integrated exactly
(SHA256 `2046aaa21b8e4f326e7da5c99dd7d9042f8ff7802bd871d9dc432b5cc74428f5`), preserving the
separately owned HomeMemory/layout/live-update changes. Generated bundles, declarations and
tool catalogs are rebuilt here. The unrelated SDLC artifact is not part of delivery.

Graph now uses live view-local forces, folder outlines and board/card clusters, with counted
filters, focus/depth, display controls and individual connection reasons. Map preserves saved
board positions inside collapsible folder regions. Agent edits refresh the projection without
resetting the human's camera, selection or dragged particles. Board-only controls and native
paste are unavailable while browsing memory. The parent acceptance fixes add navigation-only
folder trees, actionable review summaries, safe unused-category deletion, compact settings,
one-note reviews and ring/hover/legend/Fit corrections. Read, content, validation and relevance
remain separate clocks.

Adversarial self-review and live transport checks found two additional bugs: the advertised
MCP board-portal type was rejected by a duplicated enum, and the library context chip omitted
the pinned active board. Both have red/green regressions, retained in
`/tmp/pmx-combined-portal-{red.89FSEL,green.OSHgsr}` and
`/tmp/pmx-combined-chip-{red.jZHY9I,green.805Bqn}`. The earlier library/paste regressions are
retained in `/tmp/pmx-home-live-red.hjJURq` and `/tmp/pmx-home-paste-red.2qNf8V`.
The [integration debt review](plan-009-tech-debt-backlog.md#home-acceptance-integration-review-2026-10-12)
and vision record explicit per-tab editor ownership and measured scaling as future checkpoints.

Live human gestures on disposable data include Graph drag, force controls and pinning, Map
collapse, Open board, source editing/Save, review confirmation and Not now, and category
creation/deletion. Real stdio MCP reads the human's board pin, edits a card, and creates portal
and wiki connections while Graph stays open with the same camera/selection. The observed DOM
contains both new link kinds and the updated title (`/tmp/pmx-combined-mcp-observed.kO6Ywo`).
Review evidence records actor human with content/reviewed revision 24. An aborted graph read
shows Retry; a successful retry restores 114 board/card nodes. The first scratch selector wait
timed out, but the inspected error capture and the actual Retry click/recovery succeeded.

Inspected renders in `.amp/in/artifacts/combined-acceptance/` include Map/Graph at 600, 1024
and 1920 px in all nine themes, narrow selected details, collapsed Map, graph failure, category
scrolling, folder settings and Review. All 54 matrix captures have DPR 2 and no body horizontal
overflow. Two agent-browser motion recordings failed encoder backlog; their failed files remain
in `/tmp/pmx-combined-recording-failed*.webm`, not presented as successful video evidence.

This is not full Relations/Flows/Uses sketch parity: the inline edge editor, amber lineage
strokes, pair/cycle badges and lineage actions remain unimplemented as documented in design.md.
Dense fit-zoom Graph labels still need selection/local focus for detail; this fixture is not a
large-library capacity claim. The owner's Amp embedded-portal pill-opening report is unverified,
distinct from the fixed pin count and from the passing Chromium test-host interaction. Native
Copilot/WebKit, native Windows UI and registry-installed execution remain unverified. Portal
creation was exercised through MCP/HTTP, not an expansion of generic CLI/typed-SDK add data.
No release, tag, publish, deployment or version bump is authorized; the owner still needs to
test the complete changes since 0.8.2 after the approved commit/push.

Final serial local gates: `bun run test` passes 1,444; `bun run test:client` passes 306;
coverage passes at 64.71% lines / 72.23% functions. Build, typecheck, bundled-skill checks,
guidance-twin comparison and diff-check pass. Lint has zero errors, 63 warnings and 12 infos.
Absent agent-skill mirrors explicitly skip. The demo generator leaves its fixture unchanged.
`DISPLAY=:88 PMX_PLAYWRIGHT_DB_PATH=<fresh-db> bash scripts/run-playwright.sh --headed`
passes all 276 cases. `DISPLAY=:88 PMX_E2E_HEADED=1 PMX_CANVAS_E2E_KEEP_WORKDIR=1 bun run test:e2e-cli`
passes in `/tmp/pmx-canvas-e2e.bQukul`. Logs are in `/tmp/pmx-combined-final-gates.ijVDni`,
`/tmp/pmx-combined-final-headed.nIX7dJ` and `/tmp/pmx-combined-delivery-gates.VFWQ4K`.
After the full browser run, only tool-description prose changed; regenerated catalogs/build,
typecheck/lint and 47 focused MCP/skill checks passed again before the CLI gate.

The additional live two-board vocabulary control sets Platform overview to Dependencies and
Research index to Flow through the UI. Both retain their own selection after switching and
reloading; the other 11 boards' vocabularies remain unchanged. Evidence is in
`/tmp/pmx-combined-vocabulary.SSw0oL` and the inspected vocabulary captures. The full-browser
context pill opens, but that is not an Amp embedded-portal verification. A scratch Graph click
ran before Home's asynchronous navigation finished; waiting for Library view before clicking
completed normally. The inspected final Graph has 114 nodes at DPR 2 with no body horizontal
overflow; its long sidebar scrolls to the force controls. Board captures retain the existing
camera, so Fit is still needed when a stored card sits under floating controls.

### Cross-platform startup finding after the combined push

The combined commit was pushed as
[11dc3117](https://github.com/pskoett/pmx-canvas/commit/11dc311732d8c12acc86dda12b269539df8fa5b3).
[Its CI run](https://github.com/pskoett/pmx-canvas/actions/runs/38213111457) passed Linux,
CLI E2E and browser E2E, but both macOS and Windows failed the same concurrent pre-folder
opening test at `openCanvasDb`'s `PRAGMA journal_mode=WAL`: an immediate `SQLITE_BUSY`
despite `busy_timeout=5000`. macOS reported 1,443 passes and one failure; Windows reported
1,422 passes, 21 existing skips and one failure. Full failed job logs remain in
`/tmp/pmx-combined-ci.fLBUAO/{macos,windows}-failed.log`.

SQLite documents both [busy-handler bypass](https://www.sqlite.org/c3ref/busy_handler.html)
and [WAL open/close contention](https://www.sqlite.org/wal.html#sometimes_queries_return_sqlite_busy_in_wal_mode).
The fix retries only journal negotiation within the existing five-second budget, restores
the usual busy timeout after success, and closes the connection on terminal initialization
failure. Other errors still propagate immediately; arbitrary content writes are not retried.
No test assertion, platform skip or CI retry policy is weakened.

Thirty natural Linux repetitions passed before and after, so they are not claimed as a local
reproduction of the platform race. A disposable fault-injection probe of the exact immediate
BUSY fails before (`/tmp/pmx-wal-probe-red.QJ9JfP`) and passes after
(`/tmp/pmx-wal-probe-green.UwfjJ3`). Its negative controls retain a bounded permanent-BUSY
failure (about five seconds) and immediate corruption failure. The real concurrent/contended
open regression remains unchanged in the permanent suite; the injected probe is validation
evidence, not a mock-based replacement for the native-platform gate.

The follow-up headed run also exposed a synchronization race in the file-backed suspended-save
test. Its trace shows the canonical-content poll arriving at 140508.771 ms, before the test
registered `waitForResponse` at 140536.895 ms; subsequent incremental polls correctly omitted
the already-delivered change. The listener now registers before the peer save. The 409 refusal,
preserved draft, unchanged canonical file and deliberate subsequent-save assertions are intact.
The failed trace, videos and screenshots remain under
`/tmp/pmx-wal-final-gates.vWZ0g3/results/boards.pw.ts-save-and-boar-33e76-its-draft-file-backed-true--desktop`.

Final local follow-up gates ran serially: build/typecheck, lint (0 errors, 63 warnings,
12 infos), 1,444 unit tests, 306 client tests, unit coverage at 64.70% lines / 72.23%
functions, and fresh-workspace headed CLI E2E all passed. That first browser attempt finished
with 275 passes and the one listener failure above. After the test correction, typecheck and
lint passed again, both suspended-save variants passed ten repetitions each (20 cases), and
the fresh full headed run passed all 276 cases at the configured reference widths. There were
no browser retries in either local full run. Evidence is retained in
`/tmp/pmx-wal-final-gates.vWZ0g3`, `/tmp/pmx-wal-corrected-gates.UL7xSE`, and the CLI workspace
`/tmp/pmx-canvas-e2e.dfySJW`. The client bundle did not change in this follow-up; the combined
human, real-transport and inspected visual evidence above remains applicable. Native-platform
CI is still a separate gate, not implied by these Linux results. No release or version change.

### Delivered checkpoint, 2026-10-12

The [stabilization follow-up](https://github.com/pskoett/pmx-canvas/commit/fd63c3c611e680864d444532ca3ef7bb79cd171e)
is pushed on top of the combined implementation. Its
[CI run](https://github.com/pskoett/pmx-canvas/actions/runs/38218734543) completed successfully
across all five jobs: Linux, macOS, Windows, browser E2E and CLI E2E. macOS reports
1,444 passes and zero failures; Windows reports 1,423 passes, 21 existing skips and zero
failures. The unchanged concurrent/contended-open regression passes on both platforms.
Browser CI reports 276 passes with no flaky/retry report. This closes the native-platform
startup gate above; it does not erase the initial failed runs or their red/green evidence.

A focused read-only Oracle review of the follow-up found no blockers in the startup-only
retry or save-test synchronization. The owner portal runs this build, with all 11 boards
preserved; restart checks retain the active board, card contents/geometry, edges and camera.
The owner's step-by-step acceptance guide now records the delivered build and green CI,
without marking manual tests passed or replacing the owner's notes.

This is ready for owner acceptance, not a claim of full sketch parity or release approval.
The embedded Amp pill-opening, dense Fit-label limits, Relations/Flows/Uses gaps and native
host/UI/registry-install boundaries above remain explicit. Version is still 0.8.2; no release,
tag, publication, deployment or version bump was performed. Staged maintenance remains in
the vision and debt backlog.

### Guest cursor polling latency, 2026-10-12

The owner's slow guest-cursor report exposed a PMX transport delay: orb pages select the
proxy-safe polling path, but that path paused two seconds after every response. Human cursor
POSTs already throttle at 80 ms and server presence emits coalesce at 16 ms. Neither the
cursor styling nor the shared board database needed to change.

Direct HTTP clients now request a bounded long poll on the existing event ring. A caught-up
request waits at most 1000 ms, wakes when an event arrives, and cleans up on timeout, abort
or server stop. An 80 ms client pause bounds busy-stream request rate. Snapshot/ring recovery
and SSE are preserved; hosted MCP-app tool polling retains its two-second cadence. No new
presence channel or host-specific styling was added. Self-review covered event ordering,
waiter cleanup, client generations and the hosted/direct transport distinction.

The starting checkout contains the requested
[docs baseline](https://github.com/pskoett/pmx-canvas/commit/175031013ef6bc31b94cec16d5def56661e866b6)
and the newer docs-only
[checkpoint](https://github.com/pskoett/pmx-canvas/commit/3b7a570a98bd6f32b8a50386c04bfc81db2a76e6).
The same two headed Chromium clients moved the pointer through the real orb portal in both
directions, one workbench inside a cross-origin iframe, on a disposable one-card board.
Three 100-point sweeps per direction and build produced:

| Observed measure | Unchanged baseline | Fixed build |
| --- | --- | --- |
| Remote target updates during movement | 0.47–0.48/s | 11.24–11.54/s |
| Median target-update gap | 1999–2001 ms | 84 ms |
| Estimated median rendered lag, including interpolation | 848–934 ms | 213–217 ms |
| Estimated p95 rendered lag | 1898–2000 ms | 262–266 ms |
| Receiver animation cadence | about 60 frames/s | about 60 frames/s |
| Own-cursor count | 0 | 0 |

Lag estimates match rendered cursor x positions to a monotonic input sweep, not a network
round-trip measurement. The final fixed idle client completed eight polls over six seconds.
Before/after recordings were inspected. An earlier fixed capture needed dense 100 ms frame
samples and decoded positions to contradict a coarse automated description of pauses.
The final-build capture also shows continuous movement rather than the baseline's two-second
jumps. Two final recording attempts at 60 and 30 fps overloaded the encoder and were retained
as failures; the inspected recording uses 15 fps. Final recordings are
`.amp/in/artifacts/cursor-latency/before-final.webm` and `after-final.webm`.

The public HTTP long-poll regression and two-client rendered-coordinate regression both
failed on unchanged code, then passed with the fix. The existing two-tab grab/lock/yield
case also passed with SSE forced as a control. Red evidence is retained under
`/tmp/pmx-cursor-red.RjuzlZ`; focused green build/typecheck, HTTP and headed evidence under
`/tmp/pmx-cursor-green.GqytFB`. Repeated portal measurements, served-bundle hashes, input and
render samples and video-frame analysis are in `/tmp/pmx-cursor-comparison.oZBHTD`.
Earlier failed recordings/navigation and invalid duplicate-tab or throttled measurements
were retained separately, not counted as successful runs. The final measurement harness
selects the agent-browser-owned targets, closes extra test tabs and rejects low frame/input
cadence or duplicate own cursors.

The first full headed run passed 276 cases but timed out in dark HTML refresh continuity.
Its trace places the stranded poll at 296926.670 ms, between disabling interception at
296924.232 ms and reenabling it at 296938.877 ms. Ten unchanged focused reruns passed;
those did not explain or erase the failure. A standalone headed Chromium + Node HTTP
probe, with no PMX code, reproduced the interception failure: toggling an unrelated route
stranded fetch 22 before it reached the server (21 requests received and completed).
Keeping the route installed let completions progress from 234 to 279 over the final
observation window. The test now installs its route once, preserves every per-revision
hold, painted-content assertion and screenshot, and uses the existing context cleanup.
All 12 repeated HTML/JSON-render dark/light cases passed after that harness correction.
No viewer or product timeout workaround was added. The initial full-run trace/video is
retained in `/tmp/pmx-cursor-gates.qGwgtE`; the isolated reproduction and unchanged reruns
are in `/tmp/pmx-cursor-refresh-investigation.SJzGeg`.

The next full headed run passed 276 cases and failed one receipt Undo/Unpin assertion in
strict mode: bare `[data-node-id]` matched both the card and a transient command-bar chip.
The card still showed the expected `After B` text. Five card assertions in that case now
explicitly target `.canvas-node`; the unseen-human-edit and pin-set checks are unchanged.
Ten consecutive headed repetitions passed. This second failed run, including the DOM trace
and screenshot, remains in `/tmp/pmx-cursor-final-gates.T08vva`.

The third full headed run passed 276 cases and failed the rich-relation hover handoff
assertion. The trace shows 184 ms between starting the blank-canvas pointer move and reading
the class, beyond the intentional 120 ms hover grace; the two requested animation frames
alone took 115 ms. That test now drives real pointer events with controlled 50 ms crossings
and a 500 ms blank-canvas control, then resumes normal time. Three repetitions passed,
removing the grace in a test-only served bundle failed at the short-crossing assertion,
and three more repetitions passed after removing the mutation. The probe asserted a unique
bundle replacement and a loaded runtime marker; no mutation code remains in the tests.
No hover/store/CSS production code changed. The real-time cursor measurements above use no
controlled clock. The third failed run is retained in `/tmp/pmx-cursor-delivery-gates.ozvSAA`;
hover red/green evidence is in `/tmp/pmx-cursor-hover-clock.Z1UYwU`.

The fourth full run passed 274 cases and exposed two product races plus a ghost-test sampling
gap, retained in `/tmp/pmx-cursor-final-browser.7Mdqdq`:

- A painted shortcut overlay could miss immediate Escape while the App keyboard effect still
  closed over its previous state. The keyboard subscription now updates at layout commit.
- An earlier same-tab Fit camera echo arrived during a newer Fit animation and cancelled it.
  Viewport writes now carry the existing tab identity; only the originating tab ignores that
  echo. Peer tabs and explicit agent commands still apply the camera. This is echo metadata,
  not an authorization mechanism.
- The ghost test's best rAF sample was 30.5px from the target, and it did not observe the
  `animationend` endpoint before removal. It now also samples that endpoint in capture phase.
  Position/size thresholds and normal frame samples remain; no ghost rendering or timing changed.

The keyboard and camera interleavings both failed deterministically before their fixes. The
camera case rendered a 250px card instead of completing the newer zoom to 312.5px. Afterwards,
18 headed checks passed: three each of the two regressions, original Graph and attachment
cases, ghost settling and two-client cursor motion. The camera regression also checks a peer
receives both zooms and an agent command still overrides both tabs. Evidence is retained in
`/tmp/pmx-cursor-races.S1FpCT`.

An intermediate measurement repeated the sweeps after the keyboard/camera fixes.
Its portal-served bundle hash matched that built bundle; six sweeps and an additional recording
control maintained about 60 receiver frames/s. Those measurements, hash and failed encodes are
also in `/tmp/pmx-cursor-races.S1FpCT`.

The next serial gates in `/tmp/pmx-cursor-stabilized.T2t2MW` passed build/typecheck, lint
(0 errors, existing 63 warnings/12 infos), 1,445 unit tests, 306 client tests, coverage
(64.69% lines / 72.29% functions, both floors met) and fresh-workspace headed CLI E2E
(`/tmp/pmx-canvas-e2e.bf3lLB`). The full headed browser gate finished **278 passed, 1 failed**.
The failure was `canvas-app.pw.ts`'s curated structured notes / AX host-context case, so that
run did **not** establish stability.

Its trace confirmed a hosted pin-ordering race: poll `since=1378` starts at
187162 ms, before Clear all's POST at 187168 ms. The poll returns old pin event 1380, restoring
the cleared pin in the UI; the intended re-pin at 189205 ms consequently submits `nodeIds:[]`.
Focus reaches the host, but the pinned card is absent. Pin code and hosted two-second polling
were not changed here; this was not reproduced against a separate baseline build and is not
claimed conclusively pre-existing. The trace, failure screenshot and video remain with that
run; the blocker was reported to the parent orb before further changes.

The pin revision fence now covers local writes as well as incoming frames. Poll replies that
cross a local write or a newer authoritative read skip only their stale pin frames, then read
the canonical server pin set from the existing event snapshot, without replaying its other
frames. This costs a snapshot read on pin reconciliation rather than adding a new endpoint.
The agent-facing pinned-context brief is not authoritative for membership: it filters retired
cards. Pending writes reconcile after completion, including refused and normalized requests.
Board changes invalidate old-board continuations. This adds no
server clock, changes no 20-pin limit and does not suppress later peer or agent writes.
Both delayed incremental-poll and snapshot regressions failed before the fix
(`/tmp/pmx-pin-order-red.ahE6cW`), then passed alongside the original hosted-context and restore
cases (`/tmp/pmx-pin-order-green.K53uol`, four headed passes). Self-review also reproduced and
fixed an old-board pending-write leak (`/tmp/pmx-pin-board-red.1q5kkz`): a previous board's
late acknowledgement must not block canonical normalization or release the new board's
pending Clear all. No test timeout or pin assertion was relaxed.

The following full run (`/tmp/pmx-cursor-pin-gates.h4HfvL`) finished 280 passed / 1 failed:
the camera regression completed both tabs' zoom and agent-override assertions, then its
`route.fetch` was closed during fixture teardown. The route now drains with
`unrouteAll({behavior:'wait'})` before the fixture closes; errors are not suppressed.
During that run, self-review found the filtered-brief/raw-membership distinction above.
Its built bundles and pre-correction patch are retained separately from the end-of-run
source. The retired-pin regression failed against that intermediate bundle
(`/tmp/pmx-pin-retired-red.Qm0kPq`), so that run is not counted as final-build verification.

**Final serial gates passed** in `/tmp/pmx-cursor-delivery-final.mwP76f`: build/typecheck,
lint (0 errors, existing 63 warnings/12 infos), 1,445 unit, 307 client, coverage (64.64% lines /
72.25% functions), fresh-workspace headed CLI E2E (`/tmp/pmx-canvas-e2e.5XOntZ`), 12 repeated
headed pin/camera regressions and all **282 headed browser cases**, including 600/1024/1920
reference widths. These execute real HTTP and stdio MCP paths as well as human UI gestures.
The table's final six portal sweeps, idle control and served hash are in
`/tmp/pmx-cursor-live-final.gi4axw`; the served index SHA256 matches the final build
`a5f5a1c1f73d43c3254c79601cc9e303c63d839983e1f569f82f0d45c95b229d`.
The inspected final clip shows continuous movement, without blanking or two-second stalls.
A live-check setup attempt used the wrong supervised port and inconsistent browser launch
flags, leaving blank tabs; it was corrected before these measurements, not counted as a run.

This demonstrates the PMX-side delay and its fix through an orb portal, not the exact Amp
embedded container. Native Copilot/WebKit, Windows UI and registry installation were not
exercised for this batch. The owner's live SQLite content was not used or modified. The
owner subsequently authorized a combined commit/push from the parent orb after validation;
this orb hands back source and evidence only. No release, tag or version change is authorized.

### Combined acceptance follow-up, 2026-10-12

The parent orb integrated that frozen patch with the owner's card/relation star removal.
Authorship remains in hints, including bare lines; pins, read marks and the session lens
are unchanged. Star regressions failed before the removal and passed afterwards. Headed
600/1024/1440/1920 width and nine-theme inspections retained the hints. Card corner resizing
persisted after reload in a disposable database; test 01 means resizing the browser or pane,
not the card. The live acceptance board has a focused agent review card and relation.

The first combined full headed run passed 281 cases and failed attention history. Its trace
shows pin POST at 231783 ms, an incremental pin frame captured at 231792 ms, and canonical
snapshot reads at 231796/231817 ms. Revision fencing skipped the older frame correctly but
canonical reconciliation did not update the semantic attention reducer, so the card stayed
pinned while its Context updated notice/history disappeared. This is a product regression,
not a weakened selector or timeout. Feeding only the accepted canonical pin frame into the
existing attention reducer fixes it without replaying other snapshot frames. The extended
existing attention test holds the incremental frame: it failed before the fix, then passed
five consecutive headed repetitions, including later near-pin history. First-failure evidence
is retained in `/tmp/pmx-combined-acceptance-final`, red proof in `/tmp/pmx-attention-red`,
and focused green in `/tmp/pmx-attention-green`.

Final combined serial gates passed in `/tmp/pmx-combined-acceptance-corrected`: build,
typecheck, lint (0 errors, 63 existing warnings/12 infos), 1,445 unit, 307 client,
coverage (64.67% lines/72.25% functions), fresh headed CLI E2E with real HTTP/stdio MCP,
and all 282 headed browser cases. Agent-skill mirror validation skipped absent trees;
that skip is not a validation claim. The preceding 281-pass/1-fail run remains recorded.
The initial CLI invocation used the wrong headed environment key; its successful result is
not counted as headed proof. The final invocation uses `PMX_E2E_HEADED=1` explicitly.

### Owner rehearsal fixes and shared Home relation presets, 2026-10-13

The medium rehearsal orb found five numbered failures: 01 toolbar crowding with two sessions;
07 inert expanded Markdown wiki links; 11 narrow Graph Updates/filter/search overlap;
14 blank Medium cadence acceptance; and 19 HTML replacement errors displacing healthy paint
and graph data/spec updates leaving stale charts. Its frozen 15-file patch fixes those
contracts. It passed 1,445 unit and 307 client cases, headed CLI and 288 headed browser cases
before the final localized Graph-search CSS correction; nine targeted width/chrome cases
verify that final worker state. Those counts do not certify the parent's combined changes.
Intermittent Plex loading and a Flow Start failure passed unchanged focused repetitions and
the quiet full run, but their causes remain unconfirmed, not diagnosed away.

The owner's clarification moves editable relation templates into Home, shared like Categories.
Explicit application copies a saved template onto a selected board without rewriting edges;
later template edits/deletion do not retroactively change existing boards. The board dropdown
filters All relations plus kinds actually present, not preset names or Custom vocabulary.
The obsolete per-board editor is removed. The same public registry exposes template CRUD
through HTTP, SDK, CLI and MCP; existing scope fences protect workspace writes. The catalog
persists in the workspace database's existing meta store, including deleted starter templates.

The kept public-operation regression failed before the new operations and passed afterwards.
It verifies restart persistence without changing cards/connections. Existing transport/fence
tests now cover the two actions. The browser contract covers Home creation, reload, application,
deletion, two asymmetric boards, unchanged edges and clearing a vanished kind filter.
Its first run reached all feature assertions but failed test cleanup on an invented DELETE
edge URL; the trace proves 404. Cleanup now uses the documented DELETE body. This was a test
error, not a product refusal, and the failed attempt remains in
`/tmp/pmx-home-relations-gates/first-focused-failure`.

Rendered inspection caught Home's new button clipping at 390 px (right edge 394.17).
The same executed boundary check failed before toolbar wrapping and passed afterwards
(right edge 187.61). The browser contract retains that width boundary. Narrow dialog controls
fit horizontally and remain reachable by scrolling; screenshots are inspected in
`.amp/in/artifacts/home-relations/`. The owner portal's old bundle stays unchanged while the
combined tree is built and tested in an isolated local worktree with a separate database.

The main vision, context extension, historical review, design contract, public API references
and acceptance instructions are aligned with this model. Owner results/notes and the live
review fixture are preserved, not reset. Owner acceptance, curation evaluation, full sketch
parity and native-host checks remain separate. No release/tag/publish or version bump.

The first parent combined full headed gate passed 288 cases and failed JSON-viewer recovery
in srcdoc mode. Its trace shows interception removed at 886609.9 ms, a poll started at
886612.1 ms without completion, and an accepted recovery PATCH at 886615.6 ms. This matches
the independently reproduced Chromium/Playwright interception-lifetime stall documented
above. Both HTML/JSON recovery tests now install one route before navigation and toggle
replacement failure without removing that route; exact retry counts, healthy-paint and
recovery assertions remain unchanged. The first failure is retained in
`/tmp/pmx-home-relations-gates/first-full-failure`, not counted as a pass.

Final combined serial gates pass in `/tmp/pmx-home-relations-gates`: build/typecheck,
lint (0 errors, existing 63 warnings/12 infos), **1,446 unit**, **307 client**, coverage
(64.68% lines / 72.31% functions), fresh headed CLI E2E with real HTTP/stdio MCP,
72 focused server/transport/fence cases, five final focused UI cases, and all **289 headed
browser cases**, including 600/1024/1920 reference widths. The final full run includes the
390 px Home wrapping and final Graph-sidebar correction. Main source and the tested isolated
worktree match byte-for-byte; generated bundles/catalogs are copied from that tested build.
The preceding CI run passed four jobs but Windows was cancelled. CI for this delivery and
the owner's requested fresh numbered rehearsal remain separate from these local gates.

### Fresh rehearsal 07: document save before wiki creation, 2026-10-13

The exact `f5032c5` delivery subsequently passed all five jobs in
[CI 38408653667](https://github.com/pskoett/pmx-canvas/actions/runs/38408653667).
Fresh manual rehearsal still reproduced a wiki-creation failure twice: expanded Source Save,
Back to document, click an unresolved link, then Create. Rich-editor blur normalized the
Markdown and PATCHed revision 23; the dialog's captured pre-normalization content then PATCHed
the same revision 23. The first write advanced the revision, so the second correctly refused
binding after creating the board. Waiting in Document did not prevent a later blur save.

The parent regression reproduces that refusal on unchanged product code. The narrow fix
finishes the expanded document's blur save queue before opening a wiki dialog or navigating.
It stops if the board incarnation changes or the save leaves a dirty/refused draft. The
dialog's source capture and server revision guard are unchanged; a real peer write after
the dialog opens remains refused and its content is preserved.

Local follow-up gates pass in `/tmp/pmx-wiki-blur-gates`: build/typecheck/lint (0 errors,
63 existing warnings/12 infos), 1,446 unit, 307 client, all 40 boards/Markdown sanitize and
native Save/ACK/ABA cases, two inline Markdown cases and five repeated wiki cases. The
unchanged-product red trace and inspected before/after media are in
`.amp/in/artifacts/wiki-blur/`. A separate headed real-pointer flow created and opened the
new board; an independent API read confirmed the source's durable board-ID binding. The
clip holds the last captured frame for two seconds so the actual destination is readable.

At this checkpoint the follow-up is local/uncommitted, with tested index SHA256
`3c003e08ebd8782c28db46c2cd5c2e777cae1cc23be0afbd9a7138799aa2c233`.
The owner daemon remains on `f5032c5` while the medium orb completes its full numbered pass.
Source-only retest handoff precedes combined integration, commit/push and live refresh;
no current owner results, notes or live database were changed by this isolated validation.
The medium orb's corrected 390 px evidence establishes the Updates/filter overlap with the
sidebar **open**, not closed. Two pinned boards and one external writer also push the context
chip's right edge to 429.09 px in a 390 px viewport. Required 600/1024 controls pass separately.

The extended existing browser regression reproduces both defects: an ordinary filter click
is intercepted by Updates, and with only the positioning fix the context edge remains
429.09 px. The local follow-up positions Updates from the measured memory-stage top, so
wrapped tabs and counts cannot invalidate a fixed header offset. The existing content-based
compact step now includes external-writer text, preserving avatars, activity access and an
accessible label. No owner daemon refresh or guide-result reset accompanies these tests.
First-failure traces and logs are retained in `/tmp/pmx-responsive-gates`.

Final same-source serial gates pass in `/tmp/pmx-responsive-gates`: build/typecheck/lint
(0 errors, existing 63 warnings/12 infos), **1,446 unit**, **307 client**, coverage
(64.66% lines / 72.31% functions), and all **289 headed browser cases**, including the
600/1024/1920 reference projects. The fresh CLI/HTTP/stdio MCP gate also passes with explicit
`DISPLAY=:88 PMX_E2E_HEADED=1 bash scripts/e2e-cli-coverage.sh`. An earlier invocation omitted
that flag; its log is retained separately and is not the headed proof.

Inspected final media in `.amp/in/artifacts/narrow-chrome/` shows open/closed populated Graph
at 390 px, all nine themes, and 600/1024/1920 layouts. Real-pointer recording exercises
filter open/close, search, context, external activity and Updates. Executed measurements keep
the context chip inside the viewport (right edge 376 px), and the collapsed Updates trigger
below Filters and clear of search. Open overlay panels intentionally cover the canvas;
the narrow graph remains cramped with its sidebar open, and dense Fit labels need local
focus. These checks do not establish touch, native-host or full sketch-parity acceptance.

The medium orb independently built the frozen five-file source/test patch against clean
`f5032c5` in a disposable checkout. Its served index matches the parent tested build:
SHA256 `a42b09b475b9dad7afda0fc68f0cdec49dd43c9bd57d54b381a1efa2525ac2e0`.
Manual retests pass trailing-newline creation with durable source binding, refusal after a
genuine peer edit, and populated Graph interactions at 390/600/760/390. Its read-only live
preservation comparison confirms unchanged layouts for all 11 boards (96 cards, 63 edges),
including guide results/notes, pins, cameras and tours. Categories, folders and shared presets
also match. Read inspection advanced `lastReadAt` on three guide cards, not their content or
evidence validation. No further check depends on the old live bundle. Disposable cleanup and
the qualified numbered report remain separate; no owner acceptance results are inferred.
