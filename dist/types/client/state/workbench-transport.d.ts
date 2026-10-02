/** The normal workbench uses HTTP; an MCP App installs its host transport before mounting. */
type WorkbenchFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export declare function installWorkbenchTransport(transport: WorkbenchFetch): void;
export declare function isHostedWorkbench(): boolean;
export declare const workbenchFetch: WorkbenchFetch;
export {};
