// Tiny event bus so other features (group header "Broadcast") can focus the command bar.
export const COMMAND_FOCUS_EVENT = "openboard:focus-command";

export function focusCommandBar(prefill = "") {
  window.dispatchEvent(new CustomEvent<string>(COMMAND_FOCUS_EVENT, { detail: prefill }));
}
