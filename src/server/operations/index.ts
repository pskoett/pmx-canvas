/**
 * Operation registry entrypoint: imports all ops/* files and registers them
 * (single registration site), and re-exports the transport surfaces.
 */
import { registerOperation } from './registry.js';
import { nodeOperations } from './ops/nodes.js';
import { edgeOperations } from './ops/edges.js';
import { viewportOperations } from './ops/viewport.js';
import { groupOperations } from './ops/groups.js';

for (const op of [...nodeOperations, ...edgeOperations, ...viewportOperations, ...groupOperations]) {
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
export { registerOperationTools, type OperationToolHost } from './mcp.js';
export {
  OperationError,
  defineOperation,
  type Operation,
  type OperationContext,
  type OperationDefinition,
  type OperationErrorStatus,
} from './types.js';
