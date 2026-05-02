'use client';

import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';

import type { Wisdom } from '@novame/core/types';

type WisdomForm = {
  audio_url: string;
  text: string;
  description: string;
  duration_seconds: number;
  categories: string[];
  creator_name: string;
};

type WisdomFilter = 'all' | 'default' | 'user';

const FILTERS: [WisdomFilter, string][] = [
  ['all', '全部'],
  ['default', '系统'],
  ['user', '用户'],
];

const CATS = [
  'Self-Love', 'Romance', 'Love', 'Inspirational', 'Happiness',
  'Parenting', 'Friendship', 'Career', 'Productivity', 'Communication',
  'Emotional Intelligence', 'Resilience', 'Creativity', 'Change', 'Life',
];

export default function AdminWisdoms() {
  const router = useRouter();
  const [wisdoms, setWisdoms] = useState<Wisdom[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<WisdomFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState<Wisdom | null>(null);
  const [form, setForm] = useState<WisdomForm>({
    audio_url: '',
    text: '',
    description: '',
    duration_seconds: 30,
    categories: [],
    creator_name: 'Visdom Team',
  });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const load = async (p = 0, append = false) => {
    if (!append) setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/wisdoms?page=${p}&limit=20&filter=${filter}&search=${search}`
      );
      const data = await res.json();
      if (data.success) {
        setWisdoms(append ? [...wisdoms, ...data.wisdoms] : data.wisdoms);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setPage(p);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除？')) return;
    const res = await fetch(`/api/admin/wisdoms?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      setWisdoms(wisdoms.filter((w) => w.id !== id));
      setDetail(null);
      alert('已删除');
    } else alert('删除失败');
  };

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.audio_url || !form.text) {
      alert('请填写音频地址和文字内容');
      return;
    }
    setAdding(true);
    const res = await fetch('/api/admin/wisdoms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setAdding(false);
    if (data.success) {
      setShowAdd(false);
      setForm({
        audio_url: '',
        text: '',
        description: '',
        duration_seconds: 30,
        categories: [],
        creator_name: 'Visdom Team',
      });
      load(0);
      alert('添加成功');
    } else alert('添加失败');
  };

  const toggleCat = (c: string) =>
    setForm({
      ...form,
      categories: form.categories.includes(c)
        ? form.categories.filter((x) => x !== c)
        : [...form.categories, c],
    });

  const openAudio = (e: MouseEvent, url: string) => {
    e.stopPropagation();
    window.open(url, '_blank');
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    load(0);
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
        <h1 className="text-xl font-bold">💬 Wisdoms 管理</h1>
        <span className="text-sm text-gray-400">共 {total} 条</span>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm mb-6 flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-2">
          {FILTERS.map(([k, v]) => (
            <button
              key={k}
              onClick={() => {
                setFilter(k);
                setPage(0);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                filter === k
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索..."
            className="px-3 py-2 border rounded-lg text-sm w-40"
          />
          <button className="px-3 py-2 bg-gray-100 rounded-lg text-sm">
            搜索
          </button>
        </form>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
        >
          + 添加
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {wisdoms.map((w) => (
            <div
              key={w.id}
              onClick={() => setDetail(w)}
              className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md cursor-pointer transition-all"
            >
              <div className="flex justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        w.user_id
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {w.user_id ? '用户' : '系统'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(w.created_at).toLocaleDateString()}
                    </span>
                    <span className="text-xs text-gray-400">
                      {w.duration_seconds}秒
                    </span>
                  </div>
                  <p className="text-gray-900 line-clamp-2 mb-2">
                    {w.text || w.description || '无内容'}
                  </p>
                  <div className="flex gap-4 text-sm text-gray-500">
                    <span>👤 {w.creator_name || 'Anonymous'}</span>
                    <span>🎧 {w.listens || 0}</span>
                    <span>❤️ {w.likes || 0}</span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {w.audio_url && (
                    <button
                      onClick={(e) => openAudio(e, w.audio_url!)}
                      className="px-3 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200"
                    >
                      🎵
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(w.id);
                    }}
                    className="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-sm hover:bg-red-100"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!wisdoms.length && (
            <div className="text-center py-12 text-gray-400">暂无数据</div>
          )}
          {hasMore && wisdoms.length > 0 && (
            <button
              onClick={() => load(page + 1, true)}
              className="w-full py-3 bg-white rounded-xl text-gray-600 hover:bg-gray-100"
            >
              加载更多
            </button>
          )}
        </div>
      )}

      {/* 添加弹窗 */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-auto">
            <div className="p-5 border-b flex justify-between items-center">
              <h2 className="text-lg font-bold">添加 Wisdom</h2>
              <button
                onClick={() => setShowAdd(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleAdd} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  音频地址 *
                </label>
                <input
                  value={form.audio_url}
                  onChange={(e) => setForm({ ...form, audio_url: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  文字内容 *
                </label>
                <textarea
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                  rows={4}
                  className="w-full px-3 py-2 border rounded-lg resize-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">简短描述</label>
                <input
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">
                    时长(秒)
                  </label>
                  <input
                    type="number"
                    value={form.duration_seconds}
                    onChange={(e) =>
                      setForm({ ...form, duration_seconds: +e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">创建者</label>
                  <input
                    value={form.creator_name}
                    onChange={(e) =>
                      setForm({ ...form, creator_name: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">分类</label>
                <div className="flex flex-wrap gap-2">
                  {CATS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCat(c)}
                      className={`px-3 py-1 rounded-full text-sm ${
                        form.categories.includes(c)
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
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
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl disabled:bg-gray-300"
                >
                  {adding ? '添加中...' : '确认添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b flex justify-between items-center">
              <h2 className="text-lg font-bold">详情</h2>
              <button
                onClick={() => setDetail(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-2">
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    detail.user_id
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {detail.user_id ? '用户创建' : '系统内容'}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(detail.created_at).toLocaleString()}
                </span>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">创建者</p>
                <p className="font-medium">{detail.creator_name || 'Anonymous'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 mb-1">内容</p>
                <p className="bg-gray-50 p-3 rounded-lg whitespace-pre-wrap">
                  {detail.text || detail.description || '无'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <p className="text-xl font-bold">{detail.duration_seconds || 0}</p>
                  <p className="text-xs text-gray-500">秒</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <p className="text-xl font-bold">{detail.listens || 0}</p>
                  <p className="text-xs text-gray-500">播放</p>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg text-center">
                  <p className="text-xl font-bold">{detail.likes || 0}</p>
                  <p className="text-xs text-gray-500">点赞</p>
                </div>
              </div>
              {detail.categories && detail.categories.length > 0 && (
                <div>
                  <p className="text-sm text-gray-500 mb-2">分类</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.categories.map((c) => (
                      <span key={c} className="px-2 py-1 bg-gray-100 rounded text-sm">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {detail.audio_url && (
                <div>
                  <p className="text-sm text-gray-500 mb-2">音频</p>
                  <audio controls src={detail.audio_url} className="w-full" />
                </div>
              )}
              <p className="text-xs text-gray-400 break-all">ID: {detail.id}</p>
            </div>
            <div className="p-5 border-t">
              <button
                onClick={() => handleDelete(detail.id)}
                className="w-full py-3 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100"
              >
                🗑️ 删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
