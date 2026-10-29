import { expect, test } from "@playwright/test"

/**
 * docs/scenarios.yaml의 S1. 이 서비스는 로그인이 없다.
 * 주최 측 실행에는 마이크가 없어 '소리 기록 안 됨' 안내가 뜨지만 시간 측정 흐름은 끝까지 된다.
 */
test("S1 학생이 목표 시간을 정해 연습하고 목표보다 일찍 끝난 결과를 확인한다", async ({ page }) => {
  await page.goto("/")

  // 1. 첫 화면의 '목표 시간 분'에 0을 입력한다
  await page.getByLabel("목표 시간 분").fill("0")
  // 2. 첫 화면의 '목표 시간 초'에 6을 입력한다
  await page.getByLabel("목표 시간 초").fill("6")
  // 3. '연습 시작'을 누른다
  await page.getByRole("button", { name: "연습 시작" }).click()
  // 4. 연습 화면의 경과 시간이 0:02가 될 때까지 기다린다
  await expect(page.getByTestId("elapsed")).toHaveText("0:02")
  await expect(page.getByTestId("time-state")).toHaveText("시간 임박")
  // 5. '연습 종료'를 누른다
  await page.getByRole("button", { name: "연습 종료" }).click()

  // expected: 총 연습 시간이 목표(0:06)보다 짧게 나오고 '일찍 끝났어요'와 음수 차이가 표시된다
  const result = page.getByRole("region", { name: "연습 결과" })
  await expect(result.getByTestId("target")).toHaveText("0:06")
  await expect(result.getByTestId("diff")).toContainText("일찍 끝났어요")
  await expect(result.getByTestId("diff")).toContainText("(-0:0")
  const total = (await result.getByTestId("total").innerText()).match(/^(\d+):(\d{2})/)
  expect(Number(total![1]) * 60 + Number(total![2])).toBeLessThan(6)
})
