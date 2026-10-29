import test from "node:test"
import assert from "node:assert/strict"
import {
  analyzeSilence, analyzeTranscript, buildReviewItems, classifyResult, compareSessions, countSyllables, liveRate, tokenize,
} from "../public/js/analysis.js"
import { Decimator, encodeWavBytes, parseWavBytes, concatFloat32 } from "../public/js/wav.js"

const RATE = 16000
/** 구간별로 소리(사인파)나 무음을 이어 붙인 합성 신호. parts = [[초, 진폭], ...] */
function synth(parts) {
  const chunks = parts.map(([sec, amp]) => {
    const a = new Float32Array(Math.round(sec * RATE))
    for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE)
    return a
  })
  return concatFloat32(chunks)
}

test("목표와의 차이: 초과·일찍 끝남·같음·허용 오차 안", () => {
  assert.deepEqual(classifyResult(80, 60, 0), { diffSec: 20, kind: "over", label: "목표보다 20초 초과했어요" })
  assert.equal(classifyResult(40, 60, 0).kind, "early")
  assert.equal(classifyResult(40, 60, 0).label, "목표보다 20초 일찍 끝났어요")
  assert.equal(classifyResult(60.9, 60, 0).kind, "exact") // 화면에 표시하는 정수 초 기준
  const w = classifyResult(65, 60, 10)
  assert.equal(w.kind, "within")
  assert.match(w.label, /허용 오차\(±10초\) 안/)
  assert.equal(classifyResult(75, 60, 10).kind, "over")
})

test("긴 침묵: 위치와 길이를 찾는다", () => {
  const s = synth([[4, 0.3], [5, 0], [3, 0.3]])
  const r = analyzeSilence(s, RATE)
  assert.equal(r.status, "ok")
  assert.equal(r.segments.length, 1)
  assert.ok(Math.abs(r.segments[0].startSec - 4) < 0.2, `start ${r.segments[0].startSec}`)
  assert.ok(Math.abs(r.segments[0].lengthSec - 5) < 0.3)
})

test("긴 침묵: 기준 시간보다 짧은 쉼은 표시하지 않는다", () => {
  const r = analyzeSilence(synth([[4, 0.3], [2, 0], [4, 0.3]]), RATE)
  assert.equal(r.segments.length, 0)
})

test("긴 침묵: 소리가 전혀 없으면 침묵 구간 대신 '소리 없음'으로 처리한다", () => {
  const r = analyzeSilence(new Float32Array(RATE * 10), RATE)
  assert.equal(r.status, "no-signal")
  assert.equal(r.segments.length, 0)
})

test("긴 침묵: 너무 짧은 녹음은 분석하지 않는다", () => {
  assert.equal(analyzeSilence(synth([[0.5, 0.3]]), RATE).status, "too-short")
})

test("음절 수와 어절 나누기", () => {
  assert.equal(countSyllables("안녕하세요, abc 123!"), 5)
  assert.deepEqual(tokenize("그, 그러니까 말이죠!"), ["그", "그러니까", "말이죠"])
})

test("실시간 속도: 초반에는 측정 중, 이후에는 최근 구간의 분당 음절", () => {
  const segs = [{ startSec: 0, endSec: 20, text: "가".repeat(60) }]
  assert.equal(liveRate(segs, 5).status, "measuring")
  const r = liveRate(segs, 20)
  assert.equal(r.status, "ok")
  assert.equal(r.rate, 180)
})

test("속도 변화: 평균보다 30% 넘게 빠른 구간을 찾는다", () => {
  // 10초마다 30음절(180/분)씩, 30~40초만 60음절(360/분)
  const segs = []
  for (let i = 0; i < 6; i++) segs.push({ startSec: i * 10, endSec: i * 10 + 10, text: "가".repeat(i === 3 ? 60 : 30) })
  const r = analyzeTranscript(segs, 60)
  assert.equal(r.status, "ok")
  assert.equal(r.totalSyllables, 210)
  assert.equal(Math.round(r.overallRate), 210)
  const sp = r.items.filter((x) => x.type === "speed")
  assert.equal(sp.length, 1)
  assert.equal(sp[0].startSec, 30)
  assert.equal(sp[0].endSec, 40)
  assert.match(sp[0].title, /빨라진/)
  assert.match(sp[0].measured, /360음절\/분/)
})

test("속도 변화: 구간이 3개 미만이면 판단하지 않는다", () => {
  const r = analyzeTranscript([{ startSec: 0, endSec: 10, text: "가".repeat(30) }, { startSec: 10, endSec: 20, text: "가".repeat(60) }], 20)
  assert.equal(r.items.filter((x) => x.type === "speed").length, 0)
})

test("반복 표현: 이어서 반복, 30초 안 3회 이상 반복", () => {
  const segs = [
    { startSec: 0, endSec: 4, text: "그 그 그러니까 발표는" },
    { startSec: 10, endSec: 14, text: "음악 음악 이야기를 하고 음악 마무리" },
  ]
  const r = analyzeTranscript(segs, 20)
  const reps = r.items.filter((x) => x.type === "repeat")
  assert.ok(reps.some((x) => x.title.includes("이어서") && x.title.includes('"그"') && /2번/.test(x.basis)))
  assert.ok(reps.some((x) => x.title.includes('"음악"')))
})

test("글이 없으면 속도·반복 분석을 하지 않는다", () => {
  assert.equal(analyzeTranscript([], 30).status, "no-text")
  assert.equal(analyzeTranscript([{ startSec: 0, endSec: 3, text: "abc" }], 30).status, "no-text")
})

test("검토할 구간: 침묵·구간 시간 차이를 시간 순으로 모은다", () => {
  const silence = analyzeSilence(synth([[4, 0.3], [5, 0], [3, 0.3]]), RATE)
  const sectionRows = [
    { title: "도입", planSec: 5, startSec: 0, endSec: 9, actualSec: 9, diffSec: 4, status: "done" },
    { title: "본론", planSec: 5, startSec: 9, endSec: 12, actualSec: 3, diffSec: -2, status: "ended-during" },
    { title: "끝", planSec: 5, startSec: null, endSec: null, actualSec: null, diffSec: null, status: "not-started" },
  ]
  const items = buildReviewItems({ silence, transcript: null, sectionRows, toleranceSec: 0 })
  assert.deepEqual(items.map((x) => x.type), ["section", "silence", "section"])
  assert.ok(items.every((x, i) => i === 0 || items[i - 1].startSec <= x.startSec))
  assert.equal(items[0].measured, "계획 0:05, 실제 0:09 (+0:04)")
})

test("허용 오차 안의 구간 차이는 검토 구간으로 만들지 않는다", () => {
  const rows = [{ title: "a", planSec: 10, startSec: 0, endSec: 12, actualSec: 12, diffSec: 2, status: "done" }]
  assert.equal(buildReviewItems({ silence: null, transcript: null, sectionRows: rows, toleranceSec: 3 }).length, 0)
})

const sess = (total, diff, extra = {}) => ({
  totalSec: total,
  result: { diffSec: diff },
  media: { audio: "ok", speech: "off" },
  analysis: { items: [], transcript: null },
  sectionRows: [],
  ...extra,
})

test("비교: 측정값을 나란히 놓고, 측정 못 한 값은 비교 불가로 표시한다", () => {
  const rows = compareSessions(sess(70, 10), sess(62, 2))
  const total = rows.find((r) => r.label === "총 연습 시간")
  assert.deepEqual([total.prev, total.cur, total.delta], ["1:10", "1:02", "-0:08"])
  const speed = rows.find((r) => r.label.startsWith("평균 속도"))
  assert.match(speed.delta, /비교 불가/)
  assert.ok(rows.some((r) => r.label === "검토 구간: 긴 침묵" && r.delta === "+0개"))
  assert.ok(rows.every((r) => !/점수|개선율|%/.test(r.label + r.delta)))
})

test("비교: 소리를 기록하지 않은 연습은 검토 구간을 비교하지 않는다", () => {
  const rows = compareSessions(sess(70, 10, { media: { audio: "failed", speech: "off" } }), sess(62, 2))
  assert.match(rows.find((r) => r.label === "검토할 구간 수").delta, /비교 불가/)
})

test("WAV 변환과 줄이기", () => {
  const dec = new Decimator(48000, 16000)
  const input = new Float32Array(48000).fill(0.5)
  const out = concatFloat32([dec.push(input.subarray(0, 10000)), dec.push(input.subarray(10000))])
  assert.ok(Math.abs(out.length - 16000) <= 1)
  const wav = encodeWavBytes(out, 16000)
  const back = parseWavBytes(wav)
  assert.equal(back.sampleRate, 16000)
  assert.equal(back.samples.length, out.length)
  assert.ok(Math.abs(back.samples[100] - 0.5) < 0.001)
})
