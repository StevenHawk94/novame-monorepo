// Match the customer-facing Shop vocabulary, not internal storage names.
export const SALES_CATEGORIES = {
  outfits: 'Outfits', wallpapers: 'Wallpapers', couple_dolls: 'Plushies',
  cushions: 'Cushions', tables: 'Tables', rugs: 'Rugs', vases: 'Flowers',
  lamps: 'Floor Lamps', windows: 'Windows', cabinets: 'Cabinets',
  music_players: 'Music Players', frames: 'Photo Frames', dresser_plants: 'Kettles',
  light_strings: 'String Lights', ladders: 'Ladders', shelves: 'Floating Shelves',
};
export function salesQuery(params, now = new Date()) {
  if ([...params.keys()].some(key => !['days', 'kind'].includes(key))
    || params.getAll('days').length > 1 || params.getAll('kind').length > 1) return null;
  const days = params.get('days') ?? 'all', kind = params.get('kind') ?? 'all';
  if (!['all', '7', '30', '90'].includes(days) || !['all', 'self', 'gift'].includes(kind)) return null;
  return { p_since: days === 'all' ? null : new Date(now.getTime() - Number(days) * 86400000).toISOString(),
    p_until: now.toISOString(), p_kind: kind };
}
export function summarizeSales(rows) {
  const categories = Object.entries(SALES_CATEGORIES).map(([id, label]) => {
    const items = rows.filter(row => row.category === id);
    return { id, label, purchases: items.reduce((sum, row) => sum + row.purchases, 0),
      coinsSpent: items.reduce((sum, row) => sum + row.coins_spent, 0),
      soldStyles: items.filter(row => row.purchases > 0).length, styles: items.length };
  }).sort((a, b) => b.purchases - a.purchases || a.label.localeCompare(b.label));
  return { categories, purchases: rows.reduce((sum, row) => sum + row.purchases, 0),
    coinsSpent: rows.reduce((sum, row) => sum + row.coins_spent, 0) };
}
