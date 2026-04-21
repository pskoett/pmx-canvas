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
    timeoutMs?: number;
}
export interface WebArtifactBuildOutput {
    filePath: string;
    fileSize: number;
    projectPath: string;
    metadata: Record<string, unknown>;
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
export interface WebArtifactCanvasOpenResult {
    nodeId: string;
    url: string;
}
export interface WebArtifactCanvasBuildResult extends WebArtifactBuildOutput {
    openedInCanvas: boolean;
    nodeId?: string;
    url?: string;
}
export declare function resolveWorkspacePath(pathLike: string, cwd?: string): string;
export declare function resolveWebArtifactScriptPath(kind: 'init' | 'bundle'): string;
export declare function executeWebArtifactBuild(input: WebArtifactBuildInput): Promise<WebArtifactBuildOutput>;
export declare function openWebArtifactInCanvas(input: {
    title: string;
    filePath: string;
}): WebArtifactCanvasOpenResult;
export declare function buildWebArtifactOnCanvas(input: WebArtifactBuildInput & {
    openInCanvas?: boolean;
}): Promise<WebArtifactCanvasBuildResult>;
