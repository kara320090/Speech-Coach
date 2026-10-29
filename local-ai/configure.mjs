import fs from "node:fs/promises"
import { createReadStream } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { validateRuntimeConfig } from "../server/managed-runtime.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const flags = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith("--") || !process.argv[i + 1] || flags.has(process.argv[i])) throw new Error("Use --name value arguments")
  flags.set(process.argv[i], process.argv[i + 1])
}
async function sha256(file) { const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex") }
try {
  const models = path.resolve(flags.get("--models") || path.join(root, "models"))
  const config = validateRuntimeConfig({
    llamaPath: flags.get("--llama"), modelPath: path.join(models, "Qwen3-4B-Q4_K_M.gguf"),
    pythonPath: flags.get("--python"), sttModelDir: path.join(models, "faster-whisper-base"),
    pythonPackages: flags.get("--python-packages"), gpuLayers: Number(flags.get("--gpu-layers") || 0),
    threads: Number(flags.get("--threads") || 4),
  }, process.cwd())
  const files = [
    [config.modelPath, "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5"],
    [path.join(config.sttModelDir, "model.bin"), "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9"],
    [path.join(config.sttModelDir, "config.json"), "56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a"],
    [path.join(config.sttModelDir, "tokenizer.json"), "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"],
    [path.join(config.sttModelDir, "vocabulary.txt"), "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"],
  ]
  for (const [file, digest] of files) if (await sha256(file) !== digest) throw new Error("checksum")
  for (const file of [config.llamaPath, config.pythonPath]) if (!(await fs.stat(file)).isFile()) throw new Error("executable")
  await fs.writeFile(path.join(root, "local-ai", "runtime.local.json"), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
  console.log("모델 파일 검증과 자체 AI 실행 설정을 완료했어요. npm start로 백엔드와 AI를 함께 실행하세요.")
} catch {
  console.error("준비된 모델·llama-server·Python 위치와 파일을 확인해 주세요. 실행 안내는 local-ai/README.md에 있어요.")
  process.exitCode = 1
}
