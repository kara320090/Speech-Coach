// 화면용 구간 흐름 도우미 검사(서버 API 형식 변환·적용 전 확인). 가상 대본만 쓴다.
import test from "node:test"
import assert from "node:assert/strict"
import { canApply, paragraphOf, pointFromItem, scriptVersionIdFor, sha256Hex, toSegments } from "../public/js/segment-flow.js"
import { splitScript } from "../server/script-align.js"

const SCRIPT = "안녕하세요. 가상의 도서관을 소개합니다.\n\n캐시는 최근 결과를 5분 동안 저장합니다. 같은 요청에 다시 씁니다.\n\n감사합니다."

test("toSegments: 저장된 전사(startSec/endSec)를 API 형식(startSecond/endSecond)으로, 잘못된 구간은 뺀다", () => {
  assert.deepEqual(toSegments([{ startSec: 1, endSec: 2, text: "안녕" }, { startSec: 3, endSec: 2, text: "거꾸로" }, { startSec: 4, endSec: 5, text: "  " }, null]), [{ startSecond: 1, endSecond: 2, text: "안녕" }])
  assert.deepEqual(toSegments(undefined), [])
})

test("pointFromItem: 검토 항목을 검토 지점으로, 모르는 관찰 종류는 section", () => {
  assert.deepEqual(pointFromItem({ id: "silence-1", type: "silence", startSec: 6.2, endSec: 10, measured: "4.2초" }), { id: "silence-1", startSecond: 6.2, endSecond: 10, observations: [{ type: "silence", measured: "4.2초" }] })
  assert.equal(pointFromItem({ id: "x y", type: "blink", startSec: 3 }).observations[0].type, "section")
  assert.equal(pointFromItem({ id: "x y", startSec: 3 }).id, "x-y")
})

test("paragraphOf: 확인한 문장이 속한 문단의 원문 범위", () => {
  const sentences = splitScript(SCRIPT)
  const p = paragraphOf(SCRIPT, sentences, "s4")
  assert.equal(p.text, "캐시는 최근 결과를 5분 동안 저장합니다. 같은 요청에 다시 씁니다.")
  assert.equal(SCRIPT.slice(p.start, p.end), p.text)
  assert.deepEqual(p.sentenceIds, ["s3", "s4"])
  assert.equal(paragraphOf(SCRIPT, sentences, "s99"), null)
})

test("scriptVersionIdFor·canApply: 같은 대본·같은 원문일 때만 적용 가능", async () => {
  const v = await scriptVersionIdFor(SCRIPT)
  assert.match(v, /^sv-[0-9a-f]{16}$/)
  assert.equal(v, await scriptVersionIdFor(SCRIPT))
  assert.notEqual(v, await scriptVersionIdFor(`${SCRIPT} `))
  const p = paragraphOf(SCRIPT, splitScript(SCRIPT), "s3")
  const apply = { baseScriptVersionId: v, start: p.start, end: p.end, originalSha256: await sha256Hex(p.text) }
  assert.equal(await canApply(SCRIPT, apply), true)
  assert.equal(await canApply(SCRIPT.replace("5분", "6분"), apply), false, "대본이 바뀌면 적용하지 않는다")
  assert.equal(await canApply(SCRIPT, { ...apply, originalSha256: "0".repeat(64) }), false)
  assert.equal(await canApply(SCRIPT, null), false)
})


test("toSegments preserves chunk timing for conservative alignment", () => {
  assert.deepEqual(toSegments([{ startSec: 20, endSec: 40, text: "음 발표", timingPrecision: "chunk" }]), [{ startSecond: 20, endSecond: 40, text: "음 발표", timingPrecision: "chunk" }])
})
