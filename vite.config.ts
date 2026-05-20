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
        "**/AgentBackend/backend/.venv/**",
        "**/AgentBackend/backend/.uv-cache/**",
        "**/AgentBackend/backend/.pytest_cache/**",
        "**/AgentBackend/frontend/node_modules/**"
      ]
    },
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
