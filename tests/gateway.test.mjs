// 주최 측 Vercel AI Gateway 공급자 검사. 모두 가짜 응답(fetchImpl)이며 실제 Gateway를 부르지 않는다(예산 보호).
// 실제 모델 품질·실제 Gateway 규격 수용 여부를 검증한 것이 아니다.
import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "../server.js"
import { createCoach, createTranscriber } from "../server/coach-provider.js"
import { classifyGatewayError, createGatewayClient, parseGatewayResponse, gatewaySchema } from "../server/gateway-client.js"
import { encodeWavBytes } from "../public/js/wav.js"

// 기본 검사 중 실제 Gateway·Google로 나가는 요청을 막는다(키가 있어도).
const realFetch = globalThis.fetch
globalThis.fetch = (url, ...rest) => {
  if (/ai-gateway\.vercel\.sh|googleapis\.com/.test(String(url))) throw new Error("기본 검사에서 실제 외부 AI를 부르면 안 돼요")
  return realFetch(url, ...rest)
}

const KEY = "gw-test-key-가상-0000"
const SCRIPT = "결과를 5분 동안 저장한다. 효과는 검증하지 않았다."
const sample = (extra = {}) => ({ task: "question", requestId: "r-1", versionId: "v-1", script: SCRIPT, sources: SCRIPT, question: "", answer: "", ...extra })
const OUT = {
  question: { question: "결과는 얼마 동안 저장하나요?", referenceQuote: "결과를 5분 동안 저장한다." },
  review: { state: "supported", supported: "저장 시간을 말했어요.", answerQuote: "5분 동안 저장해요.", sourceQuote: "결과를 5분 동안 저장한다.", nextStep: "이어 말해 보세요." },
  concepts: { concepts: [{ term: "결과", quote: "결과를 5분 동안 저장한다.", explanation: "알아낸 내용이에요.", sourceQuote: "결과를 5분 동안 저장한다." }] },
  rewrite: { rewritten: "결과를 5분 동안 잠시 저장해요. 효과는 아직 검증하지 않았어요.", reason: "말하기 쉽게", sourceQuote: "결과를 5분 동안 저장한다." },
}
const chat = (value, extra = {}) => new Response(JSON.stringify({ id: "c1", object: "chat.completion", model: "google/gemini-3.8-flash", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(value) }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, completion_tokens_details: { reasoning_tokens: 8 } }, ...extra }), { status: 200, headers: { "content-type": "application/json" } })
const err = (status, error, headers = {}) => new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", ...headers } })
const env = (extra = {}) => ({ AI_PROVIDER: "gateway", AI_GATEWAY_API_KEY: KEY, ...extra })
const signal = () => new AbortController().signal
const wavOf = (sec, v = 0.1) => Buffer.from(encodeWavBytes(new Float32Array(Math.round(sec * 16000)).fill(v), 16000))

function fakeFetch(responder) {
  const calls = []
  const fn = async (url, init) => { calls.push({ url: String(url), init }); return responder(calls.length, String(url), init) }
  fn.calls = calls
  return fn
}
/** 과업(스키마)에 맞춰 답하는 가짜 Gateway */
const smart = () => fakeFetch((n, url, init) => {
  const body = JSON.parse(init.body)
  const props = Object.keys(body.response_format.json_schema.schema.properties || {})
  if (props.includes("concepts")) return chat(OUT.concepts)
  if (props.includes("rewritten") && props.includes("reason") && !props.includes("title")) return chat(OUT.rewrite)
  if (props.includes("state")) return chat(OUT.review)
  if (props.includes("title")) return chat({ title: "가상 도서관 안내", script: "가상 도서관은 토요일에 문을 엽니다.", notes: "운영 시간을 확인해 주세요." })
  if (props.includes("reflection")) return chat({ reflection: "함께 살펴볼게요.", question: "어느 부분을 정리하면 좋을까요?", help: "", offerRewrite: false, sourceQuote: "" })
  return chat(OUT.question)
})
async function withServer(options, fn) {
  const server = createServer(options)
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}`
  try { return await fn(base) } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)) }
}
const postJson = (base, path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

const logged = []
for (const k of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[k]
  console[k] = (...a) => { logged.push(a.map(String).join(" ")); orig.apply(console, a) }
}

test("텍스트 요청 변환: Chat Completions 주소·Bearer 머리·json_schema 구조화 출력·reasoning low, 모델 대체(models) 없음", async () => {
  const f = fakeFetch(() => chat(OUT.question))
  await createCoach({ env: env(), fetchImpl: f }).run(sample(), signal())
  assert.equal(f.calls.length, 1)
  const { url, init } = f.calls[0]
  assert.equal(url, "https://ai-gateway.vercel.sh/v1/chat/completions")
  assert.ok(!url.includes(KEY))
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`)
  assert.equal(init.redirect, "error")
  const body = JSON.parse(init.body)
  assert.equal(body.model, "google/gemini-3.8-flash")
  assert.equal(body.stream, false)
  assert.deepEqual(body.messages.map((m) => m.role), ["system", "user"])
  assert.equal(body.response_format.type, "json_schema")
  assert.equal(body.response_format.json_schema.name, "result")
  assert.ok(body.response_format.json_schema.schema.properties.referenceQuote.enum.includes("결과를 5분 동안 저장한다."), "기존 인용 제한 스키마 그대로")
  assert.deepEqual(body.reasoning, { effort: "low", exclude: true })
  assert.equal(body.max_tokens, 4096)
  assert.ok(!("temperature" in body), "Gemini 3.x는 sampling 값을 보내지 않는다")
  assert.ok(!("models" in body) && !("providerOptions" in body), "다른 모델로 자동 대체하지 않는다")
})

test("응답 검증: 잘림·차단·JSON 아님은 거절, 사용량은 숫자만 꺼낸다", () => {
  assert.throws(() => parseGatewayResponse({ choices: [{ finish_reason: "length", message: { content: '{"a":' } }] }), { code: "invalid-output" })
  assert.throws(() => parseGatewayResponse({ choices: [{ finish_reason: "content_filter", message: { content: "" } }] }), { code: "provider-blocked" })
  assert.throws(() => parseGatewayResponse({ choices: [{ finish_reason: "stop", message: { content: "그냥 글" } }] }), { code: "invalid-output" })
  assert.throws(() => parseGatewayResponse({ choices: [] }), { code: "invalid-output" })
  const r = parseGatewayResponse({ choices: [{ finish_reason: "stop", message: { content: '{"a":1}' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, completion_tokens_details: { reasoning_tokens: 1 } } })
  assert.deepEqual(r, { raw: { a: 1 }, usage: { promptTokens: 3, completionTokens: 2, reasoningTokens: 1, totalTokens: 5 } })
})

test("오류 분류: 인증·크레딧·권한·모델·한도·서버·시간·형식(메시지 원문은 버림)", () => {
  const c = (s, e = {}) => classifyGatewayError(s, { error: e })
  assert.equal(c(401, { type: "authentication_error", message: `bad ${KEY}` }).code, "provider-auth")
  assert.equal(c(402, { type: "insufficient_funds" }).code, "provider-billing")
  assert.equal(c(400, { type: "invalid_request_error", code: "insufficient_funds" }).code, "provider-billing")
  assert.equal(c(403, {}).code, "provider-auth")
  assert.equal(c(404, { type: "model_not_found" }).code, "provider-model")
  assert.equal(c(429, { type: "rate_limit_exceeded" }).code, "provider-rate-limited")
  assert.equal(c(500, {}).code, "provider-unavailable")
  assert.equal(c(504, {}).code, "timeout")
  assert.equal(c(400, { type: "invalid_request_error", code: "missing_parameter" }).code, "provider-rejected")
  const e = c(401, { type: "authentication_error", code: "invalid_api_key", message: `key ${KEY} is wrong` })
  assert.deepEqual(e.providerDetail, { httpStatus: 401, providerStatus: "authentication_error", providerReason: "invalid_api_key" })
  assert.ok(!JSON.stringify(e.providerDetail).includes(KEY))
})

test("모든 AI 경로가 같은 공급자 선택을 따른다: /api/coach·구간 대화·문단 수정·새 대본·도움 대화(Gateway로만, Google 직접 호출 없음)", async () => {
  const f = smart()
  // RENDER=true여도 Gateway 모드면 팀원 PC 에이전트를 쓰지 않는다
  await withServer({ env: env({ RENDER: "true", GEMINI_API_KEY: "should-not-be-used" }), fetchImpl: f }, async (base) => {
    let r = await postJson(base, "/api/coach", sample({ task: "concepts" }))
    assert.equal(r.status, 200)
    assert.deepEqual(Object.keys(await r.json()).sort(), ["durationMs", "model", "promptVersion", "requestId", "result", "task", "versionId"])
    r = await postJson(base, "/api/coach", sample({ task: "rewrite" }))
    assert.equal(r.status, 200)
    r = await postJson(base, "/api/scripts/generate", { task: "generate", requestId: "g1", versionId: "gv1", topic: "가상 도서관 이용 안내", sources: "" })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).model, "google/gemini-3.8-flash")
    r = await postJson(base, "/api/coach/support", { task: "support-start", requestId: "s1", versionId: "sv1", script: SCRIPT, sources: "", observations: [], history: [], context: "", externalTransferConsent: true })
    assert.equal(r.status, 200)
    // 구간 대화(설명 요청 → concepts)와 대화 기반 문단 수정(→ rewrite)
    const script = `안녕하세요.\n\n${SCRIPT}\n\n감사합니다.`
    const ids = { practiceId: "p1", pointId: "pt1", scriptVersionId: "v1" }
    r = await postJson(base, "/api/coach/segment", { requestId: "q1", ...ids, script, sources: SCRIPT, point: { id: "pt1", startSecond: 3, endSecond: 6, observations: [{ type: "silence" }] }, selection: { sentenceId: "s2", start: script.indexOf("결과를"), end: script.indexOf("결과를") + "결과를 5분 동안 저장한다.".length, text: "결과를 5분 동안 저장한다.", confirmation: "user-selected" }, transcript: {}, history: [{ role: "coach", questionKey: "situation", kind: "question", text: "?", ...ids }], action: { type: "explain", questionKey: "situation" } })
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()))
    r = await postJson(base, "/api/scripts/revise-segment", { requestId: "rv1", ...ids, point: { id: "pt1" }, script, sources: SCRIPT, target: { paragraphIndex: 1, start: 8, end: 8 + SCRIPT.length, text: SCRIPT, confirmation: "user-selected" }, coaching: { summary: { userReports: [{ reason: "concept-confusing" }] } }, request: { explicit: true } })
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()))
    assert.equal((await r.json()).status, "proposed")
  })
  assert.ok(f.calls.length >= 6)
  assert.ok(f.calls.every((c) => c.url === "https://ai-gateway.vercel.sh/v1/chat/completions"), "모든 텍스트 호출이 Gateway로")
})

test("출력 검증 유지: 지어낸 인용은 502, 대본 수정의 수치 변경은 경고·차단", async () => {
  let coach = createCoach({ env: env(), fetchImpl: fakeFetch(() => chat({ ...OUT.review, sourceQuote: "10분간 보관한다" })) })
  await assert.rejects(coach.run(sample({ task: "review", answer: "5분 동안 저장해요.", question: "얼마나?" }), signal()), { code: "invalid-output" })
  coach = createCoach({ env: env(), fetchImpl: fakeFetch(() => chat({ ...OUT.rewrite, rewritten: "결과를 50분 동안 저장해요. 효과가 좋아요." })) })
  const out = await coach.run(sample({ task: "rewrite" }), signal())
  assert.equal(out.result.blocked, true)
  assert.ok(out.result.warnings.some((w) => w.includes("5분")))
})

test("상태 API: 공급자·준비 상태, 키 있음(미확인)과 연결 확인을 구분하고 사용량은 숫자만, 외부 호출 없음", async () => {
  const f = smart()
  await withServer({ env: env(), fetchImpl: f }, async (base) => {
    const before = await (await fetch(`${base}/api/model-status`)).json()
    assert.equal(f.calls.length, 0, "상태 확인으로 생성 요청을 보내지 않는다")
    assert.deepEqual([before.provider, before.model, before.ready, before.reason, before.keyConfigured, before.connection], ["ai-gateway", "google/gemini-3.8-flash", true, "key-configured", true, "unverified"])
    assert.match(before.processingNotice, /Vercel AI Gateway/)
    assert.deepEqual([before.transcription.provider, before.transcription.model, before.transcription.configured, before.transcriptionConfigured], ["ai-gateway", "google/gemini-3.5-transcribe", true, true])
    assert.equal(before.runtime, undefined, "에이전트 없이 동작")
    await postJson(base, "/api/coach", sample())
    const after = await (await fetch(`${base}/api/model-status`)).json()
    assert.deepEqual([after.reason, after.connection], ["ready", "verified"])
    assert.deepEqual(after.usage, { requests: 1, promptTokens: 120, completionTokens: 30, reasoningTokens: 8 })
    const raw = JSON.stringify(after)
    assert.ok(!raw.includes(KEY))
  })
})

test("키가 없으면 기본 기능은 그대로, AI는 미설정 안내(외부 호출 없음)", async () => {
  const f = smart()
  await withServer({ env: env({ AI_GATEWAY_API_KEY: "" }), fetchImpl: f }, async (base) => {
    assert.equal((await fetch(`${base}/__health`)).status, 200)
    assert.equal((await fetch(`${base}/`)).status, 200)
    const st = await (await fetch(`${base}/api/model-status`)).json()
    assert.deepEqual([st.ready, st.reason, st.keyConfigured, st.transcriptionConfigured], [false, "not-configured", false, false])
    const r = await postJson(base, "/api/coach", sample())
    assert.deepEqual([r.status, (await r.json()).error], [503, "not-configured"])
    const t = await fetch(`${base}/api/transcribe`, { method: "POST", body: wavOf(1) })
    assert.deepEqual([t.status, (await t.json()).error], [503, "not-configured"])
  })
  assert.equal(f.calls.length, 0)
})

test("한도 보호: 429는 Retry-After 동안 다시 부르지 않고, 인증 실패 뒤엔 호출 중단, 재시도 없음", async () => {
  let t = 1_000_000
  let f = fakeFetch((n) => (n === 1 ? err(429, { type: "rate_limit_exceeded" }, { "retry-after": "9" }) : chat(OUT.question)))
  let coach = createCoach({ env: env(), fetchImpl: f })
  await assert.rejects(coach.run(sample(), signal()), (e) => e.code === "provider-rate-limited" && e.retryAfter === 9)
  await assert.rejects(coach.run(sample({ requestId: "r2" }), signal()), { code: "provider-rate-limited" })
  assert.equal(f.calls.length, 1)
  f = fakeFetch(() => err(401, { type: "authentication_error" }))
  coach = createCoach({ env: env(), fetchImpl: f })
  await assert.rejects(coach.run(sample(), signal()), { code: "provider-auth" })
  await assert.rejects(coach.run(sample({ requestId: "r2" }), signal()), { status: 503 })
  assert.equal(f.calls.length, 1)
  for (const [responder, code] of [[() => err(503, {}), "provider-unavailable"], [() => { throw new DOMException("t", "TimeoutError") }, "timeout"], [() => { throw new TypeError("fetch failed") }, "provider-unavailable"], [() => chat(OUT.question, { choices: [{ finish_reason: "length", message: { content: "{" } }] }), "invalid-output"]]) {
    const g = fakeFetch(responder)
    await assert.rejects(createCoach({ env: env(), fetchImpl: g }).run(sample(), signal()), { code })
    assert.equal(g.calls.length, 1, `${code}: 재시도 없음`)
  }
  void t
})

test("한도 보호: 분당 호출 수·동시 요청·같은 요청 중복 공유", async () => {
  let release
  const gate = new Promise((r) => (release = r))
  const f = fakeFetch(async () => { await gate; return chat(OUT.question) })
  const coach = createCoach({ env: env({ AI_MAX_CONCURRENT: "1" }), fetchImpl: f })
  const a = coach.run(sample({ requestId: "same" }), signal())
  const b = coach.run(sample({ requestId: "same" }), signal())
  await assert.rejects(coach.run(sample({ requestId: "x", script: `${SCRIPT} 다른` }), signal()), { code: "busy" })
  release()
  await Promise.all([a, b])
  assert.equal(f.calls.length, 1)
  const g = fakeFetch(() => chat(OUT.question))
  const limited = createCoach({ env: env({ AI_MAX_REQUESTS_PER_MINUTE: "2" }), fetchImpl: g })
  await limited.run(sample({ requestId: "1", script: `${SCRIPT} 1` }), signal())
  await limited.run(sample({ requestId: "2", script: `${SCRIPT} 2` }), signal())
  await assert.rejects(limited.run(sample({ requestId: "3", script: `${SCRIPT} 3` }), signal()), { code: "rate-limited" })
})

test("전사 요청 변환: /v4/ai/transcription-model·머리·base64 WAV, 응답은 기존 시간 구간 형식으로", async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ text: "가상 발표입니다 다음 문장", segments: [{ text: "가상 발표입니다", startSecond: 0.2, endSecond: 1.4 }, { text: "다음 문장", start: 1.5, end: 2.6 }, { text: "범위 밖", startSecond: 9, endSecond: 12 }], language: "ko", durationInSeconds: 3 }), { status: 200 }))
  const tr = createTranscriber({ env: env(), fetchImpl: f })
  const wav = wavOf(3)
  const r = await tr.run(wav, signal())
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.segments, [{ text: "가상 발표입니다", startSecond: 0.2, endSecond: 1.4 }, { text: "다음 문장", startSecond: 1.5, endSecond: 2.6 }])
  assert.equal(r.body.processing, "external:ai-gateway")
  const { url, init } = f.calls[0]
  assert.equal(url, "https://ai-gateway.vercel.sh/v4/ai/transcription-model")
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`)
  assert.equal(init.headers["ai-model-id"], "google/gemini-3.5-transcribe")
  assert.equal(init.headers["ai-gateway-protocol-version"], "0.0.1")
  assert.equal(init.headers["ai-transcription-model-specification-version"], "4")
  const body = JSON.parse(init.body)
  assert.deepEqual(Object.keys(body).sort(), ["audio", "mediaType"])
  assert.equal(body.mediaType, "audio/wav")
  assert.deepEqual(Buffer.from(body.audio, "base64"), wav)
  // 구간 정보가 없으면 조각 전체 범위와 낮은 시간 정밀도를 명시한다.
  const g = fakeFetch(() => new Response(JSON.stringify({ text: "글만 있음", segments: [] }), { status: 200 }))
  const fallback = (await createTranscriber({ env: env(), fetchImpl: g }).run(wavOf(1), signal())).body
  assert.deepEqual(fallback.segments, [{ text: "글만 있음", startSecond: 0, endSecond: 1, timingPrecision: "chunk" }])
  assert.equal(fallback.timingPrecision, "chunk")
})

test("전사 한도: WAV 형식·누적 길이·동시 실행·같은 조각 중복 공유·오류 처리", async () => {
  const ok = () => new Response(JSON.stringify({ text: "가", segments: [] }), { status: 200 })
  let tr = createTranscriber({ env: env({ TRANSCRIBE_TOTAL_SECONDS: "2" }), fetchImpl: fakeFetch(ok) })
  assert.equal((await tr.run(Buffer.from("not wav"), signal())).status, 415)
  assert.equal((await tr.run(wavOf(1.5), signal())).status, 200)
  assert.deepEqual([(await tr.run(wavOf(1, 0.2), signal())).status], [429], "누적 2초 초과")
  let release
  const gate = new Promise((r) => (release = r))
  const f = fakeFetch(async () => { await gate; return ok() })
  tr = createTranscriber({ env: env(), fetchImpl: f })
  const same = wavOf(1)
  const a = tr.run(same, signal()), b = tr.run(same, signal()) // 같은 조각 → 한 번만
  const c = tr.run(wavOf(1, 0.3), signal())
  const d = await tr.run(wavOf(1, 0.4), signal()) // 동시 2개 초과
  assert.deepEqual([d.status, d.body.error], [429, "busy"])
  release()
  await Promise.all([a, b, c])
  assert.equal(f.calls.length, 2)
  const g = fakeFetch(() => err(401, { type: "authentication_error" }))
  tr = createTranscriber({ env: env(), fetchImpl: g })
  assert.equal((await tr.run(wavOf(1), signal())).body.error, "provider-auth")
  assert.equal((await tr.run(wavOf(1, 0.2), signal())).status, 503)
  assert.equal(g.calls.length, 1, "인증 실패 뒤 호출 중단")
  assert.equal(tr.status().connection, "failed")
  const h = fakeFetch(() => { throw new DOMException("t", "TimeoutError") })
  assert.equal((await createTranscriber({ env: env(), fetchImpl: h }).run(wavOf(1), signal())).body.error, "timeout")
})

test("HTTP /api/transcribe도 Gateway 모드에서 같은 응답 계약을 지킨다", async () => {
  const f = fakeFetch(() => new Response(JSON.stringify({ text: "가상", segments: [{ text: "가상", startSecond: 0, endSecond: 0.8 }], language: "ko" }), { status: 200 }))
  await withServer({ env: env(), fetchImpl: f }, async (base) => {
    const r = await fetch(`${base}/api/transcribe`, { method: "POST", body: wavOf(1) })
    assert.equal(r.status, 200)
    const b = await r.json()
    assert.deepEqual([b.text, b.segments, b.language, b.durationInSeconds], ["가상", [{ text: "가상", startSecond: 0, endSecond: 0.8 }], "ko", 1])
  })
})

test("기본(local)은 그대로: AI_PROVIDER가 없으면 Gateway를 부르지 않는다", async () => {
  const f = smart()
  const coach = createCoach({ env: { AI_GATEWAY_API_KEY: KEY }, fetchImpl: f })
  assert.equal(coach.provider, "local")
  assert.equal(createTranscriber({ env: { AI_GATEWAY_API_KEY: KEY } }).provider, "local")
  await assert.rejects(coach.run(sample(), signal()), { code: "not-configured" })
  assert.equal(f.calls.length, 0)
  assert.throws(() => createGatewayClient({ apiKey: KEY, model: "../x" }))
})

test("키·본문은 로그(console)에 남지 않는다", () => {
  for (const s of [KEY, "결과를 5분"]) assert.ok(!logged.some((l) => l.includes(s)))
})

test("Gateway text-only timestamps survive HTTP and chunk conversion; empty speech has no fabricated segment", async () => {
  const { chunkSegments } = await import("../public/js/importer.js")
  const f = fakeFetch(() => new Response(JSON.stringify({ text: "음 가상 발표", language: null }), { status: 200 }))
  await withServer({ env: env(), fetchImpl: f }, async base => {
    const response = await fetch(`${base}/api/transcribe`, { method: "POST", body: wavOf(5) })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.timingPrecision, "chunk")
    assert.deepEqual(chunkSegments({ startSec: 40, endSec: 45 }, body), [{ startSec: 40, endSec: 45, text: "음 가상 발표", timingPrecision: "chunk" }])
  })
  for (const text of ["", "  "]) {
    const tr = createTranscriber({ env: env(), fetchImpl: fakeFetch(() => new Response(JSON.stringify({ text }), { status: 200 })) })
    assert.deepEqual((await tr.run(wavOf(1), signal())).body.segments, [])
  }
})


test("Google Gateway 전송에서 빈 인용 enum을 빼되 실제 인용 검증은 유지한다", async()=>{
 const schema={type:"object",properties:{quote:{type:"string",enum:[""]},nested:{type:"array",items:{type:"string",enum:["","원문"]}},state:{type:"string",enum:["supported","uncertain"]}}}
 const out=gatewaySchema(schema,"google/gemini-3.8-flash")
 assert.equal(out.properties.quote.enum,undefined)
 assert.match(out.properties.quote.description,/Return the empty string/)
 assert.equal(out.properties.nested.items.enum,undefined)
 assert.deepEqual(out.properties.state.enum,["supported","uncertain"])
 assert.deepEqual(schema.properties.quote.enum,[""])
 assert.deepEqual(gatewaySchema(schema,"anthropic/claude-haiku-5.5"),schema)
 const good=fakeFetch(()=>chat({...OUT.rewrite,sourceQuote:""}))
 await createCoach({env:env(),fetchImpl:good}).run(sample({task:"rewrite",sources:""}),signal())
 assert.equal(JSON.parse(good.calls[0].init.body).response_format.json_schema.schema.properties.sourceQuote.enum,undefined)
 const bad=fakeFetch(()=>chat({...OUT.rewrite,sourceQuote:"자료에 없는 인용"}))
 await assert.rejects(createCoach({env:env(),fetchImpl:bad}).run(sample({task:"rewrite",sources:""}),signal()),{code:"invalid-output"})
 assert.equal(bad.calls.length,1)
})
