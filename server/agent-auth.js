import { createHash, createPublicKey, randomUUID, sign, verify } from "node:crypto"

const digest = body => createHash("sha256").update(body).digest("hex")
const canonical = (method, pathname, time, nonce, body) => Buffer.from(`${method}\n${pathname}\n${time}\n${nonce}\n${digest(body)}`)
export function signAgentRequest(privateKey, method, pathname, body, now = Date.now()) {
  const time = String(now), nonce = randomUUID()
  return { "X-AI-Time": time, "X-AI-Nonce": nonce, "X-AI-Signature": sign(null, canonical(method, pathname, time, nonce, body), privateKey).toString("base64url") }
}
export function createAgentVerifier(publicPem, { now = Date.now, maxAgeMs = 45000 } = {}) {
  const publicKey = createPublicKey(publicPem), seen = new Map()
  return (method, pathname, headers, body) => {
    const time = headers["x-ai-time"], nonce = headers["x-ai-nonce"], signature = headers["x-ai-signature"], at = now()
    if (typeof time !== "string" || !/^\d{13}$/.test(time) || Math.abs(at - Number(time)) > maxAgeMs || typeof nonce !== "string" || !/^[\w-]{20,80}$/.test(nonce) || typeof signature !== "string" || !/^[\w-]{80,100}$/.test(signature)) return false
    for (const [id, expires] of seen) if (expires < at) seen.delete(id)
    if (seen.has(nonce) || seen.size >= 4096) return false
    try { if (!verify(null, canonical(method, pathname, time, nonce, body), publicKey, Buffer.from(signature, "base64url"))) return false } catch { return false }
    seen.set(nonce, at + maxAgeMs); return true
  }
}
