/** @jsxImportSource react */

/**
 * json-render iframe renderer entry point.
 *
 * Runs inside a pmx-canvas iframe and reads the normalized json-render spec
 * from an inline global injected by the server-side viewer route.
 */

import { createStateStore, type Spec, type StateStore } from '@json-render/core';
import {
  AX_SURFACE_EMIT_SOURCE,
  HTML_SURFACE_PUSH_SOURCE,
  JSON_VIEWER_STATE_SOURCE,
} from '../../shared/ax-surface-protocol.js';
import { createRoot } from 'react-dom/client';
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react';
import { shadcnComponents } from '@json-render/shadcn';
import { catalog } from '../catalog';
import { chartComponents } from '../charts/components';
import { extraChartComponents } from '../charts/extra-components';
import { tufteChartComponents } from '../charts/tufte-components';
import { pmxCanvasDirectives } from '../directives';
import { JsonRenderDevtools } from '@json-render/devtools-react';

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'info'
  | 'warning'
  | 'error'
  | 'danger';
type BadgeProps = {
  text: string;
  variant?: BadgeVariant | null;
  className?: string | null;
};

function Badge({ props }: { props: BadgeProps }) {
  const variant = props.variant;
  const resolvedVariant = variant ?? 'default';
  return (
    <span data-slot="badge" data-variant={resolvedVariant} className={`pmx-badge pmx-badge--${resolvedVariant}`}>
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

function Card({ props, children, slots, ...rest }: Parameters<typeof shadcnComponents.Card>[0]) {
  const header = slots?.header;
  const footer = slots?.footer;
  return (
    <shadcnComponents.Card {...rest} props={header ? { ...props, title: null, description: null } : props}>
      {header && <header data-pmx-card-slot="header">{header}</header>}
      {children}
      {footer && (
        <footer data-pmx-card-slot="footer" className="flex flex-wrap items-center gap-3">
          {footer}
        </footer>
      )}
    </shadcnComponents.Card>
  );
}

const { registry } = defineRegistry(catalog as never, {
  components: {
    ...shadcnComponents,
    Card,
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
    __PMX_CANVAS_UI_STATE_TOKEN__?: string;
  }
}

// AX interaction types a json-render spec can bind actions to. When an action
// named like one of these fires, we forward it to the parent canvas (which
// validates + submits through the capability-gated endpoint). Convention-based
// opt-in: spec authors name the action handler after the AX interaction type.
const AX_INTERACTION_HANDLER_NAMES = [
  'ax.event.record',
  'ax.steer',
  'ax.work.create',
  'ax.work.update',
  'ax.evidence.add',
  'ax.approval.request',
  'ax.review.add',
  'ax.focus.set',
  'ax.elicitation.request',
  'ax.mode.request',
  'ax.command.invoke',
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
      window.parent.postMessage(
        {
          source: AX_SURFACE_EMIT_SOURCE,
          token,
          nodeId,
          interaction: { type, payload: params && typeof params === 'object' ? params : {} },
        },
        '*',
      );
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

function App({ store }: { store: StateStore }) {
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

  // Standalone "Open as site" tab (#65): fill the browser viewport instead of the
  // in-canvas card height. The chart child flex-grows; useChartFrameHeight measures
  // the full viewport in this mode. Embedded/expanded keep the padded min-height box.
  const isSite = window.__PMX_CANVAS_JSON_RENDER_DISPLAY__ === 'site';
  const containerStyle = isSite
    ? {
        display: 'flex',
        flexDirection: 'column' as const,
        height: '100dvh',
        minHeight: '100dvh',
        padding: 0,
        boxSizing: 'border-box' as const,
      }
    : { minHeight: '100vh', padding: 16, boxSizing: 'border-box' as const };
  return (
    <div style={containerStyle}>
      <JSONUIProvider registry={registry} store={store} directives={pmxCanvasDirectives} handlers={buildAxHandlers()}>
        <div style={isSite ? { flex: 1, minHeight: 0 } : undefined}>
          <Renderer spec={spec} registry={registry} loading={false} />
        </div>
        {window.__PMX_CANVAS_JSON_RENDER_DEVTOOLS__ ? <JsonRenderDevtools position="right" /> : null}
      </JSONUIProvider>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  syncPreferredTheme();
  const stateToken = window.__PMX_CANVAS_UI_STATE_TOKEN__;
  let store: StateStore | undefined;
  const mount = (restored: Record<string, unknown> | null) => {
    if (store) return;
    const seed = restored ?? window.__PMX_CANVAS_JSON_RENDER_SPEC__?.state ?? {};
    const ax = window.__PMX_CANVAS_AX_STATE__;
    store = createStateStore(ax != null ? { ...seed, ax } : seed);
    if (stateToken) {
      // subscribe fires synchronously at the input/action write, not in a React
      // effect that can be lost on unmount. Never mirror the server-owned /ax.
      store.subscribe(() => {
        const { ax: _ax, ...state } = store!.getSnapshot();
        window.parent.postMessage(
          {
            source: JSON_VIEWER_STATE_SOURCE,
            type: 'snapshot',
            token: stateToken,
            nodeId: window.__PMX_CANVAS_JSON_RENDER_NODE_ID__,
            state,
          },
          '*',
        );
      });
    }
    createRoot(root).render(<App store={store} />);
  };
  // Install before document load. The parent supplies a snapshot (or null) in
  // onLoad; restore BEFORE mounting so watchers don't replay past user actions.
  // Standalone viewers have no state token and render immediately.
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const m = event.data as { source?: string; type?: string; token?: string; state?: unknown } | null;
    if (!m) return;
    if (m.source === JSON_VIEWER_STATE_SOURCE && m.type === 'restore' && stateToken && m.token === stateToken) {
      if (m.state === null || (typeof m.state === 'object' && !Array.isArray(m.state)))
        mount(m.state as Record<string, unknown> | null);
    }
    if (
      m.source === HTML_SURFACE_PUSH_SOURCE &&
      m.type === 'ax-update' &&
      window.__PMX_CANVAS_AX_TOKEN__ &&
      m.token === window.__PMX_CANVAS_AX_TOKEN__
    ) {
      window.__PMX_CANVAS_AX_STATE__ = m.state;
      store?.set('/ax', m.state);
    }
  });
  if (!stateToken) mount(null);
}
