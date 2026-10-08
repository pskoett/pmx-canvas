import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { contextPinMeta, pinnedReadState, writerName } from '../state/context-status-store';
import { centerDistance } from '../../server/spatial-analysis.js';
import { nodes } from '../state/canvas-store';
import { nearPins } from '../state/near-pin-store';
import { TYPE_LABELS, type CanvasNodeState } from '../types';
import { BarHint } from './BarHint';

// Glyphs from docs/design/AgentContext.dc.html (24-unit paths).
export const GLYPHS = {
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  eyeOff:
    'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.8 8.3 2 12 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4.4-1',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  pen: 'M4 20l4.2-1L19 8.2 15.8 5 5 15.8z',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
} as const;

interface Mark {
  tone: 'agent' | 'muted' | 'warn';
  glyph: keyof typeof GLYPHS;
  word: string;
  label: string;
  body: string;
}

function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function markFor(node: CanvasNodeState, pinned: boolean): Mark | null {
  if (!pinned) return null;
  const pin = contextPinMeta.value[node.id];
  const pinnedBy =
    pin?.pinnedBy.actor === 'agent'
      ? ` Pinned by ${writerName(pin.pinnedBy)}${pin.reason ? `: ${pin.reason}` : ''}.`
      : '';
  const state = pinnedReadState(node.id, node.contentRevision ?? 0);
  if (state.kind === 'not-read') {
    return {
      tone: 'muted',
      glyph: 'eyeOff',
      word: 'not read',
      label: 'Not read yet',
      body: `In context, but no agent has loaded it since it was pinned.${pinnedBy}`,
    };
  }
  if (state.kind === 'changed') {
    return {
      tone: 'warn',
      glyph: 'warn',
      word: 'changed since read',
      label: "The agent's copy is out of date",
      body: `Changed after ${state.by} read it at ${clock(state.at)}.${pinnedBy}`,
    };
  }
  return {
    tone: 'agent',
    glyph: 'eye',
    word: 'read',
    label: 'Read by the agent',
    body: `${state.count > 1 ? `Read ${state.count} times · last` : 'Read'} ${clock(state.at)} by ${state.by}.${pinnedBy}`,
  };
}

/**
 * The agent's byline (docs/design/HeaderMarks.dc.html): authorship, not state,
 * so it never takes a chip — a violet sparkle on the type icon, its words in
 * the icon's hint. A person's edit ends it (decided 2026-10-05).
 */
export function bylineFor(node: CanvasNodeState): string | null {
  if (node.lastEditedBy?.actor === 'human') return null;
  if (node.createdBy?.actor === 'agent') return `Written by ${writerName(node.createdBy)}`;
  if (node.lastEditedBy?.actor === 'agent') return `Edited by ${writerName(node.lastEditedBy)}`;
  return null;
}

/** How a header chip shows: its word, only its glyph, or folded into the type icon's hint. */
export type ChipFold = 'word' | 'glyph' | 'hidden';

/**
 * The one state chip a header carries — near a pin (unpinned) or the read
 * state (pinned) — with what it says when folded into the icon's hint. Never
 * other cards' titles: at rest a node must not contain them.
 */
export function headerChip(node: CanvasNodeState, pinned: boolean): { amber: boolean; folded: string } | null {
  const mark = markFor(node, pinned);
  if (mark) return { amber: mark.tone === 'warn', folded: mark.label };
  const near = pinned ? undefined : nearPins.value.get(node.id);
  if (near && near.length > 0)
    return { amber: false, folded: near.length > 1 ? `near ${near.length} pins` : 'near a pin' };
  return null;
}

/** A pinned node's read-state chip: glyph + word, or only the glyph when the title needs the room. */
export function NodeContextMark({
  node,
  pinned,
  fold = 'word',
}: {
  node: CanvasNodeState;
  pinned: boolean;
  fold?: ChipFold;
}) {
  const mark = markFor(node, pinned);
  // Amber always carries its word (HeaderMarks.dc.html).
  const shown = mark?.tone === 'warn' ? 'word' : fold;
  if (!mark || shown === 'hidden') return null;
  return (
    <BarHint label={mark.label} body={mark.body} align="end" fitWithin=".node-content" tapToOpen>
      <span
        class={`node-context-mark is-${mark.tone}${shown === 'glyph' ? ' is-glyph' : ''}`}
        data-mark={mark.word}
        aria-label={shown === 'glyph' ? mark.word : undefined}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={GLYPHS[mark.glyph]} />
        </svg>
        {shown === 'word' && mark.word}
      </span>
    </BarHint>
  );
}

/**
 * The type icon, with the agent's sparkle when an agent wrote the node, and
 * one hint that holds the full title, the byline and any folded chip.
 */
export function NodeTypeIcon({
  node,
  pinned,
  title,
  fold,
  children,
}: {
  node: CanvasNodeState;
  pinned: boolean;
  title: string;
  fold: ChipFold;
  children: ComponentChildren;
}) {
  const byline = bylineFor(node);
  const chip = fold === 'hidden' ? headerChip(node, pinned) : null;
  const body = [byline ? `✦ ${byline}` : '', chip && !chip.amber ? chip.folded : '', TYPE_LABELS[node.type]]
    .filter(Boolean)
    .join(' · ');
  return (
    <BarHint label={title} body={body} align="start" fitWithin=".node-content" tapToOpen>
      <span class="node-type-icon" data-byline={byline ?? undefined}>
        {children}
        {byline && (
          <svg class="node-type-spark" viewBox="0 0 24 24" aria-hidden="true">
            <path d={GLYPHS.spark} />
          </svg>
        )}
      </span>
    </BarHint>
  );
}

/** Pinned by an agent: the violet dot on the pin badge. */
export function isAgentPin(nodeId: string): boolean {
  return contextPinMeta.value[nodeId]?.pinnedBy.actor === 'agent';
}

/**
 * Near a pin (docs/design/NearPin.dc.html): a dotted pin-blue chip on an
 * unpinned node the brief carries as title + short summary. Weaker than "in
 * context" on purpose: the agent sees it only because a pin is nearby.
 */
export function NearPinMark({
  node,
  pinned,
  fold = 'word',
}: {
  node: CanvasNodeState;
  pinned: boolean;
  fold?: ChipFold;
}) {
  // The pins' titles join this node's DOM only while the chip is hovered or
  // focused: at rest the node must not contain other nodes' titles.
  const [open, setOpen] = useState(false);
  const near = pinned ? undefined : nearPins.value.get(node.id);
  if (!near || near.length === 0 || fold === 'hidden') return null;
  const word = near.length > 1 ? `near ${near.length}` : 'near';
  // Distances change every drag frame; read them only while the hint is open.
  const where = open
    ? near
        .map((pin) => {
          const pinNode = nodes.value.get(pin.pinNodeId);
          return pinNode ? `“${pin.pinTitle}” (${Math.round(centerDistance(node, pinNode))} px)` : `“${pin.pinTitle}”`;
        })
        .join(', ')
    : '';
  return (
    <BarHint
      label={open ? `Near ${where}` : 'Near a pin'}
      body="The agent gets its title and a short summary because a pin is nearby. Pin it to put it first."
      align="end"
      fitWithin=".node-content"
      tapToOpen
    >
      <span
        class={`node-near-mark${fold === 'glyph' ? ' is-glyph' : ''}`}
        aria-label={fold === 'glyph' ? word : undefined}
        data-near={near.map((pin) => pin.pinNodeId).join(' ')}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocusIn={() => setOpen(true)}
        onFocusOut={() => setOpen(false)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" class="node-near-ring" />
          <circle cx="12" cy="12" r="2.2" class="node-near-dot" />
        </svg>
        {fold === 'word' && word}
      </span>
    </BarHint>
  );
}
