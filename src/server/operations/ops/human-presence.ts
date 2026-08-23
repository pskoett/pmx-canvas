/**
 * human.presence.set / human.presence.get — the workbench's own heartbeat
 * (rail-chrome-v2 phase 8). HTTP only: tabs report themselves; agents read
 * the snapshot through `canvas_ax_state { action: "presence" }`'s sibling
 * GET if they want to know who is on the board. Never counts as agent
 * activity (registry exempt list).
 */
import { z } from 'zod';
import { HUMAN_PRESENCE_SHAPE, humanPresence } from '../../human-presence.js';
import { defineOperation } from '../types.js';

const setSchema = z.looseObject(HUMAN_PRESENCE_SHAPE);

export const humanPresenceSetOperation = defineOperation<z.infer<typeof setSchema>, Record<string, unknown>>({
  name: 'human.presence.set',
  mutates: false,
  input: setSchema,
  inputShape: HUMAN_PRESENCE_SHAPE,
  http: { method: 'POST', path: '/api/canvas/human-presence' },
  handler: (input) => ({ ok: true, human: humanPresence.set(input) }),
});

const getShape = {};
const getSchema = z.looseObject(getShape);

export const humanPresenceGetOperation = defineOperation<z.infer<typeof getSchema>, Record<string, unknown>>({
  name: 'human.presence.get',
  mutates: false,
  input: getSchema,
  inputShape: getShape,
  http: { method: 'GET', path: '/api/canvas/human-presence' },
  handler: () => ({ ok: true, ...humanPresence.snapshot() }),
});

export const humanPresenceOperations = [humanPresenceSetOperation, humanPresenceGetOperation];
