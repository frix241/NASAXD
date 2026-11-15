import { test } from 'node:test'
import assert from 'node:assert/strict'
import chat from '../api/groq.mjs'
import speech from '../api/groq-stt.mjs'

function setKey(t, value) {
  const previous = process.env.GROQ_API_KEY
  t.after(() => {
    if (previous === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = previous
  })
  process.env.GROQ_API_KEY = value
}

test('Vercel endpoints forward chat and multipart audio without exposing the key', async (t) => {
  setKey(t, 'server-only-test-key')
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return Response.json({ text: 'Hello', choices: [{ message: { content: 'Hello' } }] })
  })
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] })
  const response = await chat.fetch(new Request('https://app.test/api/groq', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  }))
  assert.equal(response.status, 200)
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-only-test-key')
  assert.equal(new TextDecoder().decode(calls[0].options.body), body)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.ok(!(await response.text()).includes('server-only-test-key'))

  const form = new FormData()
  form.append('file', new Blob(['audio bytes'], { type: 'audio/webm' }), 'voice.webm')
  form.append('model', 'whisper-large-v3-turbo')
  const request = new Request('https://app.test/api/groq-stt', { method: 'POST', body: form })
  const originalBytes = await request.clone().arrayBuffer()
  assert.equal((await speech.fetch(request)).status, 200)
  assert.equal(calls[1].url, 'https://api.groq.com/openai/v1/audio/transcriptions')
  assert.equal(calls[1].options.headers['Content-Type'], request.headers.get('content-type'))
  assert.deepEqual(calls[1].options.body, originalBytes)
})

test('rejects invalid requests and handles missing credentials and provider failures', async (t) => {
  setKey(t, '')
  const request = () => new Request('https://app.test/api/groq', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
  assert.equal((await chat.fetch(request())).status, 503)
  const get = await chat.fetch(new Request('https://app.test/api/groq'))
  assert.equal(get.status, 405)
  assert.equal(get.headers.get('allow'), 'POST')
  setKey(t, 'test-key')
  assert.equal((await speech.fetch(request())).status, 415)
  t.mock.method(globalThis, 'fetch', async () => new Response('private provider error', { status: 429 }))
  const limited = await chat.fetch(request())
  assert.equal(limited.status, 429)
  assert.ok(!(await limited.text()).includes('private provider error'))
  globalThis.fetch.mock.mockImplementation(async () => { throw new DOMException('timeout', 'TimeoutError') })
  assert.equal((await chat.fetch(request())).status, 504)
  globalThis.fetch.mock.mockImplementation(async () => { throw new Error('network') })
  assert.equal((await chat.fetch(request())).status, 502)
})
