import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "../server.js"
import { assertPortFree, buildWorkerSpecs, createManagedRuntime, readRuntimeConfig } from "../server/managed-runtime.js"

// 기동 순서: 웹 서버 포트를 먼저 열고 자체 모델을 뒤에서 띄운다.
// /__health는 모델이 준비되거나(ready) 실패·시간 초과가 확정될 때까지 503(starting)으로 답하고, 그 뒤 200을 준다.
// 그래서 모델이 정상이면 예전과 같이 health=모델 준비이고, 모델 파일이 없거나 죽어도 서버는 "모델 미연결" 상태로 기본 연습(S1–S4·S9)을 제공한다.
// 주최 측 실행은 기동 후 2분 안에 /__health 200을 기다리므로 대기 상한은 그 안에 둔다.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const HEALTH_GATE_MAX_MS = 100_000
let runtime, server, shuttingDown = false
const gate = { open: false }
function openGate(reason) { if (!gate.open) { gate.open = true; console.log(`[self-hosted] health 열림: ${reason}`) } }
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  if (server?.listening) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  await runtime?.stop()
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => shutdown())

const port = Number(process.env.PORT || 3000)
let config = null
try {
  const profile = path.resolve(process.env.AI_RUNTIME_CONFIG || path.join(root, "local-ai", "runtime.local.json"))
  config = await readRuntimeConfig(profile)
  if ([config.textPort, config.voicePort].includes(port)) throw Object.assign(new Error("자체 모델 포트와 웹 포트가 겹쳐요."), { code: "configuration" })
} catch (error) {
  console.error(`[self-hosted] 자체 AI를 시작하지 않아요: ${error.code === "configuration" || error.code === "startup" ? error.message : "자체 AI 실행 설정을 확인해 주세요. npm run ai:configure로 준비할 수 있어요."}`)
  config = null
}

try {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Object.assign(new Error("웹 포트 값을 확인해 주세요."), { code: "configuration" })
  await assertPortFree(port)
  const env = config
    ? { ...process.env, LOCAL_LLM_URL: `http://127.0.0.1:${config.textPort}`, LOCAL_STT_URL: `http://127.0.0.1:${config.voicePort}`, LOCAL_MODEL_NAME: "speech-coach" }
    : { ...process.env }
  if (config) {
    runtime = createManagedRuntime(buildWorkerSpecs(config, root), {
      startupTimeoutMs: config.startupTimeoutMs,
      onState: (name, state) => console.log(`[self-hosted] ${name}: ${state}`),
    })
  }
  // 1) 웹 서버 먼저 (health는 gate가 열릴 때까지 503)
  server = createServer({ env, runtime, healthReady: () => gate.open })
  server.once("error", async () => { console.error("백엔드 실행 포트를 확인해 주세요."); await shutdown(); process.exitCode = 1 })
  await new Promise(resolve => server.listen(port, "0.0.0.0", resolve))
  console.log(`백엔드 포트를 열었어요: http://localhost:${port}/ (자체 AI: ${config ? "시작 중" : "꺼짐"})`)
  // 2) 자체 모델은 뒤에서. 준비·실패·시간 초과 중 먼저 오는 것으로 health를 연다.
  if (runtime && !shuttingDown) {
    const cap = Math.min(HEALTH_GATE_MAX_MS, Number(config.startupTimeoutMs || 90_000) + 10_000)
    const timer = setTimeout(() => openGate(`대기 상한 ${Math.round(cap / 1000)}초 경과, 모델은 계속 시작 중`), cap)
    timer.unref?.()
    runtime.start()
      .then(() => { clearTimeout(timer); openGate("자체 AI 준비 완료"); if (!shuttingDown) console.log(`자체 AI가 준비됐어요: http://localhost:${port}/coach.html`) })
      .catch(async (error) => {
        clearTimeout(timer)
        console.error(`[self-hosted] 자체 AI 기동 실패, 기본 연습만 제공해요: ${error?.message || error}`)
        try { await runtime.stop() } catch {}
        openGate("자체 AI 기동 실패")
      })
  } else {
    openGate("자체 AI 없이 기본 연습 제공")
  }
} catch (error) {
  console.error(error.code === "configuration" || error.code === "port-in-use" ? error.message : "백엔드를 시작하지 못했어요.")
  await shutdown(); process.exitCode = 1
}
