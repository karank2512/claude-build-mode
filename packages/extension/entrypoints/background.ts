import { defineBackground } from "wxt/utils/define-background";
import type { BackgroundDefinition } from "wxt";
import { browser } from "wxt/browser";
import type { ClientMessage, ServerMessage } from "@cbm/shared";

type PortMsg =
  | { kind: "toBridge"; msg: ClientMessage }
  | { kind: "getState" };

const DEFAULT_PORT = 17819;

let ws: WebSocket | null = null;
let wsState: "connecting" | "open" | "closed" = "closed";
let authed = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const ports = new Set<ReturnType<typeof browser.runtime.connect>>();

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
  broadcast({ kind: "bridgeState", state, authed });
}

async function connect(): Promise<void> {
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
  setState("connecting");
  ws.onopen = () => {
    setState("open");
    ws!.send(JSON.stringify({ type: "hello", token, version: browser.runtime.getManifest().version }));
  };
  ws.onmessage = (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === "hello_ok") authed = true;
    broadcast({ kind: "fromBridge", msg });
  };
  ws.onclose = () => {
    authed = false;
    setState("closed");
    scheduleReconnect();
  };
  ws.onerror = () => ws?.close();
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, 3000);
}

const definition: BackgroundDefinition = defineBackground(() => {
  void connect();

  // MV3 service workers can be suspended with an idle WebSocket; ping keeps
  // the bridge link (and the worker) alive.
  browser.alarms.create("cbm-keepalive", { periodInMinutes: 0.45 });
  browser.alarms.onAlarm.addListener((a) => {
    if (a.name !== "cbm-keepalive") return;
    if (ws?.readyState === WebSocket.OPEN && authed) {
      try {
        ws.send(JSON.stringify({ type: "ping" }));
      } catch {}
    } else if (wsState === "closed") {
      void connect();
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "cbm") return;
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener((raw: PortMsg) => {
      if (raw.kind === "toBridge" && ws?.readyState === WebSocket.OPEN && authed) {
        ws.send(JSON.stringify(raw.msg));
      } else if (raw.kind === "getState") {
        try {
          port.postMessage({ kind: "bridgeState", state: wsState, authed });
        } catch {}
      }
    });
    // Push current state immediately.
    try {
      port.postMessage({ kind: "bridgeState", state: wsState, authed });
    } catch {}
  });
});

export default definition;
