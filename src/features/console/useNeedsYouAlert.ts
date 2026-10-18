import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { displayStatus, useBoard } from "../../store/board";
import { shouldNotify } from "./helpers";

/** Fires an OS notification + taskbar attention when this console transitions into needsYou. */
export function useNeedsYouAlert(id: string, title: string) {
  const status = useBoard((s) => displayStatus(s.runtime[id]));
  const prev = useRef<string | undefined>(undefined);
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => {
    const before = prev.current;
    prev.current = status;
    if (before === undefined) return; // initial mount is not a transition
    if (!useBoard.getState().settings.notifyNeedsYou) return;
    if (!shouldNotify(before, status, document.hasFocus())) return;
    void (async () => {
      try {
        let ok = await isPermissionGranted();
        if (!ok) ok = (await requestPermission()) === "granted";
        if (ok) sendNotification({ title: "Agent Board", body: `${titleRef.current} needs you` });
      } catch {
        /* notifications unavailable */
      }
      try {
        await getCurrentWindow().requestUserAttention(2);
      } catch {
        /* not supported */
      }
    })();
  }, [status]);
}
