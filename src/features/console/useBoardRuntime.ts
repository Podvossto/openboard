import { useEffect } from "react";
import { events } from "../../lib/ipc";
import { useBoard } from "../../store/board";

/** Global listeners: status / exit / Claude session-id updates. */
export function useBoardRuntime() {
  useEffect(() => {
    const subs = [
      events.onStatus(({ id, status }) => useBoard.getState().setRuntime(id, { status })),
      events.onExit(({ id, code }) =>
        useBoard.getState().setRuntime(id, { running: false, status: "exited", exitCode: code }),
      ),
      // Claude rotates session ids on /clear etc. — keep the latest for resume.
      events.onSession(({ id, session }) => {
        const c = useBoard.getState().workspace.consoles.find((x) => x.id === id);
        if (c && c.agentSession !== session) useBoard.getState().patchConsole(id, { agentSession: session });
      }),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);
}
