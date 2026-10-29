// Prepared, fictional walkthrough. This module performs no inference or network requests.
import { checkRevision } from "./content-check.js"

export const DEMO_KEY = "dasibom.offline-example.v1"
export const DEMO = Object.freeze({
  id: "cache-example-v1",
  title: "캐시를 처음 듣는 사람에게 설명하기",
  before: "오늘은 캐시를 소개하겠습니다.\n\n캐시는 이전에 얻은 결과를 5분 동안 보관해 동일한 요청이 발생하면 재사용하는 저장소입니다.\n\n같은 작업을 반복하는 일을 줄이려는 방식입니다.",
  paragraph: "캐시는 이전에 얻은 결과를 5분 동안 보관해 동일한 요청이 발생하면 재사용하는 저장소입니다.",
  after: "캐시는 이전에 얻은 결과를 5분 동안 잠시 저장해 두는 곳입니다. 같은 요청이 오면, 저장한 결과를 다시 씁니다.",
  observation: "0:18–0:22 · 멈춤 후보 4.2초",
})
export const REASONS = Object.freeze({
  meaning: { label: "표현의 뜻을 함께 정리하고 싶어요", reply: "‘캐시’는 이전 결과를 잠시 보관했다가 다시 쓰는 공간이라는 뜻으로 풀어 볼 수 있어요. 저장과 재사용, 두 가지를 차례로 말해 볼까요?", permission: true, cue: "저장 → 같은 요청 → 재사용" },
  memory: { label: "다음 문장의 단서가 있으면 좋겠어요", reply: "문장 전체를 외우기보다 다음 내용을 떠올릴 단서를 두어 볼 수 있어요. 이 예시에서는 ‘저장 → 같은 요청 → 재사용’ 핵심어 카드를 준비해 볼게요.", permission: false, cue: "저장 → 같은 요청 → 재사용" },
  audience: { label: "청중을 볼 때 신경이 쓰였어요", reply: "어떤 순간에 신경이 쓰였는지 짚어 볼 수 있어요. 이 시연에서는 ‘첫 문장 시작’ 상황을 예로 들어, 편하게 볼 한 지점과 시작 문장 단서를 준비해 볼게요.", permission: false, cue: "편하게 볼 한 지점 · 첫 문장 단서" },
  pause: { label: "일부러 쉬어 간 구간이에요", reply: "원한 쉼으로 확인했어요. 멈춤 후보가 표시됐다는 이유만으로 대본을 바꿀 필요는 없어요. 원문을 유지한 채 이어갈 수 있어요.", permission: false, cue: "원문 유지" },
})
export function freshDemo() {
  return { fixtureId: DEMO.id, stage: "prepare", locationConfirmed: false, reason: "", consent: false, checked: false, proposal: DEMO.after, currentScript: DEMO.before, versions: [DEMO.before], answer: "" }
}
export function restoreDemoState(value) {
  const fresh = freshDemo()
  if (!value || value.fixtureId !== DEMO.id || !["prepare", "results", "coach", "revision", "complete"].includes(value.stage)) return fresh
  if (!Array.isArray(value.versions) || value.versions.length > 30 || value.versions.some(v => typeof v !== "string" || v.length > 5000) || value.currentScript !== value.versions.at(-1)) return fresh
  return { ...fresh, ...value, reason: Object.hasOwn(REASONS, value.reason) ? value.reason : "", checked: false }
}
export function chooseReason(state, reason) {
  if (!state.locationConfirmed || !Object.hasOwn(REASONS, reason)) throw new Error("함께 볼 부분과 상황을 먼저 확인해 주세요.")
  return { ...state, reason, consent: false, checked: false, stage: "coach", proposal: DEMO.after }
}
export function allowExampleRevision(state) {
  if (!state.reason || !state.locationConfirmed) throw new Error("먼저 함께 볼 부분과 상황을 골라 주세요.")
  return { ...state, consent: true, checked: false, stage: "revision" }
}
export function applyExampleRevision(state) {
  if (!state.consent || !state.checked) throw new Error("쉬운 대본 예시를 볼지 선택하고 내용을 확인해 주세요.")
  const check = checkRevision(DEMO.paragraph, state.proposal)
  if (check.blocked) throw new Error("5분이라는 수치·조건을 유지해 주세요.")
  const currentScript = DEMO.before.replace(DEMO.paragraph, state.proposal.trim())
  return { ...state, stage: "complete", currentScript, versions: [...state.versions, currentScript], checked: false }
}
export function restoreExampleOriginal(state) {
  return { ...state, stage: "complete", currentScript: DEMO.before, versions: [...state.versions, DEMO.before], checked: false }
}
