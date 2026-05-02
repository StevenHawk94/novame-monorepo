'use client';

import { useEffect, useState } from 'react';

import type { Post } from '@novame/core/types';

export default function PostsTab() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/wisdoms?filter=real');
      const d = await r.json();
      setPosts(d.wisdoms || []);
    } catch {}
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return;
    await fetch('/api/admin/wisdoms', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    loadPosts();
  };

  const filtered = posts.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.text || '').toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.creator_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-black">
          Posts — Real Users ({posts.length})
        </h2>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by text, description or creator..."
        className="w-full border rounded-lg px-3 py-2 mb-4 text-sm text-black"
      />
      {loading ? (
        <p className="text-black text-center py-8">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-black py-8">
          {search ? 'No matching posts.' : 'No posts yet.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 100).map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-xl p-4 border flex items-start gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden shrink-0">
                {p.creator_avatar && (
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
                    {p.creator_name ||
                      p.user_id?.substring(0, 8) ||
                      'Unknown'}
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
              <button
                onClick={() => handleDelete(p.id)}
                className="text-red-500 hover:text-red-700 text-sm shrink-0"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
