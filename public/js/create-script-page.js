import { loadWorkspace, saveWorkspace } from "./coach-store.js"
import { workspaceWithGeneratedDraft } from "./draft-workspace.js"

const $ = id => document.getElementById(id)
let ready = false, controller = null, token = 0, draft = null, applying = false
function controls() {
  $("generate-script").disabled = !ready || Boolean(controller) || applying
  $("cancel-generation").hidden = !controller
  $("use-generated").disabled = !draft || applying || Boolean(controller) || !$("confirm-generated").checked || $("generated-script").value.trim().length < 3
}
async function refresh() {
  try {
    const response = await fetch("/api/scripts/generation-status")
    const info = await response.json()
    ready = response.ok && info.ready === true
    $("generation-state").textContent = info.message || "대본 생성 연결을 확인하지 못했어요."
    if (info.processingNotice) $("generation-notice").textContent = info.processingNotice
  } catch { ready = false; $("generation-state").textContent = "서버에 연결하지 못했어요. 기존 대본으로 자체 AI 연습을 이어갈 수 있어요." }
  controls()
}
function invalidate() {
  token++; controller?.abort(); controller = null; draft = null
  $("generated-result").hidden = true; $("confirm-generated").checked = false
  $("generation-request-state").textContent = "주제와 자료가 바뀌었어요. 새 기준으로 대본을 만들 수 있어요."
  controls()
}
$("generate-script").onclick = async () => {
  if (controller) return
  const topic = $("topic").value.trim(), sources = $("generation-sources").value.trim()
  if (topic.length < 3) { $("generation-request-state").textContent = "발표 주제를 3자 이상 입력해 주세요."; $("topic").focus(); return }
  const requestId = crypto.randomUUID(), versionId = crypto.randomUUID(), current = ++token
  controller = new AbortController(); controls(); $("generation-request-state").textContent = "Gemini가 새 대본 초안을 만들고 있어요. 취소할 수 있어요."
  try {
    const response = await fetch("/api/scripts/generate", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ task: "generate", topic, sources, requestId, versionId }) })
    const body = await response.json()
    if (current !== token) return
    if (!response.ok) throw new Error(body.message || "새 대본을 받지 못했어요.")
    if (body.requestId !== requestId || body.versionId !== versionId) throw new Error("이전 요청의 대본은 적용하지 않았어요.")
    draft = { ...body.result, sources, model: body.model, requestId }
    $("draft-title").textContent = body.result.title; $("generated-script").value = body.result.script
    $("draft-notes").textContent = body.result.notes; $("confirm-generated").checked = false
    $("generated-result").hidden = false
    $("generation-request-state").textContent = `초안을 만들었어요. 모델 ${body.model}. 내용을 확인한 뒤 자체 AI 이해 연습으로 이어갈 수 있어요.`
  } catch (error) {
    if (current === token) $("generation-request-state").textContent = error.name === "AbortError" ? "생성을 취소했어요. 입력 자료는 그대로예요." : error.message
  } finally { if (current === token) { controller = null; await refresh() } }
}
$("use-generated").onclick = async () => {
  if (!draft || !$("confirm-generated").checked || applying || controller) return
  applying = true; controls()
  try {
    const workspace = workspaceWithGeneratedDraft(await loadWorkspace(), { ...draft, script: $("generated-script").value }, crypto.randomUUID(), Date.now())
    if (!await saveWorkspace(workspace)) throw new Error("브라우저에 저장하지 못했어요. 초안을 복사해 보관한 뒤 다시 시도해 주세요.")
    location.href = "/coach.html"
  } catch (error) { $("generation-request-state").textContent = error.message; applying = false; controls() }
}
for (const id of ["topic", "generation-sources"]) $(id).addEventListener("input", invalidate)
$("generated-script").addEventListener("input", () => { $("confirm-generated").checked = false; controls() })
$("confirm-generated").onchange = controls
$("cancel-generation").onclick = () => { token++; controller?.abort(); controller = null; $("generation-request-state").textContent = "생성을 취소했어요. 입력 자료는 그대로예요."; controls() }
$("generation-refresh").onclick = refresh
await refresh()
