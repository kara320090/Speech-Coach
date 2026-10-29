import { expect, test } from "@playwright/test"
import { openMain, setTarget, stopAndAnalyze } from "../fixtures/flow"

/**
 * docs/scenarios.yaml의 S9(F13 상황 확인)와 S10(F14 조건 시험)의 핵심 흐름. 마이크가 없어도 검토 구간이 생기도록 구간 계획을 일부러 넘긴다.
 * 판정 대신 질문(확인 → 그때 있었던 일 → 바꿔 볼 조건)을 거쳐 그 구간만 다시 연습하고 전후를 비교한다.
 */
test("S9 학생이 다시 볼 구간에 답하고 제안받은 조건으로 그 구간만 다시 연습해 전후를 비교한다", async ({ page }) => {
  // 1. 첫 화면의 온보딩에서 '건너뛰기'를 누른다
  await openMain(page)
  // 2. '목표 시간 분'에 0, '목표 시간 초'에 6을 입력한다
  await setTarget(page, "0", "6")
  // 3. '연습 설정'을 펼쳐 구간별 시간 계획에 '도입 0:01' 줄과 '본론 0:04' 줄을 입력한다
  await page.getByText("연습 설정").click()
  await page.getByLabel("한 줄에 한 구간씩").fill("도입 0:01\n본론 0:04")
  // 4. '녹화 시작'을 누르고 경과 시간이 0:03이 되면 '다음 구간'을 누른 뒤 '녹화 종료'와 '분석'을 누른다
  await page.getByRole("button", { name: "녹화 시작" }).click()
  await expect(page.getByTestId("elapsed")).toHaveText("0:03")
  await page.getByRole("button", { name: "다음 구간" }).click()
  await stopAndAnalyze(page)
  // 5. 다시 볼 구간 목록에서 '계획보다 길어진 구간: 도입'을 누른다
  const item = page.getByRole("list", { name: "검토할 구간 목록" }).getByRole("listitem").filter({ hasText: "계획보다 길어진 구간: 도입" })
  await item.getByRole("button").click()
  // 6. 질문 1 '표시한 구간이 맞나요?'에 '맞아요'를 누른다
  await expect(page.getByText("표시한 구간이 맞나요?")).toBeVisible()
  await expect(page.getByText("질문 1 / 3")).toBeVisible()
  await page.getByRole("button", { name: "맞아요" }).click()
  // 7. 질문 2에서 '다음 내용이 안 떠오름'을 고르고 '다음'을 누른다
  await expect(page.getByText("이 구간에서 어떤 일이 있었나요?")).toBeVisible()
  await page.getByRole("button", { name: "다음 내용이 안 떠오름" }).click()
  await page.getByRole("button", { name: "다음", exact: true }).click()
  // 8. 질문 3에서 제안된 '핵심어 카드'가 선택된 것을 확인하고 '이 구간 다시 연습'을 누른다
  await expect(page.getByRole("button", { name: /핵심어 카드.*문장마다/ })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "이 구간 다시 연습" }).click()
  await expect(page.getByText(/연습 구간: .*계획보다 길어진 구간: 도입/)).toBeVisible()
  // 9. '녹화 시작'을 누르고 경과 시간이 0:02가 되면 '녹화 종료'와 '분석'을 누른다
  await page.getByRole("button", { name: "녹화 시작" }).click()
  await expect(page.getByTestId("elapsed")).toHaveText("0:02")
  await stopAndAnalyze(page)

  // expected: '연습 전후 비교'에 이유와 바꾼 조건, 이전·다시 연습 측정값이 나란히 나오고 점수는 없다
  const cmp = page.getByRole("region", { name: "연습 전후 비교" })
  await expect(cmp).toContainText("이유: 다음 내용이 안 떠오름")
  await expect(cmp).toContainText("핵심어 카드")
  const table = cmp.getByTestId("practice-compare")
  for (const label of ["말 속도", "군말", "긴 침묵", "시선 이탈 비율"]) await expect(table.getByRole("row", { name: new RegExp(label) })).toBeVisible()
  await expect(cmp).not.toContainText("점수:")
})
