// Recorded audio only: self-hosted transcription, followed by browser-side measurements.
import { analyzeTranscript, analyzeFillers } from "./analysis.js"
import { planChunks, transcribeChunks, MAX_DURATION_SEC } from "./importer.js"
import { TARGET_RATE } from "./wav.js"

function unavailable(status, detail, segments = []) {
  return { status, detail, segments, transcript: { status, items: [], windows: [], fillers: { status, reason: detail, count: null, types: [], items: [] } }, fillers: null }
}

export async function analyzeRecordedSpeech({ samples, sampleRate, durationSec, enabled = true, fetchFn = fetch, signal, onProgress = () => {} }) {
  if (!enabled) return unavailable("off", "자체 AI 전사를 꺼서 속도와 군말은 측정하지 않았어요.")
  if (!samples?.length || durationSec <= 0) return unavailable("no-audio", "전사할 녹음이 없어서 속도와 군말은 측정하지 않았어요.")
  if (sampleRate !== TARGET_RATE) return unavailable("error", "녹음 형식을 확인하지 못해 전사를 하지 않았어요. 녹음과 기본 결과는 보존돼요.")
  if (samples.length / sampleRate > MAX_DURATION_SEC) return unavailable("limit", "자체 AI 전사는 30분 이하 녹음만 처리해요. 녹음과 기본 결과는 보존돼요.")
  try {
    const response = await fetchFn("/api/model-status", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) })
    if (!response.ok) return unavailable("error", "자체 AI 연결 상태를 확인하지 못했어요. 녹음과 기본 결과는 보존돼요.")
    const state = await response.json()
    if (!state.transcriptionConfigured || state.runtime?.transcriptionReady === false) return unavailable("not-configured", state.transcription?.provider === "ai-gateway" ? "AI Gateway 음성 전사가 설정되지 않았어요(서버의 AI_GATEWAY_API_KEY 확인). 녹음과 기본 결과는 보존돼요." : "자체 음성 전사 서버가 준비되지 않았어요. 녹음과 기본 결과는 보존돼요.")
    if (signal?.aborted) throw signal.reason
    const chunks = planChunks(samples, sampleRate)
    onProgress(0, chunks.length)
    const result = await transcribeChunks(samples, chunks, { fetchFn, concurrency: 1, signal, onProgress })
    if (signal?.aborted) throw signal.reason
    const segments = result.segments.filter(s => s.startSec < durationSec).map(s => ({ ...s, endSec: Math.min(s.endSec, durationSec) }))
    if (result.status !== "ok") return unavailable(result.status === "partial" ? "partial" : result.status, result.status === "partial" ? "일부 소리 조각을 전사하지 못했어요. 인식된 글만 보존하고 전체 속도·군말 수치는 표시하지 않았어요." : result.message || "자체 AI 전사를 완료하지 못했어요. 녹음과 기본 결과는 보존돼요.", segments)
    const transcript = analyzeTranscript(segments, durationSec)
    if (transcript.status !== "ok") return unavailable("no-text", "자체 AI가 인식한 말이 없어 속도와 군말을 측정하지 않았어요.", segments)
    return { status: "ok", detail: `녹음 소리만 ${state.transcription?.provider === "ai-gateway" ? "주최 측 AI Gateway로" : "자체 AI로"} 전사했어요. 군말과 속도는 인식된 글을 바탕으로 계산한 값이며, 누락·오인식이 있을 수 있어요.`, segments, transcript, fillers: analyzeFillers(segments) }
  } catch (error) {
    return unavailable(signal?.aborted ? "cancelled" : "error", signal?.aborted ? "자체 AI 전사를 취소했어요. 녹음과 기본 결과는 보존돼요." : "자체 AI 전사에 연결하지 못했어요. 녹음과 기본 결과는 보존돼요.")
  }
}
