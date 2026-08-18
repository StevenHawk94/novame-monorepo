'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { apiClient } from '@/lib/api-client';

/**
 * Analysis tab — onboarding funnel answers as bar charts.
 *
 * Two questions from the intro flow (Ob3 "Who came to mind?" and
 * Ob4 "What tends to get in the way?"), one horizontal bar per
 * option with count + share. Data: /api/admin/onboarding-analysis, which
 * counts profiles.onboarding_who / onboarding_blocker.
 */

type Analysis = {
  who: Record<string, number>;
  blocker: Record<string, number>;
  answered: number;
};

const WHO_LABELS: [string, string][] = [
  ['partner', 'Partner'],
  ['parent', 'Parent'],
  ['child', 'Child'],
  ['bestie', 'Best friend'],
  ['special', 'Someone special'],
];

const BLOCKER_LABELS: [string, string][] = [
  ['A', 'Our days get busy'],
  ['B', 'We live far apart'],
  ['C', 'I don’t want to overwhelm them'],
  ['D', 'I’m not always sure what to say'],
];

const BAR_COLORS = ['bg-amber-500', 'bg-orange-500', 'bg-rose-400', 'bg-violet-400'];

function BarChart({
  title,
  labels,
  counts,
}: {
  title: string;
  labels: [string, string][];
  counts: Record<string, number>;
}) {
  const total = labels.reduce((s, [k]) => s + (counts[k] || 0), 0);
  const max = Math.max(1, ...labels.map(([k]) => counts[k] || 0));
  return (
    <div className="bg-white rounded-xl border p-5">
      <h3 className="font-bold text-gray-800 mb-1">{title}</h3>
      <p className="text-xs text-gray-400 mb-4">{total} answers</p>
      <div className="space-y-3">
        {labels.map(([key, label], i) => {
          const n = counts[key] || 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <div key={key}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">{label}</span>
                <span className="text-gray-500 tabular-nums">
                  {n}（{pct}%）
                </span>
              </div>
              <div className="h-5 bg-gray-100 rounded-md overflow-hidden">
                <div
                  className={`h-full rounded-md ${BAR_COLORS[i % BAR_COLORS.length]} transition-all`}
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AnalysisTab(): ReactElement {
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ success?: boolean } & Analysis>('/api/admin/onboarding-analysis')
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data) return <div className="text-gray-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-800">Onboarding Analysis</h2>
        <p className="text-sm text-gray-500">
          {data.answered} users answered the intro questions. Counts reflect
          users who finished onboarding after 2026-08-10 (when reporting
          shipped).
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <BarChart
          title="Ob3 · Who came to mind?"
          labels={WHO_LABELS}
          counts={data.who}
        />
        <BarChart
          title="Ob4 · What tends to get in the way?"
          labels={BLOCKER_LABELS}
          counts={data.blocker}
        />
      </div>
    </div>
  );
}
