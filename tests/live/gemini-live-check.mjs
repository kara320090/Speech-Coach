// 실제 Gemini 연결 확인(수동 전용). 일반 검사(node --test)·CI에서는 실행되지 않는다(파일 이름이 검사 패턴과 다름).
// 실행 조건: 별도 명령 `npm run test:gemini-live` + 환경변수 GEMINI_LIVE_TEST=1 + GEMINI_API_KEY가 모두 있어야 한다.
// 개인정보 없는 가상 대본으로 '새 대본 만들기' 요청을 딱 한 번 보낸다(재시도 없음). 키는 출력하지 않는다.
// 이 요청은 Google 프로젝트의 사용량·요금 설정에 따라 기록·과금될 수 있다.
import { createScriptGenerator } from "../../server/coach-provider.js"

if (process.env.GEMINI_LIVE_TEST !== "1" || !process.env.GEMINI_API_KEY) {
  console.error("실제 Gemini 호출을 하지 않았어요. GEMINI_LIVE_TEST=1과 GEMINI_API_KEY를 모두 설정한 뒤 `npm run test:gemini-live`로 실행해 주세요.")
  process.exit(2)
}

const env = { AI_PROVIDER: "gemini", GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL || "", GEMINI_TIMEOUT_MS: process.env.GEMINI_TIMEOUT_MS || "" }
const coach = createScriptGenerator({ env })
const script = "가상의 동네 도서관은 매주 토요일 오전 10시에 문을 엽니다. 대출 기간은 2주이며 연장은 한 번만 할 수 있습니다."
const input = { task: "generate", requestId: `live-${Date.now()}`, versionId: "live-check", topic: "가상 도서관 이용 안내", sources: script }

const status = await coach.status()
console.log(`공급자 ${status.provider} · 모델 ${status.model} · 키 설정 ${status.keyConfigured ? "있음" : "없음"}`)
try {
  const out = await coach.run(input, AbortSignal.timeout(60_000), { client: "live-check" })
  console.log(`성공 · ${out.model} · ${out.durationMs}ms`)
  console.log(`새 대본: ${out.result.script}`)
  console.log(`확인할 내용: ${out.result.notes}`)
  console.log(`연결 상태: ${(await coach.status()).connection}`)
} catch (e) {
  console.error(`실패 · ${e.status || "-"} ${e.code || e.name}: ${e.message}`)
  process.exit(1)
}
