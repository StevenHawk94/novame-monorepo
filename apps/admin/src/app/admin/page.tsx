'use client';

import { useState } from 'react';
import OverviewTab from './_components/OverviewTab';
import RealUsersTab from './_components/RealUsersTab';
import OutfitsTab from './_components/OutfitsTab';
import ScenesTab from './_components/ScenesTab';
import OrdersTab from './_components/OrdersTab';
import PricingTab from './_components/PricingTab';
import AnalysisTab from './_components/AnalysisTab';
import ItemsTab from './_components/ItemsTab';

type TabId =
  | 'overview'
  | 'analysis'
  | 'real-users'
  | 'orders'
  | 'pricing'
  | 'outfits'
  | 'scenes'
  | 'items'

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'overview', icon: '📊', label: 'Overview' },
  { id: 'analysis', icon: '📈', label: 'Analysis' },
  { id: 'real-users', icon: '👥', label: 'Real Users' },
  { id: 'orders', icon: '📦', label: 'Orders' },
  { id: 'pricing', icon: '💰', label: 'Pricing' },
  { id: 'outfits', icon: '👕', label: 'Outfits' },
  { id: 'scenes', icon: '🗺️', label: 'Scenes' },
  { id: 'items', icon: '🎒', label: 'Memory Items' },
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

      {tab === 'overview' && <OverviewTab />}
      {tab === 'analysis' && <AnalysisTab />}
      {tab === 'real-users' && <RealUsersTab />}
      {tab === 'orders' && <OrdersTab />}
      {tab === 'pricing' && <PricingTab />}
      {tab === 'outfits' && <OutfitsTab />}
      {tab === 'scenes' && <ScenesTab />}
      {tab === 'items' && <ItemsTab />}
    </>
  );
}
