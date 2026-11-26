import { browser } from "wxt/browser";
import type {
  ClaudeChatMessage,
  ClaudeConversation,
  ClaudeOrg,
  Transcript,
  TranscriptTurn,
} from "@cbm/shared";

/**
 * Pull a full conversation transcript using the same same-origin internal API
 * the claude.ai web app uses. Session cookies ride along automatically —
 * nothing leaves the browser except to the user's own local bridge.
 */

export function currentConvId(): string | null {
  const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

function lastActiveOrg(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

async function getOrg(): Promise<string> {
  const res = await fetch("/api/organizations", { credentials: "include" });
  if (!res.ok) throw new Error(`/api/organizations -> ${res.status}`);
  const orgs = (await res.json()) as ClaudeOrg[];
  const preferred = lastActiveOrg();
  const org = orgs.find((o) => o.uuid === preferred) ?? orgs[0];
  if (!org) throw new Error("no claude.ai organization found");
  return org.uuid;
}

function messageText(m: ClaudeChatMessage): string {
  if (typeof m.text === "string" && m.text.trim()) return m.text.trim();
  const parts: string[] = [];
  for (const block of m.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block.type === "tool_use" && block.name)
      parts.push(`[tool: ${block.name}] ${JSON.stringify(block.input ?? {}).slice(0, 500)}`);
    else if (block.type === "tool_result")
      parts.push(`[tool result] ${typeof block.content === "string" ? block.content.slice(0, 500) : ""}`);
  }
  return parts.join("\n").trim();
}

export async function fetchTranscriptApi(): Promise<Transcript> {
  const convId = currentConvId();
  if (!convId) throw new Error("not on a conversation page");
  const org = await getOrg();
  const url =
    `/api/organizations/${org}/chat_conversations/${convId}` +
    `?tree=True&rendering_mode=messages&render_all_tools=true`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`conversation fetch -> ${res.status}`);
  const conv = (await res.json()) as ClaudeConversation;

  const turns: TranscriptTurn[] = [];
  for (const m of conv.chat_messages ?? []) {
    const text = messageText(m);
    if (!text) continue;
    const role = m.sender === "human" ? "human" : "assistant";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += "\n\n" + text;
    else turns.push({ role, text });
  }
  if (turns.length === 0) throw new Error("empty transcript");

  return {
    convId,
    convUrl: location.href,
    title: conv.name || document.title.replace(/\s*[-–—]\s*Claude\s*$/, ""),
    model: conv.model,
    turns,
    extractedAt: new Date().toISOString(),
    source: "api",
  };
}

/** DOM fallback: text-only scrape of rendered turns (no thinking/tools). */
export function fetchTranscriptDom(): Transcript {
  const convId = currentConvId();
  if (!convId) throw new Error("not on a conversation page");
  const turns: TranscriptTurn[] = [];
  const seen = new Set<string>();
  // claude.ai marks human messages with data-testid="user-message" and
  // assistant turns in .font-claude-response containers.
  for (const el of document.querySelectorAll<HTMLElement>(
    '[data-testid="user-message"], .font-claude-response',
  )) {
    const role = el.dataset.testid === "user-message" ? "human" : "assistant";
    const text = el.innerText.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    turns.push({ role, text });
  }
  if (turns.length === 0) throw new Error("empty transcript (DOM)");
  return {
    convId,
    convUrl: location.href,
    title: document.title.replace(/\s*[-–—]\s*Claude\s*$/, ""),
    turns,
    extractedAt: new Date().toISOString(),
    source: "dom",
  };
}

export async function fetchTranscript(): Promise<Transcript> {
  try {
    return await fetchTranscriptApi();
  } catch {
    return fetchTranscriptDom();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ROOT_PARENT = "00000000-0000-4000-8000-000000000000";

/** Current leaf message uuid — required as parent for a completion POST. */
async function leafMessageUuid(org: string, convId: string): Promise<string> {
  const res = await fetch(
    `/api/organizations/${org}/chat_conversations/${convId}` +
      `?tree=True&rendering_mode=messages`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`conversation fetch -> ${res.status}`);
  const conv = (await res.json()) as ClaudeConversation;
  const msgs = conv.chat_messages ?? [];
  return msgs.length ? msgs[msgs.length - 1].uuid : ROOT_PARENT;
}

type CompletionTemplate = { url: string; body: Record<string, unknown>; capturedAt: number };

async function completionTemplate(): Promise<CompletionTemplate | null> {
  const { completionTemplate } = await browser.storage.local.get("completionTemplate");
  const t = completionTemplate as CompletionTemplate | undefined;
  return t && typeof t.url === "string" && t.body ? t : null;
}

/** Point a captured request URL at the current org + conversation. */
function retargetUrl(templateUrl: string, org: string, convId: string): string {
  try {
    const u = new URL(templateUrl, location.origin);
    u.pathname = u.pathname
      .replace(/\/organizations\/[0-9a-f-]{36}/i, `/organizations/${org}`)
      .replace(/\/chat_conversations\/[0-9a-f-]{36}/i, `/chat_conversations/${convId}`);
    return u.pathname + u.search;
  } catch {
    return templateUrl;
  }
}

/** Post a message into the live chat as the user (keeps chat-Claude aware). */
export async function postChatMessage(text: string): Promise<void> {
  const convId = currentConvId();
  if (!convId) throw new Error("not on a conversation page");
  const org = await getOrg();
  // Prefer the captured real request shape (sniffer); fall back to the
  // documented legacy endpoint for accounts still on the old backend.
  const tpl = await completionTemplate();

  let lastError = "completion failed";
  for (let attempt = 0; attempt < 4; attempt++) {
    // Refetch the leaf each try — it changes if the chat moved on or a
    // previous attempt landed a message before erroring mid-generation.
    const parent = await leafMessageUuid(org, convId);
    const url = tpl
      ? retargetUrl(tpl.url, org, convId)
      : `/api/organizations/${org}/chat_conversations/${convId}/completion`;
    const payload = tpl
      ? { ...tpl.body, prompt: text, parent_message_uuid: parent }
      : {
          prompt: text,
          parent_message_uuid: parent,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
          attachments: [],
          files: [],
          rendering_mode: "messages",
        };
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      // Response is SSE for a generation that continues server-side — drain
      // briefly so the message commits, then move on. The web app renders it
      // on its own next sync (or a refresh).
      await Promise.race([res.text(), sleep(15_000)]);
      return;
    }
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    lastError = `completion -> ${res.status}${detail ? ` ${detail}` : ""}`;
    // 409 = the conversation is in a conflicting state (e.g. a completion
    // in-flight); transient, so wait it out and retry with a fresh leaf.
    if (res.status !== 409) break;
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(lastError);
}
