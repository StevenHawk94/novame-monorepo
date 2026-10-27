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
    loadHistory(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadHistory = async (hydrate=false) => {
    try {
      const d = await apiClient.get<{ success?: boolean; history?: ForceUpdateRow[] }>(
        '/api/force-update?history=true',
      );
      if (d.success) {
        const rows=d.history??[];setFuHistory(rows);
        const current=rows.find(row=>row.is_active);setFuActive(!!current);
        if(hydrate){const last=current??rows[0];if(last){
          setFuMinVersion(last.min_version??last.version??'');setFuMessage(last.message??'');
          setFuPlatform(last.platform==='ios'||last.platform==='android'?last.platform:'all');
        }}
      }
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
      loadDash();
      loadHistory(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to send force update');
    }
    setFuSending(false);
  };

  const cancelForceUpdate = async () => {
    if(fuSending||!confirm('Pause minimum-version enforcement? Older versions will be allowed again on their next launch.'))return;
    setFuSending(true);
    try{await apiClient.delete('/api/force-update');await loadDash();await loadHistory();}
    catch(e){alert(e instanceof Error?e.message:'Could not pause minimum-version enforcement');}
    finally{setFuSending(false);}
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
              <h3 className="font-bold text-black mb-3">最低支持版本 · Minimum Supported Version</h3>
              <p className="text-sm text-gray-500 mb-3">仅低于最低版本、且匹配所选平台的用户需要更新。可直接修改并保存，无需先暂停。新版本必须已在对应商店正式可下载。</p>
              {fuActive && (
                <div className="flex items-center justify-between bg-red-50 p-3 rounded-lg mb-3">
                  <div>
                    <span className="text-red-700 font-bold text-sm">
                      Minimum-version enforcement is ACTIVE
                    </span>
                    <p className="text-red-600 text-xs">
                      Below-minimum versions are blocked; supported versions are unaffected.
                    </p>
                  </div>
                  <button
                    onClick={cancelForceUpdate}
                    disabled={fuSending}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm"
                  >
                    Pause enforcement
                  </button>
                </div>
              )}
                <div className="flex gap-3">
                  <input
                    value={fuMinVersion}
                    onChange={(e) => setFuMinVersion(e.target.value)}
                    aria-label="Minimum supported version"
                    placeholder="例如 1.0.25"
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
                    maxLength={2000}
                    placeholder="更新页下方说明文字..."
                    className="border rounded-lg px-3 py-2 text-sm text-black flex-1"
                  />
                  <button
                    onClick={sendForceUpdate}
                    disabled={fuSending}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm shrink-0"
                  >
                    {fuSending ? 'Saving...' : fuActive ? 'Save changes' : 'Save & enable'}
                  </button>
                </div>
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
            </div>
          </>
        )
      )}
    </div>
  );
}
