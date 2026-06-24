import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Tauri expects a fixed port and leaves the dev server output untouched.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    // 1420 (Tauri's default) is inside a Hyper-V reserved port range on this
    // machine, so we use 7420 instead.
    port: 7420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 7421 }
      : undefined,
    watch: {
      // The Rust side is rebuilt by the Tauri CLI, not Vite.
      ignored: ["**/src-tauri/**"],
    },
  },
});
