'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StatCard, NavBtn } from './shared';

type Dashboard = {
  users: number;
  activeSubs: number;
  orders: number;
  pendingOrders: number;
  revenue: number;
  wisdoms: number;
  cards: number;
  todayLikes: number;
  totalUsers: number;
};

type Period = 'today' | '7days' | '30days' | '180days' | 'all';

const PERIODS: Period[] = ['today', '7days', '30days', '180days', 'all'];

export default function OverviewTab({
  stats: initialStats,
  loading: initLoading,
}: {
  stats: null;
  loading: boolean;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('all');
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(initLoading);
  const [fuVersion, setFuVersion] = useState('');
  const [fuMessage, setFuMessage] = useState('');
  const [fuActive, setFuActive] = useState(false);
  const [fuSending, setFuSending] = useState(false);

  useEffect(() => {
    loadDash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const loadDash = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/stats?period=${period}`);
      const d = await r.json();
      if (d.success) {
        setDash(d.dashboard);
        setFuActive(d.forceUpdateActive);
      }
    } catch {}
    setLoading(false);
  };

  const sendForceUpdate = async () => {
    if (!fuVersion || !fuMessage) return alert('Fill version and message');
    setFuSending(true);
    await fetch('/api/force-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: fuVersion, message: fuMessage }),
    });
    setFuVersion('');
    setFuMessage('');
    loadDash();
    setFuSending(false);
  };

  const cancelForceUpdate = async () => {
    await fetch('/api/force-update', { method: 'DELETE' });
    loadDash();
  };

  return (
    <div>
      {/* Time Filter */}
      <div className="flex gap-2 mb-6">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              period === p
                ? 'bg-blue-600 text-white'
                : 'bg-white text-black border'
            }`}
          >
            {p === 'all' ? 'All Time' : p === 'today' ? 'Today' : p}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        dash && (
          <>
            {/* Dashboard Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <StatCard icon="👥" label="Users" value={dash.users} />
              <StatCard icon="💎" label="Active Subs" value={dash.activeSubs} />
              <StatCard icon="📦" label="Orders" value={dash.orders} />
              <StatCard icon="⏳" label="Pending Orders" value={dash.pendingOrders} />
              <StatCard icon="💰" label="Revenue" value={`$${dash.revenue}`} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard icon="📚" label="Wisdoms" value={dash.wisdoms} />
              <StatCard icon="🃏" label="User Cards" value={dash.cards} />
              <StatCard icon="❤️" label="Today Likes" value={dash.todayLikes} />
              <StatCard icon="👥" label="Total Users" value={dash.totalUsers} />
            </div>

            {/* Force Update Control */}
            <div className="bg-white rounded-xl p-5 border mb-6">
              <h3 className="font-bold text-black mb-3">🚨 Force App Update</h3>
              {fuActive ? (
                <div className="flex items-center justify-between bg-red-50 p-3 rounded-lg">
                  <div>
                    <span className="text-red-700 font-bold text-sm">
                      Force update is ACTIVE
                    </span>
                    <p className="text-red-600 text-xs">
                      All users will see a mandatory update prompt
                    </p>
                  </div>
                  <button
                    onClick={cancelForceUpdate}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm"
                  >
                    Deactivate
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <input
                    value={fuVersion}
                    onChange={(e) => setFuVersion(e.target.value)}
                    placeholder="Version (e.g. 1.2.0)"
                    className="border rounded-lg px-3 py-2 text-sm text-black w-32"
                  />
                  <input
                    value={fuMessage}
                    onChange={(e) => setFuMessage(e.target.value)}
                    placeholder="Update message..."
                    className="border rounded-lg px-3 py-2 text-sm text-black flex-1"
                  />
                  <button
                    onClick={sendForceUpdate}
                    disabled={fuSending}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm shrink-0"
                  >
                    {fuSending ? '...' : 'Send'}
                  </button>
                </div>
              )}
            </div>

            {/* Quick Nav */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <NavBtn
                icon="📢"
                label="Announcements"
                onClick={() => router.push('/admin/announcements')}
              />
            </div>
          </>
        )
      )}
    </div>
  );
}
