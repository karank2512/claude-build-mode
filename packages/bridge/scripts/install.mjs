#!/usr/bin/env node
/**
 * Install the native messaging host so Chrome can spawn the bridge itself —
 * no manual daemon, no token paste.
 *
 * Usage: node scripts/install.mjs --ext-id <chrome-extension-id> [--ext-id ...]
 *
 * Get the ID from chrome://extensions after loading the unpacked extension
 * (Developer mode on). Re-run if you reload/re-add the extension with a new ID.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, "..", "dist", "native-host.mjs");

const extIds = process.argv.flatMap((a, i) =>
  a === "--ext-id" ? [process.argv[i + 1]] : [],
);
if (extIds.length === 0) {
  console.error(
    "Missing --ext-id. Load the extension, then find its ID on chrome://extensions (Developer mode).",
  );
  process.exit(1);
}
if (process.platform === "win32") {
  console.error(
    "Windows isn't supported by this installer yet — native-messaging manifests live in the registry. " +
      "The WS fallback (npm run bridge) still works.",
  );
  process.exit(1);
}
if (process.platform !== "darwin" && process.platform !== "linux") {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}
if (!existsSync(bundle)) {
  console.error(`${bundle} not found — run \`npm run bundle\` in packages/bridge first.`);
  process.exit(1);
}

const hostDir = join(homedir(), ".config", "claude-build-mode", "host");
mkdirSync(hostDir, { recursive: true });

const targetBundle = join(hostDir, "native-host.mjs");
copyFileSync(bundle, targetBundle);

// Launcher: Chrome needs an executable path; bake in the node binary that
// ran this installer so PATH changes can't break the host.
const launcher = join(hostDir, "cbm-native-host.sh");
writeFileSync(
  launcher,
  `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(targetBundle)}\n`,
);
chmodSync(launcher, 0o755);

const manifest = {
  name: "com.cbm.bridge",
  description: "Build Mode local bridge — spawns Claude Code sessions for the browser extension",
  path: launcher,
  type: "stdio",
  allowed_origins: extIds.map((id) => `chrome-extension://${id}/`),
};

// Native-messaging manifest directories per OS.
const isMac = process.platform === "darwin";
const chromeDirs = isMac
  ? [
      "Google/Chrome",
      "Google/Chrome Beta",
      "Google/Chrome Canary",
      "Microsoft Edge",
      "BraveSoftware/Brave-Browser",
      "Chromium",
    ]
  : process.platform === "linux"
    ? ["google-chrome", "google-chrome-beta", "microsoft-edge", "BraveSoftware/Brave-Browser", "chromium"]
    : [];
const appSupport = isMac
  ? join(homedir(), "Library", "Application Support")
  : process.platform === "linux"
    ? join(homedir(), ".config")
    : "";

let installed = 0;
for (const dir of chromeDirs) {
  if (!existsSync(join(appSupport, dir))) continue;
  const nmDir = join(appSupport, dir, "NativeMessagingHosts");
  mkdirSync(nmDir, { recursive: true });
  const file = join(nmDir, "com.cbm.bridge.json");
  writeFileSync(file, JSON.stringify(manifest, null, 2), { mode: 0o644 });
  console.log(`installed: ${file}`);
  installed++;
}
if (installed === 0) {
  // Still write Chrome's path — the browser may be installed later.
  const nmDir = join(appSupport, "Google/Chrome", "NativeMessagingHosts");
  mkdirSync(nmDir, { recursive: true });
  writeFileSync(join(nmDir, "com.cbm.bridge.json"), JSON.stringify(manifest, null, 2));
  console.log("installed for Chrome (default path)");
}

console.log(`\nDone. Host: ${targetBundle}`);
console.log(`Allowed origins: ${manifest.allowed_origins.join(", ")}`);
console.log("Restart Chrome, then the extension connects without a token.");
