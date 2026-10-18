// Pure ink geometry (unit-tested).

/** Drop points closer than `minDist` to the previous kept point (keeps first/last). */
export function simplify(points: number[], minDist = 1.5): number[] {
  if (points.length <= 4) return points.slice();
  const out = [points[0]!, points[1]!];
  for (let i = 2; i < points.length - 2; i += 2) {
    const dx = points[i]! - out[out.length - 2]!;
    const dy = points[i + 1]! - out[out.length - 1]!;
    if (dx * dx + dy * dy >= minDist * minDist) out.push(points[i]!, points[i + 1]!);
  }
  out.push(points[points.length - 2]!, points[points.length - 1]!);
  return out.map((v) => Math.round(v * 10) / 10);
}

/** Smooth SVG path through points using quadratic curves between midpoints. */
export function toPath(p: number[]): string {
  const n = p.length / 2;
  if (n === 0) return "";
  if (n === 1) return `M${p[0]} ${p[1]}l0.01 0`;
  if (n === 2) return `M${p[0]} ${p[1]}L${p[2]} ${p[3]}`;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const x = p[i * 2]!;
    const y = p[i * 2 + 1]!;
    const mx = (x + p[i * 2 + 2]!) / 2;
    const my = (y + p[i * 2 + 3]!) / 2;
    d += `Q${x} ${y} ${r(mx)} ${r(my)}`;
  }
  d += `L${p[p.length - 2]} ${p[p.length - 1]}`;
  return d;
}
const r = (v: number) => Math.round(v * 10) / 10;

/** Distance from point to segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does a stroke pass within `radius` of (x, y)? */
export function hits(points: number[], width: number, x: number, y: number, radius: number): boolean {
  const lim = radius + width / 2;
  if (points.length === 2) return Math.hypot(points[0]! - x, points[1]! - y) <= lim;
  for (let i = 0; i + 3 < points.length; i += 2)
    if (segDist(x, y, points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!) <= lim) return true;
  return false;
}
