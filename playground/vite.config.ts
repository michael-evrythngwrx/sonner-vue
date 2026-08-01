import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// `import.meta.dirname` is typed `string | undefined` without @types/node's ImportMeta
// augmentation in scope — use the portable fileURLToPath idiom instead.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Private dev/e2e playground app — replicates sonner's test app DOM contract (see
// test-contract.md). Aliases the `sonner-vue` package to the library's own source entry so the
// playground always exercises the current source, not a stale build artifact.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      'sonner-vue': resolve(__dirname, '../src/index.ts'),
    },
    dedupe: ['vue'],
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
