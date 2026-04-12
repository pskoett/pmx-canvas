import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
  autoArrange,
  canvasTheme,
  fitAll,
  focusNode,
  forceDirectedArrange,
  nodes,
  searchHighlightIds,
} from '../state/canvas-store';
import { createNodeFromClient } from '../state/intent-bridge';
import { TYPE_LABELS, type CanvasNodeState } from '../types';
import { invalidateTokenCache } from '../theme/tokens';

import { MOD_KEY } from '../utils/platform';

// ── Types ───────────────────────────────────────────────────
interface PaletteItem {
  id: string;
  kind: 'node' | 'action';
  label: string;
  description?: string;
  badge: string;
  badgeClass?: string;
  nodeType?: CanvasNodeState['type'];
  action: () => void;
}

// ── Fuzzy match ─────────────────────────────────────────────
function fuzzyMatch(query: string, text: string): { match: boolean; score: number; indices: number[] } {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let lastIdx = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti);
      // Consecutive chars bonus
      score += (lastIdx === ti - 1) ? 10 : 1;
      // Start-of-word bonus
      if (ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-' || t[ti - 1] === '_') score += 5;
      lastIdx = ti;
      qi++;
    }
  }

  return { match: qi === q.length, score, indices };
}

function highlightMatch(text: string, indices: number[]) {
  if (indices.length === 0) return text;
  const result: (string | preact.JSX.Element)[] = [];
  let last = 0;
  for (const idx of indices) {
    if (idx > last) result.push(text.slice(last, idx));
    result.push(<mark key={idx}>{text[idx]}</mark>);
    last = idx + 1;
  }
  if (last < text.length) result.push(text.slice(last));
  return result;
}

// ── Type filter aliases ─────────────────────────────────────
const TYPE_ALIASES: Record<string, CanvasNodeState['type']> = {
  md: 'markdown',
  app: 'mcp-app',
  web: 'webpage',
  ui: 'json-render',
  chart: 'graph',
  ctx: 'context',
  log: 'ledger',
};

function parseTypeFilter(query: string): { typeFilter: CanvasNodeState['type'] | null; remaining: string } {
  const lower = query.toLowerCase().trim();

  // type:xxx prefix
  if (lower.startsWith('type:')) {
    const typePart = lower.slice(5).trim();
    const allTypes = Object.keys(TYPE_LABELS) as CanvasNodeState['type'][];
    const matched = allTypes.find((t) => t.startsWith(typePart));
    if (matched) return { typeFilter: matched, remaining: '' };
    const aliased = TYPE_ALIASES[typePart];
    if (aliased) return { typeFilter: aliased, remaining: '' };
  }

  // Exact alias match
  if (TYPE_ALIASES[lower]) return { typeFilter: TYPE_ALIASES[lower], remaining: '' };

  return { typeFilter: null, remaining: query };
}

// ── Component ───────────────────────────────────────────────
export function CommandPalette({
  onClose,
  onToggleMinimap,
}: {
  onClose: () => void;
  onToggleMinimap: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Autofocus
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  // ── Build items ─────────────────────────────────────────
  const buildItems = useCallback((): PaletteItem[] => {
    const items: PaletteItem[] = [];

    // Node items
    for (const node of nodes.value.values()) {
      const title = (node.data.title as string) || TYPE_LABELS[node.type];
      const content = (node.data.content as string) || (node.data.path as string) || '';
      items.push({
        id: `node:${node.id}`,
        kind: 'node',
        label: title,
        description: content.length > 80 ? content.slice(0, 80) + '...' : content || undefined,
        badge: TYPE_LABELS[node.type],
        nodeType: node.type,
        action: () => {
          focusNode(node.id);
          onClose();
        },
      });
    }

    // Action items
    const actions: Array<{ label: string; badge: string; action: () => void }> = [
      { label: 'New note (markdown node)', badge: 'CREATE', action: () => { createNodeFromClient({ type: 'markdown', title: 'New note' }); onClose(); } },
      { label: 'Fit all nodes', badge: 'VIEW', action: () => { fitAll(window.innerWidth, window.innerHeight); onClose(); } },
      { label: 'Auto-arrange (grid)', badge: 'LAYOUT', action: () => { autoArrange(); onClose(); } },
      { label: 'Auto-arrange (graph-aware)', badge: 'LAYOUT', action: () => { forceDirectedArrange(); onClose(); } },
      { label: 'Toggle minimap', badge: 'VIEW', action: () => { onToggleMinimap(); onClose(); } },
      {
        label: 'Toggle theme (dark/light)',
        badge: 'THEME',
        action: () => {
          const next = canvasTheme.value === 'dark' ? 'light' : 'dark';
          canvasTheme.value = next;
          document.documentElement.setAttribute('data-theme', next);
          invalidateTokenCache();
          onClose();
        },
      },
    ];

    for (const a of actions) {
      items.push({
        id: `action:${a.label}`,
        kind: 'action',
        label: a.label,
        badge: a.badge,
        badgeClass: 'command-palette-badge--action',
        action: a.action,
      });
    }

    return items;
  }, [onClose, onToggleMinimap]);

  // ── Filter items ────────────────────────────────────────
  const { typeFilter, remaining } = parseTypeFilter(query);
  const allItems = buildItems();

  let filtered: Array<PaletteItem & { score: number; indices: number[] }>;
  if (!query.trim()) {
    // No query: show all, nodes first
    filtered = allItems.map((item) => ({ ...item, score: 0, indices: [] }));
  } else {
    filtered = [];
    for (const item of allItems) {
      // Type filter
      if (typeFilter) {
        if (item.kind !== 'node' || item.nodeType !== typeFilter) continue;
        if (!remaining) {
          filtered.push({ ...item, score: 0, indices: [] });
          continue;
        }
      }

      const result = fuzzyMatch(remaining || query, item.label);
      if (result.match) {
        filtered.push({ ...item, score: result.score, indices: result.indices });
      }
    }
    // Sort by score descending
    filtered.sort((a, b) => b.score - a.score);
  }

  // ── Sync spatial search highlights to canvas ──────────────
  useEffect(() => {
    if (!query.trim()) {
      searchHighlightIds.value = null;
      return;
    }
    const nodeIds = new Set<string>();
    for (const item of filtered) {
      if (item.kind === 'node') {
        // Extract node ID from "node:xxx" format
        nodeIds.add(item.id.slice(5));
      }
    }
    searchHighlightIds.value = nodeIds.size > 0 ? nodeIds : null;
  }, [query, filtered]);

  // Clear highlights on unmount (palette close)
  useEffect(() => {
    return () => { searchHighlightIds.value = null; };
  }, []);

  // Clamp selected index
  const clampedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  // ── Keyboard nav ────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[clampedIndex]) filtered[clampedIndex].action();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [filtered, clampedIndex, onClose],
  );

  // Scroll selected into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.children[clampedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [clampedIndex]);

  // Reset selection on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  return (
    <div class="command-palette-backdrop" onMouseDown={onClose}>
      <div class="command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          class="command-palette-input"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={handleKeyDown}
          placeholder={`Search nodes and actions... (${MOD_KEY}+K)`}
        />
        <div class="command-palette-hint">
          <span><kbd>{'\u2191'}</kbd><kbd>{'\u2193'}</kbd> navigate</span>
          <span><kbd>{'\u21B5'}</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
          <span><kbd>type:</kbd> filter by type</span>
        </div>
        <div class="command-palette-results" ref={listRef}>
          {filtered.length === 0 && (
            <div class="command-palette-empty">No matching nodes or actions</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              class={`command-palette-item${i === clampedIndex ? ' selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => item.action()}
            >
              <span class={`command-palette-badge${item.badgeClass ? ` ${item.badgeClass}` : ''}`}>
                {item.badge}
              </span>
              <span class="command-palette-label">
                {item.indices.length > 0 ? highlightMatch(item.label, item.indices) : item.label}
              </span>
              {item.description && (
                <span class="command-palette-desc">{item.description}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
