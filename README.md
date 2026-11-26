# Build Mode for Claude

**Switch a Claude chat into a build session with one click — same page, same
conversation, your own plan.**

You're halfway through a chat on claude.ai when you realize you want the thing
built, not discussed. Today that means asking for a handoff doc, copying it,
opening Claude Code, pasting, and re-explaining. Build Mode deletes that whole
transition: click **⚡ Start building** and the conversation you're already in
becomes the context for a real Claude Code session on your machine — file
edits, shell commands, tool approvals, live progress — without leaving the
page.

## How it works

```
claude.ai chat page
        │
        ▼  ⚡ Start building
┌─────────────────────────────┐
│  Chrome extension           │  pulls the real transcript via claude.ai's own
│  (content script + panel)   │  same-origin API — your session cookie never
└──────────────┬──────────────┘  leaves the browser
               │ ws://127.0.0.1:17819 (token-gated)
               ▼
┌─────────────────────────────┐
│  Local bridge (Node)        │  spawns `claude` headless in the project
│                             │  folder you picked, relays every event,
└──────────────┬──────────────┘  serves permission prompts back to the page
               │
               ▼
        claude CLI (your login → your plan quota, zero API credits)
```

- **Full transcript, not a summary** — every turn you discussed, seeded into the
  agent's first message (plus saved to a file it can re-read)
- **Approvals where you already are** — each risky tool call surfaces as a
  card in the page-side panel via Claude Code's `--permission-prompt-tool`
  MCP hook: Allow / Deny / Always
- **Steer while it works** — the panel's input drops messages straight into
  the running agent, mid-task
- **Keep chatting** — the real conversation stays fully usable while the
  build runs alongside it

## Status

Working MVP. Verified live on claude.ai: transcript → agent → Edit/Bash tool
calls with in-page approvals → done, with multi-turn steering.

## Dev setup

Requirements: Chrome, Node ≥ 20, `claude` CLI installed and logged in with
your claude.ai account (Claude Code is included in Pro/Max plans — that's the
whole "no credits" mechanism).

```bash
npm install
npm run bridge      # local daemon; creates ~/.config/claude-build-mode/bridge.json
npm run ext:build   # produces packages/extension/dist/chrome-mv3
```

Then: `chrome://extensions` → Developer mode → **Load unpacked** →
`packages/extension/dist/chrome-mv3`. Open any `claude.ai/chat/<id>` page,
click ⚡, paste the bridge token once (from `bridge.json`), pick a project
folder, go.

## Repo layout

```
packages/extension/   Chrome MV3 (WXT + TypeScript): injected button, start
                      modal, build panel, service-worker WS relay
packages/bridge/      Node daemon: claude process manager, session registry,
                      permission MCP server, WS transport
packages/shared/      Wire protocol + claude.ai API / stream-json types
```

## Security model

- Nothing leaves your machine: the chat transcript goes from the page to a
  localhost bridge; the agent runs under *your* `claude` login
- The bridge binds `127.0.0.1` only and requires a token generated on first
  run (`~/.config/claude-build-mode/bridge.json`, mode 600)
- Tool permissions default to "ask before each risky action"; there's also
  auto-accept-edits and plan-only profiles

## Known limitations

- Agent output renders in our injected panel, not as native claude.ai
  messages (write-back into the real chat is on the roadmap below)
- Uses claude.ai's undocumented internal API for transcript read — behind an
  adapter with a DOM fallback, but it can drift
- Localhost-WebSocket transport requires a running bridge + manual token;
  native messaging (below) removes that
- Chrome only, for now

## Roadmap

- [ ] Post build status back into the real conversation so chat-Claude stays
      aware of what the agent did
- [ ] Native messaging host + installer: no token paste, no manual daemon
- [ ] Diff rendering, finer-grained permission controls, resume UX
- [ ] Edge/Firefox ports, Web Store release

## License

MIT
