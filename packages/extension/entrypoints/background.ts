import { defineBackground } from "wxt/utils/define-background";
import type { BackgroundDefinition } from "wxt";
import { browser } from "wxt/browser";
import type { ClientMessage, ServerMessage } from "@cbm/shared";

type PortMsg =
  | { kind: "toBridge"; msg: ClientMessage }
  | { kind: "reconnect" }
  | { kind: "getState" };

const DEFAULT_PORT = 17819;
const NATIVE_HOST = "com.cbm.bridge";

type Port = ReturnType<typeof browser.runtime.connect>;

let ws: WebSocket | null = null;
let nativePort: Port | null = null;
let transport: "native" | "ws" | null = null;
let wsState: "connecting" | "open" | "closed" = "closed";
let authed = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const ports = new Set<Port>();

async function bridgeConfig(): Promise<{ port: number; token: string }> {
  const { bridgePort, bridgeToken } = await browser.storage.local.get([
    "bridgePort",
    "bridgeToken",
  ]);
  return {
    port: typeof bridgePort === "number" ? bridgePort : DEFAULT_PORT,
    token: typeof bridgeToken === "string" ? bridgeToken : "",
  };
}

function broadcast(msg: unknown): void {
  for (const p of ports) {
    try {
      p.postMessage(msg);
    } catch {
      ports.delete(p);
    }
  }
}

function setState(state: typeof wsState): void {
  wsState = state;
  broadcast({ kind: "bridgeState", state, authed, transport });
}

function sendRaw(msg: ClientMessage): void {
  if (transport === "native" && nativePort) {
    try {
      nativePort.postMessage(msg);
    } catch {}
  } else if (transport === "ws" && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function onBridgeMessage(raw: unknown): void {
  const msg = (typeof raw === "string" ? safeParse(raw) : raw) as ServerMessage;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "hello_ok") authed = true;
  broadcast({ kind: "fromBridge", msg });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Product path: Chrome spawns the bridge itself via native messaging. */
function connectNative(): boolean {
  try {
    nativePort = browser.runtime.connectNative(NATIVE_HOST);
  } catch {
    return false;
  }
  transport = "native";
  nativePort.onMessage.addListener(onBridgeMessage);
  nativePort.onDisconnect.addListener(() => {
    // Missing host lands here with "Specified native messaging host not found"
    nativePort = null;
    if (transport === "native") {
      transport = null;
      authed = false;
      setState("closed");
      void connectWs();
    }
  });
  setState("open");
  sendRaw({ type: "hello", token: "native", version: browser.runtime.getManifest().version });
  return true;
}

/** Dev path: manually started WS daemon, token-gated. */
async function connectWs(): Promise<void> {
  const { port, token } = await bridgeConfig();
  if (!token) {
    setState("closed");
    return;
  }
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  } catch {
    scheduleReconnect();
    return;
  }
  transport = "ws";
  setState("connecting");
  ws.onopen = () => {
    setState("open");
    sendRaw({ type: "hello", token, version: browser.runtime.getManifest().version });
  };
  ws.onmessage = (ev) => onBridgeMessage(String(ev.data));
  ws.onclose = () => {
    authed = false;
    transport = null;
    setState("closed");
    scheduleReconnect();
  };
  ws.onerror = () => ws?.close();
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!connectNative()) void connectWs();
  }, 3000);
}

const definition: BackgroundDefinition = defineBackground(() => {
  if (!connectNative()) void connectWs();

  // Keep the transport alive while MV3 would otherwise suspend the worker.
  browser.alarms.create("cbm-keepalive", { periodInMinutes: 0.45 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name !== "cbm-keepalive") return;
    if (authed) sendRaw({ type: "ping" });
    else if (wsState === "closed") {
      if (!connectNative()) void connectWs();
    }
  });

  // Sniffer → storage: ring of recent /api/ POST shapes; postChatMessage
  // picks the one that looks like a chat-send.
  browser.runtime.onMessage.addListener((raw: unknown) => {
    const m = raw as { kind?: string; url?: string; body?: unknown };
    if (m?.kind !== "captureCompletion" || typeof m.url !== "string" || !m.body) return;
    void (async () => {
      const { capturedApiPosts } = await browser.storage.local.get("capturedApiPosts");
      const posts = Array.isArray(capturedApiPosts) ? capturedApiPosts : [];
      posts.push({ url: m.url, body: m.body, capturedAt: Date.now() });
      await browser.storage.local.set({ capturedApiPosts: posts.slice(-8) });
    })();
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "cbm") return;
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener((raw: PortMsg) => {
      if (raw.kind === "toBridge" && authed) {
        sendRaw(raw.msg);
      } else if (raw.kind === "reconnect") {
        try {
          ws?.close();
          nativePort?.disconnect();
        } catch {}
        if (!connectNative()) void connectWs();
      } else if (raw.kind === "getState") {
        try {
          port.postMessage({ kind: "bridgeState", state: wsState, authed, transport });
        } catch {}
      }
    });
    try {
      port.postMessage({ kind: "bridgeState", state: wsState, authed, transport });
    } catch {}
  });
});

export default definition;
