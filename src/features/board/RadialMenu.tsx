import { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence, useIsPresent } from "motion/react";
import { spring } from "../../lib/motion";
import { createConsole } from "../../lib/actions";
import { addTile } from "../tiles/addTile";
import { DEFAULT_PEN } from "../ink/InkToolbar";
import { activeWorkspace, useBoard } from "../../store/board";
import { newSectionAt } from "./sections";
import { useReactFlow } from "@xyflow/react";
import type { TileKind } from "../../lib/types";

export interface RadialMenuProps {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  onClose: () => void;
  onOpenAddConsoleDialog?: (pos: { x: number; y: number }) => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: (size?: number) => ReactNode;
  color: string;
  action: () => void;
}

const RADIUS = 88;

export function RadialMenu({ x, y, flowX, flowY, onClose, onOpenAddConsoleDialog }: RadialMenuProps) {
  const rf = useReactFlow();
  const present = useIsPresent();
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-radial-menu]")) onClose();
    };
    // capture phase: a focused textarea/terminal must not swallow Esc
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  const addTileAt = (kind: TileKind) => {
    onClose();
    void addTile(kind, rf, { at: { x: flowX - 160, y: flowY - 120 } });
  };

  const items: MenuItem[] = [
    {
      id: "console",
      label: "+ Console",
      color: "#ffb547",
      icon: (s = 16) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      ),
      action: () => {
        onClose();
        if (onOpenAddConsoleDialog) {
          onOpenAddConsoleDialog({ x: flowX, y: flowY });
        } else {
          void createConsole(undefined, { cwd: "" });
        }
      },
    },
    {
      id: "kanban",
      label: "+ Kanban",
      color: "#8ea2ff",
      icon: (s = 16) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="5" height="18" rx="1" />
          <rect x="11" y="3" width="5" height="12" rx="1" />
          <rect x="19" y="3" width="5" height="15" rx="1" />
        </svg>
      ),
      action: () => addTileAt("kanban"),
    },
    {
      id: "note",
      label: "+ Note",
      color: "#f2d45a",
      icon: (s = 16) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
      action: () => addTileAt("note"),
    },
    {
      id: "calendar",
      label: "+ Calendar",
      color: "#4fd1a1",
      icon: (s = 16) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
      action: () => addTileAt("calendar"),
    },
    {
      id: "web",
      label: "+ Web",
      color: "#5fd4d4",
      icon: (s = 16) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
      ),
      action: () => addTileAt("web"),
    },
    {
      id: "code",
      label: "+ Code",
      color: "#b48cff",
      icon: (s = 16) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      ),
      action: () => addTileAt("code"),
    },
    {
      id: "git",
      label: "+ Git",
      color: "#ff7a6b",
      icon: (s = 16) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <line x1="6" y1="9" x2="6" y2="15" />
          <path d="M18 9a9 9 0 01-9 9" />
          <circle cx="18" cy="9" r="3" />
        </svg>
      ),
      action: () => addTileAt("git"),
    },
    {
      id: "section",
      label: "+ Section",
      color: "#6fd0e8",
      icon: (s = 16) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" strokeDasharray="3 3" />
          <line x1="3" y1="9" x2="10" y2="9" />
        </svg>
      ),
      action: () => {
        onClose();
        const st = useBoard.getState();
        const secs = activeWorkspace(st.board).sections ?? [];
        st.addSection(newSectionAt(`sec-${crypto.randomUUID().slice(0, 8)}`, flowX, flowY, secs));
      },
    },
    {
      id: "draw",
      label: "Ink / Draw",
      color: "#e57ad8",
      icon: (s = 16) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <path d="M2 2l7.586 7.586" />
          <circle cx="11" cy="11" r="2" />
        </svg>
      ),
      action: () => {
        onClose();
        useBoard.getState().setUi({ ink: DEFAULT_PEN });
      },
    },
  ];

  const activeItem = items.find((it) => it.id === hovered);

  return (
    <div
      data-radial-menu
      className={`fixed z-[90] select-none ${present ? "pointer-events-auto" : "pointer-events-none"}`}
      style={{ left: x, top: y }}
      role={present ? "menu" : undefined}
      aria-label={present ? "Radial context menu" : undefined}
    >
      {/* Outer blurred backdrop ring */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.6, opacity: 0, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
        transition={spring.snappy}
        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none rounded-full bg-black/40 backdrop-blur-md border border-line/50 shadow-[0_16px_50px_rgba(0,0,0,0.85)]"
        style={{ width: RADIUS * 2 + 70, height: RADIUS * 2 + 70 }}
      />

      {/* Center hub */}
      <motion.button
        type="button"
        initial={{ scale: 0, rotate: -45 }}
        animate={{ scale: 1, rotate: 0 }}
        exit={{ scale: 0, rotate: -45, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
        transition={spring.soft}
        onClick={onClose}
        className="absolute -translate-x-1/2 -translate-y-1/2 size-12 rounded-full border border-line-strong bg-surface flex flex-col items-center justify-center text-ink shadow-lg z-10 transition hover:bg-surface-2 hover:border-accent active:scale-95"
        title="Tools menu (click or Esc to close)"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-accent leading-none">+ Tools</span>
      </motion.button>

      {/* Floating tooltip badge */}
      <AnimatePresence>
        {activeItem && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.9 }}
            transition={{ duration: 0.12 }}
            className="absolute -translate-x-1/2 pointer-events-none z-20 whitespace-nowrap rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-[11.5px] font-semibold text-ink shadow-xl"
            style={{ top: RADIUS + 42 }}
          >
            <span style={{ color: activeItem.color }}>●</span> {activeItem.label}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Radial items */}
      {items.map((item, i) => {
        const angle = (i * 2 * Math.PI) / items.length - Math.PI / 2;
        const targetX = Math.round(Math.cos(angle) * RADIUS);
        const targetY = Math.round(Math.sin(angle) * RADIUS);

        return (
          <motion.button
            key={item.id}
            type="button"
            role="menuitem"
            initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
            animate={{
              x: targetX,
              y: targetY,
              scale: hovered === item.id ? 1.15 : 1,
              opacity: 1,
            }}
            exit={{ x: 0, y: 0, scale: 0, opacity: 0, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
            transition={{
              ...spring.soft,
              delay: i * 0.015,
            }}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered((h) => (h === item.id ? null : h))}
            onClick={item.action}
            style={{
              ["--item-color" as string]: item.color,
              boxShadow: hovered === item.id ? `0 0 16px -2px ${item.color}, 0 4px 12px rgba(0,0,0,0.6)` : "0 4px 12px rgba(0,0,0,0.6)",
            }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 size-10 rounded-full border border-line bg-surface flex items-center justify-center text-ink-2 transition-colors duration-150 ${
              hovered === item.id ? "border-[var(--item-color)] text-ink bg-surface-3" : "hover:text-ink"
            }`}
            title={item.label}
            aria-label={item.label}
          >
            <span style={{ color: hovered === item.id ? item.color : undefined }}>
              {item.icon(17)}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
