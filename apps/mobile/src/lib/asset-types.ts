/** Production R2 catalog schema. Runtime binary assets live only in the
 * Outfits, Maps and platform Character Videos folders; Focus Voice and
 * Announcements are discovered through their feature APIs. */
export type ManifestVersion = 'v1';

export type AssetManifest = {
  version: ManifestVersion;
  baseUrl: string;
  outfits?: unknown[];
  scenes?: unknown[];
  outfitsUpdatedAt?: string;
  scenesUpdatedAt?: string;
};
