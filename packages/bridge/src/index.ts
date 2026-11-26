import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@cbm/shared";
import { loadOrCreateConfig } from "./config.js";
import { createCore, VERSION, type Sink } from "./core.js";

const cfg = loadOrCreateConfig();
const core = createCore(cfg, cfg.port);

const wss = new WebSocketServer({ noServer: true });

core.httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, url));
});

wss.on("connection", (ws: WebSocket, _req: IncomingMessage, url: URL) => {
  const sink: Sink = {
    authed: url.searchParams.get("token") === cfg.token, // query-token shortcuts hello
    send(msg: ServerMessage) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
  };
  core.sinks.add(sink);
  ws.on("close", () => core.sinks.delete(sink));
  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const wasAuthed = sink.authed;
    core.handleMessage(msg, sink);
    if (!sink.authed && !wasAuthed) ws.close();
  });
});

core.httpServer.once("listening", () => {
  console.log(`cbm-bridge ${VERSION} listening on 127.0.0.1:${core.mcpPort}`);
  console.log(`token: ${cfg.token.slice(0, 6)}… (full token in ${cfg.configDir}/bridge.json)`);
  console.log(`claude: ${core.env.claudePath ?? "NOT FOUND"} ${core.env.claudeVersion ?? ""} auth=${core.env.authenticated}`);
});
