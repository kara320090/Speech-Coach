import { expect, test } from "@playwright/test"
import { openMain, setTarget, stopAndAnalyze } from "../fixtures/flow"

// 장치는 있지만 권한 요청을 거부하는 상황(--deny-permission-prompts)
test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--deny-permission-prompts"] },
  permissions: [],
})

test("권한이 거부되면 시간만 재고, 결과에 기록이 없다고 알린다", async ({ page }) => {
    await openMain(page)
    await expect(page.getByText("카메라와 마이크를 쓸 수 없어요")).toBeVisible()
    await setTarget(page, "0", "20")
    await page.getByRole("button", { name: "녹화 시작" }).click()
    await expect(page.getByRole("button", { name: "녹화 종료" })).toBeEnabled()
    await expect(page.locator(".notice")).toContainText("녹음 없이 시간만 측정해요")
    await expect(page.getByTestId("rec-status")).toContainText("소리 기록 안 됨")
    await expect(page.getByTestId("elapsed")).toHaveText("0:02")
    await stopAndAnalyze(page)
    await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()
    await expect(page.getByText("소리를 기록하지 못해서")).toBeVisible()
    await expect(page.locator("audio#player, video#player")).toHaveCount(0)
  })
