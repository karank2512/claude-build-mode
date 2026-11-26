/**
 * Chrome native messaging host entry point.
 *
 * Chrome spawns this process when the extension calls connectNative(); it
 * speaks stdio framing: [4-byte little-endian length][JSON payload]. All
 * logging MUST go to stderr — stdout is the protocol channel.
 *
 * The MCP permission endpoint still needs HTTP, so we bind an ephemeral
 * localhost port (whatever the OS assigns) and hand its URL to claude via
 * --mcp-config when each session starts.
 */
import type { ClientMessage, ServerMessage } from "@cbm/shared";
import { loadOrCreateConfig } from "./config.js";
import { createCore, type Sink } from "./core.js";

// stdout is protocol — anything accidental goes to stderr instead.
console.log = console.error;

const cfg = loadOrCreateConfig();
cfg.token = "native"; // stdio is trusted by design — skip the token check
const core = createCore(cfg, 0);

let inBuf = Buffer.alloc(0);
const sink: Sink = {
  authed: true,
  send(msg: ServerMessage) {
    const payload = Buffer.from(JSON.stringify(msg), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length);
    process.stdout.write(header);
    process.stdout.write(payload);
  },
};
core.sinks.add(sink);

// Don't parse stdin until the MCP listener has bound its port, so session
// starts always get a valid mcpUrl.
core.httpServer.on("listening", () => {
  process.stderr.write(`cbm native-host ready (mcp :${core.mcpPort})\n`);

  process.stdin.on("data", (chunk: Buffer) => {
    inBuf = Buffer.concat([inBuf, chunk]);
    while (inBuf.length >= 4) {
      const len = inBuf.readUInt32LE(0);
      if (inBuf.length < 4 + len) break;
      const body = inBuf.subarray(4, 4 + len).toString("utf8");
      inBuf = inBuf.subarray(4 + len);
      try {
        core.handleMessage(JSON.parse(body) as ClientMessage, sink);
      } catch (e) {
        sink.send({ type: "error", message: `bad message: ${String(e)}` });
      }
    }
  });

  process.stdin.on("end", () => {
    // Chrome closed the port — shut down (agents die with us).
    process.exit(0);
  });
});

