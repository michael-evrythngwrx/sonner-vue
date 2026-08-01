import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    // jsdom (with Vitest's default `pretendToBeVisual: true`) supplies `requestAnimationFrame`,
    // which `Observer.dismiss(id)` calls unguarded — per state-api-spec.md AC-S4 the stub/
    // polyfill belongs to the test harness, never to src/. test/unit/helpers.ts additionally
    // swaps in a queue-and-flush rAF stub so the deferral itself becomes observable.
    environment: 'jsdom',
    include: ['test/unit/**/*.{test,spec}.ts'],
    // Each test file gets its own module registry, so the `ToastState` singleton and the
    // module-level `toastsCounter` are per-file; `resetToastState()` (helpers.ts) handles
    // isolation within a file. `passWithNoTests` is deliberately NOT set: an empty unit suite
    // is now a failure, not a pass.
  },
});
