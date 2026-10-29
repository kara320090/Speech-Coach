import { expect, test, type Page } from "@playwright/test"
import { openMain, setTarget, stopAndAnalyze } from "../fixtures/flow"

// UI/consent tests with fake provider responses; actual Gemini availability is checked separately.
const SCRIPT = "캐시는 최근 결과를 5분 동안 보관해 같은 요청에 다시 사용합니다."
const DRAFT = "캐시는 최근 결과를 5분 동안 잠시 저장해 두고 같은 요청에 다시 쓰는 방식입니다."
const READY = { ready: true, model: "gemini-3.8-flash", message: "대화 코칭을 선택할 수 있어요." }
async function mock(page: Page, options: { fail?: boolean, delay?: boolean } = {}) {
  const calls: any[] = []
  await page.route("**/api/coach/support-status", route => route.fulfill({ json: READY }))
  await page.route("**/api/coach/support", async route => {
    const data = route.request().postDataJSON(); calls.push(data)
    if (options.delay) { await new Promise(resolve => setTimeout(resolve, 1500)) }
    if (options.fail) return route.fulfill({ status: 503, json: { message: "Gemini가 잠시 응답하지 않아요. 대본은 그대로예요." } })
    const result = data.task === "support-rewrite" ? { rewritten: DRAFT, reason: "보관한다는 말을 잠시 저장하는 뜻으로 풀었어요.", warnings: [], blocked: false } : { reflection: data.task === "support-start" ? "이 대본을 함께 살펴볼게요." : "표현의 뜻을 함께 정리하고 싶다고 말해 주셨네요.", help: data.task === "support-start" ? "" : "핵심 뜻을 짧은 문장으로 나누어 볼 수 있어요.", question: data.task === "support-start" ? "이 순간 어떤 부분을 함께 정리하면 좋을까요?" : "", offerRewrite: data.task !== "support-start" }
    await route.fulfill({ json: { requestId: data.requestId, versionId: data.versionId, model: "gemini-3.8-flash", result } })
  })
  return calls
}
async function begin(page: Page) {
  await page.goto("/support-coach.html")
  await page.getByLabel("함께 볼 대본", { exact: true }).fill(SCRIPT)
  const start = page.getByRole("button", { name: "동의하고 함께 살펴보기" })
  await expect(start).toBeDisabled()
  await page.getByLabel("선택한 대본·근거·관찰 텍스트와 이 대화의 답변을 Google Gemini로 보내는 데 동의해요").check()
  await start.click()
  await expect(page.locator("#support-messages")).toContainText("어떤 부분을")
}

test("result → open question → own report → rewrite permission → confirmed draft applies only to next practice", async ({ page }) => {
  const calls = await mock(page)
  await openMain(page)
  const panel = page.getByRole("complementary", { name: "대본" })
  await panel.getByRole("button", { name: "대본 편집", exact: true }).click()
  await panel.getByRole("textbox", { name: "대본", exact: true }).fill(SCRIPT)
  await setTarget(page, "0", "10")
  await page.getByRole("button", { name: "녹화 시작", exact: true }).click()
  await expect(page.getByTestId("elapsed")).toHaveText("0:02")
  await stopAndAnalyze(page)
  await page.getByRole("link", { name: "대본과 함께 AI 코칭", exact: true }).click()
  const recordedId = new URL(page.url()).searchParams.get("session")!
  await expect(page.getByLabel("함께 볼 대본", { exact: true })).toHaveValue(SCRIPT)
  await expect(page.getByRole("button", { name: "동의하고 함께 살펴보기" })).toBeDisabled()
  expect(calls.length).toBe(0)
  await page.getByLabel("선택한 대본·근거·관찰 텍스트와 이 대화의 답변을 Google Gemini로 보내는 데 동의해요").check()
  await page.getByRole("button", { name: "동의하고 함께 살펴보기" }).click()
  await expect(page.locator("#support-messages")).toContainText("어떤 부분")
  await expect(page.locator("#rewrite-permission")).toBeHidden()
  await page.getByLabel("내 상황·답변").fill("캐시라는 표현을 제 말로 풀고 싶어요.")
  await page.getByRole("button", { name: "답변 보내기", exact: true }).click()
  await expect(page.getByRole("button", { name: "네, 쉬운 대본을 제안해 주세요" })).toBeVisible()
  expect(calls.map(c => c.task)).toEqual(["support-start", "support-answer"])
  await page.getByRole("button", { name: "네, 쉬운 대본을 제안해 주세요" }).click()
  await expect(page.getByLabel("쉬운 대본 초안 · 직접 수정할 수 있어요")).toHaveValue(DRAFT)
  const apply = page.getByRole("button", { name: "수정본으로 다음 연습 준비" })
  await expect(apply).toBeDisabled()
  await page.getByLabel("수치·단위·조건·부정·한계와 핵심 의미를 확인했고 다음 연습 대본에 적용할게요").check()
  await expect(apply).toBeEnabled()
  await page.getByLabel("쉬운 대본 초안 · 직접 수정할 수 있어요").fill(DRAFT.replace("5분", "6분"))
  await page.getByLabel("수치·단위·조건·부정·한계와 핵심 의미를 확인했고 다음 연습 대본에 적용할게요").check()
  await expect(apply).toBeDisabled()
  await page.getByLabel("쉬운 대본 초안 · 직접 수정할 수 있어요").fill(DRAFT)
  await page.getByLabel("수치·단위·조건·부정·한계와 핵심 의미를 확인했고 다음 연습 대본에 적용할게요").check()
  await apply.click()
  await expect(page).toHaveURL(/\/#\/$/)
  await panel.getByRole("button", { name: "대본 편집", exact: true }).click()
  await expect(panel.getByRole("textbox", { name: "대본", exact: true })).toHaveValue(DRAFT)
  const original = await page.evaluate(async id => { const storage = await import("/js/storage.js"); return (await storage.getSession(id))?.script }, recordedId)
  expect(original).toBe(SCRIPT)
  expect(calls.at(-1).rewriteConsent).toBe(true)
  for (const sent of calls) { expect(sent.externalTransferConsent).toBe(true); expect(sent).not.toHaveProperty("audioBlob"); expect(sent).not.toHaveProperty("videoBlob") }
  await page.goto("/support-coach.html")
  await page.getByRole("button", { name: "직전 적용 전 대본으로 되돌리기" }).click()
  await expect(page.locator("#support-state")).toContainText("되돌렸어요")
})

test("decline does not generate a rewrite and keeps the source", async ({ page }) => {
  const calls = await mock(page); await begin(page)
  await page.getByRole("button", { name: "표현의 뜻을 함께 정리하고 싶어요.", exact: true }).click()
  await page.getByRole("button", { name: "지금 대본을 유지할게요", exact: true }).click()
  expect(calls.map(c => c.task)).toEqual(["support-start", "support-answer"])
  await expect(page.getByLabel("함께 볼 대본", { exact: true })).toHaveValue(SCRIPT)
  await expect(page.locator("#support-revision")).toBeHidden()
})

test("changed input cancels stale replies; provider failure leaves text editable", async ({ page }) => {
  const calls = await mock(page, { delay: true, fail: true })
  await page.goto("/support-coach.html")
  await page.getByLabel("함께 볼 대본", { exact: true }).fill(SCRIPT)
  await page.getByLabel("선택한 대본·근거·관찰 텍스트와 이 대화의 답변을 Google Gemini로 보내는 데 동의해요").check()
  await page.getByRole("button", { name: "동의하고 함께 살펴보기" }).click()
  await expect(page.getByRole("button", { name: "응답 기다리기 취소" })).toBeVisible()
  await page.getByLabel("함께 볼 대본", { exact: true }).fill("자료가 바뀐 새 대본입니다.")
  await expect(page.locator("#support-dialogue")).toBeHidden()
  await page.getByLabel("선택한 대본·근거·관찰 텍스트와 이 대화의 답변을 Google Gemini로 보내는 데 동의해요").check()
  await page.getByRole("button", { name: "동의하고 함께 살펴보기" }).click()
  await expect(page.locator("#support-state")).toContainText("잠시 응답하지")
  await expect(page.getByLabel("함께 볼 대본", { exact: true })).toHaveValue("자료가 바뀐 새 대본입니다.")
  expect(calls.length).toBeGreaterThan(0)
  await expect(page.getByRole("link", { name: "개념·질문 연습" })).toBeVisible()
})

test("without a key no conversation is sent and base practice remains available", async ({ page }) => {
  await page.goto("/support-coach.html")
  await expect(page.locator("#support-model")).toContainText("키가 준비되지")
  await expect(page.getByRole("button", { name: "동의하고 함께 살펴보기" })).toBeDisabled()
  await expect(page.getByRole("link", { name: "개념·질문 연습" })).toBeVisible()
})
