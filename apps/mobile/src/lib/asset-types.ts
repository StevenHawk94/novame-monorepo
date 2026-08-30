/** Cosmetic production catalog. Dynamic Items deliberately use their own
 * immutable manifest selected by content-version.itemsVersion. */
export type ManifestVersion = 'v1';

export type AssetManifest = {
  version: ManifestVersion;
  baseUrl: string;
  outfits?: unknown[];
  scenes?: unknown[];
  outfitsUpdatedAt?: string;
  scenesUpdatedAt?: string;
};
