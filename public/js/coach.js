// 질문형 피드백과 연습 조건. "잘못했다"고 판정하지 않고, 구간을 확인 → 그때 있었던 일 질문 → 바꿔 볼 연습 조건 제안 순서로 간다.
// 원인을 자동으로 추정하지 않는다. 사용자가 고른 이유에 맞춰 시험해 볼 조건만 제안한다(docs/coaching-design.md).

export const QUESTION_LIMIT = 3

export const CONDITIONS = {
  keywords: { label: "핵심어 카드", desc: "대본 대신 문장마다 핵심어만 보여줘요" },
  progress: { label: "진행 막대", desc: "목표 시간 대비 지금 어디쯤인지 막대로 보여줘요" },
  countdown: { label: "시작 전 호흡 3초", desc: "녹화 전에 3초 동안 숨을 고르고 시작해요" },
}

export const REASONS = ["다음 내용이 안 떠오름", "시간 신경 쓰임", "긴장", "대본·메모를 봄", "모르겠어요", "직접 입력"]

const SUGGEST = {
  "다음 내용이 안 떠오름": ["keywords", "progress"],
  "시간 신경 쓰임": ["progress"],
  긴장: ["countdown", "keywords"],
  "대본·메모를 봄": ["keywords"],
  모르겠어요: ["keywords", "progress"],
  "직접 입력": ["keywords", "progress"],
}

/** 고른 이유에 맞는 연습 조건 키 목록(최대 2개). */
export function suggestFor(reason) {
  return (SUGGEST[reason] || []).slice(0, 2)
}

/** 대본을 문장 단위(마침표·물음표·느낌표 뒤 공백, 줄바꿈)로 나눈다. */
export function splitSentences(script) {
  return String(script || "")
    .split(/(?<=[.?!。])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

const PARTICLE = /(입니다|합니다|습니다|에서|으로|에게|은|는|이|가|을|를|로|와|과|도|의|에)$/

/** 문장에서 긴 낱말 3개를 원래 순서대로 뽑아 핵심어 카드로 보여 준다. */
export function keywordsOf(sentence) {
  const words = sentence
    .split(/\s+/)
    .map((w, i) => ({ w: w.replace(/[.,?!~…"'“”]/g, "").replace(PARTICLE, ""), i }))
    .filter((o) => o.w.length >= 2)
  const picked = words
    .slice()
    .sort((a, b) => b.w.length - a.w.length || a.i - b.i)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i)
  return picked.map((o) => o.w).join(" · ") || sentence
}

/**
 * 검토 구간이 대본의 어느 문장쯤인지 시간 비율로 어림잡아, 앞뒤 한 문장씩 포함한 연습 범위와 목표 시간을 정한다.
 * 실제 발화와 대본을 맞춰 본 결과가 아니라 어림값이라 화면에도 '약'으로 표시한다.
 */
export function practiceRange({ sentences, item, totalSec, targetSec }) {
  const n = sentences.length
  if (!n || totalSec <= 0) return { range: null, targetSec: Math.max(10, Math.round(item.endSec - item.startSec + 12)) }
  const mid = Math.floor((((item.startSec + item.endSec) / 2) / totalSec) * n)
  const i0 = Math.max(0, Math.min(n - 1, mid - 1))
  const i1 = Math.min(n - 1, Math.max(i0, mid + 1))
  const total = sentences.reduce((m, x) => m + x.length, 0) || 1
  const share = sentences.slice(i0, i1 + 1).reduce((m, x) => m + x.length, 0) / total
  return { range: [i0, i1], targetSec: Math.max(10, Math.round(targetSec * share)) }
}

/** 진행 막대용: 지금 시간에 맞춰 읽고 있어야 할 문장 번호(범위 안). */
export function expectedSentence(elapsedSec, targetSec, range) {
  const [a, b] = range
  const span = b - a + 1
  return Math.min(b, a + Math.floor((Math.max(0, elapsedSec) / Math.max(1, targetSec)) * span))
}
