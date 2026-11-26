# Build Mode for Claude

One-click switch from a Claude chat into a local Claude Code build session —
same page, same conversation context, your own plan. No handoff doc, no
copy-paste, no API credits.

## What it does

- Injects a **⚡ Start building** button into any `claude.ai/chat/*` page
- Pulls the real transcript via claude.ai's own internal API (your session
  cookie never leaves the browser)
- Spawns `claude` headless (`stream-json` in/out) in a project folder you pick,
  signed in as *you* — usage counts against your Claude plan, not API credits
- Streams agent progress (text, tool calls, file edits, cost) into a panel
  docked on the same page; permission prompts are answered there
- You keep chatting while it builds; steer the agent from the panel input

## Architecture

```
packages/extension/   Chrome MV3 (WXT + TS): button, modal, panel, WS relay
packages/bridge/      Node daemon: spawns claude, relays events, permission MCP
packages/shared/      Wire protocol + claude.ai API / stream-json types
```

Extension ⇄ bridge over `ws://127.0.0.1:17819` (token in
`~/.config/claude-build-mode/bridge.json`, created on first run).
Tool-permission prompts reach the UI through an MCP server the bridge exposes
to claude via `--permission-prompt-tool`.

## Dev setup

1. `npm install`
2. Start the bridge: `npm run bridge` (creates `~/.config/claude-build-mode/bridge.json`)
3. Build the extension: `npm run ext:build`
4. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
   `packages/extension/dist/chrome-mv3`
5. Open a chat on claude.ai → click **⚡ Start building** → paste the bridge
   token (first time only) → pick a project folder → go

Requires `claude` CLI installed and logged in with your claude.ai account.

## Limitations

- Agent output renders in our panel, not as native claude.ai messages
  (phase 2 adds status write-back into the real chat)
- Uses claude.ai's undocumented internal API — behind an adapter with a DOM
  fallback, but it can drift
- Localhost WebSocket transport for dev; native messaging host is the
  production path (todo)
