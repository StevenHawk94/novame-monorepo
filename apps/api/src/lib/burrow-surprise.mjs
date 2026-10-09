import { decodeRoomPhoto, photoUUID } from './burrow-photo.mjs'
export const SURPRISE_BUCKET = 'burrow-surprises'
export const SURPRISE_FRAMES = ['santa','bunny','flower','heart','birthday','star']
/** Inspect container duration and audio-only tracks, not the client stopwatch. */
export function surpriseAudioDuration(bytes) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  const word = at => String.fromCharCode(...bytes.slice(at,at+4))
  let duration = 0, audio = false, invalidTrack = false
  function boxes(start,end,depth=0) {
    if(depth>5)throw Error('invalid_request')
    for(let at=start;at<end;) {
      if(at+8>end)throw Error('invalid_request')
      let size=view.getUint32(at), header=8
      if(size===1){if(at+16>end||view.getUint32(at+8)!==0)throw Error('invalid_request');size=view.getUint32(at+12);header=16}
      if(size===0)size=end-at
      if(size<header||at+size>end)throw Error('invalid_request')
      const type=word(at+4), p=at+header
      if(type==='mvhd') {
        const version=bytes[p], offset=version===1?20:12
        if(![0,1].includes(version)||p+offset+(version===1?12:8)>at+size)throw Error('invalid_request')
        const scale=view.getUint32(p+offset)
        const ticks=version===1?view.getUint32(p+offset+4)*4294967296+view.getUint32(p+offset+8):view.getUint32(p+offset+4)
        if(!scale)throw Error('invalid_request')
        duration=ticks/scale*1000
      }else if(type==='hdlr') {
        if(p+12>at+size)throw Error('invalid_request')
        const handler=word(p+8); if(handler==='soun')audio=true;else if(handler==='vide')invalidTrack=true
      }else if(['moov','trak','mdia'].includes(type))boxes(p,at+size,depth+1)
      at+=size
    }
  }
  boxes(0,bytes.length)
  if(!audio||invalidTrack||!Number.isFinite(duration)||duration<1000||duration>60500)throw Error('invalid_request')
  return Math.min(60000,Math.round(duration))
}
export async function readSurpriseBody(request) {
  const limit = 3_500_000
  if (Number(request.headers.get('content-length')) > limit) throw Error('invalid_request')
  const reader = request.body?.getReader()
  if (!reader) throw Error('invalid_request')
  let count = 0, text = ''; const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      count += value.length
      if (count > limit) { await reader.cancel(); throw Error('invalid_request') }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } catch { throw Error('invalid_request') } finally { reader.releaseLock() }
}
export function decodeSurprise(body) {
  if (!photoUUID(body.key) || !photoUUID(body.partnerId) || !/^[a-f0-9]{32}$/.test(body.pairVersion ?? '')
      || !SURPRISE_FRAMES.includes(body.frame) || !Number.isInteger(body.durationMs) || body.durationMs < 1000 || body.durationMs > 60000)
    throw Error('invalid_request')
  const photo = decodeRoomPhoto(body.photo)
  if (typeof body.audio !== 'string' || body.audio.length > 2_097_152 || body.audio.length % 4
      || /[^A-Za-z0-9+/]/.test(body.audio.replace(/={1,2}$/, ''))) throw Error('invalid_request')
  const audio = Uint8Array.from(atob(body.audio), c => c.charCodeAt(0))
  // Native recording is AAC in an ISO-BMFF .m4a, never arbitrary uploads.
  if (audio.length < 32 || audio.length > 1_572_864 || String.fromCharCode(...audio.slice(4,8)) !== 'ftyp') throw Error('invalid_request')
  const durationMs=surpriseAudioDuration(audio)
  if(Math.abs(durationMs-body.durationMs)>2000)throw Error('invalid_request')
  return { photo, audio, durationMs }
}
