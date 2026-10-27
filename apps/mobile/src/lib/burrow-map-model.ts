export const BURROW_SOIL_COLOR = '#572b1a';
// Sampled from the supplied room border; tunnels are behind its artwork.
export const BURROW_TUNNEL_COLOR = '#dd7940';
export const BURROW_MAP_WIDTH = 800;
export const BURROW_BANNER_HEIGHT = 400;
// The 800×400 banners include ~22px of baked soil below the path. Clip only
// that footer at display time so it cannot hide the code-drawn tunnel join.
export const BURROW_BANNER_PATH_END = 377;
// Updated 1024×1024 door: retain its square canvas, including transparent edges.
// Its green panel is centred at (512, 512); do not reuse the old door's anchor.
export const BURROW_ROOM_ART = { left:11.5, top:0, width:290, height:290 };
// Keep the previously approved 80% icon size, centred on the new green panel.
export const BURROW_ROOM_ICON = { left:100.5, top:89, width:112, height:112 };
// Below the green panel (ending at source y≈856), with only a small overlap
// on the lower wooden frame. Keep the entire label within the room hit target.
export const BURROW_ROOM_LABEL = { left:47.5, top:254, width:218, height:52 };
export function burrowRoomIconShadow(scale:number){
  // Contact shadow from the visual reference: close to the transparent icon's
  // silhouette, slightly below/left, not a long diagonal cast across the door.
  return {shadowColor:'#000000',shadowOpacity:.5,shadowRadius:1.5*scale,
    shadowOffset:{width:-3*scale,height:10*scale},elevation:2*scale};
}

export const BURROW_MAP_ROOMS = [
  { id: 'my_room', title: 'My Room' },
  { id: 'partner_room', title: 'Partner’s Room' },
  { id: 'surprise_room', title: 'Surprise Room' },
  { id: 'game_room', title: 'Game Room' },
  { id: 'rage_room', title: 'Release Room' },
  { id: 'friends_room', title: "Friend's Room" },
  { id: 'memories_room', title: 'Memories Room' },
  { id: 'collection_room', title: 'Collection Room' },
] as const;
export type BurrowMapRoom = typeof BURROW_MAP_ROOMS[number]['id'];
export type BurrowMapSeason = 'spring' | 'summer' | 'autumn' | 'winter';

// StoreKit uses ISO alpha-3; Google Play and device locales use alpha-2.
// For countries spanning the equator this is a country-level approximation,
// not a claim to know the user's actual latitude. Unknown regions use north.
const SOUTHERN_COUNTRIES = new Set([
  'AU', 'AUS', 'NZ', 'NZL', 'AR', 'ARG', 'BO', 'BOL', 'BR', 'BRA', 'CL', 'CHL',
  'EC', 'ECU', 'PY', 'PRY', 'PE', 'PER', 'UY', 'URY', 'ZA', 'ZAF', 'NA', 'NAM',
  'BW', 'BWA', 'LS', 'LSO', 'SZ', 'SWZ', 'AO', 'AGO', 'ZM', 'ZMB', 'ZW', 'ZWE',
  'MW', 'MWI', 'MZ', 'MOZ', 'MG', 'MDG', 'MU', 'MUS', 'RE', 'REU', 'SC', 'SYC',
  'TZ', 'TZA', 'CD', 'COD', 'BI', 'BDI', 'RW', 'RWA', 'CG', 'COG', 'GA', 'GAB',
  'ID', 'IDN', 'TL', 'TLS', 'PG', 'PNG', 'FJ', 'FJI', 'SB', 'SLB', 'VU', 'VUT',
  'NC', 'NCL', 'PF', 'PYF', 'WS', 'WSM', 'TO', 'TON', 'TV', 'TUV', 'NR', 'NRU',
  'CK', 'COK', 'NU', 'NIU', 'TK', 'TKL', 'WF', 'WLF', 'FK', 'FLK', 'GS', 'SGS',
  'AQ', 'ATA',
]);

/** Read only an explicit region, never infer geography from language alone. */
export function burrowLocaleCountry(locale: string | undefined): string | undefined {
  return locale?.match(/[-_]([A-Z]{2})(?:$|[-_@])/i)?.[1]?.toUpperCase();
}

export function burrowMapEnvironment(now: number, timeZone?: string, country?: string) {
  const date = new Date(now);
  let month = date.getMonth() + 1;
  let hour = date.getHours();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      month: 'numeric', hour: 'numeric', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}),
    }).formatToParts(date);
    month = Number(parts.find(part => part.type === 'month')?.value ?? month);
    hour = Number(parts.find(part => part.type === 'hour')?.value ?? hour);
  } catch { /* A stale/unsupported profile timezone falls back to device time. */ }
  const southern = SOUTHERN_COUNTRIES.has(country?.toUpperCase() ?? '');
  const seasons: BurrowMapSeason[] = ['winter', 'spring', 'summer', 'autumn'];
  const season = seasons[(Math.floor(month % 12 / 3) + (southern ? 2 : 0)) % 4];
  const period: 'day' | 'night' = hour >= 6 && hour < 18 ? 'day' : 'night';
  return { season, period, southern, banner: `${season}-${period}` as const };
}

/** All artwork, hit targets and branches share one width-scaled coordinate system. */
export function burrowMapLayout(roomCount: number) {
  const count = Math.max(0, Math.floor(roomCount));
  const rows = Math.ceil(count / 2);
  const firstTop = BURROW_BANNER_HEIGHT + 74;
  const pitch = 370;
  const centers = Array.from({ length: rows }, (_, row) => firstTop + row * pitch + 145);
  return {
    height: rows ? firstTop + (rows - 1) * pitch + 310 + 100 : BURROW_BANNER_HEIGHT + 140,
    trunk: { left: 384, top: BURROW_BANNER_PATH_END - 1, width: 32,
      height: rows ? centers[rows - 1] - BURROW_BANNER_PATH_END + 17 : 0 },
    branches: centers.map((center, row) => ({ left: 295, top: center - 16,
      width: row * 2 + 1 < count ? 210 : 121, height: 32 })),
    // 30% smaller, keeping the lantern's previous visual center on the branch.
    lights: centers.map(center => ({ left: 368.5, top: center - 48, width: 63, height: 84 })),
    rooms: Array.from({ length: count }, (_, index) => ({
      left: index % 2 ? 463 : 24, top: firstTop + Math.floor(index / 2) * pitch,
      width: 313, height: 310,
    })),
  };
}
