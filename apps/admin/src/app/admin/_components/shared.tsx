'use client';

/**
 * Shared mini-components used by OverviewTab.
 * Kept tiny and dependency-free.
 */

const fmt = (n: number | string): string => {
  if (typeof n === 'string') return n;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : (n || 0).toString();
};

export function StatCard({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: number | string;
}) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <span className="text-2xl">{icon}</span>
      <p className="text-2xl font-bold mt-2 text-black">{fmt(value)}</p>
      <p className="text-sm text-black">{label}</p>
    </div>
  );
}

export function NavBtn({
  icon,
  label,
  onClick,
  badge,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-xl p-4 border hover:bg-gray-50 text-left relative"
    >
      <span className="text-2xl block mb-1">{icon}</span>
      <p className="font-medium text-sm text-black">{label}</p>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}
