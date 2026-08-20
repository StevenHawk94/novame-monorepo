'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import type { Announcement } from '@novame/core/types';
import { apiClient } from '@/lib/api-client';

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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const resetComposer = () => {
    setShowAdd(false);
    setForm({ title: '', content: '', type: 'info', target_users: 'all', end_at: '' });
    setImageFile(null);
    setImagePreview('');
  };

  const handleImageChange = (file: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      alert('仅支持 PNG、JPG 或 WEBP 图片');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      alert('图片不能超过 8 MB');
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ success?: boolean; announcements?: Announcement[] }>('/api/admin/announcements');
      if (data.success && data.announcements) setAnnouncements(data.announcements);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      const data = await apiClient.patch<{ success?: boolean }>('/api/admin/announcements', { id, is_active: !isActive });
      if (data.success) load();
    } catch {
      alert('操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这条公告？')) return;
    try {
      const data = await apiClient.delete<{ success?: boolean }>(`/api/admin/announcements?id=${id}`);
      if (data.success) load();
    } catch {
      alert('删除失败');
    }
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim() || !imageFile) {
      alert('请填写标题、上传图片并填写详情文字');
      return;
    }
    setAdding(true);
    try {
      const presign = await apiClient.post<{
        success?: boolean;
        uploadUrl?: string;
        publicUrl?: string;
        contentType?: string;
      }>('/api/admin/announcements/presign', { contentType: imageFile.type });
      if (!presign.success || !presign.uploadUrl || !presign.publicUrl) {
        throw new Error('Unable to prepare upload');
      }
      const uploaded = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': presign.contentType || imageFile.type },
        body: imageFile,
      });
      if (!uploaded.ok) throw new Error(`Upload failed (${uploaded.status})`);

      const data = await apiClient.post<{ success?: boolean }>('/api/admin/announcements', {
        ...form,
        image_url: presign.publicUrl,
      });
      if (data.success) {
        resetComposer();
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
                  {a.image_url && (
                    <img
                      src={a.image_url}
                      alt={a.title}
                      className="w-full max-w-sm aspect-square object-contain rounded-xl bg-amber-50 mb-3"
                    />
                  )}
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
                onClick={resetComposer}
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
                <label className="block text-sm font-medium mb-1">公告图片 *</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => handleImageChange(e.target.files?.[0] ?? null)}
                  className="w-full px-3 py-2 border rounded-lg bg-white"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">PNG / JPG / WEBP，最大 8 MB</p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">详情文字 *</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="图片下方展示的公告详情..."
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
                <div className="rounded-2xl bg-[#6E3F2C] p-5 text-center text-white">
                  <p className="font-bold text-xl mb-4">{form.title || '公告标题'}</p>
                  <div className="aspect-square w-full rounded-xl overflow-hidden bg-[#FFF4D8] mb-4 flex items-center justify-center">
                    {imagePreview ? (
                      <img src={imagePreview} alt="公告预览" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[#9B806B] text-sm">公告图片预览</span>
                    )}
                  </div>
                  <p className="font-semibold whitespace-pre-wrap mb-5">
                    {form.content || '详情文字预览...'}
                  </p>
                  <div className="rounded-xl bg-[#FFF4D8] py-3 font-bold text-[#4A2F1E]">Start Today</div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetComposer}
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
