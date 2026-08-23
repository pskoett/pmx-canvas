import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { AttentionHistory } from './canvas/AttentionHistory';
import { AttentionToast } from './canvas/AttentionToast';
import { registerCanvasArea, canvasArea } from './canvas/canvas-area';
import { CanvasViewport } from './canvas/CanvasViewport';
import { CommandPalette } from './canvas/CommandPalette';
import { ContextMenu, useContextMenu } from './canvas/ContextMenu';
import { ContextPinBar } from './canvas/ContextPinBar';
import { DockedNode } from './canvas/DockedNode';
import { ExpandedNodeOverlay } from './canvas/ExpandedNodeOverlay';
import { Minimap } from './canvas/Minimap';
import { SelectionBar } from './canvas/SelectionBar';
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
  selectedNodeIds,
  spacePanHeld,
  viewport,
  walkGraph,
  zoomByFactor,
} from './state/canvas-store';
import { connectSSE } from './state/sse-bridge';
import { intents } from './state/intent-store';
import { sessionActive } from './state/presence-store';
import { createNodeFromClient, reportClientViewportSize } from './state/intent-bridge';
import { MOD_KEY } from './utils/platform';

function logAppError(action: string, error: unknown): void {
  console.error(`[app] ${action} failed`, error);
}

type AnnotationTool = 'pen' | 'eraser' | 'text' | null;

function WelcomeCard({ onOpenPalette }: { onOpenPalette: () => void }) {
  return (
    <div class="welcome-card">
      <div class="welcome-icon">◇</div>
      <div class="welcome-title">Shape What The Agent Sees</div>
      <div class="welcome-subtitle">
        Lay out notes, files, and evidence. Bring related nodes together. Pin what matters. The board will reflect the
        active focus.
      </div>
      <div class="welcome-hints">
        <button type="button" class="welcome-hint" onClick={onOpenPalette}>
          <kbd>{MOD_KEY}+K</kbd>
          <span>Create a note</span>
        </button>
        <div class="welcome-hint">
          <kbd>Drop files</kbd>
          <span>Add evidence to the board</span>
        </div>
        <div class="welcome-hint">
          <kbd>{'✦'}</kbd>
          <span>Pin important nodes</span>
        </div>
        <div class="welcome-hint">
          <kbd>Move nearby</kbd>
          <span>Shape the focus field</span>
        </div>
      </div>
      <div class="welcome-footer">The canvas is a shared attention surface, not just an editor.</div>
    </div>
  );
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

      if (mod && e.key === '0') {
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
      } else if (activeNodeId.value && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const dir = e.key.replace('Arrow', '').toLowerCase() as 'up' | 'down' | 'left' | 'right';
        walkGraph(dir);
      } else if (!mod && !e.altKey) {
        // Rail shortcuts — the rail buttons advertise these in their titles.
        const key = e.key.toLowerCase();
        if (key === 'v' && !e.shiftKey) {
          canvasTool.value = 'select';
        } else if (key === 'm' && !e.shiftKey) {
          e.preventDefault();
          void createNodeFromClient({ type: 'markdown', title: 'New note', width: 520, height: 360 }).catch((error) =>
            logAppError('create markdown', error),
          );
        } else if (key === 'a' && !e.shiftKey) {
          e.preventDefault();
          setAnnotationTool((tool) => (tool === 'pen' ? null : 'pen'));
        } else if (key === 'g' && !e.shiftKey) {
          e.preventDefault();
          void createNodeFromClient({ type: 'group', title: 'Group' }).catch((error) =>
            logAppError('create group', error),
          );
        } else if (key === 'i' && !e.shiftKey) {
          e.preventDefault();
          promptedCreate('image');
        } else if (key === 'w' && !e.shiftKey) {
          e.preventDefault();
          promptedCreate('webpage');
        } else if (key === 'h' && !e.shiftKey) {
          e.preventDefault();
          void createNodeFromClient({ type: 'html', title: 'HTML surface' }).catch((error) =>
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

  useEffect(() => {
    if (!hasInitialLayout) return;
    const ready = (window as Window & { __pmxCanvasBootstrapReady?: () => void }).__pmxCanvasBootstrapReady;
    if (typeof ready === 'function') ready();
  }, [hasInitialLayout]);

  const allNodes = Array.from(nodes.value.values());
  const dockedLeft = allNodes.filter((n) => n.dockPosition === 'left');
  const dockedRight = allNodes
    .filter((n) => n.dockPosition === 'right')
    .sort((a, b) => {
      const order: Record<string, number> = { context: 0, ledger: 1 };
      return (order[a.type] ?? 2) - (order[b.type] ?? 2);
    });

  const area = canvasArea();

  // rail-chrome-v2: the one selector every agent surface mounts on. Exposed
  // as a data attribute so styling and tests can key on it; the quiet board
  // (no attached session) must stay byte-clean of agent chrome.
  const sessionIsActive = sessionActive.value;

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
        <div class="canvas-region" ref={(el) => registerCanvasArea(el)}>
          <CanvasViewport
            onNodeContextMenu={openNodeMenu}
            onCanvasContextMenu={openCanvasMenu}
            annotationMode={annotationTool !== null}
            annotationTool={annotationTool}
          />
          <div class="hud-left">
            {dockedLeft.map((n) => (
              <DockedNode key={n.id} node={n} />
            ))}
          </div>
          <div class="hud-right">
            {dockedRight.map((n) => (
              <DockedNode key={n.id} node={n} />
            ))}
          </div>
          <AttentionToast />
          <AttentionHistory />
          {hasInitialLayout && allNodes.filter((n) => !n.dockPosition).length === 0 && intents.value.size === 0 && (
            <WelcomeCard onOpenPalette={() => setPaletteOpen(true)} />
          )}
          {selectedNodeIds.value.size > 0 && <SelectionBar />}
          {contextPinnedNodeIds.value.size > 0 && <ContextPinBar />}
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
      {expandedNodeId.value && <ExpandedNodeOverlay />}
      <SnapshotPanel open={snapshotOpen} onClose={handleCloseSnapshot} anchorRef={snapshotBtnRef} />
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onToggleMinimap={handleToggleMinimap} />}
      {shortcutsOpen && <ShortcutOverlay onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
