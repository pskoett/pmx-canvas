type JsonRpcId = string | number | null;
interface JsonRpcBase {
    jsonrpc: '2.0';
}
interface JsonRpcRequestMessage extends JsonRpcBase {
    id: JsonRpcId;
    method: string;
    params?: unknown;
}
interface JsonRpcNotificationMessage extends JsonRpcBase {
    method: string;
    params?: unknown;
}
interface JsonRpcSuccessResponse extends JsonRpcBase {
    id: JsonRpcId;
    result: unknown;
}
interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}
interface JsonRpcErrorResponse extends JsonRpcBase {
    id: JsonRpcId;
    error: JsonRpcErrorObject;
}
type JsonRpcResponseMessage = JsonRpcSuccessResponse | JsonRpcErrorResponse;
type JsonRpcMessage = JsonRpcRequestMessage | JsonRpcNotificationMessage | JsonRpcResponseMessage;
type DisplayMode = 'inline' | 'fullscreen' | 'pip';
interface ImplementationInfo {
    name: string;
    version: string;
}
type HostCapabilities = Record<string, unknown>;
interface HostContext {
    theme?: 'light' | 'dark';
    platform?: string;
    displayMode?: DisplayMode;
    containerDimensions?: {
        maxHeight?: number;
        width?: number;
        height?: number;
    };
    [key: string]: unknown;
}
interface HostOptions {
    hostContext?: HostContext;
}
interface RequestExtra {
    signal: AbortSignal;
    sessionId?: string;
}
interface SizeChangedParams {
    width?: number;
    height?: number;
}
interface OpenLinkParams {
    url: string;
}
interface DownloadFileParams {
    contents?: unknown[];
}
interface RequestDisplayModeParams {
    mode: DisplayMode;
}
interface RequestDisplayModeResult {
    mode: DisplayMode;
}
interface ToolCallParams {
    name: string;
    arguments?: Record<string, unknown>;
}
interface ToolInputParams {
    arguments?: Record<string, unknown>;
}
interface ToolCancelledParams {
    reason?: string;
}
interface SandboxReadyParams {
    html?: string;
    sandbox?: string;
}
interface LoggingMessageParams {
    level?: string;
    logger?: string;
    data?: unknown;
}
type RequestHandler<TParams = unknown, TResult = unknown> = (params: TParams, extra: RequestExtra) => Promise<TResult> | TResult;
export declare class PostMessageTransport {
    private readonly eventTarget;
    private readonly eventSource;
    private messageListener;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JsonRpcMessage, extra?: {
        sessionId?: string;
    }) => void;
    sessionId?: string;
    setProtocolVersion?: (version: string) => void;
    constructor(eventTarget: Window | undefined, eventSource: MessageEventSource | null);
    start(): Promise<void>;
    send(message: JsonRpcMessage): Promise<void>;
    close(): Promise<void>;
}
export declare class AppBridge {
    private readonly client;
    private readonly hostInfo;
    private readonly capabilities;
    private readonly requestHandlers;
    private readonly notificationHandlers;
    private readonly pendingRequests;
    private transport;
    private nextRequestId;
    private appCapabilities?;
    private hostContext;
    private appInfo?;
    onping?: (params: Record<string, never>, extra: RequestExtra) => void;
    constructor(client: null, hostInfo: ImplementationInfo, capabilities: HostCapabilities, options?: HostOptions);
    getAppCapabilities(): Record<string, unknown> | undefined;
    getAppVersion(): ImplementationInfo | undefined;
    private setNotificationHandler;
    private setRequestHandler;
    set onsizechange(callback: (params: SizeChangedParams) => void);
    set onsandboxready(callback: (params: Record<string, never>) => void);
    set oninitialized(callback: (params: Record<string, never>) => void);
    set onmessage(callback: RequestHandler<Record<string, unknown>, Record<string, unknown>>);
    set onopenlink(callback: RequestHandler<OpenLinkParams, Record<string, unknown>>);
    set ondownloadfile(callback: RequestHandler<DownloadFileParams, Record<string, unknown>>);
    set onrequestteardown(callback: (params: Record<string, never>) => void);
    set onrequestdisplaymode(callback: RequestHandler<RequestDisplayModeParams, RequestDisplayModeResult>);
    set onloggingmessage(callback: (params: LoggingMessageParams) => void);
    set onupdatemodelcontext(callback: RequestHandler<Record<string, unknown>, Record<string, unknown>>);
    set oncalltool(callback: RequestHandler<ToolCallParams, unknown>);
    set onlistresources(callback: RequestHandler<Record<string, unknown>, unknown>);
    set onlistresourcetemplates(callback: RequestHandler<Record<string, unknown>, unknown>);
    set onreadresource(callback: RequestHandler<Record<string, unknown>, unknown>);
    set onlistprompts(callback: RequestHandler<Record<string, unknown>, unknown>);
    getCapabilities(): HostCapabilities;
    setHostContext(hostContext: HostContext): void;
    sendHostContextChange(params: HostContext): Promise<void>;
    sendToolInput(params: ToolInputParams): Promise<void>;
    sendToolInputPartial(params: ToolInputParams): Promise<void>;
    sendToolResult(params: unknown): Promise<void>;
    sendToolCancelled(params: ToolCancelledParams): Promise<void>;
    sendSandboxResourceReady(params: SandboxReadyParams): Promise<void>;
    teardownResource(params: Record<string, never>): Promise<Record<string, unknown>>;
    sendResourceTeardown: (params: Record<string, never>) => Promise<Record<string, unknown>>;
    sendToolListChanged(params?: Record<string, unknown>): Promise<void>;
    sendResourceListChanged(params?: Record<string, unknown>): Promise<void>;
    sendPromptListChanged(params?: Record<string, unknown>): Promise<void>;
    connect(transport: PostMessageTransport): Promise<void>;
    private handleIncomingMessage;
    private handleRequest;
    private handleInitialize;
    private sendSuccess;
    private sendError;
    private notification;
    private request;
}
export {};
