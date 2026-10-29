// 다시봄 메인 화면. 처음에는 온보딩 4단계, 이후에는 한 화면에서 녹화 → 분석 → 구간 질문 → 다시 연습 → 전후 비교를 한다.
// 주소: #/ (연습), #/result/ID (저장된 연습 다시 보기), #/history (연습 기록)
import { formatClock, formatSigned } from "./time.js"
import { parsePlan, planSignature, planTotal, paceAt, sectionResults } from "./plan.js"
import {
  analyzeGaze, analyzeSilence, buildReviewItems, classifyResult, compareSessions, conditionKey, liveRate, windowMetrics,
  GAZE_MIN_SEC, LIVE_SPEED_WINDOW_SEC, SILENCE_MIN_SEC, SPEED_DEVIATION, SPEED_WINDOW_SEC,
} from "./analysis.js"
import { CONDITIONS, QUESTION_LIMIT, REASONS, expectedSentence, keywordsOf, practiceRange, splitSentences, suggestFor } from "./coach.js"
import { GazeTracker } from "./gaze.js"
import { MediaCapture, SpeechCapture } from "./recorder.js"
import { deleteSession, getSession, listSessions, saveSession } from "./storage.js"
import { measurementCards } from "./measurement-ui.js"
import { sessionScript } from "./script.js"
import { createScriptImport } from "./script-ui.js"
import { analyzeRecordedSpeech } from "./recording-analysis.js"

const app = document.getElementById("app")
const SETTINGS_KEY = "dasibom.settings"
const ONBOARDED_KEY = "dasibom.onboarded"
const SAMPLE_SCRIPT = `안녕하세요. 오늘은 발표 연습을 돕는 웹 서비스, 다시봄을 소개하겠습니다.
발표를 연습할 때 가장 어려운 점은 내가 어디서 막히는지 스스로 알기 어렵다는 것입니다.
다시봄은 대본을 보며 웹캠으로 연습을 녹화하고, 말 속도와 긴 침묵, 군말, 시선을 분석합니다.
분석 결과는 점수가 아니라 다시 볼 구간으로 보여줍니다.
구간을 누르면 그때의 영상을 보고, 무슨 일이 있었는지 짧게 답할 수 있습니다.
답에 맞춰 핵심어 카드나 진행 막대 같은 연습 방법을 제안하고, 다시 연습한 결과를 전후로 비교합니다.
모든 영상은 이 기기 안에서만 처리됩니다. 감사합니다.`
const DEFAULT_RAW = { tmin: "3", tsec: "0", tol: "0", warn: "30", smin: "", smax: "", plan: "", video: true, speech: false, transcribe: true, script: SAMPLE_SCRIPT, keywords: false, progress: false }
const STEPS = [
  { title: "목표 시간·대본 입력", desc: "발표 시간을 정하고 대본을 붙여 넣어요. 구간별 시간 계획도 적을 수 있어요." },
  { title: "녹화", desc: "웹캠·마이크로 연습하면 남은 시간과 말하기 속도를 알려줘요. 카메라가 없으면 시간만 재요." },
  { title: "다시 볼 구간", desc: "긴 침묵·반복·군말·시선 이탈 구간을 찾아, 누르면 그 위치부터 재생해요." },
  { title: "질문과 재연습", desc: "그때 무슨 일이 있었는지 답하면, 바꿔 볼 연습 방법을 제안하고 전후를 비교해요." },
]
const TYPE_GROUP = { silence: "긴 침묵", repeat: "반복·군말", filler: "반복·군말", gaze: "시선 이탈", speed: "속도 변화", section: "구간 시간", blink: "눈 깜빡임" }
const GROUPS = ["긴 침묵", "반복·군말", "시선 이탈", "속도 변화", "구간 시간", "눈 깜빡임"]

/* ───────── 작은 도우미 ───────── */

function h(tag, props, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === "class") e.className = v
    else if (k === "style") e.style.cssText = v // CSP가 style 속성은 막지만 CSSOM으로 넣는 값은 허용한다
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === "value" || k === "checked" || k === "disabled" || k === "hidden" || k === "muted") e[k] = v
    else e.setAttribute(k, v === true ? "" : String(v))
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return e
}

/** 빈 값(null·undefined·false·"")을 빼고 자식을 바꾼다. */
function put(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== ""))
}

const store = {
  get(k) {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* 저장 못 해도 화면은 동작한다 */
    }
  },
}

function loadRaw() {
  try {
    return { ...DEFAULT_RAW, ...JSON.parse(store.get(SETTINGS_KEY) || "{}") }
  } catch {
    return { ...DEFAULT_RAW }
  }
}

function newId() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/* ───────── 상태 ───────── */

const state = {
  raw: loadRaw(),
  onboarding: false,
  obStep: 0,
  media: { capture: null, status: { audio: "off", video: "off" }, notices: [], cam: "idle", promise: null },
  gaze: new GazeTracker(),
  phase: "idle", // idle | starting | countdown | recording | saving | recorded | analyzing | analyzed
  practice: null,
  pending: null,
  analysisController: null,
  analysisProgress: "",
  session: null,
  player: null,
  ctx: null, // 구간 다시 연습: { baseId, item, reason, conds, range, targetSec }
  sel: null, // 질문 카드: { id, step, reason, custom, picks }
  editing: false,
  settingsOpen: false,
  countdown: 0,
  errors: [],
  view: "live",
  hud: null,
}
const saveRaw = () => store.set(SETTINGS_KEY, JSON.stringify(state.raw))
// 대본 TXT 불러오기. 불러온 파일명은 state.raw.scriptFile({ name, edited })에 따로 둔다.
// 예시 대본 그대로이거나 비어 있으면 바로 바꾸고, 직접 쓰거나 불러온 대본이 있으면 먼저 묻는다.
const scriptImport = createScriptImport({
  needsConfirm: (text) => Boolean(state.raw.script?.trim()) && state.raw.script !== SAMPLE_SCRIPT && state.raw.script !== text,
  apply: (name, text) => {
    state.raw.script = text
    state.raw.scriptFile = { name, edited: false }
    saveRaw()
  },
  getFile: () => state.raw.scriptFile || null,
  onChange: () => renderScript(),
})
function scriptEdited() {
  if (state.raw.scriptFile) state.raw.scriptFile = state.raw.script.trim() ? { ...state.raw.scriptFile, edited: true } : null
  scriptImport.refresh()
}
const busy = () => ["starting", "countdown", "recording", "saving", "analyzing"].includes(state.phase)

/* ───────── 화면 뼈대 ───────── */

const header = h("header", { class: "appbar" })
const errorsBox = h("div", { class: "wrap" })
const stageCol = h("section", { class: "stage-col", "aria-label": "녹화 화면" })
const scriptCol = h("aside", { class: "script-col card", "aria-label": "대본" })
const workspace = h("div", { class: "workspace" }, stageCol, scriptCol)
const results = h("div", { class: "results" })
const liveVideo = h("video", { class: "stage-video", muted: true, autoplay: true, playsinline: true, "aria-label": "웹캠 미리보기" })
liveVideo.muted = true

function render() {
  if (state.onboarding) return renderOnboarding()
  if ((location.hash || "#/") === "#/history") return renderHistory()
  renderHeader()
  put(errorsBox, 
    state.errors.length ? h("div", { class: "errors", role: "alert" }, h("strong", null, "입력을 확인해 주세요."), h("ul", null, state.errors.map((e) => h("li", null, e)))) : "",
  )
  renderStage()
  renderScript()
  renderResults()
  put(app, header, errorsBox, h("main", { class: "wrap" }, workspace, results))
}

/* ───────── 온보딩 ───────── */

function renderOnboarding() {
  const i = state.obStep
  const step = STEPS[i]
  const demo = [
    h("div", { class: "ob-demo" }, h("div", { class: "ob-row" }, h("span", { class: "hint" }, "목표 시간"), h("span", { class: "tag tag-accent" }, "3분"), h("span", { class: "tag tag-neutral" }, "5분"), h("span", { class: "tag tag-neutral" }, "10분")), h("ol", { class: "ob-lines" }, h("li", null, "안녕하세요. 오늘은 발표 연습을 돕는…"), h("li", null, "발표를 연습할 때 가장 어려운 점은…"))),
    h("div", { class: "ob-demo ob-row" }, h("span", { class: "rec-dot" }), h("span", null, "녹화 중 0:42"), h("span", { class: "hint" }, "남은 시간 2:18"), h("span", { class: "tag tag-accent" }, "290 음절/분")),
    h("div", { class: "ob-demo" }, h("div", { class: "ob-bars" }, h("span", { style: "left:12%;width:9%" }), h("span", { style: "left:40%;width:6%" }), h("span", { style: "left:70%;width:12%" })), h("div", { class: "ob-row hint" }, "긴 침묵 · 반복·군말 · 시선 이탈")),
    h("div", { class: "ob-demo" }, h("p", null, "이 구간에서 어떤 일이 있었나요?"), h("div", { class: "ob-row" }, h("span", { class: "tag tag-accent" }, "다음 내용이 안 떠오름"), h("span", { class: "tag tag-neutral" }, "시간 신경 쓰임"), h("span", { class: "tag tag-neutral" }, "모르겠어요")), h("p", { class: "hint" }, "제안: 핵심어 카드로 다시 연습하기")),
  ][i]
  put(app, 
    h(
      "main",
      { class: "onboarding", "aria-label": "사용 방법" },
      h(
        "div",
        { class: "ob-side" },
        h("div", { class: "brand" }, "다시봄"),
        h("h1", null, "발표 연습, 이렇게 진행돼요"),
        h("p", { class: "lead" }, "대본을 보며 녹화하고, 다시 볼 구간을 함께 살펴본 뒤 다시 연습해요."),
        h("ol", { class: "ob-steps" }, STEPS.map((s, n) => h("li", null, h("button", { type: "button", "aria-current": n === i ? "step" : null, onclick: () => ((state.obStep = n), render()) }, h("span", { class: "ob-n" }, n + 1), s.title)))),
      ),
      h(
        "section",
        { class: "ob-card card elev-md" },
        h("span", { class: "hint" }, `단계 ${i + 1} / ${STEPS.length}`),
        h("h2", null, step.title),
        h("p", null, step.desc),
        demo,
        h(
          "div",
          { class: "ob-actions" },
          h("span", { class: "hint" }, "영상은 이 기기 밖으로 보내지 않아요"),
          h("button", { type: "button", class: "btn btn-ghost", onclick: finishOnboarding }, "건너뛰기"),
          h("button", { type: "button", class: "btn btn-secondary", disabled: i === 0, onclick: () => ((state.obStep = i - 1), render()) }, "이전"),
          h("button", { type: "button", class: "btn btn-primary", onclick: () => (i === STEPS.length - 1 ? finishOnboarding() : ((state.obStep = i + 1), render())) }, i === STEPS.length - 1 ? "시작하기" : "다음"),
        ),
      ),
    ),
  )
  app.focus({ preventScroll: true })
}

function finishOnboarding() {
  store.set(ONBOARDED_KEY, "1")
  state.onboarding = false
  render()
  initCamera()
}

/* ───────── 카메라·마이크 ───────── */

function initCamera() {
  if (state.media.promise) return state.media.promise
  state.media.cam = "connecting"
  state.media.promise = (async () => {
    const { capture, notices, status } = await MediaCapture.open({ audio: true, video: true })
    Object.assign(state.media, { capture, notices, status, cam: capture ? (status.video === "ok" ? "ready" : "audio") : "failed" })
    if (capture && status.video === "ok") {
      liveVideo.srcObject = capture.stream
      liveVideo.play().catch(() => {})
      state.gaze.load().then(() => !busy() && renderHeader())
    }
    if (!busy()) render()
  })()
  return state.media.promise
}

function retryCamera() {
  state.media.promise = null
  initCamera()
  render()
}

/* ───────── 머리 영역 ───────── */

function camLabel() {
  return { idle: "카메라 대기", connecting: "카메라 연결 중", ready: "카메라·마이크 연결됨", audio: "마이크만 연결됨", failed: "카메라·마이크 없음" }[state.media.cam]
}
function gazeLabel() {
  if (state.media.cam !== "ready") return "시선 추적 꺼짐"
  return { idle: "시선 추적 준비 중", loading: "시선 추적 준비 중", ready: "시선 추적 켜짐", off: "시선 추적 사용 불가" }[state.gaze.status]
}
function speechLabel() {
  return state.raw.transcribe !== false ? "종료 후 자체 AI 전사 켜짐" : "자체 AI 전사 꺼짐"
}

function renderHeader() {
  const b = busy()
  const rec = state.phase === "recording"
  const p = state.practice
  const presets = [3, 5, 10].map((m) =>
    h(
      "button",
      {
        type: "button",
        class: "seg-btn",
        "aria-pressed": String(state.raw.tmin === String(m) && Number(state.raw.tsec || 0) === 0),
        disabled: b || Boolean(state.ctx),
        onclick: () => {
          state.raw.tmin = String(m)
          state.raw.tsec = "0"
          saveRaw()
          renderHeader()
        },
      },
      `${m}분`,
    ),
  )
  const num = (key, label) =>
    h("input", {
      id: `f-${key}`, class: "input num", type: "number", min: "0", inputmode: "numeric", "aria-label": label, value: state.raw[key], disabled: b,
      oninput: (e) => {
        state.raw[key] = e.target.value
        saveRaw()
        presets.forEach((btn, n) => btn.setAttribute("aria-pressed", String(state.raw.tmin === String([3, 5, 10][n]) && Number(state.raw.tsec || 0) === 0)))
      },
    })
  const target = state.ctx
    ? h("div", { class: "target" }, h("span", { class: "hint" }, "목표 시간"), h("span", { class: "tag tag-accent" }, `구간 연습 약 ${formatClock(state.ctx.targetSec)}`))
    : h("div", { class: "target" }, h("span", { class: "hint" }, "목표 시간"), h("div", { class: "seg" }, presets), num("tmin", "목표 시간 분"), h("span", { class: "hint" }, "분"), num("tsec", "목표 시간 초"), h("span", { class: "hint" }, "초"))
  put(header, 
    h("a", { class: "brand", href: "#/", "aria-disabled": b ? "true" : null }, "다시봄"),
    h(
      "div",
      { class: "rec-actions" },
      h("button", { type: "button", class: "btn btn-primary", id: "btn-start", disabled: b, onclick: startRecording }, h("span", { class: "rec-dot" }), "녹화 시작"),
      rec ? h("button", { type: "button", class: "btn btn-secondary", id: "btn-pause", onclick: togglePause }, p.running ? "일시정지" : "다시 시작") : null,
      rec && p.settings.sections.length ? h("button", { type: "button", class: "btn btn-secondary", id: "btn-next", disabled: p.marks.length >= p.settings.sections.length, onclick: nextSection }, "다음 구간") : null,
      h("button", { type: "button", class: "btn btn-secondary", id: "btn-stop", disabled: !rec, onclick: stopRecording }, "녹화 종료"),
      h("button", { type: "button", class: "btn btn-secondary", id: "btn-analyze", disabled: state.phase !== "recorded", onclick: analyze }, "분석"),
      state.phase === "analyzing" ? h("button", { type: "button", class: "btn btn-ghost", onclick: () => state.analysisController?.abort() }, "전사 취소하고 기본 결과 보기") : null,
    ),
    target,
    h(
      "div",
      { class: "status" },
      h("span", { class: "tag tag-neutral", "data-testid": "cam-status" }, camLabel()),
      h("span", { class: "tag tag-neutral" }, gazeLabel()),
      h("span", { class: "tag tag-neutral" }, speechLabel()),
      h(
        "nav",
        { "aria-label": "주 메뉴" },
        h("a", { href: "/studio.html", "aria-disabled": b ? "true" : null }, "새 스튜디오"),
        h("a", { href: "/demo.html", "aria-disabled": b ? "true" : null }, "시연용 예시 체험"),
        h("a", { href: "/coach.html", "aria-disabled": b ? "true" : null }, "대본 이해 연습"),
        h("a", { id: "nav-import", href: "/import.html", "aria-disabled": b ? "true" : null }, "영상 불러오기"),
        h("a", { id: "nav-history", href: "#/history", "aria-disabled": b ? "true" : null }, "연습 기록"),
        h("button", { type: "button", class: "btn btn-ghost", disabled: b, title: "사용 방법", onclick: () => ((state.onboarding = true), (state.obStep = 0), render()) }, "사용 방법"),
      ),
    ),
  )
}

/* ───────── 녹화 화면 ───────── */

function renderStage() {
  const s = state.session
  const rec = busy()
  const hasVideoSession = Boolean(s?.videoBlob)
  if (rec || !state.player) state.view = "live"
  const showPlayer = state.view === "playback" && state.player && hasVideoSession
  const camOn = state.media.cam === "ready"
  const kids = []
  liveVideo.hidden = !(camOn && !showPlayer)
  kids.push(liveVideo)
  if (showPlayer) kids.push(state.player)
  if (!camOn && !showPlayer) kids.push(stagePlaceholder())
  if (state.hud) kids.push(state.hud.panel)
  if (state.phase === "countdown") kids.push(h("div", { class: "overlay center" }, h("strong", { class: "count" }, String(state.countdown)), h("span", null, "숨을 한 번 고르세요")))
  if (state.phase === "saving") kids.push(h("div", { class: "overlay center" }, "녹화를 저장하는 중…"))
  if (state.phase === "starting") kids.push(h("div", { class: "overlay center", role: "status" }, state.gaze.status === "loading" ? "시선 추적을 준비하고 있어요…" : "마이크·카메라를 준비하고 있어요…"))
  const foot = h(
    "div",
    { class: "stage-foot" },
    hasVideoSession && !rec
      ? h(
          "div",
          { class: "seg" },
          h("button", { type: "button", class: "seg-btn", "aria-pressed": String(state.view === "live"), onclick: () => ((state.view = "live"), renderStage()) }, "카메라"),
          h("button", { type: "button", class: "seg-btn", "aria-pressed": String(state.view === "playback"), onclick: () => ((state.view = "playback"), renderStage()) }, "녹화 보기"),
        )
      : null,
    s && !hasVideoSession && state.player ? state.player : null,
    h("p", { class: "hint", role: "status", id: "seek-status" }, state.seekText || ""),
    h("span", { class: "hint" }, "영상과 결과는 이 브라우저에 저장해요. 자체 AI 전사를 켜면 분석할 때 소리 조각만 자체 서버로 보내요."),
  )
  put(stageCol, h("div", { class: "stage" }, kids), foot, state.hud ? state.hud.details : null)
}

function stagePlaceholder() {
  const cam = state.media.cam
  if (cam === "connecting" || cam === "idle") return h("div", { class: "stage-empty" }, h("p", null, "카메라를 연결하는 중이에요…"), h("p", { class: "hint" }, "브라우저에 권한 창이 뜨면 허용해 주세요."))
  if (cam === "audio") return h("div", { class: "stage-empty" }, h("p", null, "마이크만 연결됐어요."), h("p", { class: "hint" }, "영상 없이 소리만 기록해요. 시선 이탈은 분석하지 않아요."))
  return h(
    "div",
    { class: "stage-empty" },
    h("p", null, "카메라와 마이크를 쓸 수 없어요"),
    ...state.media.notices.map((n) => h("p", { class: "hint" }, n)),
    h("p", { class: "hint" }, "브라우저 주소창의 카메라·마이크 권한을 허용한 뒤 다시 연결하세요. 연결하지 않아도 '녹화 시작'으로 시간만 재며 연습할 수 있어요."),
    h("button", { type: "button", class: "btn btn-primary", disabled: busy(), onclick: retryCamera }, "카메라 연결"),
  )
}

/* ───────── 대본·설정 ───────── */

function sentencesNow() {
  return splitSentences(state.raw.script)
}

function renderScript() {
  const b = busy()
  const sents = sentencesNow()
  const range = state.ctx?.range || [0, Math.max(0, sents.length - 1)]
  const chip = (key) =>
    h(
      "button",
      {
        type: "button", class: "chip", "aria-pressed": String(Boolean(state.raw[key])), disabled: b,
        onclick: () => {
          state.raw[key] = !state.raw[key]
          saveRaw()
          renderScript()
        },
      },
      CONDITIONS[key].label,
    )
  const progress = state.raw.progress && (state.phase === "recording" || state.ctx)
  const prog = progress ? { fill: h("div", { class: "progress-fill" }), now: h("span", null, ""), wrap: null } : null
  if (prog) prog.wrap = h("div", { class: "progress" }, h("div", { class: "progress-track" }, prog.fill), h("div", { class: "progress-labels hint" }, h("span", null, "0:00"), prog.now, h("span", null, formatClock(currentTargetSec()))))
  const items = sents.map((t, n) =>
    h("li", { class: n < range[0] || n > range[1] ? "dim" : null, "data-n": String(n) }, h("span", { class: "sn" }, n + 1), h("span", { class: state.raw.keywords ? "kw" : null }, state.raw.keywords ? keywordsOf(t) : t)),
  )
  state.scriptView = { prog, items, range }
  const field = (key, label, extra = {}) => h("div", { class: "field" }, h("label", { for: `f-${key}` }, label), h("input", { id: `f-${key}`, class: "input num", type: "number", min: "0", inputmode: "numeric", value: state.raw[key], disabled: b, oninput: (e) => ((state.raw[key] = e.target.value), saveRaw()), ...extra }))
  const check = (key, label, note, disabled = false) =>
    h(
      "div",
      { class: "check" },
      h("input", {
        id: `f-${key}`, type: "checkbox", checked: Boolean(state.raw[key]) && !disabled, disabled: b || disabled,
        onchange: (e) => {
          state.raw[key] = e.target.checked
          saveRaw()
          renderHeader()
        },
      }),
      h("label", { for: `f-${key}` }, label, note ? [h("br"), h("small", null, note)] : null),
    )
  const plan = h("textarea", { id: "f-plan", class: "input", rows: "3", disabled: b, placeholder: "예) 도입 2:00\n본론 5분 30초\n마무리 1:30", oninput: (e) => ((state.raw.plan = e.target.value), saveRaw()) })
  plan.value = state.raw.plan
  const settings = h(
    "details",
    { class: "settings", open: state.settingsOpen, ontoggle: (e) => (state.settingsOpen = e.target.open) },
    h("summary", null, "연습 설정"),
    h("div", { class: "row" }, field("tol", "허용 오차(초)"), field("warn", "임박 알림(남은 초)"), field("smin", "최소(분당 음절)"), field("smax", "최대(분당 음절)")),
    h("p", { class: "hint" }, "남은 시간이 '임박 알림' 이하가 되면 '시간 임박', 목표를 넘으면 '목표 시간 초과'로 알려요. 말하기 속도는 녹화 종료 후 자체 AI 전사문으로 계산해요."),
    h("label", { class: "hint", for: "f-plan" }, "한 줄에 한 구간씩 '구간 이름 + 시간'을 적어요. 녹화 중 '다음 구간'을 누른 시점으로 계획과 비교해요."),
    plan,
    check("video", "웹캠 영상도 기록 (선택, 소리 기록 포함)", "끄면 카메라 미리보기와 시선 추적은 그대로 두고 소리만 기록해요."),
    check("transcribe", "분석할 때 AI로 음성 전사·군말·말하기 속도 분석", "분석 버튼을 누를 때 녹음 소리 조각만 서버에 설정된 음성 인식(자체 AI 또는 주최 측 AI Gateway)으로 보내요. 브라우저 제공 업체의 음성 인식은 사용하지 않아요. 끄면 시간·침묵·시선만 분석해요."),
    h("p", { class: "info" }, "녹화 영상과 분석 결과는 이 브라우저에 저장해요. 영상·얼굴 데이터는 서버로 보내지 않아요."),
  )
  let body
  if (state.editing) {
    const ta = h("textarea", { class: "input script-edit", "aria-label": "대본", oninput: (e) => ((state.raw.script = e.target.value), scriptEdited(), saveRaw()) })
    ta.value = state.raw.script
    body = [scriptImport.render(b), ta, h("p", { class: "hint" }, "문장 단위(마침표·줄바꿈)로 나눠서 보여줘요.")]
  } else body = sents.length ? h("ol", { class: "sentences" }, items) : h("p", { class: "hint" }, "대본이 비어 있어요. '대본 편집'을 눌러 붙여 넣으세요. 대본 없이도 녹화할 수 있어요.")
  put(scriptCol, 
    h(
      "div",
      { class: "script-head" },
      h("h2", null, "대본"),
      chip("keywords"),
      chip("progress"),
      h("button", { type: "button", class: "btn btn-ghost", disabled: b, onclick: () => ((state.editing = !state.editing), renderScript()) }, state.editing ? "완료" : "대본 편집"),
    ),
    state.ctx
      ? h(
          "div",
          { class: "practice-banner" },
          h("span", null, `연습 구간: ${state.ctx.range ? `${state.ctx.range[0] + 1}–${state.ctx.range[1] + 1}번 문장 · ` : ""}목표 약 ${state.ctx.targetSec}초 · ${state.ctx.item.title}`),
          h("button", { type: "button", class: "btn btn-ghost", disabled: b, onclick: endPractice }, "전체 대본으로"),
        )
      : null,
    prog?.wrap,
    body,
    settings,
  )
}

function currentTargetSec() {
  if (state.practice) return state.practice.settings.targetSec
  if (state.ctx) return state.ctx.targetSec
  return (Number(state.raw.tmin) || 0) * 60 + (Number(state.raw.tsec) || 0)
}

/* ───────── 녹화 진행 ───────── */

function readSettings(raw) {
  const errs = []
  const num = (v) => (String(v ?? "").trim() === "" ? null : Number(v))
  let targetSec = null
  if (state.ctx) targetSec = state.ctx.targetSec
  else {
    const tmin = num(raw.tmin)
    const tsec = num(raw.tsec)
    if (tmin === null && tsec === null) errs.push("목표 시간을 입력해 주세요. 분이나 초 중 하나는 꼭 필요해요.")
    else if ([tmin, tsec].some((v) => v !== null && (!Number.isInteger(v) || v < 0))) errs.push("목표 시간은 0 이상의 정수로 적어 주세요.")
    else {
      targetSec = (tmin || 0) * 60 + (tsec || 0)
      if (targetSec < 1) errs.push("목표 시간은 1초 이상이어야 해요.")
    }
  }
  const tol = num(raw.tol) ?? 0
  const warn = num(raw.warn) ?? 0
  if (!Number.isInteger(tol) || tol < 0) errs.push("허용 오차는 0 이상의 정수(초)로 적어 주세요.")
  if (!Number.isInteger(warn) || warn < 0) errs.push("임박 알림은 0 이상의 정수(초)로 적어 주세요.")
  const smin = num(raw.smin)
  const smax = num(raw.smax)
  if ([smin, smax].some((v) => v !== null && (!Number.isFinite(v) || v <= 0))) errs.push("목표 속도는 0보다 큰 숫자로 적어 주세요.")
  else if (smin !== null && smax !== null && smin >= smax) errs.push("목표 속도의 최소는 최대보다 작아야 해요.")
  const { sections, errors: planErrs } = state.ctx ? { sections: [], errors: [] } : parsePlan(raw.plan)
  planErrs.forEach((e) => errs.push(e.message))
  const speechRequested = Boolean(raw.speech) && SpeechCapture.supported
  return {
    errors: errs,
    settings: {
      targetSec, toleranceSec: tol, warnSec: warn, speedMin: smin, speedMax: smax,
      sections, planSignature: planSignature(sections),
      recordAudio: true, recordVideo: Boolean(raw.video), speechRequested, transcribe: raw.transcribe !== false,
      raw: { tmin: raw.tmin, tsec: raw.tsec, tol: raw.tol, warn: raw.warn, smin: raw.smin, smax: raw.smax, plan: raw.plan, audio: true, video: Boolean(raw.video), speech: speechRequested, transcribe: raw.transcribe !== false },
    },
  }
}

class Practice {
  constructor(settings, capture, mediaStatus, notices) {
    this.settings = settings
    this.capture = capture
    this.mediaStatus = mediaStatus
    this.notices = notices
    this.accum = 0
    this.t0 = 0
    this.running = false
    this.marks = []
    this.speech = null
    this.gazeSamples = []
  }
  elapsed() {
    return this.accum + (this.running ? (performance.now() - this.t0) / 1000 : 0)
  }
  async start() {
    if (this.capture) await this.capture.start({ recordVideo: this.settings.recordVideo })
    if (this.settings.speechRequested) this.speech = new SpeechCapture(() => this.elapsed())
    this.t0 = performance.now()
    this.running = true
    this.speech?.start()
  }
  pause() {
    if (!this.running) return
    this.accum = this.elapsed()
    this.running = false
    this.capture?.pause()
    this.speech?.pause()
  }
  resume() {
    if (this.running) return
    this.t0 = performance.now()
    this.running = true
    this.capture?.resume()
    this.speech?.resume()
  }
}

async function startRecording() {
  if (busy() || scriptImport.busy()) return
  const { settings, errors } = readSettings(state.raw)
  state.errors = errors
  if (errors.length) return render()
  clearSession()
  state.phase = "starting"
  render()
  if (state.ctx?.conds.includes("countdown")) {
    state.phase = "countdown"
    for (let n = 3; n > 0; n--) {
      state.countdown = n
      renderStage()
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  await initCamera()
  if (state.gaze.status === "loading") await state.gaze.load() // 모델 준비 중 화면이 멈춰 시계가 건너뛰지 않게 녹화 전에 마친다
  if (state.media.cam === "ready") await state.gaze.warmup(liveVideo) // 첫 판단의 초기화 멈춤도 녹화 전에 끝낸다
  const { capture, status } = state.media
  const notices = capture ? [] : [...state.media.notices]
  if (!capture && !notices.length) notices.push("마이크·웹캠을 쓸 수 없어 녹음 없이 시간만 측정해요.")
  const mediaStatus = { audio: capture ? status.audio : status.audio === "off" ? "failed" : status.audio, video: settings.recordVideo ? (capture && status.video === "ok" ? "ok" : "failed") : "off" }
  if (capture && settings.recordVideo && status.video !== "ok") notices.push("웹캠을 쓸 수 없어 소리만 기록해요.")
  const p = new Practice(settings, capture, mediaStatus, notices)
  try {
    await p.start()
  } catch (e) {
    p.capture = null
    p.mediaStatus = { audio: "failed", video: settings.recordVideo ? "failed" : "off" }
    p.notices.push(`녹음을 시작하지 못해 시간만 측정해요 (${e?.message || e}).`)
    p.accum = 0
    p.t0 = performance.now()
    p.running = true
    p.speech?.start()
  }
  if (!capture || p.mediaStatus.audio !== "ok") {
    if (!p.notices.some((n) => n.includes("시간만 측정해요"))) p.notices.push("마이크를 쓸 수 없어 녹음 없이 시간만 측정해요.")
  }
  state.practice = p
  state.phase = "recording"
  state.view = "live"
  state.hud = buildHud(p)
  history.replaceState(null, "", "#/")
  render()
  tick()
  p.timer = setInterval(tick, 200)
}

function buildHud(p) {
  const els = {
    elapsed: h("strong", { id: "elapsed", "data-testid": "elapsed" }, "0:00"),
    remaining: h("strong", { id: "remaining", "data-testid": "remaining" }, formatClock(p.settings.targetSec)),
    stateText: h("span", { class: "state-text", id: "time-state", "data-testid": "time-state" }, ""),
    speed: h("dd", { id: "speed", "data-testid": "speed", class: "speed-state" }, ""),
    pace: h("dd", { id: "pace", "data-testid": "pace" }, ""),
    rec: h("dd", { id: "rec-status", "data-testid": "rec-status" }, ""),
    level: h("meter", { min: "0", max: "1", value: "0", "aria-label": "마이크 입력 크기" }),
    paused: h("p", { class: "hint", role: "status" }, ""),
    live: h("div", { class: "live-text" }, ""),
  }
  const panel = h(
    "div",
    { class: "hud", id: "panel", "data-state": "ok", "aria-label": "녹화 중" },
    h("span", { class: "hud-item" }, h("span", { class: "rec-dot pulse" }), "녹화 중 ", els.elapsed),
    h("span", { class: "hud-item" }, "남은 시간 ", els.remaining),
    els.stateText,
  )
  const details = h(
    "section",
    { class: "card hud-details", "aria-label": "연습 중" },
    ...p.notices.map((n) => h("div", { class: "notice", role: "status" }, n)),
    h("dl", null, h("dt", null, "목표 시간"), h("dd", null, formatClock(p.settings.targetSec)), h("dt", null, "말하기 속도"), els.speed, h("dt", null, "구간 진행"), els.pace, h("dt", null, "기록 상태"), els.rec, p.capture ? [h("dt", null, "마이크 입력"), h("dd", null, els.level)] : null),
    els.paused,
    p.speech ? els.live : null,
  )
  return { panel, details, els }
}

function tick() {
  const p = state.practice
  if (!p || !state.hud) return
  const { els, panel } = state.hud
  const s = p.settings
  const el = Math.floor(p.elapsed()) // 화면·결과·구간 비교 모두 같은 '정수 초'로 계산한다
  const rem = s.targetSec - el
  els.elapsed.textContent = formatClock(el)
  let st
  if (rem < 0) {
    st = "over"
    els.remaining.textContent = `초과 +${formatClock(-rem)}`
    els.stateText.textContent = "목표 시간 초과"
  } else if (rem <= s.warnSec) {
    st = "warn"
    els.remaining.textContent = formatClock(rem)
    els.stateText.textContent = "시간 임박"
  } else {
    st = "ok"
    els.remaining.textContent = formatClock(rem)
    els.stateText.textContent = "시간 여유 있음"
  }
  panel.dataset.state = st

  let speedText
  let speedKind = ""
  if (!s.speechRequested) speedText = s.transcribe ? "녹화 종료 후 분석하면 자체 AI 전사로 계산해요" : "측정 안 함 (자체 AI 전사를 껐어요)"
  else if (p.speech.status === "unsupported") speedText = "측정 불가 (이 브라우저는 음성 인식을 지원하지 않아요)"
  else if (p.speech.status === "denied") speedText = "측정 불가 (음성 인식 권한이 거부됐어요)"
  else if (p.speech.status === "error") speedText = `측정 불가 (음성 인식 오류${p.speech.detail ? `: ${p.speech.detail}` : ""})`
  else {
    const r = liveRate(p.speech.segments, p.elapsed())
    if (r.status === "measuring") speedText = `측정 중… (처음 ${LIVE_SPEED_WINDOW_SEC / 2}초 동안은 표시하지 않아요)`
    else {
      speedText = `${r.rate} 음절/분 (최근 ${Math.round(r.windowSec)}초 기준)`
      if (s.speedMin !== null && r.rate < s.speedMin) (speedKind = "slow"), (speedText += ` · 목표 최소(${s.speedMin})보다 느려요`)
      else if (s.speedMax !== null && r.rate > s.speedMax) (speedKind = "fast"), (speedText += ` · 목표 최대(${s.speedMax})보다 빨라요`)
      else if (s.speedMin !== null || s.speedMax !== null) (speedKind = "ok"), (speedText += " · 목표 범위 안이에요")
    }
    const last = p.speech.segments[p.speech.segments.length - 1]
    els.live.textContent = last?.text || "말하면 인식된 문장이 여기에 보여요"
  }
  els.speed.textContent = speedText
  els.speed.dataset.state = speedKind

  const pace = paceAt(el, s.sections, p.marks)
  if (!pace.known) els.pace.textContent = pace.reason
  else if (pace.finished) els.pace.textContent = pace.text
  else {
    let t = `${pace.title}: 계획 ${formatClock(pace.plannedLen)} 중 ${formatClock(pace.inSection)} 지났어요`
    t += pace.overBy > 0 ? ` · 계획보다 ${pace.overBy}초 길어졌어요` : ` · 계획 안이에요 (${-pace.overBy}초 남음)`
    if (p.marks.length) t += ` · 앞 구간까지 누적 ${formatSigned(pace.driftSec)}`
    els.pace.textContent = t
  }

  const parts = [p.mediaStatus.audio === "ok" && p.capture ? `소리 ${p.running ? "기록 중" : "일시정지"}` : "소리 기록 안 됨"]
  if (s.recordVideo) parts.push(p.mediaStatus.video === "ok" && p.capture ? "영상 기록 중" : "영상 기록 안 됨")
  els.rec.textContent = parts.join(" · ")
  if (p.capture) {
    els.level.value = Math.min(1, p.capture.level * 4)
    els.paused.textContent = p.running ? (p.capture.quietForSec > 5 ? "소리가 거의 들어오지 않아요. 마이크 연결을 확인해 주세요." : "") : "일시정지 중이에요. 이 시간은 연습 시간에 넣지 않아요."
  } else els.paused.textContent = p.running ? "" : "일시정지 중이에요. 이 시간은 연습 시간에 넣지 않아요."

  // 시선: 카메라가 켜져 있으면 녹화 영상과 상관없이 얼굴 방향만 이 브라우저에서 잰다.
  if (p.running && state.media.cam === "ready") p.gazeSamples.push({ t: p.elapsed(), off: state.gaze.sample(liveVideo) })

  // 진행 막대: 목표 시간 대비 지금 읽고 있어야 할 문장
  const sv = state.scriptView
  if (sv?.prog) {
    sv.prog.fill.style.width = `${Math.min(100, (p.elapsed() / Math.max(1, s.targetSec)) * 100)}%`
    const n = expectedSentence(p.elapsed(), s.targetSec, sv.range)
    sv.prog.now.textContent = `지금쯤 ${n + 1}번째 문장`
    sv.items.forEach((li, i) => li.classList.toggle("now", i === n))
  }
}

function togglePause() {
  const p = state.practice
  if (!p) return
  p.running ? p.pause() : p.resume()
  renderHeader()
  tick()
}

function nextSection() {
  const p = state.practice
  if (!p?.running) return
  if (p.marks.length < p.settings.sections.length) p.marks.push(Math.floor(p.elapsed()))
  renderHeader()
  tick()
}

async function stopRecording() {
  const p = state.practice
  if (!p || state.phase !== "recording") return
  clearInterval(p.timer)
  const total = Math.floor(p.elapsed())
  p.running = false
  state.phase = "saving"
  render()
  const notices = [...p.notices]
  let rec = { samples: new Float32Array(0), sampleRate: 16000, wavBlob: null, videoBlob: null }
  if (p.capture) {
    try {
      rec = await p.capture.stop({ keepStream: true })
    } catch (e) {
      notices.push(`녹음을 마무리하지 못했어요 (${e?.message || e}).`)
    }
  }
  const segments = p.speech ? p.speech.stop() : []
  state.pending = { p, rec, segments, total, notices }
  state.practice = null
  state.hud = null
  state.phase = "recorded"
  render()
  document.getElementById("btn-analyze")?.focus()
}

/* ───────── 분석 ───────── */

async function analyze() {
  const pend = state.pending
  if (!pend || state.phase !== "recorded") return
  const { p, rec, segments, total, notices } = pend
  const s = p.settings
  const audioOk = Boolean(p.capture) && rec.samples.length > 0 && p.mediaStatus.audio === "ok"
  if (p.capture && rec.samples.length === 0) notices.push("기록된 소리가 없어요. 녹음 길이가 너무 짧았을 수 있어요.")
  const silence = audioOk ? analyzeSilence(rec.samples, rec.sampleRate) : null
  if (silence?.status === "no-signal") notices.push("녹음에 소리가 거의 없어서 긴 침묵을 찾지 않았어요. 마이크 연결과 입력 장치를 확인해 주세요.")
  if (silence?.status === "too-short") notices.push("녹음이 너무 짧아서 긴 침묵을 찾지 않았어요.")
  const wantsSpeech = s.transcribe !== false && audioOk
  const transcript = null
  const speechState = wantsSpeech ? "pending" : s.transcribe === false ? "off" : "no-audio"
  const fillers = null
  const gaze = analyzeGaze(p.gazeSamples, total)
  if (state.media.cam === "ready" && gaze.status !== "ok") notices.push("시선 추적을 쓸 수 없어서 시선 이탈은 분석하지 않았어요.")
  const sectionRows = s.sections.length ? sectionResults(s.sections, p.marks, total) : []
  const items = buildReviewItems({ silence, transcript, sectionRows, toleranceSec: s.toleranceSec, fillers, gaze })
  const result = classifyResult(total, s.targetSec, s.toleranceSec)
  const ctx = state.ctx
  const session = {
    id: newId(),
    createdAt: Date.now(),
    settings: s,
    conditionKey: ctx ? `practice#${ctx.baseId}#${ctx.item.id}` : conditionKey(s.targetSec, s.planSignature),
    totalSec: total,
    result,
    marks: p.marks,
    sectionRows,
    media: { audio: audioOk ? "ok" : p.mediaStatus.audio === "ok" ? "failed" : p.mediaStatus.audio, video: rec.videoBlob ? "ok" : s.recordVideo ? "failed" : "off", speech: speechState, speechDetail: wantsSpeech ? "자체 AI 전사를 완료하지 못했어요. 녹음과 기본 결과는 보존돼요." : "" },
    analysis: {
      silence: silence && { status: silence.status, threshold: silence.threshold, voicedRatio: silence.voicedRatio },
      transcript, fillers: fillers && { count: fillers.count, times: fillers.times },
      gaze: { status: gaze.status, segments: gaze.segments, offSec: gaze.offSec }, items,
    },
    script: state.raw.script,
    scriptFile: state.raw.scriptFile ? { name: state.raw.scriptFile.name, edited: Boolean(state.raw.scriptFile.edited) } : null,
    conds: { keywords: Boolean(state.raw.keywords), progress: Boolean(state.raw.progress), countdown: Boolean(ctx?.conds.includes("countdown")) },
    practiceOf: ctx ? { baseId: ctx.baseId, itemId: ctx.item.id, title: ctx.item.title, startSec: ctx.item.startSec, endSec: ctx.item.endSec, reason: ctx.reason, conds: ctx.conds } : null,
    coaching: {},
    transcript: segments,
    audioBlob: audioOk ? rec.wavBlob : null,
    videoBlob: rec.videoBlob,
    notices,
  }
  // Save the original recording and local measurements before any network request.
  state.phase = "analyzing"
  state.analysisController = new AbortController()
  state.analysisProgress = wantsSpeech ? "녹음을 저장한 뒤 자체 AI 음성 전사를 준비해요." : "녹음과 기본 분석 결과를 저장해요."
  render()
  const saved = await saveSession(session)
  if (!saved.ok) session.notices.push(`기록을 이 기기에 저장하지 못했어요 (${saved.error}). 이 화면을 닫으면 다시 볼 수 없어요.`)
  const speech = await analyzeRecordedSpeech({ samples: audioOk ? rec.samples : null, sampleRate: rec.sampleRate, durationSec: total, enabled: s.transcribe !== false, signal: state.analysisController.signal,
    onProgress: (done, count) => { state.analysisProgress = `자체 AI 음성 전사 ${done}/${count}개 조각 처리 중…`; renderResults() } })
  session.media.speech = speech.status
  session.media.speechDetail = speech.detail
  session.transcript = speech.segments
  session.analysis.transcript = speech.transcript
  session.analysis.fillers = speech.fillers && { count: speech.fillers.count, times: speech.fillers.times }
  session.analysis.transcription = { status: speech.status, processing: "self-hosted", detail: speech.detail }
  session.analysis.items = buildReviewItems({ silence, transcript: speech.transcript, sectionRows, toleranceSec: s.toleranceSec, fillers: speech.fillers, gaze })
  session.notices.push(speech.detail)
  const updated = await saveSession(session)
  if (!updated.ok && saved.ok) session.notices.push("전사 결과를 저장하지 못했어요. 현재 화면에서 확인하고 녹음은 연습 기록에서 다시 볼 수 있어요.")
  state.analysisController = null
  state.analysisProgress = ""

  state.pending = null
  history.replaceState(null, "", `#/result/${session.id}`)
  showSession(session)
}

function clearSession() {
  state.session = null
  state.sel = null
  state.seekText = ""
  if (state.player?.src) URL.revokeObjectURL(state.player.src)
  state.player = null
}

function showSession(session) {
  clearSession()
  state.session = session
  state.phase = "analyzed"
  const blob = session.videoBlob || session.audioBlob
  if (blob) {
    const el = session.videoBlob ? h("video", { id: "player", class: "stage-video", controls: true, preload: "metadata", playsinline: true, "aria-label": "연습 영상 다시 보기" }) : h("audio", { id: "player", class: "player", controls: true, preload: "metadata", "aria-label": "연습 녹음 다시 듣기" })
    el.src = URL.createObjectURL(blob)
    makeSeekable(el)
    state.player = el
    state.view = session.videoBlob ? "playback" : "live"
  }
  render()
}

function seek(sec) {
  const player = state.player
  if (!player) return
  if (state.session?.videoBlob && state.view !== "playback") {
    state.view = "playback"
    renderStage()
  }
  const go = () => {
    player.currentTime = sec
    state.seekText = `재생 위치를 ${formatClock(sec)}로 옮겼어요.`
    const st = document.getElementById("seek-status")
    if (st) st.textContent = state.seekText
    player.play?.().catch(() => {})
  }
  if (player.readyState >= 1 && Number.isFinite(player.duration)) go()
  else player.addEventListener("durationchange", () => Number.isFinite(player.duration) && go(), { once: true })
}

/** MediaRecorder가 만든 webm은 길이 정보가 없어 이동이 안 되는 경우가 있어서, 끝까지 한 번 이동해 길이를 알아낸다. */
function makeSeekable(el) {
  el.addEventListener(
    "loadedmetadata",
    () => {
      if (el.duration === Infinity) {
        const back = () => {
          el.removeEventListener("timeupdate", back)
          el.currentTime = 0
        }
        el.addEventListener("timeupdate", back)
        el.currentTime = 1e7
      }
    },
    { once: true },
  )
}

/* ───────── 결과 ───────── */

const SPEECH_REASON = {
  pending: "자체 AI 전사를 완료하지 못했어요. 저장된 녹음과 기본 결과를 확인할 수 있어요.",
  off: "자체 AI 전사를 꺼서 속도와 군말은 분석하지 않았어요.",
  unsupported: "이 브라우저가 음성 인식을 지원하지 않아서 속도와 반복 표현은 분석하지 못했어요.",
  denied: "음성 인식 권한이 거부돼서 속도와 반복 표현은 분석하지 못했어요.",
  error: "음성 인식에 오류가 있어서 속도와 반복 표현은 분석하지 못했어요.",
  "no-text": "음성 인식을 켰지만 인식된 말이 없어서 속도와 반복 표현은 분석하지 못했어요.",
}

function renderResults() {
  const session = state.session
  if (!session) {
    const pend = state.pending
    const text =
      state.phase === "analyzing" ? state.analysisProgress
      : state.phase === "recording" ? "녹화 중이에요. 마치면 '녹화 종료'를 누르세요."
      : state.phase === "recorded" ? `녹화가 저장됐어요 (${formatClock(pend.total)}). '분석'을 누르면 다시 볼 구간이 여기에 표시돼요.`
      : state.ctx ? "연습 구간만 다시 녹화해 보세요. 분석하면 이전 녹화와 나란히 비교해요."
      : "'녹화 시작'을 누르고 대본을 읽어 보세요. 녹화를 마친 뒤 '분석'을 누르면 다시 볼 구간이 여기에 표시돼요."
    put(results, h("div", { class: "card empty", role: "status" }, text))
    return
  }
  const a = session.analysis
  const r = session.result
  const hasMedia = Boolean(session.audioBlob || session.videoBlob)
  const speechOk = session.media.speech === "ok"
  const sp = a.transcript?.status === "ok" ? `${Math.round(a.transcript.overallRate)} 음절/분 (한글 음절 ${a.transcript.totalSyllables}개 ÷ 전체 ${formatClock(session.totalSec)}, 쉼 포함)` : `측정 못 함 — ${session.media.speechDetail || SPEECH_REASON[session.media.speech] || ""}`
  const stat = (label, value, attrs = {}) => h("div", { class: "stat" }, h("dt", null, label), h("dd", attrs, value))
  const summary = h(
    "section",
    { class: "card", "aria-label": "연습 결과" },
    h("h2", null, "연습 결과"),
    h(
      "dl",
      { class: "stats" },
      stat("총 연습 시간", `${formatClock(session.totalSec)} (일시정지 시간 제외)`, { "data-testid": "total" }),
      stat("목표 시간", formatClock(session.settings.targetSec), { "data-testid": "target" }),
      stat("목표와의 차이", [h("span", { class: "tag", "data-kind": r.kind }, r.label), ` (${formatSigned(r.diffSec)})`], { "data-testid": "diff" }),
      stat("평균 말하기 속도", sp, { "data-testid": "avg-speed" }),
      stat("군말(음, 어)", speechOk && a.fillers ? `${a.fillers.count}회` : "측정 안 됨"),
      stat(`긴 침묵 (${SILENCE_MIN_SEC}초 이상)`, a.silence?.status === "ok" ? `${a.items.filter((x) => x.type === "silence").length}회` : "측정 안 됨"),
      stat("시선 이탈", a.gaze?.status === "ok" ? `${Math.round(a.gaze.offSec)}초` : "측정 안 됨"),
    ),
  )
  const sectionCard = session.sectionRows.length
    ? h(
        "section",
        { class: "card", "aria-label": "구간별 시간" },
        h("h2", null, "구간별 계획과 실제"),
        h(
          "table",
          { class: "table" },
          h("thead", null, h("tr", null, ["구간", "계획", "실제", "차이"].map((x) => h("th", { scope: "col" }, x)))),
          h(
            "tbody",
            null,
            session.sectionRows.map((row) =>
              h(
                "tr",
                null,
                h("td", null, row.title),
                h("td", null, formatClock(row.planSec)),
                h("td", null, row.actualSec === null ? "진행 안 함" : `${formatClock(row.actualSec)}${row.status === "ended-during" ? " (연습 종료까지)" : ""}`),
                h("td", null, row.diffSec === null ? "-" : formatSigned(row.diffSec)),
              ),
            ),
          ),
        ),
        h("p", { class: "hint" }, `구간 계획 합계 ${formatClock(planTotal(session.settings.sections))}, 목표 시간 ${formatClock(session.settings.targetSec)}. 실제 시간은 '다음 구간'을 누른 시점 기준이에요.`),
      )
    : null

  const items = a.items
  const notes = []
  if (!hasMedia) notes.push("소리를 기록하지 못해서 긴 침묵은 찾지 못했고, 다시 듣기도 할 수 없어요.")
  else if (a.silence?.status === "ok") notes.push(`긴 침묵 기준: 소리가 기준 이하인 상태가 ${SILENCE_MIN_SEC}초 이상. 이 녹음의 소리 크기를 기준으로 삼았어요.`)
  if (!speechOk) notes.push(session.media.speechDetail || SPEECH_REASON[session.media.speech] || "")
  else notes.push(`속도 변화 기준: ${SPEED_WINDOW_SEC}초 구간 속도가 평균보다 ${Math.round(SPEED_DEVIATION * 100)}% 이상 차이. 전사 구간은 자체 모델의 추정 시간이고, 구간 안의 단어 위치도 추정값이에요.`)
  if (a.gaze?.status === "ok") notes.push(`시선 이탈 기준: 얼굴이 화면을 벗어났거나 크게 돌아간 상태가 ${GAZE_MIN_SEC}초 이상. 얼굴 방향으로 어림잡은 값이에요.`)
  const coaching = session.coaching || {}
  const total = Math.max(1, session.totalSec)
  const timeline = items.length
    ? h(
        "div",
        { class: "timeline", "aria-hidden": "true" },
        items.map((it) => {
          const row = GROUPS.indexOf(TYPE_GROUP[it.type])
          return h("button", {
            type: "button", tabindex: "-1", class: `mark g${row}${state.sel?.id === it.id ? " on" : ""}`, title: `${formatClock(it.startSec)} ${it.title}`,
            style: `left:${Math.min(99, (it.startSec / total) * 100)}%;width:${Math.max(0.8, ((it.endSec - it.startSec) / total) * 100)}%;top:${4 + row * 9}px`,
            onclick: () => selectItem(it),
          })
        }),
      )
    : null
  const review = h(
    "section",
    { class: "card", "aria-label": "검토할 구간" },
    h("div", { class: "review-head" }, h("h2", null, `다시 볼 구간 ${items.length}곳`), h("div", { class: "legend" }, GROUPS.slice(0, 4).map((g, n) => h("span", null, h("i", { class: `g${n}` }), g)))),
    ...notes.filter(Boolean).map((n) => h("p", { class: "hint" }, n)),
    timeline,
    timeline ? h("div", { class: "timeline-axis hint" }, h("span", null, "0:00"), h("span", null, formatClock(session.totalSec))) : null,
    h(
      "div",
      { class: "review-body" },
      items.length
        ? h(
            "ul",
            { class: "review", "aria-label": "검토할 구간 목록" },
            items.map((it) =>
              h(
                "li",
                { "data-type": it.type, class: state.sel?.id === it.id ? "selected" : null },
                h(
                  "button",
                  { type: "button", "data-start": String(it.startSec), onclick: () => selectItem(it) },
                  h("i", { class: `g${GROUPS.indexOf(TYPE_GROUP[it.type])}` }),
                  `${formatClock(it.startSec)} · ${it.title}`,
                  coaching[it.id]?.status ? h("span", { class: "tag tag-neutral" }, coaching[it.id].status) : null,
                ),
                h("p", null, `측정값: ${it.measured}`),
                h("p", null, `근거: ${it.basis}`),
              ),
            ),
          )
        : h("p", { "data-testid": "no-items" }, "표시할 구간이 없어요. 위 기준으로 찾은 항목이 없다는 뜻이고, 발표가 괜찮다는 평가는 아니에요."),
      items.length ? questionCard(session, hasMedia) : null,
    ),
    !hasMedia && items.length ? h("p", { class: "hint" }, "녹음이 없어서 구간을 눌러도 재생 위치는 옮길 수 없어요.") : null,
  )
  const transcriptCard = session.transcript?.length
    ? h("section", { class: "card" }, h("details", null, h("summary", null, `인식된 글 보기 (${session.transcript.length}개 조각)`), h("ul", null, session.transcript.map((t) => h("li", null, `${formatClock(t.startSec)}~${formatClock(t.endSec)} ${t.text}`)))))
    : null
  const compareHost = h("section", { class: "card", "aria-label": session.practiceOf ? "연습 전후 비교" : "이전 연습과 비교" }, h("p", { class: "hint" }, "비교할 기록을 찾는 중이에요…"))
  put(results, 
    ...session.notices.map((n) => h("div", { class: "notice", role: "status" }, n)),
    session.practiceOf ? compareHost : null,
    summary,
    sectionCard,
    review,
    h("section", { class: "card", "aria-label": "대본과 함께 AI 코칭" },
      h("h2", null, "이 순간, 어떤 도움이 필요했나요?"),
      h("p", null, "대본과 관찰을 함께 보고 먼저 상황을 물어요. 쉬운 대본도 본인이 원할 때만 제안해요."),
      h("a", { class: "btn btn-secondary", href: `/support-coach.html?session=${encodeURIComponent(session.id)}${state.sel?.id ? `&item=${encodeURIComponent(state.sel.id)}` : ""}` }, "대본과 함께 AI 코칭"),
      h("p", { class: "hint" }, "검토 구간을 고르면 대본 위치를 먼저 확인해요. 기본은 자체 AI(외부 전송 없음)이고, 원하면 동의한 텍스트만 보내는 Gemini 대화를 고를 수 있어요. 녹음·영상·얼굴은 전송하지 않아요.")),
    ...measurementCards(session, { h, seek, onUpdated: () => { state.sel = null; renderResults() } }),
    transcriptCard,
    session.practiceOf ? null : compareHost,
    h(
      "div",
      { class: "btn-row" },
      h("button", { type: "button", class: "btn btn-primary", id: "btn-again", onclick: againSameCondition }, "같은 조건으로 다시 연습"),
      h("a", { href: "#/history" }, "연습 기록 보기"),
    ),
  )
  fillCompare(session, compareHost)
}

async function fillCompare(session, host) {
  if (session.practiceOf) return fillPracticeCompare(session, host)
  const { sessions } = await listSessions()
  const prev = sessions.find((x) => x.id !== session.id && x.conditionKey === session.conditionKey && x.createdAt < session.createdAt)
  put(host, h("h2", null, "같은 조건의 이전 연습과 비교"))
  if (!prev) {
    host.append(h("p", { "data-testid": "no-compare" }, "아직 비교할 이전 기록이 없어요. 같은 목표 시간과 구간 계획으로 한 번 더 연습하면 비교해 보여 줘요."))
    return
  }
  const rows = compareSessions(prev, session)
  host.append(
    h("p", { class: "hint" }, `비교 대상: ${new Date(prev.createdAt).toLocaleString("ko-KR")} 연습. 점수나 개선율은 계산하지 않고 측정한 값만 나란히 보여 줘요.`),
    h(
      "table",
      { class: "table", "data-testid": "compare-table" },
      h("thead", null, h("tr", null, ["항목", "이전", "이번", "변화"].map((x) => h("th", { scope: "col" }, x)))),
      h("tbody", null, rows.map((row) => h("tr", null, h("td", null, row.label), h("td", null, row.prev), h("td", null, row.cur), h("td", null, row.delta)))),
    ),
  )
}

async function fillPracticeCompare(session, host) {
  const po = session.practiceOf
  const base = await getSession(po.baseId)
  put(host, h("h2", null, "연습 전후 비교"))
  if (!base) {
    host.append(h("p", { class: "hint" }, "이전 녹화를 찾지 못해 비교할 수 없어요. 삭제됐거나 이 브라우저에 저장되지 않았어요."))
    return
  }
  const from = Math.max(0, po.startSec - 6)
  const to = Math.min(base.totalSec, po.endSec + 6)
  const A = windowMetrics(base, from, to)
  const B = windowMetrics(session, 0, session.totalSec)
  const show = (v, unit) => (v === null ? "측정 못 함" : `${v}${unit}`)
  const conds = po.conds.map((k) => CONDITIONS[k]?.label).filter(Boolean).join(", ") || "조건 바꾸지 않음"
  const media = (s, start, label) => {
    const blob = s.videoBlob || s.audioBlob
    if (!blob) return h("div", { class: "cmp-media" }, h("p", { class: "hint" }, "기록이 없어요"), h("span", { class: "hint" }, label))
    const el = h(s.videoBlob ? "video" : "audio", { controls: true, preload: "metadata", playsinline: true, "aria-label": label })
    el.src = URL.createObjectURL(blob)
    el.addEventListener("loadedmetadata", () => {
      try {
        el.currentTime = start
      } catch {
        /* 이동 못 하면 처음부터 */
      }
    }, { once: true })
    return h("div", { class: "cmp-media" }, el, h("span", { class: "hint" }, label))
  }
  const a = media(base, from, `이전 · ${formatClock(from)}–${formatClock(to)}`)
  const b = media(session, 0, `다시 연습 · ${conds}`)
  host.append(
    h("p", { class: "hint" }, `${po.title} · 이유: ${po.reason}. 이번 조건에서의 변화만 보여 줘요. 한 번의 비교로 원인이 확인됐다고 보지 않아요.`),
    h(
      "div",
      { class: "cmp" },
      h(
        "table",
        { class: "table", "data-testid": "practice-compare" },
        h("thead", null, h("tr", null, ["항목", "이전", "다시 연습"].map((x) => h("th", { scope: "col" }, x)))),
        h(
          "tbody",
          null,
          [["말 속도", show(A.rate, "음절/분"), show(B.rate, "음절/분")], ["군말", show(A.fillersPerMin, "회/분"), show(B.fillersPerMin, "회/분")], ["긴 침묵", show(A.pauses, "회"), show(B.pauses, "회")], ["시선 이탈 비율", show(A.gazePct, "%"), show(B.gazePct, "%")]].map((r) =>
            h("tr", null, r.map((c) => h("td", null, c))),
          ),
        ),
      ),
      h("div", { class: "cmp-videos" }, a, b),
    ),
    h(
      "div",
      { class: "btn-row" },
      h("button", { type: "button", class: "btn btn-secondary", onclick: () => host.querySelectorAll("video, audio").forEach((m) => m.play().catch(() => {})) }, "두 영상 함께 재생"),
      h("button", { type: "button", class: "btn btn-ghost", onclick: endPractice }, "연습 끝내기"),
    ),
  )
}

function againSameCondition() {
  // 그 기록의 대본으로 다시 연습한다. 대본이 저장되지 않은 이전 기록이면 지금 대본을 그대로 쓴다.
  const { text, fileName } = sessionScript(state.session)
  if (text !== null) {
    state.raw.script = text
    state.raw.scriptFile = fileName ? { name: fileName, edited: Boolean(state.session.scriptFile.edited) } : null
    saveRaw()
  }
  clearSession()
  state.phase = "idle"
  state.errors = []
  location.hash = "#/"
  render()
}

/* ───────── 질문 카드 (확인 → 그때 있었던 일 → 바꿔 볼 조건) ───────── */

function selectItem(it) {
  state.sel = { id: it.id, step: 1, reason: null, custom: "", picks: [] }
  seek(it.startSec)
  renderResults()
}

async function setStatus(status, close = true) {
  const s = state.session
  s.coaching = { ...(s.coaching || {}), [state.sel.id]: { status, reason: state.sel.reason, custom: state.sel.custom || "", picks: state.sel.picks } }
  if (close) state.sel = null
  await saveSession(s)
  renderResults()
}

function questionCard(session, hasMedia) {
  const sel = state.sel
  const it = sel && session.analysis.items.find((x) => x.id === sel.id)
  if (!it) return h("div", { class: "qcard hint" }, "구간을 누르면 그 위치부터 재생되고, 짧은 질문이 이어져요. 질문은 최대 3개이고 언제든 건너뛸 수 있어요. 답하지 않아도 계속 연습할 수 있어요.")
  const go = (patch) => {
    Object.assign(state.sel, patch)
    renderResults()
  }
  const head = h(
    "div",
    { class: "q-head" },
    h("span", { class: "tag tag-accent" }, `질문 ${sel.step} / ${QUESTION_LIMIT}`),
    h("span", null, `${formatClock(it.startSec)} · ${it.title}`),
    h("button", { type: "button", class: "btn btn-ghost", onclick: () => setStatus("건너뜀") }, "건너뛰기"),
  )
  let body
  if (sel.step === 1) {
    body = [
      h("p", { class: "q" }, "표시한 구간이 맞나요?"),
      h("p", { class: "hint" }, `측정값: ${it.measured}`),
      h(
        "div",
        { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-primary", onclick: () => go({ step: 2 }) }, "맞아요"),
        h("button", { type: "button", class: "btn btn-secondary", onclick: () => setStatus("잘못 인식") }, "잘못 인식"),
        h("button", { type: "button", class: "btn btn-secondary", onclick: () => setStatus("문제 아님") }, "문제 아님"),
        hasMedia ? h("button", { type: "button", class: "btn btn-ghost", onclick: () => seek(it.startSec) }, "다시 재생") : null,
      ),
      h("a", { class: "btn btn-ghost", href: `/support-coach.html?session=${encodeURIComponent(session.id)}&item=${encodeURIComponent(it.id)}` }, "대본 위치 확인하고 AI와 이야기하기"),
    ]
  } else if (sel.step === 2) {
    const custom = h("input", { class: "input", "aria-label": "직접 입력", placeholder: "예: 슬라이드를 넘기다가 흐름을 놓쳤어요", value: sel.custom, oninput: (e) => (sel.custom = e.target.value) })
    body = [
      h("p", { class: "q" }, it.type === "gaze" ? "이때 어디를 보고 있었나요? 어떤 일이 있었나요?" : "이 구간에서 어떤 일이 있었나요?"),
      h("div", { class: "chips", role: "group", "aria-label": "그때 있었던 일" }, REASONS.map((r) => h("button", { type: "button", class: "chip", "aria-pressed": String(sel.reason === r), onclick: () => go({ reason: r }) }, r))),
      sel.reason === "직접 입력" ? custom : null,
      h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn btn-primary", disabled: !sel.reason, onclick: () => go({ step: 3, picks: suggestFor(sel.reason).slice(0, 1) }) }, "다음")),
    ]
  } else {
    const keys = [...new Set([...suggestFor(sel.reason), ...sel.picks])]
    body = [
      h("p", { class: "q" }, "이렇게 다시 연습해 볼까요?"),
      h(
        "div",
        { class: "suggest" },
        keys.map((k) =>
          h(
            "button",
            { type: "button", class: "suggest-opt", "aria-pressed": String(sel.picks.includes(k)), onclick: () => go({ picks: sel.picks.includes(k) ? sel.picks.filter((x) => x !== k) : [...sel.picks, k] }) },
            h("strong", null, CONDITIONS[k].label),
            h("span", { class: "hint" }, CONDITIONS[k].desc),
          ),
        ),
      ),
      h("p", { class: "hint" }, "효과가 입증된 방법이 아니라 시험해 볼 조건이에요. 하나씩 바꿔 보면 무엇이 도움이 됐는지 알기 쉬워요."),
      h("div", { class: "btn-row" }, h("button", { type: "button", class: "btn btn-primary", onclick: () => practiceItem(it) }, "이 구간 다시 연습")),
    ]
  }
  return h("div", { class: "qcard", "aria-label": "질문" }, head, body)
}

async function practiceItem(it) {
  const s = state.session
  const sel = state.sel
  const reason = sel.reason === "직접 입력" ? sel.custom.trim() || "직접 입력" : sel.reason
  const { range, targetSec } = practiceRange({ sentences: splitSentences(s.script || state.raw.script), item: it, totalSec: s.totalSec, targetSec: s.settings.targetSec })
  await setStatus("다시 연습함", true)
  state.raw.keywords = sel.picks.includes("keywords")
  state.raw.progress = sel.picks.includes("progress")
  saveRaw()
  state.ctx = { baseId: s.id, item: it, reason, conds: sel.picks, range, targetSec }
  clearSession()
  state.phase = "idle"
  history.replaceState(null, "", "#/")
  render()
  window.scrollTo({ top: 0, behavior: "smooth" })
}

function endPractice() {
  state.ctx = null
  if (state.phase === "analyzed" && state.session?.practiceOf) {
    clearSession()
    state.phase = "idle"
    history.replaceState(null, "", "#/")
  }
  render()
}

/* ───────── 연습 기록 화면 ───────── */

async function renderHistory() {
  renderHeader()
  const { sessions, error } = await listSessions()
  const rows = sessions.map((s) => {
    const del = h("button", { type: "button", class: "btn btn-ghost", "aria-label": `${new Date(s.createdAt).toLocaleString("ko-KR")} 기록 삭제` }, "삭제")
    let armed = false
    del.addEventListener("click", async () => {
      if (!armed) {
        armed = true
        del.textContent = "정말 삭제"
        return
      }
      await deleteSession(s.id)
      renderHistory()
    })
    return h(
      "tr",
      null,
      h("td", null, new Date(s.createdAt).toLocaleString("ko-KR")),
      h("td", null, s.practiceOf ? `구간 연습 · ${s.practiceOf.title}` : s.source?.kind === "import" ? "불러온 파일" : "전체 연습"),
      h("td", null, formatClock(s.settings.targetSec)),
      h("td", null, formatClock(s.totalSec)),
      h("td", null, s.result.label),
      h("td", null, h("a", { href: `#/result/${s.id}` }, "결과 보기"), " ", del),
    )
  })
  put(app, 
    header,
    h(
      "main",
      { class: "wrap" },
      h("h1", null, "연습 기록"),
      error ? h("div", { class: "notice", role: "status" }, `저장된 기록을 불러오지 못해 이 화면에서 한 연습만 보여 줘요 (${error}).`) : null,
      sessions.length
        ? h("div", { class: "card" }, h("table", { class: "table" }, h("thead", null, h("tr", null, ["날짜", "종류", "목표", "연습 시간", "목표와의 차이", ""].map((x) => h("th", { scope: "col" }, x)))), h("tbody", null, rows)))
        : h("div", { class: "card" }, h("p", { "data-testid": "no-sessions" }, "아직 연습 기록이 없어요. 첫 화면에서 첫 연습을 시작해 보세요.")),
    ),
  )
}

/* ───────── 주소에 따라 화면 고르기 ───────── */

async function route() {
  const hash = location.hash || "#/"
  if (busy()) {
    if (hash !== "#/") history.replaceState(null, "", "#/")
    return
  }
  const m = hash.match(/^#\/result\/(.+)$/)
  if (m) {
    state.onboarding = false
    const s = await getSession(decodeURIComponent(m[1]))
    if (!s) {
      renderHeader()
      put(app, header, h("main", { class: "wrap" }, h("h1", null, "기록을 찾을 수 없어요"), h("p", null, "삭제됐거나 이 브라우저에 저장되지 않은 연습이에요."), h("a", { href: "#/history" }, "연습 기록으로 가기")))
      return
    }
    if (state.session?.id !== s.id) showSession(s)
    else render()
    initCamera()
    return
  }
  if (hash === "#/history") {
    state.onboarding = false
    return renderHistory()
  }
  if (state.phase === "analyzed") {
    clearSession()
    state.phase = "idle"
  }
  render()
  if (!state.onboarding) initCamera()
}

window.addEventListener("hashchange", route)
state.onboarding = !store.get(ONBOARDED_KEY) && (location.hash || "#/") === "#/"
route()
