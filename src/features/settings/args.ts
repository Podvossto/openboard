/** Split a command-line-ish string into args; supports "double" and 'single' quotes. */
export function parseArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

/** Inverse of parseArgs: quote args containing whitespace or quotes. */
export function formatArgs(args: string[]): string {
  return args
    .map((a) => {
      if (a === "") return '""';
      if (!/[\s"']/.test(a)) return a;
      return a.includes('"') ? `'${a}'` : `"${a}"`;
    })
    .join(" ");
}

export function clampFont(n: number): number {
  if (!Number.isFinite(n)) return 13;
  return Math.max(10, Math.min(20, Math.round(n)));
}
