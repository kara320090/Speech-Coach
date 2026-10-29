import test from "node:test"
import assert from "node:assert/strict"
import { analyzeRecordedSpeech } from "../public/js/recording-analysis.js"
import { parseWavBytes } from "../public/js/wav.js"
const input = (seconds = 13) => ({ samples: new Float32Array(seconds * 16000).fill(0.1), sampleRate: 16000, durationSec: seconds })
const ready = () => new Response(JSON.stringify({ transcriptionConfigured: true, runtime: { transcriptionReady: true } }))
const reply = text => new Response(JSON.stringify({ text, segments: [{ startSecond: 0, endSecond: 10, text }] }))

test("13-second recordings use self-hosted WAV transcription and measure speed and fillers", async () => {
  const requests = [], progress = []
  const result = await analyzeRecordedSpeech({ ...input(), onProgress: (n, all) => progress.push([n, all]), fetchFn: async (url, init) => {
    requests.push(url)
    if (url === "/api/model-status") return ready()
    assert.equal(url, "/api/transcribe"); assert.equal(init.headers["Content-Type"], "audio/wav")
    const wav = parseWavBytes(await init.body.arrayBuffer()); assert.equal(wav.sampleRate, 16000); assert.equal(wav.samples.length, 13 * 16000)
    return reply("음 어 안녕하세요 발표를 시작합니다")
  } })
  assert.deepEqual(requests, ["/api/model-status", "/api/transcribe"])
  assert.equal(result.status, "ok"); assert.equal(result.transcript.fillers.count, 2)
  assert.equal(result.fillers.count, 2); assert.ok(result.transcript.overallRate > 0)
  assert.equal(result.segments[0].startSec, 0); assert.deepEqual(progress.at(-1), [1, 1])
})

test("opt-out and missing audio never make network requests", async () => {
  const fetchFn = () => { throw Error("unexpected network") }
  assert.equal((await analyzeRecordedSpeech({ ...input(), enabled: false, fetchFn })).status, "off")
  assert.equal((await analyzeRecordedSpeech({ ...input(), samples: null, fetchFn })).status, "no-audio")
  assert.equal((await analyzeRecordedSpeech({ ...input(), sampleRate: 44100, fetchFn })).status, "error")
})

test("offline PC and missing transcription configuration show a reason and do not send audio", async () => {
  for (const state of [{ transcriptionConfigured: false }, { transcriptionConfigured: true, runtime: { transcriptionReady: false } }]) {
    let count = 0
    const result = await analyzeRecordedSpeech({ ...input(), fetchFn: async url => { count++; assert.equal(url, "/api/model-status"); return new Response(JSON.stringify(state)) } })
    assert.equal(result.status, "not-configured"); assert.equal(result.fillers, null); assert.equal(count, 1)
    assert.match(result.detail, /보존/)
  }
})

test("empty recognized speech is unmeasured rather than zero fillers", async () => {
  const result = await analyzeRecordedSpeech({ ...input(), fetchFn: async url => url === "/api/model-status" ? ready() : new Response(JSON.stringify({ text: "", segments: [] })) })
  assert.equal(result.status, "no-text"); assert.equal(result.transcript.fillers.count, null)
})

test("partial transcription preserves recognized segments and hides whole-recording totals", async () => {
  let i = 0
  const result = await analyzeRecordedSpeech({ ...input(65), fetchFn: async url => {
    if (url === "/api/model-status") return ready()
    i++; if (i <= 2) return new Response('{}', { status: 502 })
    return reply("음 발표 내용을 설명합니다")
  } })
  assert.equal(result.status, "partial"); assert.ok(result.segments.length > 0)
  assert.equal(result.transcript.overallRate, undefined); assert.equal(result.transcript.fillers.count, null)
  assert.equal(result.fillers, null)
})

test("request errors preserve input and return a degraded result without throwing", async () => {
  const original = input(), snapshot = original.samples.slice()
  const result = await analyzeRecordedSpeech({ ...original, fetchFn: async () => { throw new TypeError("offline") } })
  assert.equal(result.status, "error"); assert.match(result.detail, /보존/); assert.deepEqual(original.samples, snapshot)
})

test("cancelling pending transcription returns a preserved-recording result", async () => {
  const controller = new AbortController()
  const work = analyzeRecordedSpeech({ ...input(), signal: controller.signal, fetchFn: async (_, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))) })
  controller.abort(); const result = await work
  assert.equal(result.status, "cancelled"); assert.match(result.detail, /보존/)
})

test("server errors and quota limits never become measured zero", async () => {
  for (const status of [429, 502]) {
    const result = await analyzeRecordedSpeech({ ...input(), fetchFn: async url => url === "/api/model-status" ? ready() : new Response(JSON.stringify({ error: "model-error", message: "음성 처리 불가" }), { status }) })
    assert.notEqual(result.status, "ok"); assert.equal(result.transcript.fillers.count, null)
  }
})
