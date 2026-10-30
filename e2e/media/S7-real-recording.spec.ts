// Supplementary evidence only: replay the supplied real clip through virtual devices.
// All transcription/revision calls use the configured real Gateway; no fixture responses.
import { expect, test } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
const recording = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "../fixtures/make-real-recording.mjs")], { encoding: "utf8" }))
const SCRIPT = "네, 안녕하세요. 잘 잘 부탁드립니다. 네?"
test.use({
  permissions: ["camera", "microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${recording.camera}`, `--use-file-for-fake-audio-capture=${recording.mic}`, "--autoplay-policy=no-user-gesture-required"] },
  video: { mode: "on", size: { width: 1440, height: 900 } },
})
test("녹화 입력 재생과 실제 AI로 녹화·전사·코칭·수정·재연습을 증빙한다", async ({ page }, info) => {
  test.setTimeout(180_000)
  const started = Date.now(), windows: { startMs: number, endMs: number }[] = []
  const calls: { path: string, status: number }[] = [], errors: string[] = []
  page.on("pageerror", e => errors.push(e.message))
  page.on("response", r => { if (r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/api/")) calls.push({ path: new URL(r.url()).pathname, status: r.status() }) })
  const pace = Math.min(5000, Math.max(0, Number(process.env.RECORDING_DEMO_PACE_MS) || 0))
  const checkpoint = async (name: string) => {
    const target = info.outputPath(`${name}.png`)
    await page.screenshot({ path: target })
    await info.attach(name, { path: target, contentType: "image/png" })
    if (pace) await page.waitForTimeout(pace)
  }
  await page.goto("/")
  await page.getByRole("button", { name: "바로 서비스 이용하기", exact: true }).click()
  await page.getByLabel("발표 대본", { exact: true }).fill(SCRIPT)
  await page.getByRole("checkbox", { name: /녹음 소리를 AI로 전사하는 데 동의해요/ }).check()
  await checkpoint("01-녹화입력에-맞춘-인사-연습")
  await page.getByRole("button", { name: "카메라 확인하기", exact: true }).click()
  await page.getByRole("button", { name: "녹화 시작", exact: true }).click()
  const baseWindow = { startMs: Date.now() - started, endMs: 0 }
  await page.waitForTimeout(18000)
  baseWindow.endMs = Date.now() - started
  windows.push(baseWindow)
  await page.getByRole("button", { name: "연습 종료", exact: true }).click()
  await expect(page.getByRole("button", { name: "이 시점의 대본 확인", exact: true })).toBeVisible({ timeout: 60000 })
  await expect(page.locator("video").first()).toHaveAttribute("src", /^blob:/)
  await expect(page.locator(".summary-metrics")).toContainText(/\d+ 음절\/분/)
  await checkpoint("02-실제-Gateway-전사와-분석")
  await page.getByRole("button", { name: "이 시점의 대본 확인", exact: true }).click()
  await page.getByRole("button", { name: /네, 안녕하세요/ }).click()
  await page.getByRole("button", { name: /^(맞아요|이 문장으로 할게요)$/ }).click()
  await page.getByRole("button", { name: "AI 코칭 시작", exact: true }).click()
  await page.getByRole("checkbox", { name: /선택한 대본·근거 자료·답변/ }).check()
  await page.getByRole("button", { name: "동의하고 대화 시작", exact: true }).click()
  await page.getByRole("button", { name: "문장이 말하기 어색했어요", exact: true }).click()
  await page.getByLabel("답변 입력", { exact: true }).fill("같은 인사말을 반복했어요. 인사말을 짧고 자연스럽게 정리하고 싶어요.")
  await page.getByRole("button", { name: "보내기", exact: true }).click()
  await expect(page.getByText("대화 요약", { exact: true })).toBeVisible()
  await checkpoint("03-실제-상황-대화")
  const response = page.waitForResponse(r => r.url().endsWith("/api/scripts/revise-segment") && r.request().method() === "POST", { timeout: 60000 })
  await page.getByRole("button", { name: "이 문단 고치기", exact: true }).click()
  const revised = await response
  expect(revised.ok()).toBe(true)
  const revision = await revised.json()
  expect(revision.model).toMatch(/^google\//)
  expect(revision.revision.text.trim().length).toBeGreaterThan(0)
  expect(revision.revision.text).not.toBe(SCRIPT)
  await expect(page.getByRole("button", { name: "수정안 적용하기", exact: true })).toBeDisabled()
  await checkpoint("04-실제-Gateway-수정안")
  await page.getByRole("checkbox", { name: /수치·조건·부정 표현과 원래 뜻/ }).check()
  await page.getByRole("button", { name: "수정안 적용하기", exact: true }).click()
  await page.getByRole("button", { name: "구간 녹화 시작", exact: true }).click()
  const retryWindow = { startMs: Date.now() - started, endMs: 0 }
  await page.waitForTimeout(18000)
  retryWindow.endMs = Date.now() - started
  windows.push(retryWindow)
  await page.getByRole("button", { name: "구간 연습 종료", exact: true }).click()
  await expect(page.getByTestId("practice-compare")).toBeVisible({ timeout: 60000 })
  await page.getByRole("button", { name: "두 영상 함께 재생", exact: true }).click()
  await expect.poll(() => page.locator(".attempt-card video").evaluateAll(v => v.length === 2 && v.every(e => (e as HTMLVideoElement).readyState >= 2 && (e as HTMLVideoElement).currentTime < 30))).toBe(true)
  await checkpoint("05-동일한-녹화입력의-재연습-비교")
  const records = await page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open("speech-coach", 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("sessions"), query = tx.objectStore("sessions").getAll()
      tx.oncomplete = async () => {
        const out = []
        for (const s of query.result.sort((a: any, b: any) => a.createdAt - b.createdAt)) {
          const bytes = new Uint8Array(await s.audioBlob.arrayBuffer())
          let binary = ""
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
          out.push({ id: s.id, script: s.script, totalSec: s.totalSec, audioBase64: btoa(binary), audioBytes: s.audioBlob.size, videoBytes: s.videoBlob?.size || 0, transcript: s.transcript, processing: s.analysis.transcription })
        }
        db.close(); resolve(out)
      }
    }
  }))
  expect(records).toHaveLength(2)
  records.forEach((r, i) => {
    expect(r.audioBytes).toBeGreaterThan(44)
    expect(r.videoBytes).toBeGreaterThan(0)
    fs.writeFileSync(info.outputPath(`app-recording-${i + 1}.wav`), Buffer.from(r.audioBase64, "base64"))
    delete r.audioBase64
  })
  for (const route of ["/api/transcribe", "/api/coach/segment", "/api/scripts/revise-segment"]) expect(calls.some(c => c.path === route && c.status === 200)).toBe(true)
  expect(errors).toEqual([])
  const evidence = info.outputPath("real-recording-evidence.json")
  fs.writeFileSync(evidence, JSON.stringify({ source: "presentation-review.mp4", sourceHash: recording.sourceHash, input: "Replayed real recording via virtual camera/microphone; not a live webcam", ai: "Real Gateway, no fixed responses", scope: "Integration evidence; replaying the same input does not establish learning or presentation improvement", playbackAudioWindows: windows, calls, records, revision: { model: revision.model, durationMs: revision.durationMs } }, null, 2))
  await info.attach("real-recording-evidence", { path: evidence, contentType: "application/json" })
  await page.getByRole("button", { name: "수정 전 대본으로 되돌리기", exact: true }).click()
  await expect(page.getByLabel("발표 대본", { exact: true })).toHaveValue(SCRIPT)
})
