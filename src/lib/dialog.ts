import { create } from "zustand";

export interface DialogState {
  open: boolean;
  title?: string;
  message: string;
  kind?: "danger" | "warning" | "info";
  confirmText?: string;
  cancelText?: string;
  resolve?: (value: boolean) => void;
}

export const useDialogStore = create<{
  dialog: DialogState | null;
  show: (state: Omit<DialogState, "open" | "resolve">) => Promise<boolean>;
  respond: (ok: boolean) => void;
}>((set, get) => ({
  dialog: null,
  show: (opts) => {
    return new Promise<boolean>((resolve) => {
      const prev = get().dialog;
      if (prev?.resolve) prev.resolve(false);

      set({
        dialog: {
          ...opts,
          open: true,
          resolve,
        },
      });
    });
  },
  respond: (ok: boolean) => {
    const cur = get().dialog;
    if (cur?.resolve) cur.resolve(ok);
    set({ dialog: null });
  },
}));

export async function ask(
  message: string,
  options?: { title?: string; kind?: "danger" | "warning" | "info"; confirmText?: string; cancelText?: string },
): Promise<boolean> {
  return useDialogStore.getState().show({
    message,
    title: options?.title,
    kind: options?.kind ?? "warning",
    confirmText: options?.confirmText ?? "OK",
    cancelText: options?.cancelText ?? "Cancel",
  });
}

export async function confirm(
  message: string,
  options?: { title?: string; kind?: "danger" | "warning" | "info"; confirmText?: string; cancelText?: string },
): Promise<boolean> {
  return ask(message, options);
}
