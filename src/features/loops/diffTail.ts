/** Text appended to `next` since `prev` (both are capped tails of the same stream). */
export function newSince(prev: string, next: string): string {
  if (!prev) return next;
  if (next.startsWith(prev)) return next.slice(prev.length);
  // the tail window slid: find the end of prev inside next
  const anchor = prev.slice(-200);
  const i = next.lastIndexOf(anchor);
  return i >= 0 ? next.slice(i + anchor.length) : next;
}
