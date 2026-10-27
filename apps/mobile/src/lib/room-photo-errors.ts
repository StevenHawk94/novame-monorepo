export const TOY_PHOTO_DAILY_LIMIT_TITLE = 'Today’s photo limit reached';
export const TOY_PHOTO_DAILY_LIMIT_MESSAGE =
  'Join plus to enable more photos used on your plushie, or come back tomorrow;';

export function roomPhotoFailureCode(failure: unknown): string | null {
  if (failure && typeof failure === 'object' && 'body' in failure) {
    const body = failure.body;
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  }
  if (failure && typeof failure === 'object' && 'message' in failure &&
      typeof failure.message === 'string' && /^[a-z_]+$/.test(failure.message)) return failure.message;
  return null;
}

export function roomPhotoFailureMessage(failure: unknown, fallback: string): string {
  switch (roomPhotoFailureCode(failure)) {
    case 'daily_limit_reached': return TOY_PHOTO_DAILY_LIMIT_MESSAGE;
    case 'upload_limit': return 'Too many photo attempts. Please try again in an hour.';
    case 'photo_unavailable': return 'The photo could not be saved. Check your connection and try again.';
    default: return fallback;
  }
}
