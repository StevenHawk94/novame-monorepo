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

/** Idempotent. Errors swallowed: a failed cleanup must never block sign-out. */
export async function deleteRecordDraftAudio(): Promise<void> {
  if (!RECORD_DRAFT_AUDIO_PATH) return;
  try {
    await FileSystem.deleteAsync(RECORD_DRAFT_AUDIO_PATH, { idempotent: true });
  } catch (e) {
    console.warn('[storage] failed to delete record draft audio:', e);
  }
}
