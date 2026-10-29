// 녹음 소리를 16kHz 모노로 줄이고 WAV(16bit PCM)로 만드는 도구. WAV는 어디로든 바로 이동(seek)할 수 있다.

export const TARGET_RATE = 16000

/** 입력 표본을 구간 평균으로 줄인다(입력 → outRate). 조각 단위로 이어서 넣을 수 있다. */
export class Decimator {
  constructor(inRate, outRate = TARGET_RATE) {
    this.step = inRate / outRate
    this.next = this.step
    this.pos = 0
    this.sum = 0
    this.n = 0
  }
  push(input) {
    const out = []
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i]
      this.n++
      this.pos++
      if (this.pos >= this.next) {
        out.push(this.sum / this.n)
        this.sum = 0
        this.n = 0
        this.next += this.step
      }
    }
    return Float32Array.from(out)
  }
}

export function concatFloat32(chunks) {
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Float32Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

export function encodeWavBytes(samples, sampleRate) {
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(bytes)
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, "RIFF")
  v.setUint32(4, 36 + samples.length * 2, true)
  w(8, "WAVE")
  w(12, "fmt ")
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, "data")
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

export function encodeWav(samples, sampleRate) {
  return new Blob([encodeWavBytes(samples, sampleRate)], { type: "audio/wav" })
}

/** encodeWavBytes가 만든 WAV를 다시 읽는다(테스트·검증용). */
export function parseWavBytes(bytes) {
  const v = new DataView(bytes)
  const sampleRate = v.getUint32(24, true)
  const n = v.getUint32(40, true) / 2
  const samples = new Float32Array(n)
  for (let i = 0; i < n; i++) samples[i] = v.getInt16(44 + i * 2, true) / 0x8000
  return { samples, sampleRate }
}
