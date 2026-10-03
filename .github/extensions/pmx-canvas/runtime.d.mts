export interface RuntimeInput {
    serverUrl?: string;
    port?: number;
    autoStart?: boolean;
    allowWorkspaceMismatch?: boolean;
}

export interface RuntimeCommand {
    command: string;
    args: string[];
}

export interface ServerProbe {
    ok: boolean;
    baseUrl: string | null;
    health: { ok: boolean; workspace: string } | null;
    workspaceOk: boolean;
    error: string | null;
}

export const runtimeVersion: string;
export function canonicalWorkspace(path: string): string;
export function runtimeCommand(): RuntimeCommand;
export function preferredPort(input?: RuntimeInput): number;
export function explicitServerUrl(input?: RuntimeInput): string | null;
export function probePmxServer(
    baseUrl: string,
    workspaceRoot: string,
    input?: RuntimeInput,
    fetchImpl?: typeof fetch,
): Promise<ServerProbe>;
export function findPmxServer(
    workspaceRoot: string,
    input?: RuntimeInput,
    fetchImpl?: typeof fetch,
): Promise<ServerProbe>;
export function ensurePmxServer(
    workspaceRoot: string,
    input?: RuntimeInput,
    command?: RuntimeCommand,
): Promise<ServerProbe>;
