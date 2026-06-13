/**
 * Operation registry entrypoint: imports all ops/* files and registers them
 * (single registration site), and re-exports the transport surfaces.
 */
import { registerOperation } from './registry.js';
import { nodeOperations } from './ops/nodes.js';
import { edgeOperations } from './ops/edges.js';
import { viewportOperations } from './ops/viewport.js';
import { groupOperations } from './ops/groups.js';
import { queryOperations } from './ops/query.js';
import { snapshotOperations } from './ops/snapshots.js';
import { jsonRenderOperations } from './ops/json-render.js';

for (const op of [
  ...nodeOperations,
  ...edgeOperations,
  ...viewportOperations,
  ...groupOperations,
  ...queryOperations,
  ...snapshotOperations,
  ...jsonRenderOperations,
]) {
  registerOperation(op);
}

export {
  executeOperation,
  getOperation,
  listOperations,
  registerOperation,
  setOperationEventEmitter,
} from './registry.js';
export { dispatchOperationRoute } from './http.js';
export { LocalOperationInvoker, HttpOperationInvoker, type OperationInvoker } from './invoker.js';
export { registerOperationTools, registerCompositeTools, type OperationToolHost } from './mcp.js';
export { compositeToolDefinitions, type CompositeToolDefinition } from './composites.js';
export {
  OperationError,
  defineOperation,
  type Operation,
  type OperationContext,
  type OperationDefinition,
  type OperationErrorStatus,
} from './types.js';
