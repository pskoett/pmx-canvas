import { describe, expect, test } from 'bun:test';
import { isCanvasBundlePath } from '../../src/server/server.ts';

// The 0.3.1 Windows report: resolve() returns backslash paths on win32, so the
// old `distPath.startsWith(`${bundleDir}/`)` containment check rejected every
// bundle asset — /canvas/index.js and /canvas/global.css 404'd and the SPA
// showed "PMX Canvas did not finish booting". These fixtures pin the win32
// shapes the check must accept (and the traversal shapes it must still reject).
describe('canvas bundle containment (Windows path separators)', () => {
  const win32Dir = 'C:\\Users\\tega\\AppData\\Roaming\\npm\\node_modules\\pmx-canvas\\dist\\canvas';
  const posixDir = '/Users/pepe/dev/pmx-canvas/dist/canvas';

  test('accepts win32 backslash asset paths inside the bundle dir', () => {
    expect(isCanvasBundlePath(`${win32Dir}\\index.js`, win32Dir)).toBe(true);
    expect(isCanvasBundlePath(`${win32Dir}\\global.css`, win32Dir)).toBe(true);
    expect(isCanvasBundlePath(`${win32Dir}\\assets\\font.woff2`, win32Dir)).toBe(true);
  });

  test('accepts mixed-separator paths (resolve() on win32 with a forward-slash file name)', () => {
    expect(isCanvasBundlePath(`${win32Dir}\\assets/logo.svg`, win32Dir)).toBe(true);
  });

  test('accepts posix asset paths (unchanged behavior)', () => {
    expect(isCanvasBundlePath(`${posixDir}/index.js`, posixDir)).toBe(true);
    expect(isCanvasBundlePath(`${posixDir}/assets/font.woff2`, posixDir)).toBe(true);
  });

  test('rejects escapes above the bundle dir on both platforms', () => {
    expect(isCanvasBundlePath('C:\\Users\\tega\\AppData\\Roaming\\npm\\secrets.txt', win32Dir)).toBe(false);
    expect(isCanvasBundlePath('/Users/pepe/dev/pmx-canvas/dist/secrets.txt', posixDir)).toBe(false);
    // Sibling directory sharing the prefix must not pass (the trailing slash matters).
    expect(isCanvasBundlePath(`${posixDir}-evil/index.js`, posixDir)).toBe(false);
    expect(isCanvasBundlePath(`${win32Dir}-evil\\index.js`, win32Dir)).toBe(false);
  });

  test('rejects the bundle dir itself (a file, not the directory, must be requested)', () => {
    expect(isCanvasBundlePath(win32Dir, win32Dir)).toBe(false);
    expect(isCanvasBundlePath(posixDir, posixDir)).toBe(false);
  });
});
