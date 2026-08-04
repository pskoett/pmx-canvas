// Must run before any module that mints per-mount nonces at import/render time.
import './uuid-polyfill';
import { render } from 'preact';
import { App } from './App';
import { resolveIframeMode } from './state/iframe-mode';

// Start the embed probe before first paint so iframe-backed nodes know whether
// src-URL iframes work in this context (Amp orb portals block them).
void resolveIframeMode();

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
