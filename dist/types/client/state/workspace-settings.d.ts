export declare const workspaceSettings: import("@preact/signals-core").Signal<{
    agentSessions: boolean;
    knowledgeLifecycle: boolean;
} | null>;
export declare const agentSessionsEnabled: import("@preact/signals-core").ReadonlySignal<boolean>;
export declare const knowledgeLifecycleEnabled: import("@preact/signals-core").ReadonlySignal<boolean>;
export declare function applyWorkspaceSettings(value: unknown): void;
