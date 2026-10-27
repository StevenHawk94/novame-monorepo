import * as FileSystem from 'expo-file-system/legacy';

/**
 * On-disk artifacts that an MMKV key merely *points at*.
 *
 * `novame_record_draft` stores `{ audioUri, durationSec, ... }` where audioUri
 * is a path into documentDirectory. Removing only the MMKV entry orphans the
 * previous user's audio file on disk -- so `keys.ts` attaches an `onClear`
 * hook that deletes it.
 *
 * The path constant lives here, below `src/lib/record-draft.ts`, so the
 * dependency points downward (lib -> shared) and the value has a single home.
 * The alternative -- `shared/storage/keys.ts` importing `@/lib/record-draft` --
 * would invert the layering, and a dynamic `import()` to dodge that would rely
 * on Metro behaviour we have not verified.
 *
 * expo-file-system@~19.0.22 exposes both the new (`File`/`Directory`/`Paths`)
 * and the legacy API. We use `/legacy` here to mirror `record-draft.ts` and
 * `audio-recorder.ts` verbatim -- proven in production, and this whole module
 * is deleted in Phase 2 along with voice recording (decision D2).
 */

/** Null on web (no documentDirectory). Native only; guarded anyway. */
export const RECORD_DRAFT_AUDIO_PATH: string | null = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}novame_record_draft.m4a`
  : null;

/** Durable, already-cropped onboarding avatar waiting for a background upload. */
export const ONBOARDING_AVATAR_PATH: string | null = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}burrow_onboarding_avatar.jpg`
  : null;
export const PROFILE_AVATAR_DIRECTORY=FileSystem.documentDirectory?`${FileSystem.documentDirectory}burrow-profile-avatar/`:null;
let avatarCleanup=Promise.resolve();
export const waitForProfileAvatarCleanup=()=>avatarCleanup;
export function deleteProfileAvatars(){
  avatarCleanup=avatarCleanup.then(async()=>{if(PROFILE_AVATAR_DIRECTORY)await FileSystem.deleteAsync(PROFILE_AVATAR_DIRECTORY,{idempotent:true});}).catch(()=>{});
  return avatarCleanup;
}

/** Private room photos survive app restarts, but never an account switch. */
export const BURROW_ROOM_PHOTO_DIRECTORY: string | null = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}burrow-room-photos/`
  : null;
export const SURPRISE_DRAFT_DIRECTORY = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}burrow-surprise-drafts/` : null;
// Paid messages are replayable documents, not disposable OS cache entries.
export const SURPRISE_MEDIA_DIRECTORY = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}burrow-surprise-media/` : null;
export const SURPRISE_LEGACY_MEDIA_DIRECTORY = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}burrow-surprise-media/` : null;
let surpriseCleanup: Promise<void> = Promise.resolve();
export const waitForSurpriseCleanup = () => surpriseCleanup;
export function deleteSurpriseDraftFiles(includeMedia=false): Promise<void> {
  surpriseCleanup = surpriseCleanup.then(async () => {
    if (SURPRISE_DRAFT_DIRECTORY) await FileSystem.deleteAsync(SURPRISE_DRAFT_DIRECTORY, {idempotent:true});
    if (includeMedia&&SURPRISE_MEDIA_DIRECTORY) await FileSystem.deleteAsync(SURPRISE_MEDIA_DIRECTORY, {idempotent:true});
    if (includeMedia&&SURPRISE_LEGACY_MEDIA_DIRECTORY) await FileSystem.deleteAsync(SURPRISE_LEGACY_MEDIA_DIRECTORY, {idempotent:true});
  }).catch(() => {});
  return surpriseCleanup;
}
let roomPhotoCleanup: Promise<void> = Promise.resolve();
export function waitForRoomPhotoCleanup(): Promise<void> { return roomPhotoCleanup; }
export function deleteBurrowRoomPhotos(): Promise<void> {
  roomPhotoCleanup = roomPhotoCleanup.then(async () => {
    if (BURROW_ROOM_PHOTO_DIRECTORY) await FileSystem.deleteAsync(BURROW_ROOM_PHOTO_DIRECTORY, { idempotent: true });
  }).catch(error => { console.warn('[storage] failed to clear private room photos:', error); });
  return roomPhotoCleanup;
}

/** Idempotent. Errors swallowed: a failed cleanup must never block sign-out. */
export async function deleteRecordDraftAudio(): Promise<void> {
  if (!RECORD_DRAFT_AUDIO_PATH) return;
  try {
    await FileSystem.deleteAsync(RECORD_DRAFT_AUDIO_PATH, { idempotent: true });
  } catch (e) {
    console.warn('[storage] failed to delete record draft audio:', e);
  }
}

/** Idempotent cleanup for an abandoned or completed avatar upload. */
export async function deleteOnboardingAvatar(): Promise<void> {
  if (!ONBOARDING_AVATAR_PATH) return;
  try {
    await FileSystem.deleteAsync(ONBOARDING_AVATAR_PATH, { idempotent: true });
  } catch (e) {
    console.warn('[storage] failed to delete pending onboarding avatar:', e);
  }
}
