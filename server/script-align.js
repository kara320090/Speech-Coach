// POST /api/scripts/align — 영상·녹음의 검토 시점(예: 2:14 긴 침묵)을 앞뒤 전사 구간으로 대본 문장 근처에 연결한다.
// 외부 AI를 부르지 않는다. 텍스트 정규화 + 글자 2-gram 유사도 + 순서(단조 경로) 정보만 쓴다.
// 대본·전사·결과를 저장하거나 로그에 남기지 않고, 원문·연습 기록을 바꾸지 않는다(후보만 돌려준다).
// 점수는 '비슷한 정도(0~1)'일 뿐 확률이나 검증된 정확도가 아니다. 확실하지 않으면 ambiguous·unmatched로 돌려준다.

export const ALGORITHM_VERSION = "script-align-v1"

export const ALIGN_LIMITS = Object.freeze({
  bodyBytes: 256 * 1024,
  scriptChars: 20_000,
  sentences: 400,
  segments: 2000,
  segmentChars: 1000,
  transcriptChars: 60_000,
  points: 100,
  maxSecond: 4 * 3600, // 4시간
  work: 1_000_000, // 전사 구간 수 × 문장 수
})

// 정렬 매개변수(합성 예시로 정한 값이며 실제 발표 데이터로 검증하지 않았다)
const P = Object.freeze({
  minSim: 0.34, // 이보다 낮으면 그 문장과 연결하지 않는다
  nullScore: 0.3, // '대본에 없는 발화'로 볼 때의 기준 점수
  minBigrams: 3, // 이보다 짧은 전사(예: "네", "음")는 연결하지 않는다
  skipPenalty: 0.03, // 문장을 건너뛸 때 문장마다
  backPenalty: 0.35, // 앞 문장으로 되돌아갈 때(반복·다시 읽기)
  ambiguity: 0.12, // 전체 경로 점수 차가 이보다 작으면 다른 후보도 남긴다
  maxGapSecond: 20, // 검토 지점과 앞뒤 전사 사이 최대 간격
  edgeTolerance: 0.25, // 경계 시각 허용 오차(초)
})

/* ───────── 입력 검사 ───────── */

export class AlignError extends Error {
  constructor(status, code, message, field) {
    super(message)
    this.status = status
    this.code = code
    this.field = field
  }
}
const bad = (code, message, field, status = 400) => new AlignError(status, code, message, field)
const ID = /^[\w.:-]{1,80}$/
const isTime = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= ALIGN_LIMITS.maxSecond

export function validateAlignInput(data, limits = ALIGN_LIMITS) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw bad("invalid-input", "요청 본문은 JSON 객체여야 해요.")
  const { script, segments, points, scriptVersionId } = data
  if (typeof scriptVersionId !== "string" || !ID.test(scriptVersionId)) throw bad("invalid-input", "scriptVersionId는 영문·숫자·_-.: 1~80자여야 해요.", "scriptVersionId")
  if (typeof script !== "string") throw bad("invalid-input", "script는 문자열이어야 해요.", "script")
  if (script.length > limits.scriptChars) throw bad("too-large", `대본은 ${limits.scriptChars.toLocaleString("en-US")}자까지 처리해요.`, "script", 413)
  if (!script.trim()) throw bad("empty-script", "대본이 비어 있어요.", "script")
  if (!Array.isArray(segments)) throw bad("invalid-input", "segments는 배열이어야 해요.", "segments")
  if (segments.length > limits.segments) throw bad("too-large", `전사 구간은 ${limits.segments}개까지 처리해요.`, "segments", 413)
  if (!Array.isArray(points) || !points.length) throw bad("invalid-input", "points에 검토 지점을 1개 이상 넣어 주세요.", "points")
  if (points.length > limits.points) throw bad("too-large", `검토 지점은 한 번에 ${limits.points}개까지 처리해요.`, "points", 413)
  let chars = 0
  const segs = segments.map((s, i) => {
    if (!s || typeof s !== "object") throw bad("invalid-input", `segments[${i}] 형식이 맞지 않아요.`, `segments[${i}]`)
    if (typeof s.text !== "string" || s.text.length > limits.segmentChars) throw bad("invalid-input", `segments[${i}].text는 ${limits.segmentChars}자 이하 문자열이어야 해요.`, `segments[${i}].text`)
    if (!isTime(s.startSecond) || !isTime(s.endSecond) || s.endSecond < s.startSecond) throw bad("invalid-time", `segments[${i}]의 시간(startSecond ≤ endSecond, 0~${limits.maxSecond}초)이 올바르지 않아요.`, `segments[${i}]`)
    chars += s.text.length
    return { index: i, startSecond: s.startSecond, endSecond: s.endSecond, text: s.text }
  })
  if (chars > limits.transcriptChars) throw bad("too-large", `전사 글자 수는 합계 ${limits.transcriptChars.toLocaleString("en-US")}자까지 처리해요.`, "segments", 413)
  const ids = new Set()
  const pts = points.map((p, i) => {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !ID.test(p.id)) throw bad("invalid-input", `points[${i}].id는 영문·숫자·_-.: 1~80자여야 해요.`, `points[${i}].id`)
    if (ids.has(p.id)) throw bad("duplicate-point-id", `검토 지점 id '${p.id}'가 중복됐어요.`, `points[${i}].id`)
    ids.add(p.id)
    if (!isTime(p.startSecond) || !isTime(p.endSecond) || p.endSecond < p.startSecond) throw bad("invalid-time", `points[${i}]의 시간(startSecond ≤ endSecond, 0~${limits.maxSecond}초)이 올바르지 않아요.`, `points[${i}]`)
    return { id: p.id, startSecond: p.startSecond, endSecond: p.endSecond }
  })
  return { script, scriptVersionId, segments: segs.sort((a, b) => a.startSecond - b.startSecond || a.index - b.index), points: pts }
}

/* ───────── 대본 나누기·정규화·유사도 ───────── */

/**
 * 대본을 문장으로 나누고 원문 시작·끝 위치(UTF-16 인덱스, end는 미포함)를 보존한다.
 * 나누는 기준은 화면의 splitSentences(public/js/coach.js)와 같다: 마침표·물음표·느낌표 뒤 공백, 줄바꿈.
 * 빈 줄로 나뉜 덩어리를 문단(paragraphIndex)으로 본다.
 */
export function splitScript(script) {
  const out = []
  let paragraph = 0
  const re = /(?<=[.?!。])[ \t\u00a0]+|[ \t\u00a0]*\n\s*/g
  let last = 0
  const push = (from, to) => {
    const raw = script.slice(from, to)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text) out.push({ id: `s${out.length + 1}`, index: out.length, paragraphIndex: paragraph, text, start: from + lead, end: from + lead + text.length })
  }
  for (const m of script.matchAll(re)) {
    push(last, m.index)
    if ((m[0].match(/\n/g) || []).length >= 2) paragraph++ // 빈 줄 = 새 문단
    last = m.index + m[0].length
  }
  push(last, script.length)
  return out
}

/** 비교용 정규화: 호환 문자 통일, 소문자, 글자·숫자만 남김(띄어쓰기·문장부호 차이 무시). */
export function normalize(text) {
  return String(text).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}

function bigrams(text) {
  const t = normalize(text)
  const m = new Map()
  if (t.length === 1) m.set(t, 1)
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    m.set(g, (m.get(g) || 0) + 1)
  }
  let n = 0
  for (const v of m.values()) n += v
  return { m, n }
}

/**
 * 전사 구간 a와 대본 문장 b의 유사도(0~1). 확률이 아니다.
 * 전사가 문장 일부만 말한 경우를 위해 포함 비율(겹친 2-gram ÷ 전사 2-gram)과 Dice 계수를 섞는다.
 */
export function similarity(a, b) {
  if (!a.n || !b.n) return 0
  let inter = 0
  for (const [g, c] of a.m) inter += Math.min(c, b.m.get(g) || 0)
  const contain = inter / a.n
  const dice = (2 * inter) / (a.n + b.n)
  return Math.round((0.6 * contain + 0.4 * dice) * 1000) / 1000
}

/* ───────── 전사 구간 ↔ 문장 정렬(순서 고려) ───────── */

/**
 * 전사 구간마다 문장 하나(또는 '대본에 없음')를 고르는 단조 경로를 찾는다(Viterbi).
 * 상태 j = '지금 대본의 j번째 문장 근처'. 각 구간은 그 문장으로 연결(유사도)하거나 대본에 없는 발화(nullScore)로 볼 수 있다.
 * 앞으로 건너뛰면 문장마다 skipPenalty, 뒤로 되돌아가면(반복) backPenalty를 뺀다.
 * forward·backward를 함께 계산해 '이 구간을 문장 j로 볼 때의 최선 전체 점수'를 얻고, 최선과 차이가 작은 다른 문장을 후보로 남긴다.
 */
export function alignSegments(segments, sentences) {
  const K = segments.length
  const N = sentences.length
  const sb = sentences.map((s) => bigrams(s.text))
  const E = [] // E[k][j]: 연결 점수(연결 불가면 -Infinity)
  const sims = []
  for (const seg of segments) {
    const a = bigrams(seg.text)
    const row = new Float64Array(N)
    const e = new Float64Array(N)
    for (let j = 0; j < N; j++) {
      row[j] = a.n >= P.minBigrams ? similarity(a, sb[j]) : 0
      e[j] = row[j] >= P.minSim ? row[j] : -Infinity
    }
    sims.push(row)
    E.push(e)
  }
  const best = (k, j) => Math.max(E[k][j], P.nullScore) // 그 상태에서 연결 또는 '대본에 없음'
  const trans = (from, to) => (to >= from ? -P.skipPenalty * Math.max(0, to - from - 1) : -P.backPenalty)

  // 전이 최대값을 O(N)으로 구한다: to ≥ from(앞으로/제자리)과 to < from(되돌아감)을 나눠 계산.
  function relax(prev) {
    const out = new Float64Array(N).fill(-Infinity)
    let prefix = -Infinity // max_{i ≤ j-2} prev[i] + skip*i
    const suffixBack = new Float64Array(N + 1).fill(-Infinity) // max_{i > j} prev[i]
    for (let i = N - 1; i >= 0; i--) suffixBack[i] = Math.max(suffixBack[i + 1], prev[i])
    for (let j = 0; j < N; j++) {
      if (j >= 2) prefix = Math.max(prefix, prev[j - 2] + P.skipPenalty * (j - 2))
      let v = prev[j] // 제자리
      if (j >= 1) v = Math.max(v, prev[j - 1]) // 다음 문장
      if (j >= 2) v = Math.max(v, prefix - P.skipPenalty * (j - 1)) // 건너뜀
      v = Math.max(v, suffixBack[j + 1] - P.backPenalty) // 되돌아감
      out[j] = v
    }
    return out
  }
  // backward용: 다음 상태 값 next[j']에서 현재 j로 오는 최대값
  function relaxBack(next) {
    const out = new Float64Array(N).fill(-Infinity)
    const sufFwd = new Float64Array(N + 2).fill(-Infinity) // max_{j' ≥ j+2} next[j'] - skip*j'
    for (let jp = N - 1; jp >= 0; jp--) sufFwd[jp] = Math.max(sufFwd[jp + 1], next[jp] - P.skipPenalty * jp)
    let prefBack = -Infinity // max_{j' < j} next[j']
    for (let j = 0; j < N; j++) {
      let v = next[j]
      if (j + 1 < N) v = Math.max(v, next[j + 1])
      if (j + 2 < N) v = Math.max(v, sufFwd[j + 2] + P.skipPenalty * (j + 1))
      v = Math.max(v, prefBack - P.backPenalty)
      prefBack = Math.max(prefBack, next[j])
      out[j] = v
    }
    return out
  }

  if (!K || !N) return segments.map((s) => ({ index: s.index, status: "none", sentenceIndex: null, score: 0, alternatives: [] }))
  const F = []
  let f = new Float64Array(N)
  for (let j = 0; j < N; j++) f[j] = best(0, j) - P.skipPenalty * j // 앞부분을 건너뛰고 시작할 수도 있다
  F.push(f)
  for (let k = 1; k < K; k++) {
    const r = relax(F[k - 1])
    f = new Float64Array(N)
    for (let j = 0; j < N; j++) f[j] = r[j] + best(k, j)
    F.push(f)
  }
  const B = new Array(K)
  B[K - 1] = new Float64Array(N) // 뒷부분은 건너뛰어도 벌점 없음
  for (let k = K - 2; k >= 0; k--) {
    const nx = new Float64Array(N)
    for (let j = 0; j < N; j++) nx[j] = B[k + 1][j] + best(k + 1, j)
    B[k] = relaxBack(nx)
  }
  return segments.map((seg, k) => {
    // 상태 j에서 '연결'했을 때와 '대본에 없음'으로 봤을 때의 전체 점수
    const prior = (j) => F[k][j] - best(k, j)
    let top = -Infinity
    const match = []
    let nullTotal = -Infinity
    for (let j = 0; j < N; j++) {
      const base = prior(j) + B[k][j]
      nullTotal = Math.max(nullTotal, base + P.nullScore)
      if (E[k][j] > -Infinity) {
        const total = base + E[k][j]
        match.push({ j, total })
        top = Math.max(top, total)
      }
    }
    if (!match.length || nullTotal >= top) return { index: seg.index, status: "none", sentenceIndex: null, score: 0, alternatives: [], reason: match.length ? "order-or-weak" : "no-similar-sentence" }
    match.sort((a, b) => b.total - a.total || a.j - b.j)
    const chosen = match[0]
    const close = match.filter((m) => m.j !== chosen.j && chosen.total - m.total < P.ambiguity)
    const weak = top - nullTotal < P.ambiguity / 2 // '대본에 없음'과 큰 차이가 없음
    return {
      index: seg.index,
      status: close.length ? "ambiguous" : weak ? "weak" : "clear",
      sentenceIndex: chosen.j,
      score: sims[k][chosen.j],
      alternatives: close.map((m) => ({ sentenceIndex: m.j, score: sims[k][m.j] })),
    }
  })
}

/* ───────── 검토 지점 연결 ───────── */

const REASON = {
  "spoken-during": "검토 지점 안의 전사 구간이 이 문장과 비슷해요.",
  "same-sentence": "지점 앞뒤 발화가 같은 문장에 연결돼요(문장 중간에서 멈춤).",
  "next-sentence": "지점 앞 발화가 앞 문장, 뒤 발화가 다음 문장에 연결돼요(문장 사이).",
  "skipped-between": "지점 앞뒤 발화 사이에 전사에서 찾지 못한 문장이 있어요(생략됐을 수 있음).",
  "went-back": "지점 뒤 발화가 앞쪽 문장에 연결돼요(다시 읽기·반복일 수 있음).",
  "before-only": "지점 앞 발화만 대본에 연결돼요. 뒤쪽 근거가 없어 위치를 확정하지 않았어요.",
  "after-only": "지점 뒤 발화만 대본에 연결돼요. 앞쪽 근거가 없어 위치를 확정하지 않았어요.",
  "end-of-script": "마지막 문장을 말한 뒤의 지점이에요.",
  "start-of-script": "첫 문장을 말하기 전의 지점이에요.",
  "duplicate-sentence": "같거나 비슷한 문장이 대본에 여러 번 있어 어느 것인지 확정하지 않았어요.",
  "inconsistent-context": "앞뒤 발화가 서로 먼 문장에 연결돼 위치를 확정하지 않았어요.",
  "weak-similarity": "비슷한 문장이 있지만 '대본에 없는 발화'와 점수 차가 작아 확정하지 않았어요.",
  "no-nearby-transcript": `지점 앞뒤 ${P.maxGapSecond}초 안에 전사 구간이 없어요.`,
  "speech-not-in-script": "근처 발화가 대본 문장과 충분히 비슷하지 않아요(대본에 없는 말·바꿔 말하기일 수 있음).",
  "no-transcript": "전사 구간이 없어요.",
}
const reason = (code) => ({ code, message: REASON[code] })

export function alignPoints(input) {
  const sentences = splitScript(input.script)
  if (sentences.length > ALIGN_LIMITS.sentences) throw bad("too-large", `대본 문장은 ${ALIGN_LIMITS.sentences}개까지 처리해요.`, "script", 413)
  if (input.segments.length * sentences.length > ALIGN_LIMITS.work) throw bad("too-large", "전사 구간 수와 대본 문장 수가 너무 많아요. 구간을 나누어 보내 주세요.", "segments", 413)
  const aligned = alignSegments(input.segments, sentences)
  const byIndex = new Map(aligned.map((a) => [a.index, a]))
  const segView = (s) => s && { index: s.index, startSecond: s.startSecond, endSecond: s.endSecond, text: s.text, alignment: view(byIndex.get(s.index)) }
  const sentView = (j, role, score = null) => ({ sentenceId: sentences[j].id, index: j, paragraphIndex: sentences[j].paragraphIndex, text: sentences[j].text, start: sentences[j].start, end: sentences[j].end, role, score })
  function view(a) {
    if (!a) return null
    return { status: a.status, sentenceId: a.sentenceIndex === null ? null : sentences[a.sentenceIndex].id, score: a.score, alternatives: a.alternatives.map((x) => ({ sentenceId: sentences[x.sentenceIndex].id, score: x.score })) }
  }
  const segs = input.segments

  const points = input.points.map((p) => {
    const tol = P.edgeTolerance
    const during = segs.filter((s) => s.startSecond < p.endSecond - tol && s.endSecond > p.startSecond + tol)
    const beforeSeg = [...segs].reverse().find((s) => s.endSecond <= p.startSecond + tol && !during.includes(s) && p.startSecond - s.endSecond <= P.maxGapSecond) || null
    const afterSeg = segs.find((s) => s.startSecond >= p.endSecond - tol && !during.includes(s) && s.startSecond - p.endSecond <= P.maxGapSecond) || null
    const base = {
      pointId: p.id,
      scriptVersionId: input.scriptVersionId,
      startSecond: p.startSecond,
      endSecond: p.endSecond,
      algorithmVersion: ALGORITHM_VERSION,
      transcript: { during: during.map(segView), before: segView(beforeSeg), after: segView(afterSeg), gapBeforeSecond: beforeSeg ? round(p.startSecond - beforeSeg.endSecond) : null, gapAfterSecond: afterSeg ? round(afterSeg.startSecond - p.endSecond) : null },
    }
    const out = (status, position, candidates, reasons, extra = {}) => ({ ...base, status, position, primarySentenceId: status === "matched" ? candidates[0]?.sentenceId ?? null : null, candidates, reasons, ...extra })
    const al = (s) => s && byIndex.get(s.index)
    const ok = (a) => a && (a.status === "clear")

    if (!segs.length) return out("unmatched", "unknown", [], [reason("no-transcript")])

    // 1) 지점 안에 발화가 있으면(반복·속도 변화 등) 그 발화가 연결된 문장
    const dAl = during.map(al).filter((a) => a && a.status !== "none")
    if (dAl.length) {
      const amb = dAl.filter((a) => a.status !== "clear")
      const idx = [...new Set(dAl.map((a) => a.sentenceIndex))].sort((x, y) => x - y)
      const cands = idx.map((j) => sentView(j, "spoken-during", Math.max(...dAl.filter((a) => a.sentenceIndex === j).map((a) => a.score))))
      if (amb.length) {
        const alt = amb.flatMap((a) => a.alternatives.map((x) => x.sentenceIndex)).filter((j) => !idx.includes(j))
        return out("ambiguous", "within", [...cands, ...[...new Set(alt)].map((j) => sentView(j, "alternative"))], [reason(amb.some((a) => a.status === "ambiguous") ? "duplicate-sentence" : "weak-similarity")])
      }
      if (idx[idx.length - 1] - idx[0] <= 1) return out("matched", "within", cands, [reason("spoken-during")])
      return out("ambiguous", "within", cands, [reason("inconsistent-context")])
    }

    // 2) 침묵처럼 지점 안에 발화가 없으면 앞뒤 발화로 위치를 정한다(구간 안 단어별 시간은 만들지 않는다)
    const bA = al(beforeSeg)
    const aA = al(afterSeg)
    if (!beforeSeg && !afterSeg) return out("unmatched", "unknown", [], [reason("no-nearby-transcript")])
    const usable = (a) => a && a.status !== "none"
    if (!usable(bA) && !usable(aA)) return out("unmatched", "unknown", [], [reason("speech-not-in-script")])
    const ambiguousCtx = [bA, aA].filter((a) => usable(a) && !ok(a))
    if (ambiguousCtx.length) {
      const set = new Set()
      for (const a of ambiguousCtx) [a.sentenceIndex, ...a.alternatives.map((x) => x.sentenceIndex)].forEach((j) => set.add(j))
      for (const a of [bA, aA]) if (ok(a)) set.add(a.sentenceIndex)
      return out("ambiguous", "unknown", [...set].sort((x, y) => x - y).map((j) => sentView(j, "alternative")), [reason(ambiguousCtx.some((a) => a.status === "ambiguous") ? "duplicate-sentence" : "weak-similarity")])
    }
    const i = ok(bA) ? bA.sentenceIndex : null
    const j = ok(aA) ? aA.sentenceIndex : null
    const N = sentences.length
    if (i !== null && j !== null) {
      const before = sentView(i, "before-point", bA.score)
      const after = sentView(j, "after-point", aA.score)
      if (j === i) return out("matched", "within", [{ ...before, role: "around-point" }], [reason("same-sentence")])
      if (j === i + 1) return out("matched", "between", [after, before], [reason("next-sentence")])
      if (j > i + 1 && j - i <= 4) return out("matched", "between", [after, before], [reason("skipped-between")], { skippedSentenceIds: sentences.slice(i + 1, j).map((s) => s.id) })
      if (j < i && i - j <= 2) return out("matched", "between", [after, before], [reason("went-back")])
      return out("ambiguous", "unknown", [before, after], [reason("inconsistent-context")])
    }
    if (i !== null) {
      if (i === N - 1 && !afterSeg) return out("matched", "after-last", [sentView(i, "before-point", bA.score)], [reason("end-of-script")])
      return out("ambiguous", "unknown", [sentView(i, "before-point", bA.score), ...(i + 1 < N ? [sentView(i + 1, "alternative")] : [])], [reason("before-only")])
    }
    if (j === 0 && !beforeSeg) return out("matched", "before-first", [sentView(j, "after-point", aA.score)], [reason("start-of-script")])
    return out("ambiguous", "unknown", [...(j > 0 ? [sentView(j - 1, "alternative")] : []), sentView(j, "after-point", aA.score)], [reason("after-only")])
  })

  return {
    scriptVersionId: input.scriptVersionId,
    algorithmVersion: ALGORITHM_VERSION,
    scoreNote: "score는 글자 2-gram 기반 유사도(0~1)이며 확률이나 검증된 정확도가 아니에요.",
    sentences,
    segments: segs.map((s) => ({ index: s.index, startSecond: s.startSecond, endSecond: s.endSecond, alignment: view(byIndex.get(s.index)) })),
    points,
  }
}

const round = (n) => Math.round(n * 1000) / 1000

/* ───────── HTTP 처리기 ───────── */

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) return null
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

/** server.js에 연결하는 처리기. 오류는 { error, message, field? } 모양이다. */
export function createScriptAlignHandler({ sendJson, limits = ALIGN_LIMITS }) {
  return async function handleScriptAlign(req, res) {
    const fail = (e) => sendJson(res, e.status || 400, { error: e.code || "invalid-input", message: e.message, ...(e.field && { field: e.field }) })
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return fail(bad("content-type", "application/json 형식으로 보내 주세요.", null, 415))
    const declared = Number(req.headers["content-length"])
    if (Number.isFinite(declared) && declared > limits.bodyBytes) {
      res.setHeader("Connection", "close")
      return fail(bad("too-large", `요청 본문은 ${limits.bodyBytes / 1024}KB까지 처리해요.`, null, 413))
    }
    const body = await readBody(req, limits.bodyBytes)
    if (!body) return fail(bad("too-large", `요청 본문은 ${limits.bodyBytes / 1024}KB까지 처리해요.`, null, 413))
    let data
    try {
      data = JSON.parse(body.toString("utf8"))
    } catch {
      return fail(bad("invalid-json", "JSON을 읽지 못했어요."))
    }
    try {
      sendJson(res, 200, alignPoints(validateAlignInput(data, limits)))
    } catch (e) {
      fail(e instanceof AlignError ? e : bad("align-failed", "연결을 계산하지 못했어요.", null, 500))
    }
  }
}
