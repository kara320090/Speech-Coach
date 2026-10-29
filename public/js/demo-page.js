import { checkRevision } from "./content-check.js"
import { DEMO, DEMO_KEY, REASONS, freshDemo, restoreDemoState, chooseReason, allowExampleRevision, applyExampleRevision, restoreExampleOriginal } from "./demo-coaching.js"

const $ = id => document.getElementById(id)
const h = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e }
let state
try { state = restoreDemoState(JSON.parse(localStorage.getItem(DEMO_KEY) || "null")) } catch { state = freshDemo() }
const stages = [["prepare", "예시 대본"], ["results", "예시 분석"], ["coach", "상황과 도움"], ["revision", "허락 후 수정"], ["complete", "확인하고 적용"]]
function save() {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); return true } catch { return false }
}
function transition(next, message = "") { state = next; const saved = save(); render(); $("demo-status").textContent = message + (saved ? "" : " 예시 기록은 현재 화면에만 보관돼요."); window.scrollTo({ top: 0, behavior: "smooth" }) }
const button = (text, action, secondary = false) => { const b = h("button", text, secondary ? "secondary" : "primary"); b.type = "button"; b.onclick = action; return b }
const badge = text => h("span", text, "badge")
const card = (...children) => { const e = h("section", "", "demo-card"); e.append(...children); return e }
const row = (...children) => { const e = h("div", "", "actions"); e.append(...children); return e }
const title = (label, name, desc) => { const e = h("div", "", "screen-title"); e.append(h("p", label, "eyebrow"), h("h2", name), h("p", desc, "muted")); return e }
function scriptBox(text, label = "예시 대본") { const e = h("article", "", "script-box"); e.setAttribute("aria-label", label); e.append(h("h3", label), h("p", text)); return e }
function drawPrepare() {
  return [title("01 · 미리 작성한 예시", "대본은 있지만, 내 말로 설명하고 싶을 때", "‘캐시’를 소개하는 짧은 발표 상황으로 도움받는 흐름을 체험해 보세요."), card(badge("준비된 대본 예시"), scriptBox(DEMO.before), h("p", "원문은 그대로 두고, 필요한 표현을 함께 살펴볼 거예요.", "muted"), row(button("예시 분석 보기", () => transition({ ...state, stage: "results" }))))]
}
function drawResults() {
  const metrics = h("div", "", "metrics")
  for (const [a, b] of [["예시 연습 길이", "1분 20초"], ["살펴볼 예시 구간", "1곳"], ["데이터 출처", "시연용 고정 예시"]]) { const c = h("div"); c.append(h("span", a), h("strong", b)); metrics.append(c) }
  const timeline = h("div", "", "timeline"); timeline.append(h("span", "0:00"), h("div", "0:18 · 예시 구간", "timeline-mark"), h("span", "1:20"))
  return [title("02 · 관찰과 원인 구분", "멈춤이 있었다고, 이유를 단정하지 않아요", "다음 수치는 준비된 예시예요. 실제 음성·영상에서 측정한 값은 아니에요."), metrics, card(badge("관찰 예시"), h("h3", DEMO.observation), timeline, h("p", "뜻을 풀고 싶었는지, 다음 내용의 단서가 필요했는지는 직접 확인할 수 있어요."), scriptBox(DEMO.paragraph, "함께 볼 대본 부분"), row(button("이 구간 함께 살펴보기", () => transition({ ...state, stage: "coach", locationConfirmed: false, reason: "" }))))]
}
function drawCoach() {
  const contents = [title("03 · 상황을 먼저 묻기", "어떤 도움이 있으면 더 편하게 말할 수 있을까요?", "예시 선택에 따라 준비된 도움말이 달라져요. 자유 입력을 AI가 분석하는 기능은 아니에요.")]
  if (!state.locationConfirmed) return [...contents, card(badge("대본 위치 확인"), scriptBox(DEMO.paragraph, "살펴볼 부분이 맞나요?"), h("p", "관찰 예시와 함께 볼 대본을 먼저 확인해요.", "muted"), row(button("이 대본 부분이 맞아요", () => transition({ ...state, locationConfirmed: true }))))]
  const options = h("div", "", "reason-grid")
  for (const [key, value] of Object.entries(REASONS)) { const b = button(value.label, () => transition(chooseReason(state, key)), true); b.setAttribute("aria-pressed", String(state.reason === key)); options.append(b) }
  contents.push(card(badge("본인이 고르는 상황 예시"), h("h3", "이 순간에는 어떤 도움이 필요했나요?"), options))
  if (state.reason) {
    const answer = REASONS[state.reason]
    const help = card(badge("미리 작성한 코칭 예시"), h("h3", "함께 정리해 볼게요"), h("p", answer.reply), h("p", answer.cue, "cue"))
    if (answer.permission) help.append(h("h3", "대본을 쉬운 단어로 풀어 봐도 될까요?"), h("p", "동의하면 준비된 수정 예시를 보여 드려요. 지금 대본을 유지해도 괜찮아요."), row(button("네, 쉬운 대본 예시를 볼게요", () => transition(allowExampleRevision(state))), button("지금 대본을 유지할게요", () => transition({ ...state, stage: "complete", consent: false }, "수정 예시를 적용하지 않았어요. 원문을 유지해요."), true)))
    else help.append(row(button("이 도움말로 정리할게요", () => transition({ ...state, stage: "complete" })), button("다른 상황도 살펴보기", () => transition({ ...state, reason: "" }), true)))
    contents.push(help)
  }
  return contents
}
function drawRevision() {
  if (!state.consent) { state.stage = "coach"; return drawCoach() }
  const comparison = h("div", "", "comparison")
  const original = scriptBox(DEMO.paragraph, "원래 문장")
  const edited = h("label", "쉬운 대본 예시 · 직접 고칠 수 있어요", "editor")
  const ta = document.createElement("textarea"); ta.rows = 5; ta.maxLength = 2400; ta.value = state.proposal; ta.setAttribute("aria-label", "쉬운 대본 예시")
  const confirm = h("label", "", "confirm"), check = document.createElement("input"); check.type = "checkbox"; check.checked = false
  confirm.append(check, document.createTextNode("5분이라는 수치와 원래 뜻을 확인했어요"))
  const warning = h("p", "", "warning"), apply = button("예시 대본에 적용", () => transition(applyExampleRevision(state), "수정 예시를 새 버전으로 저장했어요. 원문과 이전 버전은 보존했어요."))
  const validate = () => { const c = checkRevision(DEMO.paragraph, state.proposal); warning.textContent = c.warnings.join(" · ") || "문장을 짧게 나누고, ‘동일한 요청·재사용’을 쉬운 표현으로 풀었어요. 의미는 직접 확인해 주세요."; apply.disabled = !state.checked || c.blocked || state.versions.length >= 30 }
  ta.oninput = () => { state.proposal = ta.value; state.checked = false; check.checked = false; save(); validate() }
  check.onchange = () => { state.checked = check.checked; validate() }
  edited.append(ta); comparison.append(original, edited); validate()
  return [title("04 · 선택하고 확인하기", "바꾸기 전에, 원문과 나란히 읽어요", "미리 작성한 수정 예시예요. 실제 AI 생성 결과로 표시하지 않아요."), card(badge("수정 의사 확인 완료"), comparison, warning, confirm, row(apply, button("초안을 사용하지 않을게요", () => transition({ ...state, consent: false, stage: "complete" }), true)))]
}
function drawComplete() {
  const changed = state.currentScript !== DEMO.before
  return [title("05 · 원문을 보존하는 선택", changed ? "말하기 편한 문장으로, 다음 한 걸음을 준비했어요" : "내가 고른 도움을 남기고, 원문은 유지해요", "이 화면은 시연용 예시 기록이에요. 실제 연습 기록·녹음·대본을 바꾸지 않아요."), card(badge(changed ? "수정 예시 적용" : "원문 유지"), h("p", `선택한 상황: ${REASONS[state.reason]?.label || "아직 선택하지 않음"}`), h("p", `보관한 예시 버전 ${state.versions.length}개 · 원문 보존`, "cue"), scriptBox(state.currentScript, "현재 예시 대본"), row(changed ? button("예시 원문으로 되돌리기", () => transition(restoreExampleOriginal(state), "처음 예시 대본으로 되돌렸어요. 기존 예시 버전도 남아 있어요."), true) : button("다른 상황 예시 살펴보기", () => transition({ ...state, stage: "coach", reason: "", consent: false, locationConfirmed: true })), button("처음부터 다시 체험", () => transition(freshDemo()), true)))]
}
function render() {
  const index = stages.findIndex(s => s[0] === state.stage)
  $("demo-steps").replaceChildren(...stages.map(([key, label], n) => { const li = h("li", "", n === index ? "current" : n < index ? "done" : ""); li.setAttribute("aria-current", n === index ? "step" : "false"); li.append(h("span", n < index ? "✓" : String(n + 1)), document.createTextNode(label)); return li }))
  const screens = { prepare: drawPrepare, results: drawResults, coach: drawCoach, revision: drawRevision, complete: drawComplete }
  $("demo-screen").replaceChildren(...screens[state.stage]())
}
$("reset-demo").onclick = () => transition(freshDemo(), "예시를 처음 상태로 돌렸어요. 실제 연습 기록은 그대로예요.")
render()
