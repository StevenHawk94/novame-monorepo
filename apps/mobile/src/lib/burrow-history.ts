import { apiClient } from './api';
import { withDeadline } from './async-lifecycle';
import { sessionEpoch } from './session-lifecycle';
import type { MajorUpdateBootstrap } from './app-major-update-api';
export type HistoryKind = 'moments' | 'memories';
export type HistoryRow = (MajorUpdateBootstrap['moments'][number] | MajorUpdateBootstrap['memoryEntries'][number]) & { localDate: string; reference_id?: string; reference_type?: string; record?: {id:string;body:string;shared:boolean;version:number;items:{itemId:string;label:string;memory:string|null}[]}|null };
export type HistoryCursor = { at: string; id: string } | null;
export interface HistoryPage { rows: HistoryRow[]; next: HistoryCursor; hasMore: boolean; timezone: string }
export async function fetchBurrowHistory(kind: HistoryKind, partner: string, next: HistoryCursor, date: string) {
  const epoch = sessionEpoch();
  const query = new URLSearchParams({ kind, partner });
  if (next) { query.set('before', next.at); query.set('id', next.id); }
  if (date) query.set('date', date);
  const result = await withDeadline(apiClient.get<HistoryPage & { success: boolean }>(`/api/vnext/history?${query}`), 20_000);
  if (epoch !== sessionEpoch()) throw Error('session_changed');
  if (!result.success) throw Error('history_unavailable');
  return result;
}
export function mergeHistory(previous: HistoryRow[], next: HistoryRow[]) {
  const rows = new Map(previous.map(row => [row.id, row]));
  next.forEach(row => rows.set(row.id, row));
  return [...rows.values()].sort((a,b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}
export function historyDayLabel(date: string, today: string) {
  if (date === today) return 'Today';
  const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate()-1);
  return date === yesterday.toISOString().slice(0,10) ? 'Yesterday' : date;
}
