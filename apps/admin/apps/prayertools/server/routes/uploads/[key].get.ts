// Serves locally stored uploads in development (no object storage configured).
export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key') ?? ''
  const buf = await ptReadLocalUpload(key)
  if (!buf) throw createError({ statusCode: 404 })
  const ext = key.split('.').pop() ?? ''
  setHeader(event, 'content-type', Object.keys(PT_VIDEO_TYPES).find(t => PT_VIDEO_TYPES[t] === ext) ?? PT_AUDIO_FORMATS[ext]?.type ?? 'image/webp')
  setHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  setHeader(event, 'access-control-allow-origin', '*')
  return buf
})
