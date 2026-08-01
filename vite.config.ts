import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

// `import.meta.dirname` is typed `string | undefined` without @types/node's ImportMeta
// augmentation in scope (varies by workspace package) — use the portable fileURLToPath idiom
// instead so this config type-checks the same everywhere.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Library build config (Vite lib mode).
// Outputs: dist/index.mjs, dist/index.cjs, dist/index.d.ts (+ mirrored .d.mts via
// scripts/postbuild.mjs), dist/styles.css (verbatim copy, also via postbuild.mjs).
export default defineConfig({
  plugins: [
    vue(),
    dts({
      entryRoot: 'src',
      tsconfigPath: resolve(__dirname, 'tsconfig.json'),
      outDir: 'dist',
      // We hand-roll the .d.mts mirror + styles.css copy in scripts/postbuild.mjs
      // (sequential, outside Rollup's parallel closeBundle hook) — see D9/D10 in
      // ARCHITECTURE.md and styles-spec.md §1 for why this must be a real byte copy.
      insertTypesEntry: false,
      rollupTypes: false,
    }),
    // D10: CSS DX parity with sonner — importing the package alone injects styles.
    // injectCodeFunction is guarded by `typeof document !== 'undefined'` so that
    // `import('dist/index.mjs')` in bare Node (no DOM) never throws (AC-T1).
    cssInjectedByJsPlugin({
      // Must be a real `function` expression (not ES2015 method-shorthand) — the plugin
      // stringifies this via Function.prototype.toString() and inlines it verbatim into the
      // bundle; shorthand method syntax stringifies without the `function` keyword, which the
      // plugin's own wrapping template can't parse.
      injectCodeFunction: function injectCodeCustomRunTimeFunction(cssCode) {
        try {
          if (typeof document !== 'undefined') {
            var elementStyle = document.createElement('style');
            elementStyle.appendChild(document.createTextNode(cssCode));
            document.head.appendChild(elementStyle);
          }
        } catch (e) {
          console.error('vite-plugin-css-injected-by-js', e);
        }
      },
    }),
  ],
  build: {
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.mjs' : 'index.cjs'),
    },
    rollupOptions: {
      external: ['vue'],
    },
  },
});
