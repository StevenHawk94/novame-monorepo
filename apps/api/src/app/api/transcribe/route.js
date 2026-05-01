import { NextResponse } from 'next/server'

export const runtime = 'edge'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

// Transcription uses multimodal (audio input) — DeepSeek can't do this,
// so we use Gemini-only fallback chain.
const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
]

const SAFETY_NONE = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
]

export async function POST(request) {
  console.log('Transcribe API called')

  try {
    const contentType = request.headers.get('content-type') || ''
    let base64Audio = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const audioFile = formData.get('audio')
      if (!audioFile) {
        console.log('No audio file in FormData')
        return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
      }
      const arrayBuffer = await audioFile.arrayBuffer()
      const uint8Array = new Uint8Array(arrayBuffer)
      console.log('Audio file size:', uint8Array.length, 'bytes')
      let binaryString = ''
      const chunkSize = 8192
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.slice(i, i + chunkSize)
        binaryString += String.fromCharCode.apply(null, chunk)
      }
      base64Audio = btoa(binaryString)
    } else {
      const body = await request.json()
      base64Audio = body.audioBase64
      if (body.audioData && body.audioData.includes('base64,')) {
        base64Audio = body.audioData.split('base64,')[1]
      }
      console.log('Received base64 audio, length:', base64Audio?.length || 0)
    }

    if (!base64Audio) {
      console.log('No audio data provided')
      return NextResponse.json({ error: 'No audio data provided' }, { status: 400 })
    }

    if (!GEMINI_API_KEY) {
      console.log('GEMINI_API_KEY not configured')
      return NextResponse.json({ success: true, text: '' })
    }

    console.log('Calling Gemini API for transcription...')

    let transcriptionResult = null
    let lastError = null

    for (const model of MODELS) {
      try {
        console.log(`Trying model: ${model}`)
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { inline_data: { mime_type: 'audio/webm', data: base64Audio } },
                  { text: 'Transcribe this audio recording exactly as spoken. Return ONLY the transcription text, nothing else. No quotes, no explanations, just the spoken words.' }
                ]
              }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
              safetySettings: SAFETY_NONE,
            })
          }
        )

        if (response.ok) {
          const data = await response.json()
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
          if (text) {
            transcriptionResult = text.trim()
            console.log('Transcription successful with model:', model)
            break
          }
        } else {
          const errorText = await response.text()
          console.log(`Model ${model} failed:`, response.status, errorText.substring(0, 200))
          lastError = `${model}: ${response.status}`
        }
      } catch (err) {
        console.log(`Model ${model} error:`, err.message)
        lastError = err.message
      }
    }

    if (transcriptionResult) {
      return NextResponse.json({ success: true, text: transcriptionResult })
    }

    console.log('All models failed, last error:', lastError)
    return NextResponse.json({ success: true, text: '', error: lastError || 'All transcription models failed' })
  } catch (error) {
    console.error('Transcription error:', error)
    return NextResponse.json({ success: true, text: '', error: error.message })
  }
}
