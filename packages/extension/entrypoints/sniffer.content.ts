import { defineContentScript } from "wxt/utils/define-content-script";

/**
 * Runs in the page's MAIN world. Wraps fetch/XHR and reports any request that
 * looks like a chat-send (POST to /api/... with a JSON body containing
 * "prompt") back to the isolated content script via postMessage.
 *
 * Purpose: learn the exact endpoint + payload shape the live web app uses, so
 * chat write-back stays correct across Anthropic's backend changes (e.g. the
 * "new Claude experience" migration, where the old completion endpoint 409s).
 */
export default defineContentScript({
  matches: ["https://claude.ai/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    const report = (url: string, body: unknown) => {
      if (typeof body !== "string") return;
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (typeof parsed?.prompt === "string" && parsed.prompt.trim()) {
          window.postMessage({ source: "cbm-sniffer", url, body: parsed }, "*");
        }
      } catch {}
    };

    const origFetch = window.fetch;
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (
          init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
        ).toUpperCase();
        if (method === "POST" && url.includes("/api/")) report(url, init?.body);
      } catch {}
      return origFetch.apply(this, [input, init] as never);
    } as typeof fetch;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { __cbm?: { method: string; url: string } },
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this.__cbm = { method: method.toUpperCase(), url: String(url) };
      return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest & { __cbm?: { method: string; url: string } },
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const meta = this.__cbm;
      if (meta?.method === "POST" && meta.url.includes("/api/")) report(meta.url, body);
      return origSend.call(this, body);
    };
  },
});
