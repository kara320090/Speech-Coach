// Vercel AI Gateway 텍스트 호출(OpenAI 호환 Chat Completions). 코칭 규칙·제한은 remote-coach.js가 맡는다.
// 공식 문서: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions (base URL, Bearer 인증,
// structured-outputs의 response_format json_schema, reasoning 객체, usage 필드).
// 키(AI_GATEWAY_API_KEY)는 Authorization 머리로만 보내고 주소·로그·응답에 넣지 않는다.
// 다른 모델로의 자동 대체(models 필드)를 보내지 않고, 재시도하지 않는다(사용자가 다시 누를 때만 호출).
import { CoachError, LIMITS, boundedJson } from "./local-coach.js"

export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh"
export const DEFAULT_GATEWAY_TEXT_MODEL = "google/gemini-3.8-flash"
export const DEFAULT_GATEWAY_TRANSCRIBE_MODEL = "google/gemini-3.5-transcribe"
export const GATEWAY_MAX_TOKENS = 4096 // 생각 토큰을 포함한 출력 상한(구조화 JSON 하나)

const KEEP = "원문은 그대로 보존돼요."
const MODEL_ID = /^[a-z0-9][a-z0-9-]{0,40}\/[a-z0-9][a-z0-9.-]{0,80}$/i
const ENUM = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/

export const validGatewayModel = (model) => MODEL_ID.test(String(model || ""))

/** Gateway 오류에서 HTTP 상태와 오류 type·code(짧은 식별자)만 남긴다. 메시지 원문은 버린다. */
export function gatewayDetail(httpStatus, body) {
  const err = body?.error || {}
  const pick = (v) => (typeof v === "string" && ENUM.test(v) ? v : null)
  return { httpStatus: Number.isInteger(httpStatus) ? httpStatus : null, providerStatus: pick(err.type), providerReason: pick(err.code) }
}

/** OpenAI 형식 오류 응답을 우리 오류 코드로 나눈다. */
export function classifyGatewayError(httpStatus, body) {
  const err = body?.error || {}
  const text = `${err.type || ""} ${err.code || ""}`.toLowerCase()
  let e
  if (httpStatus === 401 || /auth|api_key|unauthorized/.test(text)) e = new CoachError(502, "provider-auth", `AI Gateway가 키를 받아들이지 않았어요. 서버의 AI_GATEWAY_API_KEY를 확인해 주세요. ${KEEP}`)
  else if (httpStatus === 402 || /credit|billing|payment|insufficient_funds|quota_exceeded/.test(text)) e = new CoachError(502, "provider-billing", `AI Gateway 사용 한도·크레딧 때문에 거절됐어요. 주최 측 예산 상태를 확인해 주세요. ${KEEP}`)
  else if (httpStatus === 403) e = new CoachError(502, "provider-auth", `AI Gateway 키에 이 모델·기능을 쓸 권한이 없어요. ${KEEP}`)
  else if (httpStatus === 404) e = new CoachError(502, "provider-model", `AI Gateway에서 설정한 모델을 찾지 못했어요. 모델 이름을 확인해 주세요. ${KEEP}`)
  else if (httpStatus === 429) e = new CoachError(429, "provider-rate-limited", `AI Gateway 사용 한도에 걸렸어요. 잠시 뒤에 다시 시도해 주세요. ${KEEP}`)
  else if (httpStatus === 504 || httpStatus === 408) e = new CoachError(504, "timeout", `AI Gateway 응답이 늦어 처리를 멈췄어요. ${KEEP}`)
  else if (httpStatus >= 500) e = new CoachError(503, "provider-unavailable", `AI Gateway가 일시적으로 응답하지 않아요. 잠시 뒤에 다시 시도해 주세요. ${KEEP}`)
  else e = new CoachError(502, "provider-rejected", `AI Gateway가 요청 형식을 받아들이지 않았어요. 입력을 짧게 나누어 다시 시도해 주세요. ${KEEP}`)
  return Object.assign(e, { providerDetail: gatewayDetail(httpStatus, body) })
}

export function retryAfterSeconds(headers) {
  const v = Number(headers?.get?.("retry-after"))
  return Number.isFinite(v) && v > 0 ? Math.ceil(v) : null
}

const invalidOutput = () => new CoachError(502, "invalid-output", "모델 결과의 형식이나 근거를 확인하지 못했어요. 원문은 그대로 두고 다시 시도하거나 직접 수정해 주세요.")

/** 사용량에서 숫자만 꺼낸다(본문은 남기지 않는다). */
export function usageOf(body) {
  const u = body?.usage || {}
  const n = (v) => (Number.isFinite(v) && v >= 0 ? v : 0)
  return { promptTokens: n(u.prompt_tokens), completionTokens: n(u.completion_tokens), reasoningTokens: n(u.completion_tokens_details?.reasoning_tokens), totalTokens: n(u.total_tokens) }
}

/** Chat Completions 응답에서 구조화 JSON을 꺼낸다. 잘림·차단·형식 오류를 구분한다. */
export function parseGatewayResponse(body) {
  const choice = Array.isArray(body?.choices) ? body.choices[0] : null
  if (!choice) throw invalidOutput()
  if (choice.finish_reason === "length") throw invalidOutput() // 잘린 JSON은 쓰지 않는다
  if (choice.finish_reason === "content_filter") throw new CoachError(502, "provider-blocked", `안전 필터 등으로 결과를 만들지 않았어요. 표현을 바꾸거나 직접 수정해 주세요. ${KEEP}`)
  let raw
  try {
    raw = JSON.parse(choice.message?.content)
  } catch {
    throw invalidOutput()
  }
  return { raw, usage: usageOf(body) }
}

/** Google transport schemas must not encode optional/no-source quotes as enum:[""].
 * Keep normal citation enums, and enforce all quote constraints again in validateModelOutput.
 * Work on a clone so local-model schemas and response validation stay unchanged.
 */
export function gatewaySchema(schema, model) {
  const copy = structuredClone(schema)
  if (!model.startsWith("google/")) return copy
  const visit = (node) => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node.enum) && node.enum.includes("")) delete node.enum
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else visit(value)
    }
  }
  visit(copy)
  return copy
}

/**
 * Gateway 텍스트 클라이언트. remote-coach.js가 쓰는 generateJson({ system, user, schema, temperature, signal }) 모양.
 * Gemini 3.x는 sampling 값을 바꾸지 않는 것이 권장이라 temperature를 보내지 않는다.
 */
export function createGatewayClient({ apiKey, model = DEFAULT_GATEWAY_TEXT_MODEL, timeoutMs = 55_000, fetchImpl = fetch, baseUrl = GATEWAY_BASE_URL }) {
  if (!validGatewayModel(model)) throw new Error("invalid-model-name")
  const defaultSampling = /^google\/gemini-(\d+)/.test(model) && Number(model.match(/^google\/gemini-(\d+)/)[1]) >= 3
  return {
    provider: "ai-gateway",
    model,
    async generateJson({ system, user, schema, temperature = 0.2, signal }) {
      let res
      try {
        res = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          redirect: "error",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
            stream: false,
            max_tokens: GATEWAY_MAX_TOKENS,
            ...(!defaultSampling && { temperature }),
            response_format: { type: "json_schema", json_schema: { name: "result", schema: gatewaySchema(schema, model) } },
            reasoning: { effort: "low", exclude: true }, // 생각은 낮게, 생각 글은 응답에서 뺀다
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        })
      } catch (e) {
        if (signal.aborted) throw new CoachError(499, "cancelled", "요청을 취소했어요.")
        if (e?.name === "TimeoutError") throw new CoachError(504, "timeout", `AI Gateway 응답이 늦어 처리를 멈췄어요. ${KEEP}`)
        throw new CoachError(503, "provider-unavailable", `AI Gateway에 연결하지 못했어요. 네트워크를 확인하고 잠시 뒤에 다시 시도해 주세요. ${KEEP}`)
      }
      let body = null
      try {
        body = await boundedJson(res, LIMITS.output)
      } catch (e) {
        if (signal.aborted) throw new CoachError(499, "cancelled", "요청을 취소했어요.")
        if (e?.name === "TimeoutError") throw new CoachError(504, "timeout", `AI Gateway 응답이 늦어 처리를 멈췄어요. ${KEEP}`)
        if (res.ok) throw invalidOutput()
      }
      if (!res.ok) {
        const error = classifyGatewayError(res.status, body)
        error.retryAfter = retryAfterSeconds(res.headers)
        throw error
      }
      return parseGatewayResponse(body)
    },
  }
}
