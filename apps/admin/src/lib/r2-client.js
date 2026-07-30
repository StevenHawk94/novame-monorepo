/**
 * Cloudflare R2 client wrapper -- Stage B1.1.
 *
 * R2 is S3-compatible, so we use @aws-sdk/client-s3 (already in
 * dependencies). The S3Client below is configured for R2's auth
 * endpoint scheme: https://{ACCOUNT_ID}.r2.cloudflarestorage.com.
 *
 * Public reads happen through the custom domain (media.novameapp.com,
 * via Cloudflare's R2 public bucket / domain mapping), so this client
 * is only used for writes from the admin server.
 *
 * Runtime: Node.js. aws-sdk has Node-specific transitive deps that
 * do not work in Vercel Edge / Cloudflare Workers runtimes. This is
 * the first non-edge route in the admin app; mixed runtimes are fully
 * supported by Next.js 14+ on Vercel.
 *
 * Env vars required (configure in apps/admin/.env.local + Vercel env):
 *   R2_ACCOUNT_ID         -- Cloudflare account id
 *   R2_ACCESS_KEY_ID      -- R2 API token access key
 *   R2_SECRET_ACCESS_KEY  -- R2 API token secret
 *   R2_BUCKET_NAME        -- e.g. 'novame-videos'
 *   R2_PUBLIC_URL         -- e.g. 'https://media.novameapp.com'
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ============================================================
// S3Client singleton
// ============================================================

let cachedClient = null;

function getR2Client() {
  if (cachedClient) return cachedClient;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 env vars missing: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY required',
    );
  }

  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

function getBucketName() {
  const name = process.env.R2_BUCKET_NAME;
  if (!name) throw new Error('R2_BUCKET_NAME env var missing');
  return name;
}

export function getPublicUrl() {
  const url = process.env.R2_PUBLIC_URL;
  if (!url) throw new Error('R2_PUBLIC_URL env var missing');
  return url.replace(/\/$/, '');
}

// ============================================================
// Operations
// ============================================================

/**
 * Upload a binary file to R2 at the given key.
 * `body` should be Uint8Array (Edge-friendly even though we're on Node).
 * `contentType` defaults to 'application/octet-stream'.
 *
 * Returns the public URL of the uploaded asset.
 */
export async function r2PutObject({ key, body, contentType }) {
  const client = getR2Client();
  const cmd = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
  });
  await client.send(cmd);
  return `${getPublicUrl()}/${key}`;
}

/**
 * Fetch an object from R2 by key. Returns the body as Uint8Array.
 * Used for reading the current manifest.json before mutating it.
 *
 * If the key does not exist, throws (AWS SDK returns NoSuchKey).
 * Callers that handle a "missing manifest" case should catch.
 */
export async function r2GetObjectBytes(key) {
  const client = getR2Client();
  const cmd = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });
  const resp = await client.send(cmd);
  // resp.Body is a stream in Node runtime; convert to bytes.
  const chunks = [];
  for await (const chunk of resp.Body) {
    chunks.push(chunk);
  }
  // Concatenate chunks into a single Uint8Array.
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

/**
 * HEAD an object: returns { size, lastModified } or null if it doesn't exist.
 * Used to verify a browser-side presigned upload actually landed before the
 * manifest is updated to point at it.
 */
export async function r2HeadObject(key) {
  const client = getR2Client();
  try {
    const resp = await client.send(
      new HeadObjectCommand({ Bucket: getBucketName(), Key: key }),
    );
    return {
      size: resp.ContentLength ?? null,
      lastModified: resp.LastModified ? resp.LastModified.toISOString() : null,
    };
  } catch (e) {
    if (e && (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404)) return null;
    throw e;
  }
}

/**
 * Presigned PUT URL so the admin browser can upload straight to R2 —
 * bypassing Vercel's ~4.5MB request-body limit (outfit videos exceed it).
 * The URL pins the exact key + content type and expires in `expiresIn`
 * seconds (default 10 minutes).
 *
 * NOTE: the R2 bucket must allow cross-origin PUT from the admin origin
 * (bucket Settings → CORS policy), or the browser upload will be blocked.
 */
export async function r2PresignPut({ key, contentType, expiresIn = 600 }) {
  const client = getR2Client();
  const cmd = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(client, cmd, { expiresIn });
}

/**
 * Fetch the asset manifest from R2 and parse as JSON.
 *
 * The manifest is at the well-known key 'video-manifest.json' (legacy
 * name, used for all manifest data: videos, cards, and -- after B3 --
 * productAssets). It is publicly readable via media.novameapp.com but
 * we go through the authenticated S3 path to ensure we read the
 * authoritative version (Cloudflare CDN cache can be ~minutes stale).
 *
 * Returns the parsed manifest object. Schema:
 *   { version, baseUrl, videos: [...], cards: [...], productAssets?: [...] }
 *
 * If productAssets is missing (pre-B3 state), callers should default to [].
 */
export async function r2GetManifest() {
  const bytes = await r2GetObjectBytes('video-manifest.json');
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

/**
 * Serialize and upload a manifest object to R2.
 *
 * Caller is responsible for any merging logic before calling this --
 * this function unconditionally overwrites video-manifest.json.
 */
export async function r2PutManifest(manifest) {
  const body = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  await r2PutObject({
    key: 'video-manifest.json',
    body,
    contentType: 'application/json',
  });
}
