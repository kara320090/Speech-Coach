import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "../server.js"
import { assertPortFree, buildWorkerSpecs, createManagedRuntime, readRuntimeConfig } from "../server/managed-runtime.js"

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
try {
  const profile = path.resolve(process.env.AI_RUNTIME_CONFIG || path.join(root, "local-ai", "runtime.local.json"))
  const config = await readRuntimeConfig(profile)
  const port = Number(process.env.PORT || 3000)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [config.textPort, config.voicePort].includes(port)) throw new Error("port")
  await assertPortFree(port)
  runtime = createManagedRuntime(buildWorkerSpecs(config, root), {
    startupTimeoutMs: config.startupTimeoutMs,
    onState: (name, state) => console.log(`[self-hosted] ${name}: ${state}`),
  })
  await runtime.start()
  if (!shuttingDown) {
    const env = { ...process.env, LOCAL_LLM_URL: `http://127.0.0.1:${config.textPort}`, LOCAL_STT_URL: `http://127.0.0.1:${config.voicePort}`, LOCAL_MODEL_NAME: "speech-coach" }
    server = createServer({ env, runtime })
    server.once("error", async () => { console.error("백엔드 실행 포트를 확인해 주세요."); await shutdown(); process.exitCode = 1 })
    server.listen(port, "0.0.0.0", () => console.log(`자체 AI와 백엔드가 준비됐어요: http://localhost:${port}/coach.html`))
  }
} catch (error) {
  console.error(error.code === "configuration" || error.code === "startup" || error.code === "port-in-use" ? error.message : "자체 AI 실행 설정을 확인해 주세요. npm run ai:configure로 준비할 수 있어요.")
  await shutdown(); process.exitCode = 1
}
