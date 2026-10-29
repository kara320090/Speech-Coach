// Node 22 web server with loopback-only, self-hosted model processing. No external AI provider calls.
import http from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createLocalCoach, CoachError, LIMITS } from "./server/local-coach.js"
import { createLocalTranscriber } from "./server/local-transcribe.js"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public")
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // 마이크·카메라는 이 사이트에서만 쓴다.
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

export function createServer({ releaseId = process.env.RELEASE_ID || "dev", env = process.env, fetchImpl = fetch } = {}) {
  const coach = createLocalCoach({ env, fetchImpl })
  const transcriber = createLocalTranscriber({ env, fetchImpl })

  async function api(req, res, pathname) {
    const controller = new AbortController()
    const abort = () => { if (!res.writableEnded) controller.abort() }
    res.on("close", abort)
    try {
      if (pathname === "/api/model-status") {
        if (req.method !== "GET") return sendJson(res, 405, { error: "method" })
        return sendJson(res, 200, { ...await coach.status(), transcriptionConfigured: transcriber.configured })
      }
      if (req.method !== "POST") return sendJson(res, 405, { error: "method" })
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return sendJson(res, 403, { error: "origin", message: "이 페이지에서 시작한 요청만 처리할 수 있어요." })
      if (pathname === "/api/transcribe") {
        const body = await readBody(req, 4 * 1024 * 1024)
        const result = await transcriber.run(body, controller.signal)
        if (!res.destroyed) sendJson(res, result.status, result.body)
        return
      }
      if (!(req.headers["content-type"] || "").startsWith("application/json")) return sendJson(res, 415, { error: "content-type", message: "JSON 형식으로 보내 주세요." })
      const body = await readBody(req, LIMITS.body)
      if (!body) return sendJson(res, 413, { error: "too-large", message: "입력이 너무 커요. 짧은 구간으로 나누어 주세요." })
      let data
      try { data = JSON.parse(body.toString("utf8")) } catch { return sendJson(res, 400, { error: "invalid-json", message: "요청을 읽지 못했어요." }) }
      const result = await coach.run(data, controller.signal)
      if (!res.destroyed) sendJson(res, 200, result)
    } catch (e) {
      if (!res.destroyed) sendJson(res, e instanceof CoachError ? e.status : 400, { error: e instanceof CoachError ? e.code : "invalid-request", message: e instanceof CoachError ? e.message : "요청을 처리하지 못했어요. 원문은 보존돼요." })
    } finally { res.off("close", abort) }
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost")
      if (["/api/transcribe", "/api/coach", "/api/model-status"].includes(url.pathname)) return await api(req, res, url.pathname)
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
