import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Private dev/e2e playground app — replicates sonner's test app DOM contract (see
// test-contract.md). Aliases the `sonner-vue` package to the library's own source entry so the
// playground always exercises the current source, not a stale build artifact.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      'sonner-vue': resolve(import.meta.dirname, '../src/index.ts'),
    },
    dedupe: ['vue'],
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
