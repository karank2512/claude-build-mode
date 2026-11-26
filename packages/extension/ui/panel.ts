import type { PermissionRequest, ServerMessage } from "@cbm/shared";
import { PANEL_CSS } from "./styles";

export interface PanelCallbacks {
  onSteer: (text: string) => void;
  onPermission: (requestId: string, decision: "allow" | "deny" | "always") => void;
  onStop: () => void;
  onClose: () => void;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function summarizeInput(input: Record<string, unknown>): string {
  const cand =
    (input.file_path as string) ??
    (input.command as string) ??
    (input.path as string) ??
    (input.pattern as string) ??
    (input.url as string) ??
    (input.query as string);
  if (cand) return String(cand).slice(0, 300);
  const s = JSON.stringify(input);
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}

export class BuildPanel {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private log: HTMLElement;
  private input: HTMLInputElement;
  private statusEl: HTMLElement;
  private metaEl: HTMLElement;
  private dot: HTMLElement;
  private pendingPerms = new Map<string, HTMLElement>();
  private cb: PanelCallbacks;

  constructor(cb: PanelCallbacks) {
    this.cb = cb;
    this.host = document.createElement("div");
    this.host.id = "cbm-panel-host";
    this.shadow = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    this.shadow.appendChild(style);

    const root = el("div", "cbm-root");
    const header = el("div", "cbm-header");
    this.dot = el("span", "cbm-dot off");
    const title = el("span", "title", "Build mode");
    const stopBtn = el("button", "cbm-btn ghost", "Stop") as HTMLButtonElement;
    stopBtn.onclick = () => this.cb.onStop();
    const closeBtn = el("button", "cbm-btn ghost", "×") as HTMLButtonElement;
    closeBtn.onclick = () => this.cb.onClose();
    header.append(this.dot, title, stopBtn, closeBtn);

    this.log = el("div", "cbm-log");
    this.statusEl = el("div", "cbm-sys");
    this.metaEl = el("div", "cbm-meta", "");

    const footer = el("div", "cbm-footer");
    this.input = document.createElement("input");
    this.input.placeholder = "Steer the build…";
    this.input.onkeydown = (e) => {
      if (e.key === "Enter" && this.input.value.trim()) {
        this.cb.onSteer(this.input.value.trim());
        this.input.value = "";
      }
    };
    const sendBtn = el("button", "cbm-btn", "Send") as HTMLButtonElement;
    sendBtn.onclick = () => {
      if (this.input.value.trim()) {
        this.cb.onSteer(this.input.value.trim());
        this.input.value = "";
      }
    };
    footer.append(this.input, sendBtn);

    root.append(header, this.log, this.statusEl, footer, this.metaEl);
    this.shadow.appendChild(root);
  }

  mount(): void {
    document.documentElement.appendChild(this.host);
  }

  destroy(): void {
    this.host.remove();
  }

  setConnected(ok: boolean): void {
    this.dot.classList.toggle("off", !ok);
  }

  private scroll(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }

  private add(node: HTMLElement): void {
    this.log.appendChild(node);
    this.scroll();
  }

  sys(text: string): void {
    this.add(el("div", "cbm-sys", text));
  }

  error(text: string): void {
    this.add(el("div", "cbm-err", text));
  }

  private assistantText(text: string): void {
    if (!text.trim()) return;
    this.add(el("div", "cbm-msg", text));
  }

  private toolUse(name: string, input: Record<string, unknown>): void {
    const box = el("div", "cbm-tool");
    box.append(el("span", "name", name), document.createTextNode(" "));
    box.append(el("span", "arg", summarizeInput(input)));
    this.add(box);
  }

  private permCard(r: PermissionRequest): void {
    const card = el("div", "cbm-perm");
    card.append(el("div", "ptitle", `${r.toolName} wants to run`));
    if (r.description) card.append(el("div", "cbm-sys", r.description));
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(r.input, null, 2).slice(0, 2000);
    card.appendChild(pre);
    const row = el("div", "prow");
    const allow = el("button", "cbm-btn", "Allow") as HTMLButtonElement;
    const always = el("button", "cbm-btn ghost", "Always") as HTMLButtonElement;
    const deny = el("button", "cbm-btn deny", "Deny") as HTMLButtonElement;
    const finish = (d: "allow" | "deny" | "always") => {
      this.pendingPerms.delete(r.requestId);
      card.remove();
      this.cb.onPermission(r.requestId, d);
    };
    allow.onclick = () => finish("allow");
    always.onclick = () => finish("always");
    deny.onclick = () => finish("deny");
    row.append(allow, always, deny);
    card.appendChild(row);
    this.pendingPerms.set(r.requestId, card);
    this.add(card);
  }

  handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "agent_event": {
        const e = msg.event;
        if (e.type === "assistant") {
          for (const b of e.message?.content ?? []) {
            if (b.type === "text" && typeof b.text === "string") this.assistantText(b.text);
            else if (b.type === "tool_use")
              this.toolUse(String(b.name ?? "tool"), (b.input as Record<string, unknown>) ?? {});
          }
        } else if (e.type === "system" && e.subtype === "init") {
          this.sys(`connected · ${e.cwd ?? ""}`);
        } else if (e.type === "system" && e.subtype === "permission_denied") {
          this.error("a tool call was denied");
        } else if (e.type === "result") {
          const cost = typeof e.total_cost_usd === "number" ? ` · $${e.total_cost_usd.toFixed(3)}` : "";
          const r = el("div", "cbm-result", `${e.is_error ? "failed" : "done"}${cost}`);
          this.add(r);
          this.metaEl.textContent = "";
        } else if (e.type === "rate_limit_event") {
          /* noisy — skip */
        }
        break;
      }
      case "permission_request":
        this.permCard(msg.request);
        break;
      case "session_ended":
        this.sys(`agent stopped${msg.code !== null ? ` (code ${msg.code})` : ""}`);
        break;
      case "error":
        this.error(msg.message);
        break;
      case "session_started":
        this.sys("build session started — the agent has the chat transcript");
        break;
    }
  }
}
