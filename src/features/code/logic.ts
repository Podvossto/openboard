// Pure Code-studio helpers (no React / CodeMirror) — unit-tested in logic.test.ts.
import type { FsEntry } from "../../lib/types";

export type LangId = "ts" | "tsx" | "js" | "jsx" | "rust" | "json" | "markdown" | "css" | "html" | "python" | "text";

const EXT: Record<string, LangId> = {
  ts: "ts", mts: "ts", cts: "ts", tsx: "tsx", js: "js", mjs: "js", cjs: "js", jsx: "jsx",
  rs: "rust", json: "json", jsonc: "json", md: "markdown", markdown: "markdown",
  css: "css", html: "html", htm: "html", svg: "html", py: "python", pyi: "python",
};

export const LANG_LABEL: Record<LangId, string> = {
  ts: "TypeScript", tsx: "TypeScript JSX", js: "JavaScript", jsx: "JavaScript JSX", rust: "Rust",
  json: "JSON", markdown: "Markdown", css: "CSS", html: "HTML", python: "Python", text: "Plain text",
};

export const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
export const extOf = (p: string) => {
  const n = baseName(p);
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(i + 1).toLowerCase() : "";
};
export const langOf = (p: string): LangId => EXT[extOf(p)] ?? "text";

const COLORS: Record<string, string> = {
  ts: "#5aa8ff", tsx: "#5aa8ff", js: "#f2d45a", jsx: "#f2d45a", rs: "#ff8a5c", json: "#ffb547",
  md: "#a9aab6", css: "#c792ea", html: "#e8784b", py: "#7bd389", toml: "#ff8a5c", yml: "#ff6b6b", yaml: "#ff6b6b",
};
/** Accent color of the file-type glyph. */
export const fileColor = (name: string) => COLORS[extOf(name)] ?? "#6c6d7a";

/** Tree filter: entries whose name contains `q` (case-insensitive). Empty q keeps everything. */
export function filterEntries(entries: FsEntry[], q: string): FsEntry[] {
  const s = q.trim().toLowerCase();
  return s ? entries.filter((e) => e.name.toLowerCase().includes(s)) : entries;
}

/** Parent folder chain of a file: "a/b/c.ts" → ["a", "a/b"]. */
export function parentDirs(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** Show the last two segments of a folder path. */
export const rootLabel = (root: string) => root.split(/[\\/]/).filter(Boolean).slice(-2).join("/") || root;

/** Folder the studio should start in: focused console cwd → default cwd setting → resolved default. */
export function pickRoot(focusedCwd: string | undefined, defaultCwd: string, resolvedCwd: string): string {
  return (focusedCwd ?? "").trim() || defaultCwd.trim() || resolvedCwd;
}

/** Relative path is safe to send to the backend (defence in depth; backend re-validates). */
export function isSafeRel(rel: string): boolean {
  if (rel.startsWith("/") || rel.startsWith("\\") || /^[a-z]:/i.test(rel)) return false;
  return !rel.split(/[\\/]/).includes("..");
}

export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
