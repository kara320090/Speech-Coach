import test from "node:test"
import assert from "node:assert/strict"
import { planChunks, chunkSegments, transcribeChunks } from "../public/js/importer.js"

const R = 16000
/** 값이 amp인 소리를 sec초 만들되, quiet 구간(초)에는 거의 무음을 넣는다. */
function tone(sec, quiet = []) {
  const a = new Float32Array(Math.round(sec * R))
  for (let i = 0; i < a.length; i++) a[i] = Math.sin(i / 7) * 0.3
  for (const [s, e] of quiet) for (let i = Math.round(s * R); i < Math.round(e * R); i++) a[i] = 0
  return a
}

test("planChunks: 조각은 빈틈·겹침 없이 전체를 덮고, 가장 조용한 곳에서 자른다", () => {
  const samples = tone(65, [[22, 22.5], [43.2, 43.6]])
  const chunks = planChunks(samples, R)
  assert.equal(chunks[0].startIdx, 0)
  assert.equal(chunks.at(-1).endIdx, samples.length)
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].startIdx, chunks[i - 1].endIdx)
  assert.ok(chunks.length >= 3 && chunks.length <= 4, `조각 수 ${chunks.length}`)
  assert.ok(Math.abs(chunks[0].endSec - 22.25) < 0.2, `첫 자름 ${chunks[0].endSec}`)
  for (const c of chunks.slice(0, -1)) assert.ok(c.endSec - c.startSec >= 15 && c.endSec - c.startSec <= 25)
  assert.deepEqual(chunks.map((c) => c.index), chunks.map((_, i) => i))
})

test("planChunks: 짧은 소리는 한 조각, 빈 소리는 조각 없음", () => {
  assert.equal(planChunks(tone(8), R).length, 1)
  assert.equal(planChunks(new Float32Array(0), R).length, 0)
})

test("chunkSegments: 구간 정보는 파일 시간으로 옮기고, 없으면 조각 전체 한 개로 대신한다", () => {
  const chunk = { startSec: 40, endSec: 60 }
  assert.deepEqual(chunkSegments(chunk, { segments: [{ text: "가나다", startSecond: 1, endSecond: 3 }] }), [{ startSec: 41, endSec: 43, text: "가나다" }])
  assert.deepEqual(chunkSegments(chunk, { text: "전체 글", segments: [] }), [{ startSec: 40, endSec: 60, text: "전체 글", timingPrecision: "chunk" }])
  assert.deepEqual(chunkSegments(chunk, { text: "전체 글", segments: [{ text: "범위 밖", startSecond: 50, endSecond: 55 }] }), [{ startSec: 40, endSec: 60, text: "전체 글", timingPrecision: "chunk" }])
  assert.deepEqual(chunkSegments(chunk, {}), [])
})

const okRes = (body) => ({ ok: true, status: 200, json: async () => body })
const errRes = (status, body = {}) => ({ ok: false, status, json: async () => body })

test("chunkSegments: null/blank times are not zero; aliases sort and clamp to chunk", () => {
  const chunk = { startSec: 40, endSec: 60 }
  const result = chunkSegments(chunk, { text: "fallback", segments: [
    { text: "invalid", startSecond: null, endSecond: 2 },
    { text: "blank", startSecond: "", endSecond: 3 },
    { text: "last", start: "19", end: "20.5" },
    { text: "first", startSecond: 1, endSecond: 2 }, null,
  ] })
  assert.deepEqual(result, [{ startSec: 41, endSec: 42, text: "first" }, { startSec: 59, endSec: 60, text: "last" }])
})

test("transcribeChunks: 모든 조각이 성공하면 시간순 글 조각을 돌려주고 진행 상황을 알린다", async () => {
  const samples = tone(65)
  const chunks = planChunks(samples, R)
  let call = 0
  const progress = []
  const res = await transcribeChunks(samples, chunks, {
    fetchFn: async () => okRes({ text: `글${call++}`, segments: [] }),
    onProgress: (d, n) => progress.push([d, n]),
  })
  assert.equal(res.status, "ok")
  assert.equal(res.segments.length, chunks.length)
  assert.deepEqual(res.segments.map((s) => s.startSec), chunks.map((c) => c.startSec)) // 조각 순서대로
  assert.deepEqual(progress.at(-1), [chunks.length, chunks.length])
})

test("transcribeChunks: 실패한 조각은 자동 재시도하지 않고 partial로 알린다", async () => {
  const samples = tone(65)
  const chunks = planChunks(samples, R)
  let calls = 0
  const res = await transcribeChunks(samples, chunks, {
    concurrency: 1,
    fetchFn: async () => (calls++, errRes(502, { error: "gateway-error" })),
  })
  assert.equal(calls, chunks.length) // 조각마다 한 번만 전송
  assert.equal(res.status, "partial")
  assert.equal(res.failed.length, chunks.length)
  assert.match(res.message, /글자로 바꾸지 못했어요/)
})

test("transcribeChunks: 키 없음·한도·키 거부는 바로 멈추고 이유를 돌려준다", async () => {
  const samples = tone(65)
  const chunks = planChunks(samples, R)
  for (const [r, status] of [[errRes(503, { error: "not-configured", message: "키 없음" }), "not-configured"], [errRes(429, { error: "budget", message: "한도" }), "limit"], [errRes(502, { error: "gateway-auth", message: "키 거부" }), "error"]]) {
    let calls = 0
    const res = await transcribeChunks(samples, chunks, { concurrency: 1, fetchFn: async () => (calls++, r) })
    assert.equal(res.status, status)
    assert.equal(calls, 1)
    assert.ok(res.message)
  }
})
