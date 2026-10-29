import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readRuntimeConfig, buildWorkerSpecs, createManagedRuntime } from "../server/managed-runtime.js"
import { createAgentClient } from "./agent-client.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
let runtime, client, stopping = false
async function stop() { if (stopping) return; stopping = true; await client?.stop(); await runtime?.stop() }
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stop)
try {
  const config = await readRuntimeConfig(path.join(root, "local-ai", "runtime.local.json"))
  const privateKey = await fs.readFile(path.join(root, "local-ai", "agent-private-key.pem"), "utf8")
  if (!stopping) {
    runtime = createManagedRuntime(buildWorkerSpecs(config, root), { startupTimeoutMs: config.startupTimeoutMs, onState: (name, state) => console.log(`[self-hosted] ${name}: ${state}`) })
    await runtime.start()
    if (!stopping) {
      client = createAgentClient({ backend: process.env.AI_BACKEND_URL || "https://speech-coach-2j01.onrender.com", privateKey, config, runtime, onConnected: () => console.log("Render 백엔드에 자체 AI를 연결했어요. 공개 웹에서 사용할 수 있어요.") })
      client.start()
    }
  }
} catch { console.error("자체 AI 실행 설정과 에이전트 키를 확인해 주세요."); await stop(); process.exitCode = 1 }
