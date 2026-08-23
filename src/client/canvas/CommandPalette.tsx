import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { canvasArea } from './canvas-area';
import {
  autoArrange,
  canvasTheme,
  fitAll,
  focusNode,
  forceDirectedArrange,
  nodes,
  searchHighlightIds,
} from '../state/canvas-store';
import { createNodeFromClient, saveCanvasTheme } from '../state/intent-bridge';
import { sessionActive } from '../state/presence-store';
import { startSession } from '../state/session-store';
import { TYPE_LABELS, type CanvasNodeState } from '../types';
import { invalidateTokenCache } from '../theme/tokens';
import { clearThemeOverride } from '../state/theme-override';
import { getNodeIcon, IconArrange, IconFitAll, IconMinimap, IconMoon, IconNodeMarkdown, IconSteer } from '../icons';

import { MOD_KEY } from '../utils/platform';
import { useFocusTrap } from './use-focus-trap';

// ── Types ───────────────────────────────────────────────────
interface PaletteItem {
  id: string;
  kind: 'node' | 'action';
  label: string;
  description?: string;
  /** Keyboard shortcut shown as a kbd on action rows. */
  shortcut?: string;
  icon: (p: { size?: number; class?: string }) => preact.JSX.Element;
  iconTone?: 'accent' | 'purple' | 'muted';
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
      score += lastIdx === ti - 1 ? 10 : 1;
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
export function CommandPalette({ onClose, onToggleMinimap }: { onClose: () => void; onToggleMinimap: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, { initial: inputRef });

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
      const childCount = node.type === 'group' && Array.isArray(node.data.children) ? node.data.children.length : 0;
      items.push({
        id: `node:${node.id}`,
        kind: 'node',
        label: title,
        description:
          node.type === 'group'
            ? `group · ${childCount} node${childCount === 1 ? '' : 's'}`
            : content.length > 60
              ? `${TYPE_LABELS[node.type].toLowerCase()} · ${content.slice(0, 60)}…`
              : content
                ? `${TYPE_LABELS[node.type].toLowerCase()} · ${content}`
                : TYPE_LABELS[node.type].toLowerCase(),
        icon: getNodeIcon(node.type),
        nodeType: node.type,
        action: () => {
          focusNode(node.id);
          onClose();
        },
      });
    }

    // Action items
    const actions: Array<{
      label: string;
      shortcut?: string;
      icon: PaletteItem['icon'];
      iconTone?: PaletteItem['iconTone'];
      action: () => void;
    }> = [
      {
        label: 'New markdown note',
        shortcut: 'M',
        icon: IconNodeMarkdown,
        iconTone: 'accent',
        action: () => {
          createNodeFromClient({ type: 'markdown', title: 'New note', width: 520, height: 360 });
          onClose();
        },
      },
      ...(sessionActive.value
        ? []
        : [
            {
              label: 'Start agent session',
              icon: IconSteer,
              iconTone: 'purple' as const,
              action: () => {
                void startSession();
                onClose();
              },
            },
          ]),
      {
        label: 'Fit view',
        shortcut: 'F',
        icon: IconFitAll,
        iconTone: 'muted',
        action: () => {
          fitAll(canvasArea().width, canvasArea().height);
          onClose();
        },
      },
      {
        label: 'Auto-arrange (grid)',
        icon: IconArrange,
        iconTone: 'muted',
        action: () => {
          autoArrange();
          onClose();
        },
      },
      {
        label: 'Auto-arrange (graph-aware)',
        icon: IconArrange,
        iconTone: 'muted',
        action: () => {
          forceDirectedArrange();
          onClose();
        },
      },
      {
        label: 'Toggle minimap',
        icon: IconMinimap,
        iconTone: 'muted',
        action: () => {
          onToggleMinimap();
          onClose();
        },
      },
      {
        label: 'Toggle theme (dark/light)',
        icon: IconMoon,
        iconTone: 'muted',
        action: () => {
          const next = canvasTheme.value === 'dark' ? 'light' : 'dark';
          // An explicit pick ends any ?theme= session override, same as the
          // toolbar picker — otherwise the session stays sticky-overridden.
          clearThemeOverride();
          document.documentElement.setAttribute('data-theme', next);
          invalidateTokenCache();
          canvasTheme.value = next;
          void saveCanvasTheme(next);
          onClose();
        },
      },
    ];

    for (const a of actions) {
      items.push({
        id: `action:${a.label}`,
        kind: 'action',
        label: a.label,
        ...(a.shortcut ? { shortcut: a.shortcut } : {}),
        icon: a.icon,
        ...(a.iconTone ? { iconTone: a.iconTone } : {}),
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
  // Grouped render order (design item 7): Actions first, then Jump to.
  filtered = [...filtered.filter((item) => item.kind === 'action'), ...filtered.filter((item) => item.kind === 'node')];
  const firstNodeIndex = filtered.findIndex((item) => item.kind === 'node');

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
    return () => {
      searchHighlightIds.value = null;
    };
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
      <div
        ref={dialogRef}
        class="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div class="command-palette-search">
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" />
            <line x1="10.5" y1="10.5" x2="14.5" y2="14.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            class="command-palette-input"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes, run actions, jump to…"
            aria-label="Search nodes, run actions, jump to"
          />
          <kbd class="command-palette-esc">esc</kbd>
        </div>
        <div class="command-palette-results" ref={listRef}>
          {filtered.length === 0 && <div class="command-palette-empty">No matching nodes or actions</div>}
          {filtered.map((item, i) => {
            const Icon = item.icon;
            const heading = i === 0 && item.kind === 'action' ? 'Actions' : i === firstNodeIndex ? 'Jump to' : null;
            return (
              <div key={item.id} class="command-palette-row">
                {heading && <div class="command-palette-group">{heading}</div>}
                <button
                  type="button"
                  class={`command-palette-item${i === clampedIndex ? ' selected' : ''}`}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onClick={() => item.action()}
                >
                  <span class={`command-palette-icon tone-${item.iconTone ?? 'kind'}`} aria-hidden="true">
                    <Icon size={14} />
                  </span>
                  <span class="command-palette-label">
                    {item.indices.length > 0 ? highlightMatch(item.label, item.indices) : item.label}
                    {item.description && <span class="command-palette-desc"> — {item.description}</span>}
                  </span>
                  {item.shortcut && <kbd class="command-palette-kbd">{item.shortcut}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
        <div class="command-palette-hint">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span>type: filter</span>
          <span class="command-palette-hint-spacer" />
          <span>{MOD_KEY}K</span>
        </div>
      </div>
    </div>
  );
}
