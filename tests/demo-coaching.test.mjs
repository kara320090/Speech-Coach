import test from "node:test"
import assert from "node:assert/strict"
import { DEMO, REASONS, freshDemo, chooseReason, allowExampleRevision, applyExampleRevision, restoreExampleOriginal, restoreDemoState } from "../public/js/demo-coaching.js"

test("demo reasons require a confirmed example location and never label a cause automatically", () => {
  const state = freshDemo()
  assert.equal(state.reason, ""); assert.equal(state.currentScript, DEMO.before)
  assert.throws(() => chooseReason(state, "meaning"))
  assert.throws(() => chooseReason({ ...state, locationConfirmed: true }, "diagnosis"))
  for (const reason of Object.keys(REASONS)) {
    const next = chooseReason({ ...state, locationConfirmed: true }, reason)
    assert.equal(next.reason, reason); assert.equal(next.consent, false)
    assert.equal(next.currentScript, DEMO.before)
  }
})

test("memory and audience examples provide environment cues; intentional pause preserves the script", () => {
  assert.match(REASONS.memory.cue, /저장.*재사용/)
  assert.match(REASONS.audience.cue, /지점.*단서/)
  assert.equal(REASONS.pause.permission, false)
  assert.equal(REASONS.memory.permission, false)
  assert.equal(REASONS.meaning.permission, true)
})

test("example application requires separate permission, meaning review and numeric preservation", () => {
  const base = chooseReason({ ...freshDemo(), locationConfirmed: true }, "meaning")
  assert.throws(() => applyExampleRevision(base))
  const allowed = allowExampleRevision(base)
  assert.throws(() => applyExampleRevision(allowed))
  assert.throws(() => applyExampleRevision({ ...allowed, checked: true, proposal: DEMO.after.replace("5분", "6분") }))
  assert.equal(base.currentScript, DEMO.before)
})

test("applied example changes only its paragraph and keeps immutable original/version history", () => {
  const before = { ...allowExampleRevision(chooseReason({ ...freshDemo(), locationConfirmed: true }, "meaning")), checked: true }
  const applied = applyExampleRevision(before)
  assert.equal(applied.currentScript, DEMO.before.replace(DEMO.paragraph, DEMO.after))
  assert.equal(applied.versions.length, 2)
  assert.equal(before.versions.length, 1)
  assert.equal(applied.versions[0], DEMO.before)
  const restored = restoreExampleOriginal(applied)
  assert.equal(restored.currentScript, DEMO.before)
  assert.equal(restored.versions.length, 3)
  assert.equal(restored.versions[1], applied.currentScript)
  assert.equal(restored.reason, "meaning")
})

test("reloading keeps the demo draft while resetting meaning review; corrupt state starts fresh", () => {
  const applied = applyExampleRevision({ ...allowExampleRevision(chooseReason({ ...freshDemo(), locationConfirmed: true }, "meaning")), checked: true })
  assert.equal(restoreDemoState(JSON.parse(JSON.stringify(applied))).currentScript, applied.currentScript)
  assert.equal(restoreDemoState({ ...applied, checked: true }).checked, false)
  assert.deepEqual(restoreDemoState({ ...applied, fixtureId: "other" }), freshDemo())
  assert.deepEqual(restoreDemoState({ ...applied, versions: [] }), freshDemo())
})
