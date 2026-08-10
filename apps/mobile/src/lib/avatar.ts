/**
 * Default profile avatars (assets/profile/default-1..4.png).
 *
 * Every user is "randomly" assigned one of the four portraits — the pick
 * is a deterministic hash of their userId, so the assignment is stable
 * across sessions/screens with zero server round-trips and no flicker.
 * A real upload (profiles.is_default_avatar = false, surfaced by
 * /api/me-stats as isDefaultAvatar) always wins over the bundled default.
 *
 * The client is the ONLY source of default avatars: the legacy DB-side
 * default_avatars table + assign trigger were dropped in migration 037,
 * and new profiles simply carry avatar_url NULL / is_default_avatar true.
 */

export const DEFAULT_AVATARS = [
  require('../../assets/profile/default-1.png'),
  require('../../assets/profile/default-2.png'),
  require('../../assets/profile/default-3.png'),
  require('../../assets/profile/default-4.png'),
] as const;

export function getDefaultAvatar(userId: string | null | undefined): number {
  if (!userId) return DEFAULT_AVATARS[0];
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return DEFAULT_AVATARS[h % DEFAULT_AVATARS.length];
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
  return getDefaultAvatar(userId);
}
