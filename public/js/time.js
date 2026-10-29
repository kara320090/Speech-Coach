// 시간 표시·입력 변환. 모든 값의 단위는 초(s)다.

export function pad2(n) {
  return String(n).padStart(2, "0")
}

/** 0:05, 12:30 같은 분:초 표기. 음수는 0으로 본다. */
export function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec + 1e-9))
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`
}

/** +0:12 / -0:08 처럼 부호가 있는 분:초. */
export function formatSigned(sec) {
  const r = Math.round(sec)
  return `${r < 0 ? "-" : "+"}${formatClock(Math.abs(r))}`
}

/** "1분 20초", "45초" 같은 말로 쓴 길이. */
export function formatKorean(sec) {
  const r = Math.round(Math.abs(sec))
  const m = Math.floor(r / 60)
  const s = r % 60
  if (m && s) return `${m}분 ${s}초`
  if (m) return `${m}분`
  return `${s}초`
}

/**
 * 사용자가 쓴 길이를 초로 바꾼다. 못 읽으면 null.
 * 지원: "2:30", "2분", "2분 30초", "90초"
 */
export function parseDuration(text) {
  const t = String(text ?? "").trim()
  let m = t.match(/^(\d+):([0-5]\d)$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  m = t.match(/^(\d+)\s*분(?:\s*(\d+)\s*초)?$/)
  if (m) return Number(m[1]) * 60 + Number(m[2] || 0)
  m = t.match(/^(\d+)\s*초$/)
  if (m) return Number(m[1])
  return null
}
