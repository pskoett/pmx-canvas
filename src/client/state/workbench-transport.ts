/** The normal workbench uses HTTP; an MCP App installs its host transport before mounting. */
type WorkbenchFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let hostFetch: WorkbenchFetch | undefined;

export function installWorkbenchTransport(transport: WorkbenchFetch | undefined): void {
  hostFetch = transport;
}

export function isHostedWorkbench(): boolean {
  return hostFetch !== undefined;
}

export const workbenchFetch: WorkbenchFetch = (input, init) =>
  hostFetch ? hostFetch(input, init) : globalThis.fetch(input, init);

type WorkbenchDownload = (file: { name: string; mimeType: string; text: string }) => Promise<{ isError?: boolean }>;
let hostDownload: WorkbenchDownload | undefined;

export function installWorkbenchDownload(download: WorkbenchDownload | undefined): void {
  hostDownload = download;
}

/** Export files live on PMX, not on the embedded frame's sandbox origin. */
export async function downloadWorkbenchExport(path: string): Promise<void> {
  if (!hostDownload)
    throw new Error('This host does not support downloads. The export is saved in the local PMX workspace.');
  if (!/^\/api\/canvas\/exports\/[^/?#]+$/.test(path)) throw new Error('Invalid export path.');
  const response = await workbenchFetch(path);
  if (!response.ok) throw new Error('Could not read the export. Try again.');
  const result = await hostDownload({
    name: decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)),
    mimeType: 'text/html',
    text: await response.text(),
  });
  if (result.isError) throw new Error('The download was cancelled or declined by the host.');
}
