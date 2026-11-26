import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ClientMessage,
  PermissionRequest,
  ServerMessage,
  SessionRecord,
} from "@cbm/shared";
import type { BridgeConfig } from "./config.js";
import { probeEnv } from "./env.js";
import { AgentSession, startAgent, validateCwd } from "./agent.js";
import { makeMcpHandler } from "./permissions.js";
import * as registry from "./registry.js";

export const VERSION = "0.1.0";

export interface Sink {
  send(msg: ServerMessage): void;
  authed: boolean;
}

export interface Core {
  cfg: BridgeConfig;
  env: ReturnType<typeof probeEnv>;
  sinks: Set<Sink>;
  handleMessage(msg: ClientMessage, sink: Sink): void;
  broadcast(msg: ServerMessage): void;
  httpServer: Server;
  mcpPort: number;
}

export function createCore(cfg: BridgeConfig, mcpListenPort: number): Core {
  const env = probeEnv(VERSION);

  const liveAgents = new Map<string, AgentSession>();
  const pendingPerms = new Map<
    string,
    { sessionId: string; toolName: string; resolve: (d: "allow" | "deny" | "always") => void }
  >();
  const alwaysAllowed = new Map<string, Set<string>>();
  const mcpHandlers = new Map<string, ReturnType<typeof makeSessionMcpHandler>>();

  function broadcast(msg: ServerMessage): void {
    for (const s of core.sinks) if (s.authed) s.send(msg);
  }

  function askUser(req: PermissionRequest): Promise<"allow" | "deny" | "always"> {
    const always = alwaysAllowed.get(req.sessionId);
    if (always?.has(req.toolName)) return Promise.resolve("allow");
    if (![...core.sinks].some((s) => s.authed)) return Promise.resolve("deny");
    return new Promise((resolve) => {
      pendingPerms.set(req.requestId, {
        sessionId: req.sessionId,
        toolName: req.toolName,
        resolve,
      });
      broadcast({ type: "permission_request", request: req });
    });
  }

  function makeSessionMcpHandler(sessionId: string) {
    return makeMcpHandler((r) => askUser({ ...r, sessionId }));
  }
  function handlerFor(sessionId: string) {
    let h = mcpHandlers.get(sessionId);
    if (!h) {
      h = makeSessionMcpHandler(sessionId);
      mcpHandlers.set(sessionId, h);
    }
    return h;
  }

  function pidAlive(pid: number | undefined): boolean {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  /** A registry session whose agent is still alive under *another* bridge
   *  instance (e.g. WS daemon vs native host) blocks resume — reap it. */
  function reapOrphan(rec: SessionRecord | null): void {
    if (!rec?.agentPid || !pidAlive(rec.agentPid)) return;
    try {
      process.kill(rec.agentPid, "SIGINT");
    } catch {}
    registry.touch(rec.sessionId, { running: false, agentPid: undefined });
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
      registry.touch(rec.sessionId, { running: false, agentPid: undefined });
      broadcast({ type: "session_ended", sessionId: agent.id, code });
    });
  }

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

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: VERSION, env }));
      return;
    }

    const mcpMatch = url.pathname.match(/^\/mcp\/([^/]+)\/([^/]+)$/);
    if (mcpMatch) {
      const [, token, sessionId] = mcpMatch;
      // Token check applies to the local HTTP surface only; when the bridge
      // runs as a native host we skip it (stdio is already trusted).
      if (cfg.token !== "native" && token !== cfg.token) {
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

  const core: Core = {
    cfg,
    env,
    sinks: new Set(),
    broadcast,
    httpServer,
    mcpPort: mcpListenPort,

    handleMessage(msg: ClientMessage, sink: Sink): void {
      if (!sink.authed) {
        if (msg.type === "hello" && (cfg.token === "native" || msg.token === cfg.token)) {
          sink.authed = true;
          sink.send({ type: "hello_ok", env });
        } else {
          sink.send({ type: "error", message: "unauthorized: bad bridge token" });
        }
        return;
      }

      const mcpBase = () => `http://127.0.0.1:${core.mcpPort}/mcp/${cfg.token}`;

      switch (msg.type) {
        case "hello":
          sink.send({ type: "hello_ok", env });
          break;

        case "ping":
          sink.send({ type: "pong" });
          break;

        case "env_check":
          sink.send({ type: "env", env: probeEnv(VERSION) });
          break;

        case "list_dirs": {
          try {
            const base = msg.path
              ? resolvePath(homedir(), msg.path.replace(/^~/, homedir()))
              : homedir();
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
            sink.send({ type: "dirs", path: base, dirs });
          } catch (e) {
            sink.send({ type: "dirs", path: msg.path ?? homedir(), dirs: [], error: String(e) });
          }
          break;
        }

        case "start_session": {
          const v = validateCwd(msg.cwd);
          if (!v.ok) {
            sink.send({ type: "error", message: v.error });
            break;
          }
          const existing = registry.findByConv(msg.convId);
          if (existing && liveAgents.has(existing.sessionId)) {
            if (msg.prompt) liveAgents.get(existing.sessionId)!.sendUserMessage(msg.prompt);
            sink.send({ type: "session_started", sessionId: existing.sessionId, convId: msg.convId });
            break;
          }
          reapOrphan(existing);
          const resumeId = existing ? existing.sessionId : undefined;
          const sessionId = resumeId ?? randomUUID();
          const agent = startAgent({
            convId: msg.convId,
            cwd: v.path,
            transcript: resumeId ? undefined : msg.transcript,
            permissionProfile: msg.permissionProfile,
            // Resuming with no instruction still needs a first turn on stdin —
            // a bare claude process waits silently forever.
            prompt: msg.prompt ?? (resumeId ? "Continue from where you left off." : undefined),
            resumeId,
            sessionId: resumeId ? undefined : sessionId,
            mcpUrl: `${mcpBase()}/${sessionId}`,
          });
          const rec: SessionRecord = {
            sessionId,
            convId: msg.convId,
            cwd: v.path,
            title: msg.transcript.title,
            startedAt: existing?.startedAt ?? new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
            running: true,
            agentPid: agent.pid,
          };
          registry.upsertSession(rec);
          alwaysAllowed.set(sessionId, new Set());
          attachAgent(agent, rec);
          sink.send({ type: "session_started", sessionId, convId: msg.convId });
          break;
        }

        case "resume_session": {
          const rec = registry.getSession(msg.sessionId);
          if (!rec) {
            sink.send({ type: "error", message: `unknown session ${msg.sessionId}` });
            break;
          }
          if (liveAgents.has(rec.sessionId)) {
            sink.send({ type: "session_started", sessionId: rec.sessionId, convId: rec.convId });
            break;
          }
          reapOrphan(rec);
          const agent = startAgent({
            convId: rec.convId,
            cwd: rec.cwd,
            permissionProfile: "prompt",
            resumeId: rec.sessionId,
            mcpUrl: `${mcpBase()}/${rec.sessionId}`,
          });
          registry.upsertSession({ ...rec, running: true, agentPid: agent.pid });
          alwaysAllowed.set(rec.sessionId, new Set());
          attachAgent(agent, { ...rec, running: true });
          sink.send({ type: "session_started", sessionId: rec.sessionId, convId: rec.convId });
          break;
        }

        case "user_message": {
          const agent = liveAgents.get(msg.sessionId);
          if (!agent) {
            sink.send({ type: "error", sessionId: msg.sessionId, message: "session not running" });
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
          sink.send({ type: "sessions", sessions });
          break;
        }
      }
    },
  };

  httpServer.listen(mcpListenPort, "127.0.0.1", () => {
    const addr = httpServer.address();
    if (addr && typeof addr === "object") core.mcpPort = addr.port;
  });

  return core;
}
