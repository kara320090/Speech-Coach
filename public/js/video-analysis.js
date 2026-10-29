import { analyzeBlinks, blinkSample, BLINK_RULES } from "./blinks.js"

export const VISION_ROOT = "/vendor/mediapipe/0.10.32"
const MAX_ANALYSIS_MS = 10 * 60 * 1000
const aborted = () => new DOMException("분석을 취소했어요.", "AbortError")

function waitEvent(target, name, action, signal, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); target.removeEventListener(name, done); target.removeEventListener("error", fail); signal?.removeEventListener("abort", cancel) }
    const done = () => { clean(); resolve() }
    const fail = () => { clean(); reject(new Error("이 브라우저에서 영상 프레임을 읽지 못했어요.")) }
    const cancel = () => { clean(); reject(aborted()) }
    const timer = setTimeout(() => { clean(); reject(new Error("영상 프레임을 읽는 시간이 너무 길어 분석을 중단했어요.")) }, timeout)
    target.addEventListener(name, done, { once: true }); target.addEventListener("error", fail, { once: true }); signal?.addEventListener("abort", cancel, { once: true })
    if (signal?.aborted) return cancel()
    try { action() } catch (e) { clean(); reject(e) }
  })
}

// 모델/런타임은 같은 서버의 고정 파일만 읽는다. 얼굴·프레임을 전송하거나 저장하지 않는다.
export async function createBlinkDetector() {
  const { FaceLandmarker, FilesetResolver } = await import(`${VISION_ROOT}/vision_bundle.mjs`)
  const files = await FilesetResolver.forVisionTasks(`${VISION_ROOT}/wasm`)
  return FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${VISION_ROOT}/face_landmarker.task`, delegate: "CPU" },
    runningMode: "VIDEO", numFaces: 2, outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  })
}

/** 소리 트랙이 없는 영상도 불러올 수 있도록 길이와 영상 존재를 별도로 확인한다. */
export async function readVideoDuration(blob) {
  const video = document.createElement("video"), url = URL.createObjectURL(blob)
  video.muted = true; video.preload = "auto"
  try {
    await waitEvent(video, "loadeddata", () => { video.src = url; video.load() })
    if (video.duration === Infinity) await waitEvent(video, "seeked", () => { video.currentTime = 1e7 })
    if (!video.videoWidth || !Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 1800) throw new Error("30분 이하의 재생 가능한 영상이 필요해요.")
    return video.duration
  } finally { video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url) }
}

/** 별도 영상 요소를 순서대로 탐색한다. 동기 추론 사이에 양보해 취소·진행 표시를 처리한다. */
export async function analyzeVideoBlinks(blob, { signal, onProgress = () => {}, detectorFactory = createBlinkDetector } = {}) {
  if (!blob) return { status: "unavailable", reason: "기록된 영상이 없어요.", items: [] }
  if (typeof document === "undefined" || typeof WebAssembly === "undefined") return { status: "unavailable", reason: "이 브라우저는 영상 분석을 지원하지 않아요.", items: [] }
  let detector, video, objectUrl
  const started = Date.now()
  try {
    if (signal?.aborted) throw aborted()
    video = document.createElement("video")
    video.muted = true; video.playsInline = true; video.preload = "auto"
    objectUrl = URL.createObjectURL(blob)
    await waitEvent(video, "loadeddata", () => { video.src = objectUrl; video.load() }, signal)
    if (video.duration === Infinity) await waitEvent(video, "seeked", () => { video.currentTime = 1e7 }, signal)
    const duration = video.duration
    if (!video.videoWidth || !Number.isFinite(duration) || duration <= 0 || duration > 1800) throw new Error("영상이 없거나 길이를 읽지 못했어요. 30분 이하의 지원되는 영상 파일을 사용해 주세요.")
    onProgress(0, duration, "모델을 읽는 중이에요…")
    // 로딩 시간 제한. 늦게 완료된 모델도 닫아 메모리를 해제한다.
    let expired = false, timer, onAbort
    const loading = Promise.resolve().then(detectorFactory).then((d) => { if (expired || signal?.aborted) { d.close(); throw aborted() }; return d })
    try {
      detector = await Promise.race([loading, new Promise((_, reject) => {
        onAbort = () => { expired = true; reject(aborted()) }
        signal?.addEventListener("abort", onAbort, { once: true })
        if (signal?.aborted) return onAbort()
        timer = setTimeout(() => { expired = true; reject(new Error("모델 로딩 시간이 초과됐어요.")) }, 60000)
      })])
    } catch (e) {
      if (e.name === "AbortError") throw e
      throw new Error("눈 깜빡임 모델을 불러오지 못했어요. 파일 연결 또는 브라우저 지원을 확인해 주세요.")
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort) }
    const samples = []
    for (let i = 0; i / BLINK_RULES.sampleHz < duration; i++) {
      if (signal?.aborted) throw aborted()
      if (Date.now() - started > MAX_ANALYSIS_MS) throw new Error("분석이 10분을 넘어서 중단했어요. 영상을 짧게 나눠서 시도해 주세요.")
      const sec = i / BLINK_RULES.sampleHz
      if (Math.abs(video.currentTime - sec) > 0.001) await waitEvent(video, "seeked", () => { video.currentTime = sec }, signal)
      samples.push(blinkSample(detector.detectForVideo(video, sec * 1000), sec))
      if (i % 10 === 0) onProgress(sec, duration, "눈 깜빡임을 세는 중이에요…")
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    onProgress(duration, duration, "분석을 마쳤어요.")
    return analyzeBlinks(samples, duration)
  } catch (e) {
    return { status: e?.name === "AbortError" ? "cancelled" : "unavailable", reason: e?.message || "이 브라우저에서 눈 깜빡임을 분석하지 못했어요.", items: [] }
  } finally {
    detector?.close()
    if (video) { video.removeAttribute("src"); video.load() }
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
