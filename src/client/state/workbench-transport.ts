/** The normal workbench uses HTTP; an MCP App installs its host transport before mounting. */
type WorkbenchFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let hostFetch: WorkbenchFetch | undefined;

export function installWorkbenchTransport(transport: WorkbenchFetch): void {
  hostFetch = transport;
}

export function isHostedWorkbench(): boolean {
  return hostFetch !== undefined;
}

export const workbenchFetch: WorkbenchFetch = (input, init) =>
  hostFetch ? hostFetch(input, init) : globalThis.fetch(input, init);
