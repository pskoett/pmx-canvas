import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolveNodeAxCapabilities, type AxInteractionType } from '../../src/server/ax-interaction.ts';
import type { CanvasNodeState } from '../../src/server/canvas-state.ts';
import {
  buildHtmlPrimitive,
  getHtmlPrimitiveDescriptor,
  HTML_PRIMITIVE_KINDS,
  listHtmlPrimitiveDescriptors,
} from '../../src/server/html-primitives.ts';
import { executeOperation } from '../../src/server/operations/index.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

/**
 * The `ax-board` primitive is the first HTML primitive that EMITS AX interactions.
 * `html` is AX-opt-in, so the descriptor's declared capabilities have to reach the
 * created node's `data.axCapabilities` or the board renders but stays inert.
 */
const AX_BOARD_CAPABILITIES: AxInteractionType[] = ['ax.work.create', 'ax.work.update', 'ax.steer', 'ax.event.record'];

interface CreatedNode {
  node: { id: string; type: string; data: Record<string, unknown> };
}

describe('ax-board html primitive', () => {
  test('is a registered primitive kind with a complete descriptor', () => {
    expect(HTML_PRIMITIVE_KINDS).toContain('ax-board');
    const descriptor = getHtmlPrimitiveDescriptor('ax-board');
    expect(descriptor.title).toBe('AX Board');
    expect(descriptor.description.length).toBeGreaterThan(20);
    expect(descriptor.useWhen.length).toBeGreaterThan(20);
    expect(descriptor.defaultSize.width).toBeGreaterThan(600);
    expect(descriptor.defaultSize.height).toBeGreaterThan(400);
    expect(descriptor.dataShape).toContain('note');
    expect((descriptor.example as { kind?: string }).kind).toBe('ax-board');
    expect(descriptor.axCapabilities).toEqual({ enabled: true, allowed: AX_BOARD_CAPABILITIES });
  });

  test('renders a surface that emits every capability it declares', () => {
    const built = buildHtmlPrimitive({ kind: 'ax-board' });
    expect(built.kind).toBe('ax-board');
    for (const type of AX_BOARD_CAPABILITIES) {
      expect(built.html, `ax-board never emits "${type}"`).toContain(`'${type}'`);
    }
    // Reads the live board, never a private mirror of the work list.
    expect(built.html).toContain('window.PMX_AX.state');
    expect(built.html).toContain('pmx-ax-update');
    // The three sandbox footguns: no storage APIs, awaited emits, honest steering copy.
    expect(built.html).not.toContain('localStorage');
    expect(built.html).not.toContain('sessionStorage');
    expect(built.html).not.toContain('document.cookie');
    expect(built.html).toContain('await window.PMX_AX.emit');
    expect(built.html).toContain("agent's next turn");
    // Bounded loop: capped, human-stoppable, never auto-started.
    expect(built.html).toContain('AX_MAX_RUNS = 20');
    expect(built.html).toContain('ax-stop-loop');
    expect(built.html).toContain('axAdvancing');
  });

  // Exact equality on purpose: this is the guard that no EXISTING primitive kind
  // silently gains AX. A new AX surface has to be added here deliberately.
  test('only the AX control surfaces declare AX capabilities', () => {
    const withCapabilities = listHtmlPrimitiveDescriptors()
      .filter((descriptor) => descriptor.axCapabilities !== undefined)
      .map((descriptor) => descriptor.kind);
    expect([...withCapabilities].sort()).toEqual(['ax-board', 'ax-flow']);
    expect(getHtmlPrimitiveDescriptor('choice-grid').axCapabilities).toBeUndefined();
  });
});

describe('ax-board node creation', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-ax-board-');
    resetCanvasForTests(workspaceRoot);
  });

  afterEach(() => {
    removeTestWorkspace(workspaceRoot);
  });

  async function addPrimitive(body: Record<string, unknown>): Promise<CanvasNodeState> {
    const created = (await executeOperation('node.add', body)) as CreatedNode;
    return created.node as CanvasNodeState;
  }

  test('applies the descriptor capabilities so the AX bridge is injected', async () => {
    const node = await addPrimitive({ type: 'html', primitive: 'ax-board', title: 'Agent Board' });

    expect(node.type).toBe('html');
    expect(node.data.htmlPrimitive).toBe('ax-board');
    expect(node.data.axCapabilities).toEqual({ enabled: true, allowed: AX_BOARD_CAPABILITIES });

    // What the server actually gates on when deciding to inject window.PMX_AX.
    const resolved = resolveNodeAxCapabilities(node);
    expect(resolved.enabled).toBe(true);
    expect([...resolved.allowed].sort()).toEqual([...AX_BOARD_CAPABILITIES].sort());
  });

  test('an explicit axCapabilities wins over the descriptor and is clamped to the html ceiling', async () => {
    const node = await addPrimitive({
      type: 'html',
      primitive: 'ax-board',
      axCapabilities: { enabled: true, allowed: ['ax.work.create', 'not-a-real-type'] },
    });

    expect(node.data.axCapabilities).toEqual({ enabled: true, allowed: ['ax.work.create'] });
    expect(resolveNodeAxCapabilities(node).allowed).toEqual(['ax.work.create']);
  });

  test('non-AX primitive kinds are created without any axCapabilities', async () => {
    const node = await addPrimitive({ type: 'html', primitive: 'choice-grid', title: 'Options' });

    expect(node.data.htmlPrimitive).toBe('choice-grid');
    expect(node.data.axCapabilities).toBeUndefined();
    expect(resolveNodeAxCapabilities(node).enabled).toBe(false);
  });
});
