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
