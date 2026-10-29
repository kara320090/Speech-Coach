import { createHash } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"

// 검토 구간 → 대본 위치 확인 → 자체 AI 구간 대화 → 문단 수정안 → 적용 → 다시 연습.
// 위치 추천(/api/scripts/align)과 규칙 단계의 구간 대화(/api/coach/segment)는 실제 로컬 서버를 쓴다.
// 모델이 글을 만드는 문단 수정(/api/scripts/revise-segment)만 가짜 응답이며, 실제 AI 품질 검증이 아니다.
const P0 = "안녕하세요. 오늘은 가상의 도서관 서비스를 소개합니다."
const P1 = "이 서비스는 캐시를 이용해 최근 결과를 5분 동안 저장하고, 같은 요청이 오면 저장한 결과를 다시 사용하기 때문에 응답이 빨라지지만 효과는 아직 검증하지 않았습니다."
const P2 = "감사합니다."
const SCRIPT = `${P0}\n\n${P1}\n\n${P2}`
const REVISED = "이 서비스는 결과를 잠시 저장해 다시 쓰는 캐시를 이용해요. 최근 결과를 5분 동안 저장해요. 같은 요청이 오면 저장한 결과를 다시 써서 응답이 빨라져요. 다만 효과는 아직 검증하지 않았어요."
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex")

async function seedSession(page: Page, { transcript = true } = {}) {
  await page.goto("/")
  await page.evaluate(({ SCRIPT, transcript }) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("speech-coach", 1)
    req.onupgradeneeded = () => req.result.createObjectStore("sessions", { keyPath: "id" })
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const t = req.result.transaction("sessions", "readwrite")
      t.objectStore("sessions").put({
        id: "s-flow", createdAt: Date.now(), script: SCRIPT,
        settings: { targetSec: 30, toleranceSec: 0, warnSec: 5, speedMin: null, speedMax: null, sections: [], planSignature: "", recordAudio: false, recordVideo: false, speechRequested: false, raw: { tmin: "0", tsec: "30", tol: "0", warn: "5", smin: "", smax: "", plan: "", audio: false, video: false, speech: false } },
        conditionKey: "30|", totalSec: 20, result: { kind: "early", label: "목표보다 10초 일찍 끝났어요", diffSec: -10 },
        marks: [], sectionRows: [], media: { audio: "off", video: "off", speech: "off", speechDetail: "" },
        analysis: { silence: null, transcript: null, items: [{ id: "silence-1", type: "silence", startSec: 6.2, endSec: 10, title: "긴 침묵", measured: "3.8초", basis: "소리가 기준 이하" }] },
        transcript: transcript ? [
          { startSec: 0, endSec: 1.5, text: "안녕하세요" },
          { startSec: 1.8, endSec: 6, text: "오늘은 가상의 도서관 서비스를 소개합니다" },
          { startSec: 10.2, endSec: 19, text: "이 서비스는 캐시를 이용해 최근 결과를 오 분 동안 저장하고 같은 요청이 오면 저장한 결과를 다시 사용합니다" },
        ] : [],
        audioBlob: null, videoBlob: null, notices: [], coaching: {}, practiceOf: null,
      })
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
    }
  }), { SCRIPT, transcript })
}

test("검토 구간 → 위치 확인 → 자체 AI 대화 → 문단 수정안 비교 → 적용 → 다시 연습", async ({ page }) => {
  const revisions: any[] = []
  await page.route("**/api/scripts/revise-segment", async (route) => {
    const body = route.request().postDataJSON(); revisions.push(body)
    const t = body.target
    await route.fulfill({ json: {
      requestId: body.requestId, practiceId: body.practiceId, pointId: body.point.id, scriptVersionId: body.scriptVersionId, task: "contextual-revision", promptVersion: "contextual-revision-v1", model: "speech-coach", durationMs: 10,
      status: "proposed", target: { paragraphIndex: t.paragraphIndex, start: t.start, end: t.end, text: t.text, sentenceIds: ["s3"], confirmation: t.confirmation },
      revision: { text: REVISED, reason: "긴 문장을 나눴어요.", humanReview: "required" }, appliedUserInputs: ["긴 문장을 말하기 쉽게 나누기"],
      preservation: { warnings: [], blocked: false, reviewRequired: true, mustPreserveMissing: [], note: "보수적 검사" },
      basis: { observations: [], userReports: [], inferredNeeds: [], evidence: [], unverified: ["근거 자료가 없어 풀어 쓴 설명의 정확성을 확인하지 않았어요. 사용자 확인이 필요해요."] },
      apply: { baseScriptVersionId: body.scriptVersionId, start: t.start, end: t.end, originalSha256: sha(t.text), scriptSha256: sha(body.script), note: "" },
    } })
  })
  await seedSession(page)
  // 결과 화면에서 검토 구간을 누르면 질문 카드에 진입 링크가 보인다
  await page.goto("/#/result/s-flow")
  await page.getByRole("button", { name: /0:06 · 긴 침묵/ }).first().click()
  await page.getByRole("link", { name: "대본 위치 확인하고 AI와 이야기하기" }).click()
  await expect(page).toHaveURL(/support-coach\.html\?session=s-flow&item=silence-1/)

  // 1) 대본 위치 확인: 실제 align이 추천한 문장을 확인
  await expect(page.locator("#location-state")).toContainText("이 문장 근처로 보여요")
  const recommended = page.getByRole("radio", { name: /이 서비스는 캐시를 이용해/ })
  await expect(recommended).toBeChecked()
  await expect(page.getByLabel("자체 AI와 대화하기 · 외부로 보내지 않아요")).toBeChecked()
  await expect(page.locator("#gemini-consent")).toBeHidden()
  await page.getByRole("button", { name: "이 위치로 확인" }).click()
  await expect(page.getByLabel("함께 볼 대본", { exact: true })).toHaveValue(P1)
  await expect(page.locator("#location-confirmed")).toContainText("추천 위치를 확인함")

  // 2) 자체 AI 구간 대화(규칙 단계는 모델 없이 실제 서버)
  await page.getByRole("button", { name: "함께 살펴보기", exact: true }).click()
  await expect(page.locator("#support-messages")).toContainText("이 부분에서 어떤 일이 있었나요?")
  await expect(page.locator("#support-messages")).toContainText("긴 침묵(측정값 3.8초)")
  await page.getByRole("button", { name: "문장이 말하기 어색했어요" }).click()
  await expect(page.locator("#support-messages")).toContainText("어느 부분이 말하기 어려웠나요?")
  await expect(page.locator("#support-count")).toContainText("후속 질문 1/3")
  await page.locator("#support-hints button").first().click()
  await expect(page.locator("#support-messages")).toContainText("대본을 바꾸지 않고 읽는 방법만 바꿔 보는 연습")

  // 3) 대화가 끝나면 문단 수정 제안 → 사용자가 눌렀을 때만 요청
  await expect(page.locator("#revise-offer")).toBeVisible()
  expect(revisions.length).toBe(0)
  await page.getByRole("button", { name: "이 문단 고치기" }).click()
  await expect(page.getByLabel("쉬운 대본 초안 · 직접 수정할 수 있어요")).toHaveValue(REVISED)
  await expect(page.locator("#support-original")).toHaveText(P1)
  expect(revisions[0].target).toMatchObject({ paragraphIndex: 1, text: P1, confirmation: "user-confirmed" })
  expect(revisions[0].request).toEqual({ explicit: true })
  expect(revisions[0].coaching.summary.userReports.some((u: any) => u.reason === "awkward-sentence")).toBe(true)
  await expect(page.locator("#support-reason")).toContainText("사용자 확인이 필요해요")

  // 4) 보존 확인 후 적용 → 다시 연습(이 문단만 바뀌고 다른 문단은 그대로)
  const apply = page.getByRole("button", { name: "수정본으로 다음 연습 준비" })
  await expect(apply).toBeDisabled()
  await page.getByLabel("수치·단위·조건·부정·한계와 핵심 의미를 확인했고 다음 연습 대본에 적용할게요").check()
  await apply.click()
  await expect(page).toHaveURL(/\/#\/$/)
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem("dasibom.settings") || "{}"))
  expect(settings.script).toBe(`${P0}\n\n${REVISED}\n\n${P2}`)
  // 지난 연습 기록의 대본은 그대로
  const stored = await page.evaluate(() => new Promise<string>((resolve) => { const r = indexedDB.open("speech-coach", 1); r.onsuccess = () => { const g = r.result.transaction("sessions").objectStore("sessions").get("s-flow"); g.onsuccess = () => resolve(g.result.script) } }))
  expect(stored).toBe(SCRIPT)
})

test("의도한 쉼이면 문단 수정을 눌러도 바꾸지 않는다(실제 서버, 모델 호출 없음)", async ({ page }) => {
  await seedSession(page)
  await page.goto("/support-coach.html?session=s-flow&item=silence-1")
  await page.getByRole("button", { name: "이 위치로 확인" }).click()
  await page.getByRole("button", { name: "함께 살펴보기", exact: true }).click()
  await page.getByRole("button", { name: "일부러 쉬었어요" }).click()
  await expect(page.locator("#support-messages")).toContainText("그대로 두어도 돼요")
  await page.getByRole("button", { name: "이 문단 고치기" }).click()
  await expect(page.locator("#revise-offer-text")).toContainText("의도한 쉼")
  await expect(page.locator("#support-revision")).toBeHidden()
})

test("전사가 없으면 문장을 직접 고르고(user-selected), 모르겠어요·건너뛰기를 쓸 수 있다", async ({ page }) => {
  const steps: any[] = []
  await page.route("**/api/coach/segment", async (route) => { steps.push(route.request().postDataJSON()); await route.continue() })
  await seedSession(page, { transcript: false })
  await page.goto("/support-coach.html?session=s-flow&item=silence-1")
  await expect(page.locator("#location-state")).toContainText("직접 골라 주세요")
  const confirm = page.getByRole("button", { name: "이 위치로 확인" })
  await expect(confirm).toBeDisabled()
  await page.getByLabel("다른 문장 직접 고르기").selectOption({ label: "4. 감사합니다." })
  await confirm.click()
  await expect(page.locator("#location-confirmed")).toContainText("직접 고름")
  await page.getByRole("button", { name: "함께 살펴보기", exact: true }).click()
  await page.getByRole("button", { name: "잘 모르겠어요", exact: true }).click()
  await expect(page.locator("#support-messages")).toContainText("같은 곳에서 다시 멈추는지")
  expect(steps[0].selection).toMatchObject({ sentenceId: "s4", confirmation: "user-selected", alignmentStatus: "unmatched" })
  expect(steps[1].action).toEqual({ type: "unknown", questionKey: "situation" })
})

test("Gemini 대화도 같은 화면에서 고를 수 있고, 동의 전에는 시작하지 않는다", async ({ page }) => {
  await page.route("**/api/coach/support-status", (route) => route.fulfill({ json: { ready: true, model: "gemini-3.8-flash", message: "대화 코칭을 선택할 수 있어요." } }))
  await seedSession(page)
  await page.goto("/support-coach.html?session=s-flow&item=silence-1")
  await page.getByRole("button", { name: "이 위치로 확인" }).click()
  await page.getByLabel("Gemini와 대화하기 · 동의한 텍스트만 Google로 보내요").check()
  await expect(page.locator("#gemini-consent")).toBeVisible()
  const start = page.getByRole("button", { name: "동의하고 함께 살펴보기" })
  await expect(start).toBeDisabled()
  await page.getByLabel("선택한 대본·근거·관찰 텍스트와 이 대화의 답변을 Google Gemini로 보내는 데 동의해요").check()
  await expect(start).toBeEnabled()
  await expect(page.getByLabel("함께 볼 대본", { exact: true })).toHaveValue(P1)
})
