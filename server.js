// 외부 패키지 없이 public/ 폴더의 정적 파일, /__health, 글자 변환 중계(/api/transcribe)를 제공하는 서버.
// 녹음·영상·분석은 브라우저 안에서 처리한다. 사용자가 '글자로 변환'을 직접 켠 경우에만 영상에서 꺼낸 소리 조각(WAV)이
// /api/transcribe를 거쳐 AI Gateway의 음성 인식 모델로 전송된다. 영상 파일 자체는 서버로 오지 않는다.
import http from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public")
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // 마이크·카메라는 이 사이트에서만 쓴다. 'wasm-unsafe-eval'은 시선 추적(자체 포함한 MediaPipe WebAssembly)에 필요하다.
  "Permissions-Policy": "microphone=(self), camera=(self)",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
}

const NOT_FOUND_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>페이지를 찾을 수 없어요</title></head><body><main><h1>페이지를 찾을 수 없어요</h1><p><a href="/">발표 연습 코치 첫 화면으로 가기</a></p></main></body></html>`

const DEFAULT_GATEWAY_URL = "https://ai-gateway.vercel.sh"
const DEFAULT_MODEL = "google/gemini-3.5-transcribe"
const MAX_BODY_BYTES = 4 * 1024 * 1024 // 16kHz 모노 WAV 약 2분
const DEFAULT_TOTAL_SECONDS = 3600 // 서버가 켜져 있는 동안 변환할 수 있는 소리 길이의 합(팀 예산 보호)
const WAV_BYTES_PER_SEC = 16000 * 2

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...HEADERS })
  res.end(JSON.stringify(body))
}

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

/** 게이트웨이가 준 구간 정보에서 글자와 시간만 숫자로 정리한다. 모양이 다르면 빈 목록. */
function cleanSegments(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const s of raw) {
    const text = typeof s?.text === "string" ? s.text.trim() : ""
    const startSecond = Number(s?.startSecond ?? s?.start)
    const endSecond = Number(s?.endSecond ?? s?.end)
    if (text && Number.isFinite(startSecond) && Number.isFinite(endSecond) && endSecond >= startSecond) out.push({ text, startSecond, endSecond })
  }
  return out
}

export function createServer({ releaseId = process.env.RELEASE_ID || "dev", env = process.env, fetchImpl = fetch } = {}) {
  let transcribedSeconds = 0
  const totalLimit = Number(env.TRANSCRIBE_TOTAL_SECONDS) > 0 ? Number(env.TRANSCRIBE_TOTAL_SECONDS) : DEFAULT_TOTAL_SECONDS

  async function transcribe(req, res) {
    const apiKey = env.AI_GATEWAY_API_KEY
    if (!apiKey) return sendJson(res, 503, { error: "not-configured", message: "서버에 AI_GATEWAY_API_KEY가 설정되어 있지 않아서 글자 변환을 쓸 수 없어요." })
    const body = await readBody(req, MAX_BODY_BYTES)
    if (!body) return sendJson(res, 413, { error: "too-large", message: "보낸 소리 조각이 너무 길어요." })
    const isWav = body.length > 44 && body.toString("latin1", 0, 4) === "RIFF" && body.toString("latin1", 8, 12) === "WAVE"
    if (!isWav) return sendJson(res, 415, { error: "not-wav", message: "WAV 소리 조각만 받을 수 있어요." })
    const seconds = (body.length - 44) / WAV_BYTES_PER_SEC
    if (transcribedSeconds + seconds > totalLimit) return sendJson(res, 429, { error: "budget", message: "이 서버가 글자로 바꿀 수 있는 소리 길이 한도에 도달했어요." })
    transcribedSeconds += seconds
    let upstream
    try {
      upstream = await fetchImpl(`${(env.AI_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/+$/, "")}/v4/ai/transcription-model`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "ai-gateway-protocol-version": "0.0.1",
          "ai-transcription-model-specification-version": "4",
          "ai-model-id": env.TRANSCRIBE_MODEL || DEFAULT_MODEL,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ audio: body.toString("base64"), mediaType: "audio/wav" }),
        signal: AbortSignal.timeout(90_000),
      })
    } catch {
      transcribedSeconds -= seconds
      return sendJson(res, 502, { error: "gateway-unreachable", message: "음성 인식 서비스에 연결하지 못했어요." })
    }
    if (!upstream.ok) {
      transcribedSeconds -= seconds
      if (upstream.status === 401 || upstream.status === 403) return sendJson(res, 502, { error: "gateway-auth", message: "음성 인식 서비스가 키를 받아들이지 않았어요. 키와 팀 접근 권한을 확인해 주세요." })
      if (upstream.status === 429) return sendJson(res, 429, { error: "gateway-limit", message: "음성 인식 서비스의 사용 한도에 걸렸어요. 잠시 뒤에 다시 해 주세요." })
      return sendJson(res, 502, { error: "gateway-error", status: upstream.status, message: "음성 인식 서비스가 오류를 돌려줬어요." })
    }
    let data
    try {
      data = await upstream.json()
    } catch {
      return sendJson(res, 502, { error: "gateway-error", message: "음성 인식 서비스의 응답을 읽지 못했어요." })
    }
    sendJson(res, 200, {
      text: typeof data?.text === "string" ? data.text : "",
      segments: cleanSegments(data?.segments),
      language: typeof data?.language === "string" ? data.language : null,
      durationInSeconds: Number.isFinite(Number(data?.durationInSeconds)) ? Number(data.durationInSeconds) : null,
    })
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost")
      if (url.pathname === "/api/transcribe") {
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST", ...HEADERS })
          return res.end()
        }
        return await transcribe(req, res)
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", ...HEADERS })
        return res.end()
      }
      if (url.pathname === "/__health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...HEADERS })
        return res.end(JSON.stringify({ status: "ok", releaseId }))
      }
      let rel = decodeURIComponent(url.pathname)
      if (rel.endsWith("/")) rel += "index.html"
      const file = path.normalize(path.join(ROOT, rel))
      if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return notFound(res)
      const data = await fs.readFile(file).catch(() => null)
      if (!data) return notFound(res)
      const type = MIME[path.extname(file)] || "application/octet-stream"
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", ...HEADERS })
      res.end(req.method === "HEAD" ? undefined : data)
    } catch {
      res.writeHead(400, HEADERS)
      res.end()
    }
  })
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", ...HEADERS })
  res.end(NOT_FOUND_HTML)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000)
  createServer().listen(port, "0.0.0.0", () => console.log(`listening on :${port}`))
}
