import test from "node:test"
import assert from "node:assert/strict"
import { analyzeFillers, analyzeGaze, buildReviewItems, windowMetrics } from "../public/js/analysis.js"
import { REASONS, expectedSentence, keywordsOf, practiceRange, splitSentences, suggestFor } from "../public/js/coach.js"
import { isGazeOff } from "../public/js/gaze.js"

test("군말: 음·어를 찾아 8초 안에 이어진 것끼리 묶고, 일반 낱말은 세지 않는다", () => {
  const segs = [
    { startSec: 0, endSec: 4, text: "음 오늘은 어 발표를" },
    { startSec: 6, endSec: 8, text: "음음 시작하겠습니다" },
    { startSec: 30, endSec: 32, text: "어 마지막으로 음악 이야기" },
  ]
  const f = analyzeFillers(segs)
  assert.equal(f.count, 4) // 음, 어, 음음, 어 — '음악'은 군말이 아니다
  assert.equal(f.items.length, 2)
  assert.equal(f.items[0].type, "filler")
  assert.match(f.items[0].title, /군말 3회/)
  assert.equal(f.items[0].startSec, 0) // 앞으로 1초 넓히되 0보다 작아지지 않는다
  assert.equal(f.times.length, 4)
})

test("시선: 1.5초 이상 벗어난 구간만 찾고, 판단 못 한 표본뿐이면 분석하지 않는다", () => {
  const samples = []
  for (let i = 0; i < 50; i++) samples.push({ t: i / 5, off: (i >= 10 && i < 20) || (i >= 30 && i < 34) })
  const g = analyzeGaze(samples, 10)
  assert.equal(g.status, "ok")
  assert.equal(g.segments.length, 1)
  assert.ok(Math.abs(g.segments[0].startSec - 2) < 0.01)
  assert.ok(Math.abs(g.offSec - 2) < 0.25)
  assert.equal(g.items[0].type, "gaze")
  assert.equal(analyzeGaze([{ t: 0, off: null }, { t: 1, off: null }], 2).status, "off")
  // 끝까지 벗어난 채로 끝나면 녹화 끝까지를 구간으로 본다
  assert.equal(analyzeGaze([{ t: 0, off: false }, { t: 1, off: true }, { t: 2, off: true }], 4).segments[0].endSec, 4)
})

test("시선 판단: 정면 얼굴은 화면을 봄, 크게 돌린 얼굴·얼굴 없음은 벗어남", () => {
  const face = (noseX) => {
    const lm = []
    lm[33] = { x: 0.4, y: 0.4 }
    lm[263] = { x: 0.6, y: 0.4 }
    lm[1] = { x: noseX, y: 0.5 }
    lm[152] = { x: 0.5, y: 0.7 }
    return lm
  }
  assert.equal(isGazeOff(face(0.5)), false)
  assert.equal(isGazeOff(face(0.43)), true)
  assert.equal(isGazeOff(undefined), true)
})

test("검토 구간에 군말·시선 이탈이 시간 순으로 함께 들어간다", () => {
  const items = buildReviewItems({
    silence: null,
    transcript: null,
    fillers: { items: [{ type: "filler", title: "군말 2회", startSec: 5, endSec: 7, basis: "", measured: "" }] },
    gaze: { status: "ok", items: [{ type: "gaze", title: "시선 이탈", startSec: 2, endSec: 4, basis: "", measured: "" }] },
  })
  assert.deepEqual(items.map((x) => [x.id, x.type]), [[1, "gaze"], [2, "filler"]])
})

test("질문형 피드백: 이유마다 시험해 볼 조건을 최대 2개 제안하고, 모르는 이유도 선택지가 있다", () => {
  for (const r of REASONS) {
    const s = suggestFor(r)
    assert.ok(s.length >= 1 && s.length <= 2, r)
  }
  assert.deepEqual(suggestFor("시간 신경 쓰임"), ["progress"])
  assert.ok(REASONS.includes("모르겠어요"))
  assert.equal(REASONS.includes("긴장") && REASONS[0] !== "긴장", true) // 긴장을 기본 답으로 두지 않는다
})

test("대본: 문장 나누기와 핵심어 카드", () => {
  const s = splitSentences("안녕하세요. 오늘은 발표를 합니다!\n감사합니다")
  assert.deepEqual(s, ["안녕하세요.", "오늘은 발표를 합니다!", "감사합니다"])
  // 조사를 떼고 긴 낱말 3개를 원래 순서대로
  assert.equal(keywordsOf("핵심어 카드로 다음 문장을 떠올립니다."), "핵심어 · 카드 · 떠올립니다")
})

test("구간 다시 연습: 앞뒤 한 문장을 포함한 범위와 목표 시간(최소 10초)을 정한다", () => {
  const sentences = ["가".repeat(10), "나".repeat(10), "다".repeat(10), "라".repeat(10), "마".repeat(10)]
  const r = practiceRange({ sentences, item: { startSec: 50, endSec: 54 }, totalSec: 100, targetSec: 100 })
  assert.deepEqual(r.range, [1, 3])
  assert.equal(r.targetSec, 60)
  assert.equal(practiceRange({ sentences: [], item: { startSec: 1, endSec: 2 }, totalSec: 10, targetSec: 10 }).range, null)
  assert.equal(expectedSentence(0, 30, [1, 3]), 1)
  assert.equal(expectedSentence(29, 30, [1, 3]), 3)
  assert.equal(expectedSentence(999, 30, [1, 3]), 3)
})

test("전후 비교 수치: 구간 안의 속도·군말·침묵·시선 비율, 측정 못 한 값은 null", () => {
  const session = {
    media: { speech: "ok" },
    transcript: [{ startSec: 0, endSec: 10, text: "가".repeat(50) }],
    analysis: {
      silence: { status: "ok" },
      items: [{ type: "silence", startSec: 12, endSec: 16 }],
      fillers: { times: [3, 4, 25] },
      gaze: { status: "ok", segments: [{ startSec: 5, endSec: 10 }] },
    },
  }
  const m = windowMetrics(session, 0, 20)
  assert.equal(m.rate, 150) // 50음절 ÷ 20초 × 60
  assert.equal(m.fillersPerMin, 6) // 2회 ÷ 20초
  assert.equal(m.pauses, 1)
  assert.equal(m.gazePct, 25)
  const none = windowMetrics({ media: { speech: "off" }, transcript: [], analysis: { gaze: { status: "off" } } }, 0, 10)
  assert.deepEqual(none, { rate: null, fillersPerMin: null, pauses: null, gazePct: null })
})
