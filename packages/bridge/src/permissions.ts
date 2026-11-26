import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { PermissionRequest } from "@cbm/shared";

export type AskHandler = (req: PermissionRequest) => Promise<"allow" | "deny" | "always">;

const ASK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Stateless MCP-over-HTTP endpoint exposing the `ask` tool that claude calls
 * via --permission-prompt-tool for every decision that needs a human.
 * Verdicts come from the extension UI through the bridge's WebSocket channel.
 */
export function makeMcpHandler(ask: AskHandler) {
  return async function handleMcp(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const server = new McpServer({ name: "cbm", version: "0.1.0" });
    server.registerTool(
      "ask",
      {
        title: "Ask the user for tool permission",
        description:
          "Called by Claude Code when a tool call needs user approval. Returns the user's decision.",
        inputSchema: {
          tool_name: z.string().describe("Name of the tool requesting permission"),
          input: z.record(z.any()).optional().describe("Tool input parameters"),
          description: z.string().optional().describe("Why permission is needed"),
        },
      },
      async (args) => {
        const request: PermissionRequest = {
          requestId: randomUUID(),
          sessionId: "",
          toolName: String(args.tool_name ?? "unknown"),
          input: (args.input as Record<string, unknown>) ?? {},
          description: args.description ? String(args.description) : undefined,
        };
        let decision: "allow" | "deny" | "always" = "deny";
        try {
          decision = await Promise.race([
            ask(request),
            new Promise<"deny">((resolve) => setTimeout(() => resolve("deny"), ASK_TIMEOUT_MS)),
          ]);
        } catch {
          decision = "deny";
        }
        const verdict =
          decision === "deny"
            ? { behavior: "deny", message: "User declined via build-mode panel" }
            : { behavior: "allow", updatedInput: request.input };
        return { content: [{ type: "text" as const, text: JSON.stringify(verdict) }] };
      },
    );

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    }
  };
}
