import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // La clave de Groq vive en .env.local (fuera del repositorio) y NO lleva prefijo VITE_:
  // así nunca entra en el código que llega al navegador. El servidor la añade al reenviar.
  const env = loadEnv(mode, process.cwd(), '')
  const key = env.GROQ_API_KEY || process.env.GROQ_API_KEY
  const to = (path: string): ProxyOptions => ({
    target: 'https://api.groq.com', changeOrigin: true, rewrite: () => path, headers: { Authorization: `Bearer ${key}` },
  })
  const groq: Record<string, ProxyOptions> = key
    ? {
        '^/api/groq$': to('/openai/v1/chat/completions'), // el asistente
        '^/api/groq-stt$': to('/openai/v1/audio/transcriptions'), // voz a texto (Whisper)
      }
    : {}
  // El micrófono del navegador solo funciona en https o en localhost. Con DEV_HTTPS=1 el servidor
  // usa un certificado propio para poder abrir la app desde otro equipo de la red.
  const https = process.env.DEV_HTTPS === '1'
  return {
    base: './',
    plugins: https ? [react(), basicSsl()] : [react()],
    build: { chunkSizeWarningLimit: 1800 },
    define: {
      __ASSISTANT_LLM__: JSON.stringify(Boolean(key)),
      __ASSISTANT_MODEL__: JSON.stringify(env.GROQ_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-120b'),
    },
    server: { proxy: groq },
    preview: { proxy: groq },
  }
})
