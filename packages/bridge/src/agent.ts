import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve as resolvePath, isAbsolute, join } from "node:path";
import type { ClaudeStreamEvent, PermissionProfile, Transcript } from "@cbm/shared";
import { resolveClaude } from "./env.js";
import { buildSeedMessage, writeTranscriptFile } from "./seed.js";

export interface AgentEvents {
  event: (e: ClaudeStreamEvent) => void;
  ended: (code: number | null) => void;
  error: (message: string) => void;
  sessionReady: (sessionId: string) => void;
}

interface AgentOptions {
  cwd: string;
  permissionProfile: PermissionProfile;
  mcpUrl: string;
  resumeId?: string;
  sessionId?: string;
}

const PROFILE_TO_MODE: Record<PermissionProfile, string> = {
  prompt: "manual",
  acceptEdits: "acceptEdits",
  plan: "plan",
};

export function validateCwd(input: string): { ok: true; path: string } | { ok: false; error: string } {
  const expanded = input.startsWith("~") ? join(home(input), input.slice(1)) : input;
  const p = isAbsolute(expanded) ? expanded : resolvePath(homedir(), expanded);
  try {
    if (!statSync(p).isDirectory()) return { ok: false, error: `${p} is not a directory` };
    return { ok: true, path: p };
  } catch {
    return { ok: false, error: `${p} does not exist` };
  }
}
function home(_: string): string {
  return homedir();
}

export class AgentSession extends EventEmitter {
  readonly id: string;
  readonly convId: string;
  readonly cwd: string;
  private proc: ChildProcess | null = null;
  private stderrTail: string[] = [];
  private buf = "";
  ended = false;
  sessionId: string | null = null;

  constructor(convId: string, opts: AgentOptions) {
    super();
    this.convId = convId;
    this.cwd = opts.cwd;
    this.id = opts.resumeId ?? opts.sessionId ?? randomUUID();

    const claude = resolveClaude();
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--replay-user-messages",
      "--permission-mode", PROFILE_TO_MODE[opts.permissionProfile],
      "--permission-prompts", "host",
      "--permission-prompt-tool", "mcp__cbm__ask",
      "--mcp-config", JSON.stringify({
        mcpServers: { cbm: { type: "http", url: opts.mcpUrl } },
      }),
    ];
    if (opts.resumeId) args.push("--resume", opts.resumeId);
    else args.push("--session-id", this.id);

    this.proc = spawn(claude, args, {
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.proc.stdout!.setEncoding("utf8");
    this.proc.stdout!.on("data", (chunk: string) => this.onChunk(chunk));
    this.proc.stderr!.setEncoding("utf8");
    this.proc.stderr!.on("data", (d: string) => {
      this.stderrTail.push(d);
      if (this.stderrTail.length > 40) this.stderrTail.shift();
    });
    this.proc.on("error", (err) => {
      this.ended = true;
      this.emit("error", `failed to start claude: ${err.message}`);
    });
    this.proc.on("exit", (code) => {
      this.ended = true;
      if (code !== 0 && this.stderrTail.length) {
        this.emit("error", this.stderrTail.join("").slice(-800));
      }
      this.emit("ended", code);
    });
  }

  private onChunk(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let ev: ClaudeStreamEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.session_id && !this.sessionId) {
        this.sessionId = ev.session_id;
        this.emit("sessionReady", this.sessionId);
      }
      this.emit("event", ev);
    }
  }

  sendUserMessage(text: string): void {
    if (this.ended || !this.proc?.stdin?.writable) return;
    const msg = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    };
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  stop(): void {
    if (this.ended || !this.proc) return;
    this.proc.kill("SIGINT");
    const p = this.proc;
    setTimeout(() => {
      if (!this.ended) p.kill("SIGKILL");
    }, 5000);
  }
}

export interface StartParams {
  convId: string;
  cwd: string;
  transcript?: Transcript;
  permissionProfile: PermissionProfile;
  prompt?: string;
  mcpUrl: string;
  resumeId?: string;
  sessionId?: string;
}

export function startAgent(p: StartParams): AgentSession {
  const session = new AgentSession(p.convId, {
    cwd: p.cwd,
    permissionProfile: p.permissionProfile,
    mcpUrl: p.mcpUrl,
    resumeId: p.resumeId,
    sessionId: p.sessionId,
  });
  if (p.transcript) {
    const file = writeTranscriptFile(p.transcript);
    const seed = buildSeedMessage(p.transcript, file, p.prompt);
    // The process may take a moment to reach a writable state; queue via stdin
    // once it opens — node's pipe buffers, so immediate write is safe.
    session.sendUserMessage(seed);
  } else if (p.prompt) {
    session.sendUserMessage(p.prompt);
  }
  return session;
}
