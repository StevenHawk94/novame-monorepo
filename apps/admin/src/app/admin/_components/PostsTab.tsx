'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Post } from '@novame/core/types';
import { apiClient } from '@/lib/api-client';

const PAGE_SIZE = 30;

// Loose shape for a wisdom_cards row returned by the detail endpoint. The
// generated AI-output columns aren't in @novame/core's Post/WisdomCardData
// types, so we type them locally rather than widen the shared types.
type DetailCard = {
  id: string;
  keyword_id?: string | null;
  quote_short?: string | null;
  insight_full?: string | null;
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

type DetailData = { wisdom: (Post & Record<string, unknown>) | null; cards: DetailCard[] };

export default function PostsTab() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Detail modal
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadPosts = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        filter: 'user',
        page: String(p),
        limit: String(PAGE_SIZE),
      });
      if (q.trim()) params.set('search', q.trim());
      const d = await apiClient.get<{
        wisdoms?: Post[];
        total?: number;
        hasMore?: boolean;
      }>(`/api/admin/wisdoms?${params.toString()}`);
      setPosts(d.wisdoms || []);
      setTotal(d.total || 0);
      setHasMore(!!d.hasMore);
    } catch {
      setPosts([]);
      setTotal(0);
      setHasMore(false);
    }
    setLoading(false);
  }, []);

  // Initial + page changes
  useEffect(() => {
    loadPosts(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Debounced server-side search: reset to page 0 and query.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearchChange = (v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(0);
      loadPosts(0, v);
    }, 300);
  };

  const openDetail = async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await apiClient.get<DetailData>(
        `/api/admin/wisdoms?id=${encodeURIComponent(id)}`,
      );
      setDetail(d);
    } catch {
      setDetail({ wisdom: null, cards: [] });
    }
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setDetailId(null);
    setDetail(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return;
    await apiClient.delete('/api/admin/wisdoms?id=' + encodeURIComponent(id));
    if (detailId === id) closeDetail();
    loadPosts(page, search);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-black">
          Posts — Real Users ({total})
        </h2>
      </div>
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search by text, description or creator (whole library)..."
        className="w-full border rounded-lg px-3 py-2 mb-4 text-sm text-black"
      />
      {loading ? (
        <p className="text-black text-center py-8">Loading...</p>
      ) : posts.length === 0 ? (
        <p className="text-center text-black py-8">
          {search ? 'No matching posts.' : 'No posts yet.'}
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {posts.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-xl p-4 border flex items-start gap-3"
              >
                <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden shrink-0">
                  {p.creator_avatar && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.creator_avatar}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm text-black">
                      {p.creator_name || p.user_id?.substring(0, 8) || 'Unknown'}
                    </span>
                    <span className="text-xs text-black">
                      {new Date(p.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-black line-clamp-2">
                    {p.description || p.text?.substring(0, 100)}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-black">
                    <span>👁 {p.listens || 0}</span>
                    <span>💬 {p.comment_count || 0}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <button
                    onClick={() => openDetail(p.id)}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    View
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
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

      {/* Detail modal: full user input + all AI-output blocks */}
      {detailId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={closeDetail}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-black">Post detail</h3>
              <button
                onClick={closeDetail}
                className="text-gray-500 hover:text-black text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {detailLoading ? (
              <p className="text-black text-center py-8">Loading...</p>
            ) : !detail?.wisdom ? (
              <p className="text-black text-center py-8">Not found.</p>
            ) : (
              <div className="space-y-5 text-black">
                {/* User input */}
                <section>
                  <h4 className="font-bold text-sm mb-1 text-purple-700">
                    User input (transcript)
                  </h4>
                  <p className="text-sm whitespace-pre-wrap bg-gray-50 rounded-lg p-3">
                    {detail.wisdom.text || '(empty)'}
                  </p>
                  {detail.wisdom.description ? (
                    <p className="text-xs text-gray-500 mt-2">
                      Description: {String(detail.wisdom.description)}
                    </p>
                  ) : null}
                </section>

                {/* AI output blocks */}
                <section>
                  <h4 className="font-bold text-sm mb-2 text-purple-700">
                    AI output ({detail.cards.length} card
                    {detail.cards.length === 1 ? '' : 's'})
                  </h4>
                  {detail.cards.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No generated card for this post.
                    </p>
                  ) : (
                    detail.cards.map((c) => (
                      <div
                        key={c.id}
                        className="border rounded-lg p-3 mb-3 space-y-2 text-sm"
                      >
                        <div className="flex flex-wrap gap-2 text-xs">
                          {c.keyword_id && (
                            <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                              {c.keyword_id}
                            </span>
                          )}
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
                        <Field label="quote_short" value={c.quote_short} />
                        <Field label="insight_full" value={c.insight_full} />
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
                    ))
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs font-mono text-gray-400">{label}</span>
      <p className="whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function JsonField({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <span className="text-xs font-mono text-gray-400">{label}</span>
      <pre className="whitespace-pre-wrap text-xs bg-gray-50 rounded p-2 overflow-x-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
