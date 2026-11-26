import { readFileSync } from "node:fs";
import WebSocket from "ws";

const cfg = JSON.parse(readFileSync(process.env.HOME + "/.config/claude-build-mode/bridge.json", "utf8"));
const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/ws`);

const transcript = {
  convId: "test-conv-1",
  convUrl: "https://claude.ai/chat/test-conv-1",
  title: "Test chat",
  turns: [
    { role: "human", text: "I want a file called out.txt containing the single word BUILT" },
    { role: "assistant", text: "Sure — I'll create out.txt with the word BUILT." },
  ],
  extractedAt: new Date().toISOString(),
  source: "api",
};

let sessionId = null;
const results = [];

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", token: cfg.token, version: "test" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type === "hello_ok") {
    console.log("HELLO_OK", JSON.stringify(msg.env));
    ws.send(JSON.stringify({
      type: "start_session",
      convId: transcript.convId,
      cwd: "/tmp/cbm-e2e",
      transcript,
      permissionProfile: "prompt",
    }));
  } else if (msg.type === "session_started") {
    sessionId = msg.sessionId;
    console.log("SESSION_STARTED", sessionId);
  } else if (msg.type === "permission_request") {
    console.log("PERMISSION_REQUEST", msg.request.toolName, JSON.stringify(msg.request.input).slice(0, 200));
    ws.send(JSON.stringify({
      type: "permission_response",
      sessionId,
      requestId: msg.request.requestId,
      decision: "allow",
    }));
    console.log("-> sent allow");
  } else if (msg.type === "agent_event") {
    const e = msg.event;
    if (e.type === "assistant") {
      for (const b of e.message?.content ?? []) {
        if (b.type === "text") console.log("ASSISTANT:", b.text.slice(0, 140));
        if (b.type === "tool_use") console.log("TOOL_USE:", b.name, JSON.stringify(b.input).slice(0, 140));
      }
    } else if (e.type === "result") {
      console.log("RESULT:", e.subtype, "|", String(e.result).slice(0, 160), "| cost:", e.total_cost_usd);
      results.push(e.subtype);
    } else if (e.type === "system" && e.subtype === "permission_denied") {
      console.log("PERMISSION_DENIED event:", JSON.stringify(e).slice(0, 200));
    }
  } else if (msg.type === "session_ended") {
    console.log("SESSION_ENDED code:", msg.code);
    console.log("file contents:", readFileSync("/tmp/cbm-e2e/out.txt", "utf8"));
    process.exit(0);
  } else if (msg.type === "error") {
    console.log("ERROR:", msg.message);
  }
});

setTimeout(() => { console.log("TIMEOUT — exiting"); process.exit(2); }, 120000);
