'use client';

import { useEffect, useState } from 'react';

import type { User } from '@novame/core/types';
import { apiClient } from '@/lib/api-client';

export default function RealUsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<'all' | 'free' | 'plus'>('all');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const d = await apiClient.get<{ users?: User[] }>('/api/admin/users');
      setUsers(d.users || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const exportCSV = () => {
    const csv = [
      'email,display_name,created_at,subscription,paired_status',
    ]
      .concat(
        filtered.map(
          (u) =>
            `${u.email || ''},${u.display_name || ''},${u.created_at || ''},${
              u.subscription_tier || 'free'
            },${u.paired ? 'paired' : 'not_paired'}`
        )
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'users-export.csv';
    a.click();
  };

  const filtered = users.filter((u) => {
    const isPlus = !!u.subscription_tier && u.subscription_tier !== 'free';
    if (planFilter === 'free' && isPlus) return false;
    if (planFilter === 'plus' && !isPlus) return false;
    const query = search.trim().toLowerCase();
    return !query ||
      (u.email || '').toLowerCase().includes(query) ||
      (u.display_name || '').toLowerCase().includes(query);
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-black">
          Real Users ({filtered.length}{filtered.length !== users.length ? ` / ${users.length}` : ''})
        </h2>
        <button
          onClick={exportCSV}
          className="px-4 py-2 bg-gray-100 rounded-lg text-sm"
        >
          📥 Export CSV
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {(['all', 'free', 'plus'] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => setPlanFilter(filter)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${
              planFilter === filter ? 'bg-blue-600 text-white' : 'bg-white border text-black'
            }`}
          >
            {filter === 'all' ? 'All' : filter === 'free' ? 'Free' : 'Plus'}
          </button>
        ))}
      </div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email or name..."
        className="w-full border rounded-lg px-3 py-2 mb-4 text-sm text-black"
      />
      {loading ? (
        <p className="text-black text-center py-8">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-black">
              <tr>
                <th className="px-4 py-2 text-left">User</th>
                <th className="px-4 py-2 text-center">Paired Status</th>
                <th className="px-4 py-2 text-center">Plan</th>
                <th className="px-4 py-2 text-center">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-medium text-black">
                        {u.display_name || u.email?.split('@')[0]}
                      </span>
                      <br />
                      <span className="text-xs text-black">
                        {u.email || 'No email'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      u.paired ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {u.paired ? 'Paired' : 'Not paired'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        !u.subscription_tier || u.subscription_tier === 'free'
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
