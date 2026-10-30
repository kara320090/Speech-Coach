// 영상·소리 파일 불러오기: 브라우저 안에서 소리만 꺼내고(영상은 서버로 보내지 않는다), 글자 변환용 조각으로 나눈다.
import { TARGET_RATE, encodeWavBytes } from "./wav.js"

export const MAX_FILE_BYTES = 300 * 1024 * 1024
export const MAX_DURATION_SEC = 30 * 60
export const CHUNK_TARGET_SEC = 20 // 조각 길이의 목표. 말이 끊기지 않게 가장 조용한 곳에서 자른다.
export const CHUNK_SEARCH_SEC = 5 // 목표 길이 앞뒤 이 범위 안에서 가장 조용한 곳을 찾는다.

/** 파일을 16kHz 모노 표본으로 풀어낸다. 못 풀면 이유를 담은 Error를 던진다. */
export async function decodeToMono16k(file, { AudioContextCtor = window.AudioContext || window.webkitAudioContext } = {}) {
  if (!AudioContextCtor) throw new Error("이 브라우저는 소리 파일을 풀어내는 기능을 지원하지 않아요.")
  if (file.size > MAX_FILE_BYTES) throw new Error(`파일이 너무 커요. ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB 이하 파일을 골라 주세요.`)
  const ctx = new AudioContextCtor({ sampleRate: TARGET_RATE })
  try {
    let buffer
    try {
      buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    } catch {
      throw new Error("이 브라우저가 이 파일의 소리를 읽지 못했어요. 소리가 없는 영상이거나 지원하지 않는 형식일 수 있어요. mp4(AAC), m4a, mp3, wav 파일을 써 보세요.")
    }
    if (buffer.length === 0) throw new Error("파일에 소리가 들어 있지 않아요.")
    if (buffer.duration > MAX_DURATION_SEC) throw new Error(`너무 길어요. ${MAX_DURATION_SEC / 60}분 이하로 잘라서 불러와 주세요.`)
    const out = new Float32Array(buffer.length)
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels
    }
    return { samples: out, sampleRate: buffer.sampleRate, durationSec: buffer.length / buffer.sampleRate }
  } finally {
    ctx.close?.().catch?.(() => {})
  }
}

/**
 * 글자 변환용 조각 나누기. 각 조각은 목표 길이 앞뒤 범위에서 소리가 가장 작은 100ms 지점에서 끝난다.
 * 반환: [{ index, startSec, endSec, startIdx, endIdx }]
 */
export function planChunks(samples, sampleRate, { targetSec = CHUNK_TARGET_SEC, searchSec = CHUNK_SEARCH_SEC } = {}) {
  const total = samples.length
  const frame = Math.max(1, Math.round(sampleRate * 0.1))
  const chunks = []
  let start = 0
  while (start < total) {
    let end = start + Math.round(targetSec * sampleRate)
    if (end + Math.round(searchSec * sampleRate) >= total) end = total
    else {
      const from = Math.max(start + frame, end - Math.round(searchSec * sampleRate))
      const to = Math.min(total - frame, end + Math.round(searchSec * sampleRate))
      let best = end
      let bestRms = Infinity
      for (let f = from; f + frame <= to; f += frame) {
        let s = 0
        for (let i = f; i < f + frame; i++) s += samples[i] * samples[i]
        const rms = Math.sqrt(s / frame)
        if (rms < bestRms) {
          bestRms = rms
          best = f + Math.floor(frame / 2)
        }
      }
      end = best
    }
    chunks.push({ index: chunks.length, startSec: start / sampleRate, endSec: end / sampleRate, startIdx: start, endIdx: end })
    start = end
  }
  return chunks
}

/** 서버 응답(구간 정보가 있으면 그것, 없으면 조각 전체)을 파일 전체 시간 기준의 글 조각으로 바꾼다. */
export function chunkSegments(chunk, resp) {
  const len = chunk.endSec - chunk.startSec
  const out = []
  for (const s of Array.isArray(resp?.segments) ? resp.segments : []) {
    const number = (v) => (typeof v === "number" || (typeof v === "string" && v.trim())) ? Number(v) : NaN
    const a = number(s?.startSecond ?? s?.start)
    const b = number(s?.endSecond ?? s?.end)
    const text = typeof s?.text === "string" ? s.text.trim() : ""
    if (text && Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= a && b <= len + 1) {
      out.push({ startSec: chunk.startSec + Math.min(a, len), endSec: chunk.startSec + Math.min(b, len), text, ...((s.timingPrecision === "chunk" || resp.timingPrecision === "chunk") ? { timingPrecision: "chunk" } : {}) })
    }
  }
  if (out.length) return out.sort((a, b) => a.startSec - b.startSec)
  const text = String(resp?.text || "").trim()
  return text ? [{ startSec: chunk.startSec, endSec: chunk.endSec, text, timingPrecision: "chunk" }] : []
}

/**
 * 조각을 서버로 보내 글자로 바꾼다(최대 concurrency개 동시). 영상은 보내지 않고 이 조각들만 보낸다.
 * 반환: { status: "ok" | "partial" | "not-configured" | "limit" | "error", segments, failed: [조각 번호], message }
 */
export async function transcribeChunks(samples, chunks, { fetchFn = fetch, concurrency = 3, onProgress = () => {}, signal } = {}) {
  const results = new Array(chunks.length).fill(null)
  const failed = []
  let fatal = null
  let done = 0
  let next = 0
  async function one(chunk) {
    const wav = new Blob([encodeWavBytes(samples.subarray(chunk.startIdx, chunk.endIdx), TARGET_RATE)], { type: "audio/wav" })
    let res
    try {
      res = await fetchFn("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav, signal })
    } catch (e) {
      if (signal?.aborted) throw e
      return null // 유료 전사를 자동으로 다시 보내지 않는다.
    }
    const body = await res.json().catch(() => ({}))
    if (res.ok) return body
    if (body.error === "not-configured") throw Object.assign(new Error(body.message), { fatal: "not-configured" })
    if (res.status === 429) throw Object.assign(new Error(body.message || "사용 한도에 걸렸어요."), { fatal: "limit" })
    if (["gateway-auth", "provider-auth", "provider-billing", "provider-model", "invalid-model"].includes(body.error)) throw Object.assign(new Error(body.message), { fatal: "error" })
    return null
  }

  async function worker() {
    while (!fatal) {
      const i = next++
      if (i >= chunks.length) return
      try {
        const body = await one(chunks[i])
        if (body) results[i] = chunkSegments(chunks[i], body)
        else failed.push(i)
      } catch (e) {
        if (e.fatal) fatal = { status: e.fatal, message: e.message }
        else throw e
      }
      done++
      onProgress(done, chunks.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker))
  if (fatal) return { status: fatal.status, segments: [], failed: [], message: fatal.message }
  failed.sort((a, b) => a - b)
  const segments = results.flat().filter(Boolean)
  return { status: failed.length ? "partial" : "ok", segments, failed, message: failed.length ? `${chunks.length}개 조각 중 ${failed.length}개를 글자로 바꾸지 못했어요.` : "" }
}
