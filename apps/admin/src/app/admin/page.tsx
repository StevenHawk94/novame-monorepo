'use client';

import { useState } from 'react';

type TabId =
  | 'overview'
  | 'posts'
  | 'cards'
  | 'default-users'
  | 'real-users'
  | 'orders'
  | 'seek'
  | 'tickets';

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'overview', icon: '📊', label: 'Overview' },
  { id: 'posts', icon: '💬', label: 'Posts' },
  { id: 'cards', icon: '🃏', label: 'Cards' },
  { id: 'default-users', icon: '👤', label: 'Default Users' },
  { id: 'real-users', icon: '👥', label: 'Real Users' },
  { id: 'orders', icon: '📦', label: 'Orders' },
  { id: 'seek', icon: '❓', label: 'Seek Questions' },
  { id: 'tickets', icon: '🎫', label: 'Support Tickets' },
];

/**
 * Admin dashboard — tab navigation + tab content router.
 *
 * Each tab renders its own component from ./_components/*Tab.tsx.
 * Tab state is in-memory (matches old Visdom behavior); refreshing
 * the page returns to Overview. To make tab state URL-persistent,
 * switch to nested routes (/admin/posts, /admin/cards, ...) — that's
 * a future refactor, not part of the migration.
 */
export default function AdminDashboard() {
  const [tab, setTab] = useState<TabId>('overview');

  return (
    <>
      <div className="bg-white -mx-4 px-4 mb-6 border-b">
        <div className="flex gap-1 overflow-x-auto pb-2 -mb-px">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t.id
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-black hover:bg-gray-100'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <PlaceholderTab tab={tab} />
    </>
  );
}

function PlaceholderTab({ tab }: { tab: TabId }) {
  const label = TABS.find((t) => t.id === tab)?.label ?? tab;
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
      <p className="text-2xl mb-2">🚧</p>
      <p className="text-sm font-medium text-black mb-1">{label} Tab</p>
      <p className="text-xs text-gray-500">
        Coming in step 1.3.4-C. Currently a placeholder.
      </p>
    </div>
  );
}
