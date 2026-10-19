// Pure helpers for multi-selection (unit-tested).
export type SelKind = "console" | "tile" | "group" | "section";

const NOUN: Record<SelKind, [string, string]> = {
  console: ["console", "consoles"],
  tile: ["tile", "tiles"],
  group: ["group", "groups"],
  section: ["section", "sections"],
};

/** "3 consoles, 1 tile" — fixed order, empty kinds omitted. */
export function summarizeSelection(sel: { type: SelKind }[]): string {
  const parts: string[] = [];
  for (const k of ["console", "tile", "group", "section"] as SelKind[]) {
    const n = sel.filter((s) => s.type === k).length;
    if (n) parts.push(`${n} ${NOUN[k][n === 1 ? 0 : 1]}`);
  }
  return parts.join(", ") || "nothing";
}
