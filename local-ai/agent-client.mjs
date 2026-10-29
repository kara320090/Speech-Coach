import { setTimeout as delay } from "node:timers/promises"
import { signAgentRequest } from "../server/agent-auth.js"

export function backendUrl(value) {
  const url = new URL(value)
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("backend-url")
  return url.origin
}
export function createAgentClient({ backend, privateKey, config, runtime, fetchImpl = fetch, onConnected = () => {} }) {
  const origin = backendUrl(backend), controller = new AbortController()
  let loops = [], reported = false
  async function post(pathname, data, timeout = 25000) {
    const body = Buffer.from(JSON.stringify(data))
    return fetchImpl(origin + pathname, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", ...signAgentRequest(privateKey, "POST", pathname, body) }, body, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]) })
  }
  async function heartbeat() {
    while (!controller.signal.aborted) {
      try {
        const state = runtime.snapshot(), res = await post("/api/runtime/heartbeat", { textReady: state.textReady, transcriptionReady: state.transcriptionReady })
        if (res.ok && !reported) { reported = true; onConnected() }
        await res.body?.cancel()
      } catch { /* retry the owned backend without logging input or credentials */ }
      await delay(8000, null, { signal: controller.signal }).catch(() => {})
    }
  }
  async function worker(kind) {
    while (!controller.signal.aborted) {
      try {
        const response = await post("/api/runtime/claim", { kind })
        if (response.status !== 200) { await response.body?.cancel(); await delay(1000, null, { signal: controller.signal }); continue }
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength > 6 * 1024 * 1024) throw new Error("job-size")
        const job = JSON.parse(Buffer.from(bytes).toString("utf8"))
        if (job.kind !== kind || typeof job.body !== "string" || job.body.length > 6 * 1024 * 1024) throw new Error("job-kind")
        const url = kind === "text" ? `http://127.0.0.1:${config.textPort}/v1/chat/completions` : `http://127.0.0.1:${config.voicePort}/transcribe`
        let status = 502, data = Buffer.from('{"error":"model-error"}')
        try {
          const result = await fetchImpl(url, { method: "POST", redirect: "error", headers: { "Content-Type": kind === "text" ? "application/json" : "audio/wav" }, body: Buffer.from(job.body, "base64"), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(85000)]) })
          const value = Buffer.from(await result.arrayBuffer())
          if (value.length <= 64000) { status = result.status; data = value }
        } catch { /* send a bounded generic failure result */ }
        const ack = await post("/api/runtime/result", { id: job.id, lease: job.lease, status, body: data.toString("base64") })
        await ack.body?.cancel()
      } catch { if (!controller.signal.aborted) await delay(1000, null, { signal: controller.signal }).catch(() => {}) }
    }
  }
  return {
    start() { loops = [heartbeat(), worker("text"), worker("voice")] },
    async stop() { controller.abort(); await Promise.allSettled(loops) },
  }
}
