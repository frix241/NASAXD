import { groqProxy } from '../server/groq-proxy.mjs'

export default { fetch: groqProxy('/audio/transcriptions', 'multipart/form-data') }
