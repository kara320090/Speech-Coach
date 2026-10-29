// 다시봄 스튜디오(/studio.html): 대본 준비 → 웹캠 연습 → 결과 분석 → 구간 AI 코칭 → 문단 수정 → 다시 연습.
// 화면은 Figma Make 시안(dasibom-site)을 옮겼고, 시연용 값 대신 실제 기능을 연결했다.
//  - 대본 파일: POST /api/scripts/import            (docs/script-import-api.md)
//  - 웹캠·마이크 기록: MediaCapture(getUserMedia + MediaRecorder), 녹음은 이 기기에서 분석
//  - 음성 전사: POST /api/transcribe(analyzeRecordedSpeech)  (docs/import-feature.md)
//  - 검토 시점 ↔ 대본 문장: POST /api/scripts/align  (docs/script-align-api.md)
//  - 구간 코칭: POST /api/coach/segment               (docs/segment-coach-api.md)
//  - 문단 수정안: POST /api/scripts/revise-segment     (docs/contextual-revision-api.md)
// 연습 기록은 메인 화면과 같은 IndexedDB 세션 형식(docs/ui-api-spec.md 4.1)으로 저장해 '연습 기록'에서도 보인다.
import { MediaCapture } from "./recorder.js"
import { analyzeSilence, buildReviewItems, classifyResult, conditionKey, windowMetrics } from "./analysis.js"
import { analyzeRecordedSpeech } from "./recording-analysis.js"
import { saveSession } from "./storage.js"
import { checkRevision } from "./content-check.js"
import { formatClock, formatKorean, pad2 } from "./time.js"

const PREFS_KEY = "dasibom.studio"
const SCRIPT_LIMIT = 20000 // /api/scripts/align·/api/coach/segment 대본 한도
const SOURCES_LIMIT = 2400 // 근거 자료 한도(기존 코칭과 같음)
const PARAGRAPH_LIMIT = 2400 // /api/scripts/revise-segment 대상 문단 한도
const COACH_TYPES = new Set(["manual", "silence", "repeat", "filler", "gaze", "speed", "section"]) // /api/coach/segment가 받는 관찰 종류
const TONE = { manual: "violet", silence: "violet", repeat: "amber", filler: "amber", speed: "blue", gaze: "blue", section: "blue" }

const EXAMPLE_SCRIPT = `안녕하세요. 오늘은 작은 습관이 만드는 큰 변화에 대해 이야기해 보겠습니다.

우리는 보통 거창한 계획이 있어야 삶을 바꿀 수 있다고 생각합니다. 하지만 실제 변화는 매일 반복하는 아주 작은 행동에서 시작됩니다.

예를 들어 하루에 단 10분씩 책을 읽는 습관은 당장 눈에 띄는 결과를 만들지는 않습니다. 하지만 한 달, 일 년이 지나면 그 시간은 분명한 차이를 만듭니다.

중요한 것은 완벽하게 해내는 것이 아니라, 다시 시작할 수 있는 환경을 만드는 것입니다.

오늘부터 여러분도 부담 없이 시작할 수 있는 한 가지 행동을 정해 보세요. 작은 시작이 여러분의 내일을 바꿀 수 있습니다.`

const STAGES = [
  { id: "prepare", label: "대본 준비", short: "준비" },
  { id: "practice", label: "발표 연습", short: "연습" },
  { id: "results", label: "결과 분석", short: "분석" },
  { id: "coach", label: "AI 코칭", short: "코칭" },
  { id: "revision", label: "대본 수정", short: "수정" },
  { id: "repractice", label: "다시 연습", short: "비교" },
]

const SITUATION_FALLBACK = "other"
const FOCUS_LABELS = { "plain-terms": "어려운 용어 풀기", "split-sentences": "긴 문장 나누기", "spoken-style": "말하기 쉬운 구어체" }

/* ───────── 작은 DOM 도구 ───────── */

const PROPS = new Set(["value", "muted", "checked", "srcObject", "playsInline", "autoplay", "controls", "disabled", "selected"])
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  if (tag === "button" && !props.type) el.type = "button"
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === "class") el.className = v
    else if (k === "text") el.textContent = v
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v)
    else if (k === "style") Object.assign(el.style, v) // CSSOM이라 CSP(인라인 style 차단)에 걸리지 않는다
    else if (PROPS.has(k)) el[k] = v
    else el.setAttribute(k, v === true ? "" : String(v))
  }
  append(el, kids)
  return el
}
function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
  }
  return el
}

const SVG_NS = "http://www.w3.org/2000/svg"
const ICONS = {
  arrow: [["path", { d: "m5 12 14 0m-5-5 5 5-5 5" }]],
  chart: [["path", { d: "M4 19V9M10 19V5M16 19v-7M22 19H2" }], ["path", { d: "m4 8 6-4 6 7 5-5" }]],
  check: [["path", { d: "m5 12 4 4L19 6" }]],
  chevron: [["path", { d: "m9 18 6-6-6-6" }]],
  clock: [["circle", { cx: 12, cy: 12, r: 9 }], ["path", { d: "M12 7v5l3 2" }]],
  edit: [["path", { d: "M4 20h4l11-11-4-4L4 16z" }], ["path", { d: "m13 7 4 4M4 20h16" }]],
  file: [["path", { d: "M7 3h7l4 4v14H7z" }], ["path", { d: "M14 3v5h5M10 13h5M10 17h5" }]],
  home: [["path", { d: "m3 11 9-8 9 8" }], ["path", { d: "M5 10v10h14V10M9 20v-6h6v6" }]],
  pause: [["path", { d: "M8 6v12M16 6v12" }]],
  play: [["path", { d: "m8 5 11 7-11 7z" }]],
  record: [["circle", { cx: 12, cy: 12, r: 7, fill: "currentColor", stroke: "none" }]],
  shield: [["path", { d: "M12 3 4.5 6v5.5c0 4.4 3.1 7.8 7.5 9.5 4.4-1.7 7.5-5.1 7.5-9.5V6z" }], ["path", { d: "m8.5 12 2.2 2.2 4.8-5" }]],
  sparkle: [["path", { d: "M12 3c.4 4.5 2.5 6.6 7 7-4.5.4-6.6 2.5-7 7-.4-4.5-2.5-6.6-7-7 4.5-.4 6.6-2.5 7-7Z" }], ["path", { d: "M19 16c.2 1.8 1.1 2.8 3 3-1.9.2-2.8 1.2-3 3-.2-1.8-1.1-2.8-3-3 1.9-.2 2.8-1.2 3-3Z" }]],
  upload: [["path", { d: "M12 16V4m-5 5 5-5 5 5" }], ["path", { d: "M5 14v6h14v-6" }]],
  video: [["rect", { x: 3, y: 6, width: 13, height: 12, rx: 2 }], ["path", { d: "m16 10 5-3v10l-5-3" }]],
}
function icon(name, size = 20) {
  const svg = document.createElementNS(SVG_NS, "svg")
  for (const [k, v] of Object.entries({ "aria-hidden": "true", class: "icon", fill: "none", width: size, height: size, viewBox: "0 0 24 24" })) svg.setAttribute(k, v)
  for (const [tag, attrs] of ICONS[name]) {
    const node = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    svg.append(node)
  }
  return svg
}

const mmss = (sec) => {
  const s = Math.max(0, Math.floor(sec + 1e-9))
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)
const newId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const requestId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const pointIdOf = (item) => `item-${item.id}`
/** 측정값의 앞부분(예: "4.9초")만. 괄호 안 시각·기준값은 화면의 시각 표시와 겹친다. */
const shortMeasured = (item) => clip(String(item.measured || "").split(/\s*[(,]/)[0].trim(), 80)
const time = (sec) => Math.round(Math.min(14400, Math.max(0, sec)) * 100) / 100

async function postJson(url, body, signal) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(data?.message || "요청을 처리하지 못했어요. 원문은 보존돼요."), { code: data?.error, status: res.status })
  return data
}

async function sha256Hex(text) {
  if (!crypto?.subtle) return null
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/* ───────── 상태 ───────── */

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}
  } catch {
    return {}
  }
}
const prefs = loadPrefs()

const state = {
  onboarding: !prefs.onboarded,
  stage: "prepare",
  maxReached: 0,
  script: typeof prefs.script === "string" ? prefs.script : EXAMPLE_SCRIPT,
  scriptSource: prefs.scriptSource || (typeof prefs.script === "string" ? "edit" : "example"),
  evidence: typeof prefs.evidence === "string" ? prefs.evidence : "",
  targetMinutes: [3, 5, 10].includes(prefs.targetMinutes) ? prefs.targetMinutes : 5,
  versions: Array.isArray(prefs.versions) ? prefs.versions : [], // { id, script, createdAt, from, basedOn? }
  cameraId: prefs.cameraId || "",
  micId: prefs.micId || "",
  devices: { cams: [], mics: [] },
  file: { status: "idle", name: "", note: "", pending: null, controller: null },
  aiConsent: false,
  transcribe: false,
  manualSecond: 0,
  model: null, // GET /api/model-status
  session: null, // 원본 연습 기록
  analysis: { running: false, progress: "", controller: null },
  align: null, // { status: "loading" | "ok" | "error" | "none", data?, message? }
  selected: 0,
  pick: null, // { sentenceId, confirmation }
  choosingSentence: false,
  coach: null, // { pointId, history, log, last, busy, controller, error, draft }
  revision: null, // { pointId, busy, controller, error, data, proposal, editing, focus, requestText, localCheck }
  applied: null, // 적용한 수정 { pointId, paragraphIndex, text, baseVersionId, versionId }
  repractice: null, // { session, running }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      onboarded: !state.onboarding || prefs.onboarded,
      script: state.script,
      scriptSource: state.scriptSource,
      evidence: state.evidence,
      targetMinutes: state.targetMinutes,
      versions: state.versions.slice(-20),
      cameraId: state.cameraId,
      micId: state.micId,
    }))
  } catch {
    /* 저장소를 못 써도 화면은 계속 쓴다 */
  }
}

/** 지금 대본의 버전 ID. 마지막 버전과 내용이 다르면 새 버전을 만든다(원본 버전은 남긴다). */
function currentVersionId(from = state.scriptSource) {
  const last = state.versions[state.versions.length - 1]
  if (last && last.script === state.script) return last.id
  const id = `v${state.versions.length + 1}-${Date.now().toString(36)}`
  state.versions.push({ id, script: state.script, createdAt: Date.now(), from })
  savePrefs()
  return id
}
const versionLabel = (id) => {
  const i = state.versions.findIndex((v) => v.id === id)
  return i >= 0 ? `버전 ${i + 1}` : "버전 1"
}

/* ───────── 웹캠·마이크 ───────── */

const cam = { capture: null, status: "idle", notice: "", el: null, wanted: false }

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return
  try {
    const list = await navigator.mediaDevices.enumerateDevices()
    state.devices.cams = list.filter((d) => d.kind === "videoinput")
    state.devices.mics = list.filter((d) => d.kind === "audioinput")
  } catch {
    /* 장치 목록을 못 읽어도 기본 장치로 연다 */
  }
}

function previewEl() {
  if (!cam.el) cam.el = h("video", { class: "live-video", muted: true, autoplay: true, playsInline: true, "aria-label": "웹캠 미리보기" })
  if (cam.capture && cam.el.srcObject !== cam.capture.stream) cam.el.srcObject = cam.capture.stream
  if (!cam.capture) cam.el.srcObject = null
  return cam.el
}

async function openCamera() {
  cam.wanted = true
  if (cam.capture || cam.status === "connecting") return
  cam.status = "connecting"
  cam.notice = ""
  refreshCamViews()
  const { capture, notices, status } = await MediaCapture.open({ audio: true, video: true, audioDeviceId: state.micId, videoDeviceId: state.cameraId })
  if (!cam.wanted) {
    capture?.release()
    cam.status = "idle"
    return
  }
  cam.capture = capture
  cam.status = !capture ? "failed" : status.video === "ok" ? "ready" : "audio"
  cam.notice = notices.join(" ")
  await refreshDevices()
  if (rec.running) refreshCamViews()
  else render() // 녹화 버튼·상태 표시까지 다시 그린다
}

function releaseCamera() {
  cam.wanted = false
  cam.capture?.release()
  cam.capture = null
  cam.status = "idle"
  if (cam.el) cam.el.srcObject = null
}

const CAM_TEXT = {
  idle: "카메라를 연결하지 않았어요",
  connecting: "카메라·마이크 권한을 요청하고 있어요…",
  ready: "카메라·마이크 연결됨",
  audio: "마이크만 연결됨 · 영상 없이 소리만 기록해요",
  failed: "카메라·마이크를 쓸 수 없어요",
}

let camViews = [] // 다시 그릴 미리보기 칸들
function refreshCamViews() {
  camViews = camViews.filter((v) => v.isConnected)
  for (const v of camViews) fillLivePreview(v)
  for (const el of document.querySelectorAll("[data-cam-status]")) el.textContent = CAM_TEXT[cam.status]
}

function fillLivePreview(box) {
  box.classList.toggle("video-preview--media", cam.status === "ready")
  if (cam.status === "ready") {
    box.replaceChildren(previewEl(), h("div", { class: "video-demo-label", text: "실시간 미리보기 · 좌우 반전" }))
    cam.el.play?.().catch(() => {})
    return
  }
  box.replaceChildren(
    h("div", { class: "cam-state" },
      h("strong", { text: CAM_TEXT[cam.status] }),
      cam.notice && h("p", { text: cam.notice }),
      cam.status === "failed" && h("p", { text: "브라우저 주소창의 카메라 권한을 확인한 뒤 다시 연결해 주세요. 연결하지 않아도 시간은 잴 수 있어요." }),
      (cam.status === "failed" || cam.status === "idle") && h("button", { class: "button button--soft", onclick: () => openCamera() }, icon("video", 16), "카메라 연결"),
    ),
  )
}

function livePreview() {
  const box = h("div", { class: "video-preview video-preview--live" })
  camViews.push(box)
  fillLivePreview(box)
  return box
}

/* 녹화 영상 다시 보기: 같은 Blob이면 같은 요소를 다시 써서 재생 위치를 지킨다. */
const players = new Map() // Blob → { url, el }
function playerFor(blob, label = "연습 영상 다시 보기") {
  let p = players.get(blob)
  if (!p) {
    const url = URL.createObjectURL(blob)
    const el = h("video", { class: "playback-video", controls: true, preload: "metadata", playsInline: true, "aria-label": label })
    el.src = url
    // MediaRecorder가 만든 webm은 길이를 모를 수 있어 끝으로 한 번 옮겨 길이를 읽고, 길이가 정해지면 처음으로 돌린다.
    el.addEventListener("loadedmetadata", () => {
      if (el.duration !== Infinity) return
      const back = () => {
        if (!Number.isFinite(el.duration)) return
        el.removeEventListener("durationchange", back)
        el.currentTime = 0
      }
      el.addEventListener("durationchange", back)
      el.currentTime = 1e7
    }, { once: true })
    p = { url, el }
    players.set(blob, p)
  }
  return p.el
}

function playbackBox(blob, { compact = false, label } = {}) {
  const box = h("div", { class: `video-preview video-preview--media ${compact ? "video-preview--compact" : ""}` })
  if (blob) box.append(playerFor(blob, label))
  else box.append(h("div", { class: "cam-state" }, h("strong", { text: "녹화된 영상이 없어요" }), h("p", { text: "카메라 없이 연습했거나 영상 기록에 실패했어요. 소리·시간 측정 결과는 그대로 볼 수 있어요." })))
  return box
}

function seekPlayer(blob, sec, { play = false } = {}) {
  const el = blob && players.get(blob)?.el
  if (!el) return
  try {
    el.currentTime = Math.max(0, sec)
    if (play) el.play().catch(() => {})
  } catch {
    /* 길이를 아직 못 읽음 */
  }
}

/* ───────── 녹화 ───────── */

const rec = { running: false, paused: false, startAt: 0, pausedMs: 0, pauseAt: 0, timer: null, kind: null, notices: [] }
const elapsedSec = () => {
  if (!rec.running) return 0
  const now = performance.now()
  return (now - rec.startAt - rec.pausedMs - (rec.paused ? now - rec.pauseAt : 0)) / 1000
}
let tickers = [] // { elapsed, remaining, level }

async function startRecording(kind) {
  if (rec.running) return
  rec.kind = kind
  rec.notices = []
  if (!cam.capture) rec.notices.push(cam.notice || "마이크·카메라 없이 시간만 쟀어요. 음성 측정은 할 수 없지만 검토 시점을 직접 골라 코칭할 수 있어요.")
  try {
    await cam.capture?.start({ recordVideo: true })
  } catch (e) {
    rec.notices.push(`녹음을 시작하지 못했어요 (${e?.message || e}). 시간만 재요.`)
  }
  rec.running = true
  rec.paused = false
  rec.startAt = performance.now()
  rec.pausedMs = 0
  rec.timer = setInterval(tick, 200)
  render()
}

function togglePause() {
  if (!rec.running) return
  if (rec.paused) {
    rec.pausedMs += performance.now() - rec.pauseAt
    rec.paused = false
    cam.capture?.resume()
  } else {
    rec.pauseAt = performance.now()
    rec.paused = true
    cam.capture?.pause()
  }
  render()
}

function tick() {
  const sec = elapsedSec()
  const target = state.targetMinutes * 60
  for (const t of tickers) {
    if (t.elapsed) t.elapsed.textContent = mmss(sec)
    if (t.remaining) t.remaining.textContent = sec > target ? `+${mmss(sec - target)}` : mmss(target - sec)
    if (t.level) t.level.style.width = `${Math.min(100, Math.round((cam.capture?.level || 0) * 600))}%`
  }
}

async function stopRecording() {
  if (!rec.running) return
  const durationSec = elapsedSec()
  clearInterval(rec.timer)
  rec.running = false
  rec.paused = false
  const status = cam.capture ? { ...cam.capture.status } : { audio: "failed", video: "failed" }
  let out = { samples: new Float32Array(0), sampleRate: 16000, wavBlob: null, videoBlob: null }
  if (cam.capture) {
    try {
      out = await cam.capture.stop({ keepStream: true })
    } catch (e) {
      rec.notices.push(`녹음을 마무리하지 못했어요 (${e?.message || e}).`)
    }
  }
  releaseCamera() // 분석 중에는 카메라를 끈다
  return { ...out, durationSec, status, notices: rec.notices }
}

/* ───────── 분석(메인 화면 analyze()와 같은 순서: 저장 → 자체 전사 → 다시 저장) ───────── */

function makeSession({ out, script, scriptVersionId, practiceOf = null }) {
  const targetSec = state.targetMinutes * 60
  const total = Math.floor(out.durationSec)
  const audioOk = out.samples.length > 0 && out.status.audio === "ok"
  const notices = [...out.notices]
  if (out.status.audio === "ok" && !out.samples.length) notices.push("기록된 소리가 없어요. 녹음 길이가 너무 짧았을 수 있어요.")
  const silence = audioOk ? analyzeSilence(out.samples, out.sampleRate) : null
  if (silence?.status === "no-signal") notices.push("녹음에 소리가 거의 없어서 긴 침묵을 찾지 않았어요. 마이크 연결을 확인해 주세요.")
  if (silence?.status === "too-short") notices.push("녹음이 너무 짧아서 긴 침묵을 찾지 않았어요.")
  const gaze = { status: "off", segments: [], offSec: 0 }
  const settings = { targetSec, toleranceSec: 0, warnSec: 30, speedMin: 0, speedMax: 0, sections: [], planSignature: "", recordAudio: true, recordVideo: true, speechRequested: false, transcribe: state.transcribe, raw: null }
  return {
    session: {
      id: newId(),
      createdAt: Date.now(),
      settings,
      conditionKey: practiceOf ? `practice#${practiceOf.baseId}#${practiceOf.itemId}` : conditionKey(targetSec, ""),
      totalSec: total,
      result: classifyResult(total, targetSec, 0),
      marks: [],
      sectionRows: [],
      media: { audio: audioOk ? "ok" : out.status.audio === "ok" ? "failed" : out.status.audio, video: out.videoBlob ? "ok" : "failed", speech: audioOk ? "pending" : "no-audio", speechDetail: "" },
      analysis: { silence: silence && { status: silence.status, threshold: silence.threshold, voicedRatio: silence.voicedRatio }, transcript: null, fillers: null, gaze, items: buildReviewItems({ silence, transcript: null, gaze }) },
      script,
      scriptVersionId,
      conds: { keywords: false, progress: false, countdown: false },
      practiceOf,
      coaching: {},
      transcript: [],
      audioBlob: audioOk ? out.wavBlob : null,
      videoBlob: out.videoBlob,
      notices,
      source: { kind: "studio" },
    },
    silence,
    gaze,
    audioOk,
  }
}

async function analyzeSession({ session, silence, gaze, audioOk }, samples, sampleRate, onUpdate) {
  const controller = new AbortController()
  state.analysis = { running: true, progress: "녹음과 기본 분석 결과를 이 기기에 저장해요.", controller }
  onUpdate()
  const saved = await saveSession(session)
  if (!saved.ok) session.notices.push(`기록을 이 기기에 저장하지 못했어요 (${saved.error}). 이 화면을 닫으면 다시 볼 수 없어요.`)
  state.analysis.progress = "동의한 경우에만 서버에 설정된 AI로 소리를 전사해요. 영상·얼굴은 보내지 않아요."
  onUpdate()
  const speech = await analyzeRecordedSpeech({
    samples: audioOk ? samples : null,
    sampleRate,
    durationSec: session.totalSec,
    enabled: state.transcribe,
    signal: controller.signal,
    onProgress: (done, count) => {
      state.analysis.progress = `음성 전사 ${done}/${count}개 조각 처리 중…`
      onUpdate()
    },
  })
  session.media.speech = speech.status
  session.media.speechDetail = speech.detail
  session.transcript = speech.segments
  session.analysis.transcript = speech.transcript
  session.analysis.fillers = speech.fillers && { count: speech.fillers.count, times: speech.fillers.times }
  session.analysis.transcription = { status: speech.status, processing: "self-hosted", detail: speech.detail }
  session.analysis.items = buildReviewItems({ silence, transcript: speech.transcript, fillers: speech.fillers, gaze })
  session.notices.push(speech.detail)
  const updated = await saveSession(session)
  if (!updated.ok && saved.ok) session.notices.push("전사 결과를 저장하지 못했어요. 현재 화면에서는 계속 확인할 수 있어요.")
  state.analysis = { running: false, progress: "", controller: null }
  onUpdate()
}

const coachItems = (session) => [...(session?.analysis?.items || []), ...(session?.reviewPoints || [])].filter((it) => COACH_TYPES.has(it.type))

async function reviewManualPoint() {
  if (!state.session || state.analysis.running) return
  const sec = Math.max(0, Math.min(state.session.totalSec, Number(state.manualSecond) || 0))
  const item = { id: `manual-${Date.now()}`, type: "manual", startSec: sec, endSec: sec, title: "직접 고른 검토 시점", measured: "사용자가 직접 선택 (측정 이상 아님)", basis: "사용자가 다시 보고 싶은 시점을 직접 골랐어요." }
  state.session.reviewPoints = [item]
  state.selected = coachItems(state.session).length - 1
  state.coach = null; state.revision = null; state.aiConsent = false
  await saveSession(state.session)
  await alignSession(state.session)
}


/** POST /api/scripts/align: 검토 지점마다 대본 문장 후보를 받는다(전사가 없으면 모두 unmatched). */
async function alignSession(session) {
  const items = coachItems(session).slice(0, 100)
  if (!items.length) {
    state.align = { status: "none" }
    return render()
  }
  state.align = { status: "loading" }
  render()
  try {
    const data = await postJson("/api/scripts/align", {
      scriptVersionId: session.scriptVersionId,
      script: session.script,
      segments: (session.transcript || []).slice(0, 2000).map((s) => ({ startSecond: time(s.startSec), endSecond: time(Math.max(s.endSec, s.startSec)), text: s.text.slice(0, 1000), ...(s.timingPrecision === "chunk" && { timingPrecision: "chunk" }) })),
      points: items.map((it) => ({ id: pointIdOf(it), startSecond: time(it.startSec), endSecond: time(Math.max(it.endSec, it.startSec)) })),
    })
    state.align = { status: "ok", data }
  } catch (e) {
    state.align = { status: "error", message: e.message }
  }
  resetPick()
  render()
}

function selectedItem() {
  const items = coachItems(state.session)
  return items[Math.min(state.selected, items.length - 1)] || null
}
function alignPoint(item) {
  return item && state.align?.status === "ok" ? state.align.data.points.find((p) => p.pointId === pointIdOf(item)) : null
}
function sentenceById(id) {
  return state.align?.data?.sentences.find((s) => s.id === id) || null
}
function resetPick() {
  state.aiConsent = false
  const point = alignPoint(selectedItem())
  state.pick = point?.status === "matched" ? { sentenceId: point.primarySentenceId, confirmation: null } : null
  state.choosingSentence = point?.status === "unmatched"
}
function paragraphOf(sentence) {
  const list = state.align.data.sentences.filter((s) => s.paragraphIndex === sentence.paragraphIndex)
  const start = list[0].start
  const end = list[list.length - 1].end
  return { paragraphIndex: sentence.paragraphIndex, start, end, text: state.session.script.slice(start, end), sentenceIds: list.map((s) => s.id) }
}

/* ───────── 화면 이동 ───────── */

function goTo(next) {
  if (rec.running || state.analysis.running) return
  const prev = state.stage
  if (prev === next) return render()
  if (prev === "coach") state.coach?.controller?.abort()
  if (prev === "revision") state.revision?.controller?.abort()
  for (const { el } of players.values()) el.pause()
  state.stage = next
  state.maxReached = Math.max(state.maxReached, STAGES.findIndex((s) => s.id === next))
  if (next === "practice" || next === "repractice") openCamera()
  else releaseCamera()
  render()
  window.scrollTo({ top: 0, behavior: "smooth" })
  if (next === "coach") ensureCoach()
  if (next === "revision") ensureRevision()
}

/* ───────── 공통 화면 조각 ───────── */

function pageTitle(eyebrow, title, description) {
  return h("div", { class: "page-title" }, h("span", { text: eyebrow }), h("h1", { text: title }), h("p", { text: description }))
}

function brandMark() {
  return h("span", { class: "brand__mark" }, h("span"), h("span"), h("span"))
}

function appHeader() {
  return h("header", { class: "app-header" },
    h("a", { class: "brand", href: "/studio.html" }, brandMark(), h("span", { text: "다시봄" })),
    h("div", { class: "header-context" }, h("span", { class: "header-context__dot" }), h("span", { text: STAGES.find((s) => s.id === state.stage).label })),
    h("nav", { class: "header-nav", "aria-label": "주 메뉴" },
      h("a", { href: "/", text: "기본 연습 화면" }),
      h("a", { href: "/demo.html", text: "시연용 예시 체험" }),
      h("a", { href: "/#/history", text: "연습 기록" }),
      state.applied && h("button", { disabled: rec.running || state.analysis.running, onclick: restoreRevision, text: "수정 전 대본으로 되돌리기" }),
      h("button", { onclick: () => { state.onboarding = true; render() }, disabled: rec.running, text: "사용 방법" }),
    ),
  )
}

function stageRail() {
  const active = STAGES.findIndex((s) => s.id === state.stage)
  const locked = rec.running || state.analysis.running
  return h("aside", { class: "stage-rail" },
    h("div", { class: "rail-home" }, icon("home", 18), h("span", { text: "발표 연습" })),
    h("nav", { "aria-label": "연습 단계" },
      STAGES.map((s, i) => {
        const done = i < active
        return h("button", { class: `rail-step ${i === active ? "is-active" : ""} ${done ? "is-done" : ""}`, disabled: locked || i > state.maxReached, "aria-current": i === active ? "step" : null, onclick: () => goTo(s.id) },
          h("span", { class: "rail-step__number" }, done ? icon("check", 15) : String(i + 1)),
          h("span", {}, h("strong", { text: s.label }), h("small", { text: i === active ? "진행 중" : done ? "완료" : "다음 단계" })),
        )
      }),
    ),
    h("div", { class: "rail-note" }, icon("sparkle", 18), h("div", {}, h("strong", { text: "차근차근 해볼까요?" }), h("p", { text: "지나온 단계는 언제든 다시 확인할 수 있어요. 연습 기록은 이 기기에만 저장돼요." }))),
  )
}

function mobileNav() {
  const locked = rec.running || state.analysis.running
  return h("div", { class: "mobile-stage-nav" },
    STAGES.map((s, i) => h("button", { class: state.stage === s.id ? "is-active" : "", disabled: locked || i > state.maxReached, onclick: () => goTo(s.id) }, h("span", { text: String(i + 1) }), s.short)),
  )
}

/* ───────── 1. 대본 준비 ───────── */

async function importFile(file) {
  const f = state.file
  f.controller?.abort()
  f.controller = new AbortController()
  f.status = "reading"
  f.note = "파일에서 글을 꺼내고 있어요… 큰 PDF는 몇 초 걸릴 수 있어요."
  render()
  try {
    const body = new FormData()
    body.append("file", file)
    const res = await fetch("/api/scripts/import", { method: "POST", body, signal: f.controller.signal })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.message || (res.status === 503 ? "지금 다른 파일을 읽고 있어요. 잠시 뒤 다시 시도해 주세요." : "대본 파일을 읽지 못했어요."))
    state.script = data.text
    state.scriptSource = "import"
    f.status = "done"
    f.name = data.fileName || file.name
    f.note = "파일 내용을 불러왔어요. PDF는 글 순서가 섞일 수 있으니 연습 전에 확인해 주세요."
    savePrefs()
  } catch (e) {
    if (f.controller.signal.aborted) return
    f.status = "error"
    f.note = `${e.message} 지금 대본은 그대로예요.`
  } finally {
    f.controller = null
    f.pending = null
  }
  render()
}

function chooseFile(file) {
  if (!file) return
  const f = state.file
  f.name = file.name
  if (!/\.(txt|pdf|docx)$/i.test(file.name)) {
    f.status = "error"
    f.note = "지원하지 않는 형식이에요. TXT, PDF, DOCX를 선택해 주세요."
    return render()
  }
  if (state.script.trim() && state.scriptSource !== "example") {
    f.status = "confirm"
    f.pending = file
    f.note = "지금 작성한 대본이 있어요. 파일 내용으로 바꿀지 선택해 주세요."
    return render()
  }
  importFile(file)
}

function cancelFile() {
  const f = state.file
  f.controller?.abort()
  Object.assign(f, { status: "idle", name: "", note: "", pending: null, controller: null })
  render()
}

function deviceSelect(label, kind) {
  const list = kind === "cam" ? state.devices.cams : state.devices.mics
  const value = kind === "cam" ? state.cameraId : state.micId
  const sel = h("select", { class: "device-select", "aria-label": label, onchange: (e) => {
    if (kind === "cam") state.cameraId = e.target.value
    else state.micId = e.target.value
    savePrefs()
  } },
    h("option", { value: "", text: kind === "cam" ? "기본 카메라" : "기본 마이크" }),
    list.filter((d) => d.deviceId && d.deviceId !== "default").map((d, i) => h("option", { value: d.deviceId, selected: d.deviceId === value, text: d.label || `${kind === "cam" ? "카메라" : "마이크"} ${i + 1}` })),
  )
  return h("label", { class: "setting-row" }, h("span", { text: label }), sel)
}

function prepareScreen() {
  const f = state.file
  const input = h("input", { type: "file", accept: ".txt,.pdf,.docx", class: "sr-only", onchange: (e) => chooseFile(e.target.files?.[0]) })
  const meta = h("span")
  const over = h("p", { class: "field-warning", role: "alert" })
  const syncMeta = () => {
    const n = state.script.length
    meta.textContent = `${n.toLocaleString()}자 · 약 ${Math.max(1, Math.round(n / 330))}분`
    over.hidden = n <= SCRIPT_LIMIT
    over.textContent = `AI 코칭과 대본 위치 찾기는 ${SCRIPT_LIMIT.toLocaleString()}자까지 다뤄요. 지금 ${n.toLocaleString()}자예요.`
  }
  syncMeta()
  const next = h("button", { class: "button button--primary", disabled: !state.script.trim() || f.status === "reading", onclick: () => goTo("practice") }, "카메라 확인하기", icon("arrow", 18))
  const editor = h("textarea", { "aria-label": "발표 대본", class: "script-editor", placeholder: "발표할 내용을 입력해 주세요.", value: state.script, oninput: (e) => {
    state.script = e.target.value
    state.scriptSource = "edit"
    syncMeta()
    next.disabled = !state.script.trim()
    savePrefs()
  } })

  return h("section", { class: "screen" },
    pageTitle("STEP 1 · 준비", "연습할 대본을 준비해 볼까요?", "파일을 불러오거나 직접 작성한 뒤, 발표에 사용할 내용을 확인해 주세요."),
    h("div", { class: "prepare-grid" },
      h("div", { class: "card script-card" },
        h("div", { class: "card-heading" },
          h("div", {}, h("span", { class: "field-label", text: "발표 대본" }), h("p", { text: "TXT(UTF-8), 글자가 있는 PDF, DOCX를 10MB까지 불러올 수 있어요." })),
          input,
          h("button", { class: "button button--soft", disabled: f.status === "reading", onclick: () => input.click() }, icon("upload", 17), "파일 불러오기"),
        ),
        f.status !== "idle" && h("div", { class: `file-state file-state--${f.status}`, role: f.status === "error" ? "alert" : "status" },
          h("span", { class: "file-state__icon" }, icon(f.status === "done" ? "check" : "file", 18)),
          h("div", {}, h("strong", { text: f.name }), h("span", { text: f.note })),
          f.status === "reading" && h("button", { onclick: cancelFile, text: "취소" }),
          f.status === "confirm" && h("div", { class: "file-state__actions" },
            h("button", { onclick: cancelFile, text: "기존 대본 유지" }),
            h("button", { onclick: () => f.pending && importFile(f.pending), text: "교체하고 불러오기" }),
          ),
        ),
        editor,
        h("div", { class: "editor-meta" }, meta, h("span", { text: state.scriptSource === "example" ? "예시 대본이에요" : "이 브라우저에 자동 저장됨" })),
        over,
        h("div", { class: "limit-notice" },
          h("strong", { text: "긴 대본을 준비하고 있나요?" }),
          h("p", { text: "AI 코칭에는 대본 전체가 아니라 사용자가 확인한 문장과 앞뒤 한 문장만 보내요. 수정안도 그 문장이 든 문단 하나만 만들어요." }),
        ),
      ),
      h("div", { class: "prepare-side" },
        h("div", { class: "card" },
          h("span", { class: "field-label", text: "근거 자료 (선택)" }),
          h("p", { class: "field-help", text: "대본과 구분해 참고할 자료나 출처를 적어 주세요. AI 풀이·수정안은 이 자료에 실제로 있는 문장만 인용해요." }),
          h("textarea", { class: "evidence-editor", maxlength: SOURCES_LIMIT, placeholder: "예: 사내 독서 습관 설문, 2024년 3월", value: state.evidence, oninput: (e) => { state.evidence = e.target.value; savePrefs() } }),
          h("span", { class: "input-caption", text: `${SOURCES_LIMIT.toLocaleString()}자까지 · 이 브라우저에만 저장해요.` }),
        ),
        h("div", { class: "card" },
          h("span", { class: "field-label", text: "목표 발표 시간" }),
          h("div", { class: "time-options" },
            [3, 5, 10].map((m) => h("button", { class: state.targetMinutes === m ? "is-selected" : "", "aria-pressed": String(state.targetMinutes === m), onclick: () => { state.targetMinutes = m; savePrefs(); render() } }, icon("clock", 17), `${m}분`)),
          ),
          h("label", { class: "studio-consent" }, h("input", { type: "checkbox", checked: state.transcribe, onchange: (e) => { state.transcribe = e.target.checked } }), "녹음 소리를 AI로 전사하는 데 동의해요 (분석 시 유료 사용량이 발생할 수 있어요)."),
          deviceSelect("카메라", "cam"),
          deviceSelect("마이크", "mic"),
          h("p", { class: "input-caption", text: state.devices.cams.some((d) => d.label) ? "다음 화면에서 고른 장치로 연결해요." : "장치 이름은 카메라 권한을 허용한 뒤에 보여요." }),
        ),
      ),
    ),
    h("div", { class: "screen-actions" }, h("span", { text: "대본은 연습을 시작한 시점의 버전으로 기록됩니다." }), next),
  )
}

/* ───────── 2. 발표 연습 / 6. 다시 연습 공통 ───────── */

function recordingControls({ kind, startLabel, stopLabel, onStop, rightLabel, rightValue }) {
  const elapsed = h("strong", { text: mmss(elapsedSec()) })
  const remaining = h("strong", { text: rightValue ?? mmss(state.targetMinutes * 60) })
  const level = h("i")
  tickers = [{ elapsed, remaining: rightValue ? null : remaining, level }]
  const busy = cam.status === "connecting"
  return h("div", { class: "recording-controls" },
    h("div", { class: "timer-block" }, h("span", { text: kind === "partial" ? "구간 경과 시간" : "경과 시간" }), elapsed,
      rec.running && h("span", { class: "level-meter", "aria-label": "마이크 입력" }, level)),
    h("div", { class: "control-buttons" },
      !rec.running
        ? h("button", { class: "record-button", disabled: busy, onclick: () => startRecording(kind) }, h("span", {}, icon("record", 23)), startLabel)
        : [
            h("button", { class: "round-control", onclick: togglePause }, icon(rec.paused ? "play" : "pause", 22), h("span", { text: rec.paused ? "계속" : "일시정지" })),
            h("button", { class: "stop-button", onclick: onStop }, h("span"), stopLabel),
          ],
    ),
    h("div", { class: "timer-block timer-block--right" }, h("span", { text: rightLabel }), remaining),
  )
}

function practiceScreen() {
  return h("section", { class: "screen practice-screen" },
    pageTitle("STEP 2 · 연습", rec.running ? "지금, 나의 발표에 집중해 보세요" : "준비되면 녹화를 시작해 주세요", "대본을 편하게 보면서 연습하세요. 대본은 자동으로 움직이지 않아요."),
    h("div", { class: "practice-layout" },
      h("div", { class: "practice-panel" },
        h("div", { class: "panel-title" },
          h("span", {}, icon("video", 19), "내 영상"),
          h("span", { class: `status-pill ${rec.running && !rec.paused ? "status-pill--recording" : ""}`, text: rec.running ? (rec.paused ? "일시정지" : "녹화 중") : cam.status === "ready" ? "준비됨" : "연결 확인" }),
        ),
        livePreview(),
      ),
      h("div", { class: "practice-panel" },
        h("div", { class: "panel-title" }, h("span", {}, icon("file", 19), "발표 대본"), h("span", { class: "version-pill", text: state.versions.length ? versionLabel(state.versions[state.versions.length - 1].id) : "버전 1" })),
        h("div", { class: "practice-script" }, state.script.split(/\n\s*\n/).map((p) => h("p", { text: p }))),
      ),
    ),
    recordingControls({ kind: "full", startLabel: "녹화 시작", stopLabel: "연습 종료", onStop: finishPractice, rightLabel: "남은 시간" }),
    h("p", { class: "demo-disclaimer", "data-cam-status": "", text: CAM_TEXT[cam.status] }),
    h("p", { class: "demo-disclaimer", text: "영상과 녹음은 이 브라우저(IndexedDB)에만 저장해요. 준비 화면에서 동의한 경우 분석 단계에서 소리를 서버에 설정된 음성 인식으로 보내요." }),
  )
}

async function finishPractice() {
  const scriptVersionId = currentVersionId()
  const out = await stopRecording()
  if (!out) return
  const built = makeSession({ out, script: state.script, scriptVersionId })
  state.session = built.session
  state.align = null
  state.selected = 0
  state.pick = null
  state.coach = null
  state.revision = null
  state.applied = null
  state.repractice = null
  state.stage = "results"
  state.maxReached = 2
  render()
  await analyzeSession(built, out.samples, out.sampleRate, render)
  await alignSession(state.session)
}

/* ───────── 3. 결과 분석 ───────── */

function analysisProgress() {
  if (!state.analysis.running) return null
  return h("div", { class: "card progress-card", role: "status", "aria-live": "polite" },
    h("span", { class: "typing" }, h("span"), h("span"), h("span")),
    h("p", { text: state.analysis.progress }),
    h("button", { class: "button button--ghost", onclick: () => state.analysis.controller?.abort(), text: "전사 취소" }),
  )
}

function noticeList(session) {
  const list = [...new Set((session.notices || []).filter(Boolean))]
  if (!list.length) return null
  return h("details", { class: "card notice-card" }, h("summary", { text: `측정 안내 ${list.length}개` }), h("ul", {}, list.map((n) => h("li", { text: n }))))
}

function resultsScreen() {
  const s = state.session
  if (!s) return h("section", { class: "screen" }, pageTitle("STEP 3 · 분석", "아직 연습 기록이 없어요", "발표 연습을 먼저 녹화해 주세요."))
  const items = coachItems(s)
  const allItems = s.analysis.items || []
  const item = selectedItem()
  const total = Math.max(1, s.totalSec)
  const rate = s.analysis.transcript?.status === "ok" ? `${Math.round(s.analysis.transcript.overallRate)} 음절/분` : "측정 못 함"
  const silences = allItems.filter((it) => it.type === "silence").length
  const progress = h("span", { class: "timeline-progress" })
  progress.style.width = "0%"
  const player = s.videoBlob && playerFor(s.videoBlob)
  if (player) {
    player.ontimeupdate = player.onseeked = () => { progress.style.width = `${Math.min(100, (player.currentTime / total) * 100)}%` }
    player.onseeked()
  }
  const select = (i) => {
    state.selected = i
    resetPick()
    seekPlayer(s.videoBlob, items[i].startSec - 1)
    render()
  }

  return h("section", { class: "screen" },
    pageTitle("STEP 3 · 분석", items.length ? "발표에서 눈여겨볼 순간을 찾았어요" : "연습 결과를 확인해 주세요", "분석 결과에서 다시 보고 싶은 순간을 고르고, 대본 위치를 확인해 주세요. 표시는 판단이 아니라 다시 확인할 구간이에요."),
    analysisProgress(),
    h("div", { class: "results-grid" },
      h("div", { class: "card result-video-card" },
        playbackBox(s.videoBlob, { compact: true }),
        h("div", { class: "video-timeline" },
          h("div", { class: "timeline-track" },
            progress,
            items.map((it, i) => {
              const m = h("button", { "aria-label": `${formatClock(it.startSec)} ${it.title}`, class: `timeline-marker timeline-marker--${TONE[it.type]} ${item === it ? "is-active" : ""}`, onclick: () => select(i) })
              m.style.left = `${Math.min(100, (it.startSec / total) * 100)}%`
              return m
            }),
          ),
          h("div", { class: "timeline-time" }, h("strong", { text: item ? mmss(item.startSec) : "00:00" }), h("span", { text: mmss(s.totalSec) })),
        ),
        h("div", { class: "summary-metrics" },
          h("div", {}, h("span", { text: "발표 시간" }), h("strong", { text: formatKorean(s.totalSec) })),
          h("div", {}, h("span", { text: "평균 속도" }), h("strong", { text: rate })),
          h("div", {}, h("span", { text: "긴 침묵" }), h("strong", { text: s.analysis.silence?.status === "ok" ? `${silences}회` : "측정 못 함" })),
        ),
        h("p", { class: "result-label", text: `목표 ${state.targetMinutes}분 · ${s.result.label}` }),
      ),
      h("div", { class: "card segment-list-card" },
        h("div", { class: "card-heading" },
          h("div", {}, h("span", { class: "field-label", text: "검토 구간" }), h("p", { text: "항목을 누르면 영상의 해당 시점으로 이동해요." })),
          h("span", { class: "count-badge", text: `${items.length}개` }),
        ),
        items.length
          ? h("div", { class: "segment-list" }, items.map((it, i) => h("button", { class: item === it ? "is-selected" : "", onclick: () => select(i) },
              h("span", { class: `segment-dot segment-dot--${TONE[it.type]}` }),
              h("span", { class: "segment-time", text: mmss(it.startSec) }),
              h("span", { class: "segment-copy" }, h("strong", { text: it.title }), h("small", { text: shortMeasured(it) })),
              icon("chevron", 17),
            )))
          : h("p", { class: "empty-note", text: state.analysis.running ? "분석이 끝나면 검토 구간이 표시돼요." : "다시 볼 구간을 찾지 못했어요. 긴 침묵·군말·속도 변화가 측정되지 않았거나 측정할 소리가 없었어요." }),
      ),
    ),
    noticeList(s),
    !state.analysis.running && h("div", { class: "card manual-review" },
      h("h2", { text: "직접 검토할 시점 선택" }),
      h("p", { text: "자동으로 잡힌 구간이 없어도 다시 보고 싶은 시점을 고를 수 있어요. 직접 선택한 위치는 측정 이상으로 취급하지 않아요." }),
      h("label", {}, "검토 시점(초)", h("input", { type: "number", min: 0, max: s.totalSec, step: 1, "aria-label": "검토 시점(초)", value: state.manualSecond, oninput: (e) => { state.manualSecond = e.target.value } })),
      h("button", { class: "button button--soft", onclick: reviewManualPoint, text: "이 시점의 대본 확인" })),
    item && alignmentCard(item),
    !items.length && !state.analysis.running && h("div", { class: "screen-actions" },
      h("span", { text: "같은 대본으로 다시 녹화하거나 대본을 고친 뒤 연습할 수 있어요." }),
      h("button", { class: "button button--soft", onclick: () => goTo("prepare"), text: "대본 고치기" }),
      h("button", { class: "button button--primary", onclick: () => goTo("practice") }, "다시 연습", icon("arrow", 17)),
    ),
  )
}

function alignmentCard(item) {
  const a = state.align
  const wrap = (body, actions) => h("div", { class: "card alignment-card" }, body, actions && h("div", { class: "alignment-actions" }, actions))
  if (!a || a.status === "loading") return wrap(h("div", { class: "alignment-heading" }, h("div", {}, h("span", { class: "eyebrow-pill", text: "대본 위치 확인" }), h("h2", { text: "대본에서 이 순간의 위치를 찾고 있어요…" }))))
  if (a.status === "error") return wrap(h("div", { class: "alignment-heading" }, h("div", {}, h("span", { class: "eyebrow-pill", text: "대본 위치 확인" }), h("h2", { text: "대본 위치를 찾지 못했어요" }), h("p", { role: "alert", text: a.message }))), h("button", { class: "button button--primary", onclick: () => alignSession(state.session), text: "다시 시도" }))
  const point = alignPoint(item)
  if (!point) return null
  const pickedId = state.pick?.sentenceId
  const confirmed = Boolean(state.pick?.confirmation)
  const candidates = point.candidates.filter((c, i, arr) => arr.findIndex((x) => x.sentenceId === c.sentenceId) === i)
  const options = state.choosingSentence ? a.data.sentences.map((s) => ({ sentenceId: s.id, text: s.text })) : candidates
  const heading = {
    matched: ["이때 말한 부분이 여기 맞나요?", "음성과 대본을 비교한 후보예요. 직접 확인한 뒤 코칭을 시작해 주세요."],
    ambiguous: ["이때 말한 부분은 어디인가요?", "후보가 여럿이라 확정하지 못했어요. 맞는 문장을 골라 주세요."],
    unmatched: ["대본에서 가까운 문장을 찾지 못했어요", "전사가 없거나 대본과 비슷하지 않았어요. 아래 문장 중에서 직접 골라 주세요."],
  }[point.status]
  const choose = (id) => {
    state.aiConsent = false
    state.pick = { sentenceId: id, confirmation: null }
    render()
  }
  const confirm = () => {
    if (!pickedId) return
    state.pick.confirmation = point.status === "matched" && pickedId === point.primarySentenceId ? "user-confirmed" : "user-selected"
    render()
  }
  const items = coachItems(state.session)
  return wrap(
    [
      h("div", { class: "alignment-heading" },
        h("div", {}, h("span", { class: "eyebrow-pill", text: `대본 위치 확인 · ${formatClock(item.startSec)} ${item.title}` }), h("h2", { text: heading[0] }), h("p", { text: heading[1] })),
        h("span", { class: "confidence", text: { matched: "후보 1개로 모임", ambiguous: "후보 여러 개", unmatched: "직접 선택" }[point.status] }),
      ),
      point.reasons?.length ? h("p", { class: "align-reason", text: point.reasons.map((r) => r.message).join(" ") }) : null,
      h("div", { class: `candidate-list ${state.choosingSentence ? "candidate-list--all" : ""}` },
        options.length
          ? options.map((c, i) => h("button", { class: pickedId === c.sentenceId ? "is-selected" : "", "aria-pressed": String(pickedId === c.sentenceId), onclick: () => choose(c.sentenceId) },
              h("span", {}, pickedId === c.sentenceId ? icon("check", 15) : String(i + 1)),
              h("p", { text: c.text }),
            ))
          : h("p", { class: "empty-note", text: "고를 수 있는 후보가 없어요. ‘다른 문장 선택’으로 전체 문장에서 골라 주세요." }),
      ),
      confirmed && h("p", { class: "align-reason", text: `${state.pick.confirmation === "user-confirmed" ? "자동 후보를 확인했어요" : "직접 고른 문장이에요"}. 위치는 사용자가 확인한 값이며 서버가 검증한 사실이 아니에요.` }),
    ],
    [
      h("button", { class: "button button--ghost", onclick: () => { state.choosingSentence = !state.choosingSentence; render() }, text: state.choosingSentence ? "후보만 보기" : "다른 문장 선택" }),
      items.length > 1 && h("button", { class: "button button--ghost", onclick: () => { state.selected = (state.selected + 1) % items.length; resetPick(); render() }, text: "이번 구간 건너뛰기" }),
      !confirmed
        ? h("button", { class: "button button--primary", disabled: !pickedId, onclick: confirm }, icon("check", 17), point.status === "matched" && pickedId === point.primarySentenceId ? "맞아요" : "이 문장으로 할게요")
        : h("button", { class: "button button--primary", onclick: () => goTo("coach") }, "AI 코칭 시작", icon("arrow", 17)),
    ],
  )
}

/* ───────── 4. AI 코칭(POST /api/coach/segment) ───────── */

function coachContext() {
  const item = selectedItem()
  const point = alignPoint(item)
  const sentence = sentenceById(state.pick?.sentenceId)
  return { item, point, sentence, pointId: item && pointIdOf(item) }
}

function ensureCoach() {
  const { item, sentence, pointId } = coachContext()
  if (!item || !sentence || !state.pick?.confirmation) return
  const c = state.coach
  if (c && c.pointId === pointId && c.sentenceId === sentence.id && c.history.length) return
  state.coach = { pointId, sentenceId: sentence.id, history: [], log: [], last: null, busy: false, controller: null, error: "", draft: "" }
  if (state.aiConsent) sendCoach({ type: "start" }, null)
  else render()
}

function seg(g) {
  return g && { startSecond: g.startSecond, endSecond: g.endSecond, text: g.text.slice(0, 1000), ...(g.timingPrecision === "chunk" && { timingPrecision: "chunk" }) }
}

async function sendCoach(action, shown) {
  const c = state.coach
  const { item, point, sentence, pointId } = coachContext()
  if (!c || c.busy || !sentence || !state.aiConsent) return
  const s = state.session
  const ids = { practiceId: s.id, pointId, scriptVersionId: s.scriptVersionId }
  const lastKey = c.last?.message?.questionKey
  const act = { ...action, ...(action.type !== "start" && { questionKey: lastKey }) }
  c.busy = true
  c.error = ""
  c.controller = new AbortController()
  if (shown) c.log.push({ role: "user", text: shown })
  render()
  try {
    const data = await postJson("/api/coach/segment", {
      requestId: requestId("seg"),
      ...ids,
      script: s.script,
      sources: state.evidence.trim().slice(0, SOURCES_LIMIT),
      point: { id: pointId, startSecond: time(item.startSec), endSecond: time(Math.max(item.endSec, item.startSec)), observations: [{ type: item.type, measured: shortMeasured(item) }] },
      selection: { sentenceId: sentence.id, start: sentence.start, end: sentence.end, text: sentence.text, confirmation: state.pick.confirmation, alignmentStatus: point?.status, algorithmVersion: state.align.data.algorithmVersion },
      transcript: { before: seg(point?.transcript?.before), during: (point?.transcript?.during || []).slice(0, 8).map(seg), after: seg(point?.transcript?.after) },
      history: c.history,
      action: act,
    }, c.controller.signal)
    if (state.coach !== c || c.controller.signal.aborted) return
    if (data.practiceId !== s.id || data.pointId !== pointId || data.scriptVersionId !== s.scriptVersionId) throw new Error("다른 연습의 응답이라 사용하지 않았어요.")
    if (act.type !== "start") c.history.push({ role: "user", questionKey: lastKey, action: act.type, ...(act.reason && { reason: act.reason }), ...(act.text && { text: act.text }), ...ids })
    c.history.push(data.message)
    c.log.push({ role: "ai", text: data.message.text })
    c.last = data
    c.draft = ""
    s.coaching[item.id] = { status: data.done ? "코칭 완료" : "코칭 중", summary: data.summary, history: c.history }
    saveSession(s)
  } catch (e) {
    if (state.coach !== c) return
    if (shown) c.log.pop()
    if (c.controller.signal.aborted) c.error = "요청을 취소했어요. 입력한 답은 그대로예요."
    else if (e.code === "history-mismatch") {
      state.coach = null
      c.busy = false
      ensureCoach()
      return
    } else c.error = e.message
  } finally {
    c.busy = false
    c.controller = null
  }
  render()
}

function answerChoice(choice) {
  const key = state.coach?.last?.message?.questionKey
  if (["unknown", "explain", "skip"].includes(choice.value)) return sendCoach({ type: choice.value }, choice.label)
  if (key === "situation") {
    const text = state.coach.draft.trim()
    return sendCoach({ type: "answer", reason: choice.value, ...(choice.value === SITUATION_FALLBACK && text && { text }) }, choice.value === SITUATION_FALLBACK && text ? text : choice.label)
  }
  sendCoach({ type: "answer", text: choice.value }, choice.label)
}

function answerText() {
  const c = state.coach
  const text = c?.draft.trim()
  if (!text) return
  if (c.last?.message?.questionKey === "situation") sendCoach({ type: "answer", reason: SITUATION_FALLBACK, text }, text)
  else sendCoach({ type: "answer", text }, text)
}

function scriptWithMark(sentence) {
  const para = paragraphOf(sentence)
  const s = state.session.script
  return h("p", {}, s.slice(para.start, sentence.start), h("mark", { text: sentence.text }), s.slice(sentence.end, para.end))
}

function coachScreen() {
  const { item, sentence } = coachContext()
  const c = state.coach
  if (!item || !sentence || !state.pick?.confirmation || !c) {
    return h("section", { class: "screen" }, pageTitle("STEP 4 · AI 코칭", "먼저 대본 위치를 확인해 주세요", "결과 분석에서 검토 구간과 대본 문장을 확인해야 코칭을 시작할 수 있어요."), h("div", { class: "screen-actions" }, h("button", { class: "button button--primary", onclick: () => goTo("results"), text: "결과 분석으로" })))
  }
  const s = state.session
  const last = c.last
  const done = last?.done
  const choices = !done && last?.message?.choices ? last.message.choices : []
  const playClip = () => {
    seekPlayer(s.videoBlob, item.startSec - 2, { play: true })
    const el = s.videoBlob && players.get(s.videoBlob)?.el
    if (el) el.ontimeupdate = () => { if (el.currentTime > item.endSec + 2) el.pause() }
  }
  const messages = h("div", { class: "chat-messages", "aria-live": "polite" },
    c.log.map((m) => h("div", { class: `message message--${m.role}` }, m.role === "ai" && h("span", { class: "mini-orb" }, icon("sparkle", 13)), h("p", { text: m.text }))),
    c.busy && h("div", { class: "message message--ai" }, h("span", { class: "mini-orb" }, icon("sparkle", 13)), h("p", { class: "typing" }, h("span"), h("span"), h("span")), h("button", { onclick: () => c.controller?.abort(), text: "취소" })),
    c.error && h("p", { class: "coach-error", role: "alert", text: c.error }),
  )
  queueMicrotask(() => { messages.scrollTop = messages.scrollHeight })
  const summary = last?.summary
  return h("section", { class: "screen" },
    pageTitle("STEP 4 · AI 코칭", "이 순간을 함께 돌아볼까요?", "선택한 장면과 대본을 보면서 생각을 정리해 보세요. 측정값만으로 원인을 판단하지 않아요."),
    h("div", { class: "coach-grid" },
      h("div", { class: "coach-context" },
        h("div", { class: "card" },
          h("div", { class: "context-video" }, playbackBox(s.videoBlob, { compact: true }), s.videoBlob && h("button", { class: "context-play", "aria-label": "이 구간 재생", onclick: playClip }, icon("play", 22))),
          h("div", { class: "context-time" }, h("strong", { text: mmss(item.startSec) }), h("span", { text: `${item.title} · ${shortMeasured(item)}` })),
        ),
        h("div", { class: "card selected-script" },
          h("span", { class: "field-label", text: "선택한 대본" }),
          scriptWithMark(sentence),
          h("span", { text: `대본 ${versionLabel(s.scriptVersionId)} · 문단 ${sentence.paragraphIndex + 1} · ${state.pick.confirmation === "user-confirmed" ? "자동 후보 확인" : "직접 선택"}` }),
        ),
      ),
      h("div", { class: "card chat-card" },
        h("div", { class: "chat-header" },
          h("div", {}, h("span", { class: "ai-orb" }, icon("sparkle", 19)), h("div", {}, h("strong", { text: "다시봄 코치" }), h("span", { text: last?.model ? `${last.model} · ${last.promptVersion}` : "구간 코칭" }))),
          h("span", { text: `후속 질문 ${last?.followupCount ?? 0} / ${last?.followupLimit ?? 3}` }),
        ),
        h("div", { class: "studio-ai-notice" },
          h("p", { text: state.model?.processingNotice || "선택한 대본·자료·답변을 서버에 설정된 AI로 보내요. 영상·얼굴은 보내지 않아요." }),
          h("p", { text: `모델: ${state.model?.model || "AI 미설정"} · ${state.model?.ready ? "호출 가능" : "AI 미설정: 풀이·수정안은 사용할 수 없지만 상황 질문은 가능해요."}` }),
          h("label", { class: "studio-consent" }, h("input", { type: "checkbox", checked: state.aiConsent, onchange: (e) => { state.aiConsent = e.target.checked; if (!state.aiConsent) { c.controller?.abort(); state.revision?.controller?.abort() }; render() } }), "선택한 대본·근거 자료·답변의 AI 전송에 동의해요."),
          !last && h("button", { class: "button button--primary", disabled: !state.aiConsent || c.busy, onclick: () => sendCoach({ type: "start" }, null), text: "동의하고 대화 시작" })),
        messages,
        !done
          ? h("div", { class: "chat-compose" },
              h("div", { class: "quick-replies" },
                choices.map((ch) => h("button", { disabled: c.busy || !state.aiConsent, onclick: () => answerChoice(ch), text: ch.label })),
                [["unknown", "모르겠어요"], ["explain", "설명해 주세요"], ["skip", "건너뛰기"]].filter(([v]) => !choices.some((ch) => ch.value === v)).map(([value, label]) => h("button", { class: "quick-reply--plain", disabled: c.busy || !last || !state.aiConsent, onclick: () => answerChoice({ value, label }), text: label })),
              ),
              h("div", { class: "compose-row" },
                h("textarea", { "aria-label": "답변 입력", maxlength: 1000, placeholder: last?.message?.questionKey === "situation" ? "선택지에 없으면 직접 적어 주세요." : "생각을 편하게 적어 주세요.", value: c.draft, disabled: c.busy || !state.aiConsent,
                  oninput: (e) => { c.draft = e.target.value },
                  onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); answerText() } } }),
                h("button", { "aria-label": "보내기", disabled: c.busy || !last || !state.aiConsent, onclick: answerText }, icon("arrow", 19)),
              ),
            )
          : h("div", { class: "coach-summary" },
              h("div", {},
                h("span", { text: "대화 요약" }),
                h("p", { text: summaryText(summary) }),
              ),
              h("div", { class: "coach-summary__actions" },
                h("button", { class: "button button--ghost", onclick: () => goTo("results"), text: "다른 구간 살펴보기" }),
                h("button", { class: "button button--primary", disabled: !state.aiConsent || !state.model?.ready, onclick: () => { state.revision = null; goTo("revision") } }, "이 문단 고치기", icon("arrow", 17)),
              ),
            ),
      ),
    ),
    h("p", { class: "demo-disclaimer", text: "선택한 문장과 문맥, 근거 자료, 답변을 서버에 설정된 AI로 보내요. 대화는 서버에 저장하지 않고 이 기기의 연습 기록에만 남아요." }),
  )
}

function summaryText(summary) {
  if (!summary) return "이 구간 코칭을 마쳤어요."
  const reports = (summary.userReports || []).map((u) => u.text || { "intended-pause": "일부러 쉬었어요", "forgot-line": "다음 대사가 기억나지 않았어요", "concept-confusing": "내용(개념)이 헷갈렸어요", "awkward-sentence": "문장이 말하기 어색했어요", other: "직접 설명함" }[u.reason]).filter(Boolean)
  const obs = (summary.observations || []).map((o) => `${o.label}${o.measured ? ` ${o.measured}` : ""}`)
  return [obs.length && `관찰: ${obs.join(", ")}`, reports.length && `사용자가 설명한 상황: ${[...new Set(reports)].join(" · ")}`].filter(Boolean).join(" / ") || "이 구간 코칭을 마쳤어요."
}

/* ───────── 5. 대본 수정(POST /api/scripts/revise-segment) ───────── */

function ensureRevision() {
  const { sentence, pointId } = coachContext()
  if (!sentence || !state.coach?.last) return
  if (state.revision && state.revision.pointId === pointId) return
  state.revision = { pointId, busy: false, controller: null, error: "", data: null, proposal: "", editing: false, focus: [], requestText: "", localCheck: null }
  requestRevision()
}

async function requestRevision() {
  const r = state.revision
  const { sentence, pointId } = coachContext()
  const s = state.session
  if (!r || r.busy || !sentence) return
  if (!state.aiConsent || !state.model?.ready) { r.error = "AI 전송 동의와 서버의 연결 상태를 확인해 주세요."; return render() }
  const para = paragraphOf(sentence)
  if (para.text.length > PARAGRAPH_LIMIT) {
    r.error = `이 문단은 ${para.text.length.toLocaleString()}자라 한 번에 고칠 수 없어요(${PARAGRAPH_LIMIT.toLocaleString()}자까지). 준비 단계에서 빈 줄로 문단을 나눠 주세요.`
    return render()
  }
  r.busy = true
  r.error = ""
  r.controller = new AbortController()
  render()
  const summary = state.coach.last.summary || {}
  try {
    const data = await postJson("/api/scripts/revise-segment", {
      requestId: requestId("rev"),
      practiceId: s.id,
      scriptVersionId: s.scriptVersionId,
      point: { id: pointId },
      script: s.script,
      sources: state.evidence.trim().slice(0, SOURCES_LIMIT),
      target: { paragraphIndex: para.paragraphIndex, start: para.start, end: para.end, text: para.text, confirmation: state.pick.confirmation },
      coaching: { summary: { observations: summary.observations, location: { sentenceId: sentence.id }, userReports: summary.userReports }, history: state.coach.history },
      request: { explicit: true, focus: r.focus, text: r.requestText.trim() },
    }, r.controller.signal)
    if (state.revision !== r || r.controller.signal.aborted) return
    if (data.practiceId !== s.id || data.pointId !== pointId || data.scriptVersionId !== s.scriptVersionId) throw new Error("다른 연습의 수정안이라 사용하지 않았어요.")
    r.data = data
    r.proposal = data.revision?.text || ""
    r.editing = false
    r.localCheck = null
    r.checked = null
  } catch (e) {
    if (state.revision !== r) return
    r.error = r.controller.signal.aborted ? "요청을 취소했어요. 원문은 그대로예요." : e.message
  } finally {
    r.busy = false
    r.controller = null
  }
  render()
}

async function applyRevision() {
  const r = state.revision
  const d = r?.data
  if (!d?.apply || !r.proposal.trim()) return
  const s = state.session
  const { start, end, baseScriptVersionId, originalSha256 } = d.apply
  // 오래된 결과 방지: 수정 요청을 보낸 대본 버전·원문 범위가 그대로인지 다시 확인한다.
  const base = state.versions.find((v) => v.id === baseScriptVersionId)?.script ?? (s.scriptVersionId === baseScriptVersionId ? s.script : null)
  const original = base?.slice(start, end)
  const hash = original != null ? await sha256Hex(original) : null
  if (original == null || original !== d.target.text || (hash && hash !== originalSha256)) {
    r.error = "수정안을 만든 뒤 대본이 바뀌었어요. 다시 요청해 주세요."
    return render()
  }
  if (state.script !== base || state.versions.at(-1)?.id !== baseScriptVersionId) {
    r.error = "수정안을 만든 뒤 대본 버전이 바뀌었어요. 위치 확인부터 다시 진행해 주세요."
    return render()
  }
  const checked = checkRevision(d.target.text, r.proposal)
  if (d.preservation?.blocked || checked.blocked || !r.meaningConfirmed) { r.error = "보존 검사와 뜻 보존 확인을 마쳐 주세요."; return render() }
  state.script = state.script.slice(0, start) + r.proposal + state.script.slice(end)
  state.scriptSource = "revision"
  const versionId = currentVersionId("revision")
  const v = state.versions.find((x) => x.id === versionId)
  if (v) v.basedOn = baseScriptVersionId
  savePrefs()
  state.applied = { pointId: r.pointId, paragraphIndex: d.target.paragraphIndex, text: r.proposal, original, baseVersionId: baseScriptVersionId, versionId }
  s.coaching[selectedItem().id] = { ...(s.coaching[selectedItem().id] || {}), status: "수정안 적용", revision: { versionId, basedOn: baseScriptVersionId, promptVersion: d.promptVersion } }
  saveSession(s)
  state.repractice = null
  goTo("repractice")
}

function restoreRevision() {
  const applied = state.applied
  const base = state.versions.find(v => v.id === applied?.baseVersionId)
  if (!base || state.versions.at(-1)?.id !== applied?.versionId) return
  state.script = base.script; state.scriptSource = "restore"; currentVersionId("restore"); savePrefs()
  state.applied = null; state.revision = null; state.coach = null; state.aiConsent = false
  goTo("prepare")
}

function toggleEditing(r) {
  if (r.editing) {
    // 편집 취소: 마지막으로 검사한 편집본(없으면 모델 수정안)으로 돌린다.
    r.proposal = r.checked ?? r.data.revision.text
    if (r.checked == null) r.localCheck = null
  }
  r.editing = !r.editing
  render()
}

function revisionScreen() {
  const r = state.revision
  const { sentence } = coachContext()
  if (!r || !sentence) return h("section", { class: "screen" }, pageTitle("STEP 5 · 대본 수정", "먼저 구간 코칭을 마쳐 주세요", "코칭 대화를 바탕으로 문단 수정안을 만들어요."), h("div", { class: "screen-actions" }, h("button", { class: "button button--primary", onclick: () => goTo("coach"), text: "AI 코칭으로" })))
  const d = r.data
  const para = paragraphOf(sentence)
  const title = pageTitle("STEP 5 · 대본 수정", d?.status === "proposed" ? "이렇게 다듬어 보면 어떨까요?" : "어떻게 고치면 말하기 편할까요?", "대화에서 정리한 의도가 잘 반영됐는지 원문과 나란히 확인해 주세요. 적용 여부는 직접 결정해요.")
  const back = h("button", { class: "button button--ghost", onclick: () => goTo("coach"), text: "수정 취소" })

  if (r.busy || (!d && !r.error)) {
    return h("section", { class: "screen" }, title,
      h("div", { class: "card progress-card", role: "status" }, h("span", { class: "typing" }, h("span"), h("span"), h("span")), h("p", { text: "대상 문단 하나만 고친 수정안을 만들고 있어요. 서버는 대본을 바꾸지 않아요." }), h("button", { class: "button button--ghost", onclick: () => r.controller?.abort(), text: "취소" })))
  }
  if (!d) {
    return h("section", { class: "screen" }, title,
      h("div", { class: "card card--warning" }, h("p", { role: "alert", text: r.error })),
      h("div", { class: "screen-actions" }, back, h("span", { text: "원문은 그대로예요." }), h("button", { class: "button button--primary", onclick: requestRevision, text: "다시 요청" })))
  }
  if (d.status !== "proposed") {
    const choices = d.choices || []
    return h("section", { class: "screen" }, title,
      h("div", { class: "revision-banner" }, h("span", { class: "ai-orb" }, icon("sparkle", 19)), h("div", {}, h("strong", { text: d.status === "no-change-needed" ? "바꿀 필요가 없어 보여요" : "어떻게 고칠지 알려 주세요" }), h("p", { text: (d.reasons || []).join(" ") }))),
      d.status === "needs-confirmation" && h("div", { class: "card focus-card" },
        h("span", { class: "field-label", text: "바꾸고 싶은 점" }),
        h("div", { class: "time-options" }, choices.map((ch) => h("button", { class: r.focus.includes(ch.value) ? "is-selected" : "", "aria-pressed": String(r.focus.includes(ch.value)), onclick: () => { r.focus = r.focus.includes(ch.value) ? r.focus.filter((f) => f !== ch.value) : [...r.focus, ch.value]; render() }, text: FOCUS_LABELS[ch.value] || ch.label }))),
        h("textarea", { class: "evidence-editor", maxlength: 400, placeholder: "직접 요청을 적어도 돼요. 예: ‘한 달’과 ‘일 년’의 차이를 더 분명하게", value: r.requestText, oninput: (e) => { r.requestText = e.target.value } }),
      ),
      r.error && h("p", { class: "coach-error", role: "alert", text: r.error }),
      h("div", { class: "screen-actions" }, back, h("span", { text: "원문은 그대로예요." }),
        d.status === "needs-confirmation"
          ? h("button", { class: "button button--primary", onclick: () => { if (r.focus.length || r.requestText.trim()) requestRevision() } }, "이렇게 고쳐 주세요", icon("arrow", 17))
          : h("button", { class: "button button--primary", onclick: () => { state.applied = null; goTo("repractice") } }, "그대로 다시 연습", icon("arrow", 17))),
    )
  }

  const p = d.preservation || {}
  const local = r.localCheck
  const warnings = [...new Set([...(local ? local.warnings : p.warnings || []), ...(p.mustPreserveMissing || []).map((m) => `보존 문구 누락: ${m}`)])]
  const blocked = Boolean(p.blocked || (local ? local.blocked : false))
  const evidence = d.basis?.evidence || []
  const proposalBox = r.editing
    ? h("textarea", { "aria-label": "수정안 직접 편집", value: r.proposal, oninput: (e) => { r.proposal = e.target.value; r.meaningConfirmed = false } })
    : h("p", { text: r.proposal })
  return h("section", { class: "screen" }, title,
    h("div", { class: "revision-banner" },
      h("span", { class: "ai-orb" }, icon("sparkle", 19)),
      h("div", {}, h("strong", { text: "수정안이 준비됐어요" }), h("p", { text: d.revision.reason || "대화에서 정리한 내용을 반영했어요." })),
      h("span", { text: `${d.model || "자체 AI"} · 확인 필요` }),
    ),
    h("div", { class: "comparison-grid" },
      h("div", { class: "card compare-card compare-card--original" },
        h("div", { class: "compare-heading" }, h("div", {}, h("span", { text: "원문" }), h("strong", { text: `대본 ${versionLabel(state.session.scriptVersionId)} · 문단 ${para.paragraphIndex + 1}` })), h("span", { text: "보존됨" })),
        h("p", { text: d.target.text }),
      ),
      h("div", { class: "comparison-arrow" }, icon("arrow", 22)),
      h("div", { class: "card compare-card compare-card--proposal" },
        h("div", { class: "compare-heading" }, h("div", {}, h("span", { text: "수정안" }), h("strong", { text: "적용하면 새 대본 버전으로 저장" })), h("button", { onclick: () => toggleEditing(r), text: r.editing ? "편집 취소" : "직접 편집" })),
        proposalBox,
        r.editing && h("button", { class: "validate-button", onclick: () => { r.localCheck = checkRevision(d.target.text, r.proposal); r.checked = r.proposal; r.editing = false; render() }, text: "편집 내용 검사" }),
      ),
    ),
    h("div", { class: "revision-details" },
      h("div", { class: "card" }, h("span", { class: "detail-icon detail-icon--purple" }, icon("sparkle", 18)), h("div", {}, h("strong", { text: "반영한 내용" }), h("p", { text: (d.appliedUserInputs || []).join(" · ") || "대화 요약" }))),
      h("div", { class: "card" }, h("span", { class: "detail-icon detail-icon--blue" }, icon("file", 18)), h("div", {}, h("strong", { text: "자료 근거" }), h("p", { text: evidence.length ? evidence.map((e) => `“${clip(e.quote, 80)}”`).join(" ") : "입력한 근거 자료에서 인용한 문장이 없어 대화 내용만 반영했어요." }))),
      h("div", { class: `card ${blocked || warnings.length ? "card--warning" : ""}` },
        h("span", { class: `detail-icon ${blocked ? "detail-icon--amber" : warnings.length ? "detail-icon--amber" : "detail-icon--green"}` }, icon(blocked || warnings.length ? "file" : "check", 18)),
        h("div", {}, h("strong", { text: `보존 검사 ${blocked ? "적용 불가" : warnings.length ? "확인 필요" : "통과"}${local ? " (편집본)" : ""}` }),
          h("p", { text: warnings.length ? warnings.join(" · ") : p.note || "수치·단위·부정·조건 표현이 유지됐어요. 의미가 같다고 보장하지는 않아요." })),
      ),
    ),
    h("label", { class: "studio-consent" }, h("input", { type: "checkbox", checked: Boolean(r.meaningConfirmed), onchange: (e) => { r.meaningConfirmed = e.target.checked; render() } }), "수치·조건·부정 표현과 원래 뜻을 직접 확인했어요."),
    d.basis?.unverified?.length ? h("p", { class: "align-reason", text: `설명 정확성은 확인되지 않았어요: ${d.basis.unverified.join(" ")}` }) : null,
    r.error && h("p", { class: "coach-error", role: "alert", text: r.error }),
    h("div", { class: "screen-actions" },
      back,
      h("span", { text: blocked ? "수치·단위가 바뀌었거나 빠졌어요. 직접 편집해 고친 뒤 검사해 주세요." : "적용하면 대상 문단만 교체되고 원문과 이전 기록은 유지됩니다." }),
      h("button", { class: "button button--soft", onclick: () => { r.data = null; requestRevision() }, text: "다시 만들기" }),
      h("button", { class: "button button--primary", disabled: blocked || r.editing || !r.meaningConfirmed, onclick: applyRevision }, "수정안 적용하기", icon("check", 17)),
    ),
  )
}

/* ───────── 6. 다시 연습 ───────── */

/** 원본 연습에서 대상 문단을 말한 시간 범위(전사 연결 기준 어림값). 연결이 없으면 검토 구간 앞뒤 6초. */
function baseWindow() {
  const item = selectedItem()
  const { sentence } = coachContext()
  const ids = sentence ? new Set(paragraphOf(sentence).sentenceIds) : new Set()
  const segs = (state.align?.data?.segments || []).filter((g) => g.alignment && ids.has(g.alignment.sentenceId))
  if (segs.length) return { from: Math.min(...segs.map((g) => g.startSecond), item.startSec), to: Math.max(...segs.map((g) => g.endSecond), item.endSec), basis: "전사 구간이 이 문단에 연결된 시간" }
  return { from: Math.max(0, item.startSec - 6), to: Math.min(state.session.totalSec, item.endSec + 6), basis: "전사 연결이 없어 검토 구간 앞뒤 6초" }
}

async function finishRepractice() {
  const item = selectedItem()
  const scriptVersionId = currentVersionId()
  const out = await stopRecording()
  if (!out) return
  const base = state.session
  const built = makeSession({ out, script: state.script, scriptVersionId, practiceOf: { baseId: base.id, itemId: item.id, title: item.title, startSec: item.startSec, endSec: item.endSec, reason: state.coach?.last?.summary?.userReports?.[0]?.reason || null, conds: [] } })
  state.repractice = { session: built.session }
  render()
  await analyzeSession(built, out.samples, out.sampleRate, render)
  render()
}

function repracticeScreen() {
  const base = state.session
  const item = selectedItem()
  const { sentence } = coachContext()
  if (!base || !item || !sentence) return h("section", { class: "screen" }, pageTitle("STEP 6 · 다시 연습", "다시 연습할 구간이 없어요", "결과 분석에서 구간을 고르고 코칭을 마쳐 주세요."))
  const para = paragraphOf(sentence)
  const text = state.applied?.text ?? para.text
  const done = state.repractice?.session
  if (!done) {
    return h("section", { class: "screen" },
      pageTitle("STEP 6 · 다시 연습", "달라진 문장으로 다시 말해 볼까요?", "바뀐 대본으로 선택한 문단만 다시 연습하고, 실제 측정한 항목을 나란히 비교해 보세요."),
      h("div", { class: "repractice-context" }, h("span", { text: "부분 연습" }), h("div", {}, h("strong", { text: `${formatClock(item.startSec)} ${item.title} 구간` }), h("small", { text: `원본 연습에서 이어짐 · ${state.applied ? `수정 대본 ${versionLabel(state.applied.versionId)}` : "대본 그대로"}` }))),
      h("div", { class: "practice-layout" },
        h("div", { class: "practice-panel" },
          h("div", { class: "panel-title" }, h("span", {}, icon("video", 19), "내 영상"), h("span", { class: `status-pill ${rec.running && !rec.paused ? "status-pill--recording" : ""}`, text: rec.running ? (rec.paused ? "일시정지" : "녹화 중") : cam.status === "ready" ? "준비됨" : "연결 확인" })),
          livePreview(),
        ),
        h("div", { class: "practice-panel practice-panel--accent" },
          h("div", { class: "panel-title" }, h("span", {}, icon("file", 19), state.applied ? "수정한 대본" : "연습할 문단"), h("span", { class: "version-pill", text: state.applied ? versionLabel(state.applied.versionId) : versionLabel(base.scriptVersionId) })),
          h("div", { class: "practice-script practice-script--focus" }, h("p", { text })),
        ),
      ),
      recordingControls({ kind: "partial", startLabel: "구간 녹화 시작", stopLabel: "구간 연습 종료", onStop: finishRepractice, rightLabel: "연습 범위", rightValue: `문단 ${para.paragraphIndex + 1}` }),
      h("p", { class: "demo-disclaimer", "data-cam-status": "", text: CAM_TEXT[cam.status] }),
    )
  }

  const win = baseWindow()
  const before = windowMetrics(base, win.from, win.to)
  const after = windowMetrics(done, 0, Math.max(1, done.totalSec))
  const countIn = (s, type, from, to) => s.analysis?.silence?.status === "ok" ? (s.analysis.items || []).filter((it) => it.type === type && it.endSec > from && it.startSec < to).length : null
  const fillersIn = (s, from, to) => s.media?.speech === "ok" ? (s.analysis.fillers?.times || []).filter((t) => t >= from && t <= to).length : null
  const fmt = (v, unit) => (v == null ? "측정 불가" : `${v}${unit}`)
  const diff = (a, b, unit, digits = 0) => (a == null || b == null ? "—" : `${b - a > 0 ? "+" : ""}${(b - a).toFixed(digits)}${unit}`)
  const lenBefore = Math.round((win.to - win.from) * 10) / 10
  const lenAfter = Math.round(done.totalSec * 10) / 10
  const silB = countIn(base, "silence", win.from, win.to)
  const silA = countIn(done, "silence", 0, done.totalSec + 1)
  const filB = fillersIn(base, win.from, win.to)
  const filA = fillersIn(done, 0, done.totalSec + 1)
  const rows = [
    ["구간 시간", `${lenBefore}초`, `${lenAfter}초`, diff(lenBefore, lenAfter, "초", 1)],
    ["긴 침묵(3초 이상)", fmt(silB, "회"), fmt(silA, "회"), diff(silB, silA, "회")],
    ["말하기 속도", fmt(before.rate, " 음절/분"), fmt(after.rate, " 음절/분"), diff(before.rate, after.rate, "")],
    ["군말 후보", fmt(filB, "회"), fmt(filA, "회"), diff(filB, filA, "회")],
  ]
  const playBoth = () => {
    seekPlayer(base.videoBlob, win.from, { play: true })
    seekPlayer(done.videoBlob, 0, { play: true })
  }
  return h("section", { class: "screen" },
    pageTitle("STEP 6 · 다시 연습", "두 번의 연습을 나란히 살펴봤어요", "바뀐 대본으로 다시 말한 결과예요. 실제로 측정한 값만 보여 드려요."),
    analysisProgress(),
    h("div", { class: "comparison-notice" }, icon("file", 20), h("div", {},
      h("strong", { text: state.applied ? "대본이 변경된 부분 연습 비교예요" : "같은 문단의 부분 연습 비교예요" }),
      h("p", { text: `이전 값은 원본 전체 연습 중 ${formatClock(win.from)}~${formatClock(win.to)}(${win.basis})에서 잰 어림값이에요. 아래 값만으로 이해도나 발표 향상을 판정하지 않아요.` }),
    )),
    h("div", { class: "before-after" },
      h("div", { class: "card attempt-card" }, h("div", {}, h("span", { text: "이전" }), h("strong", { text: "원본 연습" }), h("small", { text: `대본 ${versionLabel(base.scriptVersionId)} · 전체 연습` })), playbackBox(base.videoBlob, { compact: true, label: "원본 연습 영상" })),
      h("div", { class: "compare-divider" }, h("span", { text: "VS" })),
      h("div", { class: "card attempt-card attempt-card--current" }, h("div", {}, h("span", { text: "이번" }), h("strong", { text: "다시 연습" }), h("small", { text: `대본 ${versionLabel(done.scriptVersionId)} · 부분 연습` })), playbackBox(done.videoBlob, { compact: true, label: "다시 연습 영상" })),
    ),
    h("div", { class: "metrics-table card", "data-testid": "practice-compare" },
      h("div", { class: "metrics-row metrics-row--head" }, ["측정 항목", "이전", "이번", "차이"].map((t) => h("span", { text: t }))),
      rows.map(([label, a, b, c]) => h("div", { class: "metrics-row" }, h("strong", { text: label }), h("span", { text: a }), h("span", { text: b }), h("span", { class: "metric-change", text: c }))),
    ),
    noticeList(done),
    h("div", { class: "screen-actions" },
      h("span", { text: "두 연습 모두 이 기기의 연습 기록에 저장했어요." }),
      (base.videoBlob || done.videoBlob) && h("button", { class: "button button--ghost", onclick: playBoth, text: "두 영상 함께 재생" }),
      h("button", { class: "button button--soft", disabled: state.analysis.running, onclick: () => { state.repractice = null; openCamera(); render() }, text: "한 번 더 연습" }),
      h("button", { class: "button button--ghost", disabled: state.analysis.running, onclick: () => goTo("results"), text: "다른 구간 살펴보기" }),
      h("button", { class: "button button--primary", disabled: state.analysis.running, onclick: () => goTo("prepare") }, "새 연습 준비하기", icon("arrow", 17)),
    ),
  )
}

/* ───────── 온보딩 ───────── */

const ONBOARDING = [
  { eyebrow: "PRACTICE INTELLIGENCE", title: "연습을 기록하고,\n근거로 성장하세요.", description: "대본 준비부터 웹캠 연습, 발표 분석, AI 코칭과 재연습까지 하나의 흐름으로 연결합니다. 감이 아닌 기록으로 다음 발표를 준비하세요.", note: "카메라·마이크는 연습 화면에서만 켜고, 영상은 이 기기에만 저장해요.", icon: "clock" },
  { eyebrow: "FOCUSED REVIEW", title: "발표 전체가 아닌,\n바꿀 순간에 집중하세요.", description: "긴 침묵, 반복 표현, 말하기 속도처럼 실제 측정된 구간을 영상과 대본에서 함께 확인합니다. 분석은 판단이 아니라 검토를 위한 근거로 사용해요.", note: "자동으로 찾은 대본 위치는 직접 확인한 뒤 사용합니다.", icon: "chart" },
  { eyebrow: "RESPONSIBLE AI COACHING", title: "내 말의 의도는 그대로,\n표현은 더 명확하게.", description: "선택한 구간에서 생각을 정리하고, 대화를 바탕으로 문단 수정안을 비교합니다. 적용 여부는 항상 사용자가 결정합니다.", note: "AI는 사용자의 확인 없이 대본을 변경하지 않아요.", icon: "shield" },
]
let onboardingStep = 0

function finishOnboarding() {
  state.onboarding = false
  prefs.onboarded = true
  savePrefs()
  render()
}

function onboarding() {
  const step = onboardingStep
  const c = ONBOARDING[step]
  const setStep = (n) => { onboardingStep = n; render() }
  const visual = [
    () => h("div", { class: "workflow-preview" },
      h("div", { class: "preview-heading" }, h("div", {}, h("span", { text: "오늘의 연습" }), h("strong", { text: `발표 연습 · ${state.targetMinutes}분` })), h("em", { text: "대본 버전 1" })),
      h("div", { class: "workflow-track" }, [["file", "대본 준비"], ["video", "웹캠 연습"], ["chart", "결과 분석"], ["sparkle", "AI 코칭"]].map(([ic, label], i) => h("div", {}, h("span", { class: i === 0 ? "is-active" : "" }, icon(ic, 19)), h("small", { text: label })))),
      h("div", { class: "workflow-document" }, h("span"), h("span"), h("span"), h("span"), h("i", { text: "연습할 대본을 준비해 주세요" })),
      h("div", { class: "preview-footer" }, h("div", {}, h("span", { text: "목표 시간" }), h("strong", { text: mmss(state.targetMinutes * 60) })), h("div", {}, h("span", { text: "문단" }), h("strong", { text: `${state.script.split(/\n\s*\n/).filter((p) => p.trim()).length}개` })), h("button", { onclick: finishOnboarding, text: "연습 준비" })),
    ),
    () => h("div", { class: "analysis-preview" },
      h("div", { class: "preview-heading" }, h("div", {}, h("span", { text: "발표 분석" }), h("strong", { text: "검토 구간 예시" })), h("em", { class: "is-complete", text: "예시" })),
      h("div", { class: "analysis-chart" }, [42, 68, 47, 82, 56, 73, 44, 64, 78, 51, 69, 58].map((v, i) => { const bar = h("i", { class: i === 3 || i === 8 ? "is-highlighted" : "" }); bar.style.height = `${v}%`; return bar }), h("span")),
      h("div", { class: "analysis-events" }, [["violet", "00:42", "긴 침묵", "4.2초"], ["amber", "01:18", "군말 후보", "“음” 3회"], ["blue", "02:06", "속도 변화", "빠름"]].map(([tone, t, label, d]) => h("div", {}, h("span", { class: `segment-dot segment-dot--${tone}` }), h("strong", { text: t }), h("p", { text: label }), h("em", { text: d })))),
    ),
    () => h("div", { class: "revision-preview" },
      h("div", { class: "preview-heading preview-heading--ai" }, h("span", { class: "ai-orb" }, icon("sparkle", 18)), h("div", {}, h("span", { text: "대화 기반 수정 제안" }), h("strong", { text: "선택한 문단만 더 명확하게" })), h("em", { text: "검토 필요" })),
      h("div", { class: "revision-preview__compare" }, h("div", {}, h("span", { text: "원문" }), h("p", { text: "하루 10분의 작은 습관은 당장 눈에 띄는 결과를 만들지는 않습니다." })), h("span", {}, icon("arrow", 18)), h("div", {}, h("span", { text: "수정안" }), h("p", { text: "하루 10분은 작아 보이지만, 한 달이면 책 한 권을 읽는 시간이 됩니다." }))),
      h("div", { class: "revision-preview__checks" }, h("span", {}, icon("check", 14), "핵심 수치 유지"), h("span", {}, icon("check", 14), "대상 문단만 변경"), h("span", {}, icon("edit", 14), "비교 후 적용")),
    ),
  ][step]
  return h("div", { class: "onboarding-shell" },
    h("header", { class: "onboarding-header" },
      h("div", { class: "onboarding-brand" }, brandMark(), h("span", { text: "다시봄" }), h("em", { text: "Presentation Practice Studio" })),
      h("button", { class: "onboarding-skip", onclick: finishOnboarding }, "둘러보기 건너뛰기", icon("arrow", 16)),
    ),
    h("main", { class: "onboarding-main", "aria-label": "사용 방법" },
      h("section", { class: "onboarding-copy" },
        h("div", { class: "onboarding-step-label" }, h("span", { text: `0${step + 1}` }), h("i"), h("span", { text: "03" })),
        h("p", { class: "onboarding-eyebrow", text: c.eyebrow }),
        h("h1", {}, c.title.split("\n").map((line) => h("span", { text: line }))),
        h("p", { class: "onboarding-description", text: c.description }),
        h("div", { class: "onboarding-assurance" }, icon(c.icon, 18), h("span", { text: c.note })),
        h("div", { class: "onboarding-actions" },
          h("button", { "aria-label": "이전 온보딩 화면", class: "onboarding-back", disabled: step === 0, onclick: () => setStep(Math.max(0, step - 1)) }, icon("arrow", 18)),
          h("button", { class: "onboarding-next", onclick: () => (step < ONBOARDING.length - 1 ? setStep(step + 1) : finishOnboarding()) }, step < ONBOARDING.length - 1 ? "다음" : "첫 연습 시작하기", icon("arrow", 18)),
          step === 0 && h("button", { class: "onboarding-direct", onclick: finishOnboarding }, "바로 서비스 이용하기", icon("arrow", 16)),
        ),
        h("div", { class: "onboarding-dots", "aria-label": `온보딩 ${step + 1} / 3` }, ONBOARDING.map((o, i) => h("button", { "aria-label": `${i + 1}번째 화면`, class: step === i ? "is-active" : "", onclick: () => setStep(i) }))),
      ),
      h("section", { class: `onboarding-visual onboarding-visual--${step + 1}` },
        h("div", { class: "visual-grid" }), h("div", { class: "visual-glow" }),
        visual(),
        h("div", { class: "visual-stat visual-stat--top" }, h("span", {}, icon("shield", 15)), h("div", {}, h("strong", { text: "사용자 확인 중심" }), h("small", { text: "자동 변경 없음" }))),
        h("div", { class: "visual-stat visual-stat--bottom" }, h("span", {}, icon("chart", 15)), h("div", {}, h("strong", { text: "하나의 연습 흐름" }), h("small", { text: "기록부터 재연습까지" }))),
      ),
    ),
    h("footer", { class: "onboarding-footer" }, h("span", { text: "DASIBOM · PRACTICE WITH EVIDENCE" }), h("span", { text: state.model?.message || "연습 기록은 이 기기에만 저장돼요" })),
  )
}

/* ───────── 그리기 ───────── */

const root = document.getElementById("root")
const SCREENS = { prepare: prepareScreen, practice: practiceScreen, results: resultsScreen, coach: coachScreen, revision: revisionScreen, repractice: repracticeScreen }

function render() {
  // 입력 중인 칸의 포커스·커서를 지킨다(다시 그려도 같은 aria-label 칸으로 돌려놓는다).
  const active = document.activeElement
  const keep = active && root.contains(active) && active.matches("textarea, input") ? { label: active.getAttribute("aria-label"), start: active.selectionStart, end: active.selectionEnd } : null
  tickers = []
  if (state.onboarding) {
    root.replaceChildren(onboarding())
    return
  }
  root.replaceChildren(h("div", { class: "app-shell" }, appHeader(), stageRail(), h("main", { class: "main-content" }, SCREENS[state.stage]()), mobileNav()))
  if (keep?.label) {
    const el = root.querySelector(`[aria-label="${CSS.escape(keep.label)}"]`)
    if (el && !el.disabled) {
      el.focus()
      try { el.setSelectionRange(keep.start, keep.end) } catch { /* 선택 범위를 못 쓰는 칸 */ }
    }
  }
  if (rec.running) tick()
}

async function loadModelStatus() {
  try {
    const res = await fetch("/api/model-status", { signal: AbortSignal.timeout(10_000) })
    state.model = await res.json()
  } catch {
    state.model = null
  }
}

window.addEventListener("beforeunload", (e) => {
  if (rec.running || state.analysis.running) e.preventDefault()
})
window.addEventListener("pagehide", () => releaseCamera())
navigator.mediaDevices?.addEventListener?.("devicechange", () => refreshDevices().then(() => state.stage === "prepare" && render()))

refreshDevices().then(render)
loadModelStatus().then(render)
render()
