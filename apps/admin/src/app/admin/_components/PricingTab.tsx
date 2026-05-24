'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

import { apiClient } from '@/lib/api-client';

/**
 * PricingTab -- Stage A4.2.
 *
 * Admin UI to edit the 5 dynamic config values stored in Supabase
 * app_config. Read/write via /api/admin/app-config (Stage A4.1).
 *
 * UX:
 *   - Two sections: Pricing (USD) -- 3 fields; Unlock Thresholds -- 2.
 *   - Dirty check: Save button disabled until at least one field
 *     differs from the original loaded values.
 *   - Save is all-or-nothing: server validates the whole batch and
 *     refuses on first invalid field (e.g. cards_unlock_count > 48).
 *   - Each row shows the last admin email + relative time below the
 *     input, e.g. "Last updated by alice@... 2 hours ago".
 *
 * Mobile end-to-end:
 *   admin saves -> app_config row updates ->
 *   mobile GET /api/app-config returns new values ->
 *   mobile MMKV cache refreshed on next product-detail mount /
 *   payment-stub force refresh.
 */

type ConfigRow = {
  key: string;
  value: string;
  updated_by: string | null;
  updated_at: string | null;
};

type GetResponse = { success: boolean; rows?: ConfigRow[]; error?: string };
type PostResponse = {
  success: boolean;
  updated?: Array<{ key: string; value: string }>;
  updatedBy?: string;
  updatedAt?: string;
  error?: string;
};

type FieldSpec = {
  key: string;
  label: string;
  hint: string;
  kind: 'price' | 'integer';
  min?: number;
  max?: number;
};

const PRICING_FIELDS: FieldSpec[] = [
  {
    key: 'printed_book_price',
    label: 'Printed Book Price',
    hint: 'USD per Wisdom Book.',
    kind: 'price',
    min: 0,
  },
  {
    key: 'wisdom_cards_price',
    label: 'Wisdom Cards Price',
    hint: 'USD per Wisdom Cards deck.',
    kind: 'price',
    min: 0,
  },
  {
    key: 'shipping_fee',
    label: 'Shipping Fee',
    hint: 'USD flat shipping. Set to 0 for free shipping.',
    kind: 'price',
    min: 0,
  },
];

const UNLOCK_FIELDS: FieldSpec[] = [
  {
    key: 'book_unlock_words',
    label: 'Book Unlock Threshold',
    hint: 'Total recorded words required to unlock the Wisdom Book.',
    kind: 'integer',
    min: 0,
  },
  {
    key: 'cards_unlock_count',
    label: 'Cards Unlock Threshold',
    hint: 'Unique keywords collected to unlock the Wisdom Cards deck. Max 48.',
    kind: 'integer',
    min: 1,
    max: 48,
  },
];

const ALL_FIELDS = [...PRICING_FIELDS, ...UNLOCK_FIELDS];

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never';
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export default function PricingTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ConfigRow[]>([]);
  // formValues holds the current edits (strings to preserve user input).
  // originalValues is what the server returned on the last load --
  // used for dirty detection.
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiClient.get<GetResponse>('/api/admin/app-config');
      if (d.success && d.rows) {
        setRows(d.rows);
        const next: Record<string, string> = {};
        for (const r of d.rows) {
          next[r.key] = r.value;
        }
        setFormValues(next);
        setOriginalValues(next);
      } else {
        alert(d.error || 'Failed to load config');
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Network error');
    }
    setLoading(false);
  };

  const isDirty = ALL_FIELDS.some(
    (f) => (formValues[f.key] ?? '') !== (originalValues[f.key] ?? ''),
  );

  const onChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    if (!isDirty || saving) return;

    // Build the updates payload with ONLY the changed fields.
    // Sending unchanged values would touch updated_at and updated_by
    // unnecessarily, polluting the audit trail.
    const updates: Record<string, string> = {};
    for (const f of ALL_FIELDS) {
      const cur = formValues[f.key] ?? '';
      const orig = originalValues[f.key] ?? '';
      if (cur !== orig) updates[f.key] = cur;
    }

    setSaving(true);
    try {
      const d = await apiClient.post<PostResponse>(
        '/api/admin/app-config',
        { updates },
      );
      if (d.success) {
        alert(`Saved ${Object.keys(updates).length} value(s).`);
        await load(); // refresh rows + reset originalValues
      } else {
        alert(d.error || 'Save failed');
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Network error');
    }
    setSaving(false);
  };

  const renderField = (f: FieldSpec) => {
    const row = rows.find((r) => r.key === f.key);
    const value = formValues[f.key] ?? '';
    const dirty =
      (formValues[f.key] ?? '') !== (originalValues[f.key] ?? '');

    return (
      <div key={f.key} className="mb-5">
        <label className="block text-sm font-medium text-black mb-1">
          {f.label}
        </label>
        <input
          type="number"
          step={f.kind === 'price' ? '0.01' : '1'}
          min={f.min}
          max={f.max}
          value={value}
          onChange={(e) => onChange(f.key, e.target.value)}
          className={`w-full px-3 py-2 border rounded-lg text-black text-sm ${
            dirty ? 'border-orange-400 bg-orange-50' : 'border-gray-300'
          }`}
        />
        <p className="text-xs text-gray-500 mt-1">{f.hint}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Last updated by{' '}
          <span className="font-medium">{row?.updated_by || 'unknown'}</span>
          {' · '}
          {formatRelativeTime(row?.updated_at ?? null)}
        </p>
      </div>
    );
  };

  if (loading) {
    return <div className="text-black">Loading pricing config...</div>;
  }

  return (
    <div>
      {/* Header + Save button */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-black">App Pricing & Thresholds</h2>
          <p className="text-sm text-gray-500 mt-1">
            Updates here apply to mobile clients on the next /api/app-config
            fetch (TTL 1 hour, force-refreshed at checkout).
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={!isDirty || saving}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            !isDirty || saving
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {saving ? 'Saving...' : isDirty ? 'Save Changes' : 'No changes'}
        </button>
      </div>

      {/* Pricing section */}
      <div className="bg-white rounded-xl p-5 shadow-sm mb-6">
        <h3 className="text-base font-bold text-black mb-1">Pricing (USD)</h3>
        <p className="text-xs text-gray-500 mb-4">
          Charged when a user completes a physical-product checkout. Server
          always reads the latest value from this table on order create -- the
          client-displayed price is also pulled from here.
        </p>
        {PRICING_FIELDS.map(renderField)}
      </div>

      {/* Unlock Thresholds section */}
      <div className="bg-white rounded-xl p-5 shadow-sm">
        <h3 className="text-base font-bold text-black mb-1">Unlock Thresholds</h3>
        <p className="text-xs text-gray-500 mb-4">
          Determines when the Order button enables on Wisdom Book / Wisdom Cards.
          Lowering these unlocks the order CTA for more users.
        </p>
        {UNLOCK_FIELDS.map(renderField)}
      </div>
    </div>
  );
}
