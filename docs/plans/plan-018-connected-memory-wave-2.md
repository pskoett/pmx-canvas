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
