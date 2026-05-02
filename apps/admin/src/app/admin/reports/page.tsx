'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { Report } from '@novame/core/types';

type ReportFilter = 'pending' | 'resolved' | 'dismissed';
type ReportAction = 'dismiss' | 'warn' | 'delete';

const REASONS: Record<string, string> = {
  inappropriate: '不当内容',
  spam: '垃圾信息',
  harassment: '骚扰',
  hate_speech: '仇恨言论',
  violence: '暴力内容',
  misinformation: '虚假信息',
  copyright: '版权问题',
  other: '其他',
};

const FILTERS: [ReportFilter, string][] = [
  ['pending', '待处理'],
  ['resolved', '已处理'],
  ['dismissed', '已忽略'],
];

export default function AdminReports() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReportFilter>('pending');
  const [detail, setDetail] = useState<Report | null>(null);
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reports?status=${filter}`);
      const data = await res.json();
      if (data.success) setReports(data.reports);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleAction = async (action: ReportAction) => {
    if (!detail) return;
    setProcessing(true);
    try {
      const res = await fetch('/api/admin/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: detail.id, action, adminNotes: notes }),
      });
      const data = await res.json();
      if (data.success) {
        setDetail(null);
        setNotes('');
        load();
        alert(action === 'dismiss' ? '已忽略' : action === 'delete' ? '已删除内容' : '已处理');
      } else alert('处理失败: ' + data.error);
    } catch {
      alert('处理失败');
    }
    setProcessing(false);
  };

  const statusLabel = (s: string) => {
    if (s === 'pending') return { text: '待处理', color: 'bg-amber-100 text-amber-700' };
    if (s === 'resolved') return { text: '已处理', color: 'bg-green-100 text-green-700' };
    if (s === 'dismissed') return { text: '已忽略', color: 'bg-gray-100 text-gray-600' };
    return { text: s, color: 'bg-gray-100 text-gray-600' };
  };

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => router.push('/admin')}
          className="text-gray-500 hover:text-gray-700"
        >
          ← 返回
        </button>
        <h1 className="text-xl font-bold">🚨 举报管理</h1>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm mb-6">
        <div className="flex gap-2">
          {FILTERS.map(([k, v]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                filter === k
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-red-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => {
            const st = statusLabel(r.status);
            return (
              <div key={r.id} className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${st.color}`}
                      >
                        {st.text}
                      </span>
                      <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                        {REASONS[r.reason] || r.reason}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="mb-3">
                      <p className="text-sm text-gray-500 mb-1">
                        被举报内容（{r.report_type}）：
                      </p>
                      <p className="bg-gray-50 p-3 rounded-lg text-sm">
                        {r.target?.text || r.target?.description || '内容已删除或不可用'}
                      </p>
                    </div>

                    {r.details && (
                      <div className="mb-3">
                        <p className="text-sm text-gray-500 mb-1">举报详情：</p>
                        <p className="text-sm italic text-gray-600">
                          &quot;{r.details}&quot;
                        </p>
                      </div>
                    )}

                    <p className="text-sm text-gray-500">
                      举报人：{r.reporter?.display_name || 'Anonymous'}
                    </p>

                    {r.admin_notes && (
                      <div className="mt-2 p-2 bg-blue-50 rounded-lg">
                        <p className="text-sm text-blue-700">
                          处理备注：{r.admin_notes}
                        </p>
                      </div>
                    )}
                  </div>

                  {r.status === 'pending' && (
                    <button
                      onClick={() => {
                        setDetail(r);
                        setNotes('');
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 h-fit"
                    >
                      处理
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {!reports.length && (
            <div className="text-center py-12 text-gray-400">
              暂无{filter === 'pending' ? '待处理' : ''}举报
            </div>
          )}
        </div>
      )}

      {/* 处理弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg">
            <div className="p-5 border-b flex justify-between items-center">
              <h2 className="text-lg font-bold">处理举报</h2>
              <button
                onClick={() => setDetail(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-sm text-gray-500 mb-1">被举报内容：</p>
                <p className="bg-gray-50 p-3 rounded-lg text-sm">
                  {detail.target?.text || '内容不可用'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">
                  举报原因：{REASONS[detail.reason] || detail.reason}
                </p>
                {detail.details && (
                  <p className="text-sm italic text-gray-600">
                    &quot;{detail.details}&quot;
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">处理备注</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="可选..."
                  className="w-full px-3 py-2 border rounded-lg resize-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-3 pt-2">
                <button
                  onClick={() => handleAction('dismiss')}
                  disabled={processing}
                  className="py-3 bg-gray-100 rounded-xl text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                >
                  忽略
                </button>
                <button
                  onClick={() => handleAction('warn')}
                  disabled={processing}
                  className="py-3 bg-amber-100 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-200 disabled:opacity-50"
                >
                  警告用户
                </button>
                <button
                  onClick={() => handleAction('delete')}
                  disabled={processing}
                  className="py-3 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  删除内容
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
