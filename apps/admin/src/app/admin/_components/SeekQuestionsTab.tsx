'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { Creator, Question, LinkedCard } from '@novame/core/types';

const TAGS = [
  'Clarity', 'Grounding', 'Focus', 'Curiosity', 'Stillness', 'Objectivity',
  'Adaptability', 'Unlearning', 'Vision', 'Acceptance', 'Humor', 'Intuition',
  'Resilience', 'Boundaries', 'Self-Compassion', 'Courage', 'Vulnerability',
  'Empathy', 'Gratitude', 'Patience', 'Forgiveness', 'Release', 'Balance',
  'Joy', 'Initiative', 'Consistency', 'Discipline', 'Decisiveness', 'Purpose',
  'Rest', 'Resourcefulness', 'Accountability', 'Boldness', 'Endurance',
  'Communication', 'Momentum', 'Sovereignty', 'Authenticity', 'Inspiration',
  'Generosity', 'Trust', 'Reciprocity', 'Collaboration', 'Leadership',
  'Harmony', 'Legacy', 'Respect', 'Loyalty',
];

export default function SeekQuestionsTab() {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newQ, setNewQ] = useState('');
  const [newTag, setNewTag] = useState('Clarity');
  const [selectedCreator, setSelectedCreator] = useState<Creator | null>(null);
  const [creating, setCreating] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [pendingQuestions, setPendingQuestions] = useState<Question[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loadingPending, setLoadingPending] = useState(false);
  const [addCardInputs, setAddCardInputs] = useState<Record<string, string>>({});
  const [addingCard, setAddingCard] = useState<string | null>(null);
  const [questionCards, setQuestionCards] = useState<Record<string, LinkedCard[]>>({});
  const [expandedQ, setExpandedQ] = useState<string | null>(null);

  const loadQuestions = () => {
    setLoading(true);
    fetch('/api/admin/seek-questions')
      .then((r) => r.json())
      .then((d) => setQuestions(d.questions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const loadCreators = () => {
    fetch('/api/admin/default-users')
      .then((r) => r.json())
      .then((d) => {
        const u: Creator[] = d.users || [];
        setCreators(u);
        if (u.length > 0 && !selectedCreator) setSelectedCreator(u[0]);
      })
      .catch(() => {});
  };

  const loadPending = () => {
    setLoadingPending(true);
    fetch('/api/admin/seek-questions?pending=true')
      .then((r) => r.json())
      .then((d) => {
        setPendingQuestions(d.questions || []);
        setPendingCount(d.pendingCount || 0);
      })
      .catch(() => {})
      .finally(() => setLoadingPending(false));
  };

  useEffect(() => {
    loadQuestions();
    loadCreators();
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCardsForQuestion = async (questionId: string) => {
    try {
      const r = await fetch(`/api/admin/seek-questions?questionId=${questionId}`);
      const d = await r.json();
      setQuestionCards((prev) => ({ ...prev, [questionId]: d.cards || [] }));
    } catch {}
  };

  const toggleExpand = (questionId: string) => {
    if (expandedQ === questionId) {
      setExpandedQ(null);
    } else {
      setExpandedQ(questionId);
      loadCardsForQuestion(questionId);
    }
  };

  const createQuestion = async () => {
    if (!newQ.trim() || creating || !selectedCreator) return;
    setCreating(true);
    try {
      await fetch('/api/admin/seek-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          question: newQ.trim(),
          tag: newTag,
          creatorName: selectedCreator.name,
          creatorAvatar: selectedCreator.avatar_url || '',
        }),
      });
      setNewQ('');
      setNewTag('Clarity');
      setShowCreate(false);
      loadQuestions();
    } catch {}
    setCreating(false);
  };

  const deleteQuestion = async (id: string) => {
    if (!confirm('Delete this question and all its cards?')) return;
    await fetch('/api/admin/seek-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    loadQuestions();
  };

  const approveUserQuestion = async (id: string) => {
    await fetch('/api/admin/seek-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve_user_question', id }),
    });
    loadPending();
    loadQuestions();
  };

  const rejectUserQuestion = async (id: string) => {
    const reason = prompt('Rejection reason (optional — will be shown to the user):');
    if (reason === null) return;
    await fetch('/api/admin/seek-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reject_user_question',
        id,
        rejectionReason: reason || '',
      }),
    });
    loadPending();
  };

  const togglePublish = async (id: string, current: boolean | undefined) => {
    await fetch('/api/admin/seek-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id, isPublished: !current }),
    });
    loadQuestions();
  };

  const addCardToQuestion = async (questionId: string) => {
    const cardId = (addCardInputs[questionId] || '').trim();
    if (!cardId || addingCard) return;
    setAddingCard(questionId);
    try {
      const r = await fetch('/api/admin/seek-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_card', questionId, cardId }),
      });
      const d = await r.json();
      if (d.success) {
        setAddCardInputs((prev) => ({ ...prev, [questionId]: '' }));
        await loadCardsForQuestion(questionId);
        loadQuestions();
      } else {
        alert(d.error || 'Failed to add card');
      }
    } catch {
      alert('Error adding card');
    }
    setAddingCard(null);
  };

  const removeCard = async (questionId: string, linkId: string) => {
    if (!confirm('Remove this card from the question?')) return;
    try {
      await fetch('/api/admin/seek-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_card', linkId }),
      });
      await loadCardsForQuestion(questionId);
      loadQuestions();
    } catch {
      alert('Error removing card');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-bold text-black">
          Seek Questions ({questions.length})
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/admin/seek-csv')}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center"
          >
            📁 CSV Bulk Upload
          </button>
          <button
            onClick={() => {
              setShowPending(!showPending);
              if (!showPending) loadPending();
            }}
            className="relative px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium"
          >
            User&apos;s Contribute
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
          >
            + New Question
          </button>
        </div>
      </div>

      {/* Pending user questions panel */}
      {showPending && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
          <h3 className="font-bold text-orange-800 text-sm">
            User Submitted Questions ({pendingCount} pending)
          </h3>
          {loadingPending ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : pendingQuestions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              No pending questions
            </p>
          ) : (
            <div className="space-y-2">
              {pendingQuestions.map((q) => (
                <div
                  key={q.id}
                  className="bg-white rounded-lg p-3 border border-orange-100"
                >
                  <p className="text-sm text-black font-medium mb-1">
                    {q.question_text}
                  </p>
                  <p className="text-xs text-gray-400 mb-2">
                    by {q.creator_name} ·{' '}
                    {new Date(q.created_at).toLocaleDateString()}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveUserQuestion(q.id)}
                      className="px-3 py-1 bg-green-600 text-white rounded text-xs font-bold"
                    >
                      ✓ Approve &amp; Publish
                    </button>
                    <button
                      onClick={() => rejectUserQuestion(q.id)}
                      className="px-3 py-1 bg-red-100 text-red-600 rounded text-xs font-bold"
                    >
                      ✗ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3 border">
          <div className="relative">
            <textarea
              value={newQ}
              onChange={(e) => setNewQ(e.target.value.slice(0, 200))}
              placeholder="Enter question..."
              rows={3}
              className="w-full px-3 py-2 border rounded-lg text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute bottom-2 right-2 text-xs text-gray-400">
              {newQ.length}/200
            </span>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-black font-medium mb-1 block">
                Keyword (card category)
              </label>
              <select
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm text-black"
              >
                {TAGS.map((kw) => (
                  <option key={kw} value={kw}>
                    {kw}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-black font-medium mb-1 block">
                Creator
              </label>
              <select
                value={selectedCreator?.id || ''}
                onChange={(e) =>
                  setSelectedCreator(
                    creators.find((c) => c.id === e.target.value) || null
                  )
                }
                className="w-full px-3 py-2 border rounded-lg text-sm text-black"
              >
                {creators.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {selectedCreator && (
            <div className="flex items-center gap-2 text-xs text-black">
              <div className="w-6 h-6 rounded-full bg-gray-200 overflow-hidden">
                {selectedCreator.avatar_url && (
                  <img
                    src={selectedCreator.avatar_url}
                    className="w-full h-full object-cover"
                    alt=""
                  />
                )}
              </div>
              <span>
                Posting as: <strong>{selectedCreator.name}</strong>
              </span>
            </div>
          )}
          <button
            onClick={createQuestion}
            disabled={creating || !newQ.trim() || !selectedCreator}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-bold disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Question'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-black text-center py-8">Loading...</p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <div key={q.id} className="bg-white border rounded-xl overflow-hidden">
              {/* Question header */}
              <div className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <p className="font-medium text-sm text-black">
                      {q.question_text}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                        {q.question_tag}
                      </span>
                      <span className="text-gray-500 text-xs">
                        by {q.creator_name}
                      </span>
                      <button
                        onClick={() => toggleExpand(q.id)}
                        className="text-xs font-medium text-purple-600 hover:text-purple-800 underline"
                      >
                        {q.card_count || 0} cards{' '}
                        {expandedQ === q.id ? '▲' : '▼'}
                      </button>
                      <span
                        className={`text-xs font-medium ${
                          q.is_published ? 'text-green-600' : 'text-red-500'
                        }`}
                      >
                        {q.is_published ? 'Published' : 'Draft'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => togglePublish(q.id, q.is_published)}
                      className="px-2 py-1 text-xs bg-gray-100 text-black rounded"
                    >
                      {q.is_published ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      onClick={() => deleteQuestion(q.id)}
                      className="px-2 py-1 text-xs bg-red-100 text-red-600 rounded"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Add card input */}
                <div className="flex gap-2 mt-2">
                  <input
                    value={addCardInputs[q.id] || ''}
                    onChange={(e) =>
                      setAddCardInputs((prev) => ({
                        ...prev,
                        [q.id]: e.target.value,
                      }))
                    }
                    placeholder="Paste card ID to add..."
                    className="flex-1 px-3 py-1.5 border rounded-lg text-xs text-black"
                  />
                  <button
                    onClick={() => addCardToQuestion(q.id)}
                    disabled={
                      !addCardInputs[q.id]?.trim() || addingCard === q.id
                    }
                    className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs disabled:opacity-50 whitespace-nowrap"
                  >
                    {addingCard === q.id ? 'Adding...' : 'Add Card'}
                  </button>
                </div>
              </div>

              {/* Expanded cards list */}
              {expandedQ === q.id && (
                <div className="border-t bg-gray-50 px-4 py-3">
                  {!questionCards[q.id] ? (
                    <p className="text-xs text-gray-400 text-center py-2">
                      Loading cards...
                    </p>
                  ) : questionCards[q.id].length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-2">
                      No cards added yet
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {questionCards[q.id].map((c) => (
                        <div
                          key={c.link_id}
                          className="flex items-center gap-3 bg-white rounded-lg p-2 border"
                        >
                          <div className="w-8 h-8 rounded overflow-hidden shrink-0 bg-purple-100">
                            <img
                              src={`/images/cards/${c.keyword_id || 'mind-clarity'}-front.webp`}
                              className="w-full h-full object-cover"
                              alt=""
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-black truncate">
                              &quot;{c.quote_short}&quot;
                            </p>
                            <p className="text-xs text-gray-400">
                              {c.card_keywords?.keyword || c.keyword_id}{' '}
                              {c.card_number ? `· #${c.card_number}` : ''} ·{' '}
                              {c.creator_name}
                            </p>
                          </div>
                          <button
                            onClick={() => removeCard(q.id, c.link_id)}
                            className="text-red-400 hover:text-red-600 text-xs shrink-0 px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
