import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { fadeVariants, popVariants } from "../../lib/motion";
import { open as openFolderDialog } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../lib/ipc";
import { autoStart } from "../../lib/actions";
import { activeWorkspace, CONSOLE_H, CONSOLE_W, nextPosition, useBoard } from "../../store/board";
import type { AgentKind, CatalogStatus } from "../../lib/types";
import { AgentIcon, CatalogIcon } from "../../components/AgentIcon";
import { profilesFor } from "../settings/profiles";
import { modelChoices } from "../../lib/models";

export interface AddConsoleModalProps {
  onClose: () => void;
  targetPos?: { x: number; y: number };
  targetGroup?: string;
}

interface CliOption {
  id: string;
  label: string;
  agent: AgentKind;
  isCatalog?: boolean;
}

export function AddConsoleModal({ onClose, targetPos, targetGroup }: AddConsoleModalProps) {
  const st = useBoard.getState();
  const ws = activeWorkspace(st.board);
  const settings = useBoard((s) => s.settings);
  const resolvedCwd = useBoard((s) => s.resolvedCwd);
  const profilesRaw = useBoard((s) => s.settings.profiles);
  const allProfiles = useMemo(() => profilesRaw ?? [], [profilesRaw]);

  const [catalog, setCatalog] = useState<CatalogStatus[]>([]);
  const [selectedCli, setSelectedCli] = useState<string>("claudeCode");
  const [title, setTitle] = useState("claude-1");
  // inside a group: default to the folder the group's consoles already use
  const groupCwd = targetGroup ? ws.consoles.find((c) => c.group === targetGroup && c.cwd)?.cwd : undefined;
  const [cwdMode, setCwdMode] = useState<"default" | "custom">(groupCwd ? "custom" : "default");
  const [customCwd, setCustomCwd] = useState(groupCwd ?? "");
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [model, setModel] = useState("");

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ipc
      .detectAgents()
      .then((d) => setCatalog(d.catalog.filter((c) => c.installed)))
      .catch(() => setCatalog([]));
  }, []);

  const cliOptions: CliOption[] = [
    { id: "claudeCode", label: "Claude Code", agent: { kind: "claudeCode" } },
    { id: "codex", label: "Codex", agent: { kind: "codex" } },
    { id: "shell", label: "Shell", agent: { kind: "custom", program: "" } },
    ...catalog.map((c) => ({
      id: c.id,
      label: c.name,
      agent: { kind: "custom" as const, program: c.program },
      isCatalog: true,
    })),
  ];

  const currentOption = cliOptions.find((c) => c.id === selectedCli) || cliOptions[0]!;
  const availableProfiles = profilesFor(currentOption.agent, allProfiles);

  const onSelectCli = (id: string) => {
    setSelectedCli(id);
    setModel("");
    setSelectedProfile("");
    const opt = cliOptions.find((c) => c.id === id);
    if (!opt) return;
    const prefix = id === "claudeCode" ? "claude" : id === "codex" ? "codex" : id === "shell" ? "shell" : id;
    const count = ws.consoles.filter((c) => c.title.startsWith(prefix)).length + 1;
    setTitle(`${prefix}-${count}`);
  };

  const browseFolder = async () => {
    const dir = await openFolderDialog({
      directory: true,
      multiple: false,
      defaultPath: customCwd || settings.defaultCwd || resolvedCwd || undefined,
    }).catch(() => null);
    if (typeof dir === "string") {
      setCustomCwd(dir);
      setCwdMode("custom");
    }
  };

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const finalTitle = title.trim() || currentOption.label;
    const finalCwd = cwdMode === "custom" ? customCwd.trim() : (settings.defaultCwd || "");
    const id = await ipc.newId();
    const pos = targetPos ?? nextPosition(ws.consoles);

    autoStart.add(id);
    useBoard.getState().addConsoles([
      {
        id,
        title: finalTitle,
        agent: currentOption.agent,
        cwd: finalCwd,
        x: pos.x,
        y: pos.y,
        width: CONSOLE_W,
        height: CONSOLE_H,
        group: targetGroup,
        profile: selectedProfile || undefined,
        model: model || undefined,
      },
    ]);
    useBoard.getState().setFocused(id);
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        variants={fadeVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-label="New Console"
      >
        <motion.div
          variants={popVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="w-full max-w-[460px] rounded-2xl border border-line-strong bg-surface p-5 shadow-[0_32px_80px_-20px_rgb(0_0_0/0.9)]"
        >
          <header className="flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-accent/20 text-accent">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </span>
              <h3 className="text-[15px] font-semibold text-ink">New Console</h3>
            </div>
            <button
              className="grid size-6 place-items-center rounded-full text-ink-3 transition hover:bg-surface-3 hover:text-ink"
              onClick={onClose}
              aria-label="Close"
            >
              <svg width="12" height="12" viewBox="0 0 10 10">
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-4">
            {/* CLI Selection */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-3 mb-1.5">
                Select Agent / CLI
              </label>
              <div className="grid grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1 [scrollbar-width:thin]">
                {cliOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onSelectCli(opt.id)}
                    className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 transition active:scale-95 ${
                      selectedCli === opt.id
                        ? "border-accent bg-accent/15 text-ink shadow-[0_0_12px_-4px_var(--color-accent)] font-semibold"
                        : "border-line bg-surface-2/60 text-ink-2 hover:bg-surface-3 hover:text-ink"
                    }`}
                  >
                    <span className="grid size-7 place-items-center rounded-lg bg-black/40">
                      {opt.isCatalog ? (
                        <CatalogIcon id={opt.id} size={15} />
                      ) : (
                        <AgentIcon agent={opt.agent.kind} size={16} />
                      )}
                    </span>
                    <span className="text-[11.5px] truncate max-w-full">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <label htmlFor="console-title" className="block text-[11px] font-bold uppercase tracking-wider text-ink-3 mb-1.5">
                Console Name
              </label>
              <input
                id="console-title"
                ref={titleInputRef}
                className="h-9 w-full rounded-xl border border-line bg-bg/80 px-3 text-[13px] font-semibold text-ink outline-none transition focus:border-accent"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. backend-api"
                required
              />
            </div>

            {modelChoices(currentOption.agent).length > 0 && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-3 mb-1.5">Model</label>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Model">
                  {modelChoices(currentOption.agent).map((m) => (
                    <button
                      key={m.id || "default"}
                      type="button"
                      role="radio"
                      aria-checked={model === m.id}
                      onClick={() => setModel(m.id)}
                      className={`h-7 rounded-full border px-3 text-[12px] transition ${
                        model === m.id ? "border-accent bg-accent/15 font-semibold text-ink" : "border-line text-ink-2 hover:bg-surface-3"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Profile Selection (if any) */}
            {availableProfiles.length > 0 && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-3 mb-1.5">
                  Account / Model Profile
                </label>
                <select
                  className="h-9 w-full rounded-xl border border-line bg-bg/80 px-3 text-[12.5px] text-ink outline-none transition focus:border-accent cursor-pointer"
                  value={selectedProfile}
                  onChange={(e) => setSelectedProfile(e.target.value)}
                >
                  <option value="">Default Profile</option>
                  {availableProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Working Directory */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-ink-3 mb-1.5">
                Working Directory
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-[12.5px] text-ink-2">
                  <input
                    type="radio"
                    name="cwd-mode"
                    checked={cwdMode === "default"}
                    onChange={() => setCwdMode("default")}
                    className="accent-accent"
                  />
                  <span>
                    Default directory <span className="font-mono text-[11px] text-ink-3">({settings.defaultCwd || resolvedCwd || "Home"})</span>
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer text-[12.5px] text-ink-2 shrink-0">
                    <input
                      type="radio"
                      name="cwd-mode"
                      checked={cwdMode === "custom"}
                      onChange={() => setCwdMode("custom")}
                      className="accent-accent"
                    />
                    <span>Custom:</span>
                  </label>
                  <input
                    className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg/80 px-2.5 font-mono text-[11.5px] text-ink outline-none transition focus:border-accent disabled:opacity-40"
                    placeholder="Choose folder…"
                    value={customCwd}
                    onChange={(e) => {
                      setCustomCwd(e.target.value);
                      setCwdMode("custom");
                    }}
                  />
                  <button
                    type="button"
                    className="h-8 rounded-lg border border-line bg-surface-2 px-3 text-[12px] font-medium text-ink-2 hover:bg-surface-3 hover:text-ink active:scale-95"
                    onClick={() => void browseFolder()}
                  >
                    Browse…
                  </button>
                </div>
              </div>
            </div>

            {/* Footer buttons */}
            <div className="mt-2 flex items-center justify-end gap-2.5 pt-2 border-t border-line">
              <button
                type="button"
                className="h-8 rounded-full border border-line bg-surface-2 px-4 text-[12.5px] font-medium text-ink-2 transition hover:bg-surface-3 hover:text-ink active:scale-95"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 rounded-full bg-accent px-5 text-[12.5px] font-semibold text-bg transition hover:brightness-110 shadow-[0_0_16px_-4px_var(--color-accent)] active:scale-95"
              >
                Create Console
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
