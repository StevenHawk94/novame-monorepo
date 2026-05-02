'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import type { Announcement } from '@novame/core/types';

type AnnouncementForm = {
  title: string;
  content: string;
  type: string;
  target_users: string;
  end_at: string;
};

const TYPES = [
  { value: 'info', label: 'ℹ️ 信息' },
  { value: 'update', label: '🆕 更新' },
  { value: 'promotion', label: '🎉 活动' },
  { value: 'warning', label: '⚠️ 警告' },
];

const TARGETS = [
  { value: 'all', label: '所有用户' },
  { value: 'free', label: '仅免费用户' },
  { value: 'paid', label: '仅付费用户' },
];

const TYPE_STYLES: Record<string, string> = {
  info: 'bg-blue-100 text-blue-700',
  update: 'bg-green-100 text-green-700',
  promotion: 'bg-purple-100 text-purple-700',
  warning: 'bg-amber-100 text-amber-700',
};

const TYPE_LABELS: Record<string, string> = {
  info: '信息',
  update: '更新',
  promotion: '活动',
  warning: '警告',
};

const TARGET_LABELS: Record<string, string> = {
  all: '所有用户',
  free: '免费用户',
  paid: '付费用户',
};

export default function AdminAnnouncements() {
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AnnouncementForm>({
    title: '',
    content: '',
    type: 'info',
    target_users: 'all',
    end_at: '',
  });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/announcements');
      const data = await res.json();
      if (data.success) setAnnouncements(data.announcements);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: !isActive }),
      });
      if ((await res.json()).success) load();
    } catch {
      alert('操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这条公告？')) return;
    try {
      const res = await fetch(`/api/admin/announcements?id=${id}`, {
        method: 'DELETE',
      });
      if ((await res.json()).success) load();
    } catch {
      alert('删除失败');
    }
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      alert('请填写标题和内容');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/admin/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.success) {
        setShowAdd(false);
        setForm({ title: '', content: '', type: 'info', target_users: 'all', end_at: '' });
        load();
        alert('公告创建成功！');
      } else alert('创建失败');
    } catch {
      alert('创建失败');
    }
    setAdding(false);
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
        <h1 className="text-xl font-bold">📢 通知公告</h1>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm mb-6 flex flex-wrap gap-4 items-center justify-between">
        <div>
          <p className="text-gray-600">用户打开 App 时会看到活跃的公告弹窗</p>
          <p className="text-sm text-gray-400">每个用户只会看到一次（关闭后不再显示）</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
        >
          + 新建公告
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-purple-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        TYPE_STYLES[a.type] || TYPE_STYLES.info
                      }`}
                    >
                      {TYPE_LABELS[a.type] || a.type}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        a.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {a.is_active ? '✓ 活跃' : '已暂停'}
                    </span>
                    <span className="text-xs text-gray-400">
                      目标: {TARGET_LABELS[a.target_users] || a.target_users}
                    </span>
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">
                    {a.title}
                  </h3>
                  <p className="text-gray-600 whitespace-pre-wrap">{a.content}</p>
                  <div className="flex gap-4 mt-3 text-xs text-gray-400">
                    <span>创建: {new Date(a.created_at).toLocaleDateString()}</span>
                    {a.end_at && (
                      <span>截止: {new Date(a.end_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => handleToggle(a.id, a.is_active)}
                    className={`px-3 py-2 rounded-lg text-sm ${
                      a.is_active
                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  >
                    {a.is_active ? '⏸️ 暂停' : '▶️ 启用'}
                  </button>
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm hover:bg-red-100"
                  >
                    🗑️ 删除
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!announcements.length && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-2">📢</p>
              <p>还没有公告</p>
            </div>
          )}
        </div>
      )}

      {/* 添加弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="p-5 border-b flex justify-between items-center">
              <h2 className="text-lg font-bold">新建公告</h2>
              <button
                onClick={() => setShowAdd(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleAdd} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">标题 *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="例如：Welcome to Visdom!"
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">内容 *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="公告的详细内容..."
                  rows={4}
                  className="w-full px-3 py-2 border rounded-lg resize-none"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">类型</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">目标用户</label>
                  <select
                    value={form.target_users}
                    onChange={(e) =>
                      setForm({ ...form, target_users: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    {TARGETS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  截止日期（可选）
                </label>
                <input
                  type="date"
                  value={form.end_at}
                  onChange={(e) => setForm({ ...form, end_at: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
                <p className="text-xs text-gray-400 mt-1">
                  留空则永久显示（直到手动暂停）
                </p>
              </div>

              {/* 预览 */}
              <div>
                <label className="block text-sm font-medium mb-2">预览效果</label>
                <div className="border rounded-xl overflow-hidden">
                  <div
                    className={`p-4 text-white text-center ${
                      form.type === 'info'
                        ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
                        : form.type === 'update'
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                        : form.type === 'promotion'
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500'
                        : 'bg-gradient-to-r from-amber-500 to-orange-500'
                    }`}
                  >
                    <p className="text-3xl mb-1">
                      {form.type === 'info'
                        ? 'ℹ️'
                        : form.type === 'update'
                        ? '🆕'
                        : form.type === 'promotion'
                        ? '🎉'
                        : '⚠️'}
                    </p>
                    <p className="font-bold">{form.title || '标题'}</p>
                  </div>
                  <div className="p-4 bg-white">
                    <p className="text-gray-600 text-sm">
                      {form.content || '内容预览...'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="flex-1 py-3 bg-gray-100 rounded-xl"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="flex-1 py-3 bg-purple-600 text-white rounded-xl disabled:bg-gray-300"
                >
                  {adding ? '创建中...' : '发布公告'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
