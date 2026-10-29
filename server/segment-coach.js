// POST /api/coach/segment — 사용자가 확인한 대본 위치와 영상 검토 구간으로 '그때 무슨 일이 있었는지' 묻고,
// 답에 따라 개념 확인·쉬운 설명·다음 연습 행동으로 잇는다. 흐름은 규칙으로 정하고,
// 글을 만들어야 하는 단계(개념 풀이·확인 질문·답변 검토)만 기존 /api/coach 서비스(coach.run)에 맡긴다.
// → 모델 선택·인용 검증·동시 처리·타임아웃·취소·오류 처리는 기존 코칭과 같다. 모델 호출부를 따로 만들지 않는다.
// 관찰된 측정값(침묵 등)을 이해 부족·긴장 같은 원인으로 바꾸지 않고, 감정·지능·성격을 진단하지 않는다.
// 대화·대본·전사를 저장하거나 로그에 남기지 않는다. 대화 이력은 클라이언트가 보내므로 질문 상한은 완전한 서버 보장이 아니다.
import { CoachError } from "./local-coach.js"
import { splitScript } from "./script-align.js"
import { QUESTION_LIMIT, keywordsOf } from "../public/js/coach.js"

export const SEGMENT_PROMPT_VERSION = "segment-coach-v1"
export const SEGMENT_LIMITS = Object.freeze({
  body: 128 * 1024, // 선택 문장 위치를 확인하려고 대본 전체를 받는다
  script: 20_000,
  sources: 2400, // 기존 코칭과 같은 근거 자료 한도
  text: 1000, // 답변·이력 글 하나
  history: 16, // 이력 항목 수
  segments: 10, // 앞뒤·구간 안 전사 구간 수
  observations: 8,
  segmentWindowSecond: 60, // 전사 구간은 검토 지점 앞뒤 60초 안이어야 한다
  maxSecond: 4 * 3600,
  perClientPerMinute: 20,
})
const FOLLOWUP_LIMIT = QUESTION_LIMIT // 같은 항목의 후속 질문 최대 3회(화면 질문 카드와 같은 상한)

const ID = /^[\w.:-]{1,80}$/
const REQ = /^[\w-]{1,80}$/
const REASONS = ["intended-pause", "forgot-line", "concept-confusing", "awkward-sentence", "other"]
const ACTIONS = ["start", "answer", "unknown", "explain", "skip"]
const OBSERVATIONS = { silence: "긴 침묵", repeat: "반복 표현", filler: "군말", gaze: "시선 이탈", speed: "속도 변화", section: "구간 시간 차이" }
const CONFIRMATIONS = ["user-confirmed", "user-selected"]

const err = (status, code, message) => new CoachError(status, code, message)
const isTime = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= SEGMENT_LIMITS.maxSecond
const str = (v, max, field) => {
  if (v === undefined || v === null) return ""
  if (typeof v !== "string" || v.length > max) throw err(400, "invalid-input", `${field}는 ${max}자 이하 문자열이어야 해요.`)
  return v
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
const clip = (t, n = 40) => (t.length > n ? `${t.slice(0, n)}…` : t)

/* ───────── 입력 검사 ───────── */

export function validateSegmentInput(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw err(400, "invalid-input", "요청 본문은 JSON 객체여야 해요.")
  for (const key of ["requestId", "practiceId"]) if (typeof data[key] !== "string" || !REQ.test(data[key])) throw err(400, "invalid-input", `${key}는 영문·숫자·_- 1~80자여야 해요.`)
  if (typeof data.scriptVersionId !== "string" || !ID.test(data.scriptVersionId)) throw err(400, "invalid-input", "scriptVersionId는 영문·숫자·_-.: 1~80자여야 해요.")
  const script = str(data.script, SEGMENT_LIMITS.script, "script")
  if (!script.trim()) throw err(400, "invalid-input", "연습 당시 대본(script)이 필요해요.")
  const sources = str(data.sources, SEGMENT_LIMITS.sources, "sources").trim()

  // 검토 지점
  const p = data.point
  if (!p || typeof p !== "object" || typeof p.id !== "string" || !ID.test(p.id)) throw err(400, "invalid-input", "point.id가 필요해요.")
  if (!isTime(p.startSecond) || !isTime(p.endSecond) || p.endSecond < p.startSecond) throw err(400, "invalid-time", "point의 시간(startSecond ≤ endSecond, 0~4시간)이 올바르지 않아요.")
  const obs = Array.isArray(p.observations) ? p.observations : []
  if (!obs.length || obs.length > SEGMENT_LIMITS.observations) throw err(400, "invalid-input", `point.observations에 관찰된 검토 사유를 1~${SEGMENT_LIMITS.observations}개 넣어 주세요.`)
  const observations = obs.map((o, i) => {
    if (!o || !Object.hasOwn(OBSERVATIONS, o.type)) throw err(400, "invalid-input", `point.observations[${i}].type은 ${Object.keys(OBSERVATIONS).join("·")} 중 하나여야 해요.`)
    return { type: o.type, label: OBSERVATIONS[o.type], measured: str(o.measured, 80, `point.observations[${i}].measured`).trim() }
  })
  const point = { id: p.id, startSecond: p.startSecond, endSecond: p.endSecond, observations }

  // 사용자가 확인·선택한 대본 문장(/api/scripts/align의 sentences 항목과 같은 모양)
  const s = data.selection
  if (!s || typeof s !== "object") throw err(400, "confirmation-required", "사용자가 확인하거나 직접 고른 대본 문장(selection)이 필요해요.")
  if (!CONFIRMATIONS.includes(s.confirmation)) throw err(400, "confirmation-required", "자동 연결 결과만으로는 코칭을 시작하지 않아요. 사용자가 위치를 확인(user-confirmed)하거나 직접 고른(user-selected) 문장을 보내 주세요.")
  if (s.confirmation === "user-confirmed" && s.alignmentStatus !== "matched") throw err(400, "confirmation-required", "자동 연결이 matched가 아니면 사용자가 직접 고른 문장(user-selected)으로 보내 주세요.")
  if (s.alignmentStatus !== undefined && !["matched", "ambiguous", "unmatched"].includes(s.alignmentStatus)) throw err(400, "invalid-input", "selection.alignmentStatus는 matched·ambiguous·unmatched 중 하나여야 해요.")
  const sentences = splitScript(script)
  const sent = sentences.find((x) => x.id === s.sentenceId)
  if (!sent || s.start !== sent.start || s.end !== sent.end || s.text !== sent.text || script.slice(s.start, s.end) !== s.text) {
    throw err(400, "selection-mismatch", "선택한 문장의 ID·원문·위치가 이 대본과 맞지 않아요. 같은 대본 버전으로 다시 연결해 주세요.")
  }
  const selection = { sentenceId: sent.id, index: sent.index, text: sent.text, start: sent.start, end: sent.end, confirmation: s.confirmation, alignmentStatus: s.alignmentStatus ?? null, algorithmVersion: typeof s.algorithmVersion === "string" ? s.algorithmVersion.slice(0, 40) : null }

  // 앞뒤·구간 안 전사(/api/scripts/align의 points[].transcript 모양)
  const t = data.transcript && typeof data.transcript === "object" ? data.transcript : {}
  const list = [...(Array.isArray(t.during) ? t.during : []), t.before, t.after].filter(Boolean)
  if (list.length > SEGMENT_LIMITS.segments) throw err(413, "too-large", `전사 구간은 ${SEGMENT_LIMITS.segments}개까지 보내 주세요.`)
  for (const [i, g] of list.entries()) {
    if (!g || typeof g !== "object" || typeof g.text !== "string" || g.text.length > SEGMENT_LIMITS.text) throw err(400, "invalid-input", `전사 구간 ${i + 1}의 text 형식이 맞지 않아요.`)
    if (!isTime(g.startSecond) || !isTime(g.endSecond) || g.endSecond < g.startSecond) throw err(400, "invalid-time", `전사 구간 ${i + 1}의 시간이 올바르지 않아요.`)
    if (g.endSecond < point.startSecond - SEGMENT_LIMITS.segmentWindowSecond || g.startSecond > point.endSecond + SEGMENT_LIMITS.segmentWindowSecond) throw err(400, "segment-mismatch", "전사 구간이 검토 지점과 너무 멀어요. 이 지점의 연결 결과에 있던 구간을 보내 주세요.")
  }
  const seg = (g) => g && { startSecond: g.startSecond, endSecond: g.endSecond, text: g.text }
  const transcript = { before: seg(t.before), during: (Array.isArray(t.during) ? t.during : []).map(seg), after: seg(t.after) }

  // 대화 이력: 이 연습·지점·대본 버전의 것만
  const hist = Array.isArray(data.history) ? data.history : []
  if (hist.length > SEGMENT_LIMITS.history) throw err(413, "too-large", `대화 이력은 ${SEGMENT_LIMITS.history}개까지 보내 주세요. 새 항목으로 다시 시작할 수 있어요.`)
  const history = hist.map((h, i) => {
    if (!h || !["coach", "user"].includes(h.role) || typeof h.questionKey !== "string" || !/^[\w-]{1,40}$/.test(h.questionKey)) throw err(400, "invalid-input", `history[${i}] 형식이 맞지 않아요.`)
    if (h.practiceId !== data.practiceId || h.pointId !== point.id || h.scriptVersionId !== data.scriptVersionId) throw err(409, "history-mismatch", "다른 연습·구간·대본 버전의 대화가 섞였어요. 이 구간의 대화만 보내 주세요.")
    const item = { role: h.role, questionKey: h.questionKey, text: str(h.text, SEGMENT_LIMITS.text, `history[${i}].text`) }
    if (h.role === "coach") item.kind = h.kind === "question" ? "question" : "info"
    else {
      if (!ACTIONS.includes(h.action) || h.action === "start") throw err(400, "invalid-input", `history[${i}].action이 올바르지 않아요.`)
      item.action = h.action
      if (h.reason !== undefined && !REASONS.includes(h.reason)) throw err(400, "invalid-input", `history[${i}].reason이 올바르지 않아요.`)
      item.reason = h.reason
    }
    if (h.term !== undefined) item.term = str(h.term, 80, `history[${i}].term`)
    if (h.question !== undefined) item.question = str(h.question, 400, `history[${i}].question`)
    return item
  })

  // 이번 사용자 행동
  const a = data.action
  if (!a || !ACTIONS.includes(a.type)) throw err(400, "invalid-input", `action.type은 ${ACTIONS.join("·")} 중 하나여야 해요.`)
  if (a.reason !== undefined && !REASONS.includes(a.reason)) throw err(400, "invalid-input", `action.reason은 ${REASONS.join("·")} 중 하나여야 해요.`)
  const action = { type: a.type, reason: a.reason, text: str(a.text, SEGMENT_LIMITS.text, "action.text").trim(), questionKey: typeof a.questionKey === "string" ? a.questionKey : null }
  const lastCoach = [...history].reverse().find((h) => h.role === "coach")
  if (!history.length && action.type !== "start") throw err(409, "history-mismatch", "이 구간의 대화를 먼저 시작해 주세요(action.type: start).")
  if (history.length && action.type === "start") throw err(409, "history-mismatch", "이미 시작한 대화예요. 이어서 답하거나 건너뛰기를 보내 주세요.")
  if (history.length && action.questionKey !== lastCoach?.questionKey) throw err(409, "history-mismatch", "마지막 코치 질문에 대한 답이 아니에요. 화면을 새로 고친 뒤 다시 시도해 주세요.")
  if (action.type === "answer" && action.questionKey === "situation" && !action.reason) throw err(400, "invalid-input", "어떤 일이 있었는지 선택지(action.reason)를 골라 주세요.")
  if (action.type === "answer" && action.questionKey !== "situation" && !action.text) throw err(400, "invalid-input", "답변(action.text)을 입력하거나 모르겠어요·설명 요청·건너뛰기를 골라 주세요.")

  return { requestId: data.requestId, practiceId: data.practiceId, scriptVersionId: data.scriptVersionId, script, sources, point, selection, sentences, transcript, history, action }
}

/* ───────── 흐름 ───────── */

function contextScript(input) {
  // 모델에는 선택 문장과 바로 앞뒤 문장만 보낸다(기존 코칭 대본 한도 2,400자 안).
  const { sentences, selection } = input
  const parts = [sentences[selection.index - 1], sentences[selection.index], sentences[selection.index + 1]].filter(Boolean)
  let text = parts.map((x) => x.text).join(" ")
  if (text.length > 2400) text = selection.text
  if (text.length > 2400) throw err(400, "invalid-input", "선택한 문장이 2,400자를 넘어 코칭할 수 없어요.")
  return text
}

/** 문장에서 확인해 볼 만한 표현 후보(긴 낱말 순, 화면 핵심어 카드와 같은 규칙). */
const termChoices = (sentence) => keywordsOf(sentence).split(" · ").filter((w) => w && w !== sentence).slice(0, 3)
/** 말하기 어려운 부분 후보: 쉼표·접속 표현 기준 덩어리. */
function chunks(sentence) {
  const out = sentence.split(/(?<=[,，])\s*|\s+(?=그리고|하지만|그래서|또는|및)/).map((x) => x.trim()).filter(Boolean)
  return (out.length > 1 ? out : sentence.split(/\s+/).reduce((acc, w, i) => { if (i % 4 === 0) acc.push(w); else acc[acc.length - 1] += ` ${w}`; return acc }, [])).slice(0, 5)
}

export function createSegmentCoach({ coach, now = () => Date.now(), limits = SEGMENT_LIMITS }) {
  const perClient = new Map()
  function admit(client = "unknown") {
    const t = now()
    const list = (perClient.get(client) || []).filter((x) => x > t - 60_000)
    if (list.length >= limits.perClientPerMinute) throw Object.assign(err(429, "rate-limited", "이 기기의 구간 코칭 요청이 많아요. 잠시 뒤에 다시 시도해 주세요."), { retryAfter: Math.max(1, Math.ceil((list[0] + 60_000 - t) / 1000)) })
    list.push(t)
    perClient.set(client, list)
    if (perClient.size > 1000) for (const [k, v] of perClient) if (!v.some((x) => x > t - 60_000)) perClient.delete(k)
  }

  async function model(task, input, extra, signal) {
    const versionId = input.scriptVersionId.replace(/[^\w-]/g, "-").slice(0, 80)
    return coach.run({ task, requestId: input.requestId, versionId, script: contextScript(input), sources: input.sources, question: "", answer: "", ...extra }, signal)
  }

  return {
    async run(data, signal, meta = {}) {
      const input = validateSegmentInput(data)
      admit(meta.client)
      const start = now()
      const { history, action, selection, point, sources } = input
      const asked = new Set(history.filter((h) => h.role === "coach" && h.kind === "question").map((h) => h.questionKey))
      const followups = history.filter((h) => h.role === "coach" && h.kind === "question" && h.questionKey !== "situation").length
      const situation = action.questionKey === "situation" && action.type === "answer" ? action : history.find((h) => h.role === "user" && h.questionKey === "situation" && h.action === "answer")
      const reason = situation?.reason ?? null
      const userReports = history.filter((h) => h.role === "user" && h.text).map((h) => ({ questionKey: h.questionKey, text: h.text, source: "user" }))
      if (action.text) userReports.push({ questionKey: action.questionKey, text: action.text, source: "user" })
      const evidence = []
      const unverified = []
      let modelName = "rule"
      let modelResult = null
      const canAsk = followups < FOLLOWUP_LIMIT

      const ids = { pointId: point.id, scriptVersionId: input.scriptVersionId, practiceId: input.practiceId }
      const msg = (questionKey, kind, text, choices = null, extra = {}) => ({ role: "coach", questionKey, kind, text, ...(choices && { choices }), ...ids, ...extra })
      const where = `${clock(point.startSecond)}~${clock(point.endSecond)}`
      const observed = point.observations.map((o) => `${o.label}${o.measured ? `(측정값 ${o.measured})` : ""}`).join(", ")

      const practice = (text) => ({ step: "practice", done: true, message: msg("practice", "info", text, [{ value: "finish", label: "끝내기" }]) })
      const closed = (text) => ({ step: "closed", done: true, message: msg("closed", "info", text) })

      async function explain(term) {
        const out = await model("concepts", input, {}, signal)
        modelName = out.model
        modelResult = out.result
        const list = out.result.concepts || []
        const pick = (term && list.find((c) => c.term.includes(term) || term.includes(c.term))) || list[0]
        if (!pick) throw err(502, "invalid-output", "설명할 표현을 찾지 못했어요. 원문은 그대로예요.")
        const grounded = Boolean(sources && pick.sourceQuote)
        if (grounded) evidence.push({ quote: pick.sourceQuote, source: "provided-material", supports: pick.term })
        else unverified.push(sources ? `'${pick.term}' 풀이는 제공한 자료에서 근거 문장을 찾지 못한 초안이에요.` : `근거 자료가 없어 '${pick.term}' 풀이의 사실 여부를 확인하지 않았어요.`)
        if (term && !list.some((c) => c.term.includes(term) || term.includes(c.term))) unverified.push(`'${clip(term, 20)}'에 맞는 풀이를 만들지 못해 문장 안의 다른 표현을 풀었어요.`)
        const text = `‘${pick.term}’: ${pick.explanation}${grounded ? ` (자료: “${pick.sourceQuote}”)` : " (자료 근거 없음 — 확인이 필요한 풀이 초안이에요)"}`
        const choices = canAsk && !asked.has("concept-check") ? [{ value: "check", label: "이해 확인 질문 받기" }, { value: "finish", label: "끝내기" }] : [{ value: "finish", label: "끝내기" }]
        return { step: "explanation", done: choices.length === 1, message: msg("explanation", "info", text, choices, { term: pick.term }) }
      }
      async function checkQuestion() {
        if (!canAsk || asked.has("concept-check")) return practice(`이 문장을 자기 말로 한 번 설명해 본 뒤, ${where} 구간부터 다시 연습해 보세요.`)
        const out = await model("question", input, {}, signal)
        modelName = out.model
        modelResult = out.result
        if (out.result.referenceQuote) evidence.push({ quote: out.result.referenceQuote, source: "provided-material", supports: "확인 질문의 정답 근거" })
        else unverified.push("근거 자료가 없어 확인 질문의 정답을 자료로 확인할 수 없어요.")
        return { step: "concept-check", done: false, message: msg("concept-check", "question", out.result.question, [{ value: "unknown", label: "모르겠어요" }, { value: "explain", label: "설명해 주세요" }, { value: "skip", label: "건너뛰기" }], { question: out.result.question }) }
      }

      let next
      if (action.type === "skip") next = closed("이 구간은 건너뛸게요. 다른 구간을 살펴보거나 연습을 이어가세요.")
      else if (action.type === "start") {
        next = {
          step: "ask-situation",
          done: false,
          message: msg("situation", "question", `${where}에 ${observed}이(가) 관찰됐어요. 사용자가 확인한 위치는 대본 “${clip(selection.text)}” 근처예요. 이 부분에서 어떤 일이 있었나요?`, [
            { value: "intended-pause", label: "일부러 쉬었어요" },
            { value: "forgot-line", label: "다음 대사가 기억나지 않았어요" },
            { value: "concept-confusing", label: "내용(개념)이 헷갈렸어요" },
            { value: "awkward-sentence", label: "문장이 말하기 어색했어요" },
            { value: "other", label: "직접 쓸게요" },
          ]),
        }
      } else if (action.questionKey === "situation") {
        if (action.type === "unknown") next = practice(`괜찮아요. ${where} 구간을 앞 문장부터 한 번 더 이어 말해 보고, 같은 곳에서 다시 멈추는지 확인해 보세요.`)
        else if (action.type === "explain") next = await explain(null)
        else if (reason === "intended-pause") next = closed("의도한 쉼이라면 그대로 두어도 돼요. 이 구간은 문제로 표시하지 않을게요.")
        else if (reason === "forgot-line") {
          const prev = input.sentences[selection.index - 1]
          const cue = keywordsOf(selection.text)
          next = practice(`연결 단서를 만들어 보세요: ${prev ? `앞 문장 끝 “${clip(prev.text.slice(-15), 15)}”에서 ` : ""}이 문장의 핵심어 “${cue}”로 이어 말하기를 2~3번 연습한 뒤 ${where} 구간부터 다시 녹화해 보세요.`)
        } else if (reason === "concept-confusing") {
          const term = action.text && selection.text.includes(action.text) ? action.text : null
          if (term) next = await explain(term)
          else if (canAsk && !asked.has("concept-term")) next = { step: "ask-detail", done: false, message: msg("concept-term", "question", "어떤 표현이 헷갈렸나요?", [...termChoices(selection.text).map((w) => ({ value: w, label: w })), { value: "unknown", label: "잘 모르겠어요" }]) }
          else next = await explain(null)
        } else if (reason === "awkward-sentence") {
          if (canAsk && !asked.has("awkward-part")) next = { step: "ask-detail", done: false, message: msg("awkward-part", "question", "문장의 어느 부분이 말하기 어려웠나요?", [...chunks(selection.text).map((c) => ({ value: c, label: c })), { value: "unknown", label: "잘 모르겠어요" }]) }
          else next = practice("문장을 숨 쉬는 곳마다 끊어 천천히 3번 읽은 뒤 원래 속도로 이어 말해 보세요.")
        } else next = practice(`설명해 주셔서 고마워요. 적어 주신 상황을 기억하며 ${where} 구간을 한 번 더 연습해 보세요.`)
      } else if (action.questionKey === "concept-term") {
        next = action.type === "answer" ? await explain(action.text) : await explain(null)
      } else if (action.questionKey === "awkward-part") {
        const part = action.type === "answer" ? action.text : null
        next = practice(part ? `“${clip(part, 30)}” 부분만 따로 천천히 3번 읽고, 앞뒤를 붙여 문장 전체로 이어 말해 보세요. 대본을 바꾸지 않고 읽는 방법만 바꿔 보는 연습이에요.` : "문장을 숨 쉬는 곳마다 끊어 천천히 3번 읽은 뒤 원래 속도로 이어 말해 보세요.")
      } else if (action.questionKey === "explanation") {
        next = action.type === "answer" && action.text === "check" ? await checkQuestion() : closed("확인했어요. 설명을 떠올리며 이 구간을 다시 연습해 보세요.")
      } else if (action.questionKey === "concept-check") {
        const q = [...history].reverse().find((h) => h.role === "coach" && h.questionKey === "concept-check")?.question || ""
        if (action.type === "answer") {
          if (!q) throw err(409, "history-mismatch", "확인 질문 원문(question)이 이력에 없어요.")
          const out = await model("review", input, { question: q, answer: action.text }, signal)
          modelName = out.model
          modelResult = out.result
          if (out.result.sourceQuote) evidence.push({ quote: out.result.sourceQuote, source: "provided-material", supports: "답변 대조" })
          if (out.result.state === "uncertain") unverified.push(sources ? "자료만으로 답변을 판단할 수 없었어요." : "근거 자료가 없어 답변이 맞는지 판단하지 않았어요.")
          const label = { supported: "자료와 맞는 설명이에요.", "needs-work": "자료와 다른 부분이 있어요.", uncertain: "자료만으로 판단할 수 없어요." }[out.result.state]
          next = { step: "review", done: true, message: msg("review", "info", `${label} ${out.result.nextStep}`, [{ value: "finish", label: "끝내기" }], { reviewState: out.result.state }) }
        } else if (action.type === "unknown" || action.type === "explain") next = asked.has("explanation") || history.some((h) => h.questionKey === "explanation") ? practice("설명을 다시 읽고 자기 말로 한 문장씩 말해 본 뒤 이 구간을 다시 연습해 보세요.") : await explain(null)
        else next = closed("확인 질문을 건너뛸게요.")
      } else if (action.questionKey === "practice" || action.questionKey === "closed") next = closed("이 구간 코칭을 마쳤어요.")
      else throw err(409, "history-mismatch", "알 수 없는 질문에 대한 답이에요.")

      if (!sources && !unverified.some((u) => u.includes("근거 자료"))) unverified.push("근거 자료가 없어 내용의 사실 여부는 확인하지 않았어요.")
      unverified.push("위치는 사용자가 확인·선택한 값이며 서버가 영상·대본으로 검증한 사실이 아니에요.")
      const followupCount = followups + (next.message.kind === "question" && next.message.questionKey !== "situation" ? 1 : 0)
      return {
        requestId: input.requestId,
        practiceId: input.practiceId,
        pointId: point.id,
        scriptVersionId: input.scriptVersionId,
        task: "segment-coach",
        model: modelName,
        promptVersion: SEGMENT_PROMPT_VERSION,
        durationMs: now() - start,
        step: next.step,
        done: next.done,
        message: next.message,
        followupCount,
        followupLimit: FOLLOWUP_LIMIT,
        summary: {
          observations: point.observations.map((o) => ({ type: o.type, label: o.label, measured: o.measured || null, startSecond: point.startSecond, endSecond: point.endSecond, source: "measurement" })),
          location: { ...selection, source: "client-confirmed", note: "사용자가 확인·선택한 위치예요(서버 검증 사실 아님)." },
          userReports: reason ? [{ questionKey: "situation", reason, source: "user" }, ...userReports.filter((u) => u.questionKey !== "situation" || u.text)] : userReports,
          evidence,
          unverified: [...new Set(unverified)],
        },
        ...(modelResult && { modelResult }),
      }
    },
  }
}
