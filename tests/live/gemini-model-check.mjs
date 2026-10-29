// Gemini 모델 접근 수동 점검. 생성 요청(generateContent)을 보내지 않고 모델 정보 조회(models.get)만 한다.
// 실행: npm run gemini:check-models [모델 ...]   (모델을 안 주면 GEMINI_MODEL 또는 gemini-2.5-flash)
// 키: 환경변수 GEMINI_API_KEY, 없으면 화면에 보이지 않게 입력받는다. 키·Google 메시지 원문은 출력하지 않는다.
// 주의: 조회 성공은 '이 키로 모델 정보를 볼 수 있다'는 뜻일 뿐, 생성 호출이 되거나 무료로 쓸 수 있다는 보장이 아니다.
import readline from "node:readline"
import { checkModelAccess } from "../../server/gemini-client.js"

async function hiddenKey() {
  if (!process.stdin.isTTY) return ""
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  rl._writeToOutput = (s) => { if (s.includes("GEMINI_API_KEY")) process.stdout.write(s) } // 입력한 글자는 화면에 찍지 않는다
  const key = await new Promise((r) => rl.question("GEMINI_API_KEY (입력이 보이지 않아요): ", r))
  rl.close()
  process.stdout.write("\n")
  return key.trim()
}

const apiKey = (process.env.GEMINI_API_KEY || "").trim() || (await hiddenKey())
if (!apiKey) {
  console.error("키가 없어 점검하지 않았어요. GEMINI_API_KEY를 환경변수로 주거나 터미널에서 직접 실행해 입력해 주세요.")
  process.exit(2)
}
const models = process.argv.slice(2).length ? process.argv.slice(2) : [process.env.GEMINI_MODEL || "gemini-2.5-flash"]
console.log("생성 요청 없이 models.get으로만 확인해요.")
let failed = false
for (const model of models) {
  try {
    const r = await checkModelAccess({ apiKey, model })
    const access = r.accessible ? "조회 가능" : "조회 불가"
    const gen = r.generateContent === null ? "-" : r.generateContent ? "generateContent 지원" : "generateContent 미지원"
    console.log(`${model}: ${access} · HTTP ${r.httpStatus}${r.providerStatus ? ` · ${r.providerStatus}` : ""}${r.providerReason ? ` · ${r.providerReason}` : ""} · ${gen}`)
    if (!r.accessible) failed = true
  } catch (e) {
    failed = true
    console.log(`${model}: 확인 실패 (${e?.name === "TimeoutError" ? "시간 초과" : e?.message === "invalid-model-name" ? "모델 이름 형식 오류" : "연결 실패"})`)
  }
}
console.log("조회 가능해도 실제 생성 호출·무료 사용 가능 여부는 별개예요. 무료 한도는 Google AI Studio의 프로젝트 한도에서 확인해 주세요.")
process.exit(failed ? 1 : 0)
