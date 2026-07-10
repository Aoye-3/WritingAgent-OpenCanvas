import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.PORT ?? "8837";
const clientPort = Number(process.env.VITE_PORT ?? "3000");
const allowedHosts = [
  ".trycloudflare.com",
  ...readCsvEnv("VITE_ALLOWED_HOSTS")
];

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: "index.html"
      }
    }
  },
  server: {
    port: clientPort,
    strictPort: true,
    allowedHosts,
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

function readCsvEnv(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
