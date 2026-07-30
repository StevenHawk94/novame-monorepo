import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { r2PresignPut } from '@/lib/r2-client';

export const runtime = 'nodejs';

/**
 * POST /api/admin/scenes/presign — step 1 of the scene upload flow.
 *
 * Body: { name } → presigned PUT URLs for the scene's 2 fixed asset keys
 * (Maps/<Stem>.webp home background + Maps/<Stem>-Small.webp grid thumb;
 * the stem is the name with spaces collapsed to dashes). The browser
 * uploads directly to R2, then POSTs /api/admin/scenes to publish.
 */
export async function POST(request) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const { name } = await request.json();
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || !/^[A-Za-z0-9][A-Za-z0-9 '&-]{0,40}$/.test(trimmed)) {
      return NextResponse.json({ success: false, error: 'Invalid name' }, { status: 400 });
    }
    const stem = trimmed.replace(/\s+/g, '-');
    const [image, thumb] = await Promise.all([
      r2PresignPut({ key: `Maps/${stem}.webp`, contentType: 'image/webp' }),
      r2PresignPut({ key: `Maps/${stem}-Small.webp`, contentType: 'image/webp' }),
    ]);
    return NextResponse.json({
      success: true,
      uploads: {
        image: { url: image, contentType: 'image/webp' },
        thumb: { url: thumb, contentType: 'image/webp' },
      },
    });
  } catch (e) {
    console.error('[admin/scenes/presign]:', e && e.message);
    return NextResponse.json({ success: false, error: 'Failed to presign' }, { status: 500 });
  }
}
