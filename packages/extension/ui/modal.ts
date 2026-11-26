import type { PermissionProfile } from "@cbm/shared";
import { MODAL_CSS } from "./styles";

export interface StartOptions {
  cwd: string;
  profile: PermissionProfile;
  prompt: string;
}

export interface ModalResult {
  kind: "start";
  opts: StartOptions;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface ModalDeps {
  authed: boolean;
  defaultDir: string;
  onSaveToken: (token: string) => Promise<void>;
}

export function openStartModal(deps: ModalDeps): Promise<ModalResult | null> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = MODAL_CSS;
    shadow.appendChild(style);

    const overlay = el("div", "cbm-overlay");
    const modal = el("div", "cbm-modal");
    const done = (v: ModalResult | null) => {
      host.remove();
      resolve(v);
    };

    modal.append(el("h2", "", "Start building"));
    modal.append(el("p", "sub", "This conversation becomes context for a local Claude Code session — same page, your own plan, no API credits."));

    if (!deps.authed) {
      const warn = el("div", "cbm-warn");
      warn.innerHTML =
        "Can't reach the local bridge.<br>1. Run <code>npx @cbm/bridge</code> (or your dev bridge)<br>2. Paste the token from <code>~/.config/claude-build-mode/bridge.json</code> below.";
      modal.appendChild(warn);
      const field = el("div", "cbm-field");
      field.append(el("label", "", "Bridge token"));
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "paste token…";
      field.appendChild(input);
      modal.appendChild(field);
      const row = el("div", "cbm-row");
      const cancel = el("button", "cbm-btn ghost", "Cancel") as HTMLButtonElement;
      cancel.onclick = () => done(null);
      const save = el("button", "cbm-btn", "Save & retry") as HTMLButtonElement;
      save.onclick = async () => {
        await deps.onSaveToken(input.value.trim());
        done(null);
      };
      row.append(cancel, save);
      modal.appendChild(row);
    } else {
      const dirField = el("div", "cbm-field");
      dirField.append(el("label", "", "Project folder"));
      const dirInput = document.createElement("input");
      dirInput.type = "text";
      dirInput.value = deps.defaultDir;
      dirInput.placeholder = "~/projects/my-app";
      dirField.appendChild(dirInput);
      dirField.append(el("div", "hint", "The agent reads, edits, and runs commands here."));
      modal.appendChild(dirField);

      const profField = el("div", "cbm-field");
      profField.append(el("label", "", "Permissions"));
      const select = document.createElement("select");
      for (const [v, label] of [
        ["prompt", "Ask before each risky action"],
        ["acceptEdits", "Auto-accept file edits"],
        ["plan", "Plan only — don't change anything"],
      ] as const) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        select.appendChild(o);
      }
      profField.appendChild(select);
      modal.appendChild(profField);

      const promptField = el("div", "cbm-field");
      promptField.append(el("label", "", "First instruction (optional)"));
      const ta = document.createElement("textarea");
      ta.placeholder = "e.g. Build the CLI we just designed — start with the parser.";
      promptField.appendChild(ta);
      promptField.append(el("div", "hint", "Leave blank and the agent infers the task from the chat."));
      modal.appendChild(promptField);

      const row = el("div", "cbm-row");
      const cancel = el("button", "cbm-btn ghost", "Cancel") as HTMLButtonElement;
      cancel.onclick = () => done(null);
      const go = el("button", "cbm-btn", "Start building") as HTMLButtonElement;
      go.onclick = () => {
        const cwd = dirInput.value.trim();
        if (!cwd) return;
        done({ kind: "start", opts: { cwd, profile: select.value as PermissionProfile, prompt: ta.value.trim() } });
      };
      row.append(cancel, go);
      modal.appendChild(row);
      setTimeout(() => dirInput.focus(), 30);
    }

    overlay.appendChild(modal);
    shadow.appendChild(overlay);
    document.documentElement.appendChild(host);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
  });
}
