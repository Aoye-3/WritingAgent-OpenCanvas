import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.PORT ?? "8837";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: [
        "**/.git/**",
        "**/.facetwrite/**",
        "**/.docker-codex/**",
        "**/modules/agent-runtime/backend/.venv/**",
        "**/modules/agent-runtime/backend/.uv-cache/**",
        "**/modules/agent-runtime/backend/.pytest_cache/**",
        "**/modules/agent-runtime/frontend/node_modules/**"
      ]
    },
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  }
});
