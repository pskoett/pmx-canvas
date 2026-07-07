import { type CanvasLayout, type CanvasNodeState, type PmxCanvas } from '../server/index.js';
import type { PmxAxSource } from '../server/ax-state.js';
import { type OperationInvoker } from '../server/operations/index.js';
type AxStateResult = ReturnType<PmxCanvas['getAxState']>;
type AxContextResult = ReturnType<PmxCanvas['getAxContext']>;
type SubmitAxInteractionInput = Parameters<PmxCanvas['submitAxInteraction']>[0];
type SubmitAxInteractionResult = ReturnType<PmxCanvas['submitAxInteraction']>;
type GetPendingSteeringResult = ReturnType<PmxCanvas['getPendingSteering']>;
type ListElicitationsResult = ReturnType<PmxCanvas['listElicitations']>;
type ListModeRequestsResult = ReturnType<PmxCanvas['listModeRequests']>;
type IngestActivityInput = Parameters<PmxCanvas['ingestActivity']>[0];
type IngestActivityResult = ReturnType<PmxCanvas['ingestActivity']>;
type GetPolicyResult = ReturnType<PmxCanvas['getPolicy']>;
type GetAxTimelineQuery = Parameters<PmxCanvas['getAxTimeline']>[0];
type GetAxTimelineResult = ReturnType<PmxCanvas['getAxTimeline']>;
type ListWorkItemsResult = ReturnType<PmxCanvas['listWorkItems']>;
type ListApprovalGatesResult = ReturnType<PmxCanvas['listApprovalGates']>;
type ListReviewAnnotationsResult = ReturnType<PmxCanvas['listReviewAnnotations']>;
type HistoryResult = ReturnType<PmxCanvas['getHistory']>;
type RunBatchInput = Parameters<PmxCanvas['runBatch']>[0];
type RunBatchResult = Awaited<ReturnType<PmxCanvas['runBatch']>>;
type CodeGraphResult = ReturnType<PmxCanvas['getCodeGraph']>;
type AutomationWebViewStatus = Awaited<ReturnType<PmxCanvas['getAutomationWebViewStatus']>>;
type AutomationScreenshotOptions = Parameters<PmxCanvas['screenshotAutomationWebView']>[0];
export interface CanvasAccess {
    readonly port: number;
    readonly remoteBaseUrl: string | null;
    /** Operation-registry invoker (plan-005): local in-process or HTTP, matching the access mode. */
    invoker(): OperationInvoker;
    getLayout(): Promise<CanvasLayout>;
    getNode(id: string): Promise<CanvasNodeState | undefined>;
    getAxState(): Promise<AxStateResult>;
    getAxContext(options?: {
        consumer?: string;
    }): Promise<AxContextResult>;
    getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult>;
    listWorkItems(): Promise<ListWorkItemsResult>;
    listApprovalGates(): Promise<ListApprovalGatesResult>;
    listReviewAnnotations(): Promise<ListReviewAnnotationsResult>;
    submitAxInteraction(input: SubmitAxInteractionInput, options?: {
        source?: PmxAxSource;
    }): Promise<SubmitAxInteractionResult>;
    getPendingSteering(options?: {
        consumer?: string;
        limit?: number;
    }): Promise<GetPendingSteeringResult>;
    listElicitations(): Promise<ListElicitationsResult>;
    listModeRequests(): Promise<ListModeRequestsResult>;
    ingestActivity(input: IngestActivityInput, options?: {
        source?: PmxAxSource;
    }): Promise<IngestActivityResult>;
    getPolicy(): Promise<GetPolicyResult>;
    getHistory(): Promise<HistoryResult>;
    getPinnedNodeIds(): Promise<string[]>;
    runBatch(operations: RunBatchInput): Promise<RunBatchResult>;
    getCodeGraph(): Promise<CodeGraphResult>;
    getAutomationWebViewStatus(): Promise<AutomationWebViewStatus>;
    screenshotAutomationWebView(options?: AutomationScreenshotOptions): Promise<Uint8Array>;
}
export declare function refreshCanvasAccess(access: CanvasAccess): Promise<CanvasAccess>;
/**
 * Finding I (0.2.6): decide whether to ATTACH to the daemon already holding the
 * preferred port instead of spawning a split daemon on a fallback port. True only
 * when the split is not opted in AND the preferred port is held by a healthy canvas
 * daemon that reports a workspace (i.e. a real different-workspace daemon, the
 * "wrong-workspace split" trap — not a free port or a non-canvas occupant). Pure +
 * exported for deterministic testing.
 */
export declare function shouldAttachToExistingDaemon(occupant: {
    ok?: boolean;
    workspace?: unknown;
} | null, allowSplit: boolean): boolean;
/**
 * Finding I (0.2.6, first-binder gap): true when the launch cwd looks like a
 * host/agent config dir rather than a project root — the home dir itself, or a
 * dot-prefixed DIRECT child of home (e.g. `~/.copilot`, `~/.codex`, `~/.claude`,
 * `~/.config`). POSITIVE-signal ONLY — never "absence of project markers", because
 * the MCP/SDK test harness runs from bare `mkdtemp` temp dirs (under `os.tmpdir()`,
 * never under home) that a marker-absence heuristic would misflag. Both sides are
 * canonicalized (realpath) so a symlinked home matches. Pure + exported for tests;
 * FS-safe (defaults to false on any error).
 */
export declare function looksLikeIncidentalCwd(cwd: string): boolean;
export declare function createCanvasAccess(): Promise<CanvasAccess>;
export {};
