// Must run before any module that mints per-mount nonces at import/render time.
import './uuid-polyfill';
import { render } from 'preact';
import { App } from './App';

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
