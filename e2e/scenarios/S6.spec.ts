import { expect, test } from "@playwright/test"
import { openMain } from "../fixtures/flow"

const SCRIPT = "캐시는 이전 결과를 잠시 저장했다가 같은 요청이 오면 다시 사용하는 공간입니다."
test("S6 학생이 자체 AI로 개념과 자기 설명을 확인하고 검토 결과와 답변을 저장한다", async ({ page }) => {
  await openMain(page)
  await page.getByRole("link", { name: "대본 이해 연습", exact: true }).click()
  await page.getByLabel("분석할 대본 구간").fill(SCRIPT)
  await page.getByLabel("근거 자료 (선택)").fill(SCRIPT)
  await page.getByRole("button", { name: "자료 저장", exact: true }).click()
  await expect(page.locator("#save-state")).toContainText("저장했어요")
  await expect(page.getByRole("button", { name: "낯선 개념 살펴보기", exact: true })).toBeEnabled({ timeout: 30000 })
  await page.getByRole("button", { name: "낯선 개념 살펴보기", exact: true }).click()
  await expect(page.locator("#concept-list blockquote").first()).toBeVisible({ timeout: 90000 })
  const quote = await page.locator("#concept-list blockquote").first().innerText()
  expect(SCRIPT).toContain(quote)
  await page.getByRole("button", { name: "내 말로 설명해 보기", exact: true }).first().click()
  await page.getByLabel("내 설명·답변").fill("이전에 얻은 결과를 잠시 저장하고 같은 요청에 다시 사용하는 공간입니다.")
  await page.getByRole("button", { name: "답변 함께 확인", exact: true }).click()
  await expect(page.locator("#feedback")).toContainText("모델의 검토 초안", { timeout: 90000 })
  await expect(page.locator("#feedback")).toContainText("비교한 자료:")
  await page.getByRole("button", { name: "이 검토가 맞아요", exact: true }).click()
  await expect(page.locator("#attempt-history")).toContainText("전체 답변 1개")
  await expect(page.locator("#attempt-history")).toContainText("사용자 확인: 맞음")
  await page.reload()
  await expect(page.locator("#attempt-history")).toContainText("전체 답변 1개")
  await expect(page.locator("#attempt-history")).toContainText("사용자 확인: 맞음")
})
