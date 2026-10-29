import { expect, test } from "@playwright/test"
import { openMain, setTarget, stopAndAnalyze } from "../fixtures/flow"

/**
 * docs/scenarios.yaml의 S1. 이 서비스는 로그인이 없다.
 * 주최 측 실행에는 마이크·카메라가 없어 '소리 기록 안 됨' 안내가 뜨지만 시간 측정 흐름은 끝까지 된다.
 */
test("S1 학생이 TXT 대본을 편집하고 목표보다 일찍 끝난 결과와 저장된 대본을 확인한다", async ({ page }) => {
  // 1. 첫 화면의 온보딩에서 '건너뛰기'를 누른다
  await openMain(page)
  const panel = page.getByRole("complementary", { name: "대본" })
  await panel.getByRole("button", { name: "대본 편집", exact: true }).click()
  await page.getByLabel("TXT 파일 선택").setInputFiles({ name: "가상대본.txt", mimeType: "text/plain", buffer: Buffer.from("오늘은 도서관 이용 방법을 소개합니다.", "utf8") })
  const editor = panel.getByRole("textbox", { name: "대본", exact: true })
  await expect(editor).toHaveValue("오늘은 도서관 이용 방법을 소개합니다.")
  const revised = "오늘은 도서관 이용 방법을 소개합니다. 대출 기간은 2주입니다."
  await editor.fill(revised)
  // 2. '목표 시간 분'에 0, '목표 시간 초'에 6을 입력한다
  await setTarget(page, "0", "6")
  // 3. '녹화 시작'을 누른다
  await page.getByRole("button", { name: "녹화 시작" }).click()
  // 4. 경과 시간이 0:02가 될 때까지 기다린다
  await expect(page.getByTestId("elapsed")).toHaveText("0:02")
  await expect(page.getByTestId("time-state")).toHaveText("시간 임박")
  // 5. '녹화 종료'를 누르고 '분석'을 누른다
  await stopAndAnalyze(page)

  // expected: 총 연습 시간이 목표(0:06)보다 짧게 나오고 '일찍 끝났어요'와 음수 차이가 표시된다
  const result = page.getByRole("region", { name: "연습 결과" })
  await expect(result.getByTestId("target")).toHaveText("0:06")
  await expect(result.getByTestId("diff")).toContainText("일찍 끝났어요")
  await expect(result.getByTestId("diff")).toContainText("(-0:0")
  const total = (await result.getByTestId("total").innerText()).match(/^(\d+):(\d{2})/)
  expect(Number(total![1]) * 60 + Number(total![2])).toBeLessThan(6)
  await page.reload()
  await panel.getByRole("button", { name: "대본 편집", exact: true }).click()
  await expect(editor).toHaveValue(revised)
  await expect(page.getByTestId("script-file-name")).toContainText("가상대본.txt")
  await expect(page.getByTestId("script-file-name")).toContainText("수정함")
  await expect(result.getByTestId("target")).toHaveText("0:06")
})
