import { groqProxy } from '../server/groq-proxy.mjs'

export default { fetch: groqProxy('/chat/completions', 'application/json') }
