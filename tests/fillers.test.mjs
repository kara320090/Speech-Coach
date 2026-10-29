import test from "node:test"
import assert from "node:assert/strict"
import { analyzeFillers } from "../public/js/fillers.js"
import { analyzeTranscript, buildReviewItems } from "../public/js/analysis.js"

test("filler candidates match full tokens, punctuation, and stretched um/uh", () => {
  const f = analyzeFillers([{ startSec: 0, endSec: 10, text: "음, 어… 음음 어어 그러니까 음악 어머니 저장 이제 UM uh" }], 10)
  assert.equal(f.count, 8)
  assert.deepEqual(f.types.find((x) => x.word === "음"), { word: "음", count: 2 })
  assert.equal(f.types.some((x) => x.word === "음악"), false)
  assert.equal(f.items[0].startSec, 0); assert.equal(f.items[0].endSec, 10)
})
test("no text is unavailable, text without candidates is measured zero", () => {
  assert.equal(analyzeFillers([], 10).count, null)
  assert.equal(analyzeFillers([{ text: "음", startSec: NaN, endSec: 1 }], 10).count, null)
  assert.equal(analyzeFillers([{ text: "음악 어머니", startSec: 0, endSec: 2 }], 10).count, 0)
})
test("transcribed candidate counts retain type, evidence and seekable segment range", () => {
  const t = analyzeTranscript([{ startSec: 5, endSec: 8, text: "음 그 음 발표" }], 10)
  assert.equal(t.fillers.count, 3)
  const item = buildReviewItems({ transcript: t }).find((x) => x.type === "filler")
  assert.equal(item.startSec, 5); assert.equal(item.endSec, 8)
  assert.match(item.basis, /정확한 시각이 아니/); assert.match(item.measured, /“음” 2회/)
})
