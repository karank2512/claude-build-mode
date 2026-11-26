import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { SessionRecord } from "@cbm/shared";
import { configDir } from "./config.js";

const FILE = () => join(configDir(), "sessions.json");

function load(): Record<string, SessionRecord> {
  try {
    return JSON.parse(readFileSync(FILE(), "utf8"));
  } catch {
    return {};
  }
}

function save(map: Record<string, SessionRecord>): void {
  const tmp = FILE() + ".tmp";
  writeFileSync(tmp, JSON.stringify(map, null, 2), { mode: 0o600 });
  renameSync(tmp, FILE());
}

export function upsertSession(rec: SessionRecord): void {
  const map = load();
  map[rec.sessionId] = rec;
  save(map);
}

export function getSession(sessionId: string): SessionRecord | null {
  return load()[sessionId] ?? null;
}

export function findByConv(convId: string): SessionRecord | null {
  const recs = Object.values(load()).filter((r) => r.convId === convId);
  recs.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  return recs[0] ?? null;
}

export function listSessions(): SessionRecord[] {
  return Object.values(load()).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

export function touch(sessionId: string, patch: Partial<SessionRecord>): void {
  const map = load();
  const rec = map[sessionId];
  if (!rec) return;
  map[sessionId] = { ...rec, ...patch, lastActiveAt: new Date().toISOString() };
  save(map);
}

export function registryPathExists(): boolean {
  return existsSync(FILE());
}
