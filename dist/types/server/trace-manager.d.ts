/**
 * TraceManager — creates trace nodes and flow edges on the canvas
 * as the agent calls tools and spawns subagents.
 *
 * Server-side singleton consumed by chat-view event wiring.
 */
declare class TraceManager {
    private _enabled;
    private traceNodeIds;
    private lastTraceNodeId;
    private toolCallToNodeId;
    private traceOrigin;
    private chainIndex;
    get enabled(): boolean;
    setEnabled(value: boolean): void;
    onToolStart(payload: {
        name: string;
        toolCallId?: string;
        activity?: string;
        mcpServerName?: string | null;
        mcpToolName?: string | null;
    }): void;
    onToolComplete(payload: {
        name: string;
        toolCallId?: string;
        success?: boolean;
        activity?: string;
        error?: string;
    }): void;
    onSubagentStarted(payload: {
        agentName: string;
        agentDisplayName?: string;
    }): void;
    onSubagentCompleted(payload: {
        agentName: string;
        agentDisplayName?: string;
        durationMs?: number;
        failed?: boolean;
    }): void;
    /**
     * The chain's last node is gone (another board was opened, or it was
     * deleted): start a new chain instead of wiring edges to a missing node.
     */
    private dropStaleChain;
    /** Forget the trace chain without touching nodes. */
    resetChain(): void;
    clearTrace(): void;
    getTraceNodeCount(): number;
    private getOrigin;
    private nextPosition;
    private evictIfNeeded;
    private broadcastUpdate;
}
export declare const traceManager: TraceManager;
export {};
