import { z } from 'zod';
import { memoryGraph, localMemoryGraph, boardMemoryGraph } from '../../memory-graph.js';
import { defineOperation, OperationError, type Operation } from '../types.js';

const shape = {
  projection: z
    .enum(['full', 'boards'])
    .default('full')
    .describe('Full board/card graph, or board-only Map summaries with qualified cross-board and missing relations'),
  focus: z.string().optional().describe('Board ID, board-qualified graph node key, or pins; omit for the library'),
  depth: z
    .union([z.number(), z.string().trim().min(1)])
    .pipe(z.coerce.number<string | number>().int().min(0).max(4))
    .default(2)
    .describe('Undirected hops, including membership, 0–4 (default 2)'),
};
const schema = z.looseObject(shape);
export const memoryGraphOperations: Operation[] = [
  defineOperation({
    name: 'memory-graph.get',
    mutates: false,
    input: schema,
    inputShape: shape,
    http: { method: 'GET', path: '/api/canvas/memory-graph' },
    mcp: {
      toolName: 'canvas_memory_graph',
      description:
        'Explore the same board/card graph Home draws. Summary-only discovery, not full content reads; writes still target the open board.',
      extraShape: shape,
      formatResult: (result) => ({ content: [{ type: 'text' as const, text: JSON.stringify(result) }] }),
    },
    handler: (input) => {
      const graph = memoryGraph(input.focus ? 'full' : input.projection);
      if (
        input.focus &&
        input.focus !== 'pins' &&
        !graph.nodes.some((node) => node.key === input.focus || (node.kind === 'board' && node.boardId === input.focus))
      ) {
        throw new OperationError('Graph focus not found. Use a board ID, a qualified node key, or pins.', 404);
      }
      const local = localMemoryGraph(graph, input.focus ?? null, input.depth);
      return input.projection === 'boards' ? boardMemoryGraph(local) : local;
    },
  }),
];
