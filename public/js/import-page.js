// 영상·소리 파일 불러오기 화면. 파일에서 소리만 꺼내 긴 침묵을 찾고, 원하면 글자로도 바꿔 연습 결과 화면(#/result/ID)으로 넘긴다.
import { TARGET_RATE, encodeWav } from "./wav.js"
import { analyzeFillers, analyzeSilence, analyzeTranscript, buildReviewItems, classifyResult, conditionKey } from "./analysis.js"
import { decodeToMono16k, planChunks, transcribeChunks, MAX_FILE_BYTES } from "./importer.js"
import { scriptVersionIdFor } from "./segment-flow.js"
import { saveSession } from "./storage.js"
import { analyzeVideoBlinks, readVideoDuration } from "./video-analysis.js"

const app = document.getElementById("app")
const returnToStudio = new URLSearchParams(location.search).get("return") === "studio"

function h(tag, props, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === "class") e.className = v
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === "value" || k === "checked" || k === "disabled" || k === "hidden") e[k] = v
    else e.setAttribute(k, v === true ? "" : String(v))
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return e
}

function show(...nodes) {
  app.replaceChildren(...nodes.filter(Boolean))
  app.focus({ preventScroll: true })
}

function newId() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function readInputs(form, file) {
  const errs = []
  const num = (id) => {
    const v = form.querySelector(`#f-${id}`).value
    return String(v).trim() === "" ? null : Number(v)
  }
  const tmin = num("tmin")
  const tsec = num("tsec")
  let targetSec = null
  if (!file) errs.push("불러올 영상 또는 소리 파일을 골라 주세요.")
  else if (file.size > MAX_FILE_BYTES) errs.push(`파일이 너무 커요. ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 이하 파일을 골라 주세요.`)
  if (tmin === null && tsec === null) errs.push("목표 시간을 입력해 주세요. 분이나 초 중 하나는 꼭 필요해요.")
  else if ([tmin, tsec].some((v) => v !== null && (!Number.isInteger(v) || v < 0))) errs.push("목표 시간은 0 이상의 정수로 적어 주세요.")
  else {
    targetSec = (tmin || 0) * 60 + (tsec || 0)
    if (targetSec < 1) errs.push("목표 시간은 1초 이상이어야 해요.")
  }
  const tol = num("tol") ?? 0
  if (!Number.isInteger(tol) || tol < 0) errs.push("허용 오차는 0 이상의 정수(초)로 적어 주세요.")
  const script = form.querySelector("#f-script").value
  const sources = form.querySelector("#f-sources").value
  if (script.length > 20000) errs.push("대본은 2만 자 이하로 나눠 주세요.")
  if (sources.length > 2400) errs.push("근거 자료는 2,400자 이하로 적어 주세요.")
  return { script, sources, errs, targetSec, tol, wantBlink: form.querySelector("#f-blink").checked, wantText: form.querySelector("#f-text").checked, raw: { tmin: form.querySelector("#f-tmin").value, tsec: form.querySelector("#f-tsec").value, tol: String(tol) } }
}

function renderForm() {
  const errors = h("div", { class: "errors", role: "alert", hidden: true })
  const file = h("input", { id: "f-file", type: "file", accept: "video/*,audio/*,.mp4,.m4a,.mp3,.wav,.webm,.mov" })
  const text = h("input", { id: "f-text", type: "checkbox" })
  let draft = {}
  if (returnToStudio) { try { draft = JSON.parse(localStorage.getItem("dasibom.studio") || "{}") } catch {} }
  const modelState = h("p", { class: "info", id: "import-model-state", "data-ai-ready": "pending", role: "status" }, "음성 인식 연결을 확인하고 있어요…")
  fetch("/api/model-status", { signal: AbortSignal.timeout(10000) }).then(async res => {
    if (!res.ok) throw Error()
    const info = await res.json()
    const ready = info.transcriptionConfigured && info.runtime?.transcriptionReady !== false
    modelState.dataset.aiReady = String(Boolean(ready))
    modelState.textContent = ready ? "음성 인식이 설정돼 있어요. 글자 변환을 선택하면 소리만 전송하며 API 사용량이 발생해요." : "AI 미설정: 글자 변환 없이도 로컬 소리·눈 깜빡임 분석은 가능해요."
  }).catch(() => { modelState.dataset.aiReady = "false"; modelState.textContent = "음성 인식 상태를 확인하지 못했어요. 글자 변환 없이 로컬 분석할 수 있어요." })
  const form = h(
    "form",
    { novalidate: true },
    h(
      "fieldset",
      null,
      h("legend", null, "파일"),
      h("div", null, h("label", { class: "hint", for: "f-file" }, "영상 또는 소리 파일 (mp4, m4a, mp3, wav, webm)")),
      file,
      h("p", { class: "hint" }, "파일에서 소리만 이 브라우저 안에서 꺼내요. 영상 파일은 서버로 보내지 않고 이 브라우저 안에만 저장해요."),
    ),
    h(
      "fieldset",
      null,
      h("legend", null, "목표 시간"),
      h(
        "div",
        { class: "row" },
        h("div", { class: "field" }, h("label", { for: "f-tmin" }, "분"), h("input", { id: "f-tmin", type: "number", min: "0", inputmode: "numeric", "aria-label": "목표 시간 분" })),
        h("div", { class: "field" }, h("label", { for: "f-tsec" }, "초"), h("input", { id: "f-tsec", type: "number", min: "0", inputmode: "numeric", "aria-label": "목표 시간 초" })),
        h("div", { class: "field" }, h("label", { for: "f-tol" }, "허용 오차(초)"), h("input", { id: "f-tol", type: "number", min: "0", inputmode: "numeric", value: "0" })),
      ),
      h("p", { class: "hint" }, "불러온 파일의 길이를 총 연습 시간으로 보고 목표와 비교해요."),
    ),
    h("fieldset", null,
      h("legend", null, "영상의 대본·근거 자료 (선택)"),
      h("label", { for: "f-script" }, "영상 대본"),
      h("textarea", { id: "f-script", class: "input", rows: "5", maxlength: "20000", value: draft.script || "", "aria-label": "영상 대본" }),
      h("label", { for: "f-sources" }, "근거 자료"),
      h("textarea", { id: "f-sources", class: "input", rows: "2", maxlength: "2400", value: draft.evidence || "", "aria-label": "근거 자료" }),
      h("p", { class: "hint" }, "영상에서 말한 대본을 넣으면 분석 후 스튜디오에서 문장 위치를 확인하고 AI와 대화할 수 있어요. 내용과 원음을 직접 대조해 주세요.")),
    h(
      "fieldset",
      null,
      h("legend", null, "글자 변환 (선택)"),
      modelState,
      h("div", { class: "check" }, text, h("label", { for: "f-text" }, "글자로도 바꿔서 말하기 속도·반복 표현 분석")),
      h(
        "p",
        { class: "info" },
        "켜면 영상은 보내지 않고, 이 브라우저가 꺼낸 소리(16kHz 모노, 약 20초 조각)만 서버에 설정된 음성 인식(자체 AI 또는 주최 측 Vercel AI Gateway)으로 전송돼요. 켜지 않으면 파일과 소리는 이 브라우저 밖으로 나가지 않고, 긴 침묵 찾기만 해요.",
      ),
    ),
    errors,
    h("div", { class: "check" }, h("input", { id: "f-blink", type: "checkbox" }), h("label", { for: "f-blink" }, "영상 눈 깜빡임도 이 기기에서 분석 (선택)")),
    h("p", { class: "hint" }, "눈 깜빡임은 영상 파일만 분석해요. 영상·얼굴은 전송하지 않으며, 군말 후보 집계는 위 글자 변환을 켠 경우에만 가능해요."),
    h("button", { type: "submit", class: "btn btn-primary" }, "분석 시작"),
  )
  form.addEventListener("submit", (ev) => {
    ev.preventDefault()
    const f = file.files?.[0] || null
    const input = readInputs(form, f)
    if (input.errs.length) {
      errors.replaceChildren(h("strong", null, "입력을 확인해 주세요."), h("ul", null, input.errs.map((e) => h("li", null, e))))
      errors.hidden = false
      errors.scrollIntoView({ block: "nearest" })
      return
    }
    run(f, input)
  })
  show(
    h("h1", null, "영상·소리 파일 불러오기"),
    h("p", { class: "lead" }, "이미 녹음하거나 녹화한 연습 파일에서 소리를 꺼내, 처음부터 다시 보지 않고 확인할 구간부터 볼 수 있게 해요."),
    h("div", { class: "card", "aria-label": "불러오기 설정" }, form),
  )
}

function renderFailure(message) {
  show(
    h("h1", null, "파일을 분석하지 못했어요"),
    h("div", { class: "errors", role: "alert" }, message),
    h("p", null, h("a", { href: "/import.html" }, "다른 파일로 다시 해 보기")),
  )
}

async function run(file, input) {
  const isVideo = file.type.startsWith("video/") || (!file.type && /\.(mp4|webm|mov)$/i.test(file.name))
  const status = h("p", { class: "lead", role: "status", id: "import-status" }, "소리를 꺼내는 중이에요…")
  show(h("h1", null, "분석하고 있어요"), status)
  let decoded
  try {
    decoded = await decodeToMono16k(file)
  } catch (e) {
    if (!isVideo) return renderFailure(e?.message || String(e))
    try { decoded = { samples: new Float32Array(0), durationSec: await readVideoDuration(file) } }
    catch { return renderFailure(e?.message || String(e)) }
  }
  const { samples, durationSec } = decoded
  const total = Math.floor(durationSec)
  const notices = [`불러온 파일의 소리를 이 브라우저 안에서 분석했어요. 영상 파일은 서버로 보내지 않았어요.`]
  if (!samples.length) notices[0] = "영상의 소리를 읽지 못해 소리 분석·글자 변환은 하지 않았어요. 영상은 이 기기에만 저장하고 눈 깜빡임을 분석할 수 있어요."

  status.textContent = "긴 침묵을 찾는 중이에요…"
  await new Promise((r) => setTimeout(r, 0))
  const silence = analyzeSilence(samples, TARGET_RATE)
  if (silence.status === "no-signal") notices.push("파일에 소리가 거의 없어서 긴 침묵을 찾지 않았어요.")
  if (silence.status === "too-short") notices.push("파일이 너무 짧아서 긴 침묵을 찾지 않았어요.")

  let transcript = null
  let segments = []
  let speechState = "off"
  if (input.wantText && samples.length) {
    const chunks = planChunks(samples, TARGET_RATE)
    status.textContent = `글자로 바꾸는 중이에요… (0/${chunks.length})`
    const res = await transcribeChunks(samples, chunks, {
      onProgress: (done, all) => {
        status.textContent = `글자로 바꾸는 중이에요… (${done}/${all})`
      },
    })
    if (res.status === "ok") {
      segments = res.segments
      transcript = analyzeTranscript(segments, total)
      speechState = transcript.status === "ok" ? "ok" : "no-text"
      notices.push("소리 조각을 서버에 설정된 음성 인식으로 글자로 바꿨어요. 오인식이 있을 수 있어요.")
    } else {
      speechState = "error"
      notices.push(
        res.status === "partial"
          ? `${res.message} 일부만 바뀐 글로는 속도·반복 표현을 믿을 수 없어서 분석하지 않았어요.`
          : `글자로 바꾸지 못해서 속도·반복 표현은 분석하지 않았어요: ${res.message} 긴 침묵 찾기는 그대로 했어요.`,
      )
    }
  }

  let blink = null
  if (input.wantBlink) {
    const controller = new AbortController()
    const cancel = h("button", { type: "button", onclick: () => controller.abort() }, "눈 깜빡임 분석 취소")
    app.append(cancel)
    blink = await analyzeVideoBlinks(isVideo ? file : null, { signal: controller.signal, onProgress: (at, all, message) => { status.textContent = `${message} ${Math.floor(at / all * 100)}%` } })
    cancel.remove()
  }
  const fillers = speechState === "ok" ? analyzeFillers(segments) : null
  const items = buildReviewItems({ silence, transcript, blink, sectionRows: [], toleranceSec: input.tol, fillers })
  const result = classifyResult(total, input.targetSec, input.tol)
  const settings = {
    targetSec: input.targetSec, toleranceSec: input.tol, warnSec: 0, speedMin: null, speedMax: null,
    sections: [], planSignature: "", recordAudio: true, recordVideo: false, speechRequested: input.wantText,
    raw: { tmin: input.raw.tmin, tsec: input.raw.tsec, tol: input.raw.tol, warn: "0", smin: "", smax: "", plan: "", audio: true, video: false, speech: false },
  }
  const session = {
    id: newId(),
    createdAt: Date.now(),
    source: { kind: "import", name: file.name, type: file.type || "", bytes: file.size },
    settings,
    conditionKey: conditionKey(input.targetSec, ""),
    totalSec: total,
    result,
    marks: [],
    sectionRows: [],
    media: { audio: samples.length ? "ok" : "off", video: isVideo ? "ok" : "off", speech: speechState, speechDetail: "" },
    analysis: { silence: { status: silence.status, threshold: silence.threshold, voicedRatio: silence.voicedRatio }, transcript, blink, fillers: fillers && { count: fillers.count, times: fillers.times }, gaze: { status: "off" }, items },
    transcript: segments,
    script: input.script,
    sources: input.sources,
    scriptVersionId: input.script ? await scriptVersionIdFor(input.script) : null,
    audioBlob: samples.length ? encodeWav(samples, TARGET_RATE) : null,
    videoBlob: isVideo ? file : null,
    notices,
  }
  status.textContent = "결과를 저장하는 중이에요…"
  const saved = await saveSession(session)
  if (!saved.ok) session.notices.push(`기록을 이 기기에 저장하지 못했어요 (${saved.error}). 이 화면을 닫으면 다시 볼 수 없어요.`)
  if (!saved.ok) return renderFailure(`기록을 이 기기에 저장하지 못해서 결과 화면으로 넘어갈 수 없어요 (${saved.error}).`)
  location.href = returnToStudio ? `/studio.html?session=${encodeURIComponent(session.id)}` : `/#/result/${session.id}`
}

renderForm()
