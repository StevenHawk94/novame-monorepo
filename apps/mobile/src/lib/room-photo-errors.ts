// Legacy service compatibility only. Modern Plushies have no daily quota.
export const TOY_PHOTO_DAILY_LIMIT_TITLE = 'Photo update unavailable';
export const TOY_PHOTO_DAILY_LIMIT_MESSAGE =
  'Could not update this plushie’s photo. Please try again later.';
export const PHOTO_UPLOAD_LIMIT_MESSAGE = 'You’ve uploaded too many photos. Please try again later.';

export function roomPhotoFailureCode(failure: unknown): string | null {
  if (failure && typeof failure === 'object' && 'body' in failure) {
    const body = failure.body;
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  }
  if (failure && typeof failure === 'object' && 'message' in failure &&
      typeof failure.message === 'string' && /^[a-z_]+$/.test(failure.message)) return failure.message;
  return null;
}

export function roomPhotoFailureMessage(failure: unknown, fallback: string, kind: 'doll'|'frame' = 'doll'): string {
  switch (roomPhotoFailureCode(failure)) {
    case 'daily_limit_reached': return kind==='frame'?'You’ve reached today’s photo limit. Please try again tomorrow.':TOY_PHOTO_DAILY_LIMIT_MESSAGE;
    case 'upload_limit': return PHOTO_UPLOAD_LIMIT_MESSAGE;
    case 'photo_unavailable': return 'The photo could not be saved. Check your connection and try again.';
    default: return fallback;
  }
}
