/** Dispatch user intents from the canvas to the server (for TUI consumption). */
export declare function sendIntent(type: string, payload?: Record<string, unknown>): Promise<{
    ok: boolean;
}>;
/**
 * Veto a forming ghost intent: post a steering "don't" to the active agent
 * session BEFORE the mutation lands, then clear the ghost. Best-effort — a
 * dropped request just leaves the ghost to expire on its own TTL.
 */
export declare function vetoGhostIntent(intent: {
    id: string;
    kind: string;
    label?: string;
    reason?: string;
}): Promise<void>;
/** Fetch rendered markdown HTML from the server. */
export declare function renderMarkdown(markdown: string): Promise<string>;
/** Fetch file content from the server. */
export declare function fetchFile(path: string): Promise<{
    content: string;
    provenance?: unknown;
}>;
/** Save file content to the server. */
export declare function saveFile(path: string, content: string): Promise<{
    ok: boolean;
    updatedAt?: string;
}>;
/** Fetch current workbench state. */
export declare function fetchWorkbenchState(): Promise<Record<string, unknown>>;
/** Open a markdown file in the workbench/canvas. */
export declare function openWorkbenchFile(path: string): Promise<{
    ok: boolean;
}>;
/** Fetch canvas state from server. */
export declare function fetchCanvasState(): Promise<Record<string, unknown>>;
export declare function saveCanvasTheme(theme: string): Promise<{
    ok: boolean;
    theme?: string;
}>;
/** Fetch available slash commands for prompt completion. */
export declare function fetchSlashCommands(): Promise<Array<{
    name: string;
    description: string;
}>>;
/** Submit a new canvas prompt. */
export declare function submitCanvasPrompt(text: string, position?: {
    x: number;
    y: number;
}, parentNodeId?: string, contextNodeIds?: string[], threadNodeId?: string): Promise<{
    ok: boolean;
    nodeId?: string;
    error?: string;
}>;
/** Submit a reply into an existing prompt thread. */
export declare function submitThreadReply(threadNodeId: string, text: string): Promise<{
    ok: boolean;
    nodeId?: string;
    error?: string;
}>;
/** Push canvas node updates to server. */
export declare function pushCanvasUpdate(updates: Array<{
    id: string;
    position?: {
        x: number;
        y: number;
    };
    size?: {
        width: number;
        height: number;
    };
    collapsed?: boolean;
    dockPosition?: 'left' | 'right' | null;
}>, options?: {
    recordHistory?: boolean;
}): Promise<void>;
/** Create a canvas edge via the server. */
export declare function createEdgeFromClient(from: string, to: string, type: string, label?: string): Promise<{
    ok: boolean;
    id?: string;
}>;
/** Create a canvas node via the server. Returns the new node ID. */
export declare function createNodeFromClient(opts: {
    type?: string;
    title?: string;
    content?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}): Promise<{
    ok: boolean;
    id?: string;
}>;
/** Update a canvas node via the server. */
export declare function updateNodeFromClient(id: string, patch: {
    position?: {
        x: number;
        y: number;
    };
    size?: {
        width: number;
        height: number;
    };
    collapsed?: boolean;
    pinned?: boolean;
    dockPosition?: 'left' | 'right' | null;
    title?: string;
    content?: string;
    data?: Record<string, unknown>;
}): Promise<{
    ok: boolean;
    id?: string;
}>;
/** Refresh a webpage node from its persisted URL on the server. */
export declare function refreshWebpageNodeFromClient(id: string, url?: string): Promise<{
    ok: boolean;
    id?: string;
    error?: string;
}>;
/** Remove a canvas node via the server. */
export declare function removeNodeFromClient(id: string): Promise<{
    ok: boolean;
    removed?: string;
}>;
export interface AxInteractionRequest {
    type: string;
    sourceNodeId: string;
    payload?: Record<string, unknown>;
    sourceSurface?: 'native-node' | 'json-render' | 'html-node' | 'mcp-app' | 'adapter';
}
export interface AxInteractionResponse {
    ok: boolean;
    type?: string;
    sourceNodeId?: string;
    primitive?: unknown;
    status?: number;
    code?: string;
    error?: string;
}
/** Fetch the compact AX state snapshot pushed into AX-enabled surfaces. */
export declare function fetchAxSurfaceState(): Promise<unknown>;
/** Ask the server to open a node's surface in the system browser. */
export declare function openNodeInSystemBrowserRequest(nodeId: string, url?: string): Promise<{
    ok: boolean;
    opened: boolean;
}>;
/** Submit a capability-gated AX interaction from a native node control. */
export declare function submitAxInteractionFromClient(input: AxInteractionRequest): Promise<AxInteractionResponse>;
/** Commit the current viewport to the authoritative server state. */
export declare function updateViewportFromClient(viewport: {
    x: number;
    y: number;
    scale: number;
}, options?: {
    recordHistory?: boolean;
}): Promise<{
    ok: boolean;
}>;
/** Create a group containing the given child node IDs. */
export declare function createGroupFromClient(opts: {
    title?: string;
    childIds?: string[];
    color?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
}): Promise<{
    ok: boolean;
    id?: string;
}>;
/** Add nodes to an existing group. */
export declare function addToGroupFromClient(groupId: string, childIds: string[]): Promise<{
    ok: boolean;
}>;
/** Ungroup all children from a group. */
export declare function ungroupFromClient(groupId: string): Promise<{
    ok: boolean;
}>;
export interface CanvasSnapshotInfo {
    id: string;
    name: string;
    createdAt: string;
    nodeCount: number;
    edgeCount: number;
}
export declare function listSnapshots(): Promise<CanvasSnapshotInfo[]>;
export declare function saveSnapshot(name: string): Promise<{
    ok: boolean;
    snapshot?: CanvasSnapshotInfo;
}>;
export declare function restoreSnapshot(id: string): Promise<{
    ok: boolean;
}>;
export declare function deleteSnapshot(id: string): Promise<{
    ok: boolean;
}>;
/** Remove a canvas edge via the server. */
export declare function removeEdgeFromClient(edgeId: string): Promise<{
    ok: boolean;
}>;
