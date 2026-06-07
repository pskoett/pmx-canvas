/** @jsxImportSource react */
/**
 * json-render iframe renderer entry point.
 *
 * Runs inside a pmx-canvas iframe and reads the normalized json-render spec
 * from an inline global injected by the server-side viewer route.
 */
import type { Spec } from '@json-render/core';
declare global {
    interface Window {
        __PMX_CANVAS_JSON_RENDER_SPEC__?: Spec & {
            state?: Record<string, unknown>;
        };
        __PMX_CANVAS_JSON_RENDER_THEME__?: string;
        __PMX_CANVAS_JSON_RENDER_DISPLAY__?: string;
        __PMX_CANVAS_JSON_RENDER_DEVTOOLS__?: boolean;
        __PMX_CANVAS_JSON_RENDER_NODE_ID__?: string;
        __PMX_CANVAS_AX_TOKEN__?: string;
        __PMX_CANVAS_AX_STATE__?: unknown;
    }
}
