/**
 * Ghost Cursor of Intent — the shared pre-commit "intent" envelope.
 *
 * An intent is EPHEMERAL PRESENCE, not canvas state: it describes a move the
 * agent is ABOUT to make (create / move / connect / remove / edit) so the canvas
 * can paint a faint placeholder before the real mutation lands. Like a
 * multiplayer cursor, it auto-expires, is count-capped, and never enters
 * `canvas_query` (`layout` action), `state.json`, or snapshots.
 *
 * This module is import-shared by the server (IntentRegistry + the intent ops)
 * and the client (intent-store + IntentLayer); it must stay free of any
 * server-only or client-only imports.
 */

export type PmxAxIntentKind = 'create' | 'move' | 'connect' | 'remove' | 'edit';

export type PmxAxIntentEdgeType = 'relation' | 'depends-on' | 'flow' | 'references';

export interface PmxAxIntentEdge {
  from: string;
  to: string;
  type: PmxAxIntentEdgeType;
}

export interface PmxAxIntent {
  /** Stable id → update / clear / veto. Auto-generated when a signal omits it. */
  id: string;
  kind: PmxAxIntentKind;
  /** create: where the new node forms. move: the destination. */
  position?: { x: number; y: number };
  /** move / edit / remove: the existing node the intent targets. */
  nodeId?: string;
  /** connect: the edge about to be drawn. */
  edge?: PmxAxIntentEdge;
  /** Node type the ghost renders (icon + type badge). Defaults to a neutral box. */
  nodeType?: string;
  /** Short action label shown on the ghost chip ("Add evidence"). */
  label?: string;
  /** WHY — shown beneath the ghost. The legibility payoff. */
  reason?: string;
  /** 0..1 → ghost opacity/solidity. */
  confidence?: number;
  /** Ordering hint for staged-batch ghosts (the numbered previsualization rail). */
  seq?: number;
  /** Source label of the surface that signalled the intent (mcp/api/sdk/...). */
  source?: string;
  /** Epoch ms when the intent was first signalled. */
  createdAt: number;
  /** Epoch ms when the intent auto-dissolves if not settled/cleared first. */
  expiresAt: number;
}

export const INTENT_KINDS: PmxAxIntentKind[] = ['create', 'move', 'connect', 'remove', 'edit'];

export const INTENT_EDGE_TYPES: PmxAxIntentEdgeType[] = ['relation', 'depends-on', 'flow', 'references'];

/** Default lifetime of an unsettled ghost. */
export const DEFAULT_INTENT_TTL_MS = 8000;

/** Hard ceiling on TTL so a stuck ghost can never linger. */
export const MAX_INTENT_TTL_MS = 60000;

/** Live-intent cap — oldest is evicted past this (presence, not a queue). */
export const MAX_LIVE_INTENTS = 12;
