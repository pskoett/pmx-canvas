/** @jsxImportSource react */

/**
 * json-render iframe renderer entry point.
 *
 * Runs inside a pmx-canvas iframe and reads the normalized json-render spec
 * from an inline global injected by the server-side viewer route.
 */

import type { Spec } from '@json-render/core';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { defineRegistry, JSONUIProvider, Renderer, useStateBinding } from '@json-render/react';
import { shadcnComponents } from '@json-render/shadcn';
import { catalog } from '../catalog';
import { chartComponents } from '../charts/components';
import { extraChartComponents } from '../charts/extra-components';
import { tufteChartComponents } from '../charts/tufte-components';
import { pmxCanvasDirectives } from '../directives';
import { JsonRenderDevtools } from '@json-render/devtools-react';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'info' | 'warning' | 'error' | 'danger';
type BadgeProps = {
  text: string;
  variant?: BadgeVariant | null;
  className?: string | null;
};

function Badge({ props }: { props: BadgeProps }) {
  const variant = props.variant;
  const resolvedVariant = variant ?? 'default';
  return (
    <span
      data-slot="badge"
      data-variant={resolvedVariant}
      className={`pmx-badge pmx-badge--${resolvedVariant}`}
    >
      {props.text}
    </span>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'danger' | 'outline' | 'ghost' | 'success';
type ButtonProps = {
  label: string;
  variant?: ButtonVariant | null;
  disabled?: boolean | null;
};

function Button({ props, emit }: { props: ButtonProps; emit: (event: string) => void }) {
  const resolvedVariant = props.variant ?? 'primary';
  return (
    <button
      type="button"
      data-slot="button"
      data-variant={resolvedVariant}
      className={`pmx-button pmx-button--${resolvedVariant}`}
      disabled={props.disabled ?? false}
      onClick={() => emit('press')}
    >
      {props.label}
    </button>
  );
}

const { registry } = defineRegistry(catalog as never, {
  components: {
    ...shadcnComponents,
    Badge,
    Button,
    ...chartComponents,
    ...extraChartComponents,
    ...tufteChartComponents,
  } as never,
});

declare global {
  interface Window {
    __PMX_CANVAS_JSON_RENDER_SPEC__?: Spec & { state?: Record<string, unknown> };
    __PMX_CANVAS_JSON_RENDER_THEME__?: string;
    __PMX_CANVAS_JSON_RENDER_DISPLAY__?: string;
    __PMX_CANVAS_JSON_RENDER_DEVTOOLS__?: boolean;
    __PMX_CANVAS_JSON_RENDER_NODE_ID__?: string;
    __PMX_CANVAS_AX_TOKEN__?: string;
    __PMX_CANVAS_AX_STATE__?: unknown;
  }
}

// Read-side AX bridge for json-render: keeps the spec-bound `/ax` state live as
// the parent canvas pushes nonce-validated `ax-update` messages, so a declarative
// board ({ "$state": "/ax/workItems" }) reflects the work queue in real time.
function AxStateSync() {
  const [, setAx] = useStateBinding<unknown>('ax');
  useEffect(() => {
    const token = window.__PMX_CANVAS_AX_TOKEN__;
    if (!token) return undefined;
    function onMessage(event: MessageEvent) {
      const m = event.data as { source?: string; type?: string; token?: string; state?: unknown } | null;
      if (!m || m.source !== 'pmx-canvas-html-node' || m.type !== 'ax-update' || m.token !== token) return;
      window.__PMX_CANVAS_AX_STATE__ = m.state;
      setAx(m.state);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [setAx]);
  return null;
}

// AX interaction types a json-render spec can bind actions to. When an action
// named like one of these fires, we forward it to the parent canvas (which
// validates + submits through the capability-gated endpoint). Convention-based
// opt-in: spec authors name the action handler after the AX interaction type.
const AX_INTERACTION_HANDLER_NAMES = [
  'ax.event.record', 'ax.steer', 'ax.work.create', 'ax.work.update',
  'ax.evidence.add', 'ax.approval.request', 'ax.review.add', 'ax.focus.set',
  'ax.elicitation.request', 'ax.mode.request', 'ax.command.invoke',
] as const;

function buildAxHandlers(): Record<string, (params: Record<string, unknown>) => void> {
  const nodeId = window.__PMX_CANVAS_JSON_RENDER_NODE_ID__;
  const token = window.__PMX_CANVAS_AX_TOKEN__;
  const handlers: Record<string, (params: Record<string, unknown>) => void> = {};
  if (!nodeId || !token) return handlers;
  // Declarative json-render boards are reflect-only: a spec action is fire-and-forget
  // and confirmation arrives as a live `pmx-ax-update` (the work item appears). There
  // is no JS surface for a Promise-style ack here, so we don't stamp a correlationId.
  for (const type of AX_INTERACTION_HANDLER_NAMES) {
    handlers[type] = (params: Record<string, unknown>) => {
      window.parent.postMessage({
        source: 'pmx-canvas-ax',
        token,
        nodeId,
        interaction: { type, payload: params && typeof params === 'object' ? params : {} },
      }, '*');
    };
  }
  return handlers;
}

function syncPreferredTheme(): void {
  const forced = window.__PMX_CANVAS_JSON_RENDER_THEME__;
  if (forced) {
    applyTheme(forced);
    return;
  }
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  applyTheme(prefersDark ? 'dark' : 'light');
}

function applyTheme(theme: unknown): void {
  if (theme !== 'dark' && theme !== 'light' && theme !== 'high-contrast') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.toggle('dark', theme === 'dark' || theme === 'high-contrast');
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
}

function App() {
  const spec = window.__PMX_CANVAS_JSON_RENDER_SPEC__;

  if (!spec) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted-foreground, #666)',
          fontFamily: 'system-ui',
        }}
      >
        Waiting for UI spec...
      </div>
    );
  }

  // Seed AX state under a reserved `/ax` key so specs can bind { "$state": "/ax/workItems" }.
  const axState = window.__PMX_CANVAS_AX_STATE__;
  const initialState = axState !== undefined && axState !== null
    ? { ...(spec.state ?? {}), ax: axState }
    : spec.state ?? undefined;

  // Standalone "Open as site" tab (#65): fill the browser viewport instead of the
  // in-canvas card height. The chart child flex-grows; useChartFrameHeight measures
  // the full viewport in this mode. Embedded/expanded keep the padded min-height box.
  const isSite = window.__PMX_CANVAS_JSON_RENDER_DISPLAY__ === 'site';
  const containerStyle = isSite
    ? { display: 'flex', flexDirection: 'column' as const, height: '100dvh', minHeight: '100dvh', padding: 0, boxSizing: 'border-box' as const }
    : { minHeight: '100vh', padding: 16, boxSizing: 'border-box' as const };
  return (
    <div style={containerStyle}>
      <JSONUIProvider
        registry={registry}
        initialState={initialState}
        directives={pmxCanvasDirectives}
        handlers={buildAxHandlers()}
      >
        <AxStateSync />
        <div style={isSite ? { flex: 1, minHeight: 0 } : undefined}>
          <Renderer spec={spec} registry={registry} loading={false} />
        </div>
        {window.__PMX_CANVAS_JSON_RENDER_DEVTOOLS__ ? (
          <JsonRenderDevtools position="right" />
        ) : null}
      </JSONUIProvider>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  syncPreferredTheme();
  createRoot(root).render(<App />);
}
