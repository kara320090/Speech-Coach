// Public catalog lookup only. No key, audio or text generation request is sent.
import { DEFAULT_GATEWAY_TEXT_MODEL, DEFAULT_GATEWAY_TRANSCRIBE_MODEL } from "../../server/gateway-client.js"
const response = await fetch("https://ai-gateway.vercel.sh/v1/models", { signal: AbortSignal.timeout(15_000) })
if (!response.ok) throw new Error(`Gateway catalog HTTP ${response.status}`)
const body = await response.json()
const ids = new Set(body.data?.map(model => model.id))
const selected = [DEFAULT_GATEWAY_TEXT_MODEL, DEFAULT_GATEWAY_TRANSCRIBE_MODEL].map(id => ({ id, listed: ids.has(id) }))
console.log(JSON.stringify({ source: "https://ai-gateway.vercel.sh/v1/models", checkedAt: new Date().toISOString(), selected }))
if (selected.some(model => !model.listed)) process.exitCode = 1
