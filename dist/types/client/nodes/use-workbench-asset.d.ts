/**
 * Asset bytes travel through the host, not a localhost URL in the user's browser.
 * `undefined` while a hosted read is in flight, `null` once it failed.
 */
export declare function useWorkbenchAsset(path: string): string | null | undefined;
