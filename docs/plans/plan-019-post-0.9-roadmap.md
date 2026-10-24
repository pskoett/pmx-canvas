# Plan 019: After 0.9.0

**Status (2026-10-24):** 0.9.0–0.9.2 are released. The maintainer authorized review,
testing and release of the patch-only 0.9.3 cleanup after the prerequisite fixes reached
`origin/main` at `bed57fe9a4b79bd54f8b5ee51cefd65fec3dbe1a`. The SDK tour return shape
stays unchanged. MCP hardening and SDK tour result parity move to 0.10 on SDK v1.
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
| 2 | 0.10 | MCP hardening: contracts, annotations, cancellation, resource subscriptions | 6a, 1 | M |
| 3 | 0.11 | One frame host, portal-layer mount, Wave-0 design pass | 5, 9 | M–L |
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

Candidates, not automatic scope: `canvas_help { op }`, `session.start`, per-action schemas.

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

- **One frame host** for `html`, `mcp-app`, `json-render`, `graph`, `webpage`, `mermaid`: lazy
  mount near the viewport, a live-frame budget, one paint deadline, one visible fallback with
  retry, full theme tokens passed in. Reuse the shared AX bridge. Replaces the recovery
  machinery in `ExtAppFrame.tsx`. Mermaid renders inline.
- **Portal-layer ext-app mount** ([plan 009](plan-009-tech-debt-backlog.md), contingency whose
  trigger is met): render ext-app iframes outside the world transform for WebKit black tiles.
- **Wave-0 design pass** ([design gaps](design-gaps-2026-10-08.md) suggested order 4): section
  labels (#2), the 44 px floating-chrome lane and Updates chip (#3), node header fill/title
  (#7), then the token sweep (#4 type floor, #5 radii/elevation, #6 Harbor drift, #9 raw
  `rgba()`), then the per-type pass (#8).

**Done when**
- design.md's Wave 4 check: no viewer draws its own background; a board with 20 portals mounts
  no more frames than one without; fit-all is readable.
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
