import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

export class RuntimeError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const required = message => { throw new RuntimeError("configuration", message) }
const integer = (value, min, max, fallback) => {
  const number = value ?? fallback
  if (!Number.isInteger(number) || number < min || number > max) required("자체 AI 실행 설정의 숫자 범위를 확인해 주세요.")
  return number
}
export function validateRuntimeConfig(input, root) {
  if (!input || typeof input !== "object" || Array.isArray(input)) required("자체 AI 실행 설정을 준비해 주세요.")
  const file = (key, optional = false) => {
    if (optional && !input[key]) return ""
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].includes("\0")) required("모델·실행기·Python 위치를 설정해 주세요.")
    return path.resolve(root, input[key])
  }
  const config = {
    llamaPath: file("llamaPath"), modelPath: file("modelPath"), pythonPath: file("pythonPath"),
    sttModelDir: file("sttModelDir"), pythonPackages: file("pythonPackages", true),
    textPort: integer(input.textPort, 1024, 65535, 8088), voicePort: integer(input.voicePort, 1024, 65535, 8081),
    contextSize: integer(input.contextSize, 8192, 32768, 12288), threads: integer(input.threads, 1, 32, 4),
    gpuLayers: integer(input.gpuLayers, 0, 999, 0), startupTimeoutMs: integer(input.startupTimeoutMs, 1000, 120000, 90000),
  }
  if (config.textPort === config.voicePort) required("텍스트 모델과 음성 모델은 서로 다른 내부 포트를 사용해 주세요.")
  return config
}
export async function readRuntimeConfig(file) {
  let data
  try { data = JSON.parse(await fs.readFile(file, "utf8")) }
  catch { throw new RuntimeError("configuration", "먼저 npm run ai:configure로 자체 모델 실행 설정을 준비해 주세요.") }
  const config = validateRuntimeConfig(data, path.dirname(file))
  for (const name of [config.llamaPath, config.modelPath, config.pythonPath, path.join(config.sttModelDir, "model.bin"), path.join(config.sttModelDir, "config.json"), path.join(config.sttModelDir, "tokenizer.json"), path.join(config.sttModelDir, "vocabulary.txt")]) {
    if (!await fs.stat(name).then(s => s.isFile()).catch(() => false)) required("설정한 모델·실행기 파일을 확인해 주세요. ai:configure로 다시 연결할 수 있어요.")
  }
  return config
}
export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", () => reject(new RuntimeError("port-in-use", "실행 포트를 다른 프로그램이 사용 중이에요. 중복 실행을 종료하거나 포트를 바꿔 주세요.")))
    server.listen(port, "127.0.0.1", () => server.close(resolve))
  })
}
export function buildWorkerSpecs(config, root, env = process.env) {
  const offline = { HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" }
  const localEnv = { ...env }
  for (const key of ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"]) delete localEnv[key]
  return [
    { name: "text", port: config.textPort, command: config.llamaPath,
      args: ["-m", config.modelPath, "--host", "127.0.0.1", "--port", String(config.textPort), "--alias", "speech-coach", "-c", String(config.contextSize), "-t", String(config.threads), "-ngl", String(config.gpuLayers), "--parallel", "1", "--reasoning", "off", "--offline", "--log-disable"],
      env: { ...localEnv, ...offline } },
    { name: "voice", port: config.voicePort, command: config.pythonPath,
      args: [path.join(root, "local-ai", "transcribe_server.py")],
      env: { ...localEnv, ...offline, LOCAL_STT_MODEL_DIR: config.sttModelDir, LOCAL_STT_PORT: String(config.voicePort), PYTHONPATH: config.pythonPackages || env.PYTHONPATH || "" } },
  ]
}

// Owns the model processes. Only local /health requests are used for readiness.
export function createManagedRuntime(specs, { startupTimeoutMs = 90000, pollMs = 250, restartDelayMs = 1000, maxRestarts = 2, fetchImpl = fetch, onState = () => {} } = {}) {
  let stopping = false
  const control = new AbortController()
  const workers = new Map(specs.map(spec => [spec.name, { spec, state: "stopped", child: null, exited: true, attempts: 0 }]))
  const snapshot = () => ({ mode: "managed", textReady: workers.get("text")?.state === "ready", transcriptionReady: workers.get("voice")?.state === "ready", textState: workers.get("text")?.state || "stopped", transcriptionState: workers.get("voice")?.state || "stopped" })
  const update = (worker, state) => { worker.state = state; onState(worker.spec.name, state) }
  async function launch(worker) {
    if (stopping) return
    update(worker, worker.attempts ? "restarting" : "starting")
    await assertPortFree(worker.spec.port)
    if (stopping) return
    const child = spawn(worker.spec.command, worker.spec.args, { env: worker.spec.env, windowsHide: true, shell: false, stdio: ["ignore", "ignore", "ignore"] })
    worker.child = child; worker.exited = false
    let failed = false
    child.once("error", () => { failed = true; worker.exited = true })
    child.once("exit", () => {
      const wasReady = worker.state === "ready"
      worker.exited = true
      if (stopping) return
      update(worker, wasReady ? "restarting" : "failed")
      if (wasReady && worker.attempts < maxRestarts) {
        worker.attempts++
        delay(restartDelayMs, null, { signal: control.signal }).then(() => launch(worker)).catch(() => { if (!stopping) update(worker, "failed") })
      } else if (wasReady) update(worker, "failed")
    })
    const deadline = Date.now() + startupTimeoutMs
    while (!stopping && Date.now() < deadline) {
      if (failed || worker.exited) break
      try {
        const response = await fetchImpl(`http://127.0.0.1:${worker.spec.port}/health`, { redirect: "error", signal: AbortSignal.any([control.signal, AbortSignal.timeout(1500)]) })
        const ready = response.ok
        await response.body?.cancel()
        if (ready && !worker.exited && !stopping) { update(worker, "ready"); return }
      } catch { /* local worker is still preparing */ }
      try { await delay(pollMs, null, { signal: control.signal }) } catch { break }
    }
    if (stopping) return
    update(worker, "failed")
    child.kill()
    throw new RuntimeError("startup", "자체 AI가 준비 시간 안에 시작되지 않았어요. 모델 실행 설정과 사용 가능한 메모리를 확인해 주세요.")
  }
  async function stop() {
    if (stopping) return
    stopping = true; control.abort()
    await Promise.all([...workers.values()].map(async worker => {
      const child = worker.child
      if (child && !worker.exited) {
        const closed = new Promise(resolve => child.once("close", resolve))
        child.kill()
        await Promise.race([closed, delay(3000)])
        if (!worker.exited) child.kill("SIGKILL")
      }
      update(worker, "stopped")
    }))
  }
  return {
    snapshot, stop,
    async start() {
      try { await Promise.all([...workers.values()].map(launch)) }
      catch (error) { await stop(); throw error }
    },
  }
}
