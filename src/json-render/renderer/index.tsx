/** @jsxImportSource react */

/**
 * json-render iframe renderer entry point.
 *
 * Runs inside a pmx-canvas iframe and reads the normalized json-render spec
 * from an inline global injected by the server-side viewer route.
 */

import type { Spec } from '@json-render/core';
import { createRoot } from 'react-dom/client';
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react';
import { shadcnComponents } from '@json-render/shadcn';
import { catalog } from '../catalog';
import { chartComponents } from '../charts/components';

const { registry } = defineRegistry(catalog as never, {
  components: {
    ...shadcnComponents,
    ...chartComponents,
  } as never,
});

declare global {
  interface Window {
    __PMX_CANVAS_JSON_RENDER_SPEC__?: Spec & { state?: Record<string, unknown> };
    __PMX_CANVAS_JSON_RENDER_THEME__?: string;
  }
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

  return (
    <div style={{ minHeight: '100vh', padding: 16, boxSizing: 'border-box' }}>
      <JSONUIProvider
        registry={registry}
        initialState={spec.state ?? undefined}
      >
        <Renderer spec={spec} registry={registry} loading={false} />
      </JSONUIProvider>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  syncPreferredTheme();
  createRoot(root).render(<App />);
}
