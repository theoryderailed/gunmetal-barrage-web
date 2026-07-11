import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: ".",
  resolve: {
    alias: {
      "@gunmetal-barrage/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:2567",
        changeOrigin: true,
      },
      "/colyseus": {
        target: "http://localhost:2567",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
