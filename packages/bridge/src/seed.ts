import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Transcript } from "@cbm/shared";
import { configDir } from "./config.js";

const MAX_INLINE_CHARS = 60_000;

export function transcriptToMarkdown(t: Transcript): string {
  const lines: string[] = [];
  for (const turn of t.turns) {
    const who = turn.role === "human" ? "User" : "Claude";
    lines.push(`**${who}:**`, "", turn.text, "");
  }
  return lines.join("\n").trim();
}

/** Write the full transcript to a file under the app config dir; returns path. */
export function writeTranscriptFile(t: Transcript): string {
  const dir = join(configDir(), "transcripts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${t.convId}-${Date.now()}.md`);
  writeFileSync(file, `# Claude chat transcript\n\nSource: ${t.convUrl}\nTitle: ${t.title}\n\n${transcriptToMarkdown(t)}\n`);
  return file;
}

/**
 * Build the first user message that seeds the agent with the chat context.
 * Long transcripts are referenced by file path instead of inlined.
 */
export function buildSeedMessage(t: Transcript, transcriptFile: string, prompt?: string): string {
  const md = transcriptToMarkdown(t);
  const inline = md.length <= MAX_INLINE_CHARS;
  const context = inline
    ? `Here is the full transcript:\n\n${md}`
    : `The full transcript is saved at ${transcriptFile} — read it with the Read tool first.`;

  return [
    "You are continuing work that started in a Claude chat conversation on claude.ai.",
    `Conversation title: ${t.title || "(untitled)"}`,
    "",
    context,
    "",
    "The user has now switched into build mode. Pick up where the conversation left off.",
    prompt
      ? `The user's immediate instruction: ${prompt}`
      : "Infer the agreed task from the transcript. If it is ambiguous, ask one short clarifying question before making changes.",
  ].join("\n");
}
