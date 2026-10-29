// 외부 모델 공급자(현재 Gemini)로 /api/coach 과업을 실행한다. 모델 호출은 client.generateJson에 맡기고,
// 입력 검사·프롬프트·출력 검증(원문 인용·수치·단위·형식)은 자체 모델과 같은 local-coach.js 규칙을 그대로 쓴다.
// 별도로 선택한 새 대본·도움 대화 서비스가 사용한다. /api/coach 기본 코칭은 자체 모델이며 상태 확인은 외부로 요청하지 않는다.
// 호출량 제한은 이 서버 프로세스 메모리에만 있어서 재시작·여러 인스턴스에서는 초기화·분산된다(예산을 완전히 보장하지 않음).
import { createHash } from "node:crypto"
import { CoachError, PROMPT_VERSION, buildMessages, outputSchema, validateInput, validateOutput } from "./local-coach.js"

const KEEP = "원문은 그대로 보존돼요."
const int = (v, def, min, max) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : def
}

/** 환경변수에서 호출 제한을 읽는다. 잘못된 값은 기본값을 쓴다. */
export function remoteLimits(env = {}) {
  return {
    perMinute: int(env.AI_MAX_REQUESTS_PER_MINUTE, 10, 1, 600),
    perDay: int(env.AI_MAX_REQUESTS_PER_DAY, 200, 1, 100_000),
    perClientPerMinute: int(env.AI_MAX_REQUESTS_PER_CLIENT_PER_MINUTE, 4, 1, 600),
    concurrent: int(env.AI_MAX_CONCURRENT, 2, 1, 16),
    cooldownSec: 60, // 공급자가 429를 주고 기다릴 시간을 알려 주지 않을 때
  }
}

/** 상태에 보여 줄 오류별 안내(우리가 쓴 문장만). Google 메시지 원문은 공개하지 않는다. */
const HINTS = {
  "provider-model": "이 API 키의 프로젝트에서 설정한 모델에 접근할 수 없거나 모델 이름이 맞지 않아요(Google 404). 생성 요청 없이 `npm run gemini:check-models`로 모델 접근 여부를 확인하고, 사용할 모델을 GEMINI_MODEL에 직접 정해 주세요.",
  "provider-auth": "Google이 API 키를 받아들이지 않았어요. 키 값·키를 만든 프로젝트·API 사용 설정을 확인해 주세요.",
  "provider-billing": "Google 프로젝트의 결제·지역·사용 조건 때문에 거절됐어요. Google AI Studio의 프로젝트 설정을 확인해 주세요.",
  "provider-rate-limited": "Google 사용 한도에 걸렸어요. 한도는 프로젝트 단위이며 Google AI Studio에서 확인할 수 있어요.",
  "provider-unavailable": "Google 서비스 오류나 연결 실패예요. 잠시 뒤 다시 시도할 수 있어요.",
  "provider-rejected": "Google이 요청 형식을 거절했어요(400). 입력 길이나 응답 형식 설정을 확인해야 해요.",
  "provider-blocked": "Google 안전 필터 등으로 결과가 만들어지지 않았어요.",
  "timeout": "Google 응답 시간이 초과됐어요.",
  "invalid-output": "응답은 받았지만 형식·근거 검증을 통과하지 못했어요.",
}

/** 일정 시간 창 안의 호출 시각을 센다. */
function windowCounter(ms) {
  const times = []
  return {
    count(now) {
      while (times.length && times[0] <= now - ms) times.shift()
      return times.length
    },
    add(now) {
      times.push(now)
    },
    retryAfter(now) {
      return times.length ? Math.max(1, Math.ceil((times[0] + ms - now) / 1000)) : 1
    },
  }
}

const rateLimited = (retryAfter, scope) =>
  Object.assign(new CoachError(429, "rate-limited", `${scope} AI 실행 횟수 한도에 도달했어요. ${retryAfter}초 뒤에 다시 시도해 주세요. ${KEEP}`), { retryAfter })

/**
 * client: { provider, model, generateJson({ system, user, schema, temperature, signal }) → { raw, usage } }
 * info: { processing, processingNotice, keyConfigured, configError }
 */
export function createRemoteCoach({ client, info, limits = remoteLimits(), now = () => Date.now(), spec = { validateInput, buildMessages, outputSchema, validateOutput }, promptVersion = PROMPT_VERSION }) {
  const minute = windowCounter(60_000)
  const day = windowCounter(86_400_000)
  const perClient = new Map()
  const inFlight = new Map()
  let active = 0
  let cooldownUntil = 0
  let connection = "unverified" // unverified → verified(성공한 생성 응답) / failed(인증·결제·모델 오류)
  let lastVerifiedAt = null
  let lastFailure = null
  let lastError = null // { code, httpStatus, providerStatus, providerReason, at, hint } — 원문 메시지·키·요청 내용 없음
  const label = info.label || "Gemini" // 안내 문구의 공급자 이름(Gemini 직접 / AI Gateway)
  const dest = info.destination || "Google Gemini API"
  const usage = { requests: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 } // 숫자만(본문·키 없음), 메모리 기준

  function status() {
    const base = { provider: client?.provider || info.provider, model: client?.model || info.model, promptVersion, processing: info.processing, processingNotice: info.processingNotice, keyConfigured: info.keyConfigured, connection, lastVerifiedAt, lastError, usage: { ...usage } }
    if (info.configError) return { ...base, ready: false, reason: info.configError.reason, message: info.configError.message }
    if (connection === "failed") return { ...base, ready: false, reason: lastFailure, message: `마지막 요청에서 ${label} 설정 문제(${lastFailure})가 확인됐어요. 서버 설정을 고친 뒤 다시 배포해 주세요. 자료 저장·직접 수정은 계속할 수 있어요.` }
    const wait = Math.ceil((cooldownUntil - now()) / 1000)
    if (wait > 0) return { ...base, ready: true, reason: "cooldown", retryAfter: wait, message: `${label} 사용 한도로 ${wait}초 동안 요청을 쉬고 있어요. 그 뒤에 다시 실행할 수 있어요.` }
    if (connection === "verified") return { ...base, ready: true, reason: "ready", message: `${label} 연결이 확인됐어요. AI 실행을 누른 텍스트만 ${dest}로 보내 처리해요.` }
    return { ...base, ready: true, reason: "key-configured", message: `${label} 키가 설정돼 있어요. 실제 연결은 첫 AI 실행에서 확인돼요. AI 실행을 누른 텍스트만 ${dest}로 보내 처리해요.` }
  }

  function admit(client) {
    const t = now()
    const wait = Math.ceil((cooldownUntil - t) / 1000)
    if (wait > 0) throw Object.assign(new CoachError(429, "provider-rate-limited", `${label} 사용 한도로 잠시 요청을 쉬고 있어요. ${wait}초 뒤에 다시 시도해 주세요. ${KEEP}`), { retryAfter: wait })
    if (active >= limits.concurrent) throw new CoachError(429, "busy", `다른 AI 요청을 처리 중이에요. 잠시 후 다시 시도해 주세요. ${KEEP}`)
    if (day.count(t) >= limits.perDay) throw rateLimited(day.retryAfter(t), "오늘 이 서버의")
    if (minute.count(t) >= limits.perMinute) throw rateLimited(minute.retryAfter(t), "이 서버의 분당")
    const key = client || "unknown"
    let c = perClient.get(key)
    if (!c) perClient.set(key, (c = windowCounter(60_000)))
    if (c.count(t) >= limits.perClientPerMinute) throw rateLimited(c.retryAfter(t), "이 기기의 분당")
    if (perClient.size > 1000) for (const [k, v] of perClient) if (!v.count(t)) perClient.delete(k)
    minute.add(t)
    day.add(t)
    c.add(t)
  }

  async function call(input, signal) {
    const [system, user] = spec.buildMessages(input)
    const start = now()
    try {
      usage.requests++
      const { raw, usage: used } = await client.generateJson({ system: system.content, user: user.content, schema: spec.outputSchema(input), temperature: input.task === "review" ? 0 : 0.2, signal })
      connection = "verified"
      lastVerifiedAt = new Date(now()).toISOString()
      lastError = null
      for (const k of ["promptTokens", "completionTokens", "reasoningTokens"]) usage[k] += Number(used?.[k]) || 0
      return { requestId: input.requestId, versionId: input.versionId, task: input.task, model: client.model, promptVersion, durationMs: now() - start, result: spec.validateOutput(raw, input) }
    } catch (e) {
      if (e instanceof CoachError) {
        if (HINTS[e.code]) {
          const d = e.providerDetail || {}
          lastError = { code: e.code, httpStatus: d.httpStatus ?? null, providerStatus: d.providerStatus ?? null, providerReason: d.providerReason ?? null, at: new Date(now()).toISOString(), hint: HINTS[e.code] }
        }
        if (["provider-auth", "provider-billing", "provider-model"].includes(e.code)) {
          connection = "failed"
          lastFailure = e.code
        }
        if (e.code === "provider-rate-limited") {
          e.retryAfter ||= limits.cooldownSec
          cooldownUntil = now() + e.retryAfter * 1000 // 429 뒤에는 연속 호출하지 않는다
        }
        if (e.code === "invalid-output") {
          connection = "verified" // 응답은 받았다(형식만 틀림)
          lastVerifiedAt = new Date(now()).toISOString()
        }
        throw e
      }
      throw new CoachError(502, "provider-unavailable", `AI 응답을 처리하지 못했어요. ${KEEP}`)
    }
  }

  return {
    status,
    async run(data, signal, meta = {}) {
      const input = spec.validateInput(data)
      if (input.task === "review" && !input.answer) throw new CoachError(400, "no-answer", "자기 설명을 입력하거나 설명받기·건너뛰기를 선택해 주세요.")
      // 근거 자료 없는 답변 검토는 모델을 부르지 않는다(자체 모델 방식과 같은 규칙).
      if (input.task === "review" && !input.sources) return { requestId: input.requestId, versionId: input.versionId, task: input.task, model: "rule:no-source", promptVersion, durationMs: 0, result: { state: "uncertain", supported: "", answerQuote: "", sourceQuote: "", nextStep: "답변을 확인할 근거 자료가 아직 없어요. 원자료를 붙여 넣으면 그 내용과 함께 살펴볼 수 있어요.", humanReview: "unreviewed", evidenceStatus: "no-source-material" } }
      if (info.configError) throw new CoachError(503, info.configError.reason, info.configError.message)
      if (connection === "failed") throw new CoachError(503, lastFailure, `${label} 설정 문제(${lastFailure})가 확인돼 요청을 보내지 않았어요. 서버 설정을 고친 뒤 다시 배포해 주세요. ${KEEP}`)
      // 같은 요청 ID나 같은 내용의 요청이 처리 중이면 새로 호출하지 않고 그 결과를 함께 쓴다.
      const { requestId: _requestId, ...content } = input
      const fingerprint = createHash("sha256").update(JSON.stringify(content)).digest("hex")
      const shared = inFlight.get(input.requestId) || inFlight.get(fingerprint)
      if (shared) return { ...(await shared), requestId: input.requestId, versionId: input.versionId }
      admit(meta.client)
      active++
      const job = call(input, signal)
      inFlight.set(input.requestId, job)
      inFlight.set(fingerprint, job)
      try {
        return await job
      } finally {
        active--
        inFlight.delete(input.requestId)
        inFlight.delete(fingerprint)
      }
    },
  }
}
