import { type CanvasLayout, type CanvasNodeState, type CanvasSnapshot, type PmxCanvas } from '../server/index.js';
import type { PmxAxSource } from '../server/ax-state.js';
type AddNodeInput = Parameters<PmxCanvas['addNode']>[0];
type AddWebpageNodeInput = Parameters<PmxCanvas['addWebpageNode']>[0];
type RefreshWebpageNodeResult = Awaited<ReturnType<PmxCanvas['refreshWebpageNode']>>;
type OpenMcpAppInput = Parameters<PmxCanvas['openMcpApp']>[0];
type OpenMcpAppResult = Awaited<ReturnType<PmxCanvas['openMcpApp']>>;
type AddDiagramInput = Parameters<PmxCanvas['addDiagram']>[0];
type AddJsonRenderNodeInput = Parameters<PmxCanvas['addJsonRenderNode']>[0];
type AddJsonRenderNodeResult = ReturnType<PmxCanvas['addJsonRenderNode']>;
type StreamJsonRenderNodeInput = Parameters<PmxCanvas['streamJsonRenderNode']>[0];
type StreamJsonRenderNodeResult = ReturnType<PmxCanvas['streamJsonRenderNode']>;
type AddHtmlNodeInput = Parameters<PmxCanvas['addHtmlNode']>[0];
type AddHtmlPrimitiveInput = Parameters<PmxCanvas['addHtmlPrimitive']>[0];
type AddHtmlPrimitiveResult = ReturnType<PmxCanvas['addHtmlPrimitive']>;
type AddGraphNodeInput = Parameters<PmxCanvas['addGraphNode']>[0];
type AddGraphNodeResult = ReturnType<PmxCanvas['addGraphNode']>;
type UpdateNodePatch = Parameters<PmxCanvas['updateNode']>[1];
type AddEdgeInput = Parameters<PmxCanvas['addEdge']>[0];
type CreateGroupInput = Parameters<PmxCanvas['createGroup']>[0];
type GroupNodesOptions = Parameters<PmxCanvas['groupNodes']>[2];
type ArrangeLayout = Parameters<PmxCanvas['arrange']>[0];
type FocusNodeResult = ReturnType<PmxCanvas['focusNode']>;
type FitViewOptions = Parameters<PmxCanvas['fitView']>[0];
type FitViewResult = ReturnType<PmxCanvas['fitView']>;
type AxStateResult = ReturnType<PmxCanvas['getAxState']>;
type AxContextResult = ReturnType<PmxCanvas['getAxContext']>;
type SetAxFocusResult = ReturnType<PmxCanvas['setAxFocus']>;
type RecordAxEventInput = Parameters<PmxCanvas['recordAxEvent']>[0];
type RecordAxEventResult = ReturnType<PmxCanvas['recordAxEvent']>;
type SendSteeringResult = ReturnType<PmxCanvas['sendSteering']>;
type SubmitAxInteractionInput = Parameters<PmxCanvas['submitAxInteraction']>[0];
type SubmitAxInteractionResult = ReturnType<PmxCanvas['submitAxInteraction']>;
type GetPendingSteeringResult = ReturnType<PmxCanvas['getPendingSteering']>;
type ListElicitationsResult = ReturnType<PmxCanvas['listElicitations']>;
type RequestElicitationInput = Parameters<PmxCanvas['requestElicitation']>[0];
type RequestElicitationResult = ReturnType<PmxCanvas['requestElicitation']>;
type RespondElicitationResult = ReturnType<PmxCanvas['respondElicitation']>;
type ListModeRequestsResult = ReturnType<PmxCanvas['listModeRequests']>;
type RequestModeInput = Parameters<PmxCanvas['requestMode']>[0];
type RequestModeResult = ReturnType<PmxCanvas['requestMode']>;
type ResolveModeRequestResult = ReturnType<PmxCanvas['resolveModeRequest']>;
type GetCommandRegistryResult = ReturnType<PmxCanvas['getCommandRegistry']>;
type InvokeCommandResult = ReturnType<PmxCanvas['invokeCommand']>;
type GetPolicyResult = ReturnType<PmxCanvas['getPolicy']>;
type SetPolicyInput = Parameters<PmxCanvas['setPolicy']>[0];
type SetPolicyResult = ReturnType<PmxCanvas['setPolicy']>;
type GetAxTimelineQuery = Parameters<PmxCanvas['getAxTimeline']>[0];
type GetAxTimelineResult = ReturnType<PmxCanvas['getAxTimeline']>;
type AddWorkItemInput = Parameters<PmxCanvas['addWorkItem']>[0];
type AddWorkItemResult = ReturnType<PmxCanvas['addWorkItem']>;
type UpdateWorkItemPatch = Parameters<PmxCanvas['updateWorkItem']>[1];
type UpdateWorkItemResult = ReturnType<PmxCanvas['updateWorkItem']>;
type ListWorkItemsResult = ReturnType<PmxCanvas['listWorkItems']>;
type RequestApprovalInput = Parameters<PmxCanvas['requestApproval']>[0];
type RequestApprovalResult = ReturnType<PmxCanvas['requestApproval']>;
type ResolveApprovalResult = ReturnType<PmxCanvas['resolveApproval']>;
type ListApprovalGatesResult = ReturnType<PmxCanvas['listApprovalGates']>;
type AddEvidenceInput = Parameters<PmxCanvas['addEvidence']>[0];
type AddEvidenceResult = ReturnType<PmxCanvas['addEvidence']>;
type AddReviewAnnotationInput = Parameters<PmxCanvas['addReviewAnnotation']>[0];
type AddReviewAnnotationResult = ReturnType<PmxCanvas['addReviewAnnotation']>;
type UpdateReviewAnnotationPatch = Parameters<PmxCanvas['updateReviewAnnotation']>[1];
type UpdateReviewAnnotationResult = ReturnType<PmxCanvas['updateReviewAnnotation']>;
type ListReviewAnnotationsResult = ReturnType<PmxCanvas['listReviewAnnotations']>;
type GetHostCapabilityResult = ReturnType<PmxCanvas['getHostCapability']>;
type ReportHostCapabilityResult = ReturnType<PmxCanvas['reportHostCapability']>;
type SearchResult = ReturnType<PmxCanvas['search']>;
type UndoRedoResult = Awaited<ReturnType<PmxCanvas['undo']>>;
type HistoryResult = ReturnType<PmxCanvas['getHistory']>;
type SetContextPinsResult = ReturnType<PmxCanvas['setContextPins']>;
type RunBatchInput = Parameters<PmxCanvas['runBatch']>[0];
type RunBatchResult = Awaited<ReturnType<PmxCanvas['runBatch']>>;
type SnapshotListOptions = Parameters<PmxCanvas['listSnapshots']>[0];
type SnapshotList = ReturnType<PmxCanvas['listSnapshots']>;
type DeleteSnapshotResult = ReturnType<PmxCanvas['deleteSnapshot']>;
type GcSnapshotsOptions = Parameters<PmxCanvas['gcSnapshots']>[0];
type GcSnapshotsResult = ReturnType<PmxCanvas['gcSnapshots']>;
type DiffSnapshotResult = ReturnType<PmxCanvas['diffSnapshot']>;
type CodeGraphResult = ReturnType<PmxCanvas['getCodeGraph']>;
type ValidationResult = ReturnType<PmxCanvas['validate']>;
type WebArtifactInput = Parameters<PmxCanvas['buildWebArtifact']>[0];
type WebArtifactResult = Awaited<ReturnType<PmxCanvas['buildWebArtifact']>>;
type AutomationWebViewOptions = Parameters<PmxCanvas['startAutomationWebView']>[0];
type AutomationWebViewStatus = Awaited<ReturnType<PmxCanvas['startAutomationWebView']>>;
type AutomationEvaluateResult = Awaited<ReturnType<PmxCanvas['evaluateAutomationWebView']>>;
type AutomationScreenshotOptions = Parameters<PmxCanvas['screenshotAutomationWebView']>[0];
export interface CanvasAccess {
    readonly port: number;
    readonly remoteBaseUrl: string | null;
    getLayout(): Promise<CanvasLayout>;
    getNode(id: string): Promise<CanvasNodeState | undefined>;
    addNode(input: AddNodeInput): Promise<string>;
    addWebpageNode(input: AddWebpageNodeInput): Promise<Awaited<ReturnType<PmxCanvas['addWebpageNode']>>>;
    refreshWebpageNode(id: string, url?: string): Promise<RefreshWebpageNodeResult>;
    openMcpApp(input: OpenMcpAppInput): Promise<OpenMcpAppResult>;
    addDiagram(input: AddDiagramInput): Promise<OpenMcpAppResult>;
    addJsonRenderNode(input: AddJsonRenderNodeInput): Promise<AddJsonRenderNodeResult>;
    streamJsonRenderNode(input: StreamJsonRenderNodeInput): Promise<StreamJsonRenderNodeResult>;
    addHtmlNode(input: AddHtmlNodeInput): Promise<string>;
    addHtmlPrimitive(input: AddHtmlPrimitiveInput): Promise<AddHtmlPrimitiveResult>;
    addGraphNode(input: AddGraphNodeInput): Promise<AddGraphNodeResult>;
    buildWebArtifact(input: WebArtifactInput): Promise<WebArtifactResult>;
    updateNode(id: string, patch: UpdateNodePatch): Promise<void>;
    removeNode(id: string): Promise<void>;
    removeAnnotation(id: string): Promise<boolean>;
    addEdge(input: AddEdgeInput): Promise<string>;
    removeEdge(id: string): Promise<void>;
    createGroup(input: CreateGroupInput): Promise<string>;
    groupNodes(groupId: string, childIds: string[], options?: GroupNodesOptions): Promise<boolean>;
    ungroupNodes(groupId: string): Promise<boolean>;
    arrange(layout?: ArrangeLayout): Promise<void>;
    focusNode(id: string, options?: {
        noPan?: boolean;
    }): Promise<FocusNodeResult>;
    fitView(options?: FitViewOptions): Promise<FitViewResult>;
    getAxState(): Promise<AxStateResult>;
    getAxContext(): Promise<AxContextResult>;
    setAxFocus(nodeIds: string[], options?: {
        source?: PmxAxSource;
    }): Promise<SetAxFocusResult>;
    recordAxEvent(input: RecordAxEventInput, options?: {
        source?: PmxAxSource;
    }): Promise<RecordAxEventResult>;
    sendSteering(message: string, options?: {
        source?: PmxAxSource;
    }): Promise<SendSteeringResult>;
    getAxTimeline(query?: GetAxTimelineQuery): Promise<GetAxTimelineResult>;
    addWorkItem(input: AddWorkItemInput, options?: {
        source?: PmxAxSource;
    }): Promise<AddWorkItemResult>;
    updateWorkItem(id: string, patch: UpdateWorkItemPatch, options?: {
        source?: PmxAxSource;
    }): Promise<UpdateWorkItemResult>;
    listWorkItems(): Promise<ListWorkItemsResult>;
    requestApproval(input: RequestApprovalInput, options?: {
        source?: PmxAxSource;
    }): Promise<RequestApprovalResult>;
    resolveApproval(id: string, decision: 'approved' | 'rejected', options?: {
        resolution?: string;
        source?: PmxAxSource;
    }): Promise<ResolveApprovalResult>;
    listApprovalGates(): Promise<ListApprovalGatesResult>;
    addEvidence(input: AddEvidenceInput, options?: {
        source?: PmxAxSource;
    }): Promise<AddEvidenceResult>;
    addReviewAnnotation(input: AddReviewAnnotationInput, options?: {
        source?: PmxAxSource;
    }): Promise<AddReviewAnnotationResult>;
    updateReviewAnnotation(id: string, patch: UpdateReviewAnnotationPatch, options?: {
        source?: PmxAxSource;
    }): Promise<UpdateReviewAnnotationResult>;
    listReviewAnnotations(): Promise<ListReviewAnnotationsResult>;
    getHostCapability(): Promise<GetHostCapabilityResult>;
    reportHostCapability(input: unknown, options?: {
        source?: PmxAxSource;
    }): Promise<ReportHostCapabilityResult>;
    submitAxInteraction(input: SubmitAxInteractionInput, options?: {
        source?: PmxAxSource;
    }): Promise<SubmitAxInteractionResult>;
    getPendingSteering(options?: {
        consumer?: string;
        limit?: number;
    }): Promise<GetPendingSteeringResult>;
    markSteeringDelivered(id: string): Promise<boolean>;
    listElicitations(): Promise<ListElicitationsResult>;
    requestElicitation(input: RequestElicitationInput, options?: {
        source?: PmxAxSource;
    }): Promise<RequestElicitationResult>;
    respondElicitation(id: string, response: Record<string, unknown>, options?: {
        source?: PmxAxSource;
    }): Promise<RespondElicitationResult>;
    listModeRequests(): Promise<ListModeRequestsResult>;
    requestMode(input: RequestModeInput, options?: {
        source?: PmxAxSource;
    }): Promise<RequestModeResult>;
    resolveModeRequest(id: string, decision: 'approved' | 'rejected', options?: {
        resolution?: string;
        source?: PmxAxSource;
    }): Promise<ResolveModeRequestResult>;
    getCommandRegistry(): Promise<GetCommandRegistryResult>;
    invokeCommand(name: string, args?: Record<string, unknown> | null, options?: {
        source?: PmxAxSource;
    }): Promise<InvokeCommandResult>;
    getPolicy(): Promise<GetPolicyResult>;
    setPolicy(patch: SetPolicyInput, options?: {
        source?: PmxAxSource;
    }): Promise<SetPolicyResult>;
    clear(): Promise<void>;
    search(query: string): Promise<SearchResult>;
    undo(): Promise<UndoRedoResult>;
    redo(): Promise<UndoRedoResult>;
    getHistory(): Promise<HistoryResult>;
    setContextPins(nodeIds: string[], mode?: 'set' | 'add' | 'remove'): Promise<SetContextPinsResult>;
    getPinnedNodeIds(): Promise<string[]>;
    runBatch(operations: RunBatchInput): Promise<RunBatchResult>;
    listSnapshots(options?: SnapshotListOptions): Promise<SnapshotList>;
    saveSnapshot(name: string): Promise<CanvasSnapshot | null>;
    restoreSnapshot(id: string): Promise<{
        ok: boolean;
    }>;
    deleteSnapshot(id: string): Promise<DeleteSnapshotResult>;
    gcSnapshots(options?: GcSnapshotsOptions): Promise<GcSnapshotsResult>;
    diffSnapshot(idOrName: string): Promise<DiffSnapshotResult>;
    getCodeGraph(): Promise<CodeGraphResult>;
    validate(): Promise<ValidationResult>;
    getAutomationWebViewStatus(): Promise<AutomationWebViewStatus>;
    startAutomationWebView(options?: AutomationWebViewOptions): Promise<AutomationWebViewStatus>;
    stopAutomationWebView(): Promise<boolean>;
    evaluateAutomationWebView(expression: string): Promise<AutomationEvaluateResult>;
    resizeAutomationWebView(width: number, height: number): Promise<AutomationWebViewStatus>;
    screenshotAutomationWebView(options?: AutomationScreenshotOptions): Promise<Uint8Array>;
}
export declare function refreshCanvasAccess(access: CanvasAccess): Promise<CanvasAccess>;
export declare function createCanvasAccess(): Promise<CanvasAccess>;
export {};
