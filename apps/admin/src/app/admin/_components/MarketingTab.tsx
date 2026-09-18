'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type Variant = {
  id: string;
  variant_key: string;
  headline: string;
  subheadline: string;
  cta_heading: string;
  benefits: string[];
  weight: number;
  sort_order: number;
  is_active: boolean;
  impressions: number;
  clicks: number;
  ctr: number;
};

type Draft = Omit<Variant, 'id' | 'impressions' | 'clicks' | 'ctr'> & { id?: string };

const blankDraft = (): Draft => ({
  variant_key: '', headline: '', subheadline: '', cta_heading: 'Go Plus for Real-Time Insight',
  benefits: ['', '', '', ''], weight: 100, sort_order: 99, is_active: true,
});

function VariantEditor({ value, onSaved, onDeleted }: {
  value: Variant;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({ ...value });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof Draft, next: unknown) => setDraft((current) => ({ ...current, [key]: next }));
  const save = async () => {
    setSaving(true);
    try {
      await apiClient.patch('/api/admin/marketing-paywalls', draft);
      onSaved();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Save failed');
    } finally { setSaving(false); }
  };
  const archive = async () => {
    if (!window.confirm(`Remove variant ${value.variant_key}? Its historical metrics will be kept.`)) return;
    await apiClient.delete(`/api/admin/marketing-paywalls?id=${encodeURIComponent(value.id)}`);
    onDeleted();
  };
  return (
    <section className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-black">Version {value.variant_key}</h3>
          <p className="text-sm text-gray-500">
            {value.impressions.toLocaleString()} impressions · {value.clicks.toLocaleString()} clicks · {(value.ctr * 100).toFixed(1)}% CTR
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-black">
          <input type="checkbox" checked={draft.is_active} onChange={(event) => set('is_active', event.target.checked)} /> Active
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-black">Version key
          <input className="mt-1 w-full rounded border px-3 py-2" value={draft.variant_key} onChange={(event) => set('variant_key', event.target.value)} />
        </label>
        <label className="text-sm text-black">Traffic weight
          <input type="number" min="0" className="mt-1 w-full rounded border px-3 py-2" value={draft.weight} onChange={(event) => set('weight', Number(event.target.value))} />
        </label>
      </div>
      <label className="mt-3 block text-sm text-black">Headline
        <input className="mt-1 w-full rounded border px-3 py-2" value={draft.headline} onChange={(event) => set('headline', event.target.value)} />
      </label>
      <label className="mt-3 block text-sm text-black">Subheadline
        <textarea className="mt-1 w-full rounded border px-3 py-2" rows={2} value={draft.subheadline} onChange={(event) => set('subheadline', event.target.value)} />
      </label>
      <label className="mt-3 block text-sm text-black">Card heading
        <input className="mt-1 w-full rounded border px-3 py-2" value={draft.cta_heading} onChange={(event) => set('cta_heading', event.target.value)} />
      </label>
      <label className="mt-3 block text-sm text-black">Benefits (one per line)
        <textarea className="mt-1 w-full rounded border px-3 py-2" rows={5} value={draft.benefits.join('\n')} onChange={(event) => set('benefits', event.target.value.split('\n'))} />
      </label>
      <div className="mt-4 flex gap-3">
        <button disabled={saving} onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={archive} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700">Remove</button>
      </div>
    </section>
  );
}

export default function MarketingTab() {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ variants?: Variant[] }>('/api/admin/marketing-paywalls');
      setVariants(data.variants || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async () => {
    setCreating(true);
    try {
      await apiClient.post('/api/admin/marketing-paywalls', draft);
      setDraft(blankDraft());
      await load();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Create failed');
    } finally { setCreating(false); }
  };
  const set = (key: keyof Draft, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-black">Marketing</h2>
        <p className="mt-1 text-sm text-gray-600">Partner Reflect paywall copy, traffic weights, impressions, clicks and CTR.</p>
      </header>
      {loading ? <p className="text-gray-600">Loading…</p> : variants.map((variant) => (
        <VariantEditor key={variant.id} value={variant} onSaved={load} onDeleted={load} />
      ))}
      <section className="rounded-xl border-2 border-dashed bg-gray-50 p-5">
        <h3 className="text-lg font-semibold text-black">Add a version</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input className="rounded border px-3 py-2" placeholder="Version key, e.g. F" value={draft.variant_key} onChange={(event) => set('variant_key', event.target.value)} />
          <input type="number" min="0" className="rounded border px-3 py-2" placeholder="Traffic weight" value={draft.weight} onChange={(event) => set('weight', Number(event.target.value))} />
        </div>
        <input className="mt-3 w-full rounded border px-3 py-2" placeholder="Headline" value={draft.headline} onChange={(event) => set('headline', event.target.value)} />
        <textarea className="mt-3 w-full rounded border px-3 py-2" rows={2} placeholder="Subheadline" value={draft.subheadline} onChange={(event) => set('subheadline', event.target.value)} />
        <input className="mt-3 w-full rounded border px-3 py-2" placeholder="Card heading" value={draft.cta_heading} onChange={(event) => set('cta_heading', event.target.value)} />
        <textarea className="mt-3 w-full rounded border px-3 py-2" rows={5} placeholder="Benefits, one per line" value={draft.benefits.join('\n')} onChange={(event) => set('benefits', event.target.value.split('\n'))} />
        <button disabled={creating} onClick={create} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{creating ? 'Adding…' : 'Add version'}</button>
      </section>
    </div>
  );
}
