import { openWorkbenchFile } from '../state/intent-bridge';
import { BarHint } from '../canvas/BarHint';
import { TYPE_LABELS, type CanvasNodeState } from '../types';
import { axNodeActionButtonStyle, runNodeAxInteraction } from './ax-node-actions';

interface ContextCard {
  key?: string;
  title?: string;
  label?: string;
  summary?: string;
  path?: string;
  pathDisplay?: string;
  category?: string;
  sourceKind?: string;
  state?: string;
  required?: boolean;
}

export interface ContextCardDisplay {
  title: string;
  summary: string;
  pathDisplay: string;
  category?: string;
  sourceKind: string;
  status: string;
  required: boolean;
}

export interface ContextNodeFallbackDisplay {
  title: string;
  summary: string;
  path: string;
}

export interface PinnedContextDisplay {
  id: string;
  title: string;
  summary: string;
  kind: string;
  path: string;
}

export function normalizeContextCardDisplay(card: ContextCard): ContextCardDisplay {
  const title = card.title || card.label || card.key || 'Context';
  const summary = card.summary?.trim() || 'Available in startup context.';
  const pathDisplay = card.pathDisplay || card.path || '';
  const category =
    card.category === 'profile'
      ? 'Operator'
      : card.category === 'planning' || card.category === 'memory'
        ? 'Product'
        : card.category
          ? card.category.charAt(0).toUpperCase() + card.category.slice(1)
          : undefined;
  const sourceKind = card.sourceKind === 'global' ? 'Global' : 'Workspace';
  const status =
    card.state === 'missing'
      ? 'Missing'
      : card.state === 'stale'
        ? 'Stale'
        : card.state === 'invalid'
          ? 'Invalid'
          : 'Loaded';
  return { title, summary, pathDisplay, category, sourceKind, status, required: card.required === true };
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripHtmlToText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeContextNodeFallback(nodeData: Record<string, unknown>): ContextNodeFallbackDisplay | null {
  const title = asTrimmedString(nodeData.title);
  const summary = asTrimmedString(nodeData.content) || stripHtmlToText(asTrimmedString(nodeData.rendered));
  const path = asTrimmedString(nodeData.path);
  return title || summary || path ? { title: title || 'Context', summary, path } : null;
}

export function normalizePinnedContextDisplay(node: CanvasNodeState): PinnedContextDisplay {
  const title = asTrimmedString(node.data.title) || node.id;
  const summary =
    asTrimmedString(node.data.content) ||
    asTrimmedString(node.data.excerpt) ||
    asTrimmedString(node.data.description) ||
    asTrimmedString(node.data.pageTitle) ||
    '';
  return {
    id: node.id,
    title,
    summary,
    kind: TYPE_LABELS[node.type] ?? node.type,
    path: asTrimmedString(node.data.path) || asTrimmedString(node.data.url),
  };
}

function formatTokens(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function ContextNode({
  node,
  expanded = false,
  pinnedNodes = [],
}: {
  node: CanvasNodeState;
  expanded?: boolean;
  pinnedNodes?: CanvasNodeState[];
}) {
  const cards = (node.data.cards as ContextCard[]) ?? [];
  const auxTabs = (node.data.auxTabs as Array<{ id: string; url: string; reason?: string }>) ?? [];
  const pinned = pinnedNodes.map(normalizePinnedContextDisplay);
  const fallback = !pinned.length && !cards.length && !auxTabs.length ? normalizeContextNodeFallback(node.data) : null;
  const current = typeof node.data.currentTokens === 'number' ? node.data.currentTokens : null;
  const limit = typeof node.data.tokenLimit === 'number' ? node.data.tokenLimit : null;
  const percent =
    typeof node.data.utilization === 'number' ? Math.max(0, Math.min(100, Math.round(node.data.utilization * 100))) : 0;
  const rows = pinned.length
    ? pinned.map((item) => ({
        ...item,
        tags: item.kind,
        state: 'Pinned',
        openPath: item.path.startsWith('/') ? item.path : '',
      }))
    : cards.map((card) => {
        const item = normalizeContextCardDisplay(card);
        return {
          ...item,
          id: card.key ?? item.pathDisplay ?? item.title,
          path: item.pathDisplay,
          openPath: card.path ?? '',
          state: item.status,
          tags: [item.category, item.sourceKind, item.required ? 'Required' : ''].filter(Boolean).join(' · '),
        };
      });
  return (
    <div class={`context-node${expanded ? ' context-node-expanded' : ''}`}>
      <div class="context-node-toolbar">
        {limit !== null && limit > 0 && (
          <span class="context-usage">
            <span
              class="context-usage-track"
              role="meter"
              aria-label="Token usage"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span
                style={{
                  width: `${percent}%`,
                  background: percent >= 95 ? 'var(--c-danger)' : percent >= 70 ? 'var(--c-warn)' : 'var(--c-pin)',
                }}
              />
            </span>
            {percent}% · {formatTokens(current)} / {formatTokens(limit)} tokens
            {typeof node.data.messagesLength === 'number' && <> · {node.data.messagesLength} messages</>}
          </span>
        )}
        <BarHint
          label="Point the agent at this node"
          body="Sets it as the agent's current AX focus."
          align="end"
          fitWithin=".node-content"
        >
          <button
            type="button"
            class="ax-node-action"
            style={axNodeActionButtonStyle}
            onClick={(event) => {
              event.stopPropagation();
              void runNodeAxInteraction(node, 'ax.focus.set', undefined, 'Focus set');
            }}
          >
            Set focus
          </button>
        </BarHint>
      </div>
      {rows.length > 0 && (
        <div class="context-node-label">
          {pinned.length ? 'Pinned context' : 'Context'} ({rows.length})
        </div>
      )}
      {rows.map((row) => (
        <div class="context-row" key={row.id}>
          <div class="context-row-title">
            <strong>{row.title}</strong>
            <span class={['Missing', 'Stale', 'Invalid'].includes(row.state) ? 'context-row-warning' : ''}>
              {row.state === 'Loaded' ? '✓ ' : row.state === 'Pinned' ? '⊙ ' : '⚠ '}
              {row.state}
            </span>
          </div>
          <div class="context-row-meta">{row.tags}</div>
          {row.summary && <div class="context-row-summary">{row.summary}</div>}
          {row.path && <div class="context-row-meta">{row.path}</div>}
          {row.openPath && (
            <button type="button" class="context-row-open" onClick={() => void openWorkbenchFile(row.openPath)}>
              Open in canvas
            </button>
          )}
        </div>
      ))}
      {!pinned.length && auxTabs.length > 0 && (
        <>
          <div class="context-node-label">References ({auxTabs.length})</div>
          {auxTabs.map((tab) => (
            <a class="context-row" key={tab.id} href={tab.url} target="_blank" rel="noopener noreferrer">
              {tab.url}
              {tab.reason && <span class="context-row-meta"> ({tab.reason})</span>}
            </a>
          ))}
        </>
      )}
      {fallback && (
        <div class="context-row">
          <strong>{fallback.title}</strong>
          {fallback.summary && <div class="context-row-summary">{fallback.summary}</div>}
          {fallback.path && (
            <>
              <div class="context-row-meta">{fallback.path}</div>
              <button type="button" class="context-row-open" onClick={() => void openWorkbenchFile(fallback.path)}>
                Open in canvas
              </button>
            </>
          )}
        </div>
      )}
      {!rows.length && !auxTabs.length && !fallback && <div class="context-row-meta">No context loaded</div>}
    </div>
  );
}
