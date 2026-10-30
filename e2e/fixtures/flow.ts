import { expect, type Page } from "@playwright/test"

/** 첫 화면에서 메뉴로 기본 연습에 들어가 사용 방법을 건너뛴다. */
export async function openMain(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "바로 서비스 이용하기", exact: true }).click()
  await page.getByRole("link", { name: "기본 연습 화면", exact: true }).click()
  await page.getByRole("button", { name: "건너뛰기" }).click()
  await expect(page.getByRole("button", { name: "녹화 시작" })).toBeVisible()
}

/** 목표 시간을 분·초로 입력한다. */
export async function setTarget(page: Page, min: string, sec: string) {
  await page.getByLabel("목표 시간 분").fill(min)
  await page.getByLabel("목표 시간 초").fill(sec)
}

/** 녹화를 끝내고 분석까지 누른다. */
export async function stopAndAnalyze(page: Page) {
  await page.getByRole("button", { name: "녹화 종료" }).click()
  await page.getByRole("button", { name: "분석", exact: true }).click()
}
