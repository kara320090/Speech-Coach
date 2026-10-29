import { expect, test, type Page } from "@playwright/test"
import { makeWav } from "../fixtures/make-wav"

const wav10 = () => makeWav([[3, true], [5, false], [2, true]])

async function openImport(page: Page, { text = false, seconds = "10" } = {}) {
  await page.goto("/import.html")
  await page.locator("#f-file").setInputFiles({ name: "연습.wav", mimeType: "audio/wav", buffer: wav10() })
  await page.getByLabel("목표 시간 초").fill(seconds)
  if (text) await page.getByLabel("글자로도 바꿔서 말하기 속도·반복 표현 분석").check()
  await page.getByRole("button", { name: "분석 시작" }).click()
}

test.describe("영상·소리 파일 불러오기", () => {
  test("메뉴에서 소리 파일을 불러와 긴 침묵 구간을 확인하고 눌러서 그 위치로 이동한다", async ({ page }) => {
    await page.goto("/")
    // 1. 첫 화면의 '영상 불러오기'를 누른다
    await page.getByRole("link", { name: "영상 불러오기" }).click()
    await expect(page.getByRole("heading", { name: "영상·소리 파일 불러오기" })).toBeVisible()
    // 2. 소리 파일을 고른다
    await page.locator("#f-file").setInputFiles({ name: "연습.wav", mimeType: "audio/wav", buffer: makeWav([[3, true], [5, false], [2, true]]) })
    // 3. 목표 시간 초에 10을 입력한다
    await page.getByLabel("목표 시간 초").fill("10")
    // 4. '분석 시작'을 누른다
    await page.getByRole("button", { name: "분석 시작" }).click()
  
    // expected: 결과 화면에 총 시간 0:10, 목표와의 차이, 긴 침묵 구간이 나오고 항목을 누르면 재생 위치가 이동한다
    const result = page.getByRole("region", { name: "연습 결과" })
    await expect(result).toBeVisible()
    await expect(page).toHaveURL(/#\/result\//)
    await expect(result.getByTestId("total")).toContainText("0:10")
    await expect(result.getByTestId("target")).toHaveText("0:10")
    const item = page.getByRole("list", { name: "검토할 구간 목록" }).getByRole("listitem").filter({ hasText: "긴 침묵" })
    await expect(item).toHaveCount(1)
    const start = Number(await item.getByRole("button").getAttribute("data-start"))
    expect(start).toBeGreaterThan(2.5)
    expect(start).toBeLessThan(3.6)
    const len = Number((await item.innerText()).match(/측정값: ([\d.]+)초/)![1])
    expect(len).toBeGreaterThan(4)
    expect(len).toBeLessThan(5.6)
    const audio = page.locator("audio#player")
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.duration)).toBeGreaterThan(9)
    await item.getByRole("button").click()
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThanOrEqual(start - 0.3)
    // 글자 변환을 켜지 않았으니 속도·반복은 분석하지 않았다고 알린다
    await expect(result).toContainText("음성 인식을 켜지 않아서")
    await expect(page.getByText("영상 파일은 서버로 보내지 않았어요")).toBeVisible()
  })

  test("글자 변환을 켜면 소리 조각이 /api/transcribe로 가고, 돌아온 글로 속도·반복 표현을 분석한다 (게이트웨이는 가짜)", async ({ page }) => {
    const requests: { type: string; size: number }[] = []
    await page.route("**/api/transcribe", async (route) => {
      const req = route.request()
      requests.push({ type: req.headers()["content-type"], size: req.postDataBuffer()?.length ?? 0 })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          text: "그 그 그러니까 오늘 발표를 시작하겠습니다 음악 음악 음악 이야기를 하겠습니다",
          segments: [
            { text: "그 그 그러니까 오늘 발표를 시작하겠습니다", startSecond: 0.2, endSecond: 2.8 },
            { text: "음악 음악 음악 이야기를 하겠습니다", startSecond: 8.2, endSecond: 9.8 },
          ],
        }),
      })
    })
    await openImport(page, { text: true })
    const result = page.getByRole("region", { name: "연습 결과" })
    await expect(result).toBeVisible()
    expect(requests).toHaveLength(1) // 10초 파일은 한 조각
    expect(requests[0].type).toBe("audio/wav")
    expect(requests[0].size).toBeGreaterThan(10 * 16000 * 2) // 영상 파일이 아니라 16kHz 16bit 모노 WAV 조각
    const items = page.getByRole("list", { name: "검토할 구간 목록" })
    await expect(items).toContainText("긴 침묵")
    await expect(items).toContainText('같은 말을 이어서 반복: "그"')
    await expect(items).toContainText('"음악"')
    await expect(page.getByTestId("avg-speed")).toContainText("음절/분")
    await expect(page.getByText("인식된 글 보기")).toBeVisible()
    await expect(page.getByText("외부 음성 인식 서비스로 보내 글자로 바꿨어요")).toBeVisible()
  })

  test("서버에 AI 키가 없으면 글자 변환만 건너뛰고 긴 침묵 찾기는 그대로 한다", async ({ page }) => {
    await page.route("**/api/transcribe", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "not-configured", message: "서버에 AI_GATEWAY_API_KEY가 설정되어 있지 않아서 글자 변환을 쓸 수 없어요." }) }),
    )
    await openImport(page, { text: true })
    await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()
    await expect(page.getByRole("list", { name: "검토할 구간 목록" })).toContainText("긴 침묵")
    await expect(page.getByText("글자로 바꾸지 못해서 속도·반복 표현은 분석하지 않았어요")).toBeVisible()
    await expect(page.getByTestId("avg-speed")).toContainText("측정 못 함")
  })

  test("글자 변환을 켜지 않으면 /api/transcribe를 부르지 않는다", async ({ page }) => {
    let called = 0
    await page.route("**/api/transcribe", (route) => {
      called++
      return route.abort()
    })
    await openImport(page)
    await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()
    expect(called).toBe(0)
  })

  test("입력이 잘못되면 이유를 알리고, 읽을 수 없는 파일은 안내한다", async ({ page }) => {
    await page.goto("/import.html")
    await page.getByRole("button", { name: "분석 시작" }).click()
    const alert = page.getByRole("alert").filter({ hasText: "입력을 확인해 주세요" })
    await expect(alert).toContainText("불러올 영상 또는 소리 파일을 골라 주세요")
    await expect(alert).toContainText("목표 시간을 입력해 주세요")
    await page.locator("#f-file").setInputFiles({ name: "가짜.mp4", mimeType: "video/mp4", buffer: Buffer.from("이건 영상이 아니에요") })
    await page.getByLabel("목표 시간 초").fill("10")
    await page.getByRole("button", { name: "분석 시작" }).click()
    await expect(page.getByRole("heading", { name: "파일을 분석하지 못했어요" })).toBeVisible()
    await expect(page.getByRole("alert")).toContainText("읽지 못했어요")
  })
})
