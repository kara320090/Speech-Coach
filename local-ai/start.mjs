import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "../server.js"
import { assertPortFree, buildWorkerSpecs, createManagedRuntime, readRuntimeConfig } from "../server/managed-runtime.js"

// 기동 순서: 웹 서버를 먼저 열어 /__health와 기본 연습(S1–S4·S9)을 바로 제공하고, 자체 모델은 그 뒤에 띄운다.
// 모델·실행기 파일이 없거나 기동에 실패해도 서버는 "모델 미연결" 상태로 계속 동작한다(주최 측 실행은 /__health를 2분 안에 기다린다).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
let runtime, server, shuttingDown = false
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
  // 1) 웹 서버 먼저
  server = createServer({ env, runtime })
  server.once("error", async () => { console.error("백엔드 실행 포트를 확인해 주세요."); await shutdown(); process.exitCode = 1 })
  await new Promise(resolve => server.listen(port, "0.0.0.0", resolve))
  console.log(`백엔드가 준비됐어요: http://localhost:${port}/ (자체 AI: ${config ? "시작 중" : "꺼짐"})`)
  // 2) 자체 모델은 뒤에서. 실패해도 서버는 유지한다.
  if (runtime && !shuttingDown) {
    runtime.start()
      .then(() => { if (!shuttingDown) console.log(`자체 AI가 준비됐어요: http://localhost:${port}/coach.html`) })
      .catch(async (error) => {
        console.error(`[self-hosted] 자체 AI 기동 실패, 기본 연습만 제공해요: ${error?.message || error}`)
        try { await runtime.stop() } catch {}
      })
  }
} catch (error) {
  console.error(error.code === "configuration" || error.code === "port-in-use" ? error.message : "백엔드를 시작하지 못했어요.")
  await shutdown(); process.exitCode = 1
}
