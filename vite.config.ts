import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: { overlay: false },
    proxy: {
      "/api/anthropic": {
        target: "https://api.anthropic.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/anthropic/, ""),
        headers: { "anthropic-version": "2023-06-01" },
      },
      "/api/elevenlabs": {
        target: "https://api.elevenlabs.io",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/elevenlabs/, ""),
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
