import { expect, test } from "@playwright/test"
import path from "node:path"
import { openMain } from "../fixtures/flow"

test("S7 학생이 한국어 음성 파일을 자체 AI로 전사해 말하기 속도와 군말 후보를 확인한다", async ({ page }) => {
  await openMain(page)
  await page.getByRole("link", { name: "영상 불러오기", exact: true }).click()
  await page.locator("#f-file").setInputFiles(path.join(__dirname, "../fixtures/korean-synthetic.wav"))
  await page.getByLabel("목표 시간 분").fill("0")
  await page.getByLabel("목표 시간 초").fill("20")
  await page.getByLabel("글자로도 바꿔서 말하기 속도·반복 표현 분석").check()
  await page.getByRole("button", { name: "분석 시작", exact: true }).click()
  await expect(page.getByRole("region", { name: "연습 결과", exact: true })).toBeVisible({ timeout: 90000 })
  await expect(page.getByTestId("avg-speed")).toHaveText(/^[1-9]\d* 음절\/분/)
  await expect(page.getByTestId("filler-total")).toHaveText(/인식된 글에서 \d+회 · \d+종류/)
  await expect(page.getByTestId("total")).toContainText("0:08")
  await expect(page.getByTestId("target")).toHaveText("0:20")
  await page.getByText(/인식된 글 보기/).click()
  await expect(page.locator("details").filter({ hasText: "인식된 글 보기" })).toContainText("발표")
  const speed = await page.getByTestId("avg-speed").innerText()
  await page.reload()
  await page.getByText(/인식된 글 보기/).click()
  await expect(page.locator("details").filter({ hasText: "인식된 글 보기" })).toContainText("발표")
  await expect(page.getByTestId("avg-speed")).toHaveText(speed)
  await expect(page.getByTestId("filler-total")).toHaveText(/인식된 글에서 \d+회/)
})
