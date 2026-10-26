/**
 * The owner acceptance guide ("Acceptance · since 0.8.2", 01–23) as a versioned manifest.
 *
 * Each row names the owner-facing pass criteria, the automated tests that prove them, the
 * source files whose change invalidates the row, and the criteria only a person (or a native
 * host the orb cannot reach) can judge. `bun run acceptance` reruns only the rows whose files
 * changed since their last pass, so a naming fix no longer restarts the guide from 01.
 *
 * `e2e` entries are substrings of Playwright test titles; `unit` entries are bun test files,
 * optionally narrowed by a test-name substring. A substring that matches no test fails the
 * run, so the manifest cannot silently drift away from the suites it relies on.
 */

export interface UnitRef {
  file: string;
  name?: string;
}

export interface GuideRow {
  id: string;
  title: string;
  pass: string[];
  touches: string[];
  e2e: string[];
  unit?: Array<string | UnitRef>;
  ownerChecks?: string[];
}

/** A change to any of these reruns every row. */
export const CORE_TOUCHES = [
  'package.json',
  'bun.lock',
  'playwright.config.ts',
  'playwright.acceptance.config.ts',
  'tests/e2e/workspace-fixture.ts',
  'src/client/App.tsx',
  'src/client/index.tsx',
  'src/client/state/sse-bridge.ts',
  'src/client/state/canvas-store.ts',
  'src/client/state/intent-bridge.ts',
  'src/client/state/workbench-transport.ts',
  'src/client/theme/**',
  'src/server/canvas-state.ts',
  'src/server/canvas-db.ts',
  'src/server/canvas-serialization.ts',
];

export const GUIDE: GuideRow[] = [
  {
    id: '01',
    title: 'Workbench, hints & narrow layout',
    pass: [
      'Hints are styled and legible; no hidden essential controls, horizontal overflow or title-chip collisions.',
      'The context summary stays visible and narrow chrome folds instead of disappearing.',
      'Blue pins, violet read marks and amber review warnings are visible in every theme.',
    ],
    touches: [
      'src/client/canvas/TopBar.tsx',
      'src/client/canvas/ToolRail.tsx',
      'src/client/canvas/BarHint.tsx',
      'src/client/canvas/CommandBar.tsx',
      'src/client/canvas/ContextChip.tsx',
      'src/client/canvas/canvas-area.ts',
      'src/client/canvas/use-chrome-height.ts',
      'src/shared/themes.ts',
    ],
    e2e: [
      'narrow screens keep the rail chrome fully usable',
      'rail popovers anchor beside their trigger',
      'populated multi-agent bars keep view controls reachable',
      'desktop theme picker lists every registered theme',
      'the Settings menu opens anchored to its button',
      'every main Settings item describes itself',
      'toolbar tooltips dismiss after pointer-triggered actions',
      'every control renders in the bundled Plex faces',
      'section headings and full-width chart viewers follow all nine canvas themes',
      'light theme marks context-pinned nodes in its own pin blue',
    ],
    unit: ['tests/client/tool-rail-tooltip.test.tsx', 'tests/client/top-bar-more.test.tsx'],
    ownerChecks: ['Judge legibility and visual balance by eye inside the authenticated Amp embedded pane.'],
  },
  {
    id: '02',
    title: 'Markdown editing & saved checkboxes',
    pass: [
      'Saved text and checkboxes never roll back, including an immediate expand/close after a toggle.',
      'An unsaved draft stays with its board and card across close/reopen and a board switch.',
      'Returning to Document before a slow preview finishes shows no stale preview.',
    ],
    touches: [
      'src/client/nodes/MarkdownNode.tsx',
      'src/client/nodes/InlineMarkdownEditor.tsx',
      'src/client/nodes/md-format.ts',
      'src/client/canvas/ExpandedNodeOverlay.tsx',
      'src/server/file-content.ts',
    ],
    e2e: [
      'a Source-saved task persists when the card is immediately expanded and closed',
      'task checkboxes tick on the CARD and persist',
      'expanded task ticking preserves a peer update',
      'inline markdown save updates authoritative canvas node content',
      'switch acceptance detaches old same-ID cards',
      'relation refreshes preserve an unsaved Source draft',
    ],
    unit: ['tests/client/markdown-task-toggle.test.tsx'],
  },
  {
    id: '03',
    title: 'Context chip, near cards & board pins',
    pass: [
      'One summary shows context cost, not a budget; Near cards arrive as summaries with a reason.',
      'Removing one pin keeps the others.',
      'A pinned board travels as a map and never becomes the write target.',
    ],
    touches: [
      'src/client/canvas/ContextChip.tsx',
      'src/client/canvas/NearPinLayer.tsx',
      'src/client/canvas/BoardPinButton.tsx',
      'src/client/state/context-chip-store.ts',
      'src/client/state/near-pin-store.ts',
      'src/server/context-brief.ts',
      'src/server/context-cards.ts',
    ],
    e2e: [
      'large cards enter and leave nearby context by their edges',
      'renders server-created nodes and syncs context pins from the UI',
      'whole-library Graph updates card context on board pin and unpin',
    ],
    unit: [
      'tests/unit/context-brief.test.ts',
      'tests/unit/board-pins.test.ts',
      'tests/client/context-chip.test.tsx',
      'tests/client/board-pin-button.test.tsx',
    ],
  },
  {
    id: '04',
    title: 'Read marks & relation authorship',
    pass: [
      'Seeing the map is not a full read; a human edit turns a read into "changed".',
      'Link revisions are separate from body revisions.',
      'A relabel keeps the original creator.',
    ],
    touches: [
      'src/server/context-reads.ts',
      'src/server/attribution.ts',
      'src/server/canvas-provenance.ts',
      'src/client/canvas/NodeContextMark.tsx',
    ],
    e2e: [
      'a pinned node shows whether the agent read it',
      'rich relation kind and reason survive live edits and reload',
    ],
    unit: [
      'tests/unit/context-reads.test.ts',
      'tests/unit/attribution-revisions.test.ts',
      'tests/unit/relation-revisions.test.ts',
      'tests/client/node-context-mark.test.tsx',
    ],
  },
  {
    id: '05',
    title: 'Session receipt, See change & protected Undo',
    pass: [
      'See change shows a stacked Before/After with word marks, one comparison at a time.',
      'Undo is offered only when no human edit is lost; cross-board actions require the owning board.',
      'Repeated Unpin never re-pins.',
    ],
    touches: [
      'src/client/canvas/SessionReceipt.tsx',
      'src/client/canvas/SessionPanel.tsx',
      'src/client/state/session-store.ts',
      'src/server/mutation-history.ts',
      'src/server/edit-summary.ts',
    ],
    e2e: [
      'only changed top-level endings show receipts',
      'top-level sessions ending together share one receipt',
      'See change stacks marked words',
      'receipt Undo protects an unseen human edit',
      'receipt Unpin refuses a board switch hidden by a held poll',
      'a created-only receipt reopens its snapshot board',
    ],
    unit: ['tests/client/session-receipt-context.test.tsx', 'tests/unit/edit-summary.test.ts'],
  },
  {
    id: '06',
    title: 'Folders, Home & selective copies',
    pass: [
      'Moves keep board ID, cards and links.',
      'A selective copy keeps a previous-board link and does not replace the write target.',
    ],
    touches: [
      'src/client/canvas/HomeView.tsx',
      'src/client/canvas/BoardFolderDialog.tsx',
      'src/client/canvas/BoardCopyDialog.tsx',
      'src/client/canvas/BoardSwitcher.tsx',
      'src/client/state/boards-store.ts',
      'src/server/operations/ops/boards*',
    ],
    e2e: [
      'nested folders move boards, retain tree folding',
      'creates a selective board copy, links boards',
      'switch boards from the top bar, go Home, delete with a confirm',
    ],
    unit: ['tests/unit/boards.test.ts', 'tests/unit/boards-api.test.ts', 'tests/client/boards.test.tsx'],
  },
  {
    id: '07',
    title: 'Wiki references, aliases & explicit creation',
    pass: [
      'Aliases keep their targets; boards are created only by explicit action.',
      'Code spans and fenced blocks are never linked; unresolved text never binds later on its own.',
    ],
    touches: [
      'src/server/wiki-links.ts',
      'src/client/nodes/InlineMarkdownEditor.tsx',
      'src/client/nodes/MarkdownNode.tsx',
    ],
    e2e: [
      'reading expanded Markdown preserves exact source while edits save before wiki navigation',
      'a draft render delayed across A → B → A never retargets a saved wiki link',
      'a wiki card jump waits for a delayed target layout',
    ],
    unit: ['tests/unit/wiki-links.test.ts', 'tests/unit/destination-creation.test.ts'],
  },
  {
    id: '08',
    title: 'Durable targets through rename, Undo & restore',
    pass: [
      'Bindings survive rename, delete/Undo and snapshot restore.',
      'Ambiguous titles never pick a random target; a deleted target shows as missing, not retargeted.',
    ],
    touches: [
      'src/server/wiki-links.ts',
      'src/client/canvas/CrossBoardReferences.tsx',
      'src/client/canvas/SnapshotPanel.tsx',
    ],
    e2e: [
      'wiki navigation and human remote-card connections survive renames',
      'missing board cards can retry relinking',
    ],
    unit: ['tests/unit/wiki-links.test.ts', 'tests/unit/snapshot-restore-node.test.ts'],
  },
  {
    id: '09',
    title: 'Cross-board card connections & readable footers',
    pass: [
      'The footer names the board and card and focuses the target.',
      'IDs are board-qualified, with no false local lines; missing-target and changed marks appear.',
    ],
    touches: [
      'src/client/canvas/CrossBoardReferences.tsx',
      'src/client/canvas/EdgeLayer.tsx',
      'src/client/state/relation-store.ts',
    ],
    e2e: [
      'high-degree reference footers leave card content and actions usable',
      'group reference controls navigate',
      'Graph card ego preserves board-qualified duplicate IDs',
    ],
    unit: ['tests/client/edge-link-mark.test.tsx'],
  },
  {
    id: '10',
    title: 'Home Map positions & compact detail reads',
    pass: [
      'Folders are groups, not boards; tile positions persist through reload.',
      'Agent changes appear live without stealing the camera or selection.',
    ],
    touches: [
      'src/client/canvas/HomeMapView.tsx',
      'src/client/canvas/MemoryInspector.tsx',
      'src/client/canvas/memory-layout.ts',
      'src/server/memory-graph.ts',
    ],
    e2e: ['Home Map persists human positions', 'Escape deselects in Home Folders and Map'],
    ownerChecks: ['Report crowded or clipped Map labels at 600 px with the inspector open.'],
  },
  {
    id: '11',
    title: 'Home Graph, focus, filters & camera ownership',
    pass: [
      'A live force graph keeps camera and selection; only deliberate navigation leaves Graph.',
      'No horizontal page scroll at narrow widths.',
    ],
    touches: [
      'src/client/canvas/HomeGraphView.tsx',
      'src/client/canvas/graph-*.ts',
      'src/client/canvas/use-memory-graph.ts',
      'src/server/memory-graph.ts',
    ],
    e2e: [
      'Graph stays live through agent board switches',
      'Graph dragging moves through neighbors',
      'Graph keeps dense connection routes drawn',
      'Graph drills Library, Board and one-hop Card scenes',
      'Graph keeps a dense 12-board, 96-card, 111-link library',
      'Graph caps a 220-card board',
      'narrow library filters remain reachable',
    ],
    unit: [{ file: 'tests/unit/cli-target-flags.test.ts' }],
    ownerChecks: ['Graph labels are crisp inside the authenticated Amp portal pane (reported blurry there before).'],
  },
  {
    id: '12',
    title: 'Relations, reasons, vocabulary & presets',
    pass: [
      'Edge reasons survive reload and do not advance the body revision.',
      'Each legend preset persists through reload; custom kinds show "Custom vocabulary".',
      'Pin, agent and warning colours are never relation inks.',
    ],
    touches: [
      'src/client/canvas/RelationsPanel.tsx',
      'src/client/canvas/RelationPresetsDialog.tsx',
      'src/client/canvas/EdgeLayer.tsx',
      'src/server/diagram-presets.ts',
    ],
    e2e: [
      'rich relation kind and reason survive live edits and reload',
      'Home manages shared relation presets',
      'all relation kinds stay reachable without horizontal scrolling',
    ],
    unit: [
      'tests/unit/relation-revisions.test.ts',
      'tests/unit/theme-meaning-tokens.test.ts',
      'tests/client/edge-creation.test.ts',
    ],
  },
  {
    id: '13',
    title: 'Categories, folder inheritance & editable presets',
    pass: [
      'Folder summary shows Review needed and No review policy counts.',
      'Assigned categories refuse deletion; card text, revision and author stay unchanged.',
    ],
    touches: [
      'src/client/canvas/KnowledgeDialog.tsx',
      'src/client/canvas/LifecycleFields.tsx',
      'src/server/knowledge-lifecycle.ts',
      'src/client/state/knowledge-store.ts',
    ],
    e2e: ['category glyph choices preserve custom glyphs and policy', 'human adopts and edits category defaults'],
    unit: [{ file: 'tests/client/boards.test.tsx', name: 'category' }],
  },
  {
    id: '14',
    title: 'Four clocks, unknown & review schedules',
    pass: [
      'Read, Content changed, Last validated and Relevance stay separate; reading is not validation.',
      'Medium needs a cadence; Unknown is not an expiry.',
    ],
    touches: [
      'src/server/knowledge-lifecycle.ts',
      'src/server/lifecycle-status.ts',
      'src/client/canvas/LifecyclePanel.tsx',
      'src/client/canvas/LifecycleChrome.tsx',
    ],
    e2e: ['human lifecycle review preserves evidence clocks'],
    unit: [
      { file: 'tests/unit/mcp-composites.test.ts', name: 'knowledge lifecycle' },
      'tests/client/group-lifecycle.test.tsx',
    ],
    ownerChecks: ['A genuinely elapsed review period (a screenshot cannot prove elapsed time).'],
  },
  {
    id: '15',
    title: 'Source changes: dependent vs unrelated reference',
    pass: [
      'Only the dependent card needs review, with a named reason; a cites-only reference does not.',
      'Refresh does not validate.',
    ],
    touches: ['src/server/knowledge-lifecycle.ts', 'src/server/lifecycle-status.ts', 'src/server/attribution.ts'],
    e2e: ['human lifecycle review preserves evidence clocks'],
    unit: ['tests/unit/relation-revisions.test.ts', 'tests/client/edge-link-mark.test.tsx'],
  },
  {
    id: '16',
    title: 'Evidence review & stale-draft refusal',
    pass: [
      'A stale submit refuses with 409 and writes no record; Not now writes nothing.',
      'History records outcome, evidence, author and version.',
    ],
    touches: [
      'src/client/canvas/HomeReviewView.tsx',
      'src/client/canvas/LifecyclePanel.tsx',
      'src/server/knowledge-lifecycle.ts',
    ],
    e2e: [
      'human lifecycle review preserves evidence clocks, refuses stale drafts',
      'a delayed review does not dismiss a reopened review',
      'Home Review scopes individual cards',
    ],
    unit: [{ file: 'tests/client/boards.test.tsx', name: 'refuses stale' }],
  },
  {
    id: '17',
    title: 'Retirement, filters & restore is not validation',
    pass: [
      'A retired card leaves the brief, pins and Near but stays searchable as retired.',
      'Filters dim instead of hiding; restore never renews validation.',
    ],
    touches: [
      'src/server/knowledge-lifecycle.ts',
      'src/server/context-brief.ts',
      'src/client/canvas/LifecyclePanel.tsx',
    ],
    e2e: ['retires and restores', 'pin reconciliation preserves retired membership'],
    unit: [{ file: 'tests/unit/context-brief.test.ts', name: 'retire' }],
  },
  {
    id: '18',
    title: 'Recipe handoff: explicit, inert & auditable',
    pass: [
      'Asking the agent to refresh is a handoff only: no automatic tool run or idle wake.',
      'Retrieval is not validation.',
    ],
    touches: ['src/server/knowledge-lifecycle.ts', 'src/client/canvas/LifecyclePanel.tsx', 'src/mcp/**'],
    e2e: ['addressed steering'],
    unit: ['tests/unit/canvas-provenance.test.ts'],
    ownerChecks: [
      'No automated test clicks "Ask agent to refresh this board" yet: check it sends steering and runs no tool.',
      'A real native host transport receives the handoff and does not wake on its own.',
    ],
  },
  {
    id: '19',
    title: 'Viewer refresh, offscreen updates & JSON drafts',
    pass: [
      'No blank flashes or false timeouts on update, on or offscreen.',
      'A failed replacement retries once and keeps the last view; runtime drafts are not the server spec.',
    ],
    touches: [
      'src/client/nodes/Viewer*.tsx',
      'src/client/nodes/viewer-runtime-state.ts',
      'src/client/nodes/use-surface-frame.ts',
      'src/json-render/**',
      'src/server/html-surface.ts',
    ],
    e2e: [
      'workboard refresh paints no blank or white frame',
      'a late initial JSON load cannot overwrite',
      'graph data and spec patches refresh the painted viewer',
      'failed HTML refresh keeps painted content',
      'healthy offscreen viewers keep their replacement',
      'failed viewer refresh keeps painted content',
      'focus mode preserves JSON drafts',
      'retains painted content through repeated updates',
    ],
    unit: ['tests/client/viewer-refresh.test.tsx', 'tests/client/viewer-runtime-state.test.ts'],
  },
  {
    id: '20',
    title: 'Conflicting saves, ownership & human locks',
    pass: [
      'An old save refuses and keeps the draft; there is no self-conflict, wrong-board text or author downgrade.',
      'A held card refuses agent edits; a refusal changes neither disk nor card.',
    ],
    touches: [
      'src/client/nodes/MarkdownNode.tsx',
      'src/server/file-watcher.ts',
      'src/server/file-content.ts',
      'src/server/operations/ops/nodes.ts',
    ],
    e2e: [
      'a suspended native Save refuses subsequent canonical content',
      'a superseded native save cannot overwrite newer content',
      'close saves a trailing native draft',
      'a held B resync refuses A state',
      'real source editor keeps a refused draft',
    ],
    unit: ['tests/client/refused-write-toast.test.ts'],
  },
  {
    id: '21',
    title: 'Tour, camera, drag & realtime recording',
    pass: [
      'Tours frame readably with no blank jump; camera moves add no Undo; reduced motion jumps.',
      'Drags and right-drag pans create no accidental cards; the recording shows concurrent edits and finalizes.',
    ],
    touches: [
      'src/client/canvas/Presentation.tsx',
      'src/client/state/presentation.ts',
      'src/server/tour-control.ts',
      'src/cli/commands/record*',
      'src/client/canvas/use-pan-zoom.ts',
      'src/client/canvas/use-node-drag.ts',
    ],
    e2e: [
      'tour framing, keyboard exit, painted frames and CLI recording',
      'an agent drives the tour and eases the camera without undo entries',
      'realtime recording sees concurrent edits and finalizes',
      'presentation right-drag interrupts the tour',
      'right-drag pans over blank canvas and node content',
      'a paused title drag survives delayed stacking echoes',
    ],
    unit: ['tests/unit/tour.test.ts', 'tests/client/presentation.test.ts'],
  },
  {
    id: '22',
    title: 'Scope fences, transport parity & bounded context',
    pass: [
      'CLI and stdio MCP give the same reads; fenced writes refuse.',
      'Clipped relations are not marked seen; incomplete snapshots require a recheck.',
    ],
    touches: [
      'src/server/scope-fence.ts',
      'src/server/operations/**',
      'src/mcp/**',
      'src/cli/**',
      'src/server/context-brief.ts',
    ],
    e2e: ['scope fence'],
    unit: [
      'tests/unit/scope-fence.test.ts',
      'tests/unit/scope-fence-api.test.ts',
      'tests/unit/operation-parity.test.ts',
      'tests/unit/context-brief-cursor.test.ts',
    ],
  },
  {
    id: '23',
    title: 'Restart/restore safety & final persistence',
    pass: [
      'Persistence stays healthy through a daemon restart; refused work stays retryable.',
      'Old acknowledgements never repaint, mark saved or authorize writes; restore and restart never validate.',
    ],
    touches: [
      'src/server/backup.ts',
      'src/server/board-export.ts',
      'src/cli/daemon.ts',
      'src/client/canvas/SnapshotPanel.tsx',
      'src/client/canvas/ExportDialog.tsx',
    ],
    e2e: [
      'human Source save retains its draft and authorship after daemon restart',
      'restores snapshots from the toolbar only after confirmation',
      'late board responses cannot repaint',
      'export a board from the top bar and open the file with no server',
    ],
    unit: ['tests/unit/backup.test.ts', 'tests/unit/snapshot-restore-node.test.ts', 'tests/unit/cli-daemon.test.ts'],
    ownerChecks: ['Native host reconnect after a real daemon restart.'],
  },
];
