'use client';

import { useEffect, useState, type ChangeEvent } from 'react';

// TODO(1.4): replace with shared type from @novame/core/types
type DefaultUser = {
  id: string;
  name: string;
  avatar_url?: string;
  total_mins?: number;
};

export default function DefaultUsersTab() {
  const [users, setUsers] = useState<DefaultUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newExp, setNewExp] = useState<number | string>(0);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/default-users');
      const d = await r.json();
      setUsers(d.users || []);
    } catch {}
    setLoading(false);
  };

  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleCreate = async () => {
    if (!newName.trim()) return alert('Enter a username');
    setUploading(true);
    try {
      let avatarUrl = '';
      if (avatarFile) {
        const formData = new FormData();
        formData.append('file', avatarFile);
        formData.append('name', newName.trim());
        const r = await fetch('/api/admin/upload-default-avatar', {
          method: 'POST',
          body: formData,
        });
        const d = await r.json();
        if (d.url) avatarUrl = d.url;
      }
      await fetch('/api/admin/default-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          avatarUrl,
          exp: parseInt(String(newExp)) || 0,
        }),
      });
      setNewName('');
      setNewExp(0);
      setAvatarFile(null);
      setAvatarPreview(null);
      setShowCreate(false);
      loadUsers();
    } catch {
      alert('Failed to create user');
    }
    setUploading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user and all their content?')) return;
    await fetch('/api/admin/default-users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    loadUsers();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-black">
          Default Users ({users.length})
        </h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
        >
          + New User
        </button>
      </div>
      <p className="text-sm text-black mb-4">
        Virtual users used as creators for default cards and seek questions.
      </p>

      {showCreate && (
        <div className="bg-white rounded-xl p-4 mb-4 border space-y-3">
          <div className="flex gap-4 items-start">
            <div className="shrink-0">
              <label className="cursor-pointer block">
                <div className="w-20 h-20 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden hover:border-blue-400 transition-colors">
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-gray-400 text-xs text-center leading-tight px-1">
                      Upload
                      <br />
                      300×300
                    </span>
                  )}
                </div>
                <input
                  type="file"
                  accept="image/webp,image/jpeg,image/jpg"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </label>
              <p className="text-xs text-gray-400 text-center mt-1">
                webp / jpg
              </p>
            </div>
            <div className="flex-1 space-y-3">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Username"
                className="w-full border rounded-lg px-3 py-2 text-sm text-black"
              />
              <div>
                <label className="text-xs text-black font-medium mb-1 block">
                  EXP{' '}
                  <span className="text-gray-400 font-normal">
                    (used for leaderboard ranking)
                  </span>
                </label>
                <input
                  type="number"
                  value={newExp}
                  onChange={(e) => setNewExp(e.target.value)}
                  min={0}
                  className="w-full border rounded-lg px-3 py-2 text-sm text-black"
                />
              </div>
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={uploading || !newName.trim()}
            className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-bold disabled:opacity-50"
          >
            {uploading ? 'Creating...' : 'Create User'}
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-black text-center py-8">Loading...</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {users.map((u) => (
            <div
              key={u.id}
              className="bg-white rounded-xl p-3 border flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden shrink-0">
                {u.avatar_url && (
                  <img
                    src={u.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate text-black">
                  {u.name}
                </p>
                <p className="text-xs text-black">{u.total_mins || 0} exp</p>
              </div>
              <button
                onClick={() => handleDelete(u.id)}
                className="text-red-600 text-sm shrink-0"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
