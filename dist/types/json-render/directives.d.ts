/**
 * Custom json-render directives available in PMX Canvas specs.
 *
 * Directives let agent specs declare formatting/derivation ($format, $math,
 * $concat, $count, $truncate, $pluralize, $join) instead of pre-formatting
 * strings. Registered into the iframe renderer via <JSONUIProvider directives>.
 */
import type { DirectiveDefinition } from '@json-render/core';
/**
 * Directives enabled in the PMX Canvas viewer. `standardDirectives` covers the
 * seven stateless directives. The $t i18n directive is intentionally omitted —
 * it is a factory requiring locale config and PMX Canvas has no locale source.
 */
export declare const pmxCanvasDirectives: DirectiveDefinition[];
/**
 * True when a prop value is a render-time dynamic expression — a directive
 * (`$format`/`$math`/…) or an existing binding (`$state`/`$item`/`$bindItem`/
 * `$cond`/`$template`/`$computed`). These objects are resolved inside the
 * renderer, so the server-side validators must leave them untouched instead of
 * string-coercing them to `"[object Object]"` or rejecting them as the wrong
 * primitive type. An object whose only `$`-key is unrecognized (e.g. `$path`)
 * is NOT dynamic — the renderer has no directive to resolve it.
 */
export declare function isDynamicPropValue(value: unknown): boolean;
/**
 * Returns the offending key when a prop value looks like a dynamic expression
 * (it has `$`-prefixed keys) but none of them is a recognized binding or
 * registered directive — e.g. `{ "$path": "…" }`. Such objects pass a naive
 * "has a $-key" check yet render as `"[object Object]"` because the renderer has
 * no directive to resolve them. Returns null for plain values and for genuinely
 * dynamic expressions.
 */
export declare function findUnknownDirectiveKey(value: unknown): string | null;
