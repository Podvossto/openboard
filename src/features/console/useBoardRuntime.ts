import { useEffect } from "react";
import { events } from "../../lib/ipc";
import { useBoard } from "../../store/board";

/** Global listeners: status / exit / hook log + Claude session-id updates. */
export function useBoardRuntime() {
  useEffect(() => {
    const subs = [
      events.onStatus(({ id, status }) => useBoard.getState().setRuntime(id, { status })),
      events.onExit(({ id, code }) =>
        useBoard.getState().setRuntime(id, { running: false, status: "exited", exitCode: code }),
      ),
      events.onHook(({ id, event, session }) => {
        const st = useBoard.getState();
        st.pushHook(id, event);
        // Claude rotates session ids on /clear etc. — keep the latest for resume.
        if (!session) return;
        const c = st.board.workspaces.flatMap((w) => w.consoles).find((x) => x.id === id);
        if (c && c.agentSession !== session) st.patchConsole(id, { agentSession: session });
      }),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);
}
