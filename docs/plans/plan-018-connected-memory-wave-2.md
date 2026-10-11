# Wave 2: connected memory

**Status:** Implemented and stabilized locally on 2026-10-11; not released.

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

## Stabilization checkpoint

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
