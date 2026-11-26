import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: ".",
  outDir: "dist",
  manifest: {
    name: "Build Mode for Claude",
    short_name: "BuildMode",
    description:
      "One-click switch from a Claude chat to a local Claude Code build session — same page, same context, your own plan.",
    version: "0.1.0",
    permissions: ["storage", "alarms", "nativeMessaging"],
    host_permissions: [
      "https://claude.ai/*",
      "http://127.0.0.1:17819/*",
      "http://localhost:17819/*",
      "ws://127.0.0.1:17819/*",
      "ws://localhost:17819/*",
    ],
    action: {
      default_title: "Build Mode",
    },
  },
});
