import { expect, test } from "@playwright/test"
import { openMain, setTarget, stopAndAnalyze } from "../fixtures/flow"

/** docs/scenarios.yaml의 S2. */
test("S2 학생이 목표 시간을 넘겨 녹화하고 초과 결과를 확인한다", async ({ page }) => {
  // 1. 첫 화면의 온보딩에서 '건너뛰기'를 누른다
  await openMain(page)
  // 2. '목표 시간 분'에 0, '목표 시간 초'에 2를 입력한다
  await setTarget(page, "0", "2")
  // 3. '녹화 시작'을 누른다
  await page.getByRole("button", { name: "녹화 시작" }).click()
  // 4. '목표 시간 초과'가 나타날 때까지 기다린다
  await expect(page.getByTestId("time-state")).toHaveText("목표 시간 초과")
  await expect(page.getByTestId("remaining")).toContainText("초과 +")
  await expect(page.locator("#panel")).toHaveAttribute("data-state", "over")
  // 5. '녹화 종료'를 누르고 '분석'을 누른다
  await stopAndAnalyze(page)

  // expected: '목표보다 ... 초과했어요'와 양수 차이가 표시된다
  const result = page.getByRole("region", { name: "연습 결과" })
  await expect(result.getByTestId("diff")).toContainText("초과했어요")
  await expect(result.getByTestId("diff")).toContainText("(+0:0")
})
