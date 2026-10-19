import { useEffect } from "react";
import { displayStatus, useBoard } from "../../store/board";
import { trackNeedsSince } from "./inbox";

/** Stamp when each console entered needsYou (drives the inbox order / "2m ago"). */
export function useNeedsSince() {
  useEffect(() => {
    const sync = () => {
      const s = useBoard.getState();
      const needing = Object.keys(s.runtime).filter((id) => displayStatus(s.runtime[id]) === "needsYou");
      const next = trackNeedsSince(s.needsSince, needing, Date.now());
      if (next !== s.needsSince) useBoard.setState({ needsSince: next });
    };
    sync();
    return useBoard.subscribe((s, prev) => {
      if (s.runtime !== prev.runtime) sync();
    });
  }, []);
}
