import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: [
        "**/.git/**",
        "**/.facetwrite/**",
        "**/.docker-codex/**",
        "**/Deerflow/backend/.venv/**",
        "**/Deerflow/backend/.uv-cache/**",
        "**/Deerflow/backend/.pytest_cache/**",
        "**/Deerflow/frontend/node_modules/**"
      ]
    },
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
