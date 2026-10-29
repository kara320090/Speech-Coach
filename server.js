// Node 22: base coaching/STT use local models; opted-in script generation/support dialogue use Gemini.
import http from "node:http"
import fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createScriptImportHandler } from "./server/script-import.js"
import { createScriptAlignHandler } from "./server/script-align.js"
import { createSegmentCoach, SEGMENT_LIMITS } from "./server/segment-coach.js"
import { createSupportCoach } from "./server/support-coach.js"
import { createContextualRevision, REVISION_LIMITS } from "./server/contextual-revision.js"

import { CoachError, LIMITS } from "./server/local-coach.js"
import { createCoach, createScriptGenerator, createTranscriber, usesGateway } from "./server/coach-provider.js"
import { createAgentBroker } from "./server/agent-broker.js"

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
  // 고정한 같은 출처 MediaPipe WASM 컴파일만 허용. JS unsafe-eval/외부 CDN/외부 전송은 열지 않는다.
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
}

const NOT_FOUND_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>페이지를 찾을 수 없어요</title></head><body><main><h1>페이지를 찾을 수 없어요</h1><p><a href="/">발표 연습 코치 첫 화면으로 가기</a></p></main></body></html>`

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...HEADERS })
  res.end(JSON.stringify(body))
}

/** 호출량 제한용 요청자 구분. 프록시(Render 등) 뒤에서는 X-Forwarded-For의 첫 주소를 쓴다(조작 가능해 보조 제한으로만 쓴다). */
function clientId(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown"
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

export function createServer({ releaseId = process.env.RELEASE_ID || "dev", env = process.env, fetchImpl = fetch, importLimits, runtime, agentPublicKey, healthReady = () => true } = {}) {
  // Gateway 모드는 팀원 PC 에이전트 없이 주최 측 Gateway로 직접 호출한다.
  const agentMode = !usesGateway(env) && (env.AI_EXECUTION_MODE === "agent" || env.RENDER === "true")
  const broker = agentMode ? createAgentBroker(agentPublicKey || JSON.parse(readFileSync(new URL("./server/agent-public-key.json", import.meta.url), "utf8")).publicKey) : null
  const inferenceEnv = broker ? { ...env, AI_PROVIDER: "local", LOCAL_LLM_URL: "http://127.0.0.1:8088", LOCAL_STT_URL: "http://127.0.0.1:8081", LOCAL_MODEL_NAME: "speech-coach" } : env
  const inferenceFetch = broker ? broker.fetch : fetchImpl
  const coach = createCoach({ env: inferenceEnv, fetchImpl: inferenceFetch })
  const segmentCoach = createSegmentCoach({ coach })
  const segmentRevision = createContextualRevision({ coach })
  const generator = createScriptGenerator({ env, fetchImpl })
  const supportCoach = createSupportCoach({ env, fetchImpl })
  const transcriber = createTranscriber({ env: inferenceEnv, fetchImpl: inferenceFetch })
  const frontendOrigins = new Set(["https://speech-coach-public.vercel.app", ...(env.FRONTEND_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean)])
  const importScript = createScriptImportHandler({ sendJson, ...(importLimits && { limits: importLimits }) })
  const alignScript = createScriptAlignHandler({ sendJson })

  async function api(req, res, pathname) {
    const controller = new AbortController()
    const abort = () => { if (!res.writableEnded) controller.abort() }
    res.on("close", abort)
    try {
      if (pathname === "/api/model-status") {
        if (req.method !== "GET") return sendJson(res, 405, { error: "method" })
        const managed = runtime?.snapshot() || broker?.snapshot()
        return sendJson(res, 200, { ...await coach.status(), transcriptionConfigured: transcriber.configured, transcription: transcriber.status(), ...(managed && { runtime: managed }) })
      }
      if (pathname === "/api/scripts/generation-status") {
        if (req.method !== "GET") return sendJson(res, 405, { error: "method" })
        return sendJson(res, 200, await generator.status())
      }
      if (pathname === "/api/coach/support-status") {
        if (req.method !== "GET") return sendJson(res, 405, { error: "method" })
        return sendJson(res, 200, await supportCoach.status())
      }
      if (req.method !== "POST") return sendJson(res, 405, { error: "method" })
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host && !frontendOrigins.has(req.headers.origin)) return sendJson(res, 403, { error: "origin", message: "이 페이지에서 시작한 요청만 처리할 수 있어요." })
      if (pathname === "/api/transcribe") {
        const body = await readBody(req, 4 * 1024 * 1024)
        const result = await transcriber.run(body, controller.signal)
        if (!res.destroyed) sendJson(res, result.status, result.body)
        return
      }
      if (!(req.headers["content-type"] || "").startsWith("application/json")) return sendJson(res, 415, { error: "content-type", message: "JSON 형식으로 보내 주세요." })
      const body = await readBody(req, pathname === "/api/coach/segment" ? SEGMENT_LIMITS.body : pathname === "/api/coach/support" ? 64 * 1024 : pathname === "/api/scripts/revise-segment" ? REVISION_LIMITS.body : LIMITS.body)
      if (!body) return sendJson(res, 413, { error: "too-large", message: "입력이 너무 커요. 짧은 구간으로 나누어 주세요." })
      let data
      try { data = JSON.parse(body.toString("utf8")) } catch { return sendJson(res, 400, { error: "invalid-json", message: "요청을 읽지 못했어요." }) }
      const service = pathname === "/api/scripts/generate" ? generator : pathname === "/api/coach/support" ? supportCoach : pathname === "/api/coach/segment" ? segmentCoach : pathname === "/api/scripts/revise-segment" ? segmentRevision : coach
      const result = await service.run(data, controller.signal, { client: clientId(req) })
      if (!res.destroyed) sendJson(res, 200, result)
    } catch (e) {
      if (e?.retryAfter && !res.headersSent) res.setHeader("Retry-After", String(e.retryAfter))
      if (!res.destroyed) sendJson(res, e instanceof CoachError ? e.status : 400, { error: e instanceof CoachError ? e.code : "invalid-request", message: e instanceof CoachError ? e.message : "요청을 처리하지 못했어요. 원문은 보존돼요." })
    } finally { res.off("close", abort) }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost")
      if (url.pathname.startsWith("/api/runtime/")) {
        if (!broker) return sendJson(res, 404, { error: "not-found" })
        return await broker.handle(req, res, url.pathname)
      }
      if (["/api/transcribe", "/api/coach", "/api/coach/segment", "/api/coach/support", "/api/coach/support-status", "/api/scripts/revise-segment", "/api/model-status", "/api/scripts/generate", "/api/scripts/generation-status"].includes(url.pathname)) return await api(req, res, url.pathname)
      if (url.pathname === "/api/scripts/align") {
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST", ...HEADERS })
          return res.end()
        }
        return await alignScript(req, res)
      }
      if (url.pathname === "/api/scripts/import") {
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST", ...HEADERS })
          return res.end()
        }
        return await importScript(req, res)
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD", ...HEADERS })
        return res.end()
      }
      if (url.pathname === "/__health") {
        // 자체 AI를 함께 띄우는 컨테이너에서는 모델이 준비되거나 실패가 확정될 때까지 503(starting)으로 답한다(start.mjs의 healthReady).
        const ready = healthReady() !== false
        res.writeHead(ready ? 200 : 503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...HEADERS })
        return res.end(JSON.stringify({ status: ready ? "ok" : "starting", releaseId }))
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
  server.once("close", () => broker?.close())
  return server
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", ...HEADERS })
  res.end(NOT_FOUND_HTML)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000)
  createServer().listen(port, "0.0.0.0", () => console.log(`listening on :${port}`))
}
