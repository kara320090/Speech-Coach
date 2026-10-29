import { expect, test, type Page } from "@playwright/test"

// 개인정보 없는 가상 대본. 파일은 저장소에 두지 않고 검사 안에서 만든다.
const SCRIPT = "안녕하세요. 오늘은 가상의 도시 숲 가꾸기 계획을 소개하겠습니다.\n\n첫째, 나무 심기 일정입니다.\n둘째, 물 주기 당번표입니다."
const txt = (content: string | Buffer, name = "가상대본.txt", mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8") })

async function pickFile(page: Page, file: ReturnType<typeof txt>) {
  await page.getByLabel("TXT 파일 선택").setInputFiles(file)
}

test.describe("발표 대본 TXT 불러오기", () => {
  test("TXT를 불러와 고친 대본으로 연습하고, 기록·다시 연습에 그 대본이 이어진다", async ({ page }) => {
    await page.goto("/")
    const area = page.getByLabel("대본 내용 (직접 붙여넣기·수정)")
    // 1. TXT 파일을 고른다 → 파일명과 내용(한글·줄바꿈)이 입력란에 보인다
    await pickFile(page, txt(SCRIPT))
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일: 가상대본.txt")
    await expect(area).toHaveValue(SCRIPT)
    // 2. 입력란에서 대본을 고친다
    const edited = `${SCRIPT}\n셋째, 마무리 인사입니다.`
    await area.fill(edited)
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일: 가상대본.txt (불러온 뒤 수정함)")
    // 3. 웹캠 영상도 켜고 연습을 시작한다
    await page.getByLabel("목표 시간 초").fill("30")
    await page.getByLabel("웹캠 영상도 기록 (선택, 소리 기록 포함)").check()
    await page.getByRole("button", { name: "연습 시작" }).click()
    await expect(page.getByTestId("elapsed")).toBeVisible()

    // 연습 화면: 고친 대본이 줄바꿈 그대로, 영상 옆에 보인다
    const view = page.getByTestId("script-view")
    await expect(view).toHaveText(edited, { useInnerText: true })
    const video = page.getByRole("region", { name: "발표 대본" }).locator("xpath=..").locator("video.preview")
    await expect(video).toBeVisible()
    const vb = (await video.boundingBox())!
    const sb = (await page.getByRole("region", { name: "발표 대본" }).boundingBox())!
    expect(sb.x).toBeGreaterThanOrEqual(vb.x + vb.width - 1)
    expect(Math.abs(sb.y - vb.y)).toBeLessThan(80)

    await expect(page.getByTestId("elapsed")).toHaveText("0:01")
    await page.getByRole("button", { name: "연습 종료" }).click()

    // 결과: 이 연습에 쓴 대본이 저장되어 있다
    const card = page.getByRole("region", { name: "이 연습의 대본" })
    await card.getByText("대본 보기").click()
    await expect(card.getByTestId("result-script")).toHaveText(edited, { useInnerText: true })
    await expect(card).toContainText("불러온 파일: 가상대본.txt")
    const firstUrl = page.url()

    // 4. 같은 조건으로 다시 연습 → 그 대본과 파일명이 채워져 있다
    await page.getByRole("button", { name: "같은 조건으로 다시 연습" }).click()
    await expect(area).toHaveValue(edited)
    await expect(page.getByTestId("script-file-name")).toContainText("가상대본.txt")
    // 5. 대본을 다시 고쳐 연습해도 앞 기록의 대본은 바뀌지 않는다
    await area.fill("완전히 새로 쓴 두 번째 대본입니다.")
    await page.getByLabel("웹캠 영상도 기록 (선택, 소리 기록 포함)").uncheck()
    await page.getByRole("button", { name: "연습 시작" }).click()
    await expect(page.getByTestId("script-view")).toHaveText("완전히 새로 쓴 두 번째 대본입니다.")
    await page.getByRole("button", { name: "연습 종료" }).click()
    await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()

    await page.goto(firstUrl)
    await page.reload() // IndexedDB에서 다시 읽는다
    const again = page.getByRole("region", { name: "이 연습의 대본" })
    await again.getByText("대본 보기").click()
    await expect(again.getByTestId("result-script")).toHaveText(edited, { useInnerText: true })
  })

  test("잘못된 형식·빈 파일·1MB 초과·읽을 수 없는 인코딩은 안내하고 기존 대본을 지우지 않는다", async ({ page }) => {
    await page.goto("/")
    const area = page.getByLabel("대본 내용 (직접 붙여넣기·수정)")
    const err = page.getByTestId("script-error")
    await area.fill("직접 쓴 기존 대본")

    await pickFile(page, txt("%PDF-1.4", "가상자료.pdf", "application/pdf"))
    await expect(err).toContainText("TXT 파일(.txt)만 불러올 수 있어요")
    await expect(area).toHaveValue("직접 쓴 기존 대본")

    await pickFile(page, txt(""))
    await expect(err).toContainText("빈 파일이거나 공백뿐인 파일")
    await pickFile(page, txt("  \n\n  "))
    await expect(err).toContainText("빈 파일이거나 공백뿐인 파일")

    await pickFile(page, txt(Buffer.alloc(1024 * 1024 + 1, 0x61)))
    await expect(err).toContainText("1MB보다 커서")

    await pickFile(page, txt(Buffer.from([0xbe, 0xc8, 0xb3, 0xe7]))) // EUC-KR
    await expect(err).toContainText("UTF-8로 저장된 TXT 파일만")

    await expect(area).toHaveValue("직접 쓴 기존 대본")
    await expect(err).toContainText("입력란의 기존 대본은 그대로 두었어요")
    await expect(page.getByTestId("script-file-name")).toContainText("불러온 파일 없음")
  })

  test("파일 선택을 취소하면 그대로, 다시 고르면 덮어쓰기 전에 묻는다", async ({ page }) => {
    await page.goto("/")
    const area = page.getByLabel("대본 내용 (직접 붙여넣기·수정)")
    await pickFile(page, txt(SCRIPT))
    await area.fill(`${SCRIPT}\n덧붙인 문장`)
    // 선택 창 취소(파일 없이 change)
    await page.getByLabel("TXT 파일 선택").setInputFiles([])
    await expect(area).toHaveValue(`${SCRIPT}\n덧붙인 문장`)

    // 다른 파일을 고르면 확인을 묻고, '지금 대본 유지'면 바꾸지 않는다
    await pickFile(page, txt("두 번째 가상 대본", "두번째.txt"))
    await expect(page.locator("#script-confirm")).toContainText("'두번째.txt' 내용으로 바꿀까요?")
    await page.getByRole("button", { name: "지금 대본 유지" }).click()
    await expect(area).toHaveValue(`${SCRIPT}\n덧붙인 문장`)
    await expect(page.getByTestId("script-file-name")).toContainText("가상대본.txt")

    // 다시 고르고 '파일 내용으로 바꾸기'면 바뀐다
    await pickFile(page, txt("두 번째 가상 대본", "두번째.txt"))
    await page.getByRole("button", { name: "파일 내용으로 바꾸기" }).click()
    await expect(area).toHaveValue("두 번째 가상 대본")
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일: 두번째.txt")
  })

  test("좁은 화면에서는 영상 아래에 대본이 오고, 긴 대본은 대본 영역 안에서 스크롤된다", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 800 })
    await page.goto("/")
    const long = Array.from({ length: 200 }, (_, i) => `${i + 1}번째 가상 문장입니다. <b>태그도 글자로</b>`).join("\n")
    await page.getByLabel("대본 내용 (직접 붙여넣기·수정)").fill(long)
    await page.getByLabel("목표 시간 초").fill("30")
    await page.getByLabel("웹캠 영상도 기록 (선택, 소리 기록 포함)").check()
    await page.getByRole("button", { name: "연습 시작" }).click()
    const view = page.getByTestId("script-view")
    await expect(view).toContainText("200번째 가상 문장입니다. <b>태그도 글자로</b>")
    expect(await view.locator("b").count()).toBe(0)
    const vb = (await page.locator("video.preview").boundingBox())!
    const sb = (await page.getByRole("region", { name: "발표 대본" }).boundingBox())!
    expect(sb.y).toBeGreaterThanOrEqual(vb.y + vb.height - 1)
    const { scroll, client, pageWide } = await view.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, pageWide: document.documentElement.scrollWidth }))
    expect(scroll).toBeGreaterThan(client)
    expect(pageWide).toBeLessThanOrEqual(480)
    await page.getByRole("button", { name: "연습 종료" }).click()
  })

  test("대본 기능 이전에 저장된 기록도 열리고, 다시 연습하면 대본 없이 시작한다", async ({ page }) => {
    await page.goto("/")
    // 대본 필드가 없던 때의 기록 모양을 IndexedDB에 넣는다
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open("speech-coach", 1)
          req.onupgradeneeded = () => req.result.createObjectStore("sessions", { keyPath: "id" })
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const t = req.result.transaction("sessions", "readwrite")
            t.objectStore("sessions").put({
              id: "s-old", createdAt: Date.now() - 60_000,
              settings: { targetSec: 20, toleranceSec: 0, warnSec: 5, speedMin: null, speedMax: null, sections: [], planSignature: "", recordAudio: false, recordVideo: false, speechRequested: false, raw: { tmin: "", tsec: "20", tol: "0", warn: "5", smin: "", smax: "", plan: "", audio: false, video: false, speech: false } },
              conditionKey: "20|", totalSec: 18, result: { kind: "early", label: "목표보다 2초 일찍 끝났어요", diffSec: -2 },
              marks: [], sectionRows: [], media: { audio: "off", video: "off", speech: "off", speechDetail: "" },
              analysis: { silence: null, transcript: null, items: [] }, transcript: [], audioBlob: null, videoBlob: null, notices: [],
            })
            t.oncomplete = () => resolve()
            t.onerror = () => reject(t.error)
          }
        }),
    )
    await page.goto("/#/result/s-old")
    await expect(page.getByTestId("total")).toContainText("0:18")
    await expect(page.getByTestId("no-script")).toHaveText("대본 없이 한 연습이에요.")
    await page.getByRole("button", { name: "같은 조건으로 다시 연습" }).click()
    await expect(page.getByLabel("목표 시간 초")).toHaveValue("20")
    await expect(page.getByLabel("대본 내용 (직접 붙여넣기·수정)")).toHaveValue("")
    await page.getByRole("button", { name: "연습 시작" }).click()
    await expect(page.getByTestId("elapsed")).toBeVisible()
    await expect(page.getByRole("region", { name: "발표 대본" })).toHaveCount(0)
    await page.getByRole("button", { name: "연습 종료" }).click()
    await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()
  })
})
