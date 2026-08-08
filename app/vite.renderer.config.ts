/**
 * Standalone Vite config for `npm run dev:renderer`.
 *
 * This serves the renderer in a plain browser, with no Electron around it —
 * `window.grove` is absent, so `data/source.ts` falls back to fixtures. That is
 * the fast loop for design work: a browser refresh instead of an Electron
 * relaunch. `electron.vite.config.ts` builds the same code for the real shell.
 */

import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  server: {
    // 127.0.0.1, not ::1, and a port outside Windows' Hyper-V reserved ranges.
    // See app/README.md — the default 4173 lives inside 4147-4246 here.
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
  },
});
