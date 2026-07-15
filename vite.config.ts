import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import electron from "vite-plugin-electron";

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
              external: ["electron", "electron-updater"],
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
  ],
  build: {
    outDir: "dist",
    // 구형 WebKit(회사 모바일앱 인앱 웹뷰 등) 호환을 위해 빌드 타깃을 낮춤
    target: ["es2019", "safari13"],
  },
});
