import { test, expect, type Page } from "@playwright/test"
import path from "node:path"
import { makeWav } from "../fixtures/make-wav"

const blankVideo = path.join(__dirname, "../fixtures/blank-30s.webm")
async function importVideo(page: Page, analyze = false) {
  await page.addInitScript(() => localStorage.setItem("dasibom.onboarded", "1"))
  await page.goto("/import.html")
  await page.locator("#f-file").setInputFiles(blankVideo)
  await page.getByLabel("목표 시간 초").fill("30")
  if (analyze) await page.getByLabel("영상 눈 깜빡임도 이 기기에서 분석").check()
  await page.getByRole("button", { name: "분석 시작", exact: true }).click()
}

test("real vendored model loads under CSP and processes a blank frame (not face accuracy)", async ({ page }) => {
  const external: string[] = [], violations: string[] = []
  page.on("request", (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith("http://localhost")) external.push(r.url()) })
  page.on("console", (m) => { if (/violat.*Content Security Policy/i.test(m.text())) violations.push(m.text()) })
  await page.goto("/")
  const count = await page.evaluate(async () => {
    const { createBlinkDetector } = await import("/js/video-analysis.js")
    const detector = await createBlinkDetector()
    try {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 240
      canvas.getContext("2d")!.fillRect(0, 0, 320, 240)
      return detector.detectForVideo(canvas, 0).faceBlendshapes.length
    } finally { detector.close() }
  })
  expect(count).toBe(0); expect(external).toEqual([]); expect(violations).toEqual([])
})

test("video without audio imports; real no-face analysis shows unavailable and coverage, no uploads", async ({ page }) => {
  const uploads: string[] = []
  page.on("request", (r) => { if (r.method() === "POST") uploads.push(r.url()) })
  await importVideo(page, true)
  await expect(page.getByTestId("blink-status")).toContainText("측정 못 함", { timeout: 90000 })
  await expect(page.getByRole("region", { name: "눈 깜빡임 측정" })).toContainText("얼굴 측정 불가 100.0%")
  await expect(page.getByTestId("total")).toContainText("0:30")
  expect(uploads).toEqual([])
})

test("fake blendshapes: import -> counted review -> video seek -> IndexedDB reload", async ({ page }) => {
  // 실제 영상 디코딩·시간 이동과 순수 계산을 사용. 모델 결과만 합성; 실제 사람 정확도 검사가 아님.
  await page.route("**/js/video-analysis.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    import { analyzeVideoBlinks as run, readVideoDuration } from '/js/video-analysis.js?real';
    export { readVideoDuration };
    export const analyzeVideoBlinks = (blob, options) => run(blob, { ...options, detectorFactory: async () => ({
      detectForVideo(video, ms) { const t = ms / 1000; const closed = [11,13,15].some(s => t >= s && t < s + .2); return { faceBlendshapes: [{ categories: [
        { categoryName:'eyeBlinkLeft', score:closed ? .9 : .1 }, { categoryName:'eyeBlinkRight', score:closed ? .9 : .1 }
      ] }] }; }, close() {}
    }) });` }))
  await importVideo(page, true)
  await expect(page.getByTestId("blink-status")).toContainText("총 3회", { timeout: 60000 })
  const item = page.locator('[data-type="blink"]')
  await expect(item).toHaveCount(1); await expect(item).toContainText("다른 구간 평균 0.0")
  await item.getByRole("button").click()
  await expect(page.locator("#seek-status")).toContainText("0:10")
  await expect.poll(() => page.locator("video#player").evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(10)
  await page.reload()
  await expect(page.getByTestId("blink-status")).toContainText("총 3회")
})

test("model loading failure and cancellation preserve the existing result", async ({ page }) => {
  await importVideo(page)
  await expect(page.getByTestId("total")).toBeVisible()
  await page.route("**/vendor/mediapipe/**", (route) => route.abort())
  await page.getByRole("button", { name: "눈 깜빡임 분석", exact: true }).click()
  await expect(page.getByTestId("blink-status")).toContainText("모델을 불러오지 못했어요")
  await expect(page.getByTestId("total")).toContainText("0:30")
  // 로딩을 끝내지 않는 테스트 모델에서도 취소 즉시 기존 결과를 사용할 수 있어야 한다.
  await page.route("**/js/video-analysis.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    import { analyzeVideoBlinks as run, readVideoDuration } from '/js/video-analysis.js?real';
    export { readVideoDuration };
    export const analyzeVideoBlinks = (blob, options) => run(blob, { ...options, detectorFactory: () => new Promise(() => {}) });` }))
  await page.reload()
  await page.getByRole("button", { name: "눈 깜빡임 다시 분석", exact: true }).click()
  await expect(page.getByTestId("blink-status")).toContainText("모델을 읽는 중")
  await page.getByRole("button", { name: "눈 깜빡임 분석 취소" }).click()
  await expect(page.getByTestId("blink-status")).toContainText("취소했어요")
  await expect(page.getByRole("button", { name: "같은 조건으로 다시 연습" })).toBeEnabled()
})

test("AI transcript candidates are counted locally with seekable evidence; audio has no face metric", async ({ page }) => {
  let posts = 0
  await page.route("**/api/transcribe", (route) => { posts++; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ text: "음 어 음악 음", segments: [{ text: "음 어 음악 음", startSecond: 2, endSecond: 4 }] }) }) })
  await page.addInitScript(() => localStorage.setItem("dasibom.onboarded", "1"))
  await page.goto("/import.html")
  await page.locator("#f-file").setInputFiles({ name: "synthetic.wav", mimeType: "audio/wav", buffer: makeWav([[10, true]]) })
  await page.getByLabel("목표 시간 초").fill("10")
  await page.getByLabel("글자로도 바꿔서 말하기 속도·반복 표현 분석").check()
  await page.getByRole("button", { name: "분석 시작", exact: true }).click()
  await expect(page.getByTestId("filler-total")).toHaveText("인식된 글에서 3회 · 2종류")
  await expect(page.locator('[data-type="filler"]')).toContainText("“음” 2회")
  await page.locator('[data-type="filler"]').getByRole("button").click()
  await expect(page.locator("#seek-status")).toContainText("0:02")
  await expect(page.getByRole("button", { name: "눈 깜빡임 분석", exact: true })).toBeDisabled()
  expect(posts).toBe(1)
})
