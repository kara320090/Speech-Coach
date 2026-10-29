import { expect, test } from "@playwright/test"
import { openMain, setTarget, stopAndAnalyze } from "../fixtures/flow"

test("S5 학생이 TXT 대본을 불러와 수정하고 녹화 기록에서 같은 대본을 다시 확인한다", async ({ page }) => {
  await openMain(page)
  const panel = page.getByRole("complementary", { name: "대본" })
  await panel.getByRole("button", { name: "대본 편집", exact: true }).click()
  await page.getByLabel("TXT 파일 선택").setInputFiles({ name: "가상대본.txt", mimeType: "text/plain", buffer: Buffer.from("오늘은 도서관 이용 방법을 소개합니다.", "utf8") })
  const editor = panel.getByRole("textbox", { name: "대본", exact: true })
  await expect(editor).toHaveValue("오늘은 도서관 이용 방법을 소개합니다.")
  const revised = "오늘은 도서관 이용 방법을 소개합니다. 대출 기간은 2주입니다."
  await editor.fill(revised)
  await setTarget(page, "0", "10")
  await page.getByRole("button", { name: "녹화 시작", exact: true }).click()
  await expect(page.getByTestId("elapsed")).toHaveText("0:02")
  await stopAndAnalyze(page)
  await expect(page.getByRole("region", { name: "연습 결과", exact: true })).toBeVisible()
  await page.reload()
  await panel.getByRole("button", { name: "대본 편집", exact: true }).click()
  await expect(editor).toHaveValue(revised)
  await expect(page.getByTestId("script-file-name")).toContainText("가상대본.txt")
  await expect(page.getByTestId("script-file-name")).toContainText("수정함")
  await expect(page.getByTestId("target")).toHaveText("0:10")
})
