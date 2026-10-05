// Copies the IBM Plex faces declared in src/client/theme/global.css into
// dist/canvas/fonts, with the OFL licence that must travel with them.
import { copyFileSync, mkdirSync } from 'node:fs';

const outDir = 'dist/canvas/fonts';
const families = [
  { pkg: '@fontsource/ibm-plex-sans', slug: 'ibm-plex-sans', weights: [400, 500, 600] },
  { pkg: '@fontsource/ibm-plex-mono', slug: 'ibm-plex-mono', weights: [400, 500] },
];

mkdirSync(outDir, { recursive: true });
for (const { pkg, slug, weights } of families) {
  for (const weight of weights) {
    for (const subset of ['latin', 'latin-ext']) {
      const file = `${slug}-${subset}-${weight}-normal.woff2`;
      copyFileSync(`node_modules/${pkg}/files/${file}`, `${outDir}/${file}`);
    }
  }
}
copyFileSync('node_modules/@fontsource/ibm-plex-sans/LICENSE', `${outDir}/OFL.txt`);
