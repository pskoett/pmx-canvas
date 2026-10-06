import { useState } from 'preact/hooks';
import { contextPinMeta, pinnedReadState, writerName } from '../state/context-status-store';
import { nearPins } from '../state/near-pin-store';
import type { CanvasNodeState } from '../types';
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
  if (pinned) {
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
  // A person's edit ends the agent's byline (decided 2026-10-05).
  if (node.lastEditedBy?.actor === 'human') return null;
  if (node.createdBy?.actor === 'agent') {
    const name = writerName(node.createdBy);
    return {
      tone: 'agent',
      glyph: 'spark',
      word: `by ${name}`,
      label: `Created by ${name}`,
      body: 'The byline stays until you edit the node.',
    };
  }
  if (node.lastEditedBy?.actor === 'agent') {
    const name = writerName(node.lastEditedBy);
    return {
      tone: 'agent',
      glyph: 'pen',
      word: 'edited',
      label: `Edited by ${name}`,
      body: 'The mark stays until you edit the node.',
    };
  }
  return null;
}

/** The header chip saying what agents did with this node (one per node; glyph + word). */
export function NodeContextMark({ node, pinned }: { node: CanvasNodeState; pinned: boolean }) {
  const mark = markFor(node, pinned);
  if (!mark) return null;
  return (
    <BarHint label={mark.label} body={mark.body} align="end" tapToOpen>
      <span class={`node-context-mark is-${mark.tone}`} data-mark={mark.word}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={GLYPHS[mark.glyph]} />
        </svg>
        {mark.word}
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
 * context" on purpose: the agent never gets this node's full content.
 */
export function NearPinMark({ node, pinned }: { node: CanvasNodeState; pinned: boolean }) {
  // The pins' titles join this node's DOM only while the chip is hovered or
  // focused: at rest the node must not contain other nodes' titles.
  const [open, setOpen] = useState(false);
  const near = pinned ? undefined : nearPins.value.get(node.id);
  if (!near || near.length === 0) return null;
  const word = near.length > 1 ? `near ${near.length}` : 'near';
  const where = near.map((pin) => `“${pin.pinTitle}” (${pin.distance} px)`).join(', ');
  return (
    <BarHint
      label={open ? `Near ${where}` : 'Near a pin'}
      body="The agent gets its title and a short summary, not its full content. Pin it to send its content."
      align="end"
      tapToOpen
    >
      <span
        class="node-near-mark"
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
        {word}
      </span>
    </BarHint>
  );
}
