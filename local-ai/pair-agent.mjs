import { generateKeyPairSync } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const privatePath = path.join(root, "local-ai", "agent-private-key.pem")
try {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } })
  // The private key stays on the inference PC; only the public key is deployed.
  await fs.writeFile(privatePath, privateKey, { flag: "wx", mode: 0o600 })
  await fs.writeFile(path.join(root, "server", "agent-public-key.json"), JSON.stringify({ publicKey }, null, 2) + "\n")
  console.log("자체 AI 에이전트의 서명 키를 준비했어요. 공개 키는 백엔드에 배포하고 개인 키는 이 PC에 보관해요.")
} catch { console.error("에이전트 키를 확인해 주세요. 기존 개인 키는 덮어쓰지 않아요."); process.exitCode = 1 }
