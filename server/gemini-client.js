// Gemini API 호출만 맡는 모듈(models.generateContent, REST v1beta). 코칭 규칙·제한은 remote-coach.js가 맡는다.
// 나중에 다른 Gateway로 바꿀 때는 같은 generateJson({ system, user, schema, ... }) 모양의 클라이언트를 새로 만들면 된다.
// API 키는 x-goog-api-key 머리로만 보내고(주소·로그·응답에 넣지 않음), 다른 모델·유료 등급으로 자동으로 바꾸지 않는다.
import { CoachError, LIMITS, boundedJson } from "./local-coach.js"

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
export const MAX_OUTPUT_TOKENS = 2048

const KEEP = "원문은 그대로 보존돼요."

const ENUM = /^[A-Z][A-Z0-9_]{0,63}$/

/**
 * 진단용으로 남길 Google 오류 정보. HTTP 상태와 Google의 대문자 열거 코드(status·reason)만 허용 목록 방식으로 남기고,
 * 메시지 원문·요청 내용·키·프로젝트 정보가 들어갈 수 있는 자유 문자열은 버린다.
 */
export function providerDetail(httpStatus, body) {
  const err = body?.error || {}
  const status = typeof err.status === "string" && ENUM.test(err.status) ? err.status : null
  const reason = (Array.isArray(err.details) ? err.details : []).map((d) => d?.reason).find((r) => typeof r === "string" && ENUM.test(r)) || null
  return { httpStatus: Number.isInteger(httpStatus) ? httpStatus : null, providerStatus: status, providerReason: reason }
}

/** Google 오류 응답(HTTP 상태·status·reason)을 우리 오류 코드로 나눈다. Google 메시지 원문은 사용자에게 넘기지 않는다. */
export function classifyGeminiError(httpStatus, body) {
  return Object.assign(classifyCode(httpStatus, body), { providerDetail: providerDetail(httpStatus, body) })
}

function classifyCode(httpStatus, body) {
  const err = body?.error || {}
  const status = String(err.status || err.code || "").toUpperCase()
  const reasons = (Array.isArray(err.details) ? err.details : []).map((d) => String(d?.reason || "").toUpperCase())
  const text = `${status} ${reasons.join(" ")}`
  if (httpStatus === 401 || httpStatus === 403 || /API_KEY_INVALID|API_KEY_EXPIRED|AUTHENTICATION|PERMISSION_DENIED|UNAUTHENTICATED/.test(text)) {
    return new CoachError(502, "provider-auth", `Gemini가 API 키를 받아들이지 않았어요. 서버의 GEMINI_API_KEY와 프로젝트 권한을 확인해 주세요. ${KEEP}`)
  }
  if (httpStatus === 402 || /FAILED_PRECONDITION|PAYMENT_REQUIRED|BILLING/.test(text)) {
    return new CoachError(502, "provider-billing", `Gemini 프로젝트의 결제·지역·사용 조건 때문에 요청이 거절됐어요. Google AI Studio의 프로젝트 설정을 확인해 주세요. ${KEEP}`)
  }
  if (httpStatus === 404) return new CoachError(502, "provider-model", `설정한 Gemini 모델을 찾지 못했어요. 서버의 GEMINI_MODEL 값을 확인해 주세요. ${KEEP}`)
  if (httpStatus === 429 || /RESOURCE_EXHAUSTED|RATE_LIMIT|QUOTA/.test(text)) {
    return new CoachError(429, "provider-rate-limited", `Gemini 사용 한도(분당·일일 요청 수 등)에 걸렸어요. 잠시 뒤에 다시 시도해 주세요. ${KEEP}`)
  }
  if (httpStatus === 504 || /DEADLINE_EXCEEDED/.test(text)) return new CoachError(504, "timeout", `Gemini 응답이 늦어 처리를 멈췄어요. ${KEEP}`)
  if (httpStatus >= 500) return new CoachError(503, "provider-unavailable", `Gemini 서비스가 일시적으로 응답하지 않아요. 잠시 뒤에 다시 시도해 주세요. ${KEEP}`)
  return new CoachError(502, "provider-rejected", `Gemini가 요청 형식을 받아들이지 않았어요. 입력을 짧게 나누어 다시 시도해 주세요. ${KEEP}`)
}

/**
 * 모델 접근 확인(models.get). 생성 요청이 아니며 토큰을 쓰지 않는다.
 * 반환: { model, httpStatus, providerStatus, providerReason, accessible, generateContent }
 * accessible=true는 '이 키로 모델 정보를 조회할 수 있다'는 뜻일 뿐 생성 호출·무료 사용 가능을 보장하지 않는다.
 */
export async function checkModelAccess({ apiKey, model, fetchImpl = fetch, baseUrl = GEMINI_BASE_URL, timeoutMs = 15_000 }) {
  if (!/^[a-z0-9][a-z0-9.-]{0,80}$/i.test(model)) throw new Error("invalid-model-name")
  const res = await fetchImpl(`${baseUrl}/models/${model}`, { method: "GET", redirect: "error", headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(timeoutMs) })
  let body = null
  try {
    body = await boundedJson(res, LIMITS.output)
  } catch {
    /* 본문이 없거나 너무 큼 */
  }
  const methods = Array.isArray(body?.supportedGenerationMethods) ? body.supportedGenerationMethods : []
  return {
    model,
    ...providerDetail(res.status, body),
    accessible: res.ok,
    generateContent: res.ok ? methods.includes("generateContent") : null,
  }
}

/** Google의 RetryInfo(예: "37s")나 Retry-After 머리에서 기다릴 초를 읽는다. 없으면 null. */
export function retryAfterSeconds(headers, body) {
  const header = Number(headers?.get?.("retry-after"))
  if (Number.isFinite(header) && header > 0) return Math.ceil(header)
  for (const d of Array.isArray(body?.error?.details) ? body.error.details : []) {
    const m = String(d?.retryDelay || "").match(/^(\d+(?:\.\d+)?)s$/)
    if (m) return Math.ceil(Number(m[1]))
  }
  return null
}

const blocked = () => new CoachError(502, "provider-blocked", `Gemini 안전 필터 등으로 결과를 만들지 않았어요. 표현을 바꾸거나 직접 수정해 주세요. ${KEEP}`)
const invalidOutput = () => new CoachError(502, "invalid-output", "모델 결과의 형식이나 근거를 확인하지 못했어요. 원문은 그대로 두고 다시 시도하거나 직접 수정해 주세요.")

/**
 * generateContent 응답에서 JSON 결과를 꺼낸다. 차단·잘림·형식 오류를 구분한다.
 * 반환: { raw, usage }
 */
export function parseGeminiResponse(body) {
  if (body?.promptFeedback?.blockReason) throw blocked()
  const cand = Array.isArray(body?.candidates) ? body.candidates[0] : null
  if (!cand) throw invalidOutput()
  if (cand.finishReason === "MAX_TOKENS") throw invalidOutput() // 잘린 JSON은 쓰지 않는다
  if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "LANGUAGE_NOT_SUPPORTED", "OTHER"].includes(cand.finishReason)) throw blocked()
  const parts = Array.isArray(cand.content?.parts) ? cand.content.parts : []
  const text = parts.filter((p) => typeof p?.text === "string" && !p.thought).map((p) => p.text).join("")
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw invalidOutput()
  }
  return { raw, usage: body.usageMetadata || null }
}

/**
 * 모델 계열별 생각(thinking) 설정. 지원하지 않는 값을 보내지 않도록 공식 문서 기준으로 고른다.
 * - gemini-2.5-flash 계열: thinkingBudget 0(생각 끄기) 지원 → 지연·사용량을 줄인다.
 * - gemini-3.x: 공식 모델 페이지 기준 3.8 Flash는 thinking level low·medium·high만 지원하고 minimal(생각 끄기에 해당)은 오류.
 *   그래서 생각을 끄지 않고 지원 범위의 최저값 low를 쓴다. thinkingLevel과 thinkingBudget을 함께 보내면 400이라 하나만 보낸다.
 * - 그 밖(예: 2.5 Pro는 생각을 끌 수 없음): 보내지 않고 모델 기본값을 쓴다.
 */
export function thinkingConfigFor(model) {
  if (/^gemini-2\.5-flash(-lite)?(-|$)/.test(model)) return { thinkingBudget: 0 }
  if (/^gemini-3(\.|-)/.test(model)) return { thinkingLevel: "low" }
  return undefined
}

/**
 * Gemini 클라이언트. 재시도하지 않는다(사용자가 다시 누를 때만 다시 호출).
 * options: { apiKey, model, timeoutMs, fetchImpl, baseUrl }
 */
export function createGeminiClient({ apiKey, model = DEFAULT_GEMINI_MODEL, timeoutMs = 30_000, fetchImpl = fetch, baseUrl = GEMINI_BASE_URL }) {
  if (!/^[a-z0-9][a-z0-9.-]{0,80}$/i.test(model)) throw new Error("invalid-model-name")
  const url = `${baseUrl}/models/${model}:generateContent`
  const thinking = thinkingConfigFor(model)
  return {
    provider: "gemini",
    model,
    async generateJson({ system, user, schema, temperature = 0.2, signal }) {
      let res
      try {
        res = await fetchImpl(url, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: {
              temperature,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              responseMimeType: "application/json",
              responseJsonSchema: schema,
              ...(thinking && { thinkingConfig: thinking }),
            },
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        })
      } catch (e) {
        if (signal.aborted) throw new CoachError(499, "cancelled", "요청을 취소했어요.")
        if (e?.name === "TimeoutError") throw new CoachError(504, "timeout", `Gemini 응답이 늦어 처리를 멈췄어요. ${KEEP}`)
        throw new CoachError(503, "provider-unavailable", `Gemini에 연결하지 못했어요. 잠시 뒤에 다시 시도해 주세요. ${KEEP}`)
      }
      let body = null
      try {
        body = await boundedJson(res, LIMITS.output)
      } catch (e) {
        if (signal.aborted) throw new CoachError(499, "cancelled", "요청을 취소했어요.")
        if (e?.name === "TimeoutError") throw new CoachError(504, "timeout", `Gemini 응답이 늦어 처리를 멈췄어요. ${KEEP}`)
        if (res.ok) throw invalidOutput()
      }
      if (!res.ok) {
        const error = classifyGeminiError(res.status, body)
        error.retryAfter = retryAfterSeconds(res.headers, body)
        throw error
      }
      return parseGeminiResponse(body)
    },
  }
}
