import { resolve } from 'node:path';

import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },

  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        // A sandboxed preload cannot be an ES module — Electron loads it in a
        // restricted context with no ESM loader. This is mandatory rather than
        // a preference, and it is why `app/package.json` has no `"type"`
        // field: a bare `.js` file has to mean CommonJS here.
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },

  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
