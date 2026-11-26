// Drive the native host exactly like Chrome would: 4-byte LE length + JSON.
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const host = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "native-host.mjs");
const p = spawn(process.execPath, [host], { stdio: ["pipe", "pipe", "pipe"] });
p.stderr.on("data", (d) => process.stderr.write("[host:err] " + d));

let out = Buffer.alloc(0);
p.stdout.on("data", (c) => {
  out = Buffer.concat([out, c]);
  while (out.length >= 4) {
    const len = out.readUInt32LE(0);
    if (out.length < 4 + len) break;
    const msg = JSON.parse(out.subarray(4, 4 + len).toString());
    out = out.subarray(4 + len);
    console.log("RECV:", JSON.stringify(msg).slice(0, 300));
    if (msg.type === "hello_ok") {
      send({ type: "list_sessions" });
      setTimeout(() => p.kill("SIGINT"), 1500);
    }
  }
});

function send(msg) {
  const payload = Buffer.from(JSON.stringify(msg));
  const h = Buffer.alloc(4);
  h.writeUInt32LE(payload.length);
  p.stdin.write(h);
  p.stdin.write(payload);
}

setTimeout(() => send({ type: "hello", token: "native", version: "test" }), 800);
setTimeout(() => { console.log("TIMEOUT"); p.kill(); process.exit(2); }, 10000);
