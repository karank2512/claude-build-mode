import { execFileSync, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EnvInfo } from "@cbm/shared";

function findClaude(): string | null {
  const candidates = [
    join(homedir(), ".local", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    return execSync("command -v claude", { encoding: "utf8", shell: "/bin/zsh" }).trim() || null;
  } catch {
    try {
      return execSync("which claude", { encoding: "utf8" }).trim() || null;
    } catch {
      return null;
    }
  }
}

function claudeVersion(path: string | null): string | null {
  if (!path) return null;
  try {
    return execFileSync(path, ["--version"], { encoding: "utf8", timeout: 8000 }).trim();
  } catch {
    return null;
  }
}

function looksAuthenticated(): boolean {
  // Heuristic: Claude Code stores OAuth creds in the macOS keychain or
  // ~/.claude/.credentials.json; a headless token env file also counts.
  const home = homedir();
  if (existsSync(join(home, ".claude", ".credentials.json"))) return true;
  if (existsSync(join(home, ".claude", "headless-oauth-token.env"))) return true;
  try {
    execSync('security find-generic-password -s "Claude Code-credentials"', {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function probeEnv(bridgeVersion: string): EnvInfo {
  const claudePath = findClaude();
  return {
    claudePath,
    claudeVersion: claudeVersion(claudePath),
    authenticated: looksAuthenticated(),
    bridgeVersion,
  };
}

export function resolveClaude(): string {
  return findClaude() ?? "claude";
}
