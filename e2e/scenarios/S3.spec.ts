import { expect, test } from "@playwright/test"

/** docs/scenarios.yaml의 S3. */
test("S3 학생이 구간별 시간 계획으로 연습하고 계획과 실제를 비교한다", async ({ page }) => {
  await page.goto("/")

  // 1. 첫 화면의 '목표 시간 초'에 6을 입력한다
  await page.getByLabel("목표 시간 초").fill("6")
  // 2. 첫 화면의 '구간별 시간 계획'에 '도입 0:02' 줄과 '본론 0:03' 줄을 입력한다
  await page.getByLabel("한 줄에 한 구간씩").fill("도입 0:02\n본론 0:03")
  // 3. '연습 시작'을 누른다
  await page.getByRole("button", { name: "연습 시작" }).click()
  await expect(page.getByTestId("pace")).toContainText("도입: 계획 0:02")
  // 4. 연습 화면의 경과 시간이 0:03이 될 때까지 기다린다
  await expect(page.getByTestId("elapsed")).toHaveText("0:03")
  // 5. '다음 구간'을 누른다
  await page.getByRole("button", { name: "다음 구간" }).click()
  await expect(page.getByTestId("pace")).toContainText("본론: 계획 0:03")
  // 6. '연습 종료'를 누른다
  await page.getByRole("button", { name: "연습 종료" }).click()

  // expected: 도입은 계획 0:02와 실제 시간·차이, 본론은 '연습 종료까지'로 계산된 실제 시간이 표시된다
  const table = page.getByRole("region", { name: "구간별 시간" })
  const intro = table.getByRole("row", { name: /도입/ })
  await expect(intro).toBeVisible()
  const cells = await intro.getByRole("cell").allInnerTexts()
  expect(cells[1]).toBe("0:02")
  const parse = (t: string) => {
    const m = t.match(/(\d+):(\d{2})/)!
    return Number(m[1]) * 60 + Number(m[2])
  }
  expect(parse(cells[2])).toBeGreaterThanOrEqual(3)
  expect(parse(cells[3])).toBe(parse(cells[2]) - 2)
  expect(cells[3]).toMatch(/^\+/)
  const main = table.getByRole("row", { name: /본론/ })
  await expect(main.getByRole("cell").nth(2)).toContainText("연습 종료까지")
})
