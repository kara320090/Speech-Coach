import { randomUUID } from "node:crypto"
import { createAgentVerifier } from "./agent-auth.js"

export function createAgentBroker(publicKey, { now = Date.now, heartbeatMs = 30000, claimMs = 18000, requestMs = 90000 } = {}) {
  const authenticate = createAgentVerifier(publicKey, { now })
  const jobs = new Map(), waiters = { text: [], voice: [] }
  let seenAt = 0, textReady = false, voiceReady = false, closed = false
  const connected = () => seenAt > 0 && now() - seenAt < heartbeatMs
  const available = kind => connected() && (kind === "text" ? textReady : voiceReady)
  const snapshot = () => ({ mode: "self-hosted-agent", agentConnected: connected(), textReady: available("text"), transcriptionReady: available("voice") })
  function json(res, status, value) {
    if (res.destroyed || res.writableEnded) return
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); res.end(value === null ? undefined : JSON.stringify(value))
  }
  function deliver(job, waiter) {
    job.claimed = true; job.lease = randomUUID()
    waiter({ id: job.id, kind: job.kind, lease: job.lease, body: job.body.toString("base64") })
  }
  function finish(job, value) {
    if (!jobs.delete(job.id)) return
    clearTimeout(job.timer); job.signal?.removeEventListener("abort", job.abort)
    job.body = Buffer.alloc(0); job.resolve(value)
  }
  async function forward(kind, body, signal) {
    if (closed || !available(kind)) return new Response('{"error":"agent-unavailable"}', { status: 503 })
    if (jobs.size >= 8) return new Response('{"error":"busy"}', { status: 429 })
    return new Promise(resolve => {
      const job = { id: randomUUID(), kind, body: Buffer.from(body), signal, resolve, claimed: false }
      job.abort = () => finish(job, new Response('{"error":"cancelled"}', { status: 499 }))
      job.timer = setTimeout(() => finish(job, new Response('{"error":"timeout"}', { status: 504 })), requestMs); job.timer.unref?.()
      jobs.set(job.id, job)
      if (signal?.aborted) return job.abort()
      signal?.addEventListener("abort", job.abort, { once: true })
      const waiter = waiters[kind].shift()
      if (waiter) deliver(job, waiter)
    })
  }
  async function handle(req, res, pathname) {
    if (req.method !== "POST") return json(res, 405, { error: "method" })
    const chunks = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > 100000) return json(res, 413, { error: "too-large" }); chunks.push(chunk) }
    const body = Buffer.concat(chunks)
    if (!authenticate(req.method, pathname, req.headers, body)) return json(res, 401, { error: "unauthorized" })
    let input
    try { input = JSON.parse(body.toString("utf8")) } catch { return json(res, 400, { error: "invalid-json" }) }
    if (!input || typeof input !== "object") return json(res, 400, { error: "invalid-input" })
    if (pathname === "/api/runtime/heartbeat") {
      if (typeof input.textReady !== "boolean" || typeof input.transcriptionReady !== "boolean") return json(res, 400, { error: "invalid-input" })
      seenAt = now(); textReady = input.textReady; voiceReady = input.transcriptionReady
      return json(res, 200, { connected: true })
    }
    if (pathname === "/api/runtime/claim") {
      if (!["text", "voice"].includes(input.kind) || !available(input.kind)) return json(res, 503, { error: "not-ready" })
      const queued = [...jobs.values()].find(job => job.kind === input.kind && !job.claimed)
      if (queued) { deliver(queued, data => json(res, 200, data)); return }
      if (waiters[input.kind].length >= 3) return json(res, 429, { error: "busy" })
      return await new Promise(resolve => {
        let timer
        const done = data => {
          clearTimeout(timer)
          const index = waiters[input.kind].indexOf(done); if (index >= 0) waiters[input.kind].splice(index, 1)
          res.off("close", onClose); json(res, data ? 200 : 204, data); resolve()
        }
        const onClose = () => done(null)
        timer = setTimeout(() => done(null), claimMs); timer.unref?.()
        waiters[input.kind].push(done); res.once("close", onClose)
      })
    }
    if (pathname === "/api/runtime/result") {
      const job = jobs.get(input.id)
      if (!job || !job.claimed || input.lease !== job.lease) return json(res, 409, { error: "expired" })
      if (!Number.isInteger(input.status) || !(input.status === 200 || input.status >= 400 && input.status <= 599) || typeof input.body !== "string" || input.body.length > 90000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.body)) return json(res, 400, { error: "invalid-result" })
      const value = Buffer.from(input.body, "base64")
      if (value.length > 64000) return json(res, 413, { error: "too-large" })
      finish(job, new Response(value, { status: input.status, headers: { "Content-Type": "application/json" } }))
      return json(res, 200, { received: true })
    }
    return json(res, 404, { error: "not-found" })
  }
  return {
    snapshot, handle,
    async fetch(url, options = {}) {
      const parsed = new URL(url)
      if (parsed.hostname !== "127.0.0.1") return new Response('{}', { status: 403 })
      if (parsed.pathname === "/health") return new Response('{}', { status: available("text") ? 200 : 503 })
      if (parsed.pathname === "/v1/chat/completions") return forward("text", options.body, options.signal)
      if (parsed.pathname === "/transcribe") return forward("voice", options.body, options.signal)
      return new Response('{}', { status: 404 })
    },
    close() {
      closed = true
      for (const kind of ["text", "voice"]) for (const done of [...waiters[kind]]) done(null)
      for (const job of [...jobs.values()]) finish(job, new Response('{}', { status: 503 }))
    },
  }
}
