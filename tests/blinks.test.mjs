import test from "node:test"
import assert from "node:assert/strict"
import { analyzeBlinks, blinkSample, BLINK_RULES } from "../public/js/blinks.js"
import { buildReviewItems } from "../public/js/analysis.js"

function series(seconds, closes = [], missing = [], wink = false) {
  return Array.from({ length: seconds * 20 }, (_, i) => {
    const sec = i / 20
    if (missing.some(([a, b]) => sec >= a && sec < b)) return { sec, left: null, right: null }
    const shut = closes.some(([a, b]) => sec >= a && sec < b)
    return { sec, left: shut ? 0.9 : 0.1, right: shut && !wink ? 0.9 : 0.1 }
  })
}

test("both eyes closing then opening counts once, not once per frame", () => {
  const b = analyzeBlinks(series(10, [[1, 1.2], [5, 5.25]]), 10)
  assert.equal(b.count, 2); assert.ok(Math.abs(b.rate - 12) < 1e-6)
  assert.ok(b.missingRatio < 1e-6); assert.equal(b.windows[0].count, 2)
  assert.equal(b.baselineAvailable, false)
})
test("wink, initially closed eyes, long closure and unfinished closure are not blinks", () => {
  assert.equal(analyzeBlinks(series(10, [[1, 1.2]], [], true), 10).count, 0)
  assert.equal(analyzeBlinks(series(10, [[0, 0.2], [2, 4], [9.9, 10]]), 10).count, 0)
})
test("missing face and gaps do not bridge a blink; rate uses valid time", () => {
  const b = analyzeBlinks(series(10, [[1, 1.25], [4, 4.2]], [[1.1, 1.2], [7, 9]]), 10)
  assert.equal(b.count, 1); assert.ok(b.missingRatio > 0.2 && b.missingRatio < 0.22)
  assert.ok(Math.abs(b.rate - 60 / b.observedSec) < 1e-6)
  const gap = series(10, [[1, 1.2]]).filter((x) => x.sec < 1.1 || x.sec > 1.5)
  assert.equal(analyzeBlinks(gap, 10).count, 0)
})
test("low coverage and short video produce no numeric count or rate", () => {
  for (const b of [analyzeBlinks(series(10, [], [[0, 4]]), 10), analyzeBlinks(series(4), 4), analyzeBlinks([], 10)]) {
    assert.equal(b.status, "unavailable"); assert.equal(b.count, null); assert.equal(b.rate, null)
    assert.equal(b.items.length, 0); assert.ok(b.reason)
  }
})
test("10 second bins use other bins as the baseline, including zero baseline", () => {
  const b = analyzeBlinks(series(30, [[11, 11.15], [13, 13.2], [15, 15.2]]), 30)
  assert.equal(b.count, 3); assert.equal(b.items.length, 1)
  assert.equal(b.items[0].startSec, 10); assert.equal(b.items[0].endSec, 20)
  assert.match(b.items[0].basis, /이번 영상/); assert.ok(!JSON.stringify(b).includes("Infinity"))
  const items = buildReviewItems({ blink: b })
  assert.equal(items[0].type, "blink"); assert.ok(items[0].measured && items[0].basis)
})
test("insufficient baseline, partial bins and a steady blink rate do not flag increases", () => {
  assert.equal(analyzeBlinks(series(20, [[1, 1.1], [3, 3.1], [5, 5.1]]), 20).items.length, 0)
  assert.equal(analyzeBlinks(series(31), 31).windows.at(-1).count, null)
  const closes = Array.from({ length: 15 }, (_, i) => [i * 2 + 0.5, i * 2 + 0.65])
  assert.equal(analyzeBlinks(series(30, closes), 30).items.length, 0)
})
test("invalid/multiple faces do not become zero-score valid faces", () => {
  const cat = [{ categoryName: "eyeBlinkLeft", score: 0.2 }, { categoryName: "eyeBlinkRight", score: 0.3 }]
  assert.deepEqual(blinkSample({ faceBlendshapes: [{ categories: cat }] }, 1), { sec: 1, left: 0.2, right: 0.3 })
  for (const faces of [[], [{ categories: cat }, { categories: cat }], [{ categories: [] }]]) assert.equal(blinkSample({ faceBlendshapes: faces }, 1).left, null)
  assert.equal(analyzeBlinks([{ sec: 0, left: NaN, right: 0 }], 10).count, null)
  assert.equal(analyzeBlinks([], Infinity).status, "unavailable")
})
test("duplicate timestamps cannot inflate observed coverage", () => {
  const frames = series(10)
  const b = analyzeBlinks(frames.flatMap((x) => [x, x]), 10)
  assert.ok(b.observedSec <= 10 + 1e-6)
  assert.equal(BLINK_RULES.sampleHz, 20)
})
