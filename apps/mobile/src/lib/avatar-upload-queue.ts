import { decode } from 'base64-arraybuffer';
import * as FileSystem from 'expo-file-system/legacy';

import { ONBOARDING_AVATAR_PATH, deleteOnboardingAvatar } from '../shared/storage/artifacts';
import { kOnboardingAvatarUpload } from '../shared/storage/keys';
import { completeProfileAvatarUpload, prepareProfileAvatarUpload } from './account-api';
import { storage } from './storage';
import { supabase } from './supabase';

interface AvatarUploadJob {
  localUri: string;
  userId?: string;
  remotePath?: string;
  uploadToken?: string;
  attempts?: number;
  nextRetryAtMs?: number;
}

const inFlight = new Map<string, Promise<boolean>>();
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000] as const;

function readJob(): AvatarUploadJob | null {
  const raw = storage.getString(kOnboardingAvatarUpload.name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AvatarUploadJob;
  } catch {
    return null;
  }
}

function writeJob(job: AvatarUploadJob): void {
  storage.set(kOnboardingAvatarUpload.name, JSON.stringify(job));
}

/** Copy the processed JPEG out of Expo's cache so an OS cleanup cannot lose it. */
export async function queueProfileAvatar(localUri: string): Promise<string> {
  if (!ONBOARDING_AVATAR_PATH) {
    writeJob({ localUri });
    return localUri;
  }
  await FileSystem.deleteAsync(ONBOARDING_AVATAR_PATH, { idempotent: true });
  await FileSystem.copyAsync({ from: localUri, to: ONBOARDING_AVATAR_PATH });
  writeJob({ localUri: ONBOARDING_AVATAR_PATH });
  return ONBOARDING_AVATAR_PATH;
}

function recordFailure(job: AvatarUploadJob): void {
  const latest = readJob();
  if (!latest || latest.localUri !== job.localUri || latest.userId !== job.userId) return;
  const attempts = (latest.attempts ?? 0) + 1;
  const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
  writeJob({ ...latest, attempts, nextRetryAtMs: Date.now() + delay });
}

/**
 * Resume a pending avatar upload. The file goes directly to Supabase Storage;
 * Vercel only creates the short-lived upload ticket and commits the final URL.
 */
export function syncProfileAvatar(
  userId: string,
  options?: { force?: boolean },
): Promise<boolean> {
  let job = readJob();
  if (!job) return Promise.resolve(true);
  if (job.userId && job.userId !== userId) return Promise.resolve(true);
  if (!job.userId) {
    job = { ...job, userId };
    writeJob(job);
  }
  if (!options?.force && (job.nextRetryAtMs ?? 0) > Date.now()) return Promise.resolve(false);

  const running = inFlight.get(userId);
  if (running) return running;

  const request = (async () => {
    try {
      let current = readJob();
      if (!current || current.userId !== userId) return true;

      if (!current.remotePath || !current.uploadToken) {
        const ticket = await prepareProfileAvatarUpload(userId);
        if (ticket.kind === 'error') throw new Error(ticket.message);
        current = {
          ...current,
          remotePath: ticket.path,
          uploadToken: ticket.token,
          nextRetryAtMs: undefined,
        };
        writeJob(current);
      }

      const remotePath = current.remotePath;
      const uploadToken = current.uploadToken;
      if (!remotePath || !uploadToken) throw new Error('Avatar upload ticket is incomplete');

      const base64 = await FileSystem.readAsStringAsync(current.localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .uploadToSignedUrl(remotePath, uploadToken, decode(base64), {
          cacheControl: '31536000',
          contentType: 'image/jpeg',
        });
      if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
        const latest = readJob();
        if (latest?.localUri === current.localUri && latest.userId === userId) {
          writeJob({
            ...latest,
            remotePath: undefined,
            uploadToken: undefined,
          });
        }
        throw uploadError;
      }

      const completed = await completeProfileAvatarUpload(userId, remotePath);
      if (completed.kind === 'error') throw new Error(completed.message);

      const latest = readJob();
      if (latest?.localUri === current.localUri && latest.userId === userId) {
        storage.remove(kOnboardingAvatarUpload.name);
        await deleteOnboardingAvatar();
      }
      return true;
    } catch (error) {
      recordFailure(job);
      console.warn(
        '[avatar-upload] background upload failed; queued for retry:',
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  })();
  inFlight.set(userId, request);
  void request.finally(() => {
    if (inFlight.get(userId) !== request) return;
    inFlight.delete(userId);
    const latest = readJob();
    if (
      latest
      && latest.localUri !== job.localUri
      && (!latest.userId || latest.userId === userId)
    ) {
      void syncProfileAvatar(userId, { force: true });
    }
  });
  return request;
}
