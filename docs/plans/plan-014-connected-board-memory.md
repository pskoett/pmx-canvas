# Plan 014 — Connected board memory

**Status:** The earlier shared-text, attribution/revision, README/link, library
search, create-from, cross-board brief, and agent-assisted import work is committed
and pushed to `main` through
[`8dbdde2`](https://github.com/pskoett/pmx-canvas/commit/8dbdde29635c275e1eda0bba524071048196feec).
Unit, client, full headed browser and live import checks passed (details below).
The maintainer selected this work for **0.7.0** on 2026-09-29, rather than skipping
to the original 0.8 slot. Import retains
originals and stages agent-authored Markdown for human review, rather than
providing bundled document conversion. Future graph/wiki work and the real-agent
curation-effect evaluation remain pending.
**Date:** 2026-09-27; release scope updated 2026-09-29
**Source:** Product vision moves 0, 1, 7, 14 and 15; maintainer requested an oracle review before implementation.

## Scope and order

1. **Shared card text.** Extend `agent-context.ts` rather than introduce a second text model. Explicit type-aware fallbacks carry content instead of raw configuration. Search consumes the same untruncated text before snippet selection; context truncates only at delivery. Test every node type and values beyond the brief budget. This first slice adds no attribution, revision, converter or library-search API.
2. **Attribution and revisions.** Implement plan 010 with server-stamped creator/last-editor identities and content revisions. Cover SDK/direct state writes as well as registry operations; never accept caller-provided authorship. Existing authors are unknown, not retroactively human. Preserve creation provenance through snapshots and distinguish restoration from a new edit. Geometry-only changes must not masquerade as content edits.
3. **Board introductions, links and library search.** Designate one README via a board-owned node reference; add text-only board-link cards and derived backlinks. Extend existing `canvas://boards`, not a duplicate resource. Search inactive boards without opening them and overlay unsaved active state. Results carry board/card IDs; only explicit human navigation opens a result.
4. **New board from this board.** Preview reusable structure/cards, allocate fresh IDs, remap internal references and add a previous-board link. Create the new board transactionally without opening it; do not copy asks, execution state or history. This is a bounded create operation, not a general inactive-board mutation API.
5. **Document ingestion — agent-assisted v1 implemented and verified; included in 0.7.0.** Canvas receives and retains file bytes as board-owned attachments. The human asks the connected agent to read an attachment with its existing file tools and submit source-linked Markdown for review. No bundled converter, Python installation, OCR engine or automatic agent execution. An unavailable or incapable agent leaves a usable attachment with an explicit status, not a failed upload. See the v1 contract and fixture-specific verification below.
6. **Cross-board brief — initial implementation and controlled retrieval check complete.** Local pins, useful local changes and asks, then bounded linked/same-folder board context; folders are a relevance tiebreak, not an instruction to include everything. Every entry carries source IDs and inclusion reason. Durable cursors are opt-in through an explicit consumer; no consumer starts from the beginning. In the fixed noisy-board fixture, a 1,000-code-unit budget fully delivers both pinned decisions versus neither without pins, preserves source IDs, and does not advance over omitted revisions. This is a retrieval regression check, not the vision's real-agent workflow evaluation; that remains pending.

Binary distribution, cheap-tool restructuring, wiki-link syntax, the board map, renderer consolidation, the full journal and concurrent board managers remain separate work.

## Oracle review: decisions before dependent implementation

- **Durable delta:** context-read sequence numbers are not content revisions. Specify per-board monotonic content revisions and deletion retention before the brief. Advance a consumer cursor only for a defined delivered delta; a truncated brief must not mark omitted changes as read. Expired cursors return an explicit reset, not a fabricated complete delta. Restore/undo must also advance revisions. Do not use the pruned diagnostics table as the sole cursor store.
- **Summary freshness:** an agent-written summary must identify the content revision it describes. A changed source without an updated summary falls back to current extracted content with a warning. Layout edits must not invalidate summaries. This needs the revision contract; the initial mechanical text slice does not claim to solve summary freshness.
- **Board ownership:** preserve the single active-board write rule. A converter works on a captured target and stages its result; switching boards cannot retarget completion. If the target is no longer active, preserve the preview and require explicitly reopening that board to commit. Do not introduce the oracle's proposed arbitrary `writeInactiveBoard(transform)` API.
- **Attachments:** keep source bytes outside node payloads and layout/SSE responses. Use board-scoped references to dedicated SQLite attachment storage, with explicit snapshot retention and garbage collection. Content hashes deduplicate bytes; they are not authorization. Backups must include originals.
- **Export privacy:** the vision requires disclosure of both original attachments and extracted text. Before ingestion ships, explicitly classify source-derived cards in the export manifest and provide an inclusion choice for their text, separately from original bytes. Editing a derived card must not silently remove its source classification.
- **Trust:** workbench-token attribution follows plan 010's honest local ceiling. Imported text is labelled source material, not instructions, approval or verified knowledge.

## Agent-assisted import v1 — maintainer decision

For the first implementation, use the connected agent's existing file tools.
The user-facing flow is **Attach file → ask agent to import → review → add to
board**, not guaranteed automatic conversion on drop.

- Canvas owns the original bytes in board-scoped attachment storage; node
  payloads contain references, never the whole binary. Uploads are limited to
  20 MiB. Originals survive restart, snapshot restore, and library backups until
  their board is deleted.
- Reuse existing agent steering/delivery for the explicit import request; do
  not add a converter service, host-specific agent launcher or agent framework.
- Expose an attachment ID and controlled download/read path. A same-machine
  agent can obtain a working copy; reads may include inline base64 only through
  2 MiB. Remote hosts may need to transfer the bytes manually into
  their own environment. Do not assume MCP connectivity implies filesystem
  access or PDF/Office-reading capability. Automatic host transfer is not a
  prerequisite for v1: unavailable access is reported clearly.
- The agent returns draft Markdown sections with available page, slide or
  sheet references, extraction warnings, and an `agentDescription`. Missing references or unreadable
  content must be disclosed rather than invented. Preview and explicit commit
  create ordinary searchable, pinnable cards linked to the original.
- Capture the destination board at upload. If the human switches boards before
  completion, allow draft submission, keep it with its source board, and require reopening it to
  commit. Agent output cannot retarget the import or overwrite human edits.
- Show that processing uses the connected agent's tools and model provider;
  a local attachment does not mean model processing stays local. Requesting
  import explicitly authorizes that processing, subject to host permissions.
- With no capable agent, retain the attachment and allow a later request. No
  claim of PDF/PPTX/XLSX extraction coverage until tested with a named host/tool
  combination. Treat source text as data, never instructions or approval.

Attachment size limits, safe byte serving, draft validation, cancellation,
snapshot retention, and explicit export choices are implemented and tested:
original bytes are never exported in v1, while source-linked edited Markdown is
excluded unless `includeDerivedText=true`, separately from `includeFiles`. Defer local
converter installation, OCR pipelines, automatic retries and rich spreadsheet
editing. This adds no converter dependency to Canvas; it still depends on the
connected host's available tools for extraction.

## Deferred converter candidates

The investigation below is reference material for a later local-conversion
option, not a prerequisite or selected dependency for agent-assisted v1.

**Maintainer preference, 2026-09-27:** avoid adding dependencies. Default to no new required package, Python runtime or converter installation. First establish what the existing Bun/TypeScript stack and existing dependencies can handle reliably. An optional installed converter or host-agent tool is still an operational dependency and must be described as such; it is not a dependency-free implementation. PDF/PPTX/XLSX remain desired formats, but their conversion approach is unresolved under this constraint. Do not silently reduce format coverage or substitute hand-written parsers merely to avoid a package.

The maintainer suggested [MarkItDown](https://github.com/microsoft/markitdown) and [Defuddle](https://github.com/kepano/defuddle). Source review identifies MarkItDown as the file-conversion candidate and Defuddle as an HTML/article extractor, not an Office/PDF converter. Both project licenses are MIT; exact dependency and redistribution licenses still need review before bundling.

MarkItDown requires Python and offers optional PDF/PPTX/XLSX/DOCX readers. PPTX output contains slide markers and notes; XLSX output contains sheet headings and tables. Default PDF conversion loses page boundaries, and empty extraction does not establish an OCR-required result. Spreadsheet output also loses cell ranges and can expose stale cached formula values. These are adapter requirements, not reasons to invent document parsers.

Run a disposable, version-pinned local spike before selecting the runtime: representative PDF (including scanned/mixed pages), PPTX notes and chart warnings, and XLSX cached/missing formulas and multiple sheets. Require structured segments and warnings alongside Markdown. Test cancellation and oversized archives. Keep plugins, URL fetching, cloud conversion and LLM OCR disabled; no document leaves the machine implicitly. A subprocess timeout is not a network sandbox or memory limit—validate those boundaries separately.

If an optional converter is chosen, prefer a narrow cancellable worker over embedding Python or invoking arbitrary shell commands. Record converter/version and source locations in provenance. Reuse the existing HTML-to-Markdown dependencies before considering Defuddle; do not add it merely because it was considered here. Legacy `.ppt`/`.xls` and OCR are explicit follow-ons unless separately validated.

## Verification gates

- Text: exhaustive per-type fixtures with independently expected meaning; no raw config dumps, data URIs or hidden HTML accidentally presented as visible content. Search finds text beyond the context budget.
- Attribution/delta: forgery attempts, unknown callers, system answers, self-answer, restart, restore, undo, deletions, retention expiry and truncated delivery.
- Board features: inactive reads leave the active board unchanged; renames/moves preserve links; missing targets remain navigable errors; copy is atomic with remapped references.
- Import: known document facts survive extraction, restart, search and pinned-context delivery; corrupt/unsupported files, cancellation, partial extraction, board switches and export choices are covered.
- UI: headed Chromium desktop and 600 px, keyboard-accessible picker/preview, readable tables, visible navigation destination. Inspect representative screenshots, not only API state.

Each slice is verified before proceeding. This plan does not authorize publishing, releasing or pushing the new batch.

## Verification recorded for the previous committed batch

- `bun run test`: 1,205 passed, zero failed.
- `bun run test:client`: 173 passed, zero failed.
- `DISPLAY=:99 ... bash scripts/run-playwright.sh --headed`: 149 passed against
  a disposable database, including desktop workflows and every 600px reference type.
- `bun run build`, `bun run typecheck`, `bun run lint`, and `git diff --check`
  pass. Lint retains warnings; this is not a warning-free baseline.
- Bundled skill manifest/content tests pass. `validate:agent-skills` skips the
  absent local-only mirror trees; it does not validate those missing copies.
- Review fixes cover async actor isolation, revision continuity on undo/restore
  and group membership, incomplete brief cursors, opt-in MCP consumers, invalid
  README updates, and copied blob storage. Board creation remains inactive,
  matching the existing `board.create` contract.

These results predate the current import implementation and are not verification
of it. The earlier full browser run exposed four test assumptions (filtered folder
tree, repeated link-summary text, viewport timing before undo, and Mermaid aspect
ratio); focused reruns and the final full run pass after correcting them. A unit
run collided with the browser server on its deliberately unreachable port 4549;
the final unit run above was performed after that server stopped.

## Agent-assisted import verification — 2026-09-28

- Unit suite: 1,218 passing; client suite: 174 passing. Build and typecheck pass;
  lint passes with existing warnings. Import storage checks cover restart,
  snapshots, selective-copy ownership, deletion retention, cancellation, late
  submissions, immutable source references, and export redaction.
- Headed browser checks passed at 1440 px and 600 px: upload, consent, waiting,
  review, commit, reload, search, and the separate imported-text export choice.
  The nine board workflow tests also passed after the Home-screen refinement.
  The final full headed browser suite passed all 154 tests in 11.1 minutes.
- Live Amp extraction used `view_media` for a single-page text PDF and Python's
  standard-library ZIP/XML inspection for simple PPTX/XLSX fixtures downloaded
  from Canvas. The three drafts were submitted through `canvas_import`, reviewed
  and committed in the browser. Q1=12, Q2=47 and budget=23 credits survived into
  readable cards, library search and source-labelled MCP pinned context.
- This validates those simple fixtures and that named agent/tool combination,
  not general Office fidelity, OCR, speaker notes, charts or formula evaluation.
  Originals remain downloadable when a host reports conversion unavailable.
