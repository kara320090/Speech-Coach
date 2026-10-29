// Coaching always uses the self-hosted model, even with a legacy AI_PROVIDER=gemini setting.
// Only the separate /api/scripts/generate service can call Google.
import { createLocalCoach } from "./local-coach.js"
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from "./gemini-client.js"
import { createRemoteCoach, remoteLimits } from "./remote-coach.js"
import { generationSpec, GENERATION_PROMPT_VERSION } from "./script-generation.js"

const LOCAL_NOTICE = "분석·쉬운 표현 수정·질문·답변 검토는 직접 운영하는 자체 AI로 처리해요. 외부 AI 제공자에게는 보내지 않아요."
const GENERATION_NOTICE = "새 대본 만들기를 누르면 입력한 주제와 근거 자료만 Google Gemini API로 보내요. 기존 연습 답변·녹음·영상은 보내지 않아요."

export function createCoach({ env = {}, fetchImpl = fetch } = {}) {
  const local = createLocalCoach({ env, fetchImpl })
  return {
    provider: "local",
    async status() { return { provider: "local", processingNotice: LOCAL_NOTICE, ...(await local.status()) } },
    run: (data, signal) => local.run(data, signal),
  }
}

export function createScriptGenerator({ env = {}, fetchImpl = fetch, now } = {}) {
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
