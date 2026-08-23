import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AttentionHistory } from './canvas/AttentionHistory';
import { AttentionToast } from './canvas/AttentionToast';
import { registerCanvasArea, canvasArea } from './canvas/canvas-area';
import { CanvasViewport } from './canvas/CanvasViewport';
import { CommandBar } from './canvas/CommandBar';
import { ConnectionBanner } from './canvas/ConnectionBanner';
import { CommandPalette } from './canvas/CommandPalette';
import { ContextMenu, useContextMenu } from './canvas/ContextMenu';
import { ContextPinBar } from './canvas/ContextPinBar';
import { EmptyState } from './canvas/EmptyState';
import { createNodeInView } from './canvas/create-in-view';
import { undoFromKeyboard } from './state/session-store';
import { ActivityFeed, WritersSheet } from './canvas/ExternalWriters';
import { ExpandedNodeOverlay } from './canvas/ExpandedNodeOverlay';
import { Minimap } from './canvas/Minimap';
import { SelectionBar } from './canvas/SelectionBar';
import { SessionPanel } from './canvas/SessionPanel';
import { SessionReceipt } from './canvas/SessionReceipt';
import { ShortcutOverlay } from './canvas/ShortcutOverlay';
import { SnapshotPanel } from './canvas/SnapshotPanel';
import { promptedCreate, ToolRail } from './canvas/ToolRail';
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
  hasInitialServerLayout,
  nodes,
  pendingExpandedNodeCloseId,
  removeNode,
  selectedNodeIds,
  spacePanHeld,
  viewport,
  walkGraph,
  zoomByFactor,
  groupsOfSelection,
} from './state/canvas-store';
import { connectSSE } from './state/sse-bridge';
import { intents } from './state/intent-store';
import { sessionActive } from './state/presence-store';
import {
  createGroupFromClient,
  removeNodeFromClient,
  reportClientViewportSize,
  ungroupFromClient,
} from './state/intent-bridge';
import type { AnnotationTool } from './types';

function logAppError(action: string, error: unknown): void {
  console.error(`[app] ${action} failed`, error);
}

export function App() {
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>(null);
  const snapshotBtnRef = useRef<HTMLButtonElement>(null);
  const { menu, openNodeMenu, openCanvasMenu, closeMenu } = useContextMenu();
  const hasInitialLayout = hasInitialServerLayout.value;
  // rail-chrome-v2: the one selector every agent surface mounts on. Exposed
  // as a data attribute so styling and tests can key on it; the quiet board
  // (no attached session) must stay byte-clean of agent chrome.
  const sessionIsActive = sessionActive.value;

  const handleToggleMinimap = useCallback(() => setMinimapVisible((v) => !v), []);
  const handleToggleSnapshot = useCallback(() => setSnapshotOpen((v) => !v), []);
  const handleCloseSnapshot = useCallback(() => setSnapshotOpen(false), []);
  const handleSetAnnotationTool = useCallback((tool: AnnotationTool) => setAnnotationTool(tool), []);

  const handleMinimapNavigate = useCallback((x: number, y: number) => {
    animateViewport({ x, y, scale: viewport.value.scale }, 200);
  }, []);

  useEffect(() => {
    return connectSSE();
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

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

      // Esc always collapses expanded node first (even from inside inputs)
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

      // Esc closes shortcut overlay
      if (e.key === 'Escape' && shortcutsOpen) {
        e.preventDefault();
        setShortcutsOpen(false);
        return;
      }

      // Ignore other shortcuts when inside inputs or editable content — the
      // single-key rail shortcuts below would otherwise eat characters typed
      // into the inline markdown editor (contenteditable), which INPUT/TEXTAREA
      // checks alone do not cover.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      // Held Space = temporary pan tool (released on keyup below).
      if (e.key === ' ' && !e.repeat && !mod) {
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
      } else if (e.key === 'Escape') {
        if (selectedNodeIds.value.size > 0) {
          clearSelection();
          return;
        }
        activeNodeId.value = null;
        closeMenu();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        cycleActiveNode(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete the selection, else the focused node — what the selection
        // bar's delete and the card's × do, from the keyboard.
        const ids =
          selectedNodeIds.value.size > 0 ? [...selectedNodeIds.value] : activeNodeId.value ? [activeNodeId.value] : [];
        if (ids.length === 0) return;
        e.preventDefault();
        for (const id of ids) {
          removeNode(id);
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

  useEffect(() => {
    if (!hasInitialLayout) return;
    const ready = (window as Window & { __pmxCanvasBootstrapReady?: () => void }).__pmxCanvasBootstrapReady;
    if (typeof ready === 'function') ready();
  }, [hasInitialLayout]);

  const allNodes = Array.from(nodes.value.values());

  const area = canvasArea();

  return (
    <div class="app-shell" data-session-active={sessionIsActive ? 'true' : 'false'}>
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
        <div class="canvas-region" ref={(el) => registerCanvasArea(el)}>
          <CanvasViewport
            onNodeContextMenu={openNodeMenu}
            onCanvasContextMenu={openCanvasMenu}
            annotationMode={annotationTool !== null}
            annotationTool={annotationTool}
          />
          <AttentionToast />
          <AttentionHistory />
          <ActivityFeed />
          <WritersSheet />
          {hasInitialLayout && allNodes.length === 0 && intents.value.size === 0 && (
            <EmptyState onOpenPalette={() => setPaletteOpen(true)} />
          )}
          {selectedNodeIds.value.size > 0 && <SelectionBar />}
          {sessionIsActive ? <CommandBar /> : contextPinnedNodeIds.value.size > 0 && <ContextPinBar />}
          <SessionReceipt onOpenSnapshots={() => setSnapshotOpen(true)} />
          {expandedNodeId.value && <ExpandedNodeOverlay />}
          <SnapshotPanel open={snapshotOpen} onClose={handleCloseSnapshot} anchorRef={snapshotBtnRef} />
          {minimapVisible && (
            <Minimap
              viewport={viewport}
              nodes={nodes}
              edges={edges}
              onNavigate={handleMinimapNavigate}
              containerWidth={area.width}
              containerHeight={area.height}
            />
          )}
        </div>
      </div>
      {sessionIsActive && <SessionPanel />}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onToggleMinimap={handleToggleMinimap} />}
      {shortcutsOpen && <ShortcutOverlay onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
