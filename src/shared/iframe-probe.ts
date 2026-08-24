/**
 * Handshake contract between /api/canvas/iframe-probe (server document) and
 * probeSrcIframes (client). The probe document posts this marker to its parent;
 * receiving it is the ONLY proof that src-URL iframes truly load — hosts that
 * block sub-frame requests (the Claude Code desktop browser) still fire `load`
 * on the error page they commit instead.
 */
export const IFRAME_PROBE_MESSAGE_SOURCE = 'pmx-canvas-iframe-probe';
