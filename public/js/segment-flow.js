// 검토 구간 → 대본 위치 확인 → 자체 AI 구간 대화 → 문단 수정안을 잇는 화면용 도우미.
// 서버 API: /api/scripts/align, /api/coach/segment, /api/scripts/revise-segment (docs/*-api.md).
// 서버는 대본·기록을 바꾸지 않으므로, 적용 전 원문 확인과 새 버전 만들기는 화면(support-page.js)이 맡는다.

const OBS_TYPES = ["silence", "repeat", "filler", "gaze", "speed", "section"]

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** 같은 대본이면 같은 버전 ID(대본 내용 해시 앞 16자리). 대본이 바뀌면 ID도 바뀐다. */
export async function scriptVersionIdFor(script) {
  return `sv-${(await sha256Hex(script)).slice(0, 16)}`
}

/** 저장된 전사({ startSec, endSec, text })를 /api/transcribe·/api/scripts/align 형식으로 바꾼다. */
export function toSegments(transcript) {
  return (Array.isArray(transcript) ? transcript : [])
    .filter((s) => s && typeof s.text === "string" && s.text.trim() && Number.isFinite(s.startSec) && Number.isFinite(s.endSec) && s.endSec >= s.startSec && s.startSec >= 0)
    .slice(0, 2000)
    .map((s) => ({ startSecond: s.startSec, endSecond: s.endSec, text: s.text.slice(0, 1000) }))
}

/** 결과 화면의 검토 항목을 검토 지점으로. 관찰 사유 이름이 다르면 '구간 시간'으로 둔다. */
export function pointFromItem(item) {
  const start = Math.max(0, Number(item.startSec) || 0)
  const end = Math.max(start, Number(item.endSec) || start)
  return { id: String(item.id).replace(/[^\w.:-]/g, "-").slice(0, 80), startSecond: start, endSecond: end, observations: [{ type: OBS_TYPES.includes(item.type) ? item.type : "section", measured: String(item.measured || "").slice(0, 80) }] }
}

/** align 응답의 sentences에서 문장이 속한 문단(빈 줄 기준)의 원문 범위. */
export function paragraphOf(script, sentences, sentenceId) {
  const s = sentences.find((x) => x.id === sentenceId)
  if (!s) return null
  const same = sentences.filter((x) => x.paragraphIndex === s.paragraphIndex)
  const start = same[0].start, end = same[same.length - 1].end
  return { paragraphIndex: s.paragraphIndex, start, end, text: script.slice(start, end), sentenceIds: same.map((x) => x.id) }
}

async function post(path, body, signal) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal })
  let data = null
  try { data = await res.json() } catch { /* 본문 없음 */ }
  if (!res.ok) throw Object.assign(new Error(data?.message || "요청을 처리하지 못했어요. 대본과 답변은 그대로예요."), { code: data?.error, status: res.status })
  return data
}

export const alignPoint = ({ script, scriptVersionId, segments, point }, signal) =>
  post("/api/scripts/align", { script, scriptVersionId, segments, points: [{ id: point.id, startSecond: point.startSecond, endSecond: point.endSecond }] }, signal)

/** 구간 대화 요청. history는 서버가 준 message 객체와 사용자 항목을 순서대로 담는다. */
export const segmentStep = (ctx, history, action, signal) =>
  post("/api/coach/segment", {
    requestId: crypto.randomUUID(),
    practiceId: ctx.practiceId,
    scriptVersionId: ctx.scriptVersionId,
    script: ctx.script,
    sources: ctx.sources,
    point: ctx.point,
    selection: ctx.selection,
    transcript: ctx.transcript,
    history,
    action,
  }, signal)

export const userTurn = (ctx, questionKey, action) => ({ role: "user", questionKey, practiceId: ctx.practiceId, pointId: ctx.point.id, scriptVersionId: ctx.scriptVersionId, action: action.type, ...(action.reason && { reason: action.reason }), ...(action.text && { text: action.text }) })

/** 문단 수정 요청(사용자가 버튼을 눌렀을 때만). */
export const reviseParagraph = (ctx, { paragraph, summary, history, focus = [], text = "" }, signal) =>
  post("/api/scripts/revise-segment", {
    requestId: crypto.randomUUID(),
    practiceId: ctx.practiceId,
    scriptVersionId: ctx.scriptVersionId,
    point: { id: ctx.point.id },
    script: ctx.script,
    sources: ctx.sources,
    target: { paragraphIndex: paragraph.paragraphIndex, start: paragraph.start, end: paragraph.end, text: paragraph.text, confirmation: ctx.selection.confirmation },
    coaching: { summary: summary ? { observations: summary.observations, location: summary.location, userReports: summary.userReports } : {}, history: history.slice(-16) },
    request: { explicit: true, ...(focus.length && { focus }), ...(text && { text }) },
  }, signal)

/** 적용 직전 확인: 지금 대본이 수정 요청 때와 같고 대상 범위 원문이 그대로인지. */
export async function canApply(currentScript, apply) {
  if (!apply) return false
  if ((await scriptVersionIdFor(currentScript)) !== apply.baseScriptVersionId) return false
  return (await sha256Hex(currentScript.slice(apply.start, apply.end))) === apply.originalSha256
}
