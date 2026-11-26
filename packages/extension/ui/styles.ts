export const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.cbm-root {
  position: fixed; top: 0; right: 0; bottom: 0; width: 380px; z-index: 2147483646;
  display: flex; flex-direction: column;
  background: #faf9f7; color: #1f1e1d;
  border-left: 1px solid #e3e0dc; box-shadow: -8px 0 24px rgba(0,0,0,.12);
  font-size: 13px; line-height: 1.45;
}
.cbm-header {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px;
  background: #1f1e1d; color: #faf9f7;
}
.cbm-header .title { font-weight: 600; flex: 1; font-size: 13px; }
.cbm-dot { width: 8px; height: 8px; border-radius: 50%; background: #d97757; }
.cbm-dot.off { background: #8a8580; }
.cbm-btn {
  border: 0; border-radius: 6px; padding: 4px 10px; cursor: pointer;
  background: #d97757; color: #fff; font-size: 12px; font-weight: 500;
}
.cbm-btn.ghost { background: transparent; color: #cfc9c2; border: 1px solid #4a4642; }
.cbm-btn.ghost:hover { color: #fff; }
.cbm-btn.deny { background: transparent; border: 1px solid #b3462e; color: #b3462e; }
.cbm-log { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.cbm-msg { white-space: pre-wrap; word-break: break-word; }
.cbm-tool {
  background: #f0ede9; border: 1px solid #e3e0dc; border-radius: 6px;
  padding: 6px 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
}
.cbm-tool .name { color: #b3462e; font-weight: 600; }
.cbm-tool .arg { color: #57534d; }
.cbm-sys { color: #8a8580; font-size: 11.5px; font-style: italic; }
.cbm-err { background: #fdecea; border: 1px solid #f5c6c0; color: #8f2d1f; border-radius: 6px; padding: 6px 8px; }
.cbm-perm {
  background: #fff; border: 1.5px solid #d97757; border-radius: 8px; padding: 8px;
  display: flex; flex-direction: column; gap: 6px;
}
.cbm-perm .ptitle { font-weight: 600; }
.cbm-perm pre {
  margin: 0; background: #f0ede9; border-radius: 4px; padding: 6px;
  max-height: 140px; overflow: auto; font-size: 11.5px; white-space: pre-wrap; word-break: break-word;
}
.cbm-perm .prow { display: flex; gap: 6px; }
.cbm-result { color: #4f8a52; font-weight: 600; }
.cbm-diff {
  margin: 0; background: #1f1e1d; border-radius: 6px; padding: 7px 9px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  line-height: 1.5; overflow-x: auto; max-height: 220px; overflow-y: auto;
}
.cbm-diff .dp { color: #7bc98c; }
.cbm-diff .dm { color: #e8837a; }
.cbm-diff .dc { color: #8a8580; }
.cbm-diff .dfile { color: #d9a657; font-weight: 600; display: block; margin-bottom: 2px; }
.cbm-footer { border-top: 1px solid #e3e0dc; padding: 8px 12px; display: flex; gap: 6px; }
.cbm-footer input {
  flex: 1; border: 1px solid #d8d4cf; border-radius: 6px; padding: 6px 8px;
  font-size: 13px; background: #fff; color: #1f1e1d;
}
.cbm-meta { padding: 4px 12px; font-size: 11px; color: #8a8580; border-top: 1px solid #e3e0dc; }
`;

export const BUTTON_CSS = `
:host { all: initial; }
.cbm-fab {
  position: fixed; right: 24px; bottom: 96px; z-index: 2147483645;
  display: flex; align-items: center; gap: 7px;
  background: #1f1e1d; color: #faf9f7;
  border: 0; border-radius: 999px; padding: 9px 16px; cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px; font-weight: 600;
  box-shadow: 0 4px 14px rgba(0,0,0,.22);
}
.cbm-fab:hover { background: #d97757; }
.cbm-fab.building { background: #d97757; }
`;

export const MODAL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.cbm-overlay {
  position: fixed; inset: 0; z-index: 2147483646; background: rgba(15,14,13,.45);
  display: flex; align-items: center; justify-content: center;
}
.cbm-modal {
  width: 440px; background: #faf9f7; border-radius: 12px; padding: 20px;
  box-shadow: 0 20px 60px rgba(0,0,0,.3); color: #1f1e1d; font-size: 13px;
}
.cbm-modal h2 { margin: 0 0 4px; font-size: 16px; }
.cbm-modal .sub { color: #8a8580; margin: 0 0 14px; font-size: 12.5px; }
.cbm-field { margin-bottom: 12px; }
.cbm-field label { display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px; }
.cbm-field input[type="text"], .cbm-field select, .cbm-field textarea {
  width: 100%; border: 1px solid #d8d4cf; border-radius: 6px; padding: 7px 9px;
  font-size: 13px; background: #fff; color: #1f1e1d;
}
.cbm-field textarea { resize: vertical; min-height: 56px; }
.cbm-field .hint { font-size: 11px; color: #8a8580; margin-top: 3px; }
.cbm-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.cbm-btn { border: 0; border-radius: 6px; padding: 7px 14px; cursor: pointer; background: #d97757; color: #fff; font-size: 13px; font-weight: 600; }
.cbm-btn.ghost { background: transparent; border: 1px solid #d8d4cf; color: #57534d; }
.cbm-btn:disabled { opacity: .45; cursor: not-allowed; }
.cbm-warn { background: #fdf3e7; border: 1px solid #f0d9b8; color: #8a5a1e; border-radius: 6px; padding: 8px; font-size: 12px; margin-bottom: 12px; }
.cbm-warn code { background: #f5e6cd; padding: 1px 4px; border-radius: 3px; }
`;
