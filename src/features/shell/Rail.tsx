import type { ReactNode } from "react";
import { useReactFlow } from "@xyflow/react";
import { useBoard } from "../../store/board";

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`rail-btn relative grid size-10 place-items-center rounded-full transition duration-150 active:scale-95 ${
        active
          ? "active bg-surface-3 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong),0_0_16px_-6px_var(--color-accent)]"
          : "text-ink-3 hover:bg-surface-2 hover:text-ink"
      }`}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <svg className="size-[19px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

export function Rail() {
  const { fitView } = useReactFlow();
  const memoryOpen = useBoard((s) => s.ui.memoryOpen);
  const settingsOpen = useBoard((s) => s.ui.settingsOpen);
  const setUi = useBoard.getState().setUi;

  return (
    <nav className="rail flex w-16 shrink-0 flex-col items-center gap-2 border-r border-line/60 bg-bg py-4" aria-label="Main">
      <RailButton label="Board" active={!memoryOpen && !settingsOpen}>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="5" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
        <rect x="13" y="10" width="8" height="11" rx="2" />
      </RailButton>
      <RailButton label="Memory" active={memoryOpen} onClick={() => setUi({ memoryOpen: true })}>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M14 3v5h5M9 13h7M9 17h5" />
      </RailButton>
      <RailButton label="Fit all" onClick={() => void fitView({ duration: 300 })}>
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </RailButton>
      <div className="flex-1" />
      <RailButton label="Settings" active={settingsOpen} onClick={() => setUi({ settingsOpen: true })}>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </RailButton>
    </nav>
  );
}
