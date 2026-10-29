import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { createServer } from "../server.js"

test("vendored SDK/model assets match the pinned manifest", async () => {
  const root = new URL("../public/vendor/mediapipe/0.10.32/", import.meta.url)
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root)))
  assert.equal(manifest.version, "0.10.32")
  for (const [name, spec] of Object.entries(manifest.files)) {
    const bytes = await readFile(new URL(name, root))
    assert.equal(bytes.length, spec.bytes)
    assert.equal(createHash("sha256").update(bytes).digest("hex"), spec.sha256)
  }
})
test("WASM/module MIME and CSP enable only same-origin WebAssembly", async () => {
  const app = createServer({ env: {} })
  await new Promise((r) => app.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${app.address().port}`
  try {
    for (const [file, mime] of [["vision_bundle.mjs", "text/javascript"], ["wasm/vision_wasm_internal.wasm", "application/wasm"]]) {
      const res = await fetch(`${base}/vendor/mediapipe/0.10.32/${file}`, { method: "HEAD" })
      assert.equal(res.status, 200); assert.ok(res.headers.get("content-type").startsWith(mime))
      const csp = res.headers.get("content-security-policy")
      assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/)
      assert.match(csp, /connect-src 'self';/)
      assert.ok(!csp.includes("'unsafe-eval'") && !csp.includes("https:"))
    }
  } finally { await new Promise((r) => app.close(r)) }
})
