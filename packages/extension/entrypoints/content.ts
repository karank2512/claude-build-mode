import { defineContentScript } from "wxt/utils/define-content-script";
import type { ContentScriptDefinition } from "wxt";
import { browser } from "wxt/browser";
import type { ServerMessage } from "@cbm/shared";
import { bus, onBridgeMessage, onBridgeState, type BridgeState } from "../lib/bus";
import { currentConvId, fetchTranscript } from "../lib/claudeApi";
import { openStartModal } from "../ui/modal";
import { BuildPanel } from "../ui/panel";
import { BUTTON_CSS } from "../ui/styles";

const definition: ContentScriptDefinition = defineContentScript({
  matches: ["https://claude.ai/*"],
  runAt: "document_idle",

  main() {
    let bridgeState: BridgeState = "closed";
    let bridgeAuthed = false;
    let sessionId: string | null = null;
    let panel: BuildPanel | null = null;
    let fab: HTMLButtonElement | null = null;
    let fabHost: HTMLDivElement | null = null;

    bus();

    function setFab(label: string, building: boolean): void {
      if (!fab) return;
      fab.textContent = label;
      fab.classList.toggle("building", building);
    }

    function ensureFab(): void {
      if (fabHost) return;
      fabHost = document.createElement("div");
      const shadow = fabHost.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = BUTTON_CSS;
      shadow.appendChild(style);
      fab = document.createElement("button");
      fab.className = "cbm-fab";
      fab.textContent = "⚡ Start building";
      fab.onclick = onFabClick;
      shadow.appendChild(fab);
      document.documentElement.appendChild(fabHost);
    }

    function removeFab(): void {
      fabHost?.remove();
      fabHost = null;
      fab = null;
    }

    function ensurePanel(): BuildPanel {
      if (!panel) {
        panel = new BuildPanel({
          onSteer: (text) => {
            if (sessionId) bus().send({ type: "user_message", sessionId, text });
          },
          onPermission: (requestId, decision) => {
            if (sessionId)
              bus().send({ type: "permission_response", sessionId, requestId, decision });
          },
          onStop: () => {
            if (sessionId) bus().send({ type: "stop_session", sessionId });
          },
          onClose: () => {
            panel?.destroy();
            panel = null;
            setFab(sessionId ? "⚡ Building…" : "⚡ Start building", !!sessionId);
          },
        });
        panel.mount();
        panel.setConnected(bridgeState === "open" && bridgeAuthed);
      }
      return panel;
    }

    async function onFabClick(): Promise<void> {
      const convId = currentConvId();
      if (!convId) return;

      // Already building on this chat? Reopen the panel.
      if (sessionId) {
        ensurePanel();
        setFab("⚡ Building…", true);
        return;
      }

      const { recentDir } = await browser.storage.local.get("recentDir");
      const result = await openStartModal({
        authed: bridgeAuthed,
        defaultDir: typeof recentDir === "string" ? recentDir : "~/projects",
        onSaveToken: async (token) => {
          await browser.storage.local.set({ bridgeToken: token });
          // background reconnects on its retry timer; nudge via port reopen
        },
      });
      if (!result) return;

      const p = ensurePanel();
      p.sys("fetching transcript…");
      let transcript;
      try {
        transcript = await fetchTranscript();
      } catch (e) {
        p.error(`couldn't read this chat: ${e instanceof Error ? e.message : e}`);
        return;
      }
      p.sys(`got ${transcript.turns.length} turns (${transcript.source}) — starting agent…`);
      await browser.storage.local.set({ recentDir: result.opts.cwd });

      bus().send({
        type: "start_session",
        convId,
        cwd: result.opts.cwd,
        transcript,
        permissionProfile: result.opts.profile,
        prompt: result.opts.prompt || undefined,
      });
    }

    onBridgeState((state, authed) => {
      bridgeState = state;
      bridgeAuthed = authed;
      panel?.setConnected(state === "open" && authed);
      if (fab && state === "open" && authed && !sessionId) setFab("⚡ Start building", false);
      // After a reload we may have lost sessionId — ask the bridge for any
      // still-running session attached to this conversation.
      if (state === "open" && authed && !sessionId && currentConvId()) {
        bus().send({ type: "list_sessions" });
      }
    });

    onBridgeMessage((msg: ServerMessage) => {
      if (msg.type === "session_started" && msg.convId === currentConvId()) {
        sessionId = msg.sessionId;
        setFab("⚡ Building…", true);
      }
      if (msg.type === "session_ended" && msg.sessionId === sessionId) {
        panel?.handleMessage(msg);
        sessionId = null;
        setFab("⚡ Start building", false);
        return;
      }
      // Route session-scoped messages to the panel.
      if ("sessionId" in msg && msg.sessionId === sessionId) panel?.handleMessage(msg);
      else if (msg.type === "permission_request" && msg.request.sessionId === sessionId)
        panel?.handleMessage(msg);
      else if (msg.type === "error" && !("sessionId" in msg)) panel?.handleMessage(msg);
      else if (msg.type === "sessions") {
        if (!sessionId) {
          const conv = currentConvId();
          const live = msg.sessions.find((s) => s.convId === conv && s.running);
          if (live) {
            sessionId = live.sessionId;
            setFab("⚡ Building…", true);
          }
        }
      } else if (msg.type === "hello_ok") {
        // bridge ready
      }
    });

    // claude.ai is an SPA — poll the URL and mount/unmount the button.
    let lastConv: string | null = null;
    setInterval(() => {
      const conv = currentConvId();
      if (conv !== lastConv) {
        lastConv = conv;
        if (conv) ensureFab();
        else removeFab();
      }
    }, 800);
  },
});
export default definition;
