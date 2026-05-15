# FacetWrite Local Security Notes

FacetWrite is a local-first development app. Treat local provider keys as production secrets.

## API keys

- Store real keys only in `.env.local` or your shell environment.
- Never commit `.env.local`, `.env`, `API-Key.txt`, screenshots containing keys, or pasted provider examples with real tokens.
- If a key was pasted into chat, copied into docs, or stored in a tracked file, rotate it at the provider before continuing.

## Settings API

The local settings panel can write provider settings to `.env.local`. Saving a new API key requires an explicit `confirmLocalKeyWrite=true` request field so accidental writes are rejected by the API.

The API status response reports whether a key is configured, but it must never return the key value.

## Tool permissions

Agent tools are configured through the tool catalog and policy layer:

- Low-risk local context tools may run automatically when enabled.
- `canvas_write` can only create a pending write request. The user must approve the request before Canvas content changes.
- External tools such as web search must report when they are not configured.
