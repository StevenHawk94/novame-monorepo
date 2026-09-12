/**
 * Default profile avatars (assets/profile/default-1..10.webp).
 *
 * Every user starts with one of ten bundled portraits — the initial pick is
 * a deterministic hash of their userId, so it is stable with zero round-trips.
 * Users can then choose a different bundled portrait. The selected id is
 * persisted in profiles.avatar_url while is_default_avatar remains true.
 *
 * The client is the ONLY source of default avatars: the legacy DB-side
 * default_avatars table + assign trigger were dropped in migration 037,
 * and new profiles simply carry avatar_url NULL / is_default_avatar true.
 */

export const DEFAULT_AVATARS = [
  require('../../assets/profile/default-1.webp'),
  require('../../assets/profile/default-2.webp'),
  require('../../assets/profile/default-3.webp'),
  require('../../assets/profile/default-4.webp'),
  require('../../assets/profile/default-5.webp'),
  require('../../assets/profile/default-6.webp'),
  require('../../assets/profile/default-7.webp'),
  require('../../assets/profile/default-8.webp'),
  require('../../assets/profile/default-9.webp'),
  require('../../assets/profile/default-10.webp'),
] as const;

export const DEFAULT_AVATAR_IDS = [
  'default-1',
  'default-2',
  'default-3',
  'default-4',
  'default-5',
  'default-6',
  'default-7',
  'default-8',
  'default-9',
  'default-10',
] as const;

export type DefaultAvatarId = (typeof DEFAULT_AVATAR_IDS)[number];

export const DEFAULT_AVATAR_OPTIONS = DEFAULT_AVATAR_IDS.map((id, index) => ({
  id,
  source: DEFAULT_AVATARS[index],
}));

export function isDefaultAvatarId(value: unknown): value is DefaultAvatarId {
  return typeof value === 'string'
    && (DEFAULT_AVATAR_IDS as readonly string[]).includes(value);
}

export function getDefaultAvatarId(userId: string | null | undefined): DefaultAvatarId {
  if (!userId) return DEFAULT_AVATAR_IDS[0];
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return DEFAULT_AVATAR_IDS[h % DEFAULT_AVATAR_IDS.length];
}

export function getDefaultAvatar(userId: string | null | undefined): number {
  return DEFAULT_AVATARS[DEFAULT_AVATAR_IDS.indexOf(getDefaultAvatarId(userId))];
}

export function getProfileDefaultAvatar(
  avatarId: string | null | undefined,
  userId: string | null | undefined,
): number {
  if (isDefaultAvatarId(avatarId)) {
    return DEFAULT_AVATARS[DEFAULT_AVATAR_IDS.indexOf(avatarId)];
  }
  return getDefaultAvatar(userId);
}

/**
 * expo-image source for a user's avatar: the uploaded URL when the user
 * has actually set one, else their assigned bundled default. Unknown
 * isDefaultAvatar (stale MMKV cache from before this field existed)
 * counts as default — the next me-stats fetch corrects it.
 */
export function resolveAvatarSource(
  avatarUrl: string | null | undefined,
  isDefaultAvatar: boolean | null | undefined,
  userId: string | null | undefined,
): { uri: string } | number {
  if (avatarUrl && isDefaultAvatar === false) return { uri: avatarUrl };
  return getProfileDefaultAvatar(avatarUrl, userId);
}
