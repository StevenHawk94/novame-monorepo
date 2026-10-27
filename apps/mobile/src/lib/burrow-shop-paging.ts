export function shopPageIndex(offset: number, width: number, count: number) {
  if (!Number.isFinite(offset) || !Number.isFinite(width) || width <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offset / width)));
}
