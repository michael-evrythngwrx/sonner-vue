import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['test/unit/**/*.{test,spec}.ts'],
    // Scaffold has no unit tests yet (Phase 3 ports them) — keep the baseline green rather than
    // failing on an empty suite.
    passWithNoTests: true,
  },
});
