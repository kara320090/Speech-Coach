// 시선(얼굴 방향) 추적. MediaPipe 얼굴 랜드마크 모델을 우리 서버(/vendor/mediapipe)에서 받아 이 브라우저 안에서만 돌린다.
// 웹캠 영상은 어디로도 보내지 않는다. 눈동자가 아니라 얼굴 방향으로 어림잡으므로 '화면을 벗어났을 가능성'만 표시한다.

const BASE = "/vendor/mediapipe"

/**
 * 얼굴 랜드마크(정규화 좌표)로 화면을 벗어났는지 판단한다.
 * 33·263: 양 눈 바깥쪽, 1: 코끝, 152: 턱. 코가 두 눈 사이에서 많이 치우치면 고개를 돌린 것으로 본다.
 * 반환: true(벗어남), false(화면을 봄). 얼굴이 없으면 true.
 */
export function isGazeOff(landmarks) {
  if (!landmarks) return true
  const L = landmarks[33]
  const R = landmarks[263]
  const N = landmarks[1]
  const C = landmarks[152]
  if (!L || !R || !N || !C || R.x === L.x) return true
  const yaw = (N.x - L.x) / (R.x - L.x)
  const eyeY = (L.y + R.y) / 2
  const pitch = (N.y - eyeY) / (C.y - eyeY || 1)
  return yaw < 0.28 || yaw > 0.72 || pitch < 0.1 || pitch > 0.64
}

export class GazeTracker {
  constructor() {
    this.status = "idle" // idle | loading | ready | off
    this.landmarker = null
    this.lastTs = 0
  }

  /** 여러 번 불러도 한 번만 받는다. 녹화 시작 전에 이 약속을 기다리면 모델 준비로 화면이 멈추는 일이 녹화 중에 생기지 않는다. */
  load() {
    this.loading ||= this._load()
    return this.loading
  }

  async _load() {
    this.status = "loading"
    try {
      const vision = await import(`${BASE}/vision_bundle.mjs`)
      const files = await vision.FilesetResolver.forVisionTasks(`${BASE}/wasm`)
      const make = (delegate) =>
        vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${BASE}/face_landmarker.task`, delegate },
          runningMode: "VIDEO",
          numFaces: 1,
        })
      this.landmarker = await make("GPU").catch(() => make("CPU"))
      this.status = "ready"
    } catch (e) {
      console.warn("시선 추적을 쓸 수 없어요", e)
      this.status = "off"
    }
    return this.status
  }

  /**
   * 첫 판단은 모델 초기화(셰이더·wasm 준비) 때문에 몇 초씩 화면을 멈출 수 있다.
   * 녹화 전에 한 번 미리 돌려 두면 녹화 중 시계가 건너뛰지 않는다. 여러 번 불러도 한 번만 한다.
   */
  async warmup(video) {
    if (this.warmed || this.status !== "ready" || !video) return
    if (video.readyState < 2) await new Promise((r) => {
      video.addEventListener("loadeddata", r, { once: true })
      setTimeout(r, 2000)
    })
    if (video.readyState < 2) return
    this.sample(video)
    this.warmed = true
  }

  /** 지금 영상 프레임 기준 true/false. 판단할 수 없으면 null. */
  sample(video) {
    if (this.status !== "ready" || !video || video.readyState < 2) return null
    const ts = Math.max(performance.now(), this.lastTs + 1)
    this.lastTs = ts
    try {
      const r = this.landmarker.detectForVideo(video, ts)
      return isGazeOff(r?.faceLandmarks?.[0])
    } catch {
      return null
    }
  }
}
