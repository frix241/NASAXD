// Only these fixed endpoints receive the server-side credential.
export function groqProxy(path, mediaType) {
  return async (request) => {
    const error = (status, message, headers = {}) => Response.json(
      { error: message }, { status, headers: { 'Cache-Control': 'no-store', ...headers } },
    )
    if (request.method !== 'POST') return error(405, 'Use POST', { Allow: 'POST' })
    const key = process.env.GROQ_API_KEY
    if (!key) return error(503, 'Assistant is not configured')
    const contentType = request.headers.get('content-type') || ''
    if (contentType.split(';')[0].trim().toLowerCase() !== mediaType) {
      return error(415, 'Unsupported content type')
    }
    try {
      // Preserve multipart boundaries and file bytes for Whisper.
      const body = await request.arrayBuffer()
      if (body.byteLength > 4_000_000) return error(413, 'Request too large')
      const upstream = await fetch(`https://api.groq.com/openai/v1${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType },
        body,
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      })
      if (!upstream.ok) return error(upstream.status, 'Assistant provider request failed')
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('content-type') || 'application/json',
          'Cache-Control': 'no-store',
        },
      })
    } catch (cause) {
      return error(cause?.name === 'TimeoutError' ? 504 : 502, 'Assistant provider unavailable')
    }
  }
}
