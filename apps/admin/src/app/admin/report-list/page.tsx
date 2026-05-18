'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiClient } from '@/lib/api-client';

type ReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'actioned';

type ReportReason =
  | 'spam'
  | 'inappropriate'
  | 'harassment'
  | 'violence'
  | 'sexual'
  | 'self_harm'
  | 'misinformation'
  | 'other';

type Report = {
  id: string;
  user_id: string;
  card_id: string;
  reason: ReportReason;
  detail: string | null;
  reported_at: string;
  status: ReportStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  card: {
    id: string;
    keyword_id: string | null;
    quote_short: string | null;
    insight_full: string | null;
    creator_name: string | null;
    creator_avatar: string | null;
  } | null;
};

const REASON_LABELS: Record<ReportReason, { label: string; emoji: string; color: string }> = {
  spam: { label: 'Spam', emoji: '📢', color: 'bg-gray-100 text-gray-700' },
  inappropriate: { label: 'Inappropriate', emoji: '⚠️', color: 'bg-amber-100 text-amber-700' },
  harassment: { label: 'Harassment', emoji: '🚫', color: 'bg-red-100 text-red-700' },
  violence: { label: 'Violence', emoji: '☠️', color: 'bg-red-100 text-red-700' },
  sexual: { label: 'Sexual', emoji: '🔞', color: 'bg-red-100 text-red-700' },
  self_harm: { label: 'Self-harm', emoji: '💔', color: 'bg-red-100 text-red-700' },
  misinformation: { label: 'Misinformation', emoji: '❓', color: 'bg-orange-100 text-orange-700' },
  other: { label: 'Other', emoji: '📝', color: 'bg-purple-100 text-purple-700' },
};

const TABS: { key: ReportStatus | 'all'; label: string }[] = [
  { key: 'pending', label: '🚨 Pending' },
  { key: 'actioned', label: '✅ Actioned' },
  { key: 'dismissed', label: '🗑️ Dismissed' },
  { key: 'all', label: 'All' },
];

export default function ReportListPage() {
  const router = useRouter();
  const [items, setItems] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ReportStatus | 'all'>('pending');

  const load = async (status: ReportStatus | 'all') => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ success?: boolean; reports?: Report[] }>(
        `/api/admin/wisdom-card-reports?status=${status}`,
      );
      if (data.success && data.reports) {
        setItems(data.reports);
      } else {
        setItems([]);
      }
    } catch (e) {
      console.error(e);
      setItems([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load(activeTab);
  }, [activeTab]);

  const handleDeleteCard = async (cardId: string, displayLabel: string) => {
    if (
      !confirm(
        `Delete this wisdom card permanently?\n\n` +
          `"${displayLabel}"\n\n` +
          `This will remove the card from all users' feeds and mark all related reports as actioned. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyId(cardId);
    try {
      await apiClient.delete(
        `/api/admin/wisdom-card-reports?cardId=${encodeURIComponent(cardId)}`,
      );
      // Optimistically drop all reports for this card from the list.
      setItems((prev) => prev.filter((r) => r.card_id !== cardId));
    } catch (e) {
      alert('Delete failed. Please try again.');
      console.error(e);
    }
    setBusyId(null);
  };

  const handleDismiss = async (reportId: string) => {
    if (!confirm('Dismiss this report? The content stays visible to other users.')) {
      return;
    }
    setBusyId(reportId);
    try {
      await apiClient.patch<{ success?: boolean }>(
        `/api/admin/wisdom-card-reports?reportId=${encodeURIComponent(reportId)}`,
        { status: 'dismissed' },
      );
      setItems((prev) => prev.filter((r) => r.id !== reportId));
    } catch (e) {
      alert('Dismiss failed. Please try again.');
      console.error(e);
    }
    setBusyId(null);
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push('/admin')}
          className="text-gray-500 hover:text-gray-700"
        >
          ← Back
        </button>
        <h1 className="text-xl font-bold">🚨 Report List</h1>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm mb-6">
        <p className="text-gray-600 font-medium">
          User reports of objectionable content — Apple App Store Guideline 1.2 compliance.
        </p>
        <p className="text-sm text-gray-400 mt-1">
          <strong>24-hour response policy.</strong> Delete removes the card from all listing contexts (CASCADE clears blocks and saves). Dismiss keeps the card but closes the report.
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === tab.key
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">✨</p>
          <p>No reports in this category.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl overflow-hidden border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-black">
              <tr>
                <th className="px-4 py-3 text-left">Card</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-left">Detail</th>
                <th className="px-4 py-3 text-left">Reporter</th>
                <th className="px-4 py-3 text-left">Reported</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((report) => {
                const isOrphan = report.card === null;
                const quote = report.card?.quote_short || '(no quote)';
                const insight = report.card?.insight_full?.slice(0, 80) || '';
                const creator = report.card?.creator_name || 'Unknown';
                const keyword = report.card?.keyword_id || '—';
                const reasonInfo = REASON_LABELS[report.reason];
                const busy = busyId === report.card_id || busyId === report.id;
                const isPending = report.status === 'pending';

                return (
                  <tr key={report.id} className="border-t hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 max-w-sm">
                      {isOrphan ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-xs bg-gray-200 text-gray-700">
                            Orphan (already deleted)
                          </span>
                          <span className="text-xs text-gray-400 font-mono">
                            {report.card_id.slice(0, 8)}…
                          </span>
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700 font-medium">
                              {keyword}
                            </span>
                            <span className="text-xs text-gray-500">by {creator}</span>
                          </div>
                          <p className="font-semibold text-black mb-0.5">&ldquo;{quote}&rdquo;</p>
                          {insight ? (
                            <p className="text-xs text-gray-500 line-clamp-2">{insight}…</p>
                          ) : null}
                          <p className="text-xs text-gray-300 font-mono mt-1">
                            id: {report.card_id.slice(0, 8)}…
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-medium ${reasonInfo.color}`}
                      >
                        {reasonInfo.emoji} {reasonInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs text-xs text-gray-600">
                      {report.detail || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 font-mono">
                      {report.user_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      <div>{new Date(report.reported_at).toLocaleDateString()}</div>
                      <div className="text-gray-400">
                        {new Date(report.reported_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {isPending && !isOrphan ? (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleDeleteCard(report.card_id, quote)}
                            disabled={busy}
                            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs hover:bg-red-100 disabled:opacity-50"
                          >
                            {busy ? '...' : '🗑️ Delete'}
                          </button>
                          <button
                            onClick={() => handleDismiss(report.id)}
                            disabled={busy}
                            className="px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-xs hover:bg-gray-100 disabled:opacity-50"
                          >
                            ✓ Dismiss
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">
                          {report.status === 'actioned' && '✅ Card deleted'}
                          {report.status === 'dismissed' && '🗑️ Dismissed'}
                          {report.status === 'reviewed' && 'Reviewed'}
                          {isOrphan && 'Card gone'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
