# Plan 017 — Knowledge categories and context lifecycle

**Status:** Planned, not started. Scheduled after wave 1 (plan 016); not a wave 1 prerequisite.
**Date:** 2026-10-07
**Source:** vision [move 13](../product-vision-2026-09.md#13-context-lifecycle-and-recipe-cards-m-then-later-classification)
(decided model) and Part 3 (user-defined knowledge scopes); [design.md](../design.md) wave 3.
Drawings: [`Categories`](../design/Categories.dc.html), [`CategoryEditor`](../design/CategoryEditor.dc.html),
[`Lifecycle`](../design/Lifecycle.dc.html), [`Lifecycle600`](../design/Lifecycle600.dc.html),
[`Restore`](../design/Restore.dc.html), [`LifecycleVariants`](../design/LifecycleVariants.dc.html) (variant A).

## Done when

From the board alone a person can see which cards need review and why, and the agent's brief
carries the same qualification. Filing a board in a folder gives it a category and lifecycle with
no tagging. Nothing here needs a model, accounts or an external service.

## Decided (2026-10-07)

- Category is a property of a folder and inherits down the tree; a subfolder may set its own.
- One category list per workspace, editable; starter templates (org · team · personal, solo
  research, product team, empty) are presets, never hard-coded words.
- A card may override its lifecycle, never its category.
- Categories carry no colour: glyph and word.
- The board shows only "⧗ review due" on the card, while due (variant A). Everything else lives in
  the card's Lifecycle tab, folder settings and Home; "unknown" is per folder on Home.
- Retire is reversible: out of the brief only; dimmed and searchable; restore is recorded and is
  not a validation.
- Audience is a separate, later property (share ladder step 5) and is not built here.

## Prerequisite

**Board folders.** Folders are the decided hierarchy (2026-10-06) but have no data model yet.
Slice 0 adds them unless an earlier plan already has: a `folders` table (id, parent, name, order),
`boards.folder_id`, Home grouping per `Home.dc.html` (Folders), and `canvas_board` folder actions
across PmxCanvas, HTTP, MCP and CLI.

## Slices

Each slice is its own commit and leaves the suite green. Design ships with its function.

### 0. Board folders (if not already built)

As above. Moving a board between folders is an ordinary, undoable write.

### 1. Data: categories, inheritance, lifecycle, review records (no UI)

- `categories` (workspace list): id, name, glyph, decay type (reality / decision / dependency /
  relevance), rate (fast / medium / slow / durable), triggers, revalidation method.
- `folders.category_id` (nullable = inherit); one resolver returns a board's effective category
  and lifecycle with its source ("set here" / "inherited from <folder>" / unknown).
- Card lifecycle override in node data; never a category.
- `review_records`: node, outcome (retain / revise / externalize / retire / unresolved), evidence,
  who, when; plus restore records. Retired = latest retire not followed by a restore.
- Four-layer parity: read and write categories, set a folder's category, override a card's
  lifecycle, record an outcome, retire, restore.

### 2. The brief

- Retired cards leave the brief; restored cards return.
- Each delivered card carries its qualification when it has one: review due (with reason),
  changed since read, lifecycle unknown. Never presents stale context as validated.
- `canvas_query` search still finds retired cards, marked retired.

### 3. Menus: folder settings, category editor, card Lifecycle tab

Per `Categories`, `CategoryEditor`, `Lifecycle`: choose or inherit a category; edit the one list
and start from a template; the card tab with inherited/override switch, the four clocks as
separate tiles (only "read by agent" violet), outcomes with evidence, history, retire/restore.

### 4. The board and Home

Variant A: "⧗ review due" bottom line (outlined amber, glyph + word + reason) only while due;
filter row (All / To review / Retired); Undo toast after retire; Home folder rows with category
(glyph + word, inherited "↳"), "⧗ N due" and per-folder "unknown" counts.

### 5. When review is due

Rate-based checks plus event triggers already observable: a provenance source changed, a
superseding decision linked, a dependency card changed. Recipe cards (move 13) add the "refresh
this board" handoff; regenerating a card is not validation.

## Out of this plan

- Audience, membership and publication (share ladder step 5).
- Claim-level lifecycle inside a card.
- Classifier assistance (Jev-style); optional later, never a dependency.

## Defaults (change if the maintainer disagrees)

- **The card is the lifecycle unit.** Claims inside a card are not tracked separately until a real
  board shows a card that needs it.
- **"Fast" means review at use, not permanently due.** A fast card is flagged when it is delivered
  and its last validation is older than the current session, so it does not sit amber forever.
- **Unknown is never an expiry.** Unclassified cards are counted per folder and never marked due.
