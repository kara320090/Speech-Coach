// 외부 패키지 없이 public/ 폴더의 정적 파일과 /__health만 제공하는 서버.
// 녹음·영상·분석은 모두 브라우저 안에서 처리하고 서버로 보내지 않는다.
import http from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "public")
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
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
  "Content-Security-Policy":
    "default-src 'self'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
}

const NOT_FOUND_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>페이지를 찾을 수 없어요</title></head><body><main><h1>페이지를 찾을 수 없어요</h1><p><a href="/">발표 연습 코치 첫 화면으로 가기</a></p></main></body></html>`

export function createServer({ releaseId = process.env.RELEASE_ID || "dev" } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost")
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
