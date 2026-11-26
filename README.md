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

## Requirements

- Chrome (or a Chromium browser) on **macOS or Linux**
- Node ≥ 20
- `claude` CLI installed and signed in to your claude.ai account — the agent
  runs on **your plan quota** (Claude Code is included in Pro/Max), so usage
  costs **zero API credits** and nothing is ever billed to the extension's
  author

## Install (~5 minutes)

```bash
git clone https://github.com/karank2512/claude-build-mode
cd claude-build-mode
npm ci
npm run ext:build        # builds packages/extension/dist/chrome-mv3
```

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select `packages/extension/dist/chrome-mv3`. Copy the **extension ID** from
   the card.
2. Install the native messaging host (lets Chrome spawn the bridge itself —
   no daemon, no token):

   ```bash
   npm run install-host -w @cbm/bridge -- --ext-id <paste-extension-id>
   ```

3. **Fully quit and relaunch Chrome** — native hosts are discovered at
   startup.

## Use it

Open any `claude.ai/chat/<id>` conversation → click **⚡ Start building**
(bottom-right) → pick a project folder → optionally type a first instruction
(or leave blank — the agent reads the transcript and infers the task) → go.

- **Live progress** in a docked side panel: agent text, tool calls, diffs
- **Approvals in-page** — Allow / Deny / Always for each risky action
- **Steer mid-run** from the panel's bottom input
- **Keep chatting** — the real conversation stays usable while the build runs
- **Resume later** — clicking ⚡ on the same chat reattaches or resumes the
  existing session (survives page reloads)

## How it works

```
claude.ai chat page
        │  ⚡ Start building
        ▼
┌─────────────────────────────┐
│  Chrome extension           │  pulls the full transcript via claude.ai's own
│  (content script + panel)   │  same-origin internal API — session cookies
└──────────────┬──────────────┘  never leave the browser
               │ native messaging (Chrome spawns it; no token)
               ▼
┌─────────────────────────────┐
│  Local bridge (Node)        │  spawns `claude` headless in your chosen
│                             │  project folder, relays every stream-json
└──────────────┬──────────────┘  event, and answers permission prompts
               │
               ▼
        claude CLI → your login → your plan quota
```

Permission prompts ride Claude Code's `--permission-prompt-tool` MCP hook: the
bridge hosts an MCP `ask` tool per session, and claude calls it before any
risky action — the request lands in the panel for your decision.

## Security model

- **Nothing leaves your machine.** The transcript goes from the page to a
  localhost bridge; the agent runs under your own `claude` login.
- Native messaging transport is spawned by Chrome on-demand — stdio channel,
  no listening socket, no token. (The `ws://127.0.0.1:17819` dev fallback is
  token-gated and binds loopback only; token lives in
  `~/.config/claude-build-mode/bridge.json`, mode 600.)
- Permission profile defaults to *ask before each risky action*;
  auto-accept-edits and plan-only profiles are selectable per build.
- Transcript seed files and the session registry live under
  `~/.config/claude-build-mode/` — nothing is uploaded anywhere.

## Chat write-back (experimental)

Optionally, the extension can post a compact status update **into the real
conversation** when a build turn finishes, so chat-Claude knows what the agent
did. Enable it in the start modal.

Caveat: Anthropic is migrating chats to the "new Claude experience" (unified
backend) — those conversations reject external writes (`409`), so write-back
is silently skipped there. On unmigrated chats it posts as a normal user
message.

## Dev mode (WS fallback)

If the native host can't be installed (e.g. Windows) or you want the daemon:

```bash
npm run bridge     # local WS daemon on 127.0.0.1:17819
```

Then in the ⚡ modal's token field, paste the token from
`~/.config/claude-build-mode/bridge.json`. The extension prefers native
messaging and falls back to WS automatically.

```bash
npm run dev -w @cbm/extension   # rebuild extension on change
npm run typecheck               # both packages
```

## Repo layout

```
packages/extension/   Chrome MV3 (WXT + TypeScript): injected button, start
                      modal, build panel, service-worker relay, MAIN-world
                      request sniffer
packages/bridge/      Node bridge: claude process manager, session registry,
                      permission MCP server, native host + WS transports,
                      installer
packages/shared/      Wire protocol + claude.ai API / stream-json types
```

## Known limitations

- Agent output renders in our injected panel, not as native claude.ai
  messages — a third party cannot write tool calls into Anthropic's chat
  backend. Write-back (above) is the partial workaround.
- Transcript read uses claude.ai's undocumented internal API — behind an
  adapter with a DOM fallback, but it can drift.
- The native host lives while Chrome holds the messaging port — quitting
  Chrome fully stops a running build (it's resumable from the registry).
- Chrome-family browsers only; installer covers macOS + Linux (Windows: WS
  fallback only, for now).
- Anthropic is converging on this natively (unified Chat+Cowork, Dispatch →
  Code) — this may be redundant eventually; today the native path still can't
  reuse a chat as a build session.

## Roadmap

- [~] Chat write-back — works on unmigrated chats; skipped on the new unified
      backend
- [x] Native messaging host + installer (no token paste, no manual daemon)
- [x] Diff rendering, "Always {tool}" approvals, reattach-after-reload
- [ ] Windows native-messaging installer, Edge/Firefox ports
- [ ] Web Store release

## License

MIT
