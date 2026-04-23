import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PMX_CANVAS_DIR } from './canvas-state.js';

export function getWorkspaceRoot(cwd?: string): string {
  return resolve(cwd ?? process.cwd());
}

export function getArtifactsDir(cwd?: string): string {
  return join(getWorkspaceRoot(cwd), PMX_CANVAS_DIR, 'artifacts');
}

export function ensureArtifactsDir(cwd?: string): string {
  const dir = getArtifactsDir(cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}
