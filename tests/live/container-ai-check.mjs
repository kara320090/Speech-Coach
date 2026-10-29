// Actual CPU inference in the submitted container; no mocks or provider credentials.
import fs from "node:fs/promises"
import assert from "node:assert/strict"
const origin = process.env.E2E_BASE_URL || "http://localhost:3000"
// Web readiness and model readiness are separate: the UI is available while workers warm up.
const deadline = Date.now() + 90_000
let state
do {
  try { state = await (await fetch(origin + "/api/model-status", { signal: AbortSignal.timeout(4000) })).json() } catch { /* starting */ }
  if (state?.ready && state.runtime?.transcriptionReady) break
  await new Promise(resolve => setTimeout(resolve, 500))
} while (Date.now() < deadline)
assert.ok(state, "Model status must be available")
assert.equal(state.provider, "local"); assert.equal(state.ready, true)
assert.equal(state.runtime.mode, "managed"); assert.equal(state.runtime.transcriptionReady, true)
const source = "캐시는 이전 결과를 잠시 저장했다가 같은 요청에 다시 사용하는 공간입니다."
const q = await fetch(origin + "/api/coach", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ task: "question", requestId: "container-smoke", versionId: "container-smoke", script: source, sources: source }), signal: AbortSignal.timeout(100000) })
assert.equal(q.status, 200)
const result = await q.json(); assert.ok(result.result.question.length > 0); assert.ok(source.includes(result.result.referenceQuote))
const audio = await fs.readFile(new URL("../../e2e/fixtures/korean-synthetic.wav", import.meta.url))
const voice = await fetch(origin + "/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav", Origin: origin }, body: audio, signal: AbortSignal.timeout(100000) })
assert.equal(voice.status, 200)
const text = await voice.json(); assert.equal(text.processing, "self-hosted"); assert.ok(text.text.includes("발표")); assert.ok(text.segments.length > 0)
console.log(JSON.stringify({ mode: state.runtime.mode, model: result.model, question: "verified", transcription: "verified", audioSeconds: text.durationInSeconds, externalProviderCalls: 0 }))
