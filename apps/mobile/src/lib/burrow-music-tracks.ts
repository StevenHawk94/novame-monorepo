import type { MajorUpdateCatalogItem } from './app-major-update-api';

// Preserve catalog IDs, ownership and saved selections when replacing
// the old placeholder audio. All three recordings are bundled, never streamed.
export const BURROW_MUSIC_TRACKS = [
  { id: 'placeholder_music_calm', key: 'lofi', title: 'Lofi', plusOnly: false, source: require('../../assets/music/Lo-fi.MP3') },
  { id: 'placeholder_music_dream', key: 'lullaby', title: 'Lullaby', plusOnly: true, source: require('../../assets/music/Lullaby.MP3') },
  { id: 'placeholder_music_02', key: 'jazz', title: 'Jazz', plusOnly: true, source: require('../../assets/music/Jazz.MP3') },
] as const;
export const burrowMusicTrack = (item: MajorUpdateCatalogItem | undefined) =>
  item?.item_type === 'music' ? BURROW_MUSIC_TRACKS.find(track => track.id === item.stable_id) : undefined;

/** Cached pre-upgrade catalogs still show the correct names and local files. */
export function burrowMusicCatalog(catalog: MajorUpdateCatalogItem[]) {
  return BURROW_MUSIC_TRACKS.flatMap(track => {
    const item = catalog.find(row => row.stable_id === track.id && row.item_type === 'music');
    return item ? [{ ...item, title: track.title, price: 0, plus_only: track.plusOnly,
      asset: { ...item.asset, bundleKey: track.key } }] : [];
  });
}
