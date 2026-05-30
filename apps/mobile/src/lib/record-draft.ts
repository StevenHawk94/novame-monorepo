import * as FileSystem from 'expo-file-system/legacy';

import { storage } from './storage';
import type { RecordingResult } from './audio-recorder';

/**
 * Unfinished-recording draft persistence.
 *
 * Problem: audio recorded via expo-audio lands in the app CACHE directory,
 * which the OS may purge, and which we also lose if the app is killed mid-
 * publish. To let a user resume a recording whose Transform failed (network /
 * API / app-kill), we persist exactly ONE draft: the audio file copied into
 * the persistent documentDirectory, plus a small MMKV metadata record.
 *
 * Security note: this is purely client-side. The server still deletes uploaded
 * audio at every publish-wisdom return point (audit "ephemeral audio" policy);
 * nothing here re-introduces server-side audio at rest.
 *
 * Lifecycle: written when a recording completes (handleSave). Cleared on
 * successful publish, on user "Discard", or when the file is found missing on
 * restore. Only one draft is kept -- a new recording overwrites the old.
 */

const META_KEY = 'novame_record_draft';
// Persistent (not cache) path. documentDirectory is null on web; this module
// is only used on native, but guard anyway so a null never builds a bad path.
const DRAFT_AUDIO_PATH = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}novame_record_draft.m4a`
  : null;

export type RecordDraftMeta = {
  audioUri: string;
  durationSec: number;
  forceKeyword: string | null;
  seekQuestionId: string | null;
  createdAtMs: number;
};

/**
 * Persist a freshly-recorded audio file as the draft. Copies the cache file to
 * documentDirectory so it survives app restarts, then writes metadata.
 *
 * Fail-safe: any error (copy fails, no documentDirectory) leaves NO draft and
 * is swallowed -- a failed draft save must never block the normal publish flow.
 */
export async function saveRecordDraft(args: {
  sourceUri: string;
  durationSec: number;
  forceKeyword?: string | null;
  seekQuestionId?: string | null;
}): Promise<void> {
  if (!DRAFT_AUDIO_PATH) return;
  try {
    // Overwrite any prior draft file first (copyAsync won't overwrite cleanly
    // on all platforms). deleteAsync is idempotent.
    await FileSystem.deleteAsync(DRAFT_AUDIO_PATH, { idempotent: true });
    await FileSystem.copyAsync({ from: args.sourceUri, to: DRAFT_AUDIO_PATH });

    const meta: RecordDraftMeta = {
      audioUri: DRAFT_AUDIO_PATH,
      durationSec: args.durationSec,
      forceKeyword: args.forceKeyword ?? null,
      seekQuestionId: args.seekQuestionId ?? null,
      createdAtMs: Date.now(),
    };
    storage.set(META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn('[record-draft] save failed:', e);
    // Best-effort cleanup so we never leave metadata pointing at a missing file.
    try {
      storage.remove(META_KEY);
    } catch {
      // ignore
    }
  }
}

/**
 * Load the draft IF it exists AND its audio file is still present on disk.
 * If metadata exists but the file is gone (OS purge), clears the stale
 * metadata and returns null.
 */
export async function loadValidRecordDraft(): Promise<RecordDraftMeta | null> {
  let raw: string | undefined;
  try {
    raw = storage.getString(META_KEY) ?? undefined;
  } catch {
    return null;
  }
  if (!raw) return null;

  let meta: RecordDraftMeta;
  try {
    meta = JSON.parse(raw) as RecordDraftMeta;
  } catch {
    await clearRecordDraft();
    return null;
  }
  if (!meta.audioUri) {
    await clearRecordDraft();
    return null;
  }

  try {
    const info = await FileSystem.getInfoAsync(meta.audioUri);
    if (!info.exists || (typeof info.size === 'number' && info.size === 0)) {
      await clearRecordDraft();
      return null;
    }
  } catch {
    await clearRecordDraft();
    return null;
  }

  return meta;
}

/**
 * Delete the draft audio file and metadata. Idempotent; errors swallowed.
 */
export async function clearRecordDraft(): Promise<void> {
  try {
    storage.remove(META_KEY);
  } catch {
    // ignore
  }
  if (!DRAFT_AUDIO_PATH) return;
  try {
    await FileSystem.deleteAsync(DRAFT_AUDIO_PATH, { idempotent: true });
  } catch {
    // ignore
  }
}

/**
 * Build a RecordingResult from draft metadata, for re-hydrating the publish
 * flow. sizeBytes is set to 1 (non-zero) because the file's existence and
 * non-zero size were already verified by loadValidRecordDraft.
 */
export function draftToRecordingResult(meta: RecordDraftMeta): RecordingResult {
  return {
    uri: meta.audioUri,
    sizeBytes: 1,
    recorderDurationSec: meta.durationSec,
  };
}
