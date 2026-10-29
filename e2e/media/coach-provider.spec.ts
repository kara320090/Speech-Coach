import { expect, test } from "@playwright/test"

const original = "원래 저장해 둔 발표 대본입니다."
const draft = "도서관은 토요일 오전 10시에 문을 열어요."
const localStatus = { ready: true, provider: "local", message: "자체 모델을 사용할 수 있어요.", processingNotice: "분석·쉬운 표현 수정·질문·답변 검토는 자체 AI로 처리해요. 외부 AI 제공자에게는 보내지 않아요." }
const generationStatus = { ready: true, provider: "gemini", model: "gemini-3.8-flash", message: "새 대본 생성용 키가 설정돼 있어요.", processingNotice: "새 대본 만들기를 누르면 입력한 주제와 근거 자료만 Google Gemini API로 보내요." }

test("generation preview needs review, preserves original version and transfers to local coaching", async ({ page }) => {
  await page.route("**/api/model-status", r => r.fulfill({ json: localStatus }))
  await page.route("**/api/scripts/generation-status", r => r.fulfill({ json: generationStatus }))
  let sent: any
  await page.route("**/api/scripts/generate", async r => {
    sent = r.request().postDataJSON()
    await r.fulfill({ json: { requestId: sent.requestId, versionId: sent.versionId, model: "gemini-3.8-flash", result: { title: "도서관 안내", script: draft, notes: "운영 시간을 확인해 주세요." } } })
  })
  await page.goto("/coach.html")
  await page.getByLabel("분석할 대본 구간").fill(original)
  await page.getByRole("button", { name: "자료 저장", exact: true }).click()
  await expect(page.locator("#save-state")).toContainText("저장했어요")
  await page.getByRole("link", { name: "Gemini로 새 대본 만들기" }).click()
  await page.getByLabel("발표 주제", { exact: true }).fill("도서관 이용 안내")
  await page.getByLabel("생성에 사용할 근거 자료 (선택)").fill("토요일 오전 10시에 문을 연다.")
  await page.getByRole("button", { name: "새 대본 만들기", exact: true }).click()
  await expect(page.getByLabel("생성된 대본 · 직접 수정할 수 있어요")).toHaveValue(draft)
  expect(Object.keys(sent).sort()).toEqual(["requestId", "sources", "task", "topic", "versionId"])
  const apply = page.getByRole("button", { name: "이 대본으로 이해 연습", exact: true })
  await expect(apply).toBeDisabled()
  await page.getByLabel("초안을 읽고 근거 자료와 대조했어요").check()
  await apply.click()
  await expect(page).toHaveURL(/coach\.html$/)
  await expect(page.getByLabel("분석할 대본 구간")).toHaveValue(draft)
  await expect(page.locator("#processing-note")).toContainText("외부 AI 제공자에게는 보내지 않아요")
  await page.getByRole("button", { name: "처음 대본으로 되돌리기", exact: true }).click()
  await expect(page.getByLabel("분석할 대본 구간")).toHaveValue(original)
})

test("Gemini unavailability keeps topic editable and self-hosted coach available", async ({ page }) => {
  await page.route("**/api/scripts/generation-status", r => r.fulfill({ json: generationStatus }))
  await page.route("**/api/scripts/generate", r => r.fulfill({ status: 503, json: { error: "provider-unavailable", message: "Gemini가 일시적으로 응답하지 않아요." } }))
  await page.route("**/api/model-status", r => r.fulfill({ json: localStatus }))
  await page.goto("/create-script.html")
  await page.getByLabel("발표 주제", { exact: true }).fill("도서관 이용 안내")
  await page.getByRole("button", { name: "새 대본 만들기", exact: true }).click()
  await expect(page.locator("#generation-request-state")).toContainText("일시적으로")
  await expect(page.getByLabel("발표 주제", { exact: true })).toHaveValue("도서관 이용 안내")
  await page.getByRole("link", { name: "이미 있는 대본으로 자체 AI 이해 연습" }).click()
  await expect(page.getByRole("button", { name: "쉬운 대본 제안", exact: true })).toBeEnabled()
  await expect(page.locator("#processing-note")).toContainText("자체 AI")
})

test("no Gemini key disables only new draft creation", async ({ page }) => {
  await page.goto("/create-script.html")
  await expect(page.locator("#generation-state")).toContainText("GEMINI_API_KEY")
  await expect(page.getByRole("button", { name: "새 대본 만들기", exact: true })).toBeDisabled()
  await expect(page.getByRole("link", { name: "이미 있는 대본으로 자체 AI 이해 연습" })).toBeVisible()
})
