import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import fs from "node:fs";

const tauriDevHost = process.env.TAURI_DEV_HOST;
const clientPort = parseInt(process.env.PORT || process.env.CLIENT_PORT || "5173", 10);
const hmrPort = parseInt(process.env.HMR_PORT || "1421", 10);

const tauriConf = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "src-tauri/tauri.conf.json"), "utf-8")
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(tauriConf.version ?? "0.0.0"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    host: tauriDevHost ?? "127.0.0.1",
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: hmrPort,
        }
      : undefined,
    port: clientPort,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
