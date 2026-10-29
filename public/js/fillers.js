// 전사에 실제로 남은 독립 토큰만 센다. 문맥상 필요한 표현도 포함될 수 있어 항상 '후보'라고 표시한다.
export const FILLER_WORDS = Object.freeze(["음", "어", "으음", "저", "그", "저기", "그니까", "그러니까", "뭐", "이제", "약간", "사실", "um", "uh"])
const lexicon = new Set(FILLER_WORDS)
export function analyzeFillers(segments, durationSec) {
  const byType = new Map(), items = []
  let validSegments = 0
  for (const s of segments || []) {
    if (typeof s.text !== "string" || !Number.isFinite(s.startSec) || !Number.isFinite(s.endSec) || s.startSec < 0 || s.endSec < s.startSec || s.endSec > durationSec + 1) continue
    const tokens = s.text.match(/[\p{L}\p{N}]+/gu) || []
    if (!tokens.length) continue
    validSegments++
    const local = new Map()
    tokens.forEach((token) => {
      let word = token.toLowerCase()
      if (/^음+$/.test(word)) word = "음"
      if (/^어+$/.test(word)) word = "어"
      if (!lexicon.has(word)) return
      byType.set(word, (byType.get(word) || 0) + 1)
      local.set(word, (local.get(word) || 0) + 1)
    })
    if (local.size) {
      const counts = [...local].map(([word, count]) => `“${word}” ${count}회`).join(", ")
      items.push({ type: "filler", title: "군말 후보가 포함된 구간", startSec: s.startSec, endSec: Math.min(durationSec, s.endSec),
        measured: counts, basis: `인식된 글의 독립 토큰과 사전 일치로 집계했어요. 위치는 해당 전사 구간 전체이며 단어의 정확한 시각이 아니에요. 필요한 표현인지 재생해서 확인해 주세요.` })
    }
  }
  const types = [...byType].map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
  return { status: validSegments && durationSec > 0 ? "ok" : "no-text", count: validSegments ? types.reduce((n, x) => n + x.count, 0) : null, types, items, version: 1 }
}
