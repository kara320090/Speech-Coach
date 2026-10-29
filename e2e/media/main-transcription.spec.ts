import { expect, test, type Page } from "@playwright/test"
import { openMain, setTarget } from "../fixtures/flow"

async function record(page: Page) {
  await openMain(page); await setTarget(page, "0", "30")
  await page.getByRole("button", { name: "녹화 시작", exact: true }).click()
  await expect(page.getByTestId("elapsed")).toHaveText("0:02")
  await page.getByRole("button", { name: "녹화 종료", exact: true }).click()
  await expect(page.getByRole("button", { name: "분석", exact: true })).toBeEnabled()
}
async function mockReady(page: Page, ready = true) {
  await page.route("**/api/model-status", r => r.fulfill({ json: { provider: "local", transcriptionConfigured: true, runtime: { transcriptionReady: ready } } }))
}

test("main analyze transcribes WAV once, shows speed/fillers, persists transcript and seeks", async ({ page }) => {
  let requests = 0
  await mockReady(page)
  await page.route("**/api/transcribe", async r => {
    requests++
    expect(r.request().headers()["content-type"]).toBe("audio/wav")
    expect(r.request().postDataBuffer()?.subarray(0, 4).toString()).toBe("RIFF")
    await r.fulfill({ json: { text: "음 어 안녕하세요 발표를 시작합니다", segments: [{ text: "음 어 안녕하세요 발표를 시작합니다", startSecond: 0.2, endSecond: 1.8 }] } })
  })
  await record(page); expect(requests).toBe(0)
  await page.getByRole("button", { name: "분석", exact: true }).click()
  await expect(page.getByRole("region", { name: "연습 결과", exact: true })).toBeVisible()
  await expect(page.getByTestId("avg-speed")).toContainText("음절/분")
  await expect(page.getByTestId("filler-total")).toContainText("2회")
  await page.getByText(/인식된 글 보기/).click()
  await expect(page.getByText(/0:00~0:01 음 어 안녕하세요/)).toBeVisible()
  await page.getByRole("list", { name: "검토할 구간 목록" }).getByRole("button").filter({ hasText: "군말" }).first().click()
  await expect(page.locator("#seek-status")).toContainText("재생 위치를")
  expect(requests).toBe(1)
  await page.reload(); await expect(page.getByTestId("filler-total")).toContainText("2회")
  await expect(page.getByTestId("avg-speed")).toContainText("음절/분")
})

test("PC offline preserves recording and local results without posting audio", async ({ page }) => {
  await mockReady(page, false)
  let calls = 0; page.on("request", r => { if (r.url().endsWith("/api/transcribe")) calls++ })
  await record(page); await page.getByRole("button", { name: "분석", exact: true }).click()
  await expect(page.getByRole("region", { name: "연습 결과", exact: true })).toBeVisible()
  await expect(page.getByTestId("avg-speed")).toContainText("준비되지")
  await expect(page.getByTestId("filler-total")).not.toContainText("0회")
  expect(calls).toBe(0)
  await expect(page.locator("video#player, audio#player")).toHaveCount(1)
  await page.reload(); await expect(page.locator("video#player, audio#player")).toHaveCount(1)
})

test("cancelling transcription preserves the original recording and unlocks recording", async ({ page }) => {
  await mockReady(page)
  let release: (() => void) | undefined
  await page.route("**/api/transcribe", async r => {
    await new Promise<void>(resolve => { release = resolve })
    await r.fulfill({ json: { text: "", segments: [] } }).catch(() => {})
  })
  await record(page); await page.getByRole("button", { name: "분석", exact: true }).click()
  await expect(page.getByRole("button", { name: "전사 취소하고 기본 결과 보기", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "녹화 시작", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "전사 취소하고 기본 결과 보기", exact: true }).click(); release?.()
  await expect(page.getByRole("region", { name: "연습 결과", exact: true })).toBeVisible()
  await expect(page.getByTestId("avg-speed")).toContainText("취소")
  await expect(page.locator("video#player, audio#player")).toHaveCount(1)
  await expect(page.getByRole("button", { name: "녹화 시작", exact: true })).toBeEnabled()
})

test("the explicit post-recording transcription opt-out sends no audio", async ({ page }) => {
  let calls = 0; page.on("request", r => { if (r.url().endsWith("/api/transcribe")) calls++ })
  await openMain(page); await setTarget(page, "0", "30")
  await page.getByText("연습 설정", { exact: true }).click()
  await page.getByLabel("분석할 때 자체 AI로 음성 전사·군말·말하기 속도 분석").uncheck()
  await page.getByRole("button", { name: "녹화 시작", exact: true }).click()
  await expect(page.getByTestId("elapsed")).toHaveText("0:02")
  await page.getByRole("button", { name: "녹화 종료", exact: true }).click()
  await page.getByRole("button", { name: "분석", exact: true }).click()
  await expect(page.getByTestId("avg-speed")).toContainText("꺼서")
  expect(calls).toBe(0)
})
