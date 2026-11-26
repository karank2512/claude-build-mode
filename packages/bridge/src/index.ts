import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ClientMessage,
  PermissionRequest,
  ServerMessage,
  SessionRecord,
} from "@cbm/shared";
import { loadOrCreateConfig } from "./config.js";
import { probeEnv } from "./env.js";
import { AgentSession, startAgent, validateCwd } from "./agent.js";
import { makeMcpHandler } from "./permissions.js";
import * as registry from "./registry.js";

const VERSION = "0.1.0";
const cfg = loadOrCreateConfig();
const env = probeEnv(VERSION);

// ---------- session + permission state ----------

const liveAgents = new Map<string, AgentSession>();
const pendingPerms = new Map<
  string,
  { sessionId: string; toolName: string; resolve: (d: "allow" | "deny" | "always") => void }
>();
const alwaysAllowed = new Map<string, Set<string>>(); // sessionId -> tool names
const sockets = new Set<WebSocket>();
const authed = new WeakSet<WebSocket>();

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMessage): void {
  for (const ws of sockets) if (authed.has(ws)) send(ws, msg);
}

function askUser(req: PermissionRequest): Promise<"allow" | "deny" | "always"> {
  const always = alwaysAllowed.get(req.sessionId);
  if (always?.has(req.toolName)) return Promise.resolve("allow");
  if ([...sockets].filter((s) => authed.has(s)).length === 0) return Promise.resolve("deny");
  return new Promise((resolve) => {
    pendingPerms.set(req.requestId, { sessionId: req.sessionId, toolName: req.toolName, resolve });
    broadcast({ type: "permission_request", request: req });
  });
}

// MCP URL is per-session: /mcp/<token>/<sessionId> attributes prompts correctly.
function makeSessionMcpHandler(sessionId: string) {
  return makeMcpHandler((r) => askUser({ ...r, sessionId }));
}
const mcpHandlers = new Map<string, ReturnType<typeof makeSessionMcpHandler>>();
function handlerFor(sessionId: string) {
  let h = mcpHandlers.get(sessionId);
  if (!h) {
    h = makeSessionMcpHandler(sessionId);
    mcpHandlers.set(sessionId, h);
  }
  return h;
}

function attachAgent(agent: AgentSession, rec: SessionRecord): void {
  liveAgents.set(agent.id, agent);
  agent.on("event", (e) => {
    registry.touch(rec.sessionId, {});
    broadcast({ type: "agent_event", sessionId: agent.id, event: e });
  });
  agent.on("error", (message) => {
    broadcast({ type: "error", sessionId: agent.id, message });
  });
  agent.on("ended", (code) => {
    liveAgents.delete(agent.id);
    registry.touch(rec.sessionId, { running: false });
    broadcast({ type: "session_ended", sessionId: agent.id, code });
  });
}

// ---------- HTTP server (health + MCP) ----------

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolveBody(JSON.parse(data));
      } catch {
        resolveBody(undefined);
      }
    });
    req.on("error", () => resolveBody(undefined));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, version: VERSION, env }));
    return;
  }

  const mcpMatch = url.pathname.match(/^\/mcp\/([^/]+)\/([^/]+)$/);
  if (mcpMatch) {
    const [, token, sessionId] = mcpMatch;
    if (token !== cfg.token) {
      res.writeHead(401);
      res.end();
      return;
    }
    const body = await readBody(req);
    await handlerFor(sessionId)(req, res, body);
    return;
  }

  res.writeHead(404);
  res.end();
});

// ---------- WebSocket (extension channel) ----------

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, url));
});

wss.on("connection", (ws: WebSocket, _req: IncomingMessage, url: URL) => {
  const tokenOk = url.searchParams.get("token") === cfg.token;
  sockets.add(ws);
  ws.on("close", () => sockets.delete(ws));
  ws.on("message", (raw) => {
    void (async () => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (!authed.has(ws)) {
        if (msg.type === "hello" && (tokenOk || msg.token === cfg.token)) {
          authed.add(ws);
          send(ws, { type: "hello_ok", env });
        } else {
          send(ws, { type: "error", message: "unauthorized: bad bridge token" });
          ws.close();
        }
        return;
      }

      switch (msg.type) {
        case "ping":
          send(ws, { type: "pong" });
          break;

        case "env_check":
          send(ws, { type: "env", env: probeEnv(VERSION) });
          break;

        case "list_dirs": {
          try {
            const base = msg.path ? resolvePath(homedir(), msg.path.replace(/^~/, homedir())) : homedir();
            const dirs = readdirSync(base)
              .filter((n) => {
                try {
                  return statSync(join(base, n)).isDirectory() && !n.startsWith(".");
                } catch {
                  return false;
                }
              })
              .sort()
              .slice(0, 200);
            send(ws, { type: "dirs", path: base, dirs });
          } catch (e) {
            send(ws, { type: "dirs", path: msg.path ?? homedir(), dirs: [], error: String(e) });
          }
          break;
        }

        case "start_session": {
          const v = validateCwd(msg.cwd);
          if (!v.ok) {
            send(ws, { type: "error", message: v.error });
            break;
          }
          const existing = registry.findByConv(msg.convId);
          if (existing && liveAgents.has(existing.sessionId)) {
            // Same chat already has a live build session — hand any new
            // instruction to it instead of spawning a duplicate.
            if (msg.prompt) liveAgents.get(existing.sessionId)!.sendUserMessage(msg.prompt);
            send(ws, { type: "session_started", sessionId: existing.sessionId, convId: msg.convId });
            break;
          }
          const resumeId = existing ? existing.sessionId : undefined;
          const sessionId = resumeId ?? randomUUID();
          const agent = startAgent({
            convId: msg.convId,
            cwd: v.path,
            transcript: resumeId ? undefined : msg.transcript,
            permissionProfile: msg.permissionProfile,
            prompt: msg.prompt,
            resumeId,
            sessionId: resumeId ? undefined : sessionId,
            mcpUrl: `http://127.0.0.1:${cfg.port}/mcp/${cfg.token}/${sessionId}`,
          });
          const rec: SessionRecord = {
            sessionId,
            convId: msg.convId,
            cwd: v.path,
            title: msg.transcript.title,
            startedAt: existing?.startedAt ?? new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            running: true,
          };
          registry.upsertSession(rec);
          alwaysAllowed.set(sessionId, new Set());
          attachAgent(agent, rec);
          send(ws, { type: "session_started", sessionId, convId: msg.convId });
          break;
        }

        case "resume_session": {
          const rec = registry.getSession(msg.sessionId);
          if (!rec) {
            send(ws, { type: "error", message: `unknown session ${msg.sessionId}` });
            break;
          }
          if (liveAgents.has(rec.sessionId)) {
            send(ws, { type: "session_started", sessionId: rec.sessionId, convId: rec.convId });
            break;
          }
          const agent = startAgent({
            convId: rec.convId,
            cwd: rec.cwd,
            permissionProfile: "prompt",
            resumeId: rec.sessionId,
            mcpUrl: `http://127.0.0.1:${cfg.port}/mcp/${cfg.token}/${rec.sessionId}`,
          });
          registry.upsertSession({ ...rec, running: true });
          alwaysAllowed.set(rec.sessionId, new Set());
          attachAgent(agent, { ...rec, running: true });
          send(ws, { type: "session_started", sessionId: rec.sessionId, convId: rec.convId });
          break;
        }

        case "user_message": {
          const agent = liveAgents.get(msg.sessionId);
          if (!agent) {
            send(ws, { type: "error", sessionId: msg.sessionId, message: "session not running" });
            break;
          }
          agent.sendUserMessage(msg.text);
          break;
        }

        case "permission_response": {
          const pending = pendingPerms.get(msg.requestId);
          if (!pending) break;
          pendingPerms.delete(msg.requestId);
          if (msg.decision === "always") {
            const set = alwaysAllowed.get(pending.sessionId) ?? new Set();
            set.add(pending.toolName);
            alwaysAllowed.set(pending.sessionId, set);
          }
          pending.resolve(msg.decision === "deny" ? "deny" : "allow");
          break;
        }

        case "stop_session": {
          const agent = liveAgents.get(msg.sessionId);
          if (agent) agent.stop();
          else registry.touch(msg.sessionId, { running: false });
          break;
        }

        case "list_sessions": {
          const sessions = registry.listSessions().map((s) => ({
            ...s,
            running: liveAgents.has(s.sessionId),
          }));
          send(ws, { type: "sessions", sessions });
          break;
        }
      }
    })();
  });
});

server.listen(cfg.port, "127.0.0.1", () => {
  console.log(`cbm-bridge ${VERSION} listening on 127.0.0.1:${cfg.port}`);
  console.log(`token: ${cfg.token.slice(0, 6)}… (full token in ${cfg.configDir}/bridge.json)`);
  console.log(`claude: ${env.claudePath ?? "NOT FOUND"} ${env.claudeVersion ?? ""} auth=${env.authenticated}`);
});
