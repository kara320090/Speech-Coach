// Vercel AI Gateway 전사(google/gemini-3.5-transcribe 기본). 공식 문서:
// https://vercel.com/docs/ai-gateway/modalities/speech-to-text (REST: POST /v4/ai/transcription-model,
// ai-model-id·ai-gateway-protocol-version·ai-transcription-model-specification-version 머리, base64 audio JSON, 응답 { text, segments, language, durationInSeconds }).
// 기존 자체 전사와 같은 입력(16kHz 모노 WAV 조각)·출력({ text, segments: [{ text, startSecond, endSecond }] }) 계약을 지킨다.
// 키는 Authorization 머리로만 보내고 소리·글·키를 로그에 남기지 않는다. 재시도·다른 모델 대체 없음.
import { createHash } from "node:crypto"
import { boundedJson } from "./local-coach.js"
import { cleanSegments } from "./local-transcribe.js"
import { DEFAULT_GATEWAY_TRANSCRIBE_MODEL, GATEWAY_BASE_URL, classifyGatewayError, validGatewayModel } from "./gateway-client.js"

const fail = (status, error, message) => ({ status, body: { error, message } })

export function validWav(body) {
  return body.length > 44 && body.toString("latin1", 0, 4) === "RIFF" && body.toString("latin1", 8, 12) === "WAVE" && body.readUInt16LE(20) === 1 && body.readUInt16LE(22) === 1 && body.readUInt32LE(24) === 16000 && body.readUInt16LE(34) === 16 && body.toString("latin1", 36, 40) === "data" && body.readUInt32LE(40) === body.length - 44 && body.length % 2 === 0
}

export function createGatewayTranscriber({ env = {}, fetchImpl = fetch, baseUrl = GATEWAY_BASE_URL } = {}) {
  const apiKey = String(env.AI_GATEWAY_API_KEY || "").trim()
  const model = String(env.AI_GATEWAY_TRANSCRIBE_MODEL || DEFAULT_GATEWAY_TRANSCRIBE_MODEL).trim()
  const modelOk = validGatewayModel(model)
  // 서버가 켜져 있는 동안 전사할 수 있는 소리 길이의 합(메모리 기준, 재시작 시 초기화 — 예산을 완전히 보장하지 않음)
  const total = Number(env.TRANSCRIBE_TOTAL_SECONDS) > 0 ? Number(env.TRANSCRIBE_TOTAL_SECONDS) : 1800
  const timeoutMs = Math.min(110_000, Math.max(5_000, Number(env.AI_GATEWAY_TRANSCRIBE_TIMEOUT_MS) || 90_000))
  let usedSeconds = 0, active = 0, requests = 0, connection = "unverified", lastError = null, lastVerifiedAt = null
  const inFlight = new Map()

  async function call(body, seconds, signal) {
    let res
    try {
      res = await fetchImpl(`${baseUrl}/v4/ai/transcription-model`, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "ai-gateway-protocol-version": "0.0.1",
          "ai-transcription-model-specification-version": "4",
          "ai-model-id": model,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ audio: body.toString("base64"), mediaType: "audio/wav" }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      })
    } catch (e) {
      if (signal.aborted) return fail(499, "cancelled", "전사를 취소했어요.")
      if (e?.name === "TimeoutError") return fail(504, "timeout", "AI Gateway 전사 응답이 늦어 멈췄어요. 녹음과 기본 결과는 보존돼요.")
      return fail(503, "provider-unavailable", "AI Gateway 전사에 연결하지 못했어요. 녹음과 기본 결과는 보존돼요.")
    }
    let data = null
    try { data = await boundedJson(res) } catch { /* 본문 없음·너무 큼 */ }
    if (!res.ok) {
      const e = classifyGatewayError(res.status, data)
      if (["provider-auth", "provider-billing", "provider-model"].includes(e.code)) connection = "failed"
      lastError = { code: e.code, ...e.providerDetail, at: new Date().toISOString() }
      return fail(e.status, e.code, e.message)
    }
    if (typeof data?.text !== "string" || data.text.length > 12000) return fail(502, "invalid-output", "AI Gateway 전사 결과를 읽지 못했어요.")
    connection = "verified"; lastVerifiedAt = new Date().toISOString(); lastError = null
    // 모델이 준 구간만 그대로 쓰고, 조각 길이를 넘는 구간은 버린다(단어별 시간을 만들지 않음).
    let segments = cleanSegments(data.segments).filter((s) => s.endSecond <= seconds + 0.5)
    // Gateway 문서에서 timestamps는 선택 항목이다. 발화 시각을 만들어내지 않고 입력 조각의 범위만 표시한다.
    const timingPrecision = segments.length ? "segment" : "chunk"
    if (!segments.length && data.text.trim()) segments = [{ text: data.text.trim(), startSecond: 0, endSecond: seconds, timingPrecision: "chunk" }]
    return { status: 200, body: { text: data.text, segments, timingPrecision, language: typeof data.language === "string" ? data.language : null, durationInSeconds: seconds, processing: "external:ai-gateway" } }
  }

  return {
    provider: "ai-gateway",
    model,
    configured: Boolean(apiKey) && modelOk,
    status() {
      return { provider: "ai-gateway", model, keyConfigured: Boolean(apiKey), configured: Boolean(apiKey) && modelOk, connection, lastVerifiedAt, lastError, usage: { requests, seconds: Math.round(usedSeconds), limitSeconds: total } }
    },
    async run(body, signal) {
      if (!apiKey) return fail(503, "not-configured", "서버에 AI_GATEWAY_API_KEY가 없어 글자 변환을 쓸 수 없어요. 긴 침묵 찾기 등 로컬 분석은 계속할 수 있어요.")
      if (!modelOk) return fail(503, "invalid-model", "AI_GATEWAY_TRANSCRIBE_MODEL 값의 형식을 확인해 주세요.")
      if (connection === "failed") return fail(503, lastError?.code || "provider-failed", "AI Gateway 설정 문제가 확인돼 전사 요청을 보내지 않았어요. 서버 설정을 확인해 주세요.")
      if (!body) return fail(413, "too-large", "보낸 소리 조각이 너무 길어요.")
      if (!validWav(body)) return fail(415, "not-wav", "16kHz 모노 PCM WAV 소리 조각만 받을 수 있어요.")
      const seconds = (body.length - 44) / 32000
      // 같은 소리 조각이 처리 중이면 새로 부르지 않고 그 결과를 함께 쓴다.
      const key = createHash("sha256").update(body).digest("hex")
      if (inFlight.has(key)) return inFlight.get(key)
      if (usedSeconds + seconds > total) return fail(429, "budget", "이 서버의 누적 전사 길이 한도에 도달했어요.")
      if (active >= 2) return fail(429, "busy", "음성 처리가 진행 중이에요. 잠시 뒤 다시 시도해 주세요.")
      usedSeconds += seconds; active++; requests++
      const job = call(body, seconds, signal).then((r) => { if (r.status !== 200) usedSeconds -= seconds; return r }).finally(() => { active--; inFlight.delete(key) })
      inFlight.set(key, job)
      return job
    },
  }
}
