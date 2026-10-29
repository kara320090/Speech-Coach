// /api/coach 공급자 선택. AI_PROVIDER=local(기본, 직접 운영하는 모델) 또는 gemini(Google Gemini API).
// 잘못된 값이면 다른 공급자로 바꾸지 않고 '설정 오류'로 표시한다. Gemini 키는 GEMINI_API_KEY에서만 읽는다.
import { createLocalCoach } from "./local-coach.js"
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from "./gemini-client.js"
import { createRemoteCoach, remoteLimits } from "./remote-coach.js"

export const PROVIDERS = ["local", "gemini"]

const LOCAL_NOTICE = "분석 버튼을 누른 텍스트만 직접 운영하는 모델 서버로 보내요. 외부 AI 제공자에게는 보내지 않아요."
const GEMINI_NOTICE = "분석 버튼을 누른 대본·근거 자료·답변 텍스트는 Google Gemini API로 보내 처리해요. 개인정보·비공개 자료는 넣지 말아 주세요."

export function providerName(env = {}) {
  return String(env.AI_PROVIDER || "local").trim().toLowerCase()
}

export function createCoach({ env = {}, fetchImpl = fetch, now } = {}) {
  const name = providerName(env)
  if (name === "local") {
    const local = createLocalCoach({ env, fetchImpl })
    return {
      provider: "local",
      async status() {
        return { provider: "local", processingNotice: LOCAL_NOTICE, ...(await local.status()) }
      },
      run: (data, signal) => local.run(data, signal),
    }
  }
  const limits = remoteLimits(env)
  if (name === "gemini") {
    const model = String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim()
    const apiKey = String(env.GEMINI_API_KEY || "").trim()
    const timeoutMs = Math.min(60_000, Math.max(5_000, Number(env.GEMINI_TIMEOUT_MS) || 30_000))
    const info = { provider: "gemini", model, processing: "external:google-gemini", processingNotice: GEMINI_NOTICE, keyConfigured: Boolean(apiKey) }
    let client = null
    if (!apiKey) info.configError = { reason: "not-configured", message: "서버에 GEMINI_API_KEY가 설정되지 않아 AI 기능을 쓸 수 없어요. 자료 저장·직접 수정·기본 연습은 계속할 수 있어요." }
    else {
      try {
        client = createGeminiClient({ apiKey, model, timeoutMs, fetchImpl })
      } catch {
        info.configError = { reason: "invalid-model", message: "GEMINI_MODEL 값의 형식이 올바르지 않아요. 서버 설정을 확인해 주세요." }
      }
    }
    return { provider: "gemini", ...createRemoteCoach({ client, info, limits, ...(now && { now }) }) }
  }
  // 알 수 없는 공급자: 아무 모델도 부르지 않는다.
  const info = { provider: name, model: null, processing: "none", processingNotice: "AI 공급자 설정이 올바르지 않아 텍스트를 어디에도 보내지 않아요.", keyConfigured: false, configError: { reason: "invalid-provider", message: `AI_PROVIDER 값(${name.slice(0, 20)})을 알 수 없어요. local 또는 gemini로 설정해 주세요. 자료 저장·직접 수정은 계속할 수 있어요.` } }
  return { provider: name, ...createRemoteCoach({ client: null, info, limits }) }
}
