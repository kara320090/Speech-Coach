// POST /api/scripts/revise-segment — 구간 코칭에서 확인한 대본 문단과 대화를 바탕으로 '그 문단만' 고친 수정안을 돌려준다.
// 질문·대화는 다시 만들지 않는다(/api/coach/segment 결과를 받는다). 글 생성은 기존 /api/coach의 rewrite 과업에 맡겨
// 모델 선택·수치·단위·부정·조건·한계 검사(checkRevision)·인용 검증·동시 처리·타임아웃·취소·오류 처리를 그대로 쓴다.
// 서버는 원본 대본·연습 기록을 바꾸지 않는다. 수정안은 제안이며 적용은 사용자가 확인한 뒤 화면이 새 버전으로 만든다.
// 대본·대화·자료를 저장하거나 로그에 남기지 않는다. 대화 요약은 클라이언트가 보낸 값이라 사실로 단정하지 않는다.
import { createHash } from "node:crypto"
import { CoachError } from "./local-coach.js"
import { splitScript, normalize } from "./script-align.js"

export const REVISION_PROMPT_VERSION = "contextual-revision-v1"
export const REVISION_LIMITS = Object.freeze({
  body: 128 * 1024,
  script: 20_000,
  paragraph: 2400, // 기존 rewrite 대본 한도
  sources: 2400,
  requestText: 400,
  history: 16,
  text: 1000,
  userReports: 12,
  mustPreserve: 10,
  mustPreserveChars: 200,
  context: 600, // 앞뒤 문단 참고 길이(서버가 대본에서 잘라 만든다)
  perClientPerMinute: 10,
})

const ID = /^[\w.:-]{1,80}$/
const REQ = /^[\w-]{1,80}$/
const FOCUS = { "plain-terms": "어려운 용어를 쉬운 말로 풀어 쓰기", "split-sentences": "긴 문장을 말하기 쉽게 나누기", "spoken-style": "소리 내어 말하기 쉬운 구어체로 다듬기" }
// 구간 코칭의 상황 답(reason) → 대본에서 바꿔 볼 수 있는 필요. 기억·쉼은 대본 문제로 보지 않는다.
const REASON_NEEDS = { "concept-confusing": ["plain-terms"], "awkward-sentence": ["split-sentences", "spoken-style"] }
const NOT_SCRIPT = { "intended-pause": "의도한 쉼이라고 답했어요.", "forgot-line": "대사가 기억나지 않았다고 답했어요(대본 문장 자체의 문제로 확인되지 않음)." }

const err = (status, code, message) => new CoachError(status, code, message)
const str = (v, max, field) => {
  if (v === undefined || v === null) return ""
  if (typeof v !== "string" || v.length > max) throw err(400, "invalid-input", `${field}는 ${max}자 이하 문자열이어야 해요.`)
  return v
}
export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex")

/** 대본의 문단(빈 줄로 나뉜 덩어리) 목록: splitScript 문장의 paragraphIndex로 묶고 원문 시작·끝 위치를 쓴다. */
export function paragraphsOf(script) {
  const out = []
  for (const s of splitScript(script)) {
    const p = out[s.paragraphIndex] || (out[s.paragraphIndex] = { index: s.paragraphIndex, start: s.start, end: s.end, sentenceIds: [] })
    p.end = s.end
    p.sentenceIds.push(s.id)
  }
  return out.filter(Boolean).map((p) => ({ ...p, text: script.slice(p.start, p.end) }))
}

export function validateRevisionInput(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw err(400, "invalid-input", "요청 본문은 JSON 객체여야 해요.")
  for (const key of ["requestId", "practiceId"]) if (typeof data[key] !== "string" || !REQ.test(data[key])) throw err(400, "invalid-input", `${key}는 영문·숫자·_- 1~80자여야 해요.`)
  if (typeof data.scriptVersionId !== "string" || !ID.test(data.scriptVersionId)) throw err(400, "invalid-input", "scriptVersionId는 영문·숫자·_-.: 1~80자여야 해요.")
  if (!data.point || typeof data.point.id !== "string" || !ID.test(data.point.id)) throw err(400, "invalid-input", "point.id가 필요해요.")
  const script = str(data.script, REVISION_LIMITS.script, "script")
  if (!script.trim()) throw err(400, "invalid-input", "원본 대본(script)이 필요해요.")
  const sources = str(data.sources, REVISION_LIMITS.sources, "sources").trim()

  // 사용자의 명시적 수정 요청이 있을 때만 진행(모델 호출 조건)
  const r = data.request
  if (!r || r.explicit !== true) throw err(400, "revision-not-requested", "사용자가 '대본 수정'을 직접 요청했을 때만 수정안을 만들어요(request.explicit: true).")
  const focus = Array.isArray(r.focus) ? r.focus : []
  if (focus.some((f) => !Object.hasOwn(FOCUS, f))) throw err(400, "invalid-input", `request.focus는 ${Object.keys(FOCUS).join("·")} 중에서 골라 주세요.`)
  const request = { text: str(r.text, REVISION_LIMITS.requestText, "request.text").trim(), focus: [...new Set(focus)] }

  // 대상 문단: 사용자가 확인·선택한 문단이 대본의 문단 경계와 정확히 같아야 한다
  const t = data.target
  if (!t || typeof t !== "object") throw err(400, "confirmation-required", "수정할 대상 문단(target)이 필요해요.")
  if (!["user-confirmed", "user-selected"].includes(t.confirmation)) throw err(400, "confirmation-required", "사용자가 확인(user-confirmed)하거나 직접 고른(user-selected) 문단만 수정해요.")
  const paragraphs = paragraphsOf(script)
  const para = paragraphs.find((p) => p.index === t.paragraphIndex)
  if (!para || t.start !== para.start || t.end !== para.end || t.text !== para.text || script.slice(t.start, t.end) !== t.text) {
    throw err(400, "target-mismatch", "대상 문단의 번호·원문·시작·끝 위치가 이 대본과 맞지 않아요. 같은 대본 버전으로 다시 선택해 주세요.")
  }
  if (para.text.length > REVISION_LIMITS.paragraph) throw err(413, "too-large", `한 번에 고칠 문단은 ${REVISION_LIMITS.paragraph}자까지예요.`)

  // 반드시 보존할 내용: 대상 문단 안에 실제로 있는 문구만
  const keep = Array.isArray(data.mustPreserve) ? data.mustPreserve : []
  if (keep.length > REVISION_LIMITS.mustPreserve) throw err(413, "too-large", `보존할 내용은 ${REVISION_LIMITS.mustPreserve}개까지예요.`)
  const mustPreserve = keep.map((k, i) => {
    const v = str(k, REVISION_LIMITS.mustPreserveChars, `mustPreserve[${i}]`).trim()
    if (!v || !para.text.includes(v)) throw err(400, "invalid-input", `mustPreserve[${i}]는 대상 문단 안에 있는 문구여야 해요.`)
    return v
  })

  // 구간 코칭 결과(/api/coach/segment의 summary·history). 같은 연습·지점·대본 버전이어야 한다
  const c = data.coaching && typeof data.coaching === "object" ? data.coaching : {}
  const summary = c.summary && typeof c.summary === "object" ? c.summary : {}
  const hist = Array.isArray(c.history) ? c.history : []
  if (hist.length > REVISION_LIMITS.history) throw err(413, "too-large", `대화 이력은 ${REVISION_LIMITS.history}개까지 보내 주세요.`)
  for (const [i, h] of hist.entries()) {
    if (!h || typeof h !== "object") throw err(400, "invalid-input", `coaching.history[${i}] 형식이 맞지 않아요.`)
    if (h.practiceId !== data.practiceId || h.pointId !== data.point.id || h.scriptVersionId !== data.scriptVersionId) throw err(409, "context-mismatch", "다른 연습·구간·대본 버전의 대화가 섞였어요. 이 구간의 대화만 보내 주세요.")
  }
  const loc = summary.location
  if (loc && (typeof loc.sentenceId !== "string" || !para.sentenceIds.includes(loc.sentenceId))) throw err(409, "context-mismatch", "구간 코칭에서 확인한 문장이 대상 문단에 없어요. 대상 문단을 다시 확인해 주세요.")
  const reports = Array.isArray(summary.userReports) ? summary.userReports : []
  if (reports.length > REVISION_LIMITS.userReports) throw err(413, "too-large", `사용자 설명은 ${REVISION_LIMITS.userReports}개까지 보내 주세요.`)
  const userReports = reports.map((u, i) => ({ reason: typeof u?.reason === "string" ? u.reason.slice(0, 40) : null, text: str(u?.text, REVISION_LIMITS.text, `coaching.summary.userReports[${i}].text`).trim() })).filter((u) => u.reason || u.text)
  for (const h of hist) if (h.role === "user" && (h.reason || h.text)) userReports.push({ reason: typeof h.reason === "string" ? h.reason.slice(0, 40) : null, text: str(h.text, REVISION_LIMITS.text, "coaching.history[].text").trim() })
  const observations = (Array.isArray(summary.observations) ? summary.observations : []).slice(0, 8).map((o) => ({ type: typeof o?.type === "string" ? o.type.slice(0, 20) : null, measured: typeof o?.measured === "string" ? o.measured.slice(0, 80) : null }))

  const idx = paragraphs.indexOf(para)
  const clipEnd = (s) => (s.length > REVISION_LIMITS.context ? `…${s.slice(-REVISION_LIMITS.context)}` : s)
  const clipStart = (s) => (s.length > REVISION_LIMITS.context ? `${s.slice(0, REVISION_LIMITS.context)}…` : s)
  return {
    requestId: data.requestId,
    practiceId: data.practiceId,
    pointId: data.point.id,
    scriptVersionId: data.scriptVersionId,
    script,
    sources,
    request,
    mustPreserve,
    target: { paragraphIndex: para.index, start: para.start, end: para.end, text: para.text, confirmation: t.confirmation, sentenceIds: para.sentenceIds },
    before: idx > 0 ? clipEnd(paragraphs[idx - 1].text) : "",
    after: idx < paragraphs.length - 1 ? clipStart(paragraphs[idx + 1].text) : "",
    observations,
    userReports: [...new Map(userReports.map((u) => [`${u.reason}|${u.text}`, u])).values()],
  }
}

/** 대화에서 확인된 필요를 정리한다. 관찰값(침묵 등)은 필요의 근거로 쓰지 않는다. */
export function revisionNeeds(input) {
  const needs = new Map()
  for (const f of input.request.focus) needs.set(f, "user-request")
  for (const u of input.userReports) for (const f of REASON_NEEDS[u.reason] || []) if (!needs.has(f)) needs.set(f, "coaching-answer")
  const notScript = input.userReports.map((u) => u.reason).filter((r) => Object.hasOwn(NOT_SCRIPT, r))
  return { needs: [...needs].map(([id, from]) => ({ id, label: FOCUS[id], from })), notScript: [...new Set(notScript)] }
}

export function createContextualRevision({ coach, now = () => Date.now(), limits = REVISION_LIMITS }) {
  const perClient = new Map()
  function admit(client = "unknown") {
    const t = now()
    const list = (perClient.get(client) || []).filter((x) => x > t - 60_000)
    if (list.length >= limits.perClientPerMinute) throw Object.assign(err(429, "rate-limited", "이 기기의 대본 수정 요청이 많아요. 잠시 뒤에 다시 시도해 주세요."), { retryAfter: Math.max(1, Math.ceil((list[0] + 60_000 - t) / 1000)) })
    list.push(t)
    perClient.set(client, list)
    if (perClient.size > 1000) for (const [k, v] of perClient) if (!v.some((x) => x > t - 60_000)) perClient.delete(k)
  }

  return {
    async run(data, signal, meta = {}) {
      const input = validateRevisionInput(data)
      const start = now()
      const { needs, notScript } = revisionNeeds(input)
      const base = {
        requestId: input.requestId,
        practiceId: input.practiceId,
        pointId: input.pointId,
        scriptVersionId: input.scriptVersionId,
        task: "contextual-revision",
        promptVersion: REVISION_PROMPT_VERSION,
        target: { paragraphIndex: input.target.paragraphIndex, start: input.target.start, end: input.target.end, text: input.target.text, sentenceIds: input.target.sentenceIds, confirmation: input.target.confirmation },
        apply: { baseScriptVersionId: input.scriptVersionId, start: input.target.start, end: input.target.end, originalSha256: sha256(input.target.text), scriptSha256: sha256(input.script), note: "적용 전 현재 대본이 같은 버전이고 이 범위의 원문이 그대로인지 확인한 뒤, 이 범위만 바꾼 새 버전을 만들어 주세요. 서버는 대본을 바꾸지 않아요." },
      }
      const basis = (extra = {}) => ({
        observations: input.observations.map((o) => ({ ...o, source: o.type === "manual" ? "user-selected" : "client-reported-measurement", note: o.type === "manual" ? "사용자가 고른 시점이며 측정 이상이나 원인 근거가 아니에요." : "측정값이며 원인 근거로 쓰지 않았어요." })),
        userReports: input.userReports.map((u) => ({ ...u, source: "user" })),
        inferredNeeds: needs.map((n) => ({ ...n, source: n.from === "user-request" ? "user-request" : "inferred-from-user-answer" })),
        ...extra,
      })
      const respond = (status, fields) => ({ ...base, status, model: "rule", durationMs: now() - start, revision: null, ...fields })

      // 1) 대본을 바꿀 이유가 없거나 불명확하면 모델을 부르지 않는다
      if (!needs.length && !input.request.text) {
        if (notScript.includes("intended-pause")) return respond("no-change-needed", { reasons: [NOT_SCRIPT["intended-pause"], "대본을 바꿀 필요가 확인되지 않아 수정안을 만들지 않았어요."], basis: basis({ evidence: [], unverified: [] }) })
        return respond("needs-confirmation", {
          reasons: [...notScript.map((r) => NOT_SCRIPT[r]), "대화에서 대본을 어떻게 바꿔야 할지 확인되지 않았어요. 바꾸고 싶은 점(용어 풀기·문장 나누기·구어체)이나 요청을 알려 주세요."],
          choices: Object.entries(FOCUS).map(([value, label]) => ({ value, label })),
          basis: basis({ evidence: [], unverified: [] }),
        })
      }

      // 2) 명시적 요청 + 확인된 필요 → 기존 rewrite 과업으로 수정안 생성
      admit(meta.client)
      const requestText = [
        needs.length ? `바꿀 점: ${needs.map((n) => n.label).join(", ")}` : "",
        input.request.text ? `사용자 요청: ${input.request.text}` : "",
        ...input.userReports.filter((u) => u.text).slice(0, 4).map((u) => `연습 중 사용자 설명: ${u.text}`),
        input.mustPreserve.length ? `반드시 그대로 둘 문구: ${input.mustPreserve.map((m) => `"${m}"`).join(", ")}` : "",
      ].filter(Boolean).join("\n").slice(0, 800)
      const versionId = input.scriptVersionId.replace(/[^\w-]/g, "-").slice(0, 80)
      const out = await coach.run({ task: "rewrite", requestId: input.requestId, versionId, script: input.target.text, sources: input.sources, request: requestText, before: input.before, after: input.after }, signal)
      const r = out.result
      const missing = input.mustPreserve.filter((m) => !normalize(r.rewritten).includes(normalize(m)))
      const warnings = [...r.warnings, ...missing.map((m) => `보존할 문구 누락: ${m}`)]
      const preservation = { warnings, blocked: r.blocked || missing.length > 0, reviewRequired: true, mustPreserveMissing: missing, note: "수치·단위·부정·조건·한계·보존 문구만 확인한 보수적 검사예요. 통과해도 전체 의미가 같다고 보장하지 않아요." }
      const evidence = r.sourceQuote ? [{ quote: r.sourceQuote, source: "provided-material" }] : []
      const unverified = []
      if (!input.sources) unverified.push("근거 자료가 없어 풀어 쓴 설명의 정확성을 확인하지 않았어요. 사용자 확인이 필요해요.")
      else if (!r.sourceQuote) unverified.push("수정안의 설명을 뒷받침하는 자료 인용이 없어요. 사용자 확인이 필요해요.")
      unverified.push("대화 요약은 클라이언트가 보낸 값이며 서버가 검증한 사실이 아니에요.")
      if (normalize(r.rewritten) === normalize(input.target.text)) {
        return { ...respond("no-change-needed", { reasons: ["모델이 원문과 같은 문단을 돌려줬어요. 바꿀 부분이 없다고 볼 수 있어요."], basis: basis({ evidence, unverified }) }), model: out.model, durationMs: now() - start }
      }
      return {
        ...base,
        status: "proposed",
        model: out.model,
        durationMs: now() - start,
        revision: { text: r.rewritten.trim(), reason: r.reason, humanReview: "required" },
        appliedUserInputs: [...needs.map((n) => n.label), ...(input.request.text ? [input.request.text] : []), ...input.userReports.filter((u) => u.text).map((u) => u.text)],
        preservation,
        basis: basis({ evidence, unverified }),
      }
    },
  }
}
