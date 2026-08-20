import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { r2PresignPut } from '@/lib/r2-client';

export const runtime = 'nodejs';

/**
 * POST /api/admin/outfits/presign — step 1 of the outfit upload flow.
 *
 * Body: { name } → presigned PUT URLs for the outfit's 4 fixed asset keys.
 * The browser uploads directly to R2 with these (videos exceed Vercel's
 * request-body limit, so the files never pass through this server), then
 * calls POST /api/admin/outfits to verify + publish the catalog entry.
 *
 * Content types are pinned in the signature: image/webp for the two previews
 * and Android animation, video/quicktime for the iOS .mov — the browser must send the same
 * Content-Type header or R2 rejects the PUT.
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
    const [thumb, bunny, video, androidVideo] = await Promise.all([
      r2PresignPut({ key: `Outfits/${trimmed}.webp`, contentType: 'image/webp' }),
      r2PresignPut({ key: `Outfits/${trimmed}-Bunny.webp`, contentType: 'image/webp' }),
      r2PresignPut({ key: `Character Videos/${trimmed}.mov`, contentType: 'video/quicktime' }),
      r2PresignPut({ key: `Character Videos-Android/${trimmed}.webp`, contentType: 'image/webp' }),
    ]);
    return NextResponse.json({
      success: true,
      uploads: {
        thumb: { url: thumb, contentType: 'image/webp' },
        bunny: { url: bunny, contentType: 'image/webp' },
        video: { url: video, contentType: 'video/quicktime' },
        androidVideo: { url: androidVideo, contentType: 'image/webp' },
      },
    });
  } catch (e) {
    console.error('[admin/outfits/presign]:', e && e.message);
    return NextResponse.json({ success: false, error: 'Failed to presign' }, { status: 500 });
  }
}
