import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getPublicUrl, r2PresignPut } from '@/lib/r2-client';

export const runtime = 'nodejs';

const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export async function POST(request) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    const { contentType } = await request.json();
    const extension = EXTENSIONS[contentType];
    if (!extension) {
      return NextResponse.json(
        { success: false, error: 'Only PNG, JPEG and WEBP images are supported' },
        { status: 400 },
      );
    }
    const key = `Announcements/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const uploadUrl = await r2PresignPut({ key, contentType });
    return NextResponse.json({
      success: true,
      uploadUrl,
      contentType,
      key,
      publicUrl: `${getPublicUrl()}/${key}`,
    });
  } catch (e) {
    console.error('[admin/announcements/presign]:', e && e.message);
    return NextResponse.json(
      { success: false, error: 'Failed to prepare announcement image upload' },
      { status: 500 },
    );
  }
}
