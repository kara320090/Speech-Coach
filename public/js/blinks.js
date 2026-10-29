// DOM/MediaPipe와 독립된 측정 규칙. 점수·정서 판정·일반인 기준은 사용하지 않는다.
export const BLINK_RULES = Object.freeze({
  version: 1, sampleHz: 20, windowSec: 10,
  close: 0.6, open: 0.35, minClosedSec: 0.04, maxClosedSec: 0.8,
  refractorySec: 0.15, maxGapSec: 0.15,
  minCoverage: 0.7, minObservedSec: 5, minBaselineSec: 20,
  increaseRatio: 2, minExtraPerMin: 12, minWindowCount: 3,
})

const score = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1

/** 얼굴이 정확히 하나이고 두 눈 계수가 있는 프레임만 사용한다. 랜드마크는 보관하지 않는다. */
export function blinkSample(result, sec) {
  const faces = result?.faceBlendshapes
  const categories = faces?.length === 1 ? faces[0]?.categories : []
  const left = categories?.find((c) => c.categoryName === "eyeBlinkLeft")?.score
  const right = categories?.find((c) => c.categoryName === "eyeBlinkRight")?.score
  return { sec, left: score(left) ? left : null, right: score(right) ? right : null }
}

/** samples: 시간순 {sec,left,right}. 누락·긴 공백에서는 깜빡임 상태를 초기화한다. */
export function analyzeBlinks(samples, durationSec) {
  const r = BLINK_RULES
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 1800) {
    return { status: "unavailable", reason: "영상 길이를 확인하지 못했거나 30분을 넘었어요.", count: null, rate: null, windows: [], items: [] }
  }
  const windows = Array.from({ length: Math.ceil(durationSec / r.windowSec) }, (_, i) => ({
    startSec: i * r.windowSec, endSec: Math.min(durationSec, (i + 1) * r.windowSec), observedSec: 0, count: 0,
  }))
  const points = []
  for (const s of samples) if (Number.isFinite(s.sec) && s.sec >= 0 && s.sec < durationSec && (!points.length || s.sec > points.at(-1).sec)) points.push(s)
  let lastTime = -Infinity, closedAt = null, armed = false, lastBlink = -Infinity
  const events = []
  for (let i = 0; i < points.length; i++) {
    const s = points[i]
    if (s.sec <= lastTime) continue
    if (s.sec - lastTime > r.maxGapSec) { armed = false; closedAt = null }
    lastTime = s.sec
    if (!score(s.left) || !score(s.right)) { armed = false; closedAt = null; continue }
    // 샘플 하나의 유효 시간은 최대 1/sampleHz초. 건너뛴 시간은 인식 성공으로 채우지 않는다.
    let cursor = s.sec
    const next = points[i + 1]?.sec ?? durationSec
    const end = Math.min(durationSec, s.sec + 1 / r.sampleHz, next > s.sec ? next : s.sec)
    while (cursor < end - 1e-9) {
      const w = windows[Math.floor(cursor / r.windowSec)]
      const stop = Math.min(end, w.endSec)
      w.observedSec += stop - cursor
      cursor = stop
    }
    const open = s.left <= r.open && s.right <= r.open
    const closed = s.left >= r.close && s.right >= r.close
    if (closedAt !== null && s.sec - closedAt > r.maxClosedSec) { closedAt = null; armed = false }
    if (open) {
      if (closedAt !== null) {
        const length = s.sec - closedAt
        if (length >= r.minClosedSec - 1e-9 && length <= r.maxClosedSec && closedAt - lastBlink >= r.refractorySec) {
          events.push(closedAt)
          windows[Math.floor(closedAt / r.windowSec)].count++
          lastBlink = closedAt
        }
      }
      closedAt = null
      armed = true
    } else if (closed && armed && closedAt === null) {
      closedAt = s.sec
      armed = false
    }
  }
  const observedSec = windows.reduce((sum, w) => sum + w.observedSec, 0)
  const missingRatio = Math.max(0, Math.min(1, 1 - observedSec / durationSec))
  const usable = observedSec >= r.minObservedSec - 1e-6 && 1 - missingRatio >= r.minCoverage - 1e-6
  for (const w of windows) {
    w.coverage = Math.min(1, w.observedSec / (w.endSec - w.startSec))
    w.usable = usable && w.observedSec >= r.minObservedSec - 1e-6 && w.coverage >= r.minCoverage - 1e-6
    w.rate = w.usable ? w.count * 60 / w.observedSec : null
    if (!w.usable) w.count = null
  }
  const items = []
  let baselineAvailable = false
  if (usable) for (const w of windows.filter((x) => x.usable)) {
    const others = windows.filter((x) => x !== w && x.usable)
    const otherSec = others.reduce((sum, x) => sum + x.observedSec, 0)
    if (otherSec < r.minBaselineSec - 1e-6) continue
    baselineAvailable = true
    const baseline = others.reduce((sum, x) => sum + x.count, 0) * 60 / otherSec
    w.baselineRate = baseline
    if (w.count < r.minWindowCount || w.rate < baseline * r.increaseRatio || w.rate - baseline < r.minExtraPerMin) continue
    items.push({
      type: "blink", title: "눈 깜빡임이 다른 구간보다 많은 구간", startSec: w.startSec, endSec: w.endSec,
      measured: `${w.count}회 / 얼굴 측정 ${w.observedSec.toFixed(1)}초 = 분당 ${w.rate.toFixed(1)}회, 다른 구간 평균 ${baseline.toFixed(1)}회/분`,
      basis: `${r.windowSec}초 구간. 이번 영상의 다른 측정 가능 구간(${otherSec.toFixed(1)}초) 평균의 ${r.increaseRatio}배 이상이며 분당 ${r.minExtraPerMin}회 이상 증가, 최소 ${r.minWindowCount}회. 양쪽 눈 계수 ≥${r.close} 후 ≤${r.open}로 돌아올 때 1회. 평소 기준·정서 판정이 아니에요.`,
    })
  }
  return {
    status: usable ? "ok" : "unavailable", version: r.version, rules: r,
    reason: usable ? "" : `얼굴 측정 시간이 ${r.minObservedSec}초 미만이거나 전체의 ${r.minCoverage * 100}% 미만이에요.`,
    durationSec, observedSec, missingRatio, count: usable ? events.length : null,
    rate: usable ? events.length * 60 / observedSec : null, windows, items, baselineAvailable,
  }
}
