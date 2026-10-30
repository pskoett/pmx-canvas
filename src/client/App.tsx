import { computed } from '@preact/signals';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Presentation } from './canvas/Presentation';
import { presenting } from './state/presentation';
import { AttentionHistory } from './canvas/AttentionHistory';
import { AttentionToast } from './canvas/AttentionToast';
import { registerCanvasArea, canvasArea } from './canvas/canvas-area';
import { CanvasViewport } from './canvas/CanvasViewport';
import { CommandBar } from './canvas/CommandBar';
import { ContextPinBar } from './canvas/ContextChip';
import { ConnectionBanner } from './canvas/ConnectionBanner';
import { CommandPalette } from './canvas/CommandPalette';
import { BoardLinkDialog } from './canvas/BoardLinkDialog';
import { LifecyclePanel } from './canvas/LifecyclePanel';
import { KnowledgeSync, LifecycleFilters } from './canvas/LifecycleChrome';
import { ContextMenu, useContextMenu } from './canvas/ContextMenu';
import { EmptyState } from './canvas/EmptyState';
import { HomeView } from './canvas/HomeView';
import { ExportDialog } from './canvas/ExportDialog';
import { activeBoardId, boardsLoaded, browsingMemory, boardIncarnation } from './state/boards-store';
import { createNodeInView } from './canvas/create-in-view';
import {
  activityLens,
  heldGates,
  pendingGates,
  scopeFence,
  sessionPanelOpened,
  undoFromKeyboard,
} from './state/session-store';
import { ActivityFeed, WritersSheet } from './canvas/ExternalWriters';
import { ExpandedNodeOverlay } from './canvas/ExpandedNodeOverlay';
import { Minimap } from './canvas/Minimap';
import { SelectionBar } from './canvas/SelectionBar';
import { AgentControls, SessionPanel } from './canvas/SessionPanel';
import { SessionReceipt } from './canvas/SessionReceipt';
import { ShortcutOverlay } from './canvas/ShortcutOverlay';
import { SnapshotPanel } from './canvas/SnapshotPanel';
import { promptedCreate, ToolRail } from './canvas/ToolRail';
import { EdgeHint, RelationLegend } from './canvas/EdgeLayer';
import { SelectedEdgeEditor } from './canvas/EdgeEditor';
import { GroupBreadcrumbs } from './canvas/GroupNavigation';
import { TextPrompt } from './canvas/TextPrompt';
import { BoardMoveDialog } from './canvas/BoardMoveDialog';
import { TopBar } from './canvas/TopBar';
import {
  activeNodeId,
  animateViewport,
  canvasTool,
  clearSelection,
  collapseExpandedNode,
  contextPinnedNodeIds,
  cycleActiveNode,
  edges,
  expandedNodeId,
  fitAll,
  focusNode,
  hasInitialServerLayout,
  nodes,
  pendingExpandedNodeCloseId,
  removeNode,
  selectedEdgeId,
  selectedNodeIds,
  spacePanHeld,
  viewport,
  walkGraph,
  zoomByFactor,
  groupsOfSelection,
  groupPath,
  groupViewNodes,
  leaveGroup,
} from './state/canvas-store';
import { connectSSE } from './state/sse-bridge';
import { intents } from './state/intent-store';
import { sessionActive, sessionChromeActive } from './state/presence-store';
import { agentSessionsEnabled, knowledgeLifecycleEnabled } from './state/workspace-settings';
import { isHostedWorkbench } from './state/workbench-transport';
import {
  createGroupFromClient,
  removeEdgeFromClient,
  removeNodeFromClient,
  reportClientViewportSize,
  ungroupFromClient,
} from './state/intent-bridge';
import type { AnnotationTool } from './types';
import { lifecycleFilter, lifecycleTarget } from './state/knowledge-store';
import { relationFilter } from './state/relation-store';
import { isSelectionEscape } from './utils/keyboard';

function logAppError(action: string, error: unknown): void {
  console.error(`[app] ${action} failed`, error);
}

/**
 * App needs only whether the board is empty. Reading the nodes map itself
 * would re-render the whole shell (and re-measure the canvas) on every drag frame.
 */
const boardIsEmpty = computed(() => nodes.value.size === 0);
const validReviewTarget = computed(() => {
  const target = lifecycleTarget.value;
  return (
    !!target &&
    !browsingMemory.value &&
    activeBoardId.value === target.boardId &&
    boardIncarnation === target.incarnation &&
    nodes.value.has(target.nodeId)
  );
});
const reviewIsOpen = computed(() => knowledgeLifecycleEnabled.value && validReviewTarget.value);

export function App() {
  // Off by default in a narrow pane (Pane600.dc.html); the Settings menu turns it on.
  const [minimapVisible, setMinimapVisible] = useState(() => window.innerWidth >= 700);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [boardLinkOpen, setBoardLinkOpen] = useState(false);
  const [boardLinkSource, setBoardLinkSource] = useState<{ sourceNodeId?: string; wikiRef?: string }>({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>(null);
  const snapshotBtnRef = useRef<HTMLButtonElement>(null);
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState(canvasArea);
  const { menu, openNodeMenu, openCanvasMenu, openEdgeMenu, closeMenu } = useContextMenu();
  const hasInitialLayout = hasInitialServerLayout.value;
  const onHome = boardsLoaded.value && (activeBoardId.value === null || browsingMemory.value);
  // rail-chrome-v2: the one selector every agent surface mounts on. Exposed
  // as a data attribute so styling and tests can key on it; the quiet board
  // (no attached session) must stay byte-clean of agent chrome.
  const sessionIsActive = sessionChromeActive.value;
  const sessionsEnabled = agentSessionsEnabled.value;
  const hasAgentControls =
    sessionActive.value || pendingGates.value.length > 0 || heldGates.value.length > 0 || !!scopeFence.value;
  const reviewOpen = reviewIsOpen.value;

  useLayoutEffect(() => {
    if (!sessionsEnabled) {
      activityLens.value = null;
      sessionPanelOpened.value = false;
      if (document.activeElement?.closest('.command-bar, .session-panel, .agent-popover')) {
        snapshotBtnRef.current?.focus({ preventScroll: true });
      }
    }
  }, [sessionsEnabled]);

  const handleToggleMinimap = useCallback(() => setMinimapVisible((v) => !v), []);
  const handleToggleSnapshot = useCallback(() => setSnapshotOpen((v) => !v), []);
  const handleCloseSnapshot = useCallback(() => setSnapshotOpen(false), []);
  const handleSetAnnotationTool = useCallback((tool: AnnotationTool) => setAnnotationTool(tool), []);
  const handleCanvasRegion = useCallback((el: HTMLDivElement | null) => {
    registerCanvasArea(el);
    canvasRegionRef.current = el;
  }, []);

  const handleMinimapNavigate = useCallback((x: number, y: number) => {
    animateViewport({ x, y, scale: viewport.value.scale }, 200);
  }, []);

  useEffect(() => {
    return connectSSE();
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceNodeId?: string; wikiRef?: string }>).detail;
      setBoardLinkSource(detail ?? {});
      setBoardLinkOpen(true);
    };
    window.addEventListener('pmx-open-board-link', open);
    return () => window.removeEventListener('pmx-open-board-link', open);
  }, []);

  // Keep the server's idea of this window's size current (0.4.6 orb feedback
  // #2) so an agent `fit` computes a scale that actually fits the human's
  // canvas region. Connect-time reporting lives in the SSE bridge; this covers
  // resizes. The report itself reads canvasArea(), so it reflects the region.
  useEffect(() => {
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void reportClientViewportSize();
      }, 400);
    };
    window.addEventListener('resize', schedule);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  // Keyboard ownership must match the committed UI before another key can arrive.
  useLayoutEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // AltGr on European Windows layouts reports Ctrl+Alt — never treat it
      // as the shortcut modifier, or AltGr+Z (ż, ź…) fires undo.
      const mod = (e.metaKey || e.ctrlKey) && !e.altKey;

      // The shortcut reference is available on Home too.
      if (shortcutsOpen && (e.key === 'Escape' || e.key === '?' || (e.key === '/' && e.shiftKey))) {
        e.preventDefault();
        setShortcutsOpen(false);
        return;
      }

      // The library owns its keyboard. Never edit the agent's hidden active board.
      if (browsingMemory.value || activeBoardId.value === null) return;
      if (e.defaultPrevented) return;

      // Cmd/Ctrl+K toggles command palette (works from anywhere, including inputs)
      if (mod && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // Esc exits annotation tools before handling overlays or selection.
      if (e.key === 'Escape' && annotationTool) {
        e.preventDefault();
        setAnnotationTool(null);
        return;
      }

      // A companion review closes before expansion or the underlying selection.
      if (e.key === 'Escape' && reviewIsOpen.value) {
        if ((e.target as HTMLElement | null)?.closest('[role="menu"], [role="alertdialog"]')) return;
        e.preventDefault();
        lifecycleTarget.value = null;
        return;
      }

      // Esc collapses expansion after its companion review.
      if (e.key === 'Escape' && expandedNodeId.value && !pendingExpandedNodeCloseId.value) {
        e.preventDefault();
        collapseExpandedNode();
        return;
      }

      // Esc closes command palette
      if (e.key === 'Escape' && paletteOpen) {
        e.preventDefault();
        setPaletteOpen(false);
        return;
      }

      // Ignore other shortcuts when inside inputs or editable content — the
      // single-key rail shortcuts below would otherwise eat characters typed
      // into the inline markdown editor (contenteditable), which INPUT/TEXTAREA
      // checks alone do not cover.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      // Menus own every shortcut; dialogs retain global undo, zoom and help.
      if (target?.closest('[role="menu"]')) return;
      const inDialog = target?.closest('[role="dialog"]');
      // Chrome owns its arrow keys and Tab order, rather than board navigation.
      if (
        (e.key === 'Tab' || e.key.startsWith('Arrow')) &&
        target?.closest('.tool-rail, .top-bar, .group-breadcrumbs, .group-outside-stub')
      ) {
        return;
      }

      // Held Space = temporary pan tool (released on keyup below).
      if (e.key === ' ' && !e.repeat && !mod && !inDialog) {
        e.preventDefault();
        spacePanHeld.value = true;
        return;
      }

      // ? toggles shortcut overlay
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        // One shared undo stack (item 10): Ctrl+Z undoes whichever op is on
        // top, agent or human; Shift redoes.
        e.preventDefault();
        void undoFromKeyboard(e.shiftKey);
      } else if (mod && (e.key === 'y' || e.key === 'Y')) {
        // Ctrl+Y — the Windows redo convention.
        e.preventDefault();
        void undoFromKeyboard(true);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        animateViewport({ x: 0, y: 0, scale: 1 }, 250);
      } else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        // Same centre-anchored zoom as the top-bar +/- buttons these shortcuts
        // are advertised on (the tooltip names this key) — a raw scale change
        // is origin-anchored and drifts the board away under the cursor.
        zoomByFactor(1.25);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        zoomByFactor(1 / 1.25);
      } else if (inDialog) {
        // Dialog controls keep navigation and board-editing keys to themselves.
        return;
      } else if (e.key === 'Escape') {
        if (!isSelectionEscape(e)) return;
        e.preventDefault();
        if (groupPath.value.length && !menu) {
          leaveGroup();
          return;
        }
        if (relationFilter.value?.boardId === activeBoardId.value) relationFilter.value = null;
        lifecycleFilter.value = 'All';
        clearSelection();
        activeNodeId.value = null;
        closeMenu();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleActiveNode(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // A click-selected edge deletes first — keyboard parity with the edge
        // context menu (draw with C, click it, press Delete).
        if (selectedEdgeId.value !== null) {
          const edgeId = selectedEdgeId.value;
          e.preventDefault();
          selectedEdgeId.value = null;
          void removeEdgeFromClient(edgeId).catch((error) => logAppError('delete-edge', error));
          return;
        }
        // Delete the selection, else the focused node — what the selection
        // bar's delete and the card's × do, from the keyboard.
        const ids =
          selectedNodeIds.value.size > 0 ? [...selectedNodeIds.value] : activeNodeId.value ? [activeNodeId.value] : [];
        if (ids.length === 0) return;
        e.preventDefault();
        for (const id of ids) {
          void removeNodeFromClient(id).catch((error) => logAppError('delete', error));
        }
        clearSelection();
        activeNodeId.value = null;
      } else if (activeNodeId.value && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const dir = e.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right';
        walkGraph(dir);
      } else if (!mod && !e.altKey) {
        // Rail shortcuts — the rail buttons advertise these in their titles.
        const key = e.key.toLowerCase();
        if (key === 'v' && !e.shiftKey) {
          canvasTool.value = 'select';
        } else if (key === 'c' && !e.shiftKey && !mod) {
          e.preventDefault();
          canvasTool.value = canvasTool.value === 'connect' ? 'select' : 'connect';
        } else if (key === 'm' && !e.shiftKey) {
          e.preventDefault();
          void createNodeInView({ type: 'markdown', title: 'New note', width: 520, height: 360 }).catch((error) =>
            logAppError('create markdown', error),
          );
        } else if (key === 'a' && !e.shiftKey) {
          e.preventDefault();
          setAnnotationTool((tool) => (tool === 'pen' ? null : 'pen'));
        } else if (key === 'g' && !e.shiftKey) {
          // Groups v2: G groups the selection (≥2 nodes); otherwise a new empty frame.
          e.preventDefault();
          const ids = Array.from(selectedNodeIds.value);
          if (ids.length >= 2) {
            void createGroupFromClient({ title: 'Group', childIds: ids }).catch((error) =>
              logAppError('group selection', error),
            );
            clearSelection();
          } else {
            void createNodeInView({ type: 'group', title: 'Group' }).catch((error) =>
              logAppError('create group', error),
            );
          }
        } else if (key === 'g' && e.shiftKey) {
          // Shift+G dissolves every group the selection touches — the same
          // `group.remove` op an agent runs (children released, frame gone).
          e.preventDefault();
          for (const groupId of groupsOfSelection()) {
            removeNode(groupId);
            void ungroupFromClient(groupId).catch((error) => logAppError('ungroup', error));
          }
          clearSelection();
        } else if (key === 'i' && !e.shiftKey) {
          e.preventDefault();
          promptedCreate('image');
        } else if (key === 'w' && !e.shiftKey) {
          e.preventDefault();
          promptedCreate('webpage');
        } else if (key === 'h' && !e.shiftKey) {
          e.preventDefault();
          void createNodeInView({ type: 'html', title: 'HTML surface' }).catch((error) =>
            logAppError('create html', error),
          );
        } else if (key === 'f' && e.shiftKey) {
          e.preventDefault();
          promptedCreate('file');
        } else if (key === 'f' && !e.shiftKey) {
          e.preventDefault();
          const area = canvasArea();
          fitAll(area.width, area.height);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spacePanHeld.value = false;
    };
    const handleBlur = () => {
      spacePanHeld.value = false;
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [annotationTool, closeMenu, paletteOpen, shortcutsOpen]);

  // The session panel takes 320px from the canvas region: re-report the
  // region size so an agent `fit` keeps fitting the visible canvas.
  useEffect(() => {
    const timer = window.setTimeout(() => void reportClientViewportSize(), 250);
    return () => window.clearTimeout(timer);
  }, [sessionIsActive]);

  useLayoutEffect(() => {
    const region = canvasRegionRef.current;
    if (!region) return;
    const observer = new ResizeObserver(() => {
      setArea(canvasArea());
      void reportClientViewportSize();
      const review = lifecycleTarget.value;
      if (review && reviewIsOpen.value) focusNode(review.nodeId, { recordHistory: false });
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hasInitialLayout) return;
    const ready = (window as Window & { __pmxCanvasBootstrapReady?: () => void }).__pmxCanvasBootstrapReady;
    if (typeof ready === 'function') ready();
  }, [hasInitialLayout]);

  return (
    <div
      class={`app-shell${presenting.value ? ' is-presenting' : ''}`}
      data-session-active={sessionIsActive ? 'true' : 'false'}
    >
      <Presentation />
      <EdgeHint />
      <SelectedEdgeEditor />
      <ToolRail
        minimapVisible={minimapVisible}
        onToggleMinimap={handleToggleMinimap}
        snapshotOpen={snapshotOpen}
        onToggleSnapshot={handleToggleSnapshot}
        snapshotBtnRef={snapshotBtnRef}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen((v) => !v)}
        annotationTool={annotationTool}
        onSetAnnotationTool={handleSetAnnotationTool}
      />
      <div class="app-main">
        <TopBar />
        <ConnectionBanner />
        <div class={`workspace${reviewOpen ? ' is-reviewing' : ''}`}>
          <div class="canvas-region" ref={handleCanvasRegion}>
            {!browsingMemory.value && (
              <CanvasViewport
                onNodeContextMenu={openNodeMenu}
                onCanvasContextMenu={openCanvasMenu}
                onEdgeContextMenu={openEdgeMenu}
                annotationMode={annotationTool !== null}
                annotationTool={annotationTool}
              />
            )}
            <AttentionToast />
            <KnowledgeSync />
            {!onHome && <LifecycleFilters />}
            {!onHome && <RelationLegend />}
            {!onHome && <GroupBreadcrumbs />}
            <AttentionHistory />
            <ActivityFeed />
            <WritersSheet />
            {onHome ? (
              <HomeView />
            ) : (
              hasInitialLayout &&
              boardIsEmpty.value &&
              intents.value.size === 0 && <EmptyState onOpenPalette={() => setPaletteOpen(true)} />
            )}
            {!onHome && selectedNodeIds.value.size > 0 && <SelectionBar />}
            {!onHome && !sessionsEnabled && <ContextPinBar />}
            {!onHome && sessionActive.value && !isHostedWorkbench() && <CommandBar />}
            {!onHome && <SessionReceipt onOpenSnapshots={() => setSnapshotOpen(true)} />}
            <TextPrompt />
            <BoardMoveDialog />
            {!browsingMemory.value && <ExportDialog />}
            {!onHome && expandedNodeId.value && <ExpandedNodeOverlay />}
            <SnapshotPanel
              open={snapshotOpen && !browsingMemory.value}
              onClose={handleCloseSnapshot}
              anchorRef={snapshotBtnRef}
            />
            {minimapVisible && !onHome && (
              <Minimap
                viewport={viewport}
                nodes={groupViewNodes}
                edges={edges}
                onNavigate={handleMinimapNavigate}
                containerWidth={area.width}
                containerHeight={area.height}
              />
            )}
          </div>
          {validReviewTarget.value && <LifecyclePanel />}
        </div>
      </div>
      {sessionIsActive && <SessionPanel />}
      {!sessionIsActive && hasAgentControls && <AgentControls />}
      {!browsingMemory.value && menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {!browsingMemory.value && paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onToggleMinimap={handleToggleMinimap} />
      )}
      {!browsingMemory.value && boardLinkOpen && (
        <BoardLinkDialog {...boardLinkSource} onClose={() => setBoardLinkOpen(false)} />
      )}
      {shortcutsOpen && <ShortcutOverlay onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
