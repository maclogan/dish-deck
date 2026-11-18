import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8080" },
  },
});
