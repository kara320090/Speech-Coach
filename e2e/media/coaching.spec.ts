import { expect, test, type Page } from "@playwright/test"

const script = "최근 결과를 5분간 캐시에 보관해 같은 요청에 재사용한다."
async function mock(page: Page, ready = true) {
  await page.route("**/api/model-status", r => r.fulfill({ json: { ready, message: ready ? "자체 모델 사용 가능" : "자체 모델 미설정: 자료 저장 가능" } }))
  await page.route("**/api/coach", async r => {
    const input = r.request().postDataJSON()
    const result = {
      concepts: { concepts: [{ id: "concept-1", term: "캐시", quote: script, explanation: "최근 결과를 잠시 저장했다가 다시 사용해요.", sourceQuote: script }] },
      rewrite: { rewritten: "최근 결과를 5분 동안 잠시 저장해 같은 요청에 다시 사용한다.", reason: "캐시를 풀어 썼어요.", sourceQuote: script, warnings: [], reviewRequired: true },
      question: { question: "캐시에 저장한 결과는 언제 다시 쓰나요?", referenceQuote: script, grounded: true },
      review: { state: "supported", supported: "같은 요청에 다시 사용한다고 설명했어요.", answerQuote: input.answer, sourceQuote: script, nextStep: "이 설명으로 짧게 연습해 보세요.", humanReview: "unreviewed" },
    }[input.task as string]
    await r.fulfill({ json: { requestId: input.requestId, versionId: input.versionId, model: "fake-local", durationMs: 10, result } })
  })
}
async function prepare(page: Page) {
  await page.goto("/coach.html")
  await page.getByLabel("분석할 대본 구간").fill(script)
  await page.getByLabel("근거 자료 (선택)").fill(script)
  await page.getByRole("button", { name: "자료 저장", exact: true }).click()
}

test("restored script is displayed only after its storage commit, including slow storage", async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as any).__commitDelay = 0
    const d = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "oncomplete")!
    Object.defineProperty(IDBTransaction.prototype, "oncomplete", { ...d, set(listener) {
      d.set!.call(this, typeof listener === "function" ? function (event: Event) { setTimeout(() => listener.call(this, event), (window as any).__commitDelay) } : listener)
    } })
  })
  await mock(page); await prepare(page)
  await page.getByRole("button", { name: "쉬운 대본 제안", exact: true }).click()
  await page.getByLabel("수치·조건·부정·한계와 핵심 의미를 확인했어요").check()
  await page.getByRole("button", { name: "새 버전으로 적용", exact: true }).click()
  await expect(page.locator("#revision")).toContainText("새 대본 버전으로 저장했어요")
  const editor = page.getByLabel("분석할 대본 구간"), revised = await editor.inputValue()
  await page.evaluate(() => { (window as any).__commitDelay = 350 })
  await page.getByRole("button", { name: "처음 대본으로 되돌리기", exact: true }).click()
  await expect(editor).toHaveValue(revised)
  await expect(editor).toHaveValue(script)
  await page.reload()
  await expect(editor).toHaveValue(script)
})

test("local coaching supports explanation, retry, before/after, persistence and explicit review", async ({ page }) => {
  await mock(page); await prepare(page)
  await page.getByRole("button", { name: "낯선 개념 살펴보기" }).click()
  await page.getByRole("button", { name: "내 말로 설명해 보기" }).click()
  await page.getByLabel("내 설명·답변").fill("같은 요청에 결과를 다시 사용해요.")
  await page.getByRole("button", { name: "답변 함께 확인" }).click()
  await expect(page.locator("#feedback")).toContainText("자료와 부합하는 설명")
  await page.getByRole("button", { name: "이 검토가 맞아요", exact: true }).click()
  await page.getByRole("button", { name: "도움 없이 다시 설명" }).click()
  await page.getByLabel("내 설명·답변").fill("결과를 5분간 보관하고 같은 요청에 다시 사용합니다.")
  await page.getByRole("button", { name: "답변 함께 확인" }).click()
  await expect(page.locator("#attempt-history")).toContainText("이전 설명")
  await expect(page.locator("#attempt-history")).toContainText("전체 답변 2개")
  await page.reload()
  await expect(page.getByLabel("분석할 대본 구간")).toHaveValue(script)
  await expect(page.locator("#attempt-history")).toContainText("전체 답변 2개")
  await expect(page.locator("#attempt-history")).toContainText("사용자 확인: 맞음")
  await page.getByRole("button", { name: "예상 질문 연습" }).click()
  await page.getByRole("button", { name: "모르겠어요 · 근거 보기" }).click()
  await expect(page.locator("#reference")).not.toContainText("최근 결과를 잠시 저장했다가 다시 사용해요.")
  await page.getByLabel("내 설명·답변").fill("같은 요청을 받았을 때 다시 사용합니다.")
  await page.getByRole("button", { name: "답변 함께 확인" }).click()
  await expect(page.locator("#attempt-history")).toContainText("전체 답변 3개")
  await expect(page.locator("#attempt-history")).toContainText("직접적인 개선 비교로 해석할 수 없어요")
})
test("rewrite requires meaning review, preserves original and restores it without deleting attempts", async ({ page }) => {
  await mock(page); await prepare(page)
  await page.getByRole("button", { name: "쉬운 대본 제안" }).click()
  const apply = page.getByRole("button", { name: "새 버전으로 적용" })
  await expect(apply).toBeDisabled()
  await page.getByLabel("수치·조건·부정·한계와 핵심 의미를 확인했어요").check()
  await apply.click()
  await expect(page.getByLabel("분석할 대본 구간")).toHaveValue(/잠시 저장/)
  await page.getByRole("button", { name: "처음 대본으로 되돌리기" }).click()
  await expect(page.getByLabel("분석할 대본 구간")).toHaveValue(script)
  await page.reload(); await expect(page.getByLabel("분석할 대본 구간")).toHaveValue(script)
})
test("no model and denied storage keep user text usable and show degraded state", async ({ page }) => {
  await mock(page, false)
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error("denied") } })
  await prepare(page)
  await expect(page.getByRole("button", { name: "쉬운 대본 제안" })).toBeDisabled()
  await expect(page.locator("#save-state")).toContainText("현재 화면에만")
  await expect(page.getByLabel("분석할 대본 구간")).toHaveValue(script)
  await page.getByRole("button", { name: "모르겠어요 · 근거 보기" }).click()
  await expect(page.locator("#reference")).toContainText(script)
  await page.getByRole("button", { name: "이번 질문 건너뛰기" }).click()
  await expect(page.locator("#request-state")).toContainText("건너뛰었어요")
})
test("a missing protected number blocks applying a rewrite until manually repaired", async ({ page }) => {
  await mock(page); await prepare(page)
  await page.route("**/api/coach", async r => {
    const input = r.request().postDataJSON()
    await r.fulfill({ json: { ...input, model: "fake", durationMs: 1, result: { rewritten: "최근 결과를 잠시 저장해 다시 사용한다.", reason: "쉬운 표현", sourceQuote: script, warnings: ["5분 누락"], blocked: true } } })
  })
  await page.getByRole("button", { name: "쉬운 대본 제안" }).click()
  await page.getByLabel("수치·조건·부정·한계와 핵심 의미를 확인했어요").check()
  await expect(page.getByRole("button", { name: "새 버전으로 적용" })).toBeDisabled()
  await page.getByLabel("수정 제안 · 직접 고칠 수 있어요").fill("최근 결과를 5분 동안 잠시 저장해 다시 사용한다.")
  await expect(page.getByLabel("수치·조건·부정·한계와 핵심 의미를 확인했어요")).not.toBeChecked()
  await page.getByLabel("수치·조건·부정·한계와 핵심 의미를 확인했어요").check()
  await page.getByRole("button", { name: "새 버전으로 적용" }).click()
  await expect(page.getByLabel("분석할 대본 구간")).toHaveValue(/5분/)
})
test("editing cancels pending inference and old output cannot overwrite current material", async ({ page }) => {
  await mock(page); await prepare(page)
  let release: (() => void) | undefined
  await page.route("**/api/coach", async r => {
    await new Promise<void>(resolve => { release = resolve })
    await r.fulfill({ json: { result: { rewritten: "old" } } }).catch(() => {})
  })
  await page.getByRole("button", { name: "쉬운 대본 제안" }).click()
  await expect(page.getByRole("button", { name: "분석 취소" })).toBeVisible()
  await page.getByLabel("분석할 대본 구간").fill("바꾼 대본")
  release?.()
  await expect(page.getByRole("button", { name: "분석 취소" })).toBeHidden()
  await expect(page.locator("#revision")).toBeEmpty()
  await expect(page.getByLabel("분석할 대본 구간")).toHaveValue("바꾼 대본")
})
test("feedback cap, skipped questions and literal model text never execute markup", async ({ page }) => {
  await mock(page); await prepare(page)
  await page.getByRole("button", { name: "예상 질문 연습" }).click()
  await expect(page.locator("#reference")).toBeHidden()
  for (let n = 0; n < 3; n++) {
    await page.getByLabel("내 설명·답변").fill(`<img src=x onerror=alert(1)> ${n}`)
    await page.getByRole("button", { name: "답변 함께 확인" }).click()
    await expect(page.locator("#attempt-state")).toContainText(`${n + 1}/3`)
  }
  await page.getByRole("button", { name: "답변 함께 확인" }).click()
  await expect(page.locator("#request-state")).toContainText("세 번")
  await expect(page.locator("#attempt-history img")).toHaveCount(0)
  await expect(page.locator("#attempt-history")).toContainText("<img src=x")
  page.once("dialog", dialog => dialog.accept())
  await page.getByRole("button", { name: "이 페이지 자료 삭제" }).click()
  await page.reload(); await expect(page.getByLabel("분석할 대본 구간")).toBeEmpty()
})
