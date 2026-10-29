import { getSession } from "./storage.js"
import { loadWorkspace, saveWorkspace } from "./coach-store.js"
import { checkRevision } from "./content-check.js"
import { PRACTICE_SETTINGS_KEY, RESTORE_SUPPORT_KEY, scriptChunks, replaceSelectedChunk, supportWorkspace, observationTexts } from "./support-state.js"

const $ = id => document.getElementById(id), params = new URLSearchParams(location.search)
const practiceId = params.get("session") || "", itemId = params.get("item") || "", cacheKey = `support-dialogue:${practiceId}:${itemId}`
let ready = false, pending = null, serial = 0, history = [], reply = null, proposal = null, ended = false, declined = false, versionId = crypto.randomUUID(), fullScript = "", chunks = [], selected = null
const node = (tag, text) => { const e = document.createElement(tag); e.textContent = text; return e }
const say = text => { $("support-state").textContent = text }
function remember() {
  try { sessionStorage.setItem(cacheKey, JSON.stringify({ script: $("support-script").value, sources: $("support-sources").value, context: $("support-context").value, history, reply, declined, ended, versionId })) }
  catch { say("이 탭에 대화를 보관하지 못했어요. 화면을 닫기 전에 필요한 내용을 복사해 주세요.") }
}
function controls() {
  const allowed = ready && $("share-support").checked && !pending && $("support-script").value.trim().length >= 3
  $("start-support").disabled = !allowed
  $("answer-support").disabled = !allowed || ended || !reply?.question || history.filter(h => h.role === "user").length >= 3
  $("accept-rewrite").disabled = !allowed || !history.some(h => h.role === "user")
  $("cancel-support").hidden = !pending
  for (const el of document.querySelectorAll("#support-hints button")) el.disabled = $("answer-support").disabled
  const check = proposal && checkRevision(proposal.original, $("support-proposal").value)
  $("apply-support").disabled = !proposal || Boolean(pending) || !$("confirm-support-meaning").checked || check.blocked || $("support-proposal").value.trim().length < 3
  if (proposal) $("support-checks").textContent = check.warnings.join(" · ") || "자동 검사는 의미 보존을 보증하지 않아요. 뜻과 조건을 직접 대조해 주세요."
}
function showDialogue() {
  $("support-dialogue").hidden = !history.length
  $("support-messages").replaceChildren(...history.map(h => { const box = node("div", ""); box.className = "coach-card"; box.append(node("strong", h.role === "user" ? "내 설명" : "함께 정리"), node("p", h.text)); return box }))
  if (reply?.sourceQuote) $("support-messages").append(node("blockquote", `제공 자료의 인용: ${reply.sourceQuote}`))
  const count = history.filter(h => h.role === "user").length
  $("support-count").textContent = `내 답변 ${count}/3 · 모르겠다고 하거나 여기서 마쳐도 괜찮아요.`
  $("rewrite-permission").hidden = !reply?.offerRewrite || declined
  controls()
}
function cancel(message = "기다리기를 취소했어요. 입력한 대본과 답변은 그대로예요.") { serial++; pending?.abort(); pending = null; say(message); controls() }
function changed() {
  cancel("자료가 바뀌었어요. 새 기준으로 함께 살펴보기를 눌러 주세요.")
  history = []; reply = null; proposal = null; ended = false; declined = false; versionId = crypto.randomUUID()
  $("support-revision").hidden = true; $("confirm-support-meaning").checked = false; $("share-support").checked = false
  remember(); showDialogue()
}
async function refresh() {
  try {
    const res = await fetch("/api/coach/support-status"), info = await res.json()
    ready = res.ok && info.ready === true
    $("support-model").textContent = `${info.model || "Gemini"} · ${info.message || "연결 상태를 확인하지 못했어요."}`
  } catch { ready = false; $("support-model").textContent = "서버에 연결하지 못했어요. 대본은 유지되며 자체 AI 연습을 선택할 수 있어요." }
  controls()
}
async function run(task, nextHistory = history) {
  if (pending || !ready || !$("share-support").checked) return
  const script = $("support-script").value.trim(), sources = $("support-sources").value.trim(), requestId = crypto.randomUUID(), token = ++serial
  const observations = [...$("support-observations").querySelectorAll("input:checked")].map(e => ({ text: e.dataset.text, source: "measurement" }))
  const payload = { task, script, sources, context: $("support-context").value.trim(), observations, history: nextHistory, requestId, versionId, externalTransferConsent: true, rewriteConsent: task === "support-rewrite", simplifyDeclined: declined }
  pending = new AbortController(); controls(); say(task === "support-rewrite" ? "말하기 편한 대본 초안을 만들고 있어요. 직접 확인한 뒤 적용할 수 있어요." : "대본과 선택한 관찰, 본인이 말한 내용을 함께 살펴보고 있어요.")
  try {
    const response = await fetch("/api/coach/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: pending.signal }), body = await response.json()
    if (token !== serial) return
    if (!response.ok) throw new Error(body.message || "코칭 응답을 받지 못했어요.")
    if (body.requestId !== requestId || body.versionId !== versionId) throw new Error("자료가 바뀌어 이전 응답을 적용하지 않았어요.")
    if (task === "support-rewrite") {
      proposal = { original: script, model: body.model, requestId, result: body.result }
      $("support-original").textContent = script; $("support-proposal").value = body.result.rewritten; $("support-reason").textContent = [body.result.reason, body.result.sourceQuote ? `제공 자료의 인용: ${body.result.sourceQuote}` : "별도 근거 자료로 사실을 확인한 수정안은 아니에요."].join("\n")
      $("confirm-support-meaning").checked = false; $("support-revision").hidden = false; $("rewrite-permission").hidden = true
      $("support-revision").scrollIntoView({ behavior: "smooth", block: "start" })
    } else {
      reply = body.result; history = [...nextHistory, { role: "coach", text: [reply.reflection, reply.help, reply.question].filter(Boolean).join("\n") }]
      ended = !reply.question; $("support-answer").value = ""; remember(); showDialogue()
      $("support-dialogue").scrollIntoView({ behavior: "smooth", block: "start" })
      if (reply.question) $("support-answer").focus({ preventScroll: true })
    }
    say(`함께 볼 초안을 받았어요. ${body.model} · 원인은 본인의 설명으로만 확인해요.`)
  } catch (error) { if (token === serial) say(error.name === "AbortError" ? "기다리기를 취소했어요." : error.message) }
  finally { if (token === serial) { pending = null; controls() } }
}
$("start-support").onclick = () => { history = []; reply = null; proposal = null; ended = false; declined = false; $("support-revision").hidden = true; showDialogue(); run("support-start") }
$("answer-support").onclick = () => { const text = $("support-answer").value.trim(); if (!text) { say("기억나는 만큼 적거나 ‘잘 모르겠어요’를 선택할 수 있어요."); return }; run("support-answer", [...history, { role: "user", text }]) }
for (const text of ["표현의 뜻을 함께 정리하고 싶어요.", "다음 문장이 잠깐 생각나지 않았어요.", "일부러 쉬어 간 구간이에요.", "아직 잘 모르겠어요."]) {
  const b = node("button", text); b.type = "button"; b.onclick = () => { $("support-answer").value = text; $("answer-support").click() }; $("support-hints").append(b)
}
$("accept-rewrite").onclick = () => run("support-rewrite")
$("decline-rewrite").onclick = () => { declined = true; $("rewrite-permission").hidden = true; remember(); say("지금 대본을 유지해요. 다음 문장의 핵심어를 짚거나 같은 구간을 다시 연습할 수 있어요.") }
$("skip-support").onclick = () => { cancel("여기까지 정리했어요. 답하지 않은 이유를 추정하지 않아요."); ended = true; remember(); controls() }
$("cancel-support").onclick = () => cancel()
$("share-support").onchange = () => { if (!$("share-support").checked && pending) cancel(); controls() }
$("support-proposal").oninput = () => { $("confirm-support-meaning").checked = false; controls() }
$("confirm-support-meaning").onchange = controls
$("discard-support").onclick = () => { proposal = null; $("support-revision").hidden = true; say("초안을 사용하지 않았어요. 원래 대본은 그대로예요."); controls() }
$("apply-support").onclick = async () => {
  if ($("apply-support").disabled || !proposal) return
  const revised = $("support-proposal").value.trim(), chunk = selected
  try {
    const newScript = chunk ? replaceSelectedChunk(fullScript, chunk, revised) : revised
    const previous = JSON.parse(localStorage.getItem(PRACTICE_SETTINGS_KEY) || "{}")
    const metadata = { versionId: crypto.randomUUID(), model: proposal.model, requestId: proposal.requestId, createdAt: Date.now(), practiceId }
    const workspace = supportWorkspace(await loadWorkspace(), proposal.original, revised, $("support-sources").value.trim(), metadata)
    if (!await saveWorkspace(workspace)) throw new Error("새 대본을 보관하지 못했어요.")
    localStorage.setItem(RESTORE_SUPPORT_KEY, JSON.stringify({ script: previous.script, scriptFile: previous.scriptFile || null, appliedScript: newScript }))
    localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify({ ...previous, script: newScript, scriptFile: previous.scriptFile ? { ...previous.scriptFile, edited: true } : null }))
    location.href = "/#/"
  } catch { say("대본을 저장하지 못했어요. 초안을 복사해 보관한 뒤 다시 시도해 주세요. 기존 녹음은 그대로예요.") }
}
$("undo-support").onclick = () => {
  try {
    const backup = JSON.parse(localStorage.getItem(RESTORE_SUPPORT_KEY) || "null"), raw = JSON.parse(localStorage.getItem(PRACTICE_SETTINGS_KEY) || "{}")
    if (!backup || raw.script !== backup.appliedScript) throw new Error()
    localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify({ ...raw, script: backup.script || "", scriptFile: backup.scriptFile })); localStorage.removeItem(RESTORE_SUPPORT_KEY)
    $("undo-support").hidden = true; say("직전 적용 전 대본으로 되돌렸어요. 지난 연습 기록은 그대로예요.")
  } catch { say("그 뒤에 대본이 달라져 자동으로 덮어쓰지 않았어요. 대본 이해 연습의 이전 버전을 확인해 주세요.") }
}
$("clear-support").onclick = () => { cancel(""); history = []; reply = null; proposal = null; ended = false; declined = false; sessionStorage.removeItem(cacheKey); $("support-answer").value = ""; $("support-revision").hidden = true; say("이 탭의 대화를 지웠어요. 기존 녹음과 대본은 그대로예요."); showDialogue() }
$("refresh-support").onclick = refresh
for (const id of ["support-script", "support-sources", "support-context"]) $(id).addEventListener("input", changed)

const session = practiceId ? await getSession(practiceId) : null, workspace = await loadWorkspace()
fullScript = typeof session?.script === "string" ? session.script : workspace?.script || ""
chunks = scriptChunks(fullScript); selected = chunks[0] || null
$("support-script").value = selected?.text || ""; $("support-sources").value = session && session.script !== workspace?.script ? "" : workspace?.sources || ""
$("record-context").textContent = session ? "선택한 연습 기록의 대본과 관찰을 가져왔어요. 함께 볼 부분이 맞는지 확인해 주세요. 지난 기록은 바꾸지 않아요." : "대본을 직접 넣고 상황을 설명할 수 있어요. 측정 기록이 없으면 어려움을 추정하지 않아요."
$("back-result").href = session ? `/#/result/${encodeURIComponent(practiceId)}` : "/"
if (chunks.length > 1) {
  $("chunk-label").hidden = false
  chunks.forEach((c, i) => { const o = node("option", `${i + 1}번째 부분 · ${c.text.slice(0, 45)}`); o.value = i; $("script-chunk").append(o) })
  $("script-chunk").onchange = () => { selected = chunks[Number($("script-chunk").value)]; $("support-script").value = selected.text; changed() }
}
const observations = observationTexts(session, itemId)
for (const o of observations) { const li = node("li", ""), label = node("label", ""), input = document.createElement("input"); input.type = "checkbox"; input.checked = true; input.dataset.text = o.text; input.onchange = changed; label.append(input, document.createTextNode(o.text)); li.append(label); $("support-observations").append(li) }
if (!observations.length) $("support-observations").append(node("li", "이 기록에서 가져온 관찰 후보가 없어요. 직접 적은 상황과 대본만 함께 볼 수 있어요."))
try { $("undo-support").hidden = !localStorage.getItem(RESTORE_SUPPORT_KEY) } catch { /* storage optional */ }
try { const saved = JSON.parse(sessionStorage.getItem(cacheKey) || "null"); if (saved && saved.script === $("support-script").value && saved.sources === $("support-sources").value) { history = saved.history || []; reply = saved.reply; declined = saved.declined; ended = saved.ended; versionId = saved.versionId; $("support-context").value = saved.context || "" } } catch { /* stay editable */ }
showDialogue(); await refresh()
