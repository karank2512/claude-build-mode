import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface BridgeConfig {
  port: number;
  token: string;
  configDir: string;
}

const DEFAULT_PORT = 17819;

export function configDir(): string {
  const dir = join(homedir(), ".config", "claude-build-mode");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadOrCreateConfig(): BridgeConfig {
  const dir = configDir();
  const file = join(dir, "bridge.json");
  if (existsSync(file)) {
    try {
      const cfg = JSON.parse(readFileSync(file, "utf8"));
      if (cfg.token && cfg.port) return { ...cfg, configDir: dir };
    } catch {
      // fall through to recreate
    }
  }
  const cfg: BridgeConfig = {
    port: DEFAULT_PORT,
    token: randomBytes(24).toString("hex"),
    configDir: dir,
  };
  writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {}
  return cfg;
}
