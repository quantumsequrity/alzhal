import { NextRequest, NextResponse } from 'next/server'
import { getAudio } from '@/lib/audio-store'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id || !/^[a-f0-9]{32}$/.test(id)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const audio = await getAudio(id)
  if (!audio) {
    return new NextResponse('Not found', { status: 404 })
  }

  return new NextResponse(audio.buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': audio.mimeType,
      'Content-Length': audio.buffer.length.toString(),
      'Cache-Control': 'public, max-age=300',
    },
  })
}
