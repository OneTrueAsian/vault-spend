import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Tauri's own variables (TAURI_ENV_DEBUG says whether this is a debug build) reach the frontend alongside the usual VITE_ ones.
  envPrefix: ["VITE_", "TAURI_ENV_"],

  // Every import of Tauri's invoke goes through src/tauriInvoke.ts, which announces successful writes (Ask the Vault retires open illustrations).
  resolve: { alias: [{ find: /^@tauri-apps\/api\/core$/, replacement: fileURLToPath(new URL("./src/tauriInvoke.ts", import.meta.url)) }] },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
