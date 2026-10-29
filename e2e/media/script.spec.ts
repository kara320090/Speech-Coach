import { expect, test, type Page } from "@playwright/test"
import { openMain, setTarget, stopAndAnalyze } from "../fixtures/flow"

// 개인정보 없는 가상 대본. 파일은 저장소에 두지 않고 검사 안에서 만든다.
const SCRIPT = "안녕하세요. 오늘은 가상의 도시 숲 가꾸기 계획을 소개하겠습니다.\n\n첫째, 나무 심기 일정입니다.\n둘째, 물 주기 당번표입니다."
const txt = (content: string | Buffer, name = "가상대본.txt", mimeType = "text/plain") => ({ name, mimeType, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8") })

const scriptPanel = (page: Page) => page.getByRole("complementary", { name: "대본" })
const editor = (page: Page) => scriptPanel(page).getByRole("textbox", { name: "대본" })
const pickFile = (page: Page, file: ReturnType<typeof txt> | []) => page.getByLabel("TXT 파일 선택").setInputFiles(file)

async function openEditor(page: Page) {
  await openMain(page)
  await scriptPanel(page).getByRole("button", { name: "대본 편집" }).click()
  await expect(editor(page)).toBeVisible()
}

/** 가짜 카메라에서는 시선 추적 모델을 불러오는 동안 화면 갱신이 몇 초 멈출 수 있어, 정확한 값 대신 '그 이상'을 기다린다. */
async function waitElapsed(page: Page, atLeastSec: number) {
  await expect.poll(async () => {
    const m = (await page.getByTestId("elapsed").innerText()).match(/(\d+):(\d{2})/)
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0
  }, { timeout: 30_000 }).toBeGreaterThanOrEqual(atLeastSec)
}

async function record(page: Page, atLeastSec = 1) {
  await page.getByRole("button", { name: "녹화 시작" }).click()
  await waitElapsed(page, atLeastSec)
  await stopAndAnalyze(page)
  await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()
  return page.url().match(/#\/result\/(.+)$/)![1]
}

/** IndexedDB에 저장된 기록을 읽는다(화면 대신 저장 구조를 확인할 때만 쓴다). */
function readSession(page: Page, id: string) {
  return page.evaluate(
    (key) =>
      new Promise<{ script?: string; scriptFile?: { name: string; edited: boolean } | null }>((resolve, reject) => {
        const req = indexedDB.open("speech-coach", 1)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const get = req.result.transaction("sessions").objectStore("sessions").get(key)
          get.onsuccess = () => resolve(get.result)
          get.onerror = () => reject(get.error)
        }
      }),
    decodeURIComponent(id),
  )
}

test.describe("대본 패널 TXT 불러오기", () => {
  test("예시 대본에서 TXT를 불러와 고친 뒤 녹화하고, 기록·같은 조건 재연습에 그 대본이 이어진다", async ({ page }) => {
    await openEditor(page)
    // 1. 예시 대본 그대로일 때는 확인 없이 바로 불러온다 (한글·줄바꿈 유지)
    await pickFile(page, txt(SCRIPT))
    await expect(page.getByTestId("script-confirm")).toHaveCount(0)
    await expect(editor(page)).toHaveValue(SCRIPT)
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일: 가상대본.txt")
    // 2. 대본을 고친다
    const edited = `${SCRIPT}\n셋째, 마무리 인사입니다.`
    await editor(page).fill(edited)
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일: 가상대본.txt (불러온 뒤 수정함)")
    await scriptPanel(page).getByRole("button", { name: "완료" }).click()
    // 3. 대본 패널에 고친 대본이 문장별로 보이고, 핵심어 카드·진행 막대도 그대로 쓸 수 있다
    const sentences = scriptPanel(page).locator("ol.sentences > li")
    await expect(sentences).toHaveCount(5)
    await expect(sentences.last()).toContainText("셋째, 마무리 인사입니다.")
    await scriptPanel(page).getByRole("button", { name: "핵심어 카드" }).click()
    await expect(scriptPanel(page).locator("ol.sentences .kw").first()).toBeVisible()
    await scriptPanel(page).getByRole("button", { name: "핵심어 카드" }).click()
    await scriptPanel(page).getByRole("button", { name: "진행 막대" }).click()
    // 4. 녹화하면 진행 막대가 보이고, 기록에 고친 대본과 파일명이 저장된다
    await setTarget(page, "0", "30")
    await page.getByRole("button", { name: "녹화 시작" }).click()
    await expect(scriptPanel(page).locator(".progress")).toBeVisible()
    await waitElapsed(page, 1)
    await stopAndAnalyze(page)
    await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()
    const firstId = page.url().match(/#\/result\/(.+)$/)![1]
    expect(await readSession(page, firstId)).toMatchObject({ script: edited, scriptFile: { name: "가상대본.txt", edited: true } })
    await scriptPanel(page).getByRole("button", { name: "진행 막대" }).click()

    // 5. 대본을 새로 바꿔 한 번 더 녹화해도 앞 기록의 대본은 그대로다
    await page.getByRole("button", { name: "같은 조건으로 다시 연습" }).click()
    await scriptPanel(page).getByRole("button", { name: "대본 편집" }).click()
    await expect(editor(page)).toHaveValue(edited)
    await editor(page).fill("완전히 새로 쓴 두 번째 가상 대본입니다.")
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일: 가상대본.txt (불러온 뒤 수정함)")
    await scriptPanel(page).getByRole("button", { name: "완료" }).click()
    const secondId = await record(page)
    expect(await readSession(page, secondId)).toMatchObject({ script: "완전히 새로 쓴 두 번째 가상 대본입니다." })
    expect(await readSession(page, firstId)).toMatchObject({ script: edited, scriptFile: { name: "가상대본.txt" } })

    // 6. 첫 기록을 다시 열어 '같은 조건으로 다시 연습'하면 그 기록의 대본과 파일명을 불러온다 (새로고침 뒤 IndexedDB에서 다시 읽음)
    await page.goto(`/#/result/${firstId}`)
    await page.reload()
    await expect(page.getByRole("region", { name: "연습 결과" })).toBeVisible()
    await page.getByRole("button", { name: "같은 조건으로 다시 연습" }).click()
    await expect(sentences.last()).toContainText("셋째, 마무리 인사입니다.")
    await scriptPanel(page).getByRole("button", { name: "대본 편집" }).click()
    await expect(editor(page)).toHaveValue(edited)
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일: 가상대본.txt (불러온 뒤 수정함)")
  })

  test("잘못된 형식·빈 파일·공백뿐·1MB 초과·UTF-8 아님은 안내하고 지금 대본을 지우지 않는다", async ({ page }) => {
    await openEditor(page)
    const err = page.getByTestId("script-error")
    await editor(page).fill("직접 쓴 기존 가상 대본")

    await pickFile(page, txt("%PDF-1.4", "가상자료.pdf", "application/pdf"))
    await expect(err).toContainText("TXT 파일(.txt)만 불러올 수 있어요")
    await expect(editor(page)).toHaveValue("직접 쓴 기존 가상 대본")

    await pickFile(page, txt(""))
    await expect(err).toContainText("빈 파일이거나 공백뿐인 파일")
    await pickFile(page, txt("  \n\n  "))
    await expect(err).toContainText("빈 파일이거나 공백뿐인 파일")
    await pickFile(page, txt(Buffer.alloc(1024 * 1024 + 1, 0x61)))
    await expect(err).toContainText("1MB보다 커서")
    await pickFile(page, txt(Buffer.from([0xbe, 0xc8, 0xb3, 0xe7]))) // EUC-KR
    await expect(err).toContainText("UTF-8로 저장된 TXT 파일만")

    await expect(err).toContainText("지금 대본은 그대로 두었어요")
    await expect(editor(page)).toHaveValue("직접 쓴 기존 가상 대본")
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일 없음")
    // 오류 뒤에도 녹화는 그대로 할 수 있다
    await setTarget(page, "0", "10")
    await record(page)
  })

  test("직접 쓰거나 불러온 대본이 있으면 바꾸기 전에 묻고, 선택 취소·'지금 대본 유지'면 그대로 둔다", async ({ page }) => {
    await openEditor(page)
    // 직접 입력한 대본이 있으면 묻는다
    await editor(page).fill("직접 입력한 가상 대본")
    await pickFile(page, txt(SCRIPT))
    await expect(page.getByTestId("script-confirm")).toContainText("'가상대본.txt' 내용으로 바꿀까요?")
    await page.getByRole("button", { name: "지금 대본 유지" }).click()
    await expect(editor(page)).toHaveValue("직접 입력한 가상 대본")
    await expect(page.getByTestId("script-confirm")).toHaveCount(0)
    // 선택 창 취소(파일 없이 change)는 아무것도 바꾸지 않는다
    await pickFile(page, [])
    await expect(editor(page)).toHaveValue("직접 입력한 가상 대본")
    // 바꾸기를 고르면 바뀐다
    await pickFile(page, txt(SCRIPT))
    await page.getByRole("button", { name: "파일 내용으로 바꾸기" }).click()
    await expect(editor(page)).toHaveValue(SCRIPT)
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일: 가상대본.txt")
    // 파일로 불러온 대본도 다른 파일로 바꾸기 전에 묻는다
    await pickFile(page, txt("두 번째 가상 대본", "두번째.txt"))
    await expect(page.getByTestId("script-confirm")).toContainText("'두번째.txt' 내용으로 바꿀까요?")
    await page.getByRole("button", { name: "지금 대본 유지" }).click()
    await expect(editor(page)).toHaveValue(SCRIPT)
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일: 가상대본.txt")
  })

  test("대본·파일명이 없던 이전 기록도 열리고, 같은 조건으로 다시 연습하면 지금 대본을 그대로 쓴다", async ({ page }) => {
    await openEditor(page)
    await editor(page).fill("지금 쓰고 있는 가상 대본")
    await scriptPanel(page).getByRole("button", { name: "완료" }).click()
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
    await page.reload()
    await expect(page.getByTestId("total")).toContainText("0:18")
    await page.getByRole("button", { name: "같은 조건으로 다시 연습" }).click()
    await scriptPanel(page).getByRole("button", { name: "대본 편집" }).click()
    await expect(editor(page)).toHaveValue("지금 쓰고 있는 가상 대본")
    await expect(page.getByTestId("script-file-name")).toHaveText("불러온 파일 없음")
    await scriptPanel(page).getByRole("button", { name: "완료" }).click()
    await record(page)
  })
})
