# Plan 012 — Many boards, stage 1, and built-in backup

**Status:** Proposed
**Date:** 2026-09-27
**Source:** [Product vision, move 0](../product-vision-2026-09.md#0-many-boards-and-boards-are-the-wiki-m-then-m-then-l), stage 1, plus library backup. The last item of 0.7.
**Done when:** the nine real boards open by name; a backup restores them on a clean machine; a new session never overwrites an existing board.

## Decisions (maintainer, 2026-09-27)

- **Home is not a board.** Home is the view you see when no board is open: your boards, most recent first,
  with create, open, rename and delete. This replaces the vision's "Home is level 0" — boards that no portal
  links to become the top level instead (move 0 levels, 0.8/0.9).
- **Deleting a board needs a confirm** — in-page, never a browser dialog (they are no-ops in agent panes).
- **Backup is built in**, including the schedule, not left to cron.

## What the human sees

1. **Top bar:** the board name replaces the workspace name. Clicking it opens a menu: recent boards, New
   board, Home.
2. **Home view** (no board open): a list of boards with name, last opened, node count; New board; Open;
   Rename; Delete (with an in-page confirm naming the board and its node count). Last backup time and
   "Back up now".
3. **Startup** opens the board that was open last. A fresh workspace starts on Home.
4. **Existing workspaces migrate:** the current board becomes a board named after the workspace folder and
   stays open, so nothing looks different at first. **Every old snapshot becomes a board of its own**, named
   after the snapshot and dated when it was taken (maintainer, 2026-09-27: in 0.6 each session replaced the
   one board, so a snapshot is effectively a past board). This is how the nine real boards come back.

## What agents see

- `canvas://boards` resource and a `canvas_board` tool (22 → 23): `list`, `get`, `create`.
- **Agent writes go to the open board** (revised with the maintainer, 2026-09-27 — no per-session
  binding, no refusal when the human switches). When no board is open (Home), an agent's first write opens
  the most recently opened board; when the workspace has no boards yet, it creates one. An agent that wants
  a *different* board asks the human; only the human opens, switches or deletes a board. An agent may
  create a board; it does not open it.
- Reads without a board read the open board; `board` on a read reads that board straight from SQLite.

## Data

- New `boards` table: `id`, `name`, `created_at`, `last_opened_at`, `viewport`, `tour`, `populated`.
- `board_id` on `nodes`, `edges`, `annotations`, `context_pins`, `ax_state`, `snapshots`. Keys become
  `(board_id, id)`, so these tables are rebuilt once in a transaction (SQLite cannot change a primary key
  in place); existing rows get the migrated board's id. `meta` keeps workspace-global keys only
  (`schema_version`, `theme`, `active_board`, backup settings); per-board keys move to `boards`.
- `saveStateToDB` / `loadStateFromDB` / `deleteMissingRows` / snapshot list and GC are scoped to one board.
  Blob GC scans every board.
- **Stay workspace-global:** theme, blobs, host capabilities, the AX timeline tables and the context read
  log (a `board_id` column is added to `context_reads` so the measurement can be read per board).

## Switching boards (server)

One `switchBoard(id | null)` on `CanvasStateManager`, keeping the singleton (1,000+ call sites untouched):
flush the current board → `applyPersistedState` from the new one (or empty for Home) → reset undo history,
intents, presence, trace and the ext-app call registry → rewatch file nodes, close/rehydrate app sessions,
recompute the code graph → broadcast `board-changed`. The client treats `board-changed` like a reconnect
(fresh connect snapshot, `hasInitialServerLayout = false`). The client's localStorage layout overrides are
keyed by board.

## Restoring the nine boards

The migration does it: every old snapshot becomes a board, so the nine real boards (and every other
session's board) appear on Home the first time the maintainer's workspace opens in 0.7. The real
databases hold a hundred or more snapshots each, many of them the same board a few minutes apart, so Home
will list many boards at first; the maintainer renames the keepers and deletes the rest (slice 3).

## Backup and restore (built in)

- `pmx-canvas backup` writes `VACUUM INTO <folder>/canvas-<timestamp>.db` (safe while the server runs) and
  keeps the newest N. `pmx-canvas backup schedule --every 24h --keep 14 --to <folder>` stores the schedule
  in `meta`; the server runs it (checks every minute, runs when due, survives restarts). `--off` stops it.
- `pmx-canvas restore <file>`: the server flushes, closes the DB, copies the backup in (keeping the current
  file as `canvas.db.before-restore`), reopens and loads the last open board.
- HTTP + SDK + CLI. Not exposed to MCP: backup and restore are the human's maintenance, not agent tools.

## Slices (each tested, committed and pushed on its own)

1. **Storage and switching:** schema + migration, board-scoped save/load/snapshots, `switchBoard`, unit
   tests including migrating a copy of a real 0.6.x database.
2. **Surfaces:** HTTP routes, `canvas_board` + `canvas://boards`, CLI `board` commands, SDK, opening the
   most recent board before an agent write lands on Home (in `executeOperation`), docs.
3. **Browser:** top-bar switcher, Home view, delete confirm, per-board localStorage; e2e at desktop and
   600 px.
4. **Backup, restore and the schedule.**

## Risks

- **The migration touches real data.** It runs in one transaction, writes `canvas.db.pre-boards` first,
  and is tested against a copy of a real 0.6.x database before release.
- **Hidden single-board assumptions** (module state, SSE replay, localStorage) — slice 1 lists every reset
  and a test switches boards with an app node, a file node, a pending intent and an undo stack present.
