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
type JsonRpcMessage =
  | JsonRpcRequestMessage
  | JsonRpcNotificationMessage
  | JsonRpcResponseMessage;

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

interface InitializeParams {
  appCapabilities?: Record<string, unknown>;
  appInfo?: ImplementationInfo;
  protocolVersion?: string;
}

interface InitializeResult {
  protocolVersion: string;
  hostCapabilities: HostCapabilities;
  hostInfo: ImplementationInfo;
  hostContext: HostContext;
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

type RequestHandler<TParams = unknown, TResult = unknown> = (
  params: TParams,
  extra: RequestExtra,
) => Promise<TResult> | TResult;

type NotificationHandler<TParams = unknown> = (params: TParams) => Promise<void> | void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasJsonRpcEnvelope(value: unknown): value is Record<string, unknown> & JsonRpcBase {
  return isRecord(value) && value.jsonrpc === '2.0';
}

function isJsonRpcResponseMessage(value: unknown): value is JsonRpcResponseMessage {
  return hasJsonRpcEnvelope(value) && 'id' in value && ('result' in value || 'error' in value);
}

function isJsonRpcRequestMessage(value: unknown): value is JsonRpcRequestMessage {
  return hasJsonRpcEnvelope(value) && 'id' in value && typeof value.method === 'string';
}

function isJsonRpcNotificationMessage(value: unknown): value is JsonRpcNotificationMessage {
  return hasJsonRpcEnvelope(value) && !('id' in value) && typeof value.method === 'string';
}

function parseJsonRpcMessage(value: unknown): JsonRpcMessage | null {
  if (typeof value === 'string') {
    try {
      return parseJsonRpcMessage(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (isJsonRpcResponseMessage(value)) return value;
  if (isJsonRpcRequestMessage(value)) return value;
  if (isJsonRpcNotificationMessage(value)) return value;
  return null;
}

function isEqualJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function asDisplayMode(value: unknown): DisplayMode {
  return value === 'fullscreen' || value === 'pip' ? value : 'inline';
}

const LATEST_PROTOCOL_VERSION = '2026-01-26';

export class PostMessageTransport {
  private messageListener: ((event: MessageEvent) => void) | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JsonRpcMessage, extra?: { sessionId?: string }) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  constructor(
    private readonly eventTarget: Window | undefined,
    private readonly eventSource: MessageEventSource | null,
  ) {}

  async start(): Promise<void> {
    if (this.messageListener) return;
    this.messageListener = (event: MessageEvent) => {
      if (event.source !== this.eventSource) return;
      const message = parseJsonRpcMessage(event.data);
      if (!message) return;
      this.onmessage?.(message, this.sessionId ? { sessionId: this.sessionId } : undefined);
    };
    window.addEventListener('message', this.messageListener);
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.eventTarget) {
      throw new Error('PostMessageTransport target is unavailable');
    }
    this.eventTarget.postMessage(message, '*');
  }

  async close(): Promise<void> {
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }
    this.onclose?.();
  }
}

export class AppBridge {
  private readonly requestHandlers = new Map<string, RequestHandler>();
  private readonly notificationHandlers = new Map<string, NotificationHandler>();
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
  private transport: PostMessageTransport | null = null;
  private nextRequestId = 1;
  private appCapabilities?: Record<string, unknown>;
  private hostContext: HostContext;
  private appInfo?: ImplementationInfo;

  onping?: (params: Record<string, never>, extra: RequestExtra) => void;

  constructor(
    private readonly client: null,
    private readonly hostInfo: ImplementationInfo,
    private readonly capabilities: HostCapabilities,
    options?: HostOptions,
  ) {
    this.client = client;
    this.hostContext = options?.hostContext ?? {};
  }

  getAppCapabilities(): Record<string, unknown> | undefined {
    return this.appCapabilities;
  }

  getAppVersion(): ImplementationInfo | undefined {
    return this.appInfo;
  }

  private setNotificationHandler<TParams>(method: string, callback: NotificationHandler<TParams>): void {
    this.notificationHandlers.set(method, (params) => callback(params as TParams));
  }

  private setRequestHandler<TParams, TResult>(
    method: string,
    callback: RequestHandler<TParams, TResult>,
  ): void {
    this.requestHandlers.set(method, (params, extra) => callback(params as TParams, extra));
  }

  set onsizechange(callback: (params: SizeChangedParams) => void) {
    this.setNotificationHandler('ui/notifications/size-changed', callback);
  }

  set onsandboxready(callback: (params: Record<string, never>) => void) {
    this.setNotificationHandler('ui/notifications/sandbox-proxy-ready', callback);
  }

  set oninitialized(callback: (params: Record<string, never>) => void) {
    this.setNotificationHandler('ui/notifications/initialized', callback);
  }

  set onmessage(callback: RequestHandler<Record<string, unknown>, Record<string, unknown>>) {
    this.setRequestHandler('ui/message', callback);
  }

  set onopenlink(callback: RequestHandler<OpenLinkParams, Record<string, unknown>>) {
    this.setRequestHandler('ui/open-link', callback);
  }

  set ondownloadfile(callback: RequestHandler<DownloadFileParams, Record<string, unknown>>) {
    this.setRequestHandler('ui/download-file', callback);
  }

  set onrequestteardown(callback: (params: Record<string, never>) => void) {
    this.setNotificationHandler('ui/notifications/request-teardown', callback);
  }

  set onrequestdisplaymode(callback: RequestHandler<RequestDisplayModeParams, RequestDisplayModeResult>) {
    this.setRequestHandler('ui/request-display-mode', callback);
  }

  set onloggingmessage(callback: (params: LoggingMessageParams) => void) {
    this.setNotificationHandler('notifications/message', callback);
  }

  set onupdatemodelcontext(callback: RequestHandler<Record<string, unknown>, Record<string, unknown>>) {
    this.setRequestHandler('ui/update-model-context', callback);
  }

  set oncalltool(callback: RequestHandler<ToolCallParams, unknown>) {
    this.setRequestHandler('tools/call', callback);
  }

  set onlistresources(callback: RequestHandler<Record<string, unknown>, unknown>) {
    this.setRequestHandler('resources/list', callback);
  }

  set onlistresourcetemplates(callback: RequestHandler<Record<string, unknown>, unknown>) {
    this.setRequestHandler('resources/templates/list', callback);
  }

  set onreadresource(callback: RequestHandler<Record<string, unknown>, unknown>) {
    this.setRequestHandler('resources/read', callback);
  }

  set onlistprompts(callback: RequestHandler<Record<string, unknown>, unknown>) {
    this.setRequestHandler('prompts/list', callback);
  }

  getCapabilities(): HostCapabilities {
    return this.capabilities;
  }

  setHostContext(hostContext: HostContext): void {
    const changed: HostContext = {};
    let hasChanges = false;

    for (const [key, value] of Object.entries(hostContext)) {
      if (isEqualJsonValue(this.hostContext[key], value)) continue;
      changed[key] = value;
      hasChanges = true;
    }

    this.hostContext = hostContext;
    if (hasChanges) {
      void this.sendHostContextChange(changed);
    }
  }

  sendHostContextChange(params: HostContext): Promise<void> {
    return this.notification('ui/notifications/host-context-changed', params);
  }

  sendToolInput(params: ToolInputParams): Promise<void> {
    return this.notification('ui/notifications/tool-input', params);
  }

  sendToolInputPartial(params: ToolInputParams): Promise<void> {
    return this.notification('ui/notifications/tool-input-partial', params);
  }

  sendToolResult(params: unknown): Promise<void> {
    return this.notification('ui/notifications/tool-result', params);
  }

  sendToolCancelled(params: ToolCancelledParams): Promise<void> {
    return this.notification('ui/notifications/tool-cancelled', params);
  }

  sendSandboxResourceReady(params: SandboxReadyParams): Promise<void> {
    return this.notification('ui/notifications/sandbox-resource-ready', params);
  }

  teardownResource(params: Record<string, never>): Promise<Record<string, unknown>> {
    return this.request('ui/resource-teardown', params) as Promise<Record<string, unknown>>;
  }

  sendResourceTeardown = this.teardownResource.bind(this);

  sendToolListChanged(params: Record<string, unknown> = {}): Promise<void> {
    return this.notification('notifications/tools/list_changed', params);
  }

  sendResourceListChanged(params: Record<string, unknown> = {}): Promise<void> {
    return this.notification('notifications/resources/list_changed', params);
  }

  sendPromptListChanged(params: Record<string, unknown> = {}): Promise<void> {
    return this.notification('notifications/prompts/list_changed', params);
  }

  async connect(transport: PostMessageTransport): Promise<void> {
    if (this.transport) {
      throw new Error('AppBridge is already connected. Call close() before connecting again.');
    }

    this.transport = transport;
    this.transport.onmessage = (message, extra) => {
      void this.handleIncomingMessage(message, extra?.sessionId);
    };
    this.transport.onclose = () => {
      if (this.transport === transport) {
        this.transport = null;
      }
    };
    await this.transport.start();
  }

  private async handleIncomingMessage(message: JsonRpcMessage, sessionId?: string): Promise<void> {
    if (isJsonRpcResponseMessage(message)) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) return;
      this.pendingRequests.delete(message.id);
      if ('error' in message) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (isJsonRpcNotificationMessage(message)) {
      const handler = this.notificationHandlers.get(message.method);
      if (handler) {
        await handler(message.params as never);
      }
      return;
    }

    if (!isJsonRpcRequestMessage(message)) {
      return;
    }

    const requestMessage: JsonRpcRequestMessage = message;

    const extra: RequestExtra = {
      signal: new AbortController().signal,
      sessionId,
    };

    try {
      const result = await this.handleRequest(requestMessage, extra);
      await this.sendSuccess(requestMessage.id, result);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await this.sendError(requestMessage.id, -32000, messageText);
    }
  }

  private async handleRequest(
    message: JsonRpcRequestMessage,
    extra: RequestExtra,
  ): Promise<unknown> {
    if (message.method === 'ui/initialize') {
      return this.handleInitialize(message.params);
    }

    if (message.method === 'ping') {
      this.onping?.((message.params as Record<string, never> | undefined) ?? {}, extra);
      return {};
    }

    if (message.method === 'ui/request-display-mode' && !this.requestHandlers.has(message.method)) {
      return {
        mode: asDisplayMode(this.hostContext.displayMode),
      } satisfies RequestDisplayModeResult;
    }

    const handler = this.requestHandlers.get(message.method);
    if (!handler) {
      throw new Error(`Unsupported ext-app method: ${message.method}`);
    }

    return handler(message.params as never, extra);
  }

  private handleInitialize(params: unknown): InitializeResult {
    const safeParams = isRecord(params) ? (params as InitializeParams) : {};
    const requestedVersion =
      typeof safeParams.protocolVersion === 'string' ? safeParams.protocolVersion : LATEST_PROTOCOL_VERSION;
    this.appCapabilities = safeParams.appCapabilities;
    this.appInfo = safeParams.appInfo;
    this.transport?.setProtocolVersion?.(requestedVersion);

    return {
      protocolVersion: requestedVersion,
      hostCapabilities: this.capabilities,
      hostInfo: this.hostInfo,
      hostContext: this.hostContext,
    };
  }

  private async sendSuccess(id: JsonRpcId, result: unknown): Promise<void> {
    if (!this.transport) return;
    await this.transport.send({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  private async sendError(id: JsonRpcId, code: number, message: string, data?: unknown): Promise<void> {
    if (!this.transport) return;
    await this.transport.send({
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        data,
      },
    });
  }

  private async notification(method: string, params: unknown): Promise<void> {
    if (!this.transport) {
      throw new Error('AppBridge is not connected');
    }
    await this.transport.send({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (!this.transport) {
      throw new Error('AppBridge is not connected');
    }
    const id = this.nextRequestId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
    await this.transport.send({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
    return promise;
  }
}
