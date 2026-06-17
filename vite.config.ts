import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
    electron([
      {
        // Main process entry file
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: [
                "electron",
                "electron-updater",
                "ws",
                "bufferutil",
                "utf-8-validate",
                "@lancedb/lancedb",
                /^@lancedb\/lancedb-.*/,
              ],
            },
          },
        },
      },
      {
        // Preload scripts - use plain JS to avoid ESM issues
        entry: "electron/preload.js",
        onstart(options) {
          // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete
          options.reload();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
              output: {
                format: "cjs",
              },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: "dist",
  },
});
