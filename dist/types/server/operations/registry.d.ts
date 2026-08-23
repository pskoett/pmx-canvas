import { type Operation } from './types.js';
export declare function registerOperation(op: Operation): void;
export declare function getOperation(name: string): Operation;
export declare function listOperations(): Operation[];
type OperationEventEmitter = (event: string, payload: Record<string, unknown>) => void;
export declare function setOperationEventEmitter(emitter: OperationEventEmitter | null): void;
/** True while operation SSE emits are being suppressed (inside a meta-op such as
 * canvas.batch). Ops whose effect depends on a live SSE emit firing — e.g.
 * mcpapp.open, whose canvas node is created as a side-effect of `ext-app-open` —
 * use this to reject loudly instead of silently no-op'ing in a suppressed run. */
export declare function isEmitSuppressed(): boolean;
/** Run `fn` with all operation SSE emits suppressed; restores depth on finally. */
export declare function runWithSuppressedEmits<T>(fn: () => Promise<T>): Promise<T>;
export interface ExecuteOperationMeta {
    /**
     * Skip the synthesized auto-ghost: set by the workbench's own HTTP calls
     * (a human dragging a node is not agent activity) and by canvas.batch for
     * its inner dispatches (batch churn is exempt, matching the skill contract).
     */
    suppressAutoGhost?: boolean;
    /**
     * Who is calling — the presence writer label ('mcp', 'sdk', 'api', …).
     * Defaults to 'api'. Workbench calls (suppressAutoGhost) never touch presence.
     */
    source?: string;
    /**
     * The human's own browser issued this call. Distinct from suppressAutoGhost
     * (which batch also sets for its inner dispatches): the scope fence applies
     * to agents only, and batch inner writes are always agent-originated.
     */
    fromWorkbench?: boolean;
}
export declare function executeOperation(name: string, rawInput: unknown, meta?: ExecuteOperationMeta): Promise<unknown>;
export {};
