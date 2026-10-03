/** The normal workbench uses HTTP; an MCP App installs its host transport before mounting. */
type WorkbenchFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export declare function installWorkbenchTransport(transport: WorkbenchFetch | undefined): void;
export declare function isHostedWorkbench(): boolean;
export declare const workbenchFetch: WorkbenchFetch;
type WorkbenchDownload = (file: {
    name: string;
    mimeType: string;
    text: string;
}) => Promise<{
    isError?: boolean;
}>;
export declare function installWorkbenchDownload(download: WorkbenchDownload | undefined): void;
/** Export files live on PMX, not on the embedded frame's sandbox origin. */
export declare function downloadWorkbenchExport(path: string): Promise<void>;
export {};
