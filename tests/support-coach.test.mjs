import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "../server.js"
import { supportSpec, createSupportCoach } from "../server/support-coach.js"
import { scriptChunks, replaceSelectedChunk, supportWorkspace } from "../public/js/support-state.js"

const SCRIPT = "캐시는 최근 결과를 5분 동안 보관해 같은 요청에 다시 사용합니다."
const draft = "캐시는 최근 결과를 5분 동안 잠시 저장해 두고 같은 요청에 다시 쓰는 방식입니다."
const say = { reflection: "함께 살펴볼 구간을 골랐어요.", question: "이 순간 어떤 부분을 함께 정리하면 좋을까요?", help: "", offerRewrite: true, sourceQuote: "" }
const signal = () => new AbortController().signal
const start = extra => ({ task: "support-start", requestId: "req-1", versionId: "v1", script: SCRIPT, sources: "", context: "", observations: [{ text: "4초 침묵 후보", source: "measurement" }], history: [], externalTransferConsent: true, ...extra })
const conversation = [ { role: "coach", text: say.question }, { role: "user", text: "캐시라는 표현의 뜻을 함께 정리하고 싶어요." } ]
const answer = extra => start({ task: "support-answer", history: conversation, ...extra })
const rewrite = extra => start({ task: "support-rewrite", rewriteConsent: true, history: [...conversation, { role: "coach", text: "원하시면 쉬운 표현을 함께 만들어 볼까요?" }], ...extra })
function fake() {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    const input = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text)
    const raw = input.task === "support-rewrite" ? { rewritten: draft, reason: "보관을 잠시 저장하는 뜻으로 풀었어요.", sourceQuote: "" } : say
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(raw) }] } }] }))
  }
  return { calls, fetchImpl }
}

test("explicit text-transfer consent and rewrite permission are required before any Gemini call", async () => {
  const f = fake(), service = createSupportCoach({ env: { GEMINI_API_KEY: "unit-test-key" }, fetchImpl: f.fetchImpl })
  for (const body of [start({ externalTransferConsent: false }), start({ externalTransferConsent: undefined })]) await assert.rejects(service.run(body, signal()), { code: "consent-required" })
  for (const body of [rewrite({ rewriteConsent: false }), rewrite({ history: [] })]) await assert.rejects(service.run(body, signal()), { code: "rewrite-consent-required" })
  assert.equal(f.calls.length, 0)
})

test("start asks before offering changes; answer and explicit rewrite use only requested Gemini model", async () => {
  const f = fake(), service = createSupportCoach({ env: { GEMINI_API_KEY: "unit-test-key", GEMINI_MODEL: "gemini-3.8-flash" }, fetchImpl: f.fetchImpl })
  assert.equal((await service.status()).ready, true); assert.equal(f.calls.length, 0)
  const initial = await service.run(start(), signal())
  assert.equal(initial.result.offerRewrite, false)
  assert.match(initial.result.question, /어떤/)
  assert.equal((await service.run(answer(), signal())).result.offerRewrite, true)
  const result = await service.run(rewrite(), signal())
  assert.equal(result.result.rewritten, draft); assert.equal(result.result.blocked, false)
  assert.equal(f.calls.length, 3)
  assert.ok(f.calls.every(c => c.url.endsWith("/models/gemini-3.8-flash:generateContent")))
  const text = JSON.stringify(JSON.parse(f.calls[0].options.body))
  assert.match(text, /원인을|추정하거나/); assert.match(text, /이해 부족/)
  assert.ok(!JSON.stringify(result).includes("unit-test-key"))
})

test("negative labels, unsupported emotional inference and invented citations are rejected", () => {
  const input = supportSpec.validateInput(answer({ sources: SCRIPT }))
  for (const reflection of ["숙지가 미흡하네요.", "이해력이 부족해서 그래요.", "긴장한 게 분명해요.", "불안해서 멈춘 것 같아요."]) assert.throws(() => supportSpec.validateOutput({ ...say, reflection }, input), { code: "invalid-output" })
  assert.throws(() => supportSpec.validateOutput({ ...say, sourceQuote: "없는 근거입니다." }, input), { code: "invalid-output" })
  const userEmotion = supportSpec.validateInput(answer({ history: [conversation[0], { role: "user", text: "사람들 앞에서 긴장했다고 느꼈어요." }] }))
  assert.doesNotThrow(() => supportSpec.validateOutput({ ...say, reflection: "긴장했다고 느낀 순간을 말해 주셨네요.", question: "어떤 순간에 신경이 쓰였나요?" }, userEmotion))
})

test("third answer ends follow-up questions and declining simplification is respected", () => {
  const history = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? "user" : "coach", text: i % 2 ? "표현의 뜻을 같이 정리하고 싶어요." : "어떤 도움이 필요할까요?" }))
  const result = supportSpec.validateOutput(say, supportSpec.validateInput(answer({ history, simplifyDeclined: true })))
  assert.equal(result.question, ""); assert.equal(result.userAnswerCount, 3); assert.equal(result.offerRewrite, false)
  assert.throws(() => supportSpec.validateInput(answer({ history: [...history, { role: "coach", text: "질문" }, { role: "user", text: "답" }] })), { code: "invalid-input" })
})

test("numeric changes remain blocked and text-only input is strictly bounded", () => {
  const input = supportSpec.validateInput(rewrite())
  assert.equal(supportSpec.validateOutput({ rewritten: draft.replace("5분", "6분"), reason: "쉽게 풀었어요.", sourceQuote: "" }, input).blocked, true)
  for (const body of [start({ script: "가".repeat(2401) }), start({ audioBlob: "not-permitted" }), start({ observations: [{ text: "긴장함", source: "diagnosis" }] }), answer({ history: [{ role: "user", text: "첫 메시지" }] })]) assert.throws(() => supportSpec.validateInput(body), { code: "invalid-input" })
})

test("long scripts retain every unselected character; workspace versions and prior answers remain", () => {
  const full = ("도입입니다.\n").repeat(400) + SCRIPT + "\n마무리입니다."
  const chunks = scriptChunks(full); assert.equal(chunks.map(c => c.text).join(""), full); assert.ok(chunks.every(c => c.text.length <= 2400))
  const chosen = chunks.at(-1), replaced = replaceSelectedChunk(full, chosen, "고른 부분의 새 문장입니다.")
  assert.equal(replaced, full.slice(0, chosen.start) + "고른 부분의 새 문장입니다.")
  assert.throws(() => replaceSelectedChunk(full + "x", { ...chosen, text: "다른 대본" }, draft))
  assert.equal(replaceSelectedChunk("도입\n본문\n결론", { start: 3, end: 6, text: "본문\n" }, "새 본문"), "도입\n새 본문\n결론")
  const previous = { id: "current", script: "지난 대본입니다.", sources: "", versionId: "old", versions: [], attempts: [{ answer: "과거 답변" }] }
  const saved = supportWorkspace(previous, SCRIPT, draft, "", { versionId: "new", requestId: "r", model: "gemini-3.8-flash", createdAt: 1, practiceId: "practice" })
  assert.equal(saved.script, draft); assert.deepEqual(saved.attempts, previous.attempts)
  assert.ok(saved.versions.some(v => v.script === SCRIPT)); assert.equal(saved.versions.at(-1).origin, "gemini-support-rewrite")
  assert.equal(previous.script, "지난 대본입니다."); assert.equal(previous.versions.length, 0)
})

test("missing key and upstream failure preserve base functions without fallback", async () => {
  const f = fake(), noKey = createSupportCoach({ fetchImpl: f.fetchImpl })
  assert.equal((await noKey.status()).ready, false)
  await assert.rejects(noKey.run(start(), signal()), { code: "not-configured" }); assert.equal(f.calls.length, 0)
  const failed = createSupportCoach({ env: { GEMINI_API_KEY: "unit-test-key" }, fetchImpl: async () => new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 }) })
  await assert.rejects(failed.run(start(), signal()), { code: "provider-model" })
  assert.equal((await failed.status()).ready, false)
})

test("HTTP support endpoint exposes no credentials, rejects cross-origin and keeps /api/coach local", async () => {
  const f = fake(), server = createServer({ env: { GEMINI_API_KEY: "unit-test-key" }, fetchImpl: f.fetchImpl })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`
  try {
    const state = await (await fetch(base + "/api/coach/support-status")).json(); assert.equal(state.provider, "gemini"); assert.equal(f.calls.length, 0)
    const send = (body, origin = base) => fetch(base + "/api/coach/support", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) })
    assert.equal((await send(start(), "https://unrelated.invalid")).status, 403)
    const response = await send(start()); assert.equal(response.status, 200)
    assert.ok(!(await response.text()).includes("unit-test-key"))
    assert.equal((await (await fetch(base + "/api/model-status")).json()).provider, "local")
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
