import { loadWorkspace, saveWorkspace, deleteWorkspace } from "./coach-store.js"
import { checkRevision } from "./content-check.js"

const $ = id => document.getElementById(id)
const id = () => crypto.randomUUID()
const DEFAULT_QUESTION = "이 대본에서 전달하려는 내용을 자기 말로 설명해 보세요."
const fresh = () => ({ id: "current", versions: [], attempts: [], script: "", sources: "", versionId: id(), question: DEFAULT_QUESTION, concept: null, reference: "", helpUsed: false, followups: 0 })
let state = fresh(), ready = false, controller = null, generation = 0, saveQueue = Promise.resolve()
function h(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e }
function button(text, action) { const e = h("button", text); e.type = "button"; e.addEventListener("click", action); return e }
function status(text) { $("request-state").textContent = text }
function controls() { document.querySelectorAll("[data-ai]").forEach(e => { e.disabled = !ready || Boolean(controller) }); $("cancel").hidden = !controller }
function persist() {
  const copy = structuredClone(state)
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const saved = await saveWorkspace(copy)
    $("save-state").textContent = saved ? "자료와 연습 기록을 이 브라우저에 저장했어요." : "저장하지 못해 현재 화면에만 보관 중이에요. 닫기 전에 기록을 내보내 주세요."
  })
  return saveQueue
}
function resetPrompt() {
  state.question = DEFAULT_QUESTION; state.concept = null; state.reference = ""; state.helpUsed = false; state.followups = 0
  $("question-text").textContent = state.question; $("reference").hidden = true; $("answer").value = ""; $("feedback").replaceChildren(); $("attempt-state").textContent = ""
}
function syncDraft() {
  const script = $("script").value.trim(), sources = $("sources").value.trim()
  if (script !== state.script || sources !== state.sources || !state.versions.length) {
    const draftAnswer = $("answer").value
    state.versionId = id(); state.script = script; state.sources = sources
    state.versions.push({ id: state.versionId, script, sources, createdAt: Date.now() })
    resetPrompt()
    $("answer").value = draftAnswer
  }
}
function cancel(message = "분석을 취소했어요. 원문은 그대로예요.") {
  generation++; controller?.abort(); controller = null; controls(); status(message)
}
async function refreshModel() {
  try {
    const response = await fetch("/api/model-status")
    const info = await response.json(); ready = info.ready === true
    $("model-state").textContent = info.message || "모델 상태를 확인하지 못했어요."
  } catch { ready = false; $("model-state").textContent = "서버에 연결하지 못했어요. 자료 저장·직접 수정은 계속할 수 있어요." }
  controls()
}
async function run(task, onResult) {
  if (controller) return
  syncDraft()
  if (!state.script) { status("짧은 대본 구간을 먼저 입력해 주세요."); $("script").focus(); return }
  if (task === "review" && !$("answer").value.trim()) { status("답변을 입력하거나 모르겠어요·건너뛰기를 선택해 주세요."); return }
  if (task === "review" && state.followups >= 3) { status("이 질문은 세 번 확인했어요. 근거를 살펴보거나 새 질문을 선택할 수 있어요."); return }
  persist()
  const token = ++generation, versionId = state.versionId, requestId = id()
  const snapshot = { task, requestId, versionId, script: state.script, sources: state.sources, answer: $("answer").value.trim(), question: state.question }
  const selected = { concept: state.concept, helpUsed: state.helpUsed }
  controller = new AbortController(); controls(); status("직접 운영하는 모델이 자료를 확인하고 있어요. 취소할 수 있어요.")
  try {
    const response = await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot), signal: controller.signal })
    const body = await response.json()
    if (token !== generation) return
    if (!response.ok) throw new Error(body.message || "결과를 받지 못했어요.")
    if (body.versionId !== versionId || body.requestId !== requestId || state.script !== $("script").value.trim() || state.sources !== $("sources").value.trim()) throw new Error("자료가 바뀌어 이전 결과를 적용하지 않았어요.")
    onResult(body.result, snapshot, body, selected)
    status(`확인할 초안을 만들었어요. 모델 ${body.model} · ${(body.durationMs / 1000).toFixed(1)}초. 자료 자체의 사실성을 인증하는 결과는 아니에요.`)
    await persist()
  } catch (e) {
    if (token === generation) status(e.name === "AbortError" ? "요청을 취소했어요." : e.message)
  } finally { if (token === generation) { controller = null; controls() } }
}

function renderConcepts(result) {
  $("concept-list").replaceChildren(...result.concepts.map(c => {
    const article = h("article", null, "coach-card")
    article.append(h("h3", c.term), h("blockquote", c.quote))
    const explanation = h("div"); explanation.hidden = true
    explanation.append(h("p", c.explanation), h("p", "AI가 제안한 풀이 초안이에요. 자료와 맞는지 확인해 주세요."), h("p", c.sourceQuote ? `자료 근거: ${c.sourceQuote}` : "근거 자료가 없어 확인할 풀이 초안이에요.", "coach-evidence"))
    article.append(button("내 말로 설명해 보기", () => {
      cancel(""); state.concept = { ...c, versionId: state.versionId }; state.question = `이 자료에서 ‘${c.term}’은 어떤 뜻인가요? 자기 말로 설명해 보세요.`
      state.reference = c.sourceQuote; state.helpUsed = !explanation.hidden; state.followups = 0
      $("question-text").textContent = state.question; $("reference").hidden = true; $("answer").value = ""; $("feedback").replaceChildren(); $("answer").focus(); renderHistory(); persist()
    }), button("쉬운 풀이 보기", () => { explanation.hidden = false; state.helpUsed = true; persist() }), button("이미 아는 표현이에요", () => { article.remove() }), explanation)
    return article
  }))
}
function renderRevision(result, snapshot) {
  const area = $("revision"); area.replaceChildren(h("h3", "쉬운 대본 제안"))
  const grid = h("div", null, "coach-grid"), before = h("div"), after = h("div")
  const proposed = document.createElement("textarea"); proposed.rows = 7; proposed.maxLength = 5000; proposed.value = result.rewritten; proposed.id = "proposed-script"
  const editLabel = h("label", "수정 제안 · 직접 고칠 수 있어요"); editLabel.append(proposed)
  before.append(h("h4", "현재 대본"), h("blockquote", snapshot.script)); after.append(editLabel); grid.append(before, after)
  area.append(grid, h("p", result.reason), h("p", result.sourceQuote ? `자료 근거: ${result.sourceQuote}` : "자료 근거가 없어 사실·의미를 직접 확인해 주세요."))
  const warnings = h("div"); area.append(warnings)
  area.append(h("p", "자동 검사는 수치·일부 표현 변화를 찾는 보조 검사예요. 의미 보존을 보증하지 않아요."))
  const label = h("label"), check = document.createElement("input"); check.type = "checkbox"; check.id = "confirm-revision"
  label.append(check, document.createTextNode(" 수치·조건·부정·한계와 핵심 의미를 확인했어요"))
  const apply = button("새 버전으로 적용", async () => {
    if (!check.checked || state.versionId !== snapshot.versionId || checkRevision(snapshot.script, proposed.value).blocked || proposed.value.length > 2400) return
    $("script").value = proposed.value; syncDraft(); state.versions.at(-1).sourceRequestId = snapshot.requestId
    await persist(); area.replaceChildren(h("p", "새 대본 버전으로 저장했어요. 원본은 유지돼요. 다시 설명해 보거나 전체 발표 연습을 해보세요.")); $("concept-list").replaceChildren(); renderHistory()
  })
  // Rewrites may expand beyond the bounded first-version editor; do not silently truncate.
  apply.disabled = true
  const recheck = () => {
    const checks = checkRevision(snapshot.script, proposed.value)
    warnings.replaceChildren(...checks.warnings.map(w => h("p", w, "coach-warning")))
    if (checks.blocked) warnings.append(h("p", "수치·단위를 원문과 맞추거나 빈 제안을 채운 뒤 적용할 수 있어요.", "coach-warning"))
    if (proposed.value.length > 2400) warnings.append(h("p", "제안이 2,400자를 넘어요. 구간을 나누어 주세요.", "coach-warning"))
    apply.disabled = !check.checked || checks.blocked || proposed.value.length > 2400
  }
  check.addEventListener("change", recheck)
  proposed.addEventListener("input", () => { check.checked = false; recheck() })
  recheck()
  area.append(label, apply, button("제안 닫기", () => area.replaceChildren()))
}
function renderFeedback(result, snapshot, metadata, selected) {
  state.followups++
  const attempt = { id: id(), createdAt: Date.now(), versionId: snapshot.versionId, script: snapshot.script, sources: snapshot.sources, concept: selected.concept, question: snapshot.question, answer: snapshot.answer, helpUsed: selected.helpUsed, result, model: metadata.model, promptVersion: metadata.promptVersion }
  state.attempts.push(attempt)
  const box = $("feedback"); box.replaceChildren(h("h3", { supported: "자료와 부합하는 설명", "needs-work": "다음으로 보완할 부분", uncertain: "아직 판단하기 어려운 부분" }[result.state]))
  if (result.supported) box.append(h("p", result.supported))
  box.append(h("p", result.nextStep), h("p", result.sourceQuote ? `비교한 자료: ${result.sourceQuote}` : "근거 자료가 없어 이해 여부를 판단하지 않았어요.", "coach-evidence"))
  box.append(h("p", "모델의 검토 초안이에요. 답변과 근거가 맞는지 확인해 주세요."), button("이 검토가 맞아요", () => { attempt.result.humanReview = "confirmed"; persist(); renderHistory(); status("사용자가 확인한 검토로 기록했어요.") }), button("이 검토가 맞지 않아요", () => { attempt.result.humanReview = "disputed"; persist(); renderHistory(); status("검토에 동의하지 않음으로 기록했어요. 원문 근거로 다시 확인할 수 있어요.") }))
  $("attempt-state").textContent = `이번 질문 확인 ${state.followups}/3 · ${selected.helpUsed ? "풀이·근거를 본 뒤 답변" : "풀이·근거를 열지 않고 답변"}`
  // Any feedback is assistance for the next attempt unless the user starts a fresh unassisted retry.
  state.helpUsed = true; renderHistory()
}
function renderHistory() {
  const area = $("attempt-history")
  const list = state.attempts.filter(a => !state.concept || a.concept?.term === state.concept.term)
  if (!list.length) { area.replaceChildren(h("p", "아직 저장한 답변이 없어요.")); return }
  const rows = list.slice(-2)
  const grid = h("div", null, "coach-comparison")
  rows.forEach((a, index) => {
    const card = h("article", null, "coach-card")
    card.append(h("h3", rows.length === 2 && index === 0 ? "이전 설명" : "최근 설명"), h("p", a.question), h("blockquote", a.answer || "건너뜀"), h("p", a.helpUsed ? "도움을 본 뒤 답변" : "도움을 열지 않고 답변"), h("p", a.result?.nextStep || "검토하지 않음"), h("p", `사용자 확인: ${{ confirmed: "맞음", disputed: "동의하지 않음", unreviewed: "미확인" }[a.result?.humanReview] || "미확인"}`))
    grid.append(card)
  })
  area.replaceChildren(grid, h("p", `전체 답변 ${state.attempts.length}개 · 대본 버전 ${state.versions.length}개. 전체 기록은 내보내기에 포함돼요.`))
  if (rows.length === 2 && (rows[0].sources !== rows[1].sources || rows[0].question !== rows[1].question || rows[0].script !== rows[1].script)) area.append(h("p", "질문·자료 또는 대본이 달라 직접적인 개선 비교로 해석할 수 없어요.", "coach-warning"))
}

$("concepts").onclick = () => run("concepts", renderConcepts)
$("rewrite").onclick = () => run("rewrite", renderRevision)
$("review").onclick = () => run("review", renderFeedback)
$("question").onclick = () => run("question", result => {
  state.concept = null; state.question = result.question; state.reference = result.referenceQuote; state.helpUsed = false; state.followups = 0
  $("question-text").textContent = result.question; $("reference").hidden = true; $("answer").value = ""; $("feedback").replaceChildren(); $("attempt-state").textContent = "자료에서 확인할 수 있는 범위로 답해 보세요."
  renderHistory()
})
$("save-draft").onclick = () => { syncDraft(); persist(); renderHistory() }
$("help").onclick = () => {
  syncDraft(); state.helpUsed = true
  $("reference").replaceChildren(h("p", state.concept?.explanation || "자료를 짧게 나누고 핵심 내용을 하나씩 설명해 보세요."), h("blockquote", state.reference || state.sources || "아직 근거 자료가 없어요. 확인할 원자료를 붙여 넣거나 쉬운 대본 제안을 참고할 수 있어요."))
  $("reference").hidden = false; persist()
}
$("skip").onclick = () => { cancel("이번 질문은 건너뛰었어요. 설명을 받거나 다른 연습을 계속할 수 있어요."); $("answer").value = ""; $("feedback").replaceChildren(); state.helpUsed = false; persist() }
$("retry").onclick = () => { cancel(""); $("answer").value = ""; $("reference").hidden = true; $("feedback").replaceChildren(); state.helpUsed = false; $("answer").focus(); status("앞서 본 내용의 영향은 남아 있을 수 있어요. 이번에는 도움을 다시 열지 않고 설명해 보세요."); persist() }
$("cancel").onclick = () => cancel()
$("model-refresh").onclick = refreshModel
for (const name of ["script", "sources"]) $(name).addEventListener("input", () => { cancel("자료가 바뀌었어요. 저장 후 새 기준으로 확인해 주세요."); resetPrompt(); $("concept-list").replaceChildren(); $("revision").replaceChildren() })
$("export").onclick = () => {
  syncDraft()
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" }))
  const a = document.createElement("a"); a.href = url; a.download = "speech-coach-understanding.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  status("입력 자료와 본인 답변을 포함한 기록을 내보냈어요. 공유 전에 내용을 확인해 주세요.")
}
$("restore").onclick = async () => {
  if (!state.versions.length) return
  cancel(""); const original = state.versions[0]; $("script").value = original.script; $("sources").value = original.sources; syncDraft(); await persist(); $("revision").replaceChildren(); $("concept-list").replaceChildren(); renderHistory(); status("처음 저장한 자료를 새 버전으로 되돌렸어요. 이전 기록은 유지돼요.")
}
$("clear").onclick = async () => {
  if (!confirm("이 페이지에 저장한 대본·자료·답변 기록을 모두 삭제할까요? 기존 녹음 기록은 포함하지 않아요.")) return
  cancel(""); await saveQueue
  if (!await deleteWorkspace()) { status("삭제하지 못했어요. 다른 탭을 닫고 다시 시도해 주세요."); return }
  state = fresh(); $("script").value = ""; $("sources").value = ""; resetPrompt(); $("concept-list").replaceChildren(); $("revision").replaceChildren(); $("save-state").textContent = ""; renderHistory(); status("이 페이지의 저장 자료를 삭제했어요.")
}

const loaded = await loadWorkspace()
if (loaded?.id === "current" && Array.isArray(loaded.versions) && Array.isArray(loaded.attempts)) state = { ...fresh(), ...loaded }
$("script").value = state.script; $("sources").value = state.sources; $("question-text").textContent = state.question
renderHistory(); await refreshModel()
