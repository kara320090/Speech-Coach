import { expect, test, type Page } from "@playwright/test"

const clock = (t: string) => {
  const m = t.match(/(\d+):(\d{2})/)!
  return Number(m[1]) * 60 + Number(m[2])
}

async function startPractice(page: Page, { seconds = "30", video = false, speech = false, extra = async () => {} } = {}) {
  await page.goto("/")
  await page.getByLabel("목표 시간 초").fill(seconds)
  if (video) await page.getByLabel("웹캠 영상도 기록").check()
  if (speech) await page.getByLabel("음성 인식으로 말하기 속도").check()
  await extra()
  await page.getByRole("button", { name: "연습 시작" }).click()
  await expect(page.getByRole("button", { name: "연습 종료" })).toBeVisible()
}

test.describe("가짜 마이크·웹캠으로 기록하고 구간으로 이동", () => {
  test("소리+웹캠 영상 기록 → 긴 침묵 표시 → 눌러서 영상 구간으로 이동", async ({ page }) => {
    await startPractice(page, { seconds: "20", video: true })
    await expect(page.getByTestId("rec-status")).toContainText("소리 기록 중")
    await expect(page.getByTestId("rec-status")).toContainText("영상 기록 중")
    await expect(page.getByTestId("elapsed")).toHaveText("0:14")
    await page.getByRole("button", { name: "연습 종료" }).click()

    const result = page.getByRole("region", { name: "연습 결과" })
    await expect(result).toBeVisible()
    // 긴 침묵: 6~11초 무음 → 약 5초
    const item = page.getByRole("list", { name: "검토할 구간 목록" }).getByRole("listitem").filter({ hasText: "긴 침묵" })
    await expect(item).toHaveCount(1)
    const start = Number(await item.getByRole("button").getAttribute("data-start"))
    expect(start).toBeGreaterThan(5)
    expect(start).toBeLessThan(7.5)
    const measured = await item.innerText()
    const len = Number(measured.match(/측정값: ([\d.]+)초/)![1])
    expect(len).toBeGreaterThan(4)
    expect(len).toBeLessThan(6.5)
    expect(measured).toContain("근거:")

    // 영상 플레이어: 길이를 알 수 있어야 이동한다
    const video = page.locator("video#player")
    await expect(video).toBeVisible()
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Number.isFinite(v.duration) && v.duration > 10)).toBe(true)
    await item.getByRole("button").click()
    await expect(page.locator("#seek-status")).toContainText("재생 위치를")
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThanOrEqual(start - 0.3)
    const at = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
    expect(at).toBeLessThan(start + 3)
    const dur = await video.evaluate((v: HTMLVideoElement) => v.duration)
    expect(Math.abs(dur - 15)).toBeLessThan(2.5) // 연습한 길이와 비슷해야 한다
  })

  test("소리만 기록 → 긴 침묵 → 눌러서 녹음 구간으로 이동", async ({ page }) => {
    await startPractice(page, { seconds: "20" })
    await expect(page.getByTestId("rec-status")).toContainText("소리 기록 중")
    await expect(page.getByTestId("elapsed")).toHaveText("0:13")
    await page.getByRole("button", { name: "연습 종료" }).click()
    await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()
    const item = page.getByRole("list", { name: "검토할 구간 목록" }).getByRole("listitem").filter({ hasText: "긴 침묵" })
    await expect(item).toHaveCount(1)
    const start = Number(await item.getByRole("button").getAttribute("data-start"))
    expect(start).toBeGreaterThan(5)
    expect(start).toBeLessThan(7.5)
    const audio = page.locator("audio#player")
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration > 10)).toBe(true)
    await item.getByRole("button").click()
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThanOrEqual(start - 0.3)
    expect(await audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeLessThan(start + 3)
  })

  test("일시정지 시간은 연습 시간과 기록에서 빠진다", async ({ page }) => {
    await startPractice(page, { seconds: "30" })
    await expect(page.getByTestId("elapsed")).toHaveText("0:02")
    await page.getByRole("button", { name: "일시정지" }).click()
    await expect(page.getByRole("button", { name: "다시 시작" })).toBeVisible()
    await page.waitForTimeout(3000)
    const frozen = await page.getByTestId("elapsed").innerText()
    expect(clock(frozen)).toBeLessThanOrEqual(3)
    await page.getByRole("button", { name: "다시 시작" }).click()
    await expect(page.getByTestId("elapsed")).toHaveText("0:05")
    await page.getByRole("button", { name: "연습 종료" }).click()
    const total = clock(await page.getByTestId("total").innerText())
    expect(total).toBeGreaterThanOrEqual(5)
    expect(total).toBeLessThanOrEqual(7) // 3초 멈춘 시간이 들어가면 8초 이상이 된다
    // 녹음 길이도 연습 시간과 맞아야 한다(멈춘 동안 기록하지 않음)
    const audio = page.locator("audio#player")
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeGreaterThan(total - 1.5)
    expect(await audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeLessThan(total + 1.5)
  })
})

test.describe("외부 음성 인식 비활성화", () => {
  test("브라우저 음성 인식 구현이 있어도 외부 처리 경로를 시작하지 않는다", async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as any).externalSpeechCalls = 0
      ;(window as any).SpeechRecognition = class { start() { (window as any).externalSpeechCalls++ } }
    })
    await page.goto("/")
    await expect(page.getByLabel("음성 인식으로 말하기 속도")).toBeDisabled()
    await expect(page.getByText("외부 음성 인식은 사용하지 않아요.", { exact: false })).toBeVisible()
    await page.getByLabel("목표 시간 초").fill("20")
    await page.getByRole("button", { name: "연습 시작" }).click()
    await page.getByRole("button", { name: "연습 종료" }).click()
    expect(await page.evaluate(() => (window as any).externalSpeechCalls)).toBe(0)
  })

})

test.describe("실패 상황", () => {
  test("음성 인식이 없는 브라우저: 자체 파일 전사 안내와 미측정 상태를 표시한다", async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as any).SpeechRecognition
      delete (window as any).webkitSpeechRecognition
    })
    await page.goto("/")
    await expect(page.getByLabel("음성 인식으로 말하기 속도")).toBeDisabled()
    await expect(page.getByText("외부 음성 인식은 사용하지 않아요.")).toBeVisible()
    await page.getByLabel("목표 시간 초").fill("20")
    await page.getByRole("button", { name: "연습 시작" }).click()
    await expect(page.getByTestId("speed")).toContainText("측정 안 함")
    await page.getByRole("button", { name: "연습 종료" }).click()
    await expect(page.getByTestId("avg-speed")).toContainText("측정 못 함")
  })

  test("기록 저장에 실패해도 결과는 보이고 저장 실패를 알린다", async ({ page }) => {
    await page.addInitScript(() => {
      indexedDB.open = () => {
        throw new Error("저장소를 열 수 없는 테스트 상황")
      }
    })
    await startPractice(page, { seconds: "20" })
    await expect(page.getByTestId("elapsed")).toHaveText("0:02")
    await page.getByRole("button", { name: "연습 종료" }).click()
    await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()
    await expect(page.getByText("기록을 이 기기에 저장하지 못했어요")).toBeVisible()
    await expect(page.getByTestId("total")).toBeVisible()
  })
})

test("소리를 기록한 두 연습: 같은 조건 비교에 검토 구간 수가 나란히 나온다", async ({ page }) => {
  await startPractice(page, { seconds: "20" })
  await expect(page.getByTestId("elapsed")).toHaveText("0:12")
  await page.getByRole("button", { name: "연습 종료" }).click()
  await expect(page.getByTestId("no-compare")).toBeVisible()
  await page.getByRole("button", { name: "같은 조건으로 다시 연습" }).click()
  await page.getByRole("button", { name: "연습 시작" }).click()
  await expect(page.getByTestId("elapsed")).toHaveText("0:12")
  await page.getByRole("button", { name: "연습 종료" }).click()
  const table = page.getByTestId("compare-table")
  const silenceRow = table.getByRole("row", { name: /검토 구간: 긴 침묵/ })
  await expect(silenceRow).toBeVisible()
  const cells = await silenceRow.getByRole("cell").allInnerTexts()
  expect(cells[1]).toMatch(/^\d+개$/)
  expect(cells[2]).toMatch(/^\d+개$/)
  const speedRow = table.getByRole("row", { name: /평균 속도/ })
  await expect(speedRow).toContainText("비교 불가")
  await expect(table).not.toContainText("점수")
})
