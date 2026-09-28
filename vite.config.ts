import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so dist/ works from any subpath (itch.io, GitHub Pages /<repo>/). A desktop wrapper
  // should serve dist/ over http or a custom protocol: browsers block module scripts loaded from file://.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        // Vendors in their own long-cacheable chunks; game code stays small and changes independently.
        codeSplitting: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Simulation-heavy tests (logic fuzz, level solvers, autopilot) run ~2–4 s alone and share CPU in parallel.
    testTimeout: 20_000,
  },
});
