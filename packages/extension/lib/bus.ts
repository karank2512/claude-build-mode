import { browser } from "wxt/browser";
import type { ClientMessage, ServerMessage } from "@cbm/shared";

export type BridgeState = "connecting" | "open" | "closed";

type Listener = (msg: ServerMessage) => void;
type StateListener = (state: BridgeState, authed: boolean) => void;

let port: ReturnType<typeof browser.runtime.connect> | null = null;
const listeners = new Set<Listener>();
const stateListeners = new Set<StateListener>();
let lastState: BridgeState = "closed";
let lastAuthed = false;

export function bus(): { send: (m: ClientMessage) => void } {
  if (!port) {
    port = browser.runtime.connect({ name: "cbm" });
    port.onMessage.addListener((raw) => {
      if (raw?.kind === "fromBridge") {
        for (const l of listeners) l(raw.msg as ServerMessage);
      } else if (raw?.kind === "bridgeState") {
        lastState = raw.state;
        lastAuthed = raw.authed;
        for (const l of stateListeners) l(raw.state, raw.authed);
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      lastState = "closed";
      lastAuthed = false;
      for (const l of stateListeners) l("closed", false);
      setTimeout(() => bus(), 1000); // reconnect port
    });
  }
  return {
    send(m: ClientMessage) {
      try {
        port?.postMessage({ kind: "toBridge", msg: m });
      } catch {
        port = null;
      }
    },
  };
}

export function onBridgeMessage(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function onBridgeState(l: StateListener): () => void {
  stateListeners.add(l);
  l(lastState, lastAuthed);
  return () => stateListeners.delete(l);
}
