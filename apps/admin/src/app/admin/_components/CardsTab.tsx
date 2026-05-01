'use client';

import { useEffect, useState } from 'react';

// TODO(1.4): replace with shared types from @novame/core/types
type Card = {
  id: string;
  keyword_id?: string;
  quote_short?: string;
  insight_full?: string;
  card_number?: number;
  user_id?: string;
  creator_name?: string;
  saves_count?: number;
};

type DefaultUser = {
  id: string;
  name: string;
  avatar_url?: string;
};

type CardForm = {
  userId: string;
  keywordId: string;
  quoteShort: string;
  insightFull: string;
  cardNumber: number | string;
};

type SubTab = 'default' | 'real';

const KEYWORDS = [
  'mind-clarity', 'mind-grounding', 'mind-focus', 'mind-curiosity', 'mind-stillness',
  'mind-objectivity', 'mind-adaptability', 'mind-unlearning', 'mind-vision',
  'mind-acceptance', 'mind-humor', 'mind-intuition',
  'heart-resilience', 'heart-boundaries', 'heart-self-compassion', 'heart-courage',
  'heart-vulnerability', 'heart-empathy', 'heart-gratitude', 'heart-patience',
  'heart-forgiveness', 'heart-release', 'heart-balance', 'heart-joy',
  'action-initiative', 'action-consistency', 'action-discipline', 'action-decisiveness',
  'action-purpose', 'action-rest', 'action-resourcefulness', 'action-accountability',
  'action-boldness', 'action-endurance', 'action-communication', 'action-momentum',
  'connection-sovereignty', 'connection-authenticity', 'connection-inspiration',
  'connection-generosity', 'connection-trust', 'connection-reciprocity',
  'connection-collaboration', 'connection-leadership', 'connection-harmony',
  'connection-legacy', 'connection-respect', 'connection-loyalty',
];

export default function CardsTab() {
  const [subTab, setSubTab] = useState<SubTab>('default');
  const [cards, setCards] = useState<Card[]>([]);
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

  useEffect(() => {
    loadCards();
    loadDefaultUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const loadCards = async () => {
    setLoading(true);
    try {
      if (subTab === 'default') {
        const r = await fetch('/api/admin/default-cards');
        const d = await r.json();
        setCards(d.cards || []);
      } else {
        const r = await fetch('/api/generate-abc-cards?public=true');
        const d = await r.json();
        setCards(((d.cards || []) as Card[]).filter((c) => c.user_id));
      }
    } catch {}
    setLoading(false);
  };

  const loadDefaultUsers = async () => {
    try {
      const r = await fetch('/api/admin/default-users');
      const d = await r.json();
      setDefaultUsers(d.users || []);
    } catch {}
  };

  const handleCreate = async () => {
    const user = defaultUsers.find((u) => u.id === form.userId);
    if (!user || !form.keywordId || !form.quoteShort) {
      return alert('Fill required fields');
    }
    try {
      const r = await fetch('/api/admin/default-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        }),
      });
      const d = await r.json();
      if (d.success) {
        setShowCreate(false);
        setForm({ userId: '', keywordId: '', quoteShort: '', insightFull: '', cardNumber: 1 });
        loadCards();
      } else {
        alert(d.error);
      }
    } catch {
      alert('Failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this card?')) return;
    await fetch('/api/admin/default-cards', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    loadCards();
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  const filtered = cards.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.keyword_id || '').toLowerCase().includes(q) ||
      (c.quote_short || '').toLowerCase().includes(q) ||
      (c.insight_full || '').toLowerCase().includes(q) ||
      (c.creator_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-black">Wisdom Cards</h2>
        <div className="flex bg-gray-200 rounded-lg p-0.5">
          <button
            onClick={() => setSubTab('default')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              subTab === 'default'
                ? 'bg-white text-black shadow-sm'
                : 'text-black'
            }`}
          >
            Default
          </button>
          <button
            onClick={() => setSubTab('real')}
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
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by keyword, quote, insight or creator..."
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
      ) : filtered.length === 0 ? (
        <p className="text-center text-black py-8">
          {search
            ? 'No matching cards.'
            : `No ${subTab === 'default' ? 'default' : 'real user'} cards yet.`}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((c) => (
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
                  {c.user_id && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                      User
                    </span>
                  )}
                  {!c.user_id && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                      Default
                    </span>
                  )}
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    🗑
                  </button>
                </div>
              </div>
              <p className="font-bold text-sm text-black mb-1">
                &quot;{c.quote_short}&quot;
              </p>
              <p className="text-xs text-black line-clamp-2">
                {c.insight_full?.substring(0, 100)}...
              </p>
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-3 text-xs text-black">
                  <span>
                    {c.creator_name || c.user_id?.substring(0, 8) || 'System'}
                  </span>
                  <span>🔖 {c.saves_count || 0} saves</span>
                </div>
                {!c.user_id && (
                  <button
                    onClick={() => copyId(c.id)}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors ${
                      copiedId === c.id
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {copiedId === c.id
                      ? '✓ Copied'
                      : `📋 ${c.id.substring(0, 8)}`}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
