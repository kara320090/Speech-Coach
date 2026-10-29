// 연습 결과 분석. 모든 판정은 아래 상수와 계산식을 화면에도 그대로 보여 준다.
// 속도 단위: 분당 음절(한글 음절 글자 수 ÷ 시간(분)). 쉼도 시간에 포함한다.
import { formatClock, formatKorean, formatSigned } from "./time.js"
import { analyzeFillers } from "./fillers.js"

export const SILENCE_MIN_SEC = 3 // 이 시간 이상 소리가 기준 이하면 '긴 침묵'
export const SPEED_WINDOW_SEC = 10 // 속도를 재는 구간 길이
export const SPEED_DEVIATION = 0.3 // 평균 대비 이 비율 이상 벗어나면 '속도 변화'
export const SPEED_MIN_SYLLABLES = 3 // 이보다 말이 적은 구간은 속도 판단에서 제외
export const REPEAT_WINDOW_SEC = 30
export const REPEAT_MIN_COUNT = 3
export const LIVE_SPEED_WINDOW_SEC = 20 // 실시간 속도는 최근 이 시간 기준
export const MIN_SIGNAL_RMS = 0.003 // 이보다 작으면 마이크 소리가 거의 없는 것으로 본다

/* ───────── 목표 시간과의 차이 ───────── */

/** kind: over | early | within | exact */
export function classifyResult(totalSec, targetSec, toleranceSec = 0) {
  const diffSec = Math.floor(totalSec + 1e-9) - Math.round(targetSec)
  const tol = Math.max(0, Math.round(toleranceSec))
  let kind
  let label
  if (diffSec === 0) {
    kind = "exact"
    label = "목표 시간과 같아요"
  } else if (Math.abs(diffSec) <= tol) {
    kind = "within"
    label = `허용 오차(±${tol}초) 안이에요 (목표보다 ${formatKorean(diffSec)} ${diffSec > 0 ? "길어요" : "짧아요"})`
  } else if (diffSec > 0) {
    kind = "over"
    label = `목표보다 ${formatKorean(diffSec)} 초과했어요`
  } else {
    kind = "early"
    label = `목표보다 ${formatKorean(diffSec)} 일찍 끝났어요`
  }
  return { diffSec, kind, label }
}

/* ───────── 소리 기반: 긴 침묵 ───────── */

/**
 * samples: -1~1 범위 모노 표본. 100ms 프레임의 RMS로 소리 크기를 본다.
 * 기준 = 이 녹음의 하위 10% 크기 + (상위 10% − 하위 10%) × 0.2
 */
export function analyzeSilence(samples, sampleRate, { minSec = SILENCE_MIN_SEC } = {}) {
  const frameLen = Math.round(sampleRate * 0.1)
  const frames = Math.floor(samples.length / frameLen)
  if (frames < 10) return { status: "too-short", segments: [] }
  const rms = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0
    for (let i = f * frameLen; i < (f + 1) * frameLen; i++) s += samples[i] * samples[i]
    rms[f] = Math.sqrt(s / frameLen)
  }
  const sorted = Float32Array.from(rms).sort()
  const p10 = sorted[Math.floor(frames * 0.1)]
  const p90 = sorted[Math.min(frames - 1, Math.floor(frames * 0.9))]
  if (p90 < MIN_SIGNAL_RMS) return { status: "no-signal", segments: [], p90 }
  const threshold = p10 + (p90 - p10) * 0.2
  const segments = []
  let start = -1
  const push = (endFrame) => {
    const startSec = (start * frameLen) / sampleRate
    const endSec = (endFrame * frameLen) / sampleRate
    if (endSec - startSec >= minSec) segments.push({ startSec, endSec, lengthSec: endSec - startSec })
  }
  for (let f = 0; f < frames; f++) {
    if (rms[f] < threshold) {
      if (start < 0) start = f
    } else if (start >= 0) {
      push(f)
      start = -1
    }
  }
  if (start >= 0) push(frames)
  let voiced = 0
  for (let f = 0; f < frames; f++) if (rms[f] >= threshold) voiced++
  return { status: "ok", segments, threshold, p10, p90, voicedRatio: voiced / frames }
}

/* ───────── 음성 인식 글 기반: 속도·반복 ───────── */

export function countSyllables(text) {
  let n = 0
  for (const ch of String(text)) {
    const c = ch.codePointAt(0)
    if (c >= 0xac00 && c <= 0xd7a3) n++
  }
  return n
}

export function tokenize(text) {
  return String(text)
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
}

/** 최근 windowSec초 동안의 분당 음절. 구간 안에 걸친 비율만큼만 센다. */
export function liveRate(segments, nowSec, windowSec = LIVE_SPEED_WINDOW_SEC) {
  if (nowSec < windowSec / 2) return { status: "measuring" }
  const from = Math.max(0, nowSec - windowSec)
  const span = nowSec - from
  let syl = 0
  for (const s of segments) {
    const a = Math.max(s.startSec, from)
    const b = Math.min(s.endSec, nowSec)
    const len = s.endSec - s.startSec
    const n = countSyllables(s.text)
    if (len <= 0) {
      if (s.startSec >= from && s.startSec <= nowSec) syl += n
    } else if (b > a) syl += (n * (b - a)) / len
  }
  return { status: "ok", rate: Math.round((syl / span) * 60), windowSec: span }
}

export function analyzeTranscript(segments, durationSec) {
  const fillers = analyzeFillers(segments, durationSec)
  const withText = segments.filter((s) => countSyllables(s.text) > 0 || tokenize(s.text).length > 0)
  const totalSyllables = withText.reduce((a, s) => a + countSyllables(s.text), 0)
  if (!withText.length || totalSyllables === 0 || durationSec <= 0) {
    return { status: "no-text", items: [], windows: [], fillers }
  }
  const overallRate = totalSyllables / (durationSec / 60)

  // 구간별 속도
  const numWin = Math.ceil(durationSec / SPEED_WINDOW_SEC)
  const windows = []
  for (let i = 0; i < numWin; i++) {
    const startSec = i * SPEED_WINDOW_SEC
    const endSec = Math.min(durationSec, startSec + SPEED_WINDOW_SEC)
    windows.push({ startSec, endSec, syllables: 0 })
  }
  for (const s of withText) {
    const n = countSyllables(s.text)
    const len = s.endSec - s.startSec
    if (len <= 0) {
      const w = windows[Math.min(numWin - 1, Math.floor(s.startSec / SPEED_WINDOW_SEC))]
      w.syllables += n
      continue
    }
    for (const w of windows) {
      const ov = Math.min(w.endSec, s.endSec) - Math.max(w.startSec, s.startSec)
      if (ov > 0) w.syllables += (n * ov) / len
    }
  }
  for (const w of windows) w.rate = (w.syllables / (w.endSec - w.startSec)) * 60
  const evaluated = windows.filter((w) => w.endSec - w.startSec >= SPEED_WINDOW_SEC / 2 && w.syllables >= SPEED_MIN_SYLLABLES)
  const items = []
  let meanWindowRate = null
  if (evaluated.length >= 3) {
    meanWindowRate = evaluated.reduce((a, w) => a + w.rate, 0) / evaluated.length
    let run = null
    const flush = () => {
      if (!run) return
      const avg = run.ws.reduce((a, w) => a + w.rate, 0) / run.ws.length
      const pct = Math.round(((avg - meanWindowRate) / meanWindowRate) * 100)
      items.push({
        type: "speed",
        title: run.dir > 0 ? "속도가 빨라진 구간" : "속도가 느려진 구간",
        startSec: run.ws[0].startSec,
        endSec: run.ws[run.ws.length - 1].endSec,
        basis: `${SPEED_WINDOW_SEC}초 구간별 속도가 평균(${Math.round(meanWindowRate)}음절/분)보다 ${Math.round(SPEED_DEVIATION * 100)}% 이상 ${run.dir > 0 ? "빨랐어요" : "느렸어요"}.`,
        measured: `${Math.round(avg)}음절/분 (평균 대비 ${pct > 0 ? "+" : ""}${pct}%)`,
      })
      run = null
    }
    for (const w of windows) {
      const ok = evaluated.includes(w)
      const dev = ok ? (w.rate - meanWindowRate) / meanWindowRate : 0
      if (ok && Math.abs(dev) >= SPEED_DEVIATION) {
        const dir = dev > 0 ? 1 : -1
        if (run && run.dir === dir) run.ws.push(w)
        else {
          flush()
          run = { dir, ws: [w] }
        }
      } else flush()
    }
    flush()
  }

  // 반복 표현: 어절마다 시간을 구간 안에 고르게 배분해 추정한다
  const words = []
  for (const s of withText) {
    const toks = tokenize(s.text)
    toks.forEach((t, i) => words.push({ text: t, sec: s.startSec + (i / toks.length) * Math.max(0, s.endSec - s.startSec) }))
  }
  const flagged = new Set()
  for (let i = 0; i < words.length; ) {
    let j = i
    while (j + 1 < words.length && words[j + 1].text === words[i].text) j++
    const count = j - i + 1
    if (count >= 2) {
      flagged.add(words[i].text)
      items.push({
        type: "repeat",
        title: `같은 말을 이어서 반복: "${words[i].text}"`,
        startSec: words[i].sec,
        endSec: words[j].sec,
        basis: `같은 어절이 바로 이어서 ${count}번 나왔어요.`,
        measured: `${formatClock(words[i].sec)}부터 ${count}번`,
      })
    }
    i = j + 1
  }
  const byWord = new Map()
  for (const w of words) {
    if (w.text.length < 2 || flagged.has(w.text)) continue
    if (!byWord.has(w.text)) byWord.set(w.text, [])
    byWord.get(w.text).push(w.sec)
  }
  for (const [text, times] of byWord) {
    for (let i = 0; i < times.length; ) {
      let j = i
      while (j + 1 < times.length && times[j + 1] - times[i] <= REPEAT_WINDOW_SEC) j++
      const count = j - i + 1
      if (count >= REPEAT_MIN_COUNT) {
        items.push({
          type: "repeat",
          title: `자주 반복한 말: "${text}"`,
          startSec: times[i],
          endSec: times[j],
          basis: `같은 어절이 ${REPEAT_WINDOW_SEC}초 안에 ${REPEAT_MIN_COUNT}번 이상 나왔어요. 필요한 반복인지는 직접 판단해 주세요.`,
          measured: `${formatClock(times[i])}부터 ${count}번`,
        })
        i = j + 1
      } else i++
    }
  }
  return { status: "ok", totalSyllables, overallRate, meanWindowRate, windows, items, fillers }
}

/* ───────── 검토할 구간 모으기 ───────── */

export function buildReviewItems({ silence, transcript, blink, sectionRows = [], toleranceSec = 0 }) {
  const items = []
  if (silence?.status === "ok") {
    for (const s of silence.segments) {
      items.push({
        type: "silence",
        title: "긴 침묵",
        startSec: s.startSec,
        endSec: s.endSec,
        basis: `소리 크기가 기준 이하인 상태가 ${SILENCE_MIN_SEC}초 이상 이어졌어요. 기준 = 이 녹음의 하위 10% 크기 + (상위 10% − 하위 10%) × 0.2`,
        measured: `${s.lengthSec.toFixed(1)}초 (${formatClock(s.startSec)}~${formatClock(s.endSec)}), 기준 RMS ${silence.threshold.toFixed(4)}`,
      })
    }
  }
  if (transcript?.status === "ok") items.push(...transcript.items)
  if (transcript?.fillers?.status === "ok") items.push(...transcript.fillers.items)
  if (blink?.status === "ok") items.push(...blink.items)
  const tol = Math.max(0, Math.round(toleranceSec))
  for (const r of sectionRows) {
    if (r.actualSec === null || r.startSec === null) continue
    const diff = Math.round(r.diffSec)
    if (Math.abs(diff) <= tol || diff === 0) continue
    items.push({
      type: "section",
      title: `${diff > 0 ? "계획보다 길어진" : "계획보다 짧아진"} 구간: ${r.title}`,
      startSec: r.startSec,
      endSec: r.endSec,
      basis: `직접 누른 '다음 구간' 시점으로 잰 시간이 계획과 달라요${r.status === "ended-during" ? " (연습 종료까지를 이 구간으로 봤어요)" : ""}.`,
      measured: `계획 ${formatClock(r.planSec)}, 실제 ${formatClock(r.actualSec)} (${formatSigned(diff)})`,
    })
  }
  items.sort((a, b) => a.startSec - b.startSec)
  return items.map((it, i) => ({ id: i + 1, ...it }))
}

/* ───────── 같은 조건 비교 ───────── */

export function conditionKey(targetSec, planSignature) {
  return `${targetSec}#${planSignature}`
}

/**
 * 이전·이번 연습의 측정값을 그대로 나란히 놓는다. 점수나 개선율은 만들지 않는다.
 * 측정하지 못한 값은 '비교 불가'와 이유를 적는다.
 */
export function compareSessions(prev, cur) {
  const rows = []
  const sec = (v) => `${formatClock(v)}`
  rows.push({ label: "총 연습 시간", prev: sec(prev.totalSec), cur: sec(cur.totalSec), delta: formatSigned(cur.totalSec - prev.totalSec) })
  const pd = prev.result.diffSec
  const cd = cur.result.diffSec
  rows.push({ label: "목표와의 차이", prev: formatSigned(pd), cur: formatSigned(cd), delta: `${formatSigned(Math.abs(cd) - Math.abs(pd))} (절댓값 기준)` })
  const pr = prev.analysis?.transcript?.status === "ok" ? prev.analysis.transcript.overallRate : null
  const cr = cur.analysis?.transcript?.status === "ok" ? cur.analysis.transcript.overallRate : null
  if (pr !== null && cr !== null) {
    rows.push({ label: "평균 속도(음절/분)", prev: String(Math.round(pr)), cur: String(Math.round(cr)), delta: `${Math.round(cr - pr) >= 0 ? "+" : ""}${Math.round(cr - pr)}` })
  } else {
    rows.push({ label: "평균 속도(음절/분)", prev: pr === null ? "측정 못 함" : String(Math.round(pr)), cur: cr === null ? "측정 못 함" : String(Math.round(cr)), delta: "비교 불가 (두 연습 모두 음성 인식으로 측정돼야 해요)" })
  }
  const pItems = prev.analysis?.items
  const cItems = cur.analysis?.items
  if (pItems && cItems && prev.media.audio === "ok" && cur.media.audio === "ok") {
    const count = (arr, t) => arr.filter((x) => x.type === t).length
    for (const [t, name] of [["silence", "긴 침묵"], ["repeat", "반복 표현"], ["speed", "속도 변화"], ["section", "구간 시간 차이"]]) {
      if (t === "repeat" || t === "speed") {
        if (!(prev.media.speech === "ok" && cur.media.speech === "ok")) {
          rows.push({ label: `검토 구간: ${name}`, prev: "측정 못 함", cur: "측정 못 함", delta: "비교 불가 (두 연습 모두 음성 인식이 필요해요)" })
          continue
        }
      }
      const a = count(pItems, t)
      const b = count(cItems, t)
      rows.push({ label: `검토 구간: ${name}`, prev: `${a}개`, cur: `${b}개`, delta: `${b - a >= 0 ? "+" : ""}${b - a}개` })
    }
  } else {
    rows.push({ label: "검토할 구간 수", prev: "-", cur: "-", delta: "비교 불가 (두 연습 모두 소리를 기록해야 해요)" })
  }
  for (const r of cur.sectionRows || []) {
    const p = (prev.sectionRows || []).find((x) => x.title === r.title)
    if (!p || p.actualSec === null || r.actualSec === null) continue
    rows.push({ label: `구간 '${r.title}' 실제 시간`, prev: sec(p.actualSec), cur: sec(r.actualSec), delta: formatSigned(r.actualSec - p.actualSec) })
  }
  return rows
}
