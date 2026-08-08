import { describe, expect, test } from 'bun:test';
import { normalizeAndValidateJsonRenderSpec } from '../../src/json-render/server.ts';
import type { PmxAxWorkItem } from '../../src/server/ax-state.ts';
import { buildWorkboardSpec } from '../../src/server/workboard.ts';

function workItem(overrides: Partial<PmxAxWorkItem> = {}): PmxAxWorkItem {
  return {
    id: 'wi-1',
    title: 'Implement auth',
    status: 'todo',
    detail: null,
    nodeIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: null,
    agentId: null,
    ...overrides,
  };
}

function elementRecord(spec: { elements: Record<string, unknown> }, id: string): Record<string, unknown> {
  const element = spec.elements[id];
  expect(element).toBeDefined();
  return element as Record<string, unknown>;
}

describe('buildWorkboardSpec', () => {
  test('empty work list produces a valid spec with a single muted text block', () => {
    const spec = buildWorkboardSpec([]);
    expect(() => normalizeAndValidateJsonRenderSpec(spec)).not.toThrow();
    const root = elementRecord(spec, spec.root);
    expect(root.type).toBe('Text');
    expect(root.props).toEqual({ text: 'No work items', variant: 'muted' });
    expect(Object.keys(spec.elements)).toHaveLength(1);
  });

  test('single-status input produces a valid spec with one column and omits other statuses', () => {
    const spec = buildWorkboardSpec([
      workItem({ id: 'wi-a', title: 'First task' }),
      workItem({ id: 'wi-b', title: 'Second task' }),
    ]);
    expect(() => normalizeAndValidateJsonRenderSpec(spec)).not.toThrow();
    const board = elementRecord(spec, spec.root);
    expect(board.type).toBe('Stack');
    expect(board.children).toEqual(['col-todo']);
    expect(spec.elements['col-in-progress']).toBeUndefined();
    expect(spec.elements['col-done']).toBeUndefined();
    const header = elementRecord(spec, 'col-todo-header');
    expect((header.props as Record<string, unknown>).text).toBe('To Do (2)');
    expect((elementRecord(spec, 'item-wi-a').props as Record<string, unknown>).title).toBe('First task');
    expect((elementRecord(spec, 'item-wi-b').props as Record<string, unknown>).title).toBe('Second task');
  });

  test('multi-status input renders columns in status order and only for populated statuses', () => {
    const spec = buildWorkboardSpec([
      workItem({ id: 'wi-done', title: 'Shipped', status: 'done' }),
      workItem({ id: 'wi-todo', title: 'Queued', status: 'todo' }),
      workItem({ id: 'wi-active', title: 'Running', status: 'in-progress' }),
    ]);
    expect(() => normalizeAndValidateJsonRenderSpec(spec)).not.toThrow();
    const board = elementRecord(spec, spec.root);
    expect(board.children).toEqual(['col-todo', 'col-in-progress', 'col-done']);
    expect(spec.elements['col-blocked']).toBeUndefined();
    expect(spec.elements['col-cancelled']).toBeUndefined();
  });

  test('agentId chip and detail text are present only when set', () => {
    const spec = buildWorkboardSpec([
      workItem({ id: 'wi-full', title: 'With chip', agentId: 'researcher', detail: 'Deep dive' }),
      workItem({ id: 'wi-bare', title: 'Without chip' }),
    ]);
    expect(() => normalizeAndValidateJsonRenderSpec(spec)).not.toThrow();
    const chip = elementRecord(spec, 'item-wi-full-agent');
    expect(chip.type).toBe('Badge');
    expect((chip.props as Record<string, unknown>).text).toBe('researcher');
    const detail = elementRecord(spec, 'item-wi-full-detail');
    expect(detail.type).toBe('Text');
    expect((detail.props as Record<string, unknown>).text).toBe('Deep dive');
    expect(elementRecord(spec, 'item-wi-full').children).toEqual(['item-wi-full-agent', 'item-wi-full-detail']);
    expect(spec.elements['item-wi-bare-agent']).toBeUndefined();
    expect(spec.elements['item-wi-bare-detail']).toBeUndefined();
    expect(elementRecord(spec, 'item-wi-bare').children).toEqual([]);
  });
});
