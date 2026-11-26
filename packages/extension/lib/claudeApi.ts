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

/** Post a message into the live chat as the user (keeps chat-Claude aware). */
export async function postChatMessage(text: string): Promise<void> {
  const convId = currentConvId();
  if (!convId) throw new Error("not on a conversation page");
  const org = await getOrg();
  const res = await fetch(
    `/api/organizations/${org}/chat_conversations/${convId}/completion`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: text,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
        attachments: [],
        files: [],
        rendering_mode: "messages",
      }),
    },
  );
  if (!res.ok) throw new Error(`completion -> ${res.status}`);
  // Response is SSE; let the page's own app render it — just consume the stream.
  await res.text();
}
