import { expect, test } from "@playwright/test"

/** docs/scenarios.yaml의 S4. */
test("S4 학생이 같은 조건으로 두 번 연습하고 이전 연습과 비교한다", async ({ page }) => {
  await page.goto("/")

  // 1. 첫 화면의 '목표 시간 초'에 10을 입력한다
  await page.getByLabel("목표 시간 초").fill("10")
  // 2. '연습 시작'을 누른다
  await page.getByRole("button", { name: "연습 시작" }).click()
  // 3. 연습 화면의 경과 시간이 0:01이 될 때까지 기다린다
  await expect(page.getByTestId("elapsed")).toHaveText("0:01")
  // 4. '연습 종료'를 누른다
  await page.getByRole("button", { name: "연습 종료" }).click()
  await expect(page.getByTestId("no-compare")).toContainText("아직 비교할 이전 기록이 없어요")
  // 5. 결과 화면에서 '같은 조건으로 다시 연습'을 누른다
  await page.getByRole("button", { name: "같은 조건으로 다시 연습" }).click()
  // 6. '연습 시작'을 누른다 (이전 목표 시간이 그대로 채워져 있다)
  await expect(page.getByLabel("목표 시간 초")).toHaveValue("10")
  await page.getByRole("button", { name: "연습 시작" }).click()
  // 7. 연습 화면의 경과 시간이 0:04가 될 때까지 기다린다
  await expect(page.getByTestId("elapsed")).toHaveText("0:04")
  // 8. '연습 종료'를 누른다
  await page.getByRole("button", { name: "연습 종료" }).click()

  // expected: 이전·이번 총 연습 시간과 그 변화가 나란히 표시된다
  const row = page.getByTestId("compare-table").getByRole("row", { name: /총 연습 시간/ })
  await expect(row).toBeVisible()
  const cells = await row.getByRole("cell").allInnerTexts()
  const parse = (t: string) => {
    const m = t.match(/(\d+):(\d{2})/)!
    return Number(m[1]) * 60 + Number(m[2])
  }
  const prev = parse(cells[1])
  const cur = parse(cells[2])
  expect(prev).toBeGreaterThanOrEqual(1)
  expect(cur).toBeGreaterThanOrEqual(4)
  expect(cur).toBeGreaterThan(prev)
  expect(parse(cells[3])).toBe(cur - prev)
  expect(cells[3]).toMatch(/^\+/)
})
