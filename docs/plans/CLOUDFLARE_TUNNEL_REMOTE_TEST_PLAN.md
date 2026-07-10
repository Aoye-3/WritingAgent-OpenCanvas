# Cloudflare Tunnel Remote Test Plan

## Summary

This plan keeps OpenCanvas local-first while exposing a remote Cloudflare entry for testing. Cloudflare serves the built Vite app from `dist` and runs a thin Worker proxy for `/api/*`. The proxy forwards API traffic to a Cloudflare Tunnel URL that points at the local FacetWrite Node API. The Python Agent Runtime stays local and continues to be reached by the Node API.

This first stage deliberately does not migrate storage to D1/R2/Vectorize, does not rewrite Express, and does not rewrite the Python Agent Runtime.

```text
Cloudflare Worker static assets
  -> dist
  -> /api/* proxy
      -> Cloudflare Tunnel HTTPS origin
          -> local FacetWrite Node API
              -> local Python Agent Runtime
              -> local .facetwrite storage
```

## Files And Configuration

| Area | File or setting | Purpose |
| --- | --- | --- |
| Worker config | `wrangler.jsonc` | Serves `dist` as SPA assets and routes `/api/*` through the Worker first. |
| Worker proxy | `cloudflare/tunnel-proxy.js` | Proxies `/api/*` to `FACETWRITE_TUNNEL_API_ORIGIN` while preserving request bodies and streaming responses. |
| Local API host | `FACETWRITE_API_HOST` | Optional API listen host; defaults to `127.0.0.1`. |
| Direct CORS fallback | `FACETWRITE_CORS_ORIGINS` | Optional comma-separated remote frontend origins when bypassing the same-origin Worker proxy. |
| Tunnel origin | `FACETWRITE_TUNNEL_API_ORIGIN` | Cloudflare Worker variable containing the HTTPS Tunnel hostname for the local Node API. |
| Local bridge | `FACETWRITE_INTERNAL_BASE_URL` | Local Agent Runtime bridge callback URL; keep pointed at the local Node API. |

Do not put provider keys, AgentBackend auth credentials, or `FACETWRITE_INTERNAL_TOOL_TOKEN` in Cloudflare public variables. Keep those in local `.env.local` or local runtime environment files.

## Setup Flow

### Fast App Shell Tunnel

Use this path when you want one command to start the local App Shell and print a temporary Cloudflare URL for testers:

```powershell
npm.cmd run cloudflare:app-shell
```

This starts the Electron App Shell, waits for the shell-managed frontend on `127.0.0.1:17776` and API on `127.0.0.1:17777`, then starts a quick Cloudflare Tunnel to the frontend. Remote requests to `/api/*` are served by Vite's dev proxy and reach the shell-managed local API. The Vite dev server allows `*.trycloudflare.com` hosts for this remote-test path.

Stop only the public remote URL with the `Stop-Process` command printed by the script. Close the OpenCanvas App Shell window to stop the shell-managed local services.

### Worker Static Assets Tunnel

1. Start the local Agent Runtime:

   ```powershell
   npm.cmd run agent-runtime:up
   ```

2. Start the local Node API, either through the normal launcher or direct service mode:

   ```powershell
   npm.cmd run dev:server
   ```

   Keep `FACETWRITE_API_HOST` unset or set it to `127.0.0.1` unless a different Tunnel origin requires another bind address.

3. Start a Cloudflare Tunnel to the local API port:

   ```powershell
   cloudflared tunnel --url http://127.0.0.1:8837
   ```

   Copy the generated HTTPS hostname and set it as `FACETWRITE_TUNNEL_API_ORIGIN` for the Worker.

4. Build the frontend:

   ```powershell
   npm.cmd run build
   ```

5. Run or deploy the Worker:

   ```powershell
   npx wrangler dev
   npx wrangler deploy
   ```

   For local Wrangler development, place non-secret Worker values in `.dev.vars`. The repository ignores `.dev.vars*`.

## Validation

Run these checks from both the local API and the Cloudflare Worker URL:

```powershell
Invoke-RestMethod http://127.0.0.1:8837/api/health
Invoke-RestMethod https://<worker-host>/api/health
Invoke-RestMethod https://<worker-host>/api/agent-runtime/status
```

Then run one real generation from the remote frontend and confirm:

- `/api/generate/stream` streams tokens or status events without buffering until completion.
- `/api/agent-runtime/status` reports `reachable:true` and `runtimeProvider:"agent-backend"`.
- ToolUse bridge calls still write to local `.facetwrite/**`.
- The Python Agent Runtime is not directly exposed through Cloudflare Tunnel.

## Security Boundary

- Expose only the local Node API through Tunnel.
- Do not expose the Python Agent Runtime port directly.
- Prefer the same-origin Worker proxy to avoid broad CORS.
- If direct browser-to-Tunnel fallback is needed, set `FACETWRITE_CORS_ORIGINS` to the exact Cloudflare frontend origin.
- Treat this as a remote test path, not a public multi-user production deployment.

## Troubleshooting

- `500 tunnel_origin_required`: set `FACETWRITE_TUNNEL_API_ORIGIN` in Wrangler environment or `.dev.vars`.
- Remote health works but generation stalls: inspect whether `/api/generate/stream` is buffered or interrupted by Tunnel/Worker; test direct Tunnel access as a fallback.
- Runtime status is unreachable: verify local Agent Runtime is up and the Node API has the correct local `AGENT_BACKEND_BASE_URL`.
- Tool bridge fails: keep `FACETWRITE_INTERNAL_BASE_URL` pointed at the local Node API, not the Cloudflare Worker URL.
- Browser CORS failure: use the Worker same-origin proxy, or add the exact frontend origin to `FACETWRITE_CORS_ORIGINS`.

## Validation Run 2026-07-10

Smoke validation was run on the `Develop-Online` branch with a temporary quick Tunnel:

- Tunnel origin: `https://dolls-award-corresponding-emails.trycloudflare.com` (`trycloudflare.com`, temporary, not a named production tunnel).
- Local API: `http://127.0.0.1:8837`.
- Local Agent Runtime: dynamic launcher port `4025`, injected into the API as `AGENT_BACKEND_BASE_URL=http://127.0.0.1:4025`.
- Wrangler dev URL: `http://127.0.0.1:8787`.

Verified:

- `GET http://127.0.0.1:8787/api/health` returned `ok:true`.
- `GET http://127.0.0.1:8787/api/agent-runtime/status` returned `reachable:true`, `runtimeProvider:"agent-backend"`, and `authState:"authenticated"`.
- `GET http://127.0.0.1:8787/` returned the built `dist/index.html`.
- `POST http://127.0.0.1:8787/api/generate/stream` completed with `event: final`, no `event: error`, and included the expected smoke token.
- `POST http://127.0.0.1:8787/api/internal/agent-runtime/tool-call` with local bridge token committed a low-risk `canvas_write` node; thread state confirmed the node exists.

Notes:

- The sandboxed Playwright browser launch failed with Windows `EPERM`, so page load was validated through HTTP HTML fetch rather than browser automation.
- PowerShell POST requests can send `Expect: 100-continue`; the Worker strips that header to avoid treating an interim `100 Continue` response as final.
- The Worker also normalizes invalid upstream status values to `502` as a defensive local workerd compatibility guard.

## Rollback

Remove or ignore the Cloudflare-specific files and unset the optional environment variables:

- `wrangler.jsonc`
- `cloudflare/tunnel-proxy.js`
- `FACETWRITE_API_HOST`
- `FACETWRITE_CORS_ORIGINS`
- `FACETWRITE_TUNNEL_API_ORIGIN`

The default local app path remains unchanged when these variables are absent.
