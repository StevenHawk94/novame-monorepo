'use client';

import { useEffect, useState } from 'react';

import type { Ticket } from '@novame/core/types';

type ColorPair = { bg: string; text: string };

const CATEGORY_COLORS: Record<string, ColorPair> = {
  bug: { bg: '#FEE2E2', text: '#DC2626' },
  feature: { bg: '#FEF3C7', text: '#D97706' },
  billing: { bg: '#DBEAFE', text: '#2563EB' },
  account: { bg: '#E0E7FF', text: '#4F46E5' },
  other: { bg: '#F3F4F6', text: '#374151' },
};

const STATUS_COLORS: Record<string, ColorPair> = {
  open: { bg: '#FEE2E2', text: '#DC2626' },
  in_progress: { bg: '#FEF3C7', text: '#D97706' },
  resolved: { bg: '#D1FAE5', text: '#059669' },
  closed: { bg: '#F3F4F6', text: '#6B7280' },
};

const fmtDate = (d: string): string => {
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function SupportTicketsTab() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadTickets = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/support-ticket?status=${filter}`);
      const d = await r.json();
      if (d.success) setTickets(d.tickets || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    loadTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch('/api/support-ticket', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      loadTickets();
    } catch {}
  };

  const replyByEmail = (ticket: Ticket) => {
    const subject = `Re: [${(ticket.category || '').toUpperCase()}] ${ticket.subject || ''}`;
    const url = `mailto:${ticket.email}?subject=${encodeURIComponent(subject)}`;
    window.location.href = url;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-black">
        Support Tickets ({tickets.length})
      </h2>

      {/* Status filter */}
      <div className="flex gap-2">
        {['open', 'in_progress', 'resolved', 'closed'].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
              filter === s
                ? 'bg-blue-600 text-white'
                : 'bg-white text-black border'
            }`}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center py-8 text-gray-400">Loading...</p>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border">
          <p className="text-gray-400 text-sm">
            No {filter.replace('_', ' ')} tickets
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => {
            const catColor = CATEGORY_COLORS[t.category] || CATEGORY_COLORS.other;
            const statColor = STATUS_COLORS[t.status] || STATUS_COLORS.open;
            const isExpanded = expandedId === t.id;

            return (
              <div
                key={t.id}
                className="bg-white border rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : t.id)}
                  className="w-full text-left p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                          style={{ background: catColor.bg, color: catColor.text }}
                        >
                          {t.category}
                        </span>
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold capitalize"
                          style={{ background: statColor.bg, color: statColor.text }}
                        >
                          {t.status.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {fmtDate(t.created_at)}
                        </span>
                      </div>
                      <p className="font-medium text-sm text-black">
                        {t.subject}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{t.email}</p>
                    </div>
                    <span className="text-gray-300 text-xs shrink-0 mt-1">
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t px-4 py-3 bg-gray-50 space-y-3">
                    {/* Message */}
                    <div className="bg-white rounded-lg p-3 border">
                      <p className="text-sm text-black whitespace-pre-wrap leading-relaxed">
                        {t.message}
                      </p>
                    </div>

                    {/* Meta */}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                      <span>
                        User: {t.user_id ? t.user_id.slice(0, 8) + '...' : 'Guest'}
                      </span>
                      <span>Ticket: {t.id.slice(0, 8)}...</span>
                    </div>

                    {/* Admin notes */}
                    {t.admin_notes && (
                      <div className="bg-purple-50 rounded-lg p-3 border border-purple-100">
                        <p className="text-xs font-bold text-purple-700 mb-1">
                          Admin Notes
                        </p>
                        <p className="text-sm text-purple-900">
                          {t.admin_notes}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {t.status === 'open' && (
                        <button
                          onClick={() => updateStatus(t.id, 'in_progress')}
                          className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-xs font-bold"
                        >
                          In Progress
                        </button>
                      )}
                      {(t.status === 'open' ||
                        t.status === 'in_progress') && (
                        <button
                          onClick={() => updateStatus(t.id, 'resolved')}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold"
                        >
                          Resolved
                        </button>
                      )}
                      {t.status !== 'closed' && (
                        <button
                          onClick={() => updateStatus(t.id, 'closed')}
                          className="px-3 py-1.5 bg-gray-400 text-white rounded-lg text-xs font-bold"
                        >
                          Close
                        </button>
                      )}
                      {t.status === 'closed' && (
                        <button
                          onClick={() => updateStatus(t.id, 'open')}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold"
                        >
                          Reopen
                        </button>
                      )}
                      <button
                        onClick={() => replyByEmail(t)}
                        className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-bold ml-auto"
                      >
                        ✉ Reply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
