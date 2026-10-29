import { localUrl, boundedJson } from "./local-coach.js"

export function cleanSegments(raw) {
  if (!Array.isArray(raw)) return []
  const number = v => typeof v === "number" || (typeof v === "string" && v.trim()) ? Number(v) : NaN
  return raw.map(s => ({ text: typeof s?.text === "string" ? s.text.trim() : "", startSecond: number(s?.startSecond ?? s?.start), endSecond: number(s?.endSecond ?? s?.end) }))
    .filter(s => s.text && Number.isFinite(s.startSecond) && Number.isFinite(s.endSecond) && s.startSecond >= 0 && s.endSecond >= s.startSecond)
    .sort((a, b) => a.startSecond - b.startSecond)
}

export function createLocalTranscriber({ env, fetchImpl = fetch }) {
  let usedSeconds = 0, active = 0, endpoint
  const total = Number(env.TRANSCRIBE_TOTAL_SECONDS) > 0 ? Number(env.TRANSCRIBE_TOTAL_SECONDS) : 3600
  try { endpoint = localUrl(env.LOCAL_STT_URL) } catch { endpoint = null }
  const fail = (status, error, message) => ({ status, body: { error, message } })
  return {
    configured: Boolean(endpoint),
    async run(body, signal) {
      if (!endpoint) return fail(503, "not-configured", "자체 음성 인식 모델이 연결되지 않았어요. 글자 변환 없이 로컬 분석을 계속할 수 있어요.")
      if (!body) return fail(413, "too-large", "보낸 소리 조각이 너무 길어요.")
      if (body.length <= 44 || body.toString("latin1", 0, 4) !== "RIFF" || body.toString("latin1", 8, 12) !== "WAVE" || body.readUInt16LE(20) !== 1 || body.readUInt16LE(22) !== 1 || body.readUInt32LE(24) !== 16000 || body.readUInt16LE(34) !== 16 || body.toString("latin1", 36, 40) !== "data" || body.readUInt32LE(40) !== body.length - 44 || body.length % 2) {
        return fail(415, "not-wav", "16kHz 모노 PCM WAV 소리 조각만 받을 수 있어요.")
      }
      const seconds = (body.length - 44) / 32000
      if (usedSeconds + seconds > total) return fail(429, "budget", "이 서버의 누적 전사 길이 한도에 도달했어요.")
      if (active >= 3) return fail(429, "busy", "음성 처리가 진행 중이에요. 잠시 뒤 다시 시도해 주세요.")
      usedSeconds += seconds; active++
      let completed = false
      try {
        const response = await fetchImpl(`${endpoint}/transcribe`, {
          method: "POST", redirect: "error", headers: { "Content-Type": "audio/wav" }, body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
        })
        if (!response.ok) return fail(response.status === 429 ? 429 : 502, "model-error", "자체 음성 인식 모델이 요청을 처리하지 못했어요.")
        const data = await boundedJson(response)
        if (typeof data?.text !== "string" || data.text.length > 12000) return fail(502, "invalid-output", "음성 인식 결과를 읽지 못했어요.")
        const segments = cleanSegments(data.segments).filter(s => s.endSecond <= seconds + 0.5)
        completed = true
        return { status: 200, body: { text: data.text, segments, language: typeof data.language === "string" ? data.language : null, durationInSeconds: seconds, processing: "self-hosted" } }
      } catch {
        return fail(502, "model-unreachable", "자체 음성 인식 모델에 연결하지 못했어요.")
      } finally {
        if (!completed) usedSeconds -= seconds
        active--
      }
    },
  }
}
