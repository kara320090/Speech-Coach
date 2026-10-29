import { expect, test } from "@playwright/test"

// 대본 코치 화면의 처리 안내가 서버가 알려 준 공급자(local·gemini)에 맞게 바뀌는지 본다. 모델은 부르지 않는다.
test("Gemini 모드 상태면 Google로 보낸다는 안내를, 자체 모델 모드면 외부로 보내지 않는다는 안내를 보여 준다", async ({ page }) => {
  await page.route("**/api/model-status", (r) => r.fulfill({ json: { ready: true, provider: "gemini", keyConfigured: true, connection: "unverified", message: "Gemini API 키가 설정돼 있어요. 실제 연결은 첫 AI 실행에서 확인돼요.", processingNotice: "분석 버튼을 누른 대본·근거 자료·답변 텍스트는 Google Gemini API로 보내 처리해요. 개인정보·비공개 자료는 넣지 말아 주세요." } }))
  await page.goto("/coach.html")
  await expect(page.locator("#model-state")).toContainText("실제 연결은 첫 AI 실행에서 확인돼요")
  await expect(page.locator("#processing-note")).toHaveText(/Google Gemini API로 보내 처리해요/)
  await expect(page.getByText("외부 AI 제공자에게는 보내지 않아요")).toHaveCount(0)
})

test("서버 기본값(자체 모델)에서는 외부 AI 제공자에게 보내지 않는다고 안내한다", async ({ page }) => {
  await page.goto("/coach.html")
  await expect(page.locator("#processing-note")).toHaveText(/외부 AI 제공자에게는 보내지 않아요/)
})
