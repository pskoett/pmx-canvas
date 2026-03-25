import { openWorkbenchFile } from '../state/intent-bridge';
import type { CanvasNodeState } from '../types';

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
  return {
    title,
    summary,
    pathDisplay,
    category,
    sourceKind,
    status,
    required: card.required === true,
  };
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

export function normalizeContextNodeFallback(
  nodeData: Record<string, unknown>,
): ContextNodeFallbackDisplay | null {
  const title = asTrimmedString(nodeData.title);
  const content = asTrimmedString(nodeData.content);
  const rendered = stripHtmlToText(asTrimmedString(nodeData.rendered));
  const summary = content || rendered;
  const path = asTrimmedString(nodeData.path);

  if (!title && !summary && !path) return null;
  return {
    title: title || 'Context',
    summary,
    path,
  };
}

function formatTokens(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function usageBarColor(utilization: number): string {
  if (utilization >= 0.95) return 'var(--c-danger)';
  if (utilization >= 0.85) return 'var(--c-warn)';
  if (utilization >= 0.7) return 'var(--c-warn)';
  return 'var(--c-accent)';
}

export function ContextNode({
  node,
  expanded = false,
}: { node: CanvasNodeState; expanded?: boolean }) {
  const cards = (node.data.cards as ContextCard[]) ?? [];
  const auxTabs = (node.data.auxTabs as Array<{ id: string; url: string; reason?: string }>) ?? [];
  const currentTokens =
    typeof node.data.currentTokens === 'number' ? node.data.currentTokens : null;
  const tokenLimit = typeof node.data.tokenLimit === 'number' ? node.data.tokenLimit : null;
  const utilization = typeof node.data.utilization === 'number' ? node.data.utilization : null;
  const messagesLength =
    typeof node.data.messagesLength === 'number' ? node.data.messagesLength : null;
  const percent =
    utilization !== null ? Math.max(0, Math.min(100, Math.round(utilization * 100))) : null;
  const barColor = usageBarColor(utilization ?? 0);
  const fallback =
    cards.length === 0 && auxTabs.length === 0 ? normalizeContextNodeFallback(node.data) : null;

  const openCard = async (card: ContextCard): Promise<void> => {
    const path = typeof card.path === 'string' ? card.path.trim() : '';
    if (!path) return;
    await openWorkbenchFile(path);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: expanded ? '10px' : '6px',
        fontSize: expanded ? '14px' : '12px',
        maxWidth: expanded ? '760px' : undefined,
        margin: expanded ? '0 auto' : undefined,
        width: expanded ? '100%' : undefined,
        padding: expanded ? '8px 0' : undefined,
      }}
    >
      {tokenLimit !== null && tokenLimit > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--c-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '6px',
            }}
          >
            Token Usage
          </div>
          <div
            style={{
              height: '6px',
              background: 'var(--c-surface-hover)',
              borderRadius: '3px',
              overflow: 'hidden',
              marginBottom: '4px',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.min(100, (utilization ?? 0) * 100)}%`,
                background: barColor,
                borderRadius: '3px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div style={{ fontSize: '11px', color: 'var(--c-muted)' }}>
            {percent}% — {formatTokens(currentTokens)} / {formatTokens(tokenLimit)} tokens
            {messagesLength !== null && <> · {messagesLength} messages</>}
          </div>
        </div>
      )}

      {cards.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--c-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '6px',
            }}
          >
            Context ({cards.length})
          </div>
          {cards.map((card) => {
            const display = normalizeContextCardDisplay(card);
            return (
              <div
                key={card.key ?? display.pathDisplay ?? display.title}
                style={{
                  padding: '6px 8px',
                  background: 'var(--c-surface-subtle)',
                  borderRadius: '6px',
                  marginBottom: '4px',
                  borderLeft: '2px solid var(--c-accent)',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--c-text)', marginBottom: '2px' }}>
                  {display.title}
                </div>
                <div
                  style={{
                    color: 'var(--c-muted)',
                    fontSize: '10px',
                    lineHeight: 1.45,
                    marginBottom: '4px',
                  }}
                >
                  {display.summary}
                </div>
                {display.pathDisplay && (
                  <div style={{ color: 'var(--c-dim)', fontSize: '10px', wordBreak: 'break-all' }}>
                    {display.pathDisplay}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '1px 4px',
                      background: 'var(--c-accent-10)',
                      color: 'var(--c-accent)',
                      borderRadius: '3px',
                      display: 'inline-block',
                    }}
                  >
                    {display.status}
                  </span>
                  {display.category && (
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 4px',
                        background: 'var(--c-surface-hover)',
                        color: 'var(--c-text-soft)',
                        borderRadius: '3px',
                        display: 'inline-block',
                      }}
                    >
                      {display.category}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '1px 4px',
                      background: 'var(--c-surface-hover)',
                      color: 'var(--c-text-soft)',
                      borderRadius: '3px',
                      display: 'inline-block',
                    }}
                  >
                    {display.sourceKind}
                  </span>
                  {display.required && (
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 4px',
                        background: 'var(--c-warn-12)',
                        color: 'var(--c-warn-alt)',
                        borderRadius: '3px',
                        display: 'inline-block',
                      }}
                    >
                      Required
                    </span>
                  )}
                </div>
                {card.path && (
                  <div style={{ marginTop: '6px' }}>
                    <button
                      type="button"
                      onClick={() => void openCard(card)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '10px',
                        background: 'var(--c-accent-12)',
                        border: '1px solid var(--c-accent-25)',
                        borderRadius: '4px',
                        color: 'var(--c-text-soft)',
                        cursor: 'pointer',
                      }}
                    >
                      Open in canvas
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {auxTabs.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--c-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginBottom: '6px',
              marginTop: cards.length > 0 ? '8px' : 0,
            }}
          >
            References ({auxTabs.length})
          </div>
          {auxTabs.map((tab) => (
            <a
              key={tab.id}
              href={tab.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                padding: '4px 8px',
                color: 'var(--c-accent)',
                fontSize: '11px',
                textDecoration: 'none',
                borderRadius: '4px',
                marginBottom: '2px',
                wordBreak: 'break-all',
              }}
            >
              {tab.url}
              {tab.reason && (
                <span style={{ color: 'var(--c-dim)', fontSize: '10px', marginLeft: '6px' }}>
                  ({tab.reason})
                </span>
              )}
            </a>
          ))}
        </div>
      )}

      {fallback && (
        <div
          style={{
            padding: '8px 10px',
            background: 'var(--c-surface-subtle)',
            borderRadius: '6px',
            borderLeft: '2px solid var(--c-accent)',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--c-text)', marginBottom: '4px' }}>
            {fallback.title}
          </div>
          {fallback.summary && (
            <div
              style={{
                color: 'var(--c-text-soft)',
                fontSize: '11px',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {fallback.summary}
            </div>
          )}
          {fallback.path && (
            <div style={{ marginTop: '6px' }}>
              <div
                style={{
                  color: 'var(--c-dim)',
                  fontSize: '10px',
                  wordBreak: 'break-all',
                  marginBottom: '6px',
                }}
              >
                {fallback.path}
              </div>
              <button
                type="button"
                onClick={() => void openWorkbenchFile(fallback.path)}
                style={{
                  padding: '4px 8px',
                  fontSize: '10px',
                  background: 'var(--c-accent-12)',
                  border: '1px solid var(--c-accent-25)',
                  borderRadius: '4px',
                  color: 'var(--c-text-soft)',
                  cursor: 'pointer',
                }}
              >
                Open in canvas
              </button>
            </div>
          )}
        </div>
      )}

      {!fallback && cards.length === 0 && auxTabs.length === 0 && (
        <div style={{ color: 'var(--c-dim)', fontStyle: 'italic' }}>No context loaded</div>
      )}
    </div>
  );
}
