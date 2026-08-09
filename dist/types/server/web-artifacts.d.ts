export interface WebArtifactBuildInput {
    title: string;
    appTsx: string;
    indexCss?: string;
    mainTsx?: string;
    indexHtml?: string;
    files?: Record<string, string>;
    projectPath?: string;
    outputPath?: string;
    initScriptPath?: string;
    bundleScriptPath?: string;
    deps?: string[];
    timeoutMs?: number;
}
export interface WebArtifactBuildOutput {
    filePath: string;
    fileSize: number;
    projectPath: string;
    metadata: Record<string, unknown>;
    sourceContext: WebArtifactSourceContext;
    logs?: {
        stdout?: WebArtifactLogSummary;
        stderr?: WebArtifactLogSummary;
    };
    stdout?: string;
    stderr?: string;
}
export interface WebArtifactLogSummary {
    lineCount: number;
    excerpt: string[];
    truncated: boolean;
    suppressedNoiseCount: number;
}
export interface WebArtifactSourceContext {
    content: string;
    sourceFiles: string[];
    sourceFileCount: number;
    sourcePreview: string;
    deps?: string[];
}
export interface WebArtifactCanvasOpenResult {
    nodeId: string;
    url: string;
}
export interface WebArtifactCanvasBuildResult extends WebArtifactBuildOutput {
    openedInCanvas: boolean;
    nodeId?: string;
    url?: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    timeoutMs: number;
}
export declare function resolveWorkspacePath(pathLike: string, cwd?: string): string;
export declare function resolveWebArtifactScriptPath(kind: 'init' | 'bundle'): string;
export type NodeVersionCheck = {
    ok: true;
} | {
    ok: false;
    message: string;
};
/**
 * Pure preflight comparison used before any package-manager invocation.
 * `detected` is raw `node --version` output ("v20.11.1"), or null when no node
 * executable answered; `required` is a `major.minor` floor; `packageManager` is
 * the pin that imposes it (e.g. "pnpm@11.1.2"). Returns an actionable message
 * instead of throwing so every caller surfaces it on its own error channel.
 */
export declare function checkWebArtifactNodeVersion(detected: string | null, required: string, packageManager: string): NodeVersionCheck;
export declare function executeWebArtifactBuild(input: WebArtifactBuildInput): Promise<WebArtifactBuildOutput>;
export declare function openWebArtifactInCanvas(input: {
    title: string;
    filePath: string;
    fileSize?: number;
    projectPath?: string;
    content?: string;
    sourceFiles?: string[];
    sourceFileCount?: number;
    sourcePreview?: string;
    deps?: string[];
}): WebArtifactCanvasOpenResult;
export declare function buildWebArtifactOnCanvas(input: WebArtifactBuildInput & {
    openInCanvas?: boolean;
}): Promise<WebArtifactCanvasBuildResult>;
