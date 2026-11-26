// Shared protocol between the browser extension and the local bridge,
// plus types for the claude.ai internal API and claude stream-json events.

// ---------- claude.ai internal API (undocumented, adapter-owned) ----------

export interface ClaudeOrg {
  uuid: string;
  name?: string;
}

export interface ClaudeContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

export interface ClaudeChatMessage {
  uuid: string;
  sender: "human" | "assistant";
  text?: string;
  content?: ClaudeContentBlock[];
  created_at?: string;
  attachments?: unknown[];
  files?: unknown[];
  [key: string]: unknown;
}

export interface ClaudeConversation {
  uuid: string;
  name?: string;
  model?: string;
  chat_messages: ClaudeChatMessage[];
  [key: string]: unknown;
}

// ---------- transcript (normalized form we seed the agent with) ----------

export interface TranscriptTurn {
  role: "human" | "assistant";
  text: string;
}

export interface Transcript {
  convId: string;
  convUrl: string;
  title: string;
  model?: string;
  turns: TranscriptTurn[];
  extractedAt: string;
  source: "api" | "dom";
}

// ---------- claude CLI stream-json events (subset we consume) ----------

export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  uuid?: string;
  message?: {
    role?: string;
    content?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  num_turns?: number;
  duration_ms?: number;
  [key: string]: unknown;
}

// ---------- permission modes we expose in the UI ----------

export type PermissionProfile = "prompt" | "acceptEdits" | "plan";

// ---------- wire protocol: extension -> bridge ----------

export type ClientMessage =
  | { type: "hello"; token: string; version: string }
  | { type: "ping" }
  | { type: "env_check" }
  | { type: "list_dirs"; path?: string }
  | {
      type: "start_session";
      convId: string;
      cwd: string;
      transcript: Transcript;
      permissionProfile: PermissionProfile;
      prompt?: string;
    }
  | { type: "user_message"; sessionId: string; text: string }
  | {
      type: "permission_response";
      sessionId: string;
      requestId: string;
      decision: "allow" | "deny" | "always";
    }
  | { type: "stop_session"; sessionId: string }
  | { type: "resume_session"; sessionId: string }
  | { type: "list_sessions" };

// ---------- wire protocol: bridge -> extension ----------

export interface EnvInfo {
  claudePath: string | null;
  claudeVersion: string | null;
  authenticated: boolean;
  bridgeVersion: string;
}

export interface SessionRecord {
  sessionId: string;
  convId: string;
  cwd: string;
  title: string;
  startedAt: string;
  lastActiveAt: string;
  running: boolean;
  /** PID of the spawned claude process — detects orphans across bridge instances. */
  agentPid?: number;
}

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  description?: string;
}

export type ServerMessage =
  | { type: "hello_ok"; env: EnvInfo }
  | { type: "pong" }
  | { type: "env"; env: EnvInfo }
  | { type: "dirs"; path: string; dirs: string[]; error?: string }
  | { type: "session_started"; sessionId: string; convId: string }
  | { type: "agent_event"; sessionId: string; event: ClaudeStreamEvent }
  | { type: "permission_request"; request: PermissionRequest }
  | { type: "session_ended"; sessionId: string; code: number | null }
  | { type: "sessions"; sessions: SessionRecord[] }
  | { type: "error"; sessionId?: string; message: string };
