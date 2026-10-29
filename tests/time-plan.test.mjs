import test from "node:test"
import assert from "node:assert/strict"
import { formatClock, formatSigned, formatKorean, parseDuration } from "../public/js/time.js"
import { parsePlan, planTotal, paceAt, sectionResults, planSignature } from "../public/js/plan.js"

test("시간 표기", () => {
  assert.equal(formatClock(0), "0:00")
  assert.equal(formatClock(65.9), "1:05")
  assert.equal(formatClock(-3), "0:00")
  assert.equal(formatSigned(12), "+0:12")
  assert.equal(formatSigned(-8), "-0:08")
  assert.equal(formatKorean(80), "1분 20초")
  assert.equal(formatKorean(-60), "1분")
  assert.equal(formatKorean(45), "45초")
})

test("길이 입력 해석", () => {
  assert.equal(parseDuration("2:30"), 150)
  assert.equal(parseDuration("2분"), 120)
  assert.equal(parseDuration("2분 30초"), 150)
  assert.equal(parseDuration("90초"), 90)
  assert.equal(parseDuration("2:75"), null)
  assert.equal(parseDuration("abc"), null)
  assert.equal(parseDuration("30"), null)
})

test("구간 계획 입력", () => {
  const { sections, errors } = parsePlan("도입 2:00\n본론, 3분 30초\n\n마무리 45초\n")
  assert.deepEqual(sections, [
    { title: "도입", planSec: 120 },
    { title: "본론", planSec: 210 },
    { title: "마무리", planSec: 45 },
  ])
  assert.equal(errors.length, 0)
  assert.equal(planTotal(sections), 375)
  assert.equal(planSignature(sections), "도입|120;본론|210;마무리|45")
})

test("구간 계획 입력 오류는 줄 번호와 함께 알린다", () => {
  const { sections, errors } = parsePlan("도입 2:00\n본론\n3:00\n끝 0초")
  assert.equal(sections.length, 1)
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4])
})

test("진행 판단: 구간 계획이 없으면 판단하지 않는다", () => {
  const p = paceAt(30, [], [])
  assert.equal(p.known, false)
  assert.match(p.reason, /판단하지 않아요/)
})

test("진행 판단: 구간 계획과 직접 누른 시점으로만 비교한다", () => {
  const sections = [{ title: "도입", planSec: 60 }, { title: "본론", planSec: 120 }]
  let p = paceAt(70, sections, [])
  assert.equal(p.title, "도입")
  assert.equal(Math.round(p.overBy), 10)
  p = paceAt(100, sections, [75])
  assert.equal(p.title, "본론")
  assert.equal(Math.round(p.inSection), 25)
  assert.equal(Math.round(p.driftSec), 15)
  p = paceAt(200, sections, [75, 190])
  assert.equal(p.finished, true)
})

test("구간 결과: 끝낸 구간·종료 때 진행 중이던 구간·시작 못 한 구간", () => {
  const sections = [{ title: "a", planSec: 10 }, { title: "b", planSec: 10 }, { title: "c", planSec: 10 }]
  const rows = sectionResults(sections, [12], 25)
  assert.deepEqual(rows.map((r) => [r.status, r.actualSec, r.diffSec]), [
    ["done", 12, 2],
    ["ended-during", 13, 3],
    ["not-started", null, null],
  ])
  assert.equal(rows[1].startSec, 12)
  assert.equal(rows[1].endSec, 25)
})
