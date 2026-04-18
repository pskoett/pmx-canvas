export interface ExtAppCallIdentity {
    toolCallId?: string;
    serverName?: string;
    toolName?: string;
}
export declare function getExtAppCallKey(serverName?: string, toolName?: string): string | null;
export declare class ExtAppCallRegistry {
    private activeIds;
    private keyById;
    private idsByKey;
    register(identity: ExtAppCallIdentity): string | null;
    has(toolCallId?: string): boolean;
    resolve(identity: ExtAppCallIdentity): string | null;
    complete(identity: ExtAppCallIdentity): string | null;
    clear(): void;
}
