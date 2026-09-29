/** Stable within the server-provided local day; neighboring days rotate. */
export function dailyMemoryPrompt<T extends { id: string }>(prompts: T[], localDate: string): T | null {
  if (!prompts.length) return null;
  const sorted = [...prompts].sort((a,b) => a.id.localeCompare(b.id));
  const day = Math.floor(Date.parse(`${localDate}T00:00:00Z`) / 86_400_000);
  return sorted[Number.isFinite(day) ? ((day % sorted.length) + sorted.length) % sorted.length : 0];
}
