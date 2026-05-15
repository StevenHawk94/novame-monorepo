'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { apiClient } from '@/lib/api-client';

type BlockedCard = {
  card_id: string;
  block_count: number;
  first_blocked_at: string;
  last_blocked_at: string;
  card: {
    id: string;
    keyword_id: string | null;
    quote_short: string | null;
    insight_full: string | null;
    creator_name: string | null;
    creator_avatar: string | null;
  } | null;
};

export default function BlockListPage() {
  const router = useRouter();
  const [items, setItems] = useState<BlockedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ success?: boolean; blocked_cards?: BlockedCard[] }>(
        '/api/admin/wisdom-card-blocks',
      );
      if (data.success && data.blocked_cards) {
        setItems(data.blocked_cards);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (cardId: string, displayLabel: string) => {
    if (
      !confirm(
        `Delete this wisdom card permanently?\n\n` +
          `"${displayLabel}"\n\n` +
          `This will remove the card from all users' decks and the seek-question feed. ` +
          `This cannot be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(cardId);
    try {
      await apiClient.delete(`/api/admin/wisdom-card-blocks?cardId=${encodeURIComponent(cardId)}`);
      // Optimistic: drop from local list. load() refetches fresh.
      setItems((prev) => prev.filter((i) => i.card_id !== cardId));
    } catch (e) {
      alert('Delete failed. Please try again.');
      console.error(e);
    }
    setDeletingId(null);
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
        <h1 className="text-xl font-bold">🚫 Block List</h1>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm mb-6">
        <p className="text-gray-600">
          Wisdom cards reported by users via the in-app block menu.
        </p>
        <p className="text-sm text-gray-400">
          Sorted by number of users who blocked each card. Delete removes the card
          permanently from all listing contexts (CASCADE clears block rows and saves).
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-2">✨</p>
          <p>No blocked cards yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl overflow-hidden border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-black">
              <tr>
                <th className="px-4 py-3 text-left">Card</th>
                <th className="px-4 py-3 text-center">Blocks</th>
                <th className="px-4 py-3 text-center">First / Last</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isOrphan = item.card === null;
                const quote = item.card?.quote_short || '(no quote)';
                const insight = item.card?.insight_full?.slice(0, 80) || '';
                const creator = item.card?.creator_name || 'Unknown';
                const keyword = item.card?.keyword_id || '—';
                const deleting = deletingId === item.card_id;

                return (
                  <tr key={item.card_id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 max-w-md">
                      {isOrphan ? (
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-xs bg-gray-200 text-gray-700">
                            Orphan
                          </span>
                          <span className="text-xs text-gray-400 font-mono">
                            {item.card_id.slice(0, 8)}…
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
                            id: {item.card_id.slice(0, 8)}…
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded font-bold text-sm ${
                          item.block_count >= 5
                            ? 'bg-red-100 text-red-700'
                            : item.block_count >= 2
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {item.block_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">
                      <div>{new Date(item.first_blocked_at).toLocaleDateString()}</div>
                      <div className="text-gray-400">
                        {new Date(item.last_blocked_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(item.card_id, quote)}
                        disabled={deleting}
                        className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs hover:bg-red-100 disabled:opacity-50"
                      >
                        {deleting ? '...' : '🗑️ Delete card'}
                      </button>
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
