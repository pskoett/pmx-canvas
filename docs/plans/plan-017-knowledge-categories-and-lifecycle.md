# Plan 017 — Knowledge categories and context lifecycle

**Status:** Wave 3 implementation includes slices 0–5 and the relationship layer.
Local stabilization passed; see plan 018 for evidence and limitations. The owner's manual
E2E acceptance is still required. Not a release; version remains 0.8.2.
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

**Board folders.** Folders are the decided hierarchy (2026-10-06), and they already exist: a
board's `folder` field is a nested folder path on Home (e.g. `Engineering/Canvas`, up to 8
levels; `canvas_board update`, `pmx-canvas board folder`). Slice 0 renamed the old board
`category` field in all four layers without an alias, preserving stored folder paths. Slice 1
adds per-folder properties (the knowledge category and lifecycle overrides), keyed by folder
path, together with their consumers rather than unused schema scaffolding.

## Slices

Each slice is its own commit and leaves the suite green. Design ships with its function.

### 0. Rename board category to folder

As above. Moving a board between folders stays an ordinary write; the brief's same-folder
discovery tier keeps working on the renamed field.

**Implemented 2026-10-11.** The persistence regression covers concurrent legacy-schema opens,
current WAL reads during an unrelated writer transaction, and reopening with paths, content,
pins and Map positions intact. Real headed board cases (18) pass. Live human folder creation,
move and reload preserve the nested path; a real CLI move updates the human's Home tree without
opening a board. Oracle's two startup findings were reproduced, fixed and closed. There is no
lifecycle UI or review behavior in this slice.

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

**Implemented 2026-10-11 (data only).** Workspace category/folder replacements, one effective
resolver with source paths, full nullable card overrides, and append-only attributed review/restore
records are persisted. Explicit child categories reset ancestor lifecycle overrides; unknown stays
unknown. Only applied retain/revise/externalize with nonempty evidence renew validation. Retirement
survives unrelated reviews/content restoration until explicit audited restore. History is qualified
by board+node and remains outside snapshots. Lifecycle-only edits preserve semantic revision and
lastEditedBy; no speculative date is stamped onto legacy content. Workspace writes on Home do not
open boards and do not bypass agent fences. Active-card writes use the existing board, scope and
human-lock boundary. HTTP/SDK/MCP/CLI share the registry contract; MCP extends canvas_board and
canvas_node rather than adding tools. See [public fields](../http-api.md#knowledge-lifecycle-data-plan-017-slice-1).
Validating outcomes require the reviewed content revision; stale reviews fail with 409. The body
is flushed before an audit append, so a failed save cannot leave a durable validation of lost text.
Initial data-slice unit (1431) and client (276) suites, build, typecheck and lint pass (zero lint errors; existing
warnings remain). Oracle findings were reproduced and fixed, including metadata-only edits,
failed load/workspace rebinding and concurrent database opens; the final focused review found
no data-slice blocker. Live human Source drafts and selection survive CLI lifecycle changes;
CLI retain → retire → restore preserves the validation and attributed audit history across restart.
Later workbench reconnect, save-lineage, ownership and scope findings are fixed; the
[combined stabilization gate](plan-018-connected-memory-wave-2.md#combined-stabilization) passes
with 1,437 unit, 302 client and 266 headed browser cases, plus live human/agent checks.
No lifecycle browser appearance changed; the user-facing review controls remain pending.

### 2. The brief (implemented)

- Retired cards leave the brief; restored cards return.
- Each delivered card carries its qualification when it has one: review due (with reason),
  changed since read, lifecycle unknown. Never presents stale context as validated.
- `canvas_query` search still finds retired cards, marked retired.
- Dashboard portals/source-backed cards carry the accessible source's review qualification
  separately from their own lifecycle. A durable container never suppresses a source warning;
  unreadable targets disclose neither content nor lifecycle metadata.

### 3. Menus: folder settings, category editor, card Lifecycle tab (implemented)

Per `Categories`, `CategoryEditor`, `Lifecycle`: choose or inherit a category; edit the one list
and start from a template; the card tab with inherited/override switch, the four clocks as
separate tiles (only "read by agent" violet), outcomes with evidence, history, retire/restore.

### 4. The board and Home (implemented)

Variant A: "⧗ review due" bottom line (outlined amber, glyph + word + reason) only while due;
filter row (All / To review / Retired); Undo toast after retire; Home folder rows with category
(glyph + word, inherited "↳"), "⧗ N due" and per-folder "unknown" counts.

Dashboard source warnings identify the affected source rather than marking every card due.
Extend the portal/source-card drawings to distinguish “source needs review” from the card's own
review reason before building this state; no additional healthy-card badge is required.

### 5. When review is due (implemented)

Rate-based checks plus event triggers already observable: a provenance source changed, a
superseding decision linked, a dependency card changed. Recipe cards (move 13) add the "refresh
this board" handoff; regenerating a card is not validation.

Apply the vision's dashboard/source lifecycle rules: folder defaults stop at links; source
updates trigger review of explicitly dependent conclusions, not unrelated navigational cards.
Opening or refreshing a dashboard never renews evidence validation. Preserve source revision
or observation time on cached values, independently of when they were fetched.

**Dashboard acceptance case:** a durable dashboard links to a fast-changing status source and
an unrelated durable reference, and has a conclusion explicitly derived from the status source.
Make the status source due or change its relevant content: the portal reports the source's
qualification and the dependent conclusion needs review, while the reference and dashboard
structure remain unaffected. Reopen and refresh: last-validated timestamps stay unchanged.
Repeat with a cached/unavailable source (no fresh-check claim), and an unreadable target when
sharing is available (no title or lifecycle leak). Verify the same distinctions in the brief.

## Remaining-wave implementation and stabilization

Relations retain open kind/reason and editable per-board vocabulary across undo, snapshots,
restart and all agent transports. Relation text reaches graph/brief/pinned context. Source
observations and inert recipes retain observation/revision separately from retrieval time.
Dependency cycles propagate review without recursion; navigation never implies a dependency.
Validating dependent cards requires matching checked source revisions, as well as card content.
The dashboard case, unavailable/cached sources, cadence boundary, session use and retired
filtering have regression coverage. Brief lifecycle snapshots are independent of the content
cursor and bounded: incomplete snapshots explicitly require rechecking cached cards.

Category presets, inherited folder settings, lifecycle overrides, four clocks, due reasons,
review evidence/history, reversible retirement and a post-retirement Undo toast are implemented.
See [design decisions and deviations](../design.md) for dialog placement and spatial dimming.
Reloading review metadata clears old evidence/applied state, preventing stale drafts from gaining
new source/content preconditions. Retired cards remain searchable and direct-readable, marked
retired. Restore, refresh, read, pin and content edits never renew evidence validation.

The owner requested adversarial self-review because Oracle was unavailable. Failures remain in
separate `/tmp/pmx-w3-*` attempt directories, including the cached-provenance regression and the
headed stale-evidence reproduction. The original stale-evidence test failed with the old 99%
evidence retained after a 95% content change; the corrected same browser case passes. No release,
tag, publish, deployment or version bump is authorized. The final local gates pass 1,443 unit,
302 client and 268 headed browser tests, coverage and fresh-workspace headed CLI E2E. Real CLI,
stdio MCP and live human gestures passed on disposable boards. The forward-looking debt review
is recorded in plan 009 and beside its owning stages in the vision.

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
