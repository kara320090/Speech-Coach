// 마이크·웹캠 기록과 브라우저 음성 인식. 녹음은 이 기기 안에서만 처리한다.
import { Decimator, TARGET_RATE, concatFloat32, encodeWav } from "./wav.js"

export function describeMediaError(e) {
  const name = e?.name || ""
  if (name === "NotAllowedError" || name === "SecurityError") return "권한이 거부됐어요"
  if (name === "NotFoundError" || name === "OverconstrainedError") return "연결된 장치를 찾지 못했어요"
  if (name === "NotReadableError" || name === "AbortError") return "다른 앱이 장치를 쓰고 있어요"
  if (e?.message === "timeout") return "권한 요청에 응답이 없었어요"
  return e?.message || "알 수 없는 오류"
}

// 소리 크기로 침묵을 찾으므로, 브라우저가 소리 크기를 자동으로 바꾸지 않도록 끈다.
const AUDIO_CONSTRAINTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    let late = false
    const timer = setTimeout(() => {
      late = true
      reject(new Error("timeout"))
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        if (late) v.getTracks().forEach((t) => t.stop())
        else resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        if (!late) reject(e)
      },
    )
  })
}

export class MediaCapture {
  constructor(stream, status) {
    this.stream = stream
    this.status = status // { audio, video }
    this.level = 0
    this.recording = false
    this.chunks = []
    this.total = 0
    this.quietSamples = 0
    this.vchunks = []
    this.mr = null
  }

  /**
   * 권한을 요청한다. 실패해도 예외를 던지지 않고 notices에 이유를 담아 돌려준다.
   * 반환: { capture: MediaCapture | null, notices: string[], status: { audio, video } }
   */
  static async open({ audio, video, timeoutMs = 20000 }) {
    const notices = []
    const status = { audio: "off", video: "off" }
    if (!audio && !video) return { capture: null, notices, status }
    if (!navigator.mediaDevices?.getUserMedia) {
      status.audio = "failed"
      if (video) status.video = "failed"
      notices.push("이 브라우저는 마이크·카메라 사용을 지원하지 않아요. 시간만 측정해요.")
      return { capture: null, notices, status }
    }
    let stream = null
    const ask = (c) => withTimeout(navigator.mediaDevices.getUserMedia(c), timeoutMs)
    try {
      stream = await ask({ audio: AUDIO_CONSTRAINTS, video: video ? { width: 640, height: 360 } : false })
      status.audio = "ok"
      if (video) status.video = "ok"
    } catch (e) {
      if (video) {
        try {
          stream = await ask({ audio: AUDIO_CONSTRAINTS })
          status.audio = "ok"
          status.video = "failed"
          notices.push(`웹캠을 쓸 수 없어 소리만 기록해요 (${describeMediaError(e)}).`)
        } catch (e2) {
          status.audio = "failed"
          status.video = "failed"
          notices.push(`마이크·웹캠을 쓸 수 없어 녹음 없이 시간만 측정해요 (${describeMediaError(e2)}).`)
        }
      } else {
        status.audio = "failed"
        notices.push(`마이크를 쓸 수 없어 녹음 없이 시간만 측정해요 (${describeMediaError(e)}).`)
      }
    }
    if (!stream) return { capture: null, notices, status }
    return { capture: new MediaCapture(stream, status), notices, status }
  }

  async start() {
    const AC = window.AudioContext || window.webkitAudioContext
    this.ctx = new AC()
    await this.ctx.resume()
    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1)
    this.dec = new Decimator(this.ctx.sampleRate, TARGET_RATE)
    this.proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0)
      let s = 0
      for (let i = 0; i < d.length; i++) s += d[i] * d[i]
      this.level = Math.sqrt(s / d.length)
      if (!this.recording) return
      const out = this.dec.push(d)
      this.chunks.push(out)
      this.total += out.length
      this.quietSamples = this.level < 0.002 ? this.quietSamples + d.length : 0
    }
    const mute = this.ctx.createGain()
    mute.gain.value = 0
    this.source.connect(this.proc)
    this.proc.connect(mute)
    mute.connect(this.ctx.destination)
    if (this.stream.getVideoTracks().length && typeof MediaRecorder !== "undefined") {
      const type = ["video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t))
      try {
        this.mr = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined)
        this.mr.ondataavailable = (e) => e.data?.size && this.vchunks.push(e.data)
        this.mr.start(1000)
      } catch {
        this.mr = null
        this.status.video = "failed"
      }
    }
    this.recording = true
  }

  /** 소리가 약 5초 넘게 거의 들어오지 않았는지. */
  get quietForSec() {
    return this.ctx ? this.quietSamples / this.ctx.sampleRate : 0
  }

  pause() {
    this.recording = false
    if (this.mr?.state === "recording") this.mr.pause()
  }

  resume() {
    this.recording = true
    if (this.mr?.state === "paused") this.mr.resume()
  }

  async stop() {
    this.recording = false
    let videoBlob = null
    if (this.mr && this.mr.state !== "inactive") {
      await new Promise((resolve) => {
        this.mr.onstop = resolve
        this.mr.stop()
      })
    }
    if (this.vchunks.length) videoBlob = new Blob(this.vchunks, { type: "video/webm" })
    try {
      this.proc.disconnect()
      this.source.disconnect()
      await this.ctx.close()
    } catch {
      /* 이미 닫힘 */
    }
    this.stream.getTracks().forEach((t) => t.stop())
    const samples = concatFloat32(this.chunks)
    return { samples, sampleRate: TARGET_RATE, wavBlob: samples.length ? encodeWav(samples, TARGET_RATE) : null, videoBlob }
  }
}

/**
 * 브라우저 음성 인식(한국어). 브라우저에 따라 음성이 외부 인식 서비스로 전송될 수 있어서
 * 사용자가 연습 시작 전에 직접 켠 경우에만 쓴다.
 * status: off | on | unsupported | denied | error
 */
export class SpeechCapture {
  constructor(clock) {
    this.clock = clock // 연습 경과 초를 돌려주는 함수(일시정지 시간 제외)
    this.segments = [] // { id, startSec, endSec, text, final }
    this.byId = new Map()
    this.session = 0
    this.active = false
    this.status = "off"
    this.detail = ""
  }

  static get supported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  }

  start() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Ctor) {
      this.status = "unsupported"
      return
    }
    this.Ctor = Ctor
    this.active = true
    this.status = "on"
    this._begin()
  }

  _begin() {
    if (!this.active) return
    const rec = new this.Ctor()
    this.rec = rec
    const sess = ++this.session
    rec.lang = "ko-KR"
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (ev) => {
      const now = this.clock()
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const id = `${sess}:${i}`
        const text = ev.results[i][0]?.transcript || ""
        let seg = this.byId.get(id)
        if (!seg) {
          seg = { id, startSec: now, endSec: now, text: "", final: false }
          this.byId.set(id, seg)
          this.segments.push(seg)
        }
        seg.text = text
        seg.endSec = now
        seg.final = ev.results[i].isFinal
      }
    }
    rec.onerror = (ev) => {
      if (ev.error === "no-speech" || ev.error === "aborted") return
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        this.status = "denied"
        this.active = false
      } else {
        this.status = "error"
        this.detail = ev.error || ""
      }
    }
    rec.onend = () => {
      if (this.active) {
        try {
          this._begin()
        } catch {
          this.status = "error"
        }
      }
    }
    try {
      rec.start()
    } catch {
      this.status = "error"
      this.active = false
    }
  }

  pause() {
    this.active = false
    try {
      this.rec?.stop()
    } catch {
      /* 이미 멈춤 */
    }
  }

  resume() {
    if (this.status === "denied" || this.status === "unsupported") return
    this.active = true
    this.status = "on"
    this._begin()
  }

  stop() {
    this.active = false
    try {
      this.rec?.stop()
    } catch {
      /* 이미 멈춤 */
    }
    const now = this.clock()
    for (const s of this.segments) if (!s.final) s.endSec = Math.max(s.endSec, Math.min(now, s.endSec))
    return this.segments.filter((s) => s.text.trim()).map(({ startSec, endSec, text }) => ({ startSec, endSec, text }))
  }
}
