'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Card, DefaultUser } from '@novame/core/types';
import { apiClient } from '@/lib/api-client';
import { ALL_KEYWORD_IDS as KEYWORDS } from '@novame/core/constants/keywords';

const PAGE_SIZE = 30;

// wisdom_cards row with all AI-output columns (not in @novame/core's Card).
type FullCard = Card & {
  peer_comment?: string | null;
  reframe?: unknown;
  reflective_question?: unknown;
  task_1?: string | null;
  task_2?: string | null;
  wisdom_score?: number | null;
  wisdom_emotion?: string | null;
  aspire_impacts?: unknown;
  card_a?: string | null;
  card_b?: string | null;
  card_c?: string | null;
  created_at?: string;
};

type CardForm = {
  userId: string;
  keywordId: string;
  quoteShort: string;
  insightFull: string;
  cardNumber: number | string;
};

type SubTab = 'default' | 'real';

export default function CardsTab() {
  const [subTab, setSubTab] = useState<SubTab>('default');
  const [cards, setCards] = useState<FullCard[]>([]);
  const [defaultUsers, setDefaultUsers] = useState<DefaultUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CardForm>({
    userId: '',
    keywordId: '',
    quoteShort: '',
    insightFull: '',
    cardNumber: 1,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadCards = useCallback(
    async (tab: SubTab, p: number, q: string) => {
      setLoading(true);
      try {
        const base =
          tab === 'default' ? '/api/admin/default-cards' : '/api/admin/real-cards';
        const params = new URLSearchParams({
          page: String(p),
          limit: String(PAGE_SIZE),
        });
        if (q.trim()) params.set('search', q.trim());
        const d = await apiClient.get<{
          cards?: FullCard[];
          total?: number;
          hasMore?: boolean;
        }>(`${base}?${params.toString()}`);
        setCards(d.cards || []);
        setTotal(d.total || 0);
        setHasMore(!!d.hasMore);
      } catch {
        setCards([]);
        setTotal(0);
        setHasMore(false);
      }
      setLoading(false);
    },
    [],
  );

  const loadDefaultUsers = useCallback(async () => {
    try {
      const d = await apiClient.get<{ users?: DefaultUser[] }>(
        '/api/admin/default-users',
      );
      setDefaultUsers(d.users || []);
    } catch {}
  }, []);

  // Reload when tab or page changes; reset page to 0 on tab switch.
  useEffect(() => {
    loadCards(subTab, page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, page]);

  useEffect(() => {
    loadDefaultUsers();
  }, [loadDefaultUsers]);

  // Reset to page 0 when switching tabs.
  const switchTab = (tab: SubTab) => {
    if (tab === subTab) return;
    setExpanded(null);
    setSearch('');
    setPage(0);
    setSubTab(tab);
  };

  // Debounced server-side search.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = (v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      loadCards(subTab, 0, v);
    }, 300);
  };

  const handleCreate = async () => {
    const user = defaultUsers.find((u) => u.id === form.userId);
    if (!user || !form.keywordId || !form.quoteShort) {
      return alert('Fill required fields');
    }
    try {
      const d = await apiClient.post<{ success?: boolean; error?: string }>(
        '/api/admin/default-cards',
        {
          cards: [
            {
              keyword_id: form.keywordId,
              quote_short: form.quoteShort,
              insight_full: form.insightFull,
              card_number: parseInt(String(form.cardNumber)) || 1,
              creator_name: user.name,
              creator_avatar: user.avatar_url,
            },
          ],
        },
      );
      if (d.success) {
        setShowCreate(false);
        setForm({ userId: '', keywordId: '', quoteShort: '', insightFull: '', cardNumber: 1 });
        loadCards(subTab, page, search);
      } else {
        alert(d.error);
      }
    } catch {
      alert('Failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this card?')) return;
    await apiClient.delete('/api/admin/default-cards', { id });
    loadCards(subTab, page, search);
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-black">Wisdom Cards ({total})</h2>
        <div className="flex bg-gray-200 rounded-lg p-0.5">
          <button
            onClick={() => switchTab('default')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              subTab === 'default' ? 'bg-white text-black shadow-sm' : 'text-black'
            }`}
          >
            Default
          </button>
          <button
            onClick={() => switchTab('real')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              subTab === 'real' ? 'bg-white text-black shadow-sm' : 'text-black'
            }`}
          >
            Real Users
          </button>
        </div>
        {subTab === 'default' && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
          >
            + New Card
          </button>
        )}
      </div>
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search by keyword, quote, insight or creator (whole library)..."
        className="w-full border rounded-lg px-3 py-2 mb-4 text-sm text-black"
      />

      {showCreate && subTab === 'default' && (
        <div className="bg-white rounded-xl p-4 mb-4 border space-y-3">
          <select
            value={form.userId}
            onChange={(e) => setForm({ ...form, userId: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm text-black"
          >
            <option value="">Select creator...</option>
            {defaultUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select
            value={form.keywordId}
            onChange={(e) => setForm({ ...form, keywordId: e.target.value })}
            className="w-full border rounded-lg px-3 py-2 text-sm text-black"
          >
            <option value="">Select keyword...</option>
            {KEYWORDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            value={form.quoteShort}
            onChange={(e) => setForm({ ...form, quoteShort: e.target.value })}
            placeholder="Quote (front of card, max 70 chars)"
            maxLength={70}
            className="w-full border rounded-lg px-3 py-2 text-sm text-black"
          />
          <textarea
            value={form.insightFull}
            onChange={(e) => setForm({ ...form, insightFull: e.target.value })}
            placeholder="Insight (back of card, max 800 chars)"
            maxLength={800}
            rows={4}
            className="w-full border rounded-lg px-3 py-2 text-sm text-black"
          />
          <div>
            <label className="text-xs text-black font-medium mb-1 block">
              Card Number{' '}
              <span className="text-gray-400 font-normal">
                (displayed on front of card)
              </span>
            </label>
            <input
              type="number"
              value={form.cardNumber}
              onChange={(e) => setForm({ ...form, cardNumber: e.target.value })}
              min={1}
              className="w-32 border rounded-lg px-3 py-2 text-sm text-black"
            />
          </div>
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm"
          >
            Create Card
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-black text-center py-8">Loading...</p>
      ) : cards.length === 0 ? (
        <p className="text-center text-black py-8">
          {search
            ? 'No matching cards.'
            : `No ${subTab === 'default' ? 'default' : 'real user'} cards yet.`}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {cards.map((c) => {
              const isOpen = expanded === c.id;
              return (
                <div key={c.id} className="bg-white rounded-xl p-4 border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-medium">
                      {c.keyword_id}
                    </span>
                    <div className="flex items-center gap-2">
                      {c.card_number && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          #{c.card_number}
                        </span>
                      )}
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          c.user_id
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {c.user_id ? 'User' : 'Default'}
                      </span>
                      {subTab === 'default' && (
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="text-red-500 hover:text-red-700 text-sm"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="font-bold text-sm text-black mb-1">
                    &quot;{c.quote_short}&quot;
                  </p>
                  <p
                    className={`text-xs text-black ${isOpen ? '' : 'line-clamp-2'}`}
                  >
                    {isOpen ? c.insight_full : `${c.insight_full?.substring(0, 100)}...`}
                  </p>

                  {isOpen && (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      <div className="flex flex-wrap gap-2 text-xs">
                        {c.wisdom_emotion && (
                          <span className="bg-pink-100 text-pink-700 px-2 py-0.5 rounded">
                            {c.wisdom_emotion}
                          </span>
                        )}
                        {typeof c.wisdom_score === 'number' && (
                          <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                            score {c.wisdom_score}
                          </span>
                        )}
                      </div>
                      <Field label="peer_comment" value={c.peer_comment} />
                      <Field label="task_1" value={c.task_1} />
                      <Field label="task_2" value={c.task_2} />
                      <JsonField label="reframe" value={c.reframe} />
                      <JsonField
                        label="reflective_question"
                        value={c.reflective_question}
                      />
                      <JsonField label="aspire_impacts" value={c.aspire_impacts} />
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-3 text-xs text-black">
                      <span>
                        {c.creator_name || c.user_id?.substring(0, 8) || 'System'}
                      </span>
                      <span>🔖 {c.saves_count || 0} saves</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpanded(isOpen ? null : c.id)}
                        className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
                      >
                        {isOpen ? 'Collapse' : 'Expand'}
                      </button>
                      {!c.user_id && (
                        <button
                          onClick={() => copyId(c.id)}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors ${
                            copiedId === c.id
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {copiedId === c.id ? '✓ Copied' : `📋 ${c.id.substring(0, 8)}`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg border text-sm text-black disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-sm text-black">
              Page {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
              className="px-3 py-1.5 rounded-lg border text-sm text-black disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs font-mono text-gray-400">{label}</span>
      <p className="text-sm text-black whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function JsonField({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <span className="text-xs font-mono text-gray-400">{label}</span>
      <pre className="whitespace-pre-wrap text-xs bg-gray-50 rounded p-2 overflow-x-auto text-black">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
