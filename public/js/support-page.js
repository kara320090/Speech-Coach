import { getSession } from "./storage.js"
import { loadWorkspace, saveWorkspace } from "./coach-store.js"
import { checkRevision } from "./content-check.js"
import { PRACTICE_SETTINGS_KEY, RESTORE_SUPPORT_KEY, scriptChunks, replaceSelectedChunk, supportWorkspace, observationTexts } from "./support-state.js"
import { alignPoint, canApply, paragraphOf, pointFromItem, reviseParagraph, scriptVersionIdFor, segmentStep, toSegments, userTurn } from "./segment-flow.js"

const $ = id => document.getElementById(id), params = new URLSearchParams(location.search)
const practiceId = params.get("session") || "", itemId = params.get("item") || "", cacheKey = `support-dialogue:${practiceId}:${itemId}`
let ready = false, pending = null, serial = 0, history = [], reply = null, proposal = null, ended = false, declined = false, versionId = crypto.randomUUID(), fullScript = "", chunks = [], selected = null
// 자체 AI 구간 대화(기본): 대본 위치 확인 → /api/coach/segment → /api/scripts/revise-segment
let engine = "local", localReady = false, seg = null, segHistory = [], segLast = null, segDone = false, paragraph = null, sentences = [], session = null, item = null
const node = (tag, text) => { const e = document.createElement(tag); e.textContent = text; return e }
const say = text => { $("support-state").textContent = text }
function remember() {
  try { sessionStorage.setItem(cacheKey, JSON.stringify({ script: $("support-script").value, sources: $("support-sources").value, context: $("support-context").value, history, reply, declined, ended, versionId })) }
  catch { say("이 탭에 대화를 보관하지 못했어요. 화면을 닫기 전에 필요한 내용을 복사해 주세요.") }
}
function controls() {
  $("support-answer").disabled = Boolean(pending)
  const gemini = engine === "gemini"
  $("gemini-consent").hidden = !gemini
  $("local-notice").hidden = gemini
  $("start-support").textContent = gemini ? "동의하고 함께 살펴보기" : "함께 살펴보기"
  const allowed = ready && $("share-support").checked && !pending && $("support-script").value.trim().length >= 3
  if (gemini) {
    $("start-support").disabled = !allowed
    $("answer-support").disabled = !allowed || ended || !reply?.question || history.filter(h => h.role === "user").length >= 3
    $("accept-rewrite").disabled = !allowed || !history.some(h => h.role === "user")
  } else {
    $("start-support").disabled = Boolean(pending) || !seg
    $("answer-support").disabled = Boolean(pending) || segDone || segLast?.message.kind !== "question"
  }
  $("unknown-support").hidden = $("explain-support").hidden = gemini || !segHistory.length
  $("unknown-support").disabled = $("explain-support").disabled = gemini || Boolean(pending) || segDone || !segLast
  $("request-revision").disabled = Boolean(pending)
  $("cancel-support").hidden = !pending
  for (const el of document.querySelectorAll("#support-hints button")) el.disabled = gemini ? $("answer-support").disabled : Boolean(pending) || segDone
  const check = proposal && checkRevision(proposal.original, $("support-proposal").value)
  $("apply-support").disabled = !proposal || Boolean(pending) || !$("confirm-support-meaning").checked || check.blocked || $("support-proposal").value.trim().length < 3
  if (proposal) $("support-checks").textContent = [...new Set([...(proposal.serverWarnings || []), ...check.warnings])].join(" · ") || "자동 검사는 의미 보존을 보증하지 않아요. 뜻과 조건을 직접 대조해 주세요."
}
function showDialogue() {
  if (engine === "local") return showLocalDialogue()
  $("revise-offer").hidden = true
  $("support-dialogue").hidden = !history.length
  $("support-messages").replaceChildren(...history.map(h => { const box = node("div", ""); box.className = "coach-card"; box.append(node("strong", h.role === "user" ? "내 설명" : "함께 정리"), node("p", h.text)); return box }))
  if (reply?.sourceQuote) $("support-messages").append(node("blockquote", `제공 자료의 인용: ${reply.sourceQuote}`))
  const count = history.filter(h => h.role === "user").length
  $("support-count").textContent = `내 답변 ${count}/3 · 모르겠다고 하거나 여기서 마쳐도 괜찮아요.`
  $("rewrite-permission").hidden = !reply?.offerRewrite || declined
  geminiHints()
  controls()
}
function cancel(message = "기다리기를 취소했어요. 입력한 대본과 답변은 그대로예요.") { serial++; pending?.abort(); pending = null; say(message); controls() }
function resetDialogue() {
  history = []; reply = null; proposal = null; ended = false; declined = false; versionId = crypto.randomUUID()
  segHistory = []; segLast = null; segDone = false
  $("support-revision").hidden = true; $("confirm-support-meaning").checked = false; $("share-support").checked = false
}
function changed() {
  cancel("자료가 바뀌었어요. 새 기준으로 함께 살펴보기를 눌러 주세요.")
  resetDialogue()
  if (seg && $("support-script").value !== paragraph?.text) { seg = null; $("location-confirmed").textContent = "대본을 직접 고쳐서 확인한 위치를 해제했어요. 자체 AI 대화는 위치를 다시 확인한 뒤 시작할 수 있어요." }
  remember(); showDialogue()
}
async function refresh() {
  try {
    const res = await fetch("/api/coach/support-status"), info = await res.json()
    ready = res.ok && info.ready === true
    $("support-model").textContent = `${info.model || "Gemini"} · ${info.message || "연결 상태를 확인하지 못했어요."}`
  } catch { ready = false; $("support-model").textContent = "서버에 연결하지 못했어요. 대본은 유지되며 자체 AI 연습을 선택할 수 있어요." }
  try {
    const res = await fetch("/api/model-status"), info = await res.json()
    localReady = res.ok && info.ready === true
    $("local-notice").textContent = `${localReady ? "자체 AI를 사용할 수 있어요." : "자체 AI 모델이 아직 준비되지 않았어요. 상황 질문과 연습 제안은 받을 수 있고, 풀이·수정안은 모델이 준비된 뒤 받을 수 있어요."} 대본·답변은 외부 AI 제공자에게 보내지 않아요.`
  } catch { localReady = false }
  controls()
}

/* ───────── Gemini 도움 대화(기존) ───────── */
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
      showProposal({ original: script, model: body.model, requestId, result: body.result, origin: "gemini-support-rewrite" }, [body.result.reason, body.result.sourceQuote ? `제공 자료의 인용: ${body.result.sourceQuote}` : "별도 근거 자료로 사실을 확인한 수정안은 아니에요."])
      $("rewrite-permission").hidden = true
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
function geminiHints() {
  $("support-hints").replaceChildren(...["표현의 뜻을 함께 정리하고 싶어요.", "다음 문장이 잠깐 생각나지 않았어요.", "일부러 쉬어 간 구간이에요.", "아직 잘 모르겠어요."].map(text => {
    const b = node("button", text); b.type = "button"; b.onclick = () => { $("support-answer").value = text; $("answer-support").click() }; return b
  }))
}
function showProposal(next, reasonLines) {
  proposal = next
  $("support-original").textContent = next.original; $("support-proposal").value = next.result.rewritten; $("support-reason").textContent = reasonLines.filter(Boolean).join("\n")
  $("confirm-support-meaning").checked = false; $("support-revision").hidden = false
  $("support-revision").scrollIntoView({ behavior: "smooth", block: "start" })
}

/* ───────── 자체 AI: 대본 위치 확인 ───────── */
async function prepareLocation() {
  if (!session || !item) return
  $("location-box").hidden = false
  const segments = toSegments(session.transcript)
  const point = pointFromItem(item)
  const scriptVersionId = await scriptVersionIdFor(fullScript)
  $("location-state").textContent = segments.length ? "녹음에서 인식한 말로 이 구간과 가까운 대본 문장을 찾고 있어요." : "이 기록에는 인식된 말이 없어 위치를 추천하지 못해요. 대본에서 해당 문장을 직접 골라 주세요."
  let aligned
  try { aligned = await alignPoint({ script: fullScript, scriptVersionId, segments, point }) }
  catch (error) { $("location-state").textContent = `대본 위치를 찾지 못했어요 (${error.message}). 아래 대본 부분을 직접 골라 Gemini 대화를 이용할 수 있어요.`; $("location-candidates").hidden = $("location-other-label").hidden = true; $("engine-local").disabled = true; setEngine("gemini"); return }
  sentences = aligned.sentences
  const p = aligned.points[0]
  const label = { matched: "이 문장 근처로 보여요. 맞는지 확인해 주세요.", ambiguous: "가까운 문장이 여러 개예요. 맞는 문장을 골라 주세요.", unmatched: "녹음과 대본을 확실히 연결하지 못했어요. 맞는 문장을 직접 골라 주세요." }[p.status]
  $("location-state").textContent = `${Math.floor(point.startSecond)}~${Math.ceil(point.endSecond)}초 · ${item.title} · ${segments.length ? label : "직접 골라 주세요."} ${p.reasons[0]?.message || ""}`
  const legend = $("location-candidates").querySelector("legend")
  $("location-candidates").replaceChildren(legend)
  for (const c of p.candidates) {
    const id = `loc-${c.sentenceId}`, input = Object.assign(document.createElement("input"), { type: "radio", name: "location", id, value: c.sentenceId, checked: c.sentenceId === p.primarySentenceId })
    const lab = node("label", ""); lab.htmlFor = id; lab.append(input, document.createTextNode(` ${c.text}`))
    input.onchange = () => { $("location-other").value = ""; $("confirm-location").disabled = false }
    $("location-candidates").append(lab)
  }
  $("location-candidates").hidden = !p.candidates.length
  const other = $("location-other")
  other.replaceChildren(node("option", "목록에서 고르기"), ...sentences.map(s => { const o = node("option", `${s.id.slice(1)}. ${s.text.slice(0, 60)}`); o.value = s.id; return o }))
  other.firstChild.value = ""
  other.onchange = () => { for (const r of document.querySelectorAll("input[name=location]")) r.checked = false; $("confirm-location").disabled = !other.value }
  $("confirm-location").disabled = !p.primarySentenceId
  $("confirm-location").onclick = async () => {
    const chosen = document.querySelector("input[name=location]:checked")?.value || other.value
    const s = sentences.find(x => x.id === chosen)
    if (!s) return
    const confirmation = p.status === "matched" && chosen === p.primarySentenceId ? "user-confirmed" : "user-selected"
    paragraph = paragraphOf(fullScript, sentences, s.id)
    seg = { practiceId, scriptVersionId, script: fullScript, sources: $("support-sources").value.trim(), point, transcript: { before: p.transcript.before && strip(p.transcript.before), during: p.transcript.during.map(strip), after: p.transcript.after && strip(p.transcript.after) }, selection: { sentenceId: s.id, start: s.start, end: s.end, text: s.text, confirmation, alignmentStatus: p.status, algorithmVersion: aligned.algorithmVersion } }
    selected = { start: paragraph.start, end: paragraph.end, text: paragraph.text }
    $("chunk-label").hidden = true
    $("support-script").value = paragraph.text
    resetDialogue()
    $("location-confirmed").textContent = `확인한 위치: “${s.text}” (${confirmation === "user-confirmed" ? "추천 위치를 확인함" : "직접 고름"}) · 이 문장이 있는 문단을 함께 봐요.`
    say("위치를 확인했어요. ‘함께 살펴보기’를 누르면 이 순간에 어떤 일이 있었는지 먼저 물어볼게요.")
    remember(); showDialogue()
  }
}
const strip = g => ({ startSecond: g.startSecond, endSecond: g.endSecond, text: g.text })

/* ───────── 자체 AI: 구간 대화 ───────── */
async function step(action, turn = null) {
  if (pending || !seg) return
  const token = ++serial
  seg.sources = $("support-sources").value.trim()
  const prior = segLast ? [...segHistory] : [] // 이번 답은 action으로만 보내고, 응답을 받은 뒤 이력에 넣는다
  pending = new AbortController(); controls()
  say("자체 AI가 확인한 위치와 지금까지의 대화를 보고 있어요.")
  try {
    const body = await segmentStep(seg, prior, action, pending.signal)
    if (token !== serial) return
    if (body.pointId !== seg.point.id || body.scriptVersionId !== seg.scriptVersionId) throw new Error("다른 구간의 응답이라 적용하지 않았어요.")
    segHistory = [...prior, ...(turn ? [turn] : []), body.message]
    segLast = body; segDone = body.done
    $("support-answer").value = ""
    say(body.model === "rule" ? "다음 질문이에요. 모르겠다고 하거나 건너뛰어도 괜찮아요." : `자체 AI(${body.model})의 답이에요. 원인은 본인의 설명으로만 확인해요.`)
    showDialogue()
    $("support-dialogue").scrollIntoView({ behavior: "smooth", block: "start" })
  } catch (error) { if (token === serial) say(error.name === "AbortError" ? "기다리기를 취소했어요." : error.message) }
  finally { if (token === serial) { pending = null; controls() } }
}
function respond(action) {
  if (!segLast) return
  const key = segLast.message.questionKey
  const full = { ...action, questionKey: key }
  step(full, userTurn(seg, key, full))
}
function choose(value) {
  if (value === "finish") { segDone = true; say("이 구간 대화를 마쳤어요."); showDialogue(); return }
  if (value === "unknown" || value === "explain" || value === "skip") return respond({ type: value })
  if (segLast.message.questionKey === "situation") return respond({ type: "answer", reason: value })
  respond({ type: "answer", text: value })
}
function showLocalDialogue() {
  $("rewrite-permission").hidden = true
  $("support-dialogue").hidden = !segHistory.length
  $("support-messages").replaceChildren(...segHistory.map(h => {
    const box = node("div", ""); box.className = "coach-card"
    const text = h.role === "coach" ? h.text : h.text || ({ unknown: "잘 모르겠어요", explain: "설명해 주세요", skip: "건너뛸게요" }[h.action] || segLabel(h.reason))
    box.append(node("strong", h.role === "user" ? "내 설명" : "함께 정리"), node("p", text)); return box
  }))
  for (const e of segLast?.summary.evidence || []) $("support-messages").append(node("blockquote", `제공 자료의 인용: ${e.quote}`))
  if (segLast?.summary.unverified.length) $("support-messages").append(node("p", `확인하지 않은 것: ${segLast.summary.unverified.join(" ")}`))
  // 모르겠어요·설명 요청·건너뛰기는 아래 고정 버튼으로 두고 선택지에서는 뺀다(중복 방지)
  $("support-hints").replaceChildren(...(segDone ? [] : segLast?.message.choices || []).filter(c => !["unknown", "explain", "skip"].includes(c.value)).map(c => { const b = node("button", c.label); b.type = "button"; b.onclick = () => choose(c.value); return b }))
  $("support-count").textContent = segLast ? `후속 질문 ${segLast.followupCount}/${segLast.followupLimit} · 모르겠다고 하거나 여기서 마쳐도 괜찮아요.` : ""
  $("revise-offer").hidden = !segDone || Boolean(proposal)
  controls()
}
const segLabel = reason => ({ "intended-pause": "일부러 쉬었어요", "forgot-line": "다음 대사가 기억나지 않았어요", "concept-confusing": "내용(개념)이 헷갈렸어요", "awkward-sentence": "문장이 말하기 어색했어요", other: "직접 쓸게요" }[reason] || "")

/* ───────── 자체 AI: 문단 수정안 ───────── */
async function revise(focus = []) {
  if (pending || !seg || !paragraph) return
  const token = ++serial
  pending = new AbortController(); controls()
  say("나눈 대화를 반영해 이 문단만 고친 초안을 만들고 있어요.")
  try {
    const body = await reviseParagraph(seg, { paragraph, summary: segLast?.summary, history: segHistory, focus }, pending.signal)
    if (token !== serial) return
    if (body.scriptVersionId !== seg.scriptVersionId || body.pointId !== seg.point.id || body.target.start !== paragraph.start || body.target.end !== paragraph.end) throw new Error("다른 대본이나 구간의 수정안이라 적용하지 않았어요.")
    $("revise-focus").replaceChildren()
    if (body.status === "proposed") {
      showProposal({ original: paragraph.text, model: body.model, requestId: body.requestId, result: { rewritten: body.revision.text }, apply: body.apply, serverWarnings: body.preservation.warnings, origin: "self-hosted-segment-revision" },
        [body.revision.reason, ...body.basis.evidence.map(e => `제공 자료의 인용: ${e.quote}`), ...body.basis.unverified, body.preservation.blocked ? "자동 검사에서 수치·보존 문구 변경이 발견돼 그대로는 적용할 수 없어요. 직접 고쳐 주세요." : ""])
      $("revise-offer").hidden = true
      say(`수정 초안을 받았어요. 자체 AI(${body.model}) · 원문과 비교해 확인한 뒤에만 적용해요.`)
    } else {
      $("revise-offer-text").textContent = body.reasons.join(" ")
      for (const c of body.choices || []) { const b = node("button", c.label); b.type = "button"; b.onclick = () => revise([c.value]); $("revise-focus").append(b) }
      say(body.status === "no-change-needed" ? "지금 대본을 바꿀 필요가 없다고 봤어요." : "어떻게 바꾸고 싶은지 골라 주세요.")
    }
  } catch (error) { if (token === serial) say(error.name === "AbortError" ? "기다리기를 취소했어요." : error.message) }
  finally { if (token === serial) { pending = null; controls() } }
}

/* ───────── 이벤트 ───────── */
function setEngine(next) {
  engine = next
  $(next === "gemini" ? "engine-gemini" : "engine-local").checked = true
  cancel("")
  showDialogue()
}
$("engine-local").onchange = () => setEngine("local")
$("engine-gemini").onchange = () => setEngine("gemini")
$("start-support").onclick = () => {
  if (engine === "local") { segHistory = []; segLast = null; segDone = false; proposal = null; $("support-revision").hidden = true; return step({ type: "start" }) }
  history = []; reply = null; proposal = null; ended = false; declined = false; $("support-revision").hidden = true; showDialogue(); run("support-start")
}
$("answer-support").onclick = () => {
  const text = $("support-answer").value.trim()
  if (!text) { say("기억나는 만큼 적거나 ‘잘 모르겠어요’를 선택할 수 있어요."); return }
  if (engine === "local") return segLast?.message.questionKey === "situation" ? respond({ type: "answer", reason: "other", text }) : respond({ type: "answer", text })
  run("support-answer", [...history, { role: "user", text }])
}
$("unknown-support").onclick = () => respond({ type: "unknown" })
$("explain-support").onclick = () => respond({ type: "explain" })
$("request-revision").onclick = () => revise()
$("keep-paragraph").onclick = () => { $("revise-offer").hidden = true; say("지금 대본을 유지해요. 같은 구간을 다시 연습해 볼 수 있어요.") }
$("accept-rewrite").onclick = () => run("support-rewrite")
$("decline-rewrite").onclick = () => { declined = true; $("rewrite-permission").hidden = true; remember(); say("지금 대본을 유지해요. 다음 문장의 핵심어를 짚거나 같은 구간을 다시 연습할 수 있어요.") }
$("skip-support").onclick = () => {
  if (engine === "local" && segLast && !segDone) return respond({ type: "skip" })
  cancel("여기까지 정리했어요. 답하지 않은 이유를 추정하지 않아요."); ended = true; segDone = Boolean(segHistory.length); remember(); showDialogue()
}
$("cancel-support").onclick = () => cancel()
$("share-support").onchange = () => { if (!$("share-support").checked && pending) cancel(); controls() }
$("support-proposal").oninput = () => { $("confirm-support-meaning").checked = false; controls() }
$("confirm-support-meaning").onchange = controls
$("discard-support").onclick = () => { proposal = null; $("support-revision").hidden = true; say("초안을 사용하지 않았어요. 원래 대본은 그대로예요."); showDialogue() }
$("apply-support").onclick = async () => {
  if ($("apply-support").disabled || !proposal) return
  const revised = $("support-proposal").value.trim(), chunk = selected
  try {
    // 자체 AI 수정안은 요청 때와 같은 대본·같은 원문인지 다시 확인한 뒤에만 적용한다(오래된 결과 방지).
    if (proposal.apply && !await canApply(fullScript, proposal.apply)) throw Object.assign(new Error(), { stale: true })
    const newScript = chunk ? replaceSelectedChunk(fullScript, chunk, revised) : revised
    const previous = JSON.parse(localStorage.getItem(PRACTICE_SETTINGS_KEY) || "{}")
    const metadata = { versionId: crypto.randomUUID(), model: proposal.model, requestId: proposal.requestId, createdAt: Date.now(), practiceId, origin: proposal.origin }
    const workspace = supportWorkspace(await loadWorkspace(), proposal.original, revised, $("support-sources").value.trim(), metadata)
    if (!await saveWorkspace(workspace)) throw new Error("새 대본을 보관하지 못했어요.")
    localStorage.setItem(RESTORE_SUPPORT_KEY, JSON.stringify({ script: previous.script, scriptFile: previous.scriptFile || null, appliedScript: newScript }))
    localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify({ ...previous, script: newScript, scriptFile: previous.scriptFile ? { ...previous.scriptFile, edited: true } : null }))
    location.href = "/#/"
  } catch (error) { say(error?.stale ? "수정안을 만든 뒤 대본이 달라져 적용하지 않았어요. 위치를 다시 확인하고 새로 요청해 주세요." : "대본을 저장하지 못했어요. 초안을 복사해 보관한 뒤 다시 시도해 주세요. 기존 녹음은 그대로예요.") }
}
$("undo-support").onclick = () => {
  try {
    const backup = JSON.parse(localStorage.getItem(RESTORE_SUPPORT_KEY) || "null"), raw = JSON.parse(localStorage.getItem(PRACTICE_SETTINGS_KEY) || "{}")
    if (!backup || raw.script !== backup.appliedScript) throw new Error()
    localStorage.setItem(PRACTICE_SETTINGS_KEY, JSON.stringify({ ...raw, script: backup.script || "", scriptFile: backup.scriptFile })); localStorage.removeItem(RESTORE_SUPPORT_KEY)
    $("undo-support").hidden = true; say("직전 적용 전 대본으로 되돌렸어요. 지난 연습 기록은 그대로예요.")
  } catch { say("그 뒤에 대본이 달라져 자동으로 덮어쓰지 않았어요. 대본 이해 연습의 이전 버전을 확인해 주세요.") }
}
$("clear-support").onclick = () => { cancel(""); resetDialogue(); sessionStorage.removeItem(cacheKey); $("support-answer").value = ""; say("이 탭의 대화를 지웠어요. 기존 녹음과 대본은 그대로예요."); showDialogue() }
$("refresh-support").onclick = refresh
for (const id of ["support-script", "support-sources", "support-context"]) $(id).addEventListener("input", changed)

session = practiceId ? await getSession(practiceId) : null
const workspace = await loadWorkspace()
fullScript = typeof session?.script === "string" ? session.script : workspace?.script || ""
item = itemId ? (session?.analysis?.items || []).find(i => i.id === itemId) || null : null
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
// 자체 AI 구간 대화는 연습 기록의 검토 구간에서만 시작할 수 있다(위치 확인이 필요). 그 밖에는 기존 Gemini 대화를 쓴다.
if (!session || !item || fullScript.length > 20000) {
  $("engine-local").disabled = true
  $("local-notice").textContent = "자체 AI 구간 대화는 연습 결과에서 검토 구간을 고른 뒤 시작할 수 있어요."
  engine = "gemini"
  $("engine-gemini").checked = true
} else await prepareLocation()
showDialogue(); await refresh()
