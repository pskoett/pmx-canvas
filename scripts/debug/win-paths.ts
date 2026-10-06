import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raw = mkdtempSync(join(tmpdir(), 'pmx-dbg-'));
const root = realpathSync(raw);
const plugin = join(root, 'installed-plugin');
mkdirSync(plugin);
mkdirSync(join(plugin, '..project'));
const fromUrl = fileURLToPath(pathToFileURL(join(plugin, 'start-mcp.mjs')).href);
const pkg = realpathSync(resolve(join(fromUrl, '..')));
const out = {
  tmpdir: tmpdir(), raw, root, rootNative: realpathSync.native(raw), plugin, fromUrl, pkg, sep,
  checks: ['.', plugin, join(plugin, '..project')].map((candidate) => {
    const real = isAbsolute(candidate) ? realpathSync(resolve(candidate)) : null;
    const rel = real ? relative(pkg, real) : null;
    return { candidate, absolute: isAbsolute(candidate), real, rel };
  }),
};
console.log(JSON.stringify(out, null, 2));
