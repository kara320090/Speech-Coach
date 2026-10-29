import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import net from "node:net"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { assertPortFree, buildWorkerSpecs, createManagedRuntime, readRuntimeConfig, validateRuntimeConfig } from "../server/managed-runtime.js"
import { createServer } from "../server.js"

const configInput = { llamaPath: "llama-server", modelPath: "model.gguf", pythonPath: "python", sttModelDir: "voice" }
async function freePort() {
  const s = net.createServer(); await new Promise(resolve => s.listen(0, "127.0.0.1", resolve))
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port
}
// Real child processes exercise ownership/readiness; this does not simulate AI quality.
const child = `
import http from 'node:http';import fs from 'node:fs';
const [port,mode,marker]=process.argv.slice(1);
if(mode==='exit')process.exit(3);
let first=false;if(marker){first=!fs.existsSync(marker);fs.writeFileSync(marker,'started')}
const s=http.createServer((req,res)=>{res.writeHead(mode==='never'?503:200);res.end('{}')});
s.listen(Number(port),'127.0.0.1',()=>{if(mode==='repeat'||(mode==='once'&&first))setTimeout(()=>process.exit(3),220)});
process.on('SIGTERM',()=>s.close(()=>process.exit(0)));
console.log('private-prompt-must-not-be-logged');
`
async function spec(name, mode = "ready", marker = "") {
  const port = await freePort()
  return { name, port, command: process.execPath, args: ["--input-type=module", "-e", child, "--", String(port), mode, marker], env: { ...process.env } }
}
async function until(fn) {
  const deadline = Date.now() + 6000
  while (!fn()) { if (Date.now() > deadline) throw new Error("condition timeout"); await delay(25) }
}
const options = { startupTimeoutMs: 2000, pollMs: 25, restartDelayMs: 30 }

test("runtime profile validates owned files, ports and resource limits", () => {
  const c = validateRuntimeConfig(configInput, process.cwd())
  assert.equal(c.contextSize, 12288); assert.equal(c.gpuLayers, 0)
  for (const patch of [{ voicePort: 8088 }, { textPort: 0 }, { gpuLayers: -1 }, { contextSize: 2048 }, { threads: 200 }, { llamaPath: "" }]) assert.throws(() => validateRuntimeConfig({ ...configInput, ...patch }, process.cwd()))
})
test("model child configuration is loopback-only, offline, shell-free and does not pass provider keys", () => {
  const specs = buildWorkerSpecs(validateRuntimeConfig(configInput, process.cwd()), process.cwd(), { PATH: "safe-path", AI_GATEWAY_API_KEY: "fake-test-only", HF_TOKEN: "fake-test-only", GEMINI_API_KEY: "fake-test-only", GOOGLE_API_KEY: "fake-test-only" })
  assert.ok(specs[0].args.includes("--offline")); assert.ok(specs[0].args.includes("127.0.0.1")); assert.ok(specs[0].args.includes("--log-disable"))
  for (const s of specs) { assert.equal(s.env.HF_HUB_OFFLINE, "1"); assert.equal(s.env.HF_TOKEN, undefined); assert.equal(s.env.AI_GATEWAY_API_KEY, undefined); assert.equal(s.env.GEMINI_API_KEY, undefined); assert.equal(s.env.GOOGLE_API_KEY, undefined); assert.equal(s.env.PATH, "safe-path") }
})
test("missing or malformed runtime profile returns a safe setup message", async () => {
  await assert.rejects(readRuntimeConfig(path.join(os.tmpdir(), "speech-coach-no-such-profile.json")), error => error.code === "configuration" && !error.message.includes(os.tmpdir()))
})
test("both owned worker health checks complete before ready; stop releases their ports", async () => {
  const specs = [await spec("text"), await spec("voice")], messages = []
  const runtime = createManagedRuntime(specs, { ...options, onState: (name, state) => messages.push(`${name}:${state}`) })
  try {
    await runtime.start(); assert.equal(runtime.snapshot().textReady, true); assert.equal(runtime.snapshot().transcriptionReady, true)
    assert.ok(messages.includes("text:ready")); assert.ok(messages.every(x => !x.includes("private-prompt")))
  } finally { await runtime.stop() }
  for (const s of specs) await assertPortFree(s.port)
  assert.equal(runtime.snapshot().textReady, false)
})
test("an occupied worker port is rejected without terminating the existing service", async () => {
  const occupied = http.createServer((req, res) => res.end("existing"))
  await new Promise(resolve => occupied.listen(0, "127.0.0.1", resolve))
  const s = await spec("text"); s.port = occupied.address().port
  const runtime = createManagedRuntime([s], options)
  try {
    await assert.rejects(runtime.start(), error => error.code === "port-in-use")
    const r = await fetch(`http://127.0.0.1:${s.port}`); assert.equal(await r.text(), "existing")
  } finally { occupied.closeAllConnections(); await new Promise(resolve => occupied.close(resolve)); await runtime.stop() }
})
test("worker startup failure cleans up the other worker", async () => {
  const specs = [await spec("text", "exit"), await spec("voice")], runtime = createManagedRuntime(specs, options)
  await assert.rejects(runtime.start(), error => error.code === "startup")
  for (const s of specs) await assertPortFree(s.port)
})
test("a nonready worker times out and is terminated", async () => {
  const s = await spec("text", "never"), runtime = createManagedRuntime([s], { ...options, startupTimeoutMs: 250 })
  await assert.rejects(runtime.start(), error => error.code === "startup")
  await assertPortFree(s.port)
})
test("an owned worker restarts and becomes ready after one process exit", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "speech-coach-runtime-")), marker = path.join(temp, "marker")
  const s = await spec("text", "once", marker), changes = []
  const runtime = createManagedRuntime([s], { ...options, onState: (name, state) => changes.push(state) })
  try {
    await runtime.start(); await until(() => changes.filter(x => x === "ready").length === 2)
    assert.ok(changes.includes("restarting")); assert.equal(runtime.snapshot().textReady, true)
  } finally { await runtime.stop(); await fs.rm(marker, { force: true }); await fs.rmdir(temp) }
})
test("repeated worker exits stop at the restart limit", async () => {
  const s = await spec("text", "repeat"), runtime = createManagedRuntime([s], { ...options, maxRestarts: 1 })
  try { await runtime.start(); await until(() => runtime.snapshot().textState === "failed"); assert.equal(runtime.snapshot().textReady, false) }
  finally { await runtime.stop() }
})
test("backend exposes safe managed readiness alongside actual model health", async () => {
  const runtime = { snapshot: () => ({ mode: "managed", textReady: true, transcriptionReady: true, textState: "ready", transcriptionState: "ready" }) }
  const server = createServer({ env: { LOCAL_LLM_URL: "http://127.0.0.1:8088", LOCAL_STT_URL: "http://127.0.0.1:8081" }, runtime, fetchImpl: async () => new Response('{}') })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/model-status`), body = await res.json()
    assert.equal(body.ready, true); assert.equal(body.runtime.mode, "managed"); assert.equal(body.runtime.transcriptionReady, true)
    assert.ok(!JSON.stringify(body).includes("llamaPath"))
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
