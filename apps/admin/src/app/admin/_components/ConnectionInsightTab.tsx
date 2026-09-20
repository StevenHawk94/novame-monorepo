'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type ReviewEvent = {
  id: string;
  local_date: string;
  section: string;
  emotion: string;
  summary: string;
  failure_stage: string;
  candidate_group: string | null;
  occurrence_count: number;
  last_seen_at: string;
  status: 'pending' | 'covered' | 'ignored';
};

export default function ConnectionInsightTab() {
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [status, setStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ events: ReviewEvent[] }>(
        `/api/admin/connection-insight?status=${status}`,
      );
      setEvents(data.events || []);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => { void load(); }, [load]);
  const review = async (id: string, next: 'covered' | 'ignored' | 'pending') => {
    await apiClient.patch('/api/admin/connection-insight', { id, status: next });
    await load();
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-black">Connection Insight Coverage</h2>
        <p className="text-sm text-gray-500">
          Only qualified events that could not match a Scenario Group or Sub-Scenario appear here.
        </p>
      </div>
      <div className="flex gap-2">
        {['pending', 'covered', 'ignored', 'all'].map((item) => (
          <button key={item} onClick={() => setStatus(item)}
            className={`rounded-lg px-3 py-2 text-sm ${status === item ? 'bg-blue-600 text-white' : 'bg-white border'}`}>
            {item}
          </button>
        ))}
      </div>
      {error && <div className="text-red-600">{error}</div>}
      {loading ? <div className="text-gray-400">Loading…</div> : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="rounded-xl border bg-white p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="rounded bg-gray-100 px-2 py-1">{event.section}</span>
                <span>{event.emotion}</span><span>{event.failure_stage}</span>
                {!!event.candidate_group && <span>Group: {event.candidate_group}</span>}
                <span>{event.occurrence_count}×</span><span>{event.local_date}</span>
              </div>
              <p className="mt-3 text-sm text-gray-900">{event.summary}</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => void review(event.id, 'covered')}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white">Covered</button>
                <button onClick={() => void review(event.id, 'ignored')}
                  className="rounded bg-gray-700 px-3 py-1.5 text-xs text-white">Ignore</button>
                {event.status !== 'pending' && (
                  <button onClick={() => void review(event.id, 'pending')}
                    className="rounded border px-3 py-1.5 text-xs">Reopen</button>
                )}
              </div>
            </div>
          ))}
          {!events.length && <div className="text-sm text-gray-400">No events in this queue.</div>}
        </div>
      )}
    </div>
  );
}
