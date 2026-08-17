'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StatCard, NavBtn } from './shared';
import { apiClient } from '@/lib/api-client';

type Dashboard = {
  users: number;
  activeSubs: number;
};

type ForceUpdateRow = {
  id: string;
  min_version: string | null;
  version: string | null;
  message: string | null;
  platform: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

export default function OverviewTab() {
  const router = useRouter();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [fuMinVersion, setFuMinVersion] = useState('');
  const [fuMessage, setFuMessage] = useState('');
  const [fuPlatform, setFuPlatform] = useState<'ios' | 'android' | 'all'>('all');
  const [fuActive, setFuActive] = useState(false);
  const [fuSending, setFuSending] = useState(false);
  const [fuHistory, setFuHistory] = useState<ForceUpdateRow[]>([]);

  useEffect(() => {
    loadDash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistory = async () => {
    try {
      const d = await apiClient.get<{ success?: boolean; history?: ForceUpdateRow[] }>(
        '/api/force-update?history=true',
      );
      if (d.success) setFuHistory(d.history ?? []);
    } catch {}
  };

  const loadDash = async () => {
    setLoading(true);
    try {
      const d = await apiClient.get<{ success?: boolean; dashboard?: Dashboard; forceUpdateActive?: boolean }>('/api/admin/stats');
      if (d.success) {
        setDash(d.dashboard ?? null);
        setFuActive(!!d.forceUpdateActive);
      }
    } catch {}
    setLoading(false);
  };

  const sendForceUpdate = async () => {
    if (!fuMinVersion || !fuMessage) return alert('Fill minimum version and message');
    if (!/^\d+\.\d+\.\d+$/.test(fuMinVersion.trim())) {
      return alert('Minimum version must be semver, e.g. 1.2.0');
    }
    if (
      !confirm(
        `Force ALL users below version ${fuMinVersion.trim()} (${fuPlatform}) to update?\n\n` +
          'They will be blocked from using the app until they update. Make sure ' +
          'this version is already live on the App Store.',
      )
    ) {
      return;
    }
    setFuSending(true);
    try {
      await apiClient.post('/api/force-update', {
        minVersion: fuMinVersion.trim(),
        message: fuMessage,
        platform: fuPlatform,
      });
      setFuMinVersion('');
      setFuMessage('');
      setFuPlatform('all');
      loadDash();
      loadHistory();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to send force update');
    }
    setFuSending(false);
  };

  const cancelForceUpdate = async () => {
    await apiClient.delete('/api/force-update');
    loadDash();
    loadHistory();
  };

  return (
    <div>
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        dash && (
          <>
            {/* Dashboard Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <StatCard icon="👥" label="Users" value={dash.users} />
              <StatCard icon="💎" label="Active Subs" value={dash.activeSubs} />
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
                    value={fuMinVersion}
                    onChange={(e) => setFuMinVersion(e.target.value)}
                    placeholder="Min version (e.g. 1.2.0)"
                    className="border rounded-lg px-3 py-2 text-sm text-black w-36"
                  />
                  <select
                    value={fuPlatform}
                    onChange={(e) => setFuPlatform(e.target.value as 'ios' | 'android' | 'all')}
                    className="border rounded-lg px-3 py-2 text-sm text-black w-28"
                  >
                    <option value="all">All</option>
                    <option value="ios">iOS</option>
                    <option value="android">Android</option>
                  </select>
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

            {/* Force Update History */}
            <div className="bg-white rounded-xl p-5 border mb-6">
              <h3 className="font-bold text-black mb-3">
                🕘 Force Update History ({fuHistory.length})
              </h3>
              {fuHistory.length === 0 ? (
                <p className="text-gray-500 text-sm">No force updates created yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-black">
                    <thead>
                      <tr className="text-left text-gray-500 border-b">
                        <th className="py-2 pr-4">Min Version</th>
                        <th className="py-2 pr-4">Platform</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Message</th>
                        <th className="py-2 pr-4">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fuHistory.map((row) => (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono">
                            {row.min_version ?? row.version ?? '—'}
                          </td>
                          <td className="py-2 pr-4">{row.platform ?? 'all'}</td>
                          <td className="py-2 pr-4">
                            {row.is_active ? (
                              <span className="text-red-600 font-bold">ACTIVE</span>
                            ) : (
                              <span className="text-gray-400">inactive</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 max-w-xs truncate">{row.message ?? '—'}</td>
                          <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">
                            {row.created_at
                              ? new Date(row.created_at).toLocaleString()
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
              <NavBtn
                icon="🚫"
                label="Block List"
                onClick={() => router.push('/admin/block-list')}
              />
              <NavBtn
                icon="🚨"
                label="Report List"
                onClick={() => router.push('/admin/report-list')}
              />
            </div>
          </>
        )
      )}
    </div>
  );
}
