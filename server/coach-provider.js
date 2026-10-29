// AI 공급자 선택. 기본(AI_PROVIDER 미설정·local): 코칭·전사는 자체 모델, 새 대본·도움 대화는 Gemini 직접 API(기존).
// AI_PROVIDER=gateway: 모든 AI 호출(코칭·구간 대화·문단 수정·새 대본·도움 대화·전사)을 주최 측 Vercel AI Gateway로 보낸다.
// 다른 값(예: 예전 gemini)은 기존처럼 자체 모델 코칭으로 둔다. 공급자·모델을 자동으로 바꾸지 않는다.
import { createLocalCoach } from "./local-coach.js"
import { createLocalTranscriber } from "./local-transcribe.js"
import { createGatewayClient, DEFAULT_GATEWAY_TEXT_MODEL } from "./gateway-client.js"
import { createGatewayTranscriber } from "./gateway-transcribe.js"
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from "./gemini-client.js"
import { createRemoteCoach, remoteLimits } from "./remote-coach.js"
import { generationSpec, GENERATION_PROMPT_VERSION } from "./script-generation.js"

const LOCAL_NOTICE = "분석·쉬운 표현 수정·질문·답변 검토는 직접 운영하는 자체 AI로 처리해요. 외부 AI 제공자에게는 보내지 않아요."
const GENERATION_NOTICE = "새 대본 만들기를 누르면 입력한 주제와 근거 자료만 Google Gemini API로 보내요. 기존 연습 답변·녹음·영상은 보내지 않아요."

export const usesGateway = (env = {}) => String(env.AI_PROVIDER || "").trim().toLowerCase() === "gateway"

const GATEWAY_LABEL = "AI Gateway"
const GATEWAY_DEST = "주최 측 Vercel AI Gateway(Google Gemini)"
/**
 * Gateway 텍스트 클라이언트와 상태 정보. 키는 AI_GATEWAY_API_KEY 서버 환경변수에서만 읽는다.
 * notice: 화면에 보여 줄 외부 처리 안내. 키·모델 오류는 configError로 돌려 생성 요청을 보내지 않는다.
 */
export function gatewayText(env, { timeoutMs = 55_000, notice, fetchImpl = fetch } = {}) {
  const model = String(env.AI_GATEWAY_TEXT_MODEL || DEFAULT_GATEWAY_TEXT_MODEL).trim()
  const apiKey = String(env.AI_GATEWAY_API_KEY || "").trim()
  const info = { provider: "ai-gateway", label: GATEWAY_LABEL, destination: GATEWAY_DEST, model, processing: "external:ai-gateway", processingNotice: notice, keyConfigured: Boolean(apiKey) }
  let client = null
  if (!apiKey) info.configError = { reason: "not-configured", message: "서버에 AI_GATEWAY_API_KEY가 설정되지 않아 AI 기능을 쓸 수 없어요. 자료 저장·직접 수정·기본 연습은 계속할 수 있어요." }
  else {
    try { client = createGatewayClient({ apiKey, model, timeoutMs, fetchImpl }) }
    catch { info.configError = { reason: "invalid-model", message: "AI_GATEWAY_TEXT_MODEL 값의 형식(예: google/gemini-3.8-flash)을 확인해 주세요." } }
  }
  return { client, info }
}
const gatewayTimeout = (env, fallback) => Math.min(110_000, Math.max(5_000, Number(env.AI_GATEWAY_TIMEOUT_MS) || fallback))

/** /api/transcribe 공급자. Gateway 모드면 팀원 PC·자체 모델 없이 Gateway 전사를 쓴다. */
export function createTranscriber({ env = {}, fetchImpl = fetch } = {}) {
  if (usesGateway(env)) return createGatewayTranscriber({ env, fetchImpl })
  const local = createLocalTranscriber({ env, fetchImpl })
  return { provider: "local", ...local, status: () => ({ provider: "local", configured: local.configured }) }
}

export function createCoach({ env = {}, fetchImpl = fetch } = {}) {
  if (usesGateway(env)) {
    // 기존 자체 모델 코칭과 같은 입력 검사·프롬프트·인용/수치 검증(local-coach 규칙)을 쓰고, 호출만 Gateway로 보낸다.
    const { client, info } = gatewayText(env, { timeoutMs: gatewayTimeout(env, 55_000), fetchImpl, notice: "분석·쉬운 표현 수정·질문·답변 검토를 누르면 그 텍스트를 주최 측 Vercel AI Gateway를 거쳐 Google Gemini로 보내 처리해요. 개인정보·비공개 자료는 넣지 말아 주세요." })
    const remote = createRemoteCoach({ client, info, limits: remoteLimits(env) })
    return { provider: "ai-gateway", ...remote }
  }
  const local = createLocalCoach({ env, fetchImpl })
  return {
    provider: "local",
    async status() { return { provider: "local", processingNotice: LOCAL_NOTICE, ...(await local.status()) } },
    run: (data, signal) => local.run(data, signal),
  }
}

export function createScriptGenerator({ env = {}, fetchImpl = fetch, now } = {}) {
  if (usesGateway(env)) {
    const { client, info } = gatewayText(env, { timeoutMs: gatewayTimeout(env, 55_000), fetchImpl, notice: "새 대본 만들기를 누르면 입력한 주제와 근거 자료만 주최 측 Vercel AI Gateway를 거쳐 Google Gemini로 보내요. 기존 연습 답변·녹음·영상은 보내지 않아요." })
    return createRemoteCoach({ client, info, limits: remoteLimits(env), spec: generationSpec, promptVersion: GENERATION_PROMPT_VERSION, ...(now && { now }) })
  }
  const model = String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim()
  const apiKey = String(env.GEMINI_API_KEY || "").trim()
  const timeoutMs = Math.min(60_000, Math.max(5_000, Number(env.GEMINI_TIMEOUT_MS) || 55_000))
  const info = { provider: "gemini", model, processing: "external:google-gemini", processingNotice: GENERATION_NOTICE, keyConfigured: Boolean(apiKey) }
  let client = null
  if (!apiKey) info.configError = { reason: "not-configured", message: "새 대본 생성용 GEMINI_API_KEY가 설정되지 않았어요. 자체 AI 이해 연습은 별도로 사용할 수 있어요." }
  else {
    try { client = createGeminiClient({ apiKey, model, timeoutMs, fetchImpl }) }
    catch { info.configError = { reason: "invalid-model", message: "새 대본 생성용 GEMINI_MODEL 형식을 확인해 주세요. 자체 AI 이해 연습은 별도로 사용할 수 있어요." } }
  }
  return createRemoteCoach({ client, info, limits: remoteLimits(env), spec: generationSpec, promptVersion: GENERATION_PROMPT_VERSION, ...(now && { now }) })
}
