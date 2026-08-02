// Runs after `vite build` (sequentially, via `pnpm build`'s `&&` chain — not a Rollup
// closeBundle hook, which fires plugins in parallel and could race vite-plugin-dts's own
// emission). Three jobs:
//
//   1. Copy src/styles.css to dist/styles.css, byte-identical, unprocessed — mirrors
//      sonner's own `cp src/styles.css dist/styles.css` build step (see styles-spec.md §1
//      and ARCHITECTURE.md D9). This is what the "./dist/styles.css" export subpath serves.
//   2. Mirror the emitted dist/index.d.ts as dist/index.d.mts so the "import" condition's
//      `types` field (./dist/index.d.mts) resolves to real content, not a 404.
//   3. Mirror dist/index.d.ts as dist/index.d.cts for the "require" condition. Because
//      package.json sets `"type": "module"`, a plain `.d.ts` file is ESM-shaped by default —
//      pointing the require condition's `types` at it makes the CJS build (dist/index.cjs)
//      "masquerade" as ESM types (arethetypeswrong FalseESM). The `.d.cts` extension is
//      unambiguously CommonJS regardless of the package's `"type"` field.
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');

const srcCss = resolve(root, 'src/styles.css');
const distCss = resolve(distDir, 'styles.css');
copyFileSync(srcCss, distCss);
console.log('[postbuild] copied src/styles.css -> dist/styles.css');

const dtsPath = resolve(distDir, 'index.d.ts');
const dmtsPath = resolve(distDir, 'index.d.mts');
const dctsPath = resolve(distDir, 'index.d.cts');
if (existsSync(dtsPath)) {
  copyFileSync(dtsPath, dmtsPath);
  console.log('[postbuild] mirrored dist/index.d.ts -> dist/index.d.mts');
  copyFileSync(dtsPath, dctsPath);
  console.log('[postbuild] mirrored dist/index.d.ts -> dist/index.d.cts');
} else {
  console.warn('[postbuild] dist/index.d.ts not found — skipping .d.mts/.d.cts mirror');
  process.exitCode = 1;
}
