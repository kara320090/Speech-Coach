// 발표 연습 코치 화면. 해시 주소(#/, #/practice, #/result/ID, #/history)로 화면을 바꾼다.
import { formatClock, formatKorean, formatSigned } from "./time.js"
import { parsePlan, planSignature, planTotal, paceAt, sectionResults } from "./plan.js"
import {
  analyzeSilence, analyzeTranscript, buildReviewItems, classifyResult, compareSessions, conditionKey, liveRate,
  LIVE_SPEED_WINDOW_SEC, SILENCE_MIN_SEC, SPEED_DEVIATION, SPEED_WINDOW_SEC,
} from "./analysis.js"
import { MediaCapture, SpeechCapture } from "./recorder.js"
import { deleteSession, getSession, listSessions, saveSession } from "./storage.js"
import { scriptForPractice } from "./script.js"
import { createScriptInput, practiceStage, scriptPrefill, scriptResultCard } from "./script-ui.js"

const app = document.getElementById("app")
const state = { practice: null, prefill: null, starting: false }

/* ───────── 작은 도우미 ───────── */

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

function setNav() {
  const busy = Boolean(state.practice) || state.starting
  for (const id of ["nav-setup", "nav-history"]) {
    const a = document.getElementById(id)
    a.setAttribute("aria-disabled", busy ? "true" : "false")
    a.tabIndex = busy ? -1 : 0
  }
}

/* ───────── 연습 준비 화면 ───────── */

const DEFAULT_RAW = { tmin: "", tsec: "", tol: "0", warn: "30", smin: "", smax: "", plan: "", script: "", scriptName: "", audio: true, video: false, speech: false }

function renderSetup() {
  const raw = { ...DEFAULT_RAW, ...(state.prefill || {}) }
  state.prefill = null
  const speechOk = SpeechCapture.supported
  const field = (label, id, extra = {}) =>
    h("div", { class: "field" }, h("label", { for: id }, label), h("input", { id, type: "number", min: "0", inputmode: "numeric", value: raw[id.replace("f-", "")], ...extra }))

  const errors = h("div", { class: "errors", role: "alert", hidden: true })
  const audio = h("input", { id: "f-audio", type: "checkbox", checked: raw.audio })
  const video = h("input", { id: "f-video", type: "checkbox", checked: raw.video })
  const speech = h("input", { id: "f-speech", type: "checkbox", checked: raw.speech && speechOk, disabled: !speechOk })
  const syncVideo = () => {
    if (video.checked) {
      audio.checked = true
      audio.disabled = true
    } else audio.disabled = false
  }
  video.addEventListener("change", syncVideo)
  syncVideo()
  const plan = h("textarea", { id: "f-plan", rows: "4", placeholder: "예) 도입 2:00\n본론 5분 30초\n마무리 1:30" }, "")
  plan.value = raw.plan
  const script = createScriptInput({ text: raw.script, fileName: raw.scriptName, onBusy: (busy) => (form.querySelector("#btn-start").disabled = busy) })

  const form = h(
    "form",
    { novalidate: true },
    h(
      "fieldset",
      null,
      h("legend", null, "목표 시간"),
      h(
        "div",
        { class: "row" },
        h("div", { class: "field" }, h("label", { for: "f-tmin" }, "분"), h("input", { id: "f-tmin", type: "number", min: "0", inputmode: "numeric", "aria-label": "목표 시간 분", value: raw.tmin })),
        h("div", { class: "field" }, h("label", { for: "f-tsec" }, "초"), h("input", { id: "f-tsec", type: "number", min: "0", inputmode: "numeric", "aria-label": "목표 시간 초", value: raw.tsec })),
        h("div", { class: "field" }, h("label", { for: "f-tol" }, "허용 오차(초)"), h("input", { id: "f-tol", type: "number", min: "0", inputmode: "numeric", value: raw.tol })),
        h("div", { class: "field" }, h("label", { for: "f-warn" }, "임박 알림(남은 초)"), h("input", { id: "f-warn", type: "number", min: "0", inputmode: "numeric", value: raw.warn })),
      ),
      h("p", { class: "hint" }, "목표 시간은 발표마다 직접 정해요. 남은 시간이 '임박 알림' 이하가 되면 노란색, 목표를 넘으면 빨간색으로 알려요."),
    ),
    h(
      "fieldset",
      null,
      h("legend", null, "목표 속도 범위 (선택)"),
      h(
        "div",
        { class: "row" },
        h("div", { class: "field" }, h("label", { for: "f-smin" }, "최소(분당 음절)"), h("input", { id: "f-smin", type: "number", min: "0", inputmode: "numeric", value: raw.smin })),
        h("div", { class: "field" }, h("label", { for: "f-smax" }, "최대(분당 음절)"), h("input", { id: "f-smax", type: "number", min: "0", inputmode: "numeric", value: raw.smax })),
      ),
      h("p", { class: "hint" }, "비워 두면 속도는 숫자만 보여 줘요. 속도는 '한글 음절 수 ÷ 시간(분)'으로 계산하고 쉬는 시간도 포함해요. 음성 인식을 켜야 측정돼요."),
    ),
    h(
      "fieldset",
      null,
      h("legend", null, "구간별 시간 계획 (선택)"),
      h("label", { class: "hint", for: "f-plan" }, "한 줄에 한 구간씩 '구간 이름 + 시간'을 적어요. 연습 중 '다음 구간' 버튼을 누른 시점으로 계획과 비교해요."),
      plan,
    ),
    script.fieldset,
    h(
      "fieldset",
      null,
      h("legend", null, "기록 방법"),
      h("div", { class: "check" }, audio, h("label", { for: "f-audio" }, "소리 기록 (긴 침묵 찾기, 구간 다시 듣기)")),
      h("div", { class: "check" }, video, h("label", { for: "f-video" }, "웹캠 영상도 기록 (선택, 소리 기록 포함)")),
      h(
        "div",
        { class: "check" },
        speech,
        h(
          "label",
          { for: "f-speech" },
          "음성 인식으로 말하기 속도·반복 표현 분석 (선택)",
          h("br"),
          h("small", null, speechOk ? "브라우저에 따라 음성이 브라우저 제공 업체의 음성 인식 서비스로 전송될 수 있어요. 켜지 않으면 전송하지 않아요." : "이 브라우저는 음성 인식을 지원하지 않아서 속도·반복 표현은 분석할 수 없어요."),
        ),
      ),
      h("p", { class: "info" }, "녹음·영상·분석 결과는 이 브라우저 안에만 저장하고 우리 서버로 보내지 않아요."),
    ),
    errors,
    h("button", { type: "submit", class: "primary", id: "btn-start" }, "연습 시작"),
  )

  form.addEventListener("submit", (ev) => {
    ev.preventDefault()
    if (script.busy()) return
    const read = (id) => form.querySelector(`#f-${id}`)
    const rawNow = {
      tmin: read("tmin").value, tsec: read("tsec").value, tol: read("tol").value, warn: read("warn").value,
      smin: read("smin").value, smax: read("smax").value, plan: read("plan").value,
      script: script.text(), scriptName: script.fileName(),
      audio: audio.checked, video: video.checked, speech: speech.checked,
    }
    const { settings, errors: errs } = readSettings(rawNow)
    if (errs.length) {
      errors.replaceChildren(h("strong", null, "입력을 확인해 주세요."), h("ul", null, errs.map((e) => h("li", null, e))))
      errors.hidden = false
      errors.scrollIntoView({ block: "nearest" })
      return
    }
    beginPractice(settings)
  })

  show(
    h("h1", null, "발표 연습 준비"),
    h("p", { class: "lead" }, "목표 시간을 정하고 연습하면, 연습 중에는 남은 시간과 속도를 보여 주고 끝난 뒤에는 다시 들어 볼 구간을 표시해 줘요."),
    h("div", { class: "card", "aria-label": "연습 설정" }, form),
  )
}

function readSettings(raw) {
  const errs = []
  const num = (v) => (String(v).trim() === "" ? null : Number(v))
  const tmin = num(raw.tmin)
  const tsec = num(raw.tsec)
  let targetSec = null
  if (tmin === null && tsec === null) errs.push("목표 시간을 입력해 주세요. 분이나 초 중 하나는 꼭 필요해요.")
  else if ([tmin, tsec].some((v) => v !== null && (!Number.isInteger(v) || v < 0))) errs.push("목표 시간은 0 이상의 정수로 적어 주세요.")
  else {
    targetSec = (tmin || 0) * 60 + (tsec || 0)
    if (targetSec < 1) errs.push("목표 시간은 1초 이상이어야 해요.")
  }
  const tol = num(raw.tol) ?? 0
  const warn = num(raw.warn) ?? 0
  if (!Number.isInteger(tol) || tol < 0) errs.push("허용 오차는 0 이상의 정수(초)로 적어 주세요.")
  if (!Number.isInteger(warn) || warn < 0) errs.push("임박 알림은 0 이상의 정수(초)로 적어 주세요.")
  const smin = num(raw.smin)
  const smax = num(raw.smax)
  if ([smin, smax].some((v) => v !== null && (!Number.isFinite(v) || v <= 0))) errs.push("목표 속도는 0보다 큰 숫자로 적어 주세요.")
  else if (smin !== null && smax !== null && smin >= smax) errs.push("목표 속도의 최소는 최대보다 작아야 해요.")
  const { sections, errors: planErrs } = parsePlan(raw.plan)
  planErrs.forEach((e) => errs.push(e.message))
  const { script, error: scriptErr } = scriptForPractice(raw.script, raw.scriptName)
  if (scriptErr) errs.push(scriptErr)
  return {
    errors: errs,
    settings: {
      targetSec, toleranceSec: tol, warnSec: warn, speedMin: smin, speedMax: smax,
      sections, planSignature: planSignature(sections), script,
      recordAudio: raw.audio || raw.video, recordVideo: raw.video, speechRequested: raw.speech,
      raw,
    },
  }
}

/* ───────── 연습 진행 ───────── */

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
    this.timer = null
  }
  elapsed() {
    return this.accum + (this.running ? (performance.now() - this.t0) / 1000 : 0)
  }
  async start() {
    if (this.capture) await this.capture.start()
    if (this.settings.speechRequested) {
      this.speech = new SpeechCapture(() => this.elapsed())
      if (!SpeechCapture.supported) this.speech.status = "unsupported"
    }
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
  nextSection() {
    if (this.marks.length < this.settings.sections.length) this.marks.push(Math.floor(this.elapsed()))
  }
}

async function beginPractice(settings) {
  state.starting = true
  setNav()
  const wantMedia = settings.recordAudio || settings.recordVideo
  show(
    h("h1", null, "연습을 준비하고 있어요"),
    h("p", { class: "lead", role: "status" }, wantMedia ? "마이크(와 웹캠) 권한을 확인하고 있어요. 브라우저에 권한 창이 뜨면 허용해 주세요. 허용하지 않아도 시간만 재며 연습할 수 있어요." : "소리를 기록하지 않기로 해서 시간만 측정해요."),
  )
  const { capture, notices, status } = await MediaCapture.open({ audio: settings.recordAudio, video: settings.recordVideo })
  const practice = new Practice(settings, capture, status, notices)
  try {
    await practice.start()
  } catch (e) {
    practice.capture = null
    practice.mediaStatus = { audio: "failed", video: status.video === "off" ? "off" : "failed" }
    practice.notices.push(`녹음을 시작하지 못해 시간만 측정해요 (${e?.message || e}).`)
    capture?.stream.getTracks().forEach((t) => t.stop())
    practice.running = false
    practice.accum = 0
    practice.t0 = performance.now()
    practice.running = true
    practice.speech?.start()
  }
  state.starting = false
  state.practice = practice
  setNav()
  history.replaceState(null, "", "#/practice")
  renderPractice(practice)
}

function renderPractice(p) {
  const s = p.settings
  const els = {
    elapsed: h("strong", { id: "elapsed", "data-testid": "elapsed" }, "0:00"),
    remaining: h("strong", { id: "remaining", "data-testid": "remaining" }, formatClock(s.targetSec)),
    stateText: h("div", { class: "state-text", id: "time-state", "data-testid": "time-state" }, ""),
    speed: h("dd", { id: "speed", "data-testid": "speed" }, ""),
    pace: h("dd", { id: "pace", "data-testid": "pace" }, ""),
    rec: h("dd", { id: "rec-status", "data-testid": "rec-status" }, ""),
    level: h("meter", { min: "0", max: "1", value: "0", "aria-label": "마이크 입력 크기" }),
    paused: h("div", { class: "hint", role: "status" }, ""),
  }
  const panel = h(
    "section",
    { class: "live", "aria-label": "연습 중", id: "panel", "data-state": "ok" },
    h("div", { class: "clocks" }, h("div", { class: "clock" }, h("span", null, "경과 시간"), els.elapsed), h("div", { class: "clock" }, h("span", null, "남은 시간"), els.remaining)),
    els.stateText,
    h(
      "dl",
      null,
      h("dt", null, "목표 시간"),
      h("dd", null, formatClock(s.targetSec)),
      h("dt", null, "말하기 속도"),
      els.speed,
      h("dt", null, "구간 진행"),
      els.pace,
      h("dt", null, "기록 상태"),
      els.rec,
      p.capture ? h("dt", null, "마이크 입력") : null,
      p.capture ? h("dd", null, els.level) : null,
    ),
    els.paused,
  )
  const pauseBtn = h("button", { type: "button", id: "btn-pause" }, "일시정지")
  const nextBtn = s.sections.length ? h("button", { type: "button", id: "btn-next" }, "다음 구간") : null
  const endBtn = h("button", { type: "button", class: "primary", id: "btn-end" }, "연습 종료")
  pauseBtn.addEventListener("click", () => {
    if (p.running) {
      p.pause()
      pauseBtn.textContent = "다시 시작"
    } else {
      p.resume()
      pauseBtn.textContent = "일시정지"
    }
    update()
  })
  nextBtn?.addEventListener("click", () => {
    if (!p.running) return
    p.nextSection()
    update()
  })
  endBtn.addEventListener("click", async () => {
    endBtn.disabled = true
    pauseBtn.disabled = true
    if (nextBtn) nextBtn.disabled = true
    clearInterval(p.timer)
    await finishPractice(p)
  })

  let preview = null
  if (p.capture && p.mediaStatus.video === "ok") {
    preview = h("video", { class: "preview", muted: true, autoplay: true, playsinline: true, "aria-label": "웹캠 미리보기" })
    preview.muted = true
    preview.srcObject = p.capture.stream
  }
  const stage = practiceStage(preview, s.script)

  function update() {
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

    // 속도: 음성 인식이 켜져 있을 때만 측정한다.
    let speedText
    let speedKind = ""
    if (!s.speechRequested) speedText = "측정 안 함 (음성 인식을 켜지 않았어요)"
    else if (!p.speech || p.speech.status === "unsupported") speedText = "측정 불가 (이 브라우저는 음성 인식을 지원하지 않아요)"
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
    }
    els.speed.textContent = speedText
    els.speed.className = "speed-state"
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
    if (nextBtn) nextBtn.disabled = p.marks.length >= s.sections.length

    const parts = []
    parts.push(p.mediaStatus.audio === "ok" && p.capture ? `소리 ${p.running ? "기록 중" : "일시정지"}` : "소리 기록 안 됨")
    if (s.recordVideo) parts.push(p.mediaStatus.video === "ok" && p.capture ? "영상 기록 중" : "영상 기록 안 됨")
    els.rec.textContent = parts.join(" · ")
    if (p.capture) {
      els.level.value = Math.min(1, p.capture.level * 4)
      els.paused.textContent = p.running ? (p.capture.quietForSec > 5 ? "소리가 거의 들어오지 않아요. 마이크 연결을 확인해 주세요." : "") : "일시정지 중이에요. 이 시간은 연습 시간에 넣지 않아요."
    } else els.paused.textContent = p.running ? "" : "일시정지 중이에요. 이 시간은 연습 시간에 넣지 않아요."
  }

  show(
    h("h1", null, "연습 중"),
    ...p.notices.map((n) => h("div", { class: "notice", role: "status" }, n)),
    panel,
    h("div", { class: "controls" }, pauseBtn, nextBtn, endBtn),
    stage,
  )
  update()
  p.timer = setInterval(update, 200)
}

async function finishPractice(p) {
  const s = p.settings
  const total = Math.floor(p.elapsed())
  p.running = false
  show(h("h1", null, "결과를 정리하고 있어요"), h("p", { class: "lead", role: "status" }, "녹음을 마무리하고 검토할 구간을 찾는 중이에요. 잠시만 기다려 주세요."))
  const notices = [...p.notices]
  let rec = { samples: new Float32Array(0), sampleRate: 16000, wavBlob: null, videoBlob: null }
  if (p.capture) {
    try {
      rec = await p.capture.stop()
    } catch (e) {
      notices.push(`녹음을 마무리하지 못했어요 (${e?.message || e}).`)
    }
  }
  const segments = p.speech ? p.speech.stop() : []
  const audioOk = Boolean(p.capture) && rec.samples.length > 0 && p.mediaStatus.audio === "ok"
  if (p.capture && rec.samples.length === 0) notices.push("기록된 소리가 없어요. 녹음 길이가 너무 짧았을 수 있어요.")

  const silence = audioOk ? analyzeSilence(rec.samples, rec.sampleRate) : null
  if (silence?.status === "no-signal") notices.push("녹음에 소리가 거의 없어서 긴 침묵을 찾지 않았어요. 마이크 연결과 입력 장치를 확인해 주세요.")
  if (silence?.status === "too-short") notices.push("녹음이 너무 짧아서 긴 침묵을 찾지 않았어요.")
  const transcript = p.speech ? analyzeTranscript(segments, total) : null
  let speechState = "off"
  if (p.speech) speechState = p.speech.status === "on" ? (transcript.status === "ok" ? "ok" : "no-text") : p.speech.status
  const sectionRows = s.sections.length ? sectionResults(s.sections, p.marks, total) : []
  const items = buildReviewItems({ silence, transcript, sectionRows, toleranceSec: s.toleranceSec })
  const result = classifyResult(total, s.targetSec, s.toleranceSec)

  // 대본 글은 settings.script에만 한 번 저장한다(raw에 같은 글을 두 번 넣지 않는다).
  const { raw: { script: _scriptText, scriptName: _scriptName, ...raw }, ...settingsStored } = s
  const session = {
    id: newId(),
    createdAt: Date.now(),
    settings: { ...settingsStored, raw },
    conditionKey: conditionKey(s.targetSec, s.planSignature),
    totalSec: total,
    result,
    marks: p.marks,
    sectionRows,
    media: { audio: audioOk ? "ok" : p.mediaStatus.audio === "ok" ? "failed" : p.mediaStatus.audio, video: rec.videoBlob ? "ok" : s.recordVideo ? "failed" : "off", speech: speechState, speechDetail: p.speech?.detail || "" },
    analysis: { silence: silence && { status: silence.status, threshold: silence.threshold, voicedRatio: silence.voicedRatio }, transcript, items },
    transcript: segments,
    audioBlob: audioOk ? rec.wavBlob : null,
    videoBlob: rec.videoBlob,
    notices,
  }
  const saved = await saveSession(session)
  if (!saved.ok) session.notices.push(`기록을 이 기기에 저장하지 못했어요 (${saved.error}). 이 화면을 닫으면 다시 볼 수 없어요.`)
  state.practice = null
  setNav()
  history.replaceState(null, "", `#/result/${session.id}`)
  renderResult(session)
}

/* ───────── 결과 화면 ───────── */

const SPEECH_REASON = {
  off: "음성 인식을 켜지 않아서 속도와 반복 표현은 분석하지 않았어요.",
  unsupported: "이 브라우저가 음성 인식을 지원하지 않아서 속도와 반복 표현은 분석하지 못했어요.",
  denied: "음성 인식 권한이 거부돼서 속도와 반복 표현은 분석하지 못했어요.",
  error: "음성 인식에 오류가 있어서 속도와 반복 표현은 분석하지 못했어요.",
  "no-text": "음성 인식을 켰지만 인식된 말이 없어서 속도와 반복 표현은 분석하지 못했어요.",
}

async function renderResult(session) {
  const a = session.analysis
  const r = session.result
  const hasMedia = Boolean(session.audioBlob || session.videoBlob)
  const url = (b) => (b ? URL.createObjectURL(b) : null)
  let player = null
  if (session.videoBlob) player = h("video", { id: "player", class: "player", controls: true, preload: "metadata", "aria-label": "연습 영상 다시 보기" })
  else if (session.audioBlob) player = h("audio", { id: "player", class: "player", controls: true, preload: "metadata", "aria-label": "연습 녹음 다시 듣기" })
  if (player) {
    player.src = url(session.videoBlob || session.audioBlob)
    makeSeekable(player)
  }
  const seekStatus = h("p", { class: "hint", role: "status", id: "seek-status" }, "")
  function seek(sec) {
    if (!player) return
    const go = () => {
      player.currentTime = sec
      seekStatus.textContent = `재생 위치를 ${formatClock(sec)}로 옮겼어요.`
      player.play?.().catch(() => {})
    }
    if (player.readyState >= 1 && Number.isFinite(player.duration)) go()
    else player.addEventListener("durationchange", () => Number.isFinite(player.duration) && go(), { once: true })
  }

  const sp = a.transcript?.status === "ok" ? `${Math.round(a.transcript.overallRate)} 음절/분 (한글 음절 ${a.transcript.totalSyllables}개 ÷ 전체 ${formatClock(session.totalSec)}, 쉼 포함)` : `측정 못 함 — ${SPEECH_REASON[session.media.speech] || ""}`
  const summary = h(
    "section",
    { class: "card", "aria-label": "연습 결과" },
    h("h2", null, "연습 결과"),
    h(
      "dl",
      { class: "facts" },
      h("dt", null, "총 연습 시간"),
      h("dd", { "data-testid": "total" }, `${formatClock(session.totalSec)} (일시정지 시간 제외)`),
      h("dt", null, "목표 시간"),
      h("dd", { "data-testid": "target" }, formatClock(session.settings.targetSec)),
      h("dt", null, "목표와의 차이"),
      h("dd", { "data-testid": "diff" }, h("span", { class: "tag", "data-kind": r.kind }, r.label), ` (${formatSigned(r.diffSec)})`),
      h("dt", null, "평균 말하기 속도"),
      h("dd", { "data-testid": "avg-speed" }, sp),
    ),
  )

  const sectionCard = session.sectionRows.length
    ? h(
        "section",
        { class: "card", "aria-label": "구간별 시간" },
        h("h2", null, "구간별 계획과 실제"),
        h(
          "table",
          null,
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
  const reviewNotes = []
  if (!hasMedia) reviewNotes.push("소리를 기록하지 못해서 긴 침묵은 찾지 못했고, 다시 듣기도 할 수 없어요.")
  else if (a.silence?.status === "ok") reviewNotes.push(`긴 침묵 기준: 소리가 기준 이하인 상태가 ${SILENCE_MIN_SEC}초 이상. 이 녹음의 소리 크기를 기준으로 삼았어요.`)
  if (session.media.speech !== "ok") reviewNotes.push(SPEECH_REASON[session.media.speech] || "")
  else reviewNotes.push(`속도 변화 기준: ${SPEED_WINDOW_SEC}초 구간 속도가 평균보다 ${Math.round(SPEED_DEVIATION * 100)}% 이상 차이. 글 시간은 인식 결과가 도착한 시점으로 추정한 값이라 정확하지 않을 수 있어요.`)
  const review = h(
    "section",
    { class: "card", "aria-label": "검토할 구간" },
    h("h2", null, "다시 확인해 볼 구간"),
    ...reviewNotes.filter(Boolean).map((n) => h("p", { class: "hint" }, n)),
    items.length
      ? h(
          "ul",
          { class: "review", "aria-label": "검토할 구간 목록" },
          items.map((it) =>
            h(
              "li",
              { "data-type": it.type },
              h("button", { type: "button", "data-start": String(it.startSec), disabled: !hasMedia, onclick: () => seek(it.startSec) }, `${formatClock(it.startSec)} · ${it.title}`),
              h("p", null, `측정값: ${it.measured}`),
              h("p", null, `근거: ${it.basis}`),
            ),
          ),
        )
      : h("p", { "data-testid": "no-items" }, "표시할 구간이 없어요. 위 기준으로 찾은 항목이 없다는 뜻이고, 발표가 괜찮다는 평가는 아니에요."),
    player ? h("div", null, h("h2", null, hasMedia ? "구간 다시 보기" : ""), player, seekStatus) : null,
    !hasMedia && items.length ? h("p", { class: "hint" }, "녹음이 없어서 구간을 눌러도 이동할 수 없어요.") : null,
  )

  const transcriptCard = session.transcript?.length
    ? h(
        "section",
        { class: "card" },
        h("details", null, h("summary", null, `인식된 글 보기 (${session.transcript.length}개 조각)`), h("ul", null, session.transcript.map((t) => h("li", null, `${formatClock(t.startSec)}~${formatClock(t.endSec)} ${t.text}`)))),
      )
    : null

  const compareHost = h("section", { class: "card", "aria-label": "이전 연습과 비교" }, h("h2", null, "같은 조건의 이전 연습과 비교"), h("p", { class: "hint" }, "이전 기록을 찾는 중이에요…"))

  show(
    h("h1", null, "연습 결과"),
    ...session.notices.map((n) => h("div", { class: "notice", role: "status" }, n)),
    summary,
    sectionCard,
    review,
    transcriptCard,
    scriptResultCard(session),
    compareHost,
    h(
      "div",
      { class: "btn-row" },
      h("button", { type: "button", class: "primary", id: "btn-again", onclick: () => { state.prefill = { ...session.settings.raw, ...scriptPrefill(session) }; location.hash = "#/" } }, "같은 조건으로 다시 연습"),
      h("a", { href: "#/history" }, "연습 기록 보기"),
    ),
  )
  // 비교 대상: 같은 목표 시간·구간 계획으로 한 연습 중 바로 앞의 것
  const { sessions } = await listSessions()
  const prev = sessions.find((x) => x.id !== session.id && x.conditionKey === session.conditionKey && x.createdAt < session.createdAt)
  compareHost.replaceChildren(h("h2", null, "같은 조건의 이전 연습과 비교"))
  if (!prev) {
    compareHost.append(h("p", { "data-testid": "no-compare" }, "아직 비교할 이전 기록이 없어요. 같은 목표 시간과 구간 계획으로 한 번 더 연습하면 비교해 보여 줘요."))
  } else {
    const rows = compareSessions(prev, session)
    compareHost.append(
      h("p", { class: "hint" }, `비교 대상: ${new Date(prev.createdAt).toLocaleString("ko-KR")} 연습. 점수나 개선율은 계산하지 않고 측정한 값만 나란히 보여 줘요.`),
      h(
        "table",
        { "data-testid": "compare-table" },
        h("thead", null, h("tr", null, ["항목", "이전", "이번", "변화"].map((x) => h("th", { scope: "col" }, x)))),
        h("tbody", null, rows.map((row) => h("tr", null, h("td", null, row.label), h("td", null, row.prev), h("td", null, row.cur), h("td", null, row.delta)))),
      ),
    )
  }
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

/* ───────── 연습 기록 화면 ───────── */

async function renderHistory() {
  const { sessions, error } = await listSessions()
  const rows = sessions.map((s) => {
    const del = h("button", { type: "button", "aria-label": `${new Date(s.createdAt).toLocaleString("ko-KR")} 기록 삭제` }, "삭제")
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
      h("td", null, formatClock(s.settings.targetSec)),
      h("td", null, formatClock(s.totalSec)),
      h("td", null, s.result.label),
      h("td", null, h("a", { href: `#/result/${s.id}` }, "결과 보기"), " ", del),
    )
  })
  show(
    h("h1", null, "연습 기록"),
    error ? h("div", { class: "notice", role: "status" }, `저장된 기록을 불러오지 못해 이 화면에서 한 연습만 보여 줘요 (${error}).`) : null,
    sessions.length
      ? h("div", { class: "card" }, h("table", null, h("thead", null, h("tr", null, ["날짜", "목표", "연습 시간", "목표와의 차이", ""].map((x) => h("th", { scope: "col" }, x)))), h("tbody", null, rows)))
      : h("div", { class: "card" }, h("p", { "data-testid": "no-sessions" }, "아직 연습 기록이 없어요. 연습 준비 화면에서 첫 연습을 시작해 보세요.")),
  )
}

/* ───────── 주소에 따라 화면 고르기 ───────── */

async function route() {
  setNav()
  const hash = location.hash || "#/"
  if (state.practice || state.starting) {
    if (state.practice && hash !== "#/practice") history.replaceState(null, "", "#/practice")
    return
  }
  const m = hash.match(/^#\/result\/(.+)$/)
  if (m) {
    const s = await getSession(decodeURIComponent(m[1]))
    if (!s) return show(h("h1", null, "기록을 찾을 수 없어요"), h("p", null, "삭제됐거나 이 브라우저에 저장되지 않은 연습이에요."), h("a", { href: "#/history" }, "연습 기록으로 가기"))
    return renderResult(s)
  }
  if (hash === "#/history") return renderHistory()
  if (hash === "#/practice") return location.replace("#/")
  renderSetup()
}

window.addEventListener("hashchange", route)
route()
