import { type ViewerSource } from './ViewerFrame';
/**
 * Attributes for a surface iframe, honoring the boot-wide iframe mode
 * (state/iframe-mode.ts): `src` by default, fetch() + `srcdoc` when src-URL
 * iframes are blocked by the embedding context (nested-iframe hosts like Amp
 * orb portals). Cross-origin URLs always stay `src` — they cannot be fetched
 * from here. While the probe is pending, same-origin frames stay empty rather
 * than loading a src that may show the broken placeholder. Preparation failures
 * use the shared host's Retry, never a second load path the embed probe rejected.
 */
export declare function useSurfaceFrame(url: string): ViewerSource;
