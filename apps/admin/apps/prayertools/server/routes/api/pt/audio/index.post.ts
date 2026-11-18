// Uploads an audio file (multipart `file`) for prayer content and returns its
// public URL. The file is stored as uploaded; the browser's own player plays it.
import { rateLimit } from '@prayertools/shared/rate-limit'

const MAX_BYTES = 50 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const user = await ptUser(event)
  if (!rateLimit(`audio-upload:${user.userId}`, 30, 3600_000).ok) throw createError({ statusCode: 429, statusMessage: 'Too many uploads. Try again later.' })
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.data?.length)
  if (!file) ptBadRequest('Choose an audio file.')
  if (file.data.length > MAX_BYTES) ptBadRequest('Audio files can be up to 50 MB.')
  const stored = await ptStoreAudio(file.data, file.type ?? '', file.filename ?? '')
  return { url: stored.url }
})
