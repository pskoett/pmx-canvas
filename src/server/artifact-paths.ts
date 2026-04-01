import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function getWorkspaceRoot(cwd?: string): string {
  return resolve(cwd ?? process.cwd());
}

export function getArtifactsDir(cwd?: string): string {
  return join(getWorkspaceRoot(cwd), 'artifacts');
}

export function ensureArtifactsDir(cwd?: string): string {
  const dir = getArtifactsDir(cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}
