'use client';

import { useEffect, useState } from 'react';

// TODO(1.4): replace with shared type from @novame/core/types
type User = {
  id: string;
  email?: string;
  display_name?: string;
  avatar_url?: string;
  created_at?: string;
  wisdoms_count?: number;
  cards_count?: number;
  subscription_tier?: string;
};

export default function RealUsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/users');
      const d = await r.json();
      setUsers(d.users || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const exportCSV = () => {
    const csv = [
      'email,display_name,created_at,wisdoms_count,cards_count,subscription',
    ]
      .concat(
        users.map(
          (u) =>
            `${u.email || ''},${u.display_name || ''},${u.created_at || ''},${
              u.wisdoms_count || 0
            },${u.cards_count || 0},${u.subscription_tier || 'free'}`
        )
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'users-export.csv';
    a.click();
  };

  const filtered = users.filter(
    (u) =>
      !search ||
      (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.display_name || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-black">
          Real Users ({users.length})
        </h2>
        <button
          onClick={exportCSV}
          className="px-4 py-2 bg-gray-100 rounded-lg text-sm"
        >
          📥 Export CSV
        </button>
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email or name..."
        className="w-full border rounded-lg px-3 py-2 mb-4 text-sm"
      />
      {loading ? (
        <p className="text-black text-center py-8">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-black">
              <tr>
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-center">Wisdoms</th>
                <th className="px-4 py-2 text-center">Cards</th>
                <th className="px-4 py-2 text-center">Plan</th>
                <th className="px-4 py-2 text-center">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden shrink-0">
                        {u.avatar_url && (
                          <img
                            src={u.avatar_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div>
                        <span className="font-medium text-black">
                          {u.display_name || u.email?.split('@')[0]}
                        </span>
                        <br />
                        <span className="text-xs text-black">
                          {u.email || 'No email'}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center text-black">
                    {u.wisdoms_count || 0}
                  </td>
                  <td className="px-4 py-3 text-center text-black">
                    {u.cards_count || 0}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        u.subscription_tier === 'free'
                          ? 'bg-gray-100 text-black'
                          : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {u.subscription_tier || 'free'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-black">
                    {u.created_at
                      ? new Date(u.created_at).toLocaleDateString()
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
