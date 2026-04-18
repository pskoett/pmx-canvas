export type McpAppHostCapabilityState = 'supported' | 'unsupported' | 'degraded';
export interface McpAppHostCapability {
    serverName: string;
    state: McpAppHostCapabilityState;
    reasonCode: string;
    runtimeReady: boolean;
    serverSupportsHost: boolean;
    updatedAt: string;
}
export type McpAppHostSessionState = 'active' | 'background' | 'closed';
export interface McpAppHostSession {
    sessionId: string;
    sourceServer: string | null;
    sourceTool: string;
    url: string;
    inferredType: string;
    trustedDomain: boolean;
    state: McpAppHostSessionState;
    createdAt: string;
    lastSeenAt: string;
    fallbackReason: string | null;
    lastExternalOpenAt: string | null;
}
export interface McpAppHostSnapshot {
    runtimeEnabled: boolean;
    activeSessionId: string | null;
    sessions: McpAppHostSession[];
    capabilities: McpAppHostCapability[];
    metrics: {
        hostedOpens: number;
        fallbackTotal: number;
        fallbackByReason: Record<string, number>;
    };
}
export interface McpAppCandidateInput {
    sourceServer: string | null;
    sourceTool: string;
    url: string;
    inferredType: string;
    keyHint: string;
}
export interface McpAppHostRoutingResult {
    mode: 'hosted' | 'fallback';
    reasonCode: string;
    trustedDomain: boolean;
    capability: McpAppHostCapability;
    session: McpAppHostSession | null;
}
export declare function isTrustedMcpAppDomain(url: string): boolean;
export declare function registerMcpAppHostCapability(input: {
    serverName: string;
    state: McpAppHostCapabilityState;
    reasonCode: string;
    runtimeReady: boolean;
    serverSupportsHost: boolean;
}): McpAppHostCapability;
export declare function preRegisterKnownMcpAppHostCapabilities(serverNames: string[]): void;
export declare function routeMcpAppCandidateToHost(input: McpAppCandidateInput): McpAppHostRoutingResult;
export declare function focusMcpAppHostSession(sessionId: string): McpAppHostSession | null;
export declare function closeMcpAppHostSession(sessionId: string): McpAppHostSession | null;
export declare function markMcpAppHostSessionOpenedExternally(sessionId: string): McpAppHostSession | null;
export declare function listMcpAppHostSessions(options?: {
    includeClosed?: boolean;
}): McpAppHostSession[];
export declare function getMcpAppHostSnapshot(): McpAppHostSnapshot;
