export const PHOTO_BUCKET = 'burrow-room-photos'
export const PHOTO_MAX_BYTES = 1024 * 1024
export const PHOTO_LINK_SECONDS = 120
export const photoUUID = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)

/** Bound the stream as it arrives, including requests without Content-Length. */
export async function readPhotoRequest(request) {
  const limit = 1_410_000
  if (Number(request.headers.get('content-length')) > limit) throw new Error('invalid_request')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid_request')
  const decoder = new TextDecoder(); let size = 0; let text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) { await reader.cancel(); throw new Error('invalid_request') }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } catch { throw new Error('invalid_request') }
  finally { reader.releaseLock() }
}

/** Accept a small, square JPEG only. No caller-supplied MIME, URL or storage path. */
export function decodeRoomPhoto(base64) {
  if (typeof base64 !== 'string' || base64.length > Math.ceil(PHOTO_MAX_BYTES / 3) * 4 || base64.length % 4 !== 0
      || /[^A-Za-z0-9+/]/.test(base64.replace(/={1,2}$/, ''))) throw new Error('invalid_request')
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  if (bytes.length < 20 || bytes.length > PHOTO_MAX_BYTES || bytes[0] !== 255 || bytes[1] !== 216
      || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('invalid_request')
  let at = 2; let dimensions = false; let scan = false
  while (at + 3 < bytes.length) {
    if (bytes[at++] !== 255) throw new Error('invalid_request')
    while (bytes[at] === 255) at++
    const marker = bytes[at++]
    const length = bytes[at] * 256 + bytes[at + 1]
    if (length < 2 || at + length > bytes.length) throw new Error('invalid_request')
    if ([192,193,194].includes(marker)) {
      if (length < 8) throw new Error('invalid_request')
      const height = bytes[at + 3] * 256 + bytes[at + 4]
      const width = bytes[at + 5] * 256 + bytes[at + 6]
      if (width !== height || width < 64 || width > 1024) throw new Error('invalid_request')
      dimensions = true
    }
    if (marker === 218) { scan = true; break }
    at += length
  }
  if (!dimensions || !scan) throw new Error('invalid_request')
  return bytes
}
