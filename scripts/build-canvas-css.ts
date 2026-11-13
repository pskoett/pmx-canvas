import { readFileSync } from 'node:fs';

// Contiguous sections of the workbench stylesheet, in cascade order. Do not sort:
// later Home/context/lifecycle rules deliberately override earlier declarations.
const sources = [
  'global.css',
  'node-cards.css',
  'shell-session.css',
  'canvas-controls.css',
  'intent-ghosts.css',
  'home.css',
  'context-chip.css',
  'home-map-graph.css',
  'lifecycle.css',
];

export function readCanvasCss(): string {
  return sources.map((file) => readFileSync(new URL(`../src/client/theme/${file}`, import.meta.url), 'utf8')).join('');
}

if (import.meta.main) await Bun.write(new URL('../dist/canvas/global.css', import.meta.url), readCanvasCss());
