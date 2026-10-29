import { BLINK_RULES } from "./blinks.js"
import { FILLER_WORDS } from "./fillers.js"
import { analyzeVideoBlinks } from "./video-analysis.js"
import { buildReviewItems } from "./analysis.js"
import { saveSession } from "./storage.js"
import { formatClock } from "./time.js"

// 기존 결과 화면·버튼·플레이어를 유지하는 독립 카드.
export function measurementCards(session, { h, seek, onUpdated }) {
  const f = session.analysis.transcript?.fillers
  const fillers = h("section", { class: "card", "aria-label": "군말 후보 측정" },
    h("h2", null, "군말 후보 측정"),
    h("p", { "data-testid": "filler-total" }, f?.status === "ok" ? `인식된 글에서 ${f.count}회 · ${f.types.length}종류` : `측정 못 함 — ${f?.reason || "분석할 전사문이 없거나 이전 방식으로 저장된 기록이에요."}`),
    f?.status === "ok" ? h("ul", null, f.types.map((x) => h("li", null, `“${x.word}” ${x.count}회`))) : null,
    h("p", { class: "hint" }, `기준: 독립 토큰 ${FILLER_WORDS.join("·")} 일치. 늘인 ‘음/어’는 한 토큰을 1회로 세어요. 필요한 표현도 포함될 수 있으며, 인식에서 빠진 군말은 셀 수 없어요. 0회는 전사문에서 후보가 없다는 뜻이에요.`))
  const b = session.analysis.blink, r = b?.rules || BLINK_RULES
  const status = h("p", { role: "status", "data-testid": "blink-status" }, b?.status === "ok"
    ? `총 ${b.count}회 · 얼굴 측정 시간 기준 분당 ${b.rate.toFixed(1)}회`
    : `측정 못 함 — ${b?.reason || (session.videoBlob ? "아래 버튼으로 이 기기에서 분석할 수 있어요." : "기록된 영상이 없어요.")}`)
  const button = h("button", { type: "button", disabled: !session.videoBlob }, b ? "눈 깜빡임 다시 분석" : "눈 깜빡임 분석")
  const cancel = h("button", { type: "button", hidden: true }, "눈 깜빡임 분석 취소")
  const card = h("section", { class: "card", "aria-label": "눈 깜빡임 측정" }, h("h2", null, "눈 깜빡임 측정"), status,
    Number.isFinite(b?.missingRatio) ? h("p", null, `얼굴 측정 불가 ${(b.missingRatio * 100).toFixed(1)}% · 측정 ${b.observedSec.toFixed(1)}초 / 영상 ${b.durationSec.toFixed(1)}초 (얼굴 없음·여러 얼굴·계수 누락 포함)`) : null,
    h("p", { class: "hint" }, "영상·얼굴 데이터는 전송하지 않고 이 브라우저에서 분석해요. 처음에는 같은 사이트에서 모델 파일을 읽어 시간이 걸릴 수 있어요. 결과는 이 브라우저에만 저장해요."),
    h("p", { class: "hint" }, `기준: 초당 ${r.sampleHz}프레임 표본, 양쪽 눈 계수 ≥${r.close}로 닫힌 뒤 ≤${r.open}로 열리면 1회 (${r.minClosedSec}~${r.maxClosedSec}초). 얼굴 측정 ${r.minObservedSec}초 이상·인식 비율 ${r.minCoverage * 100}% 이상에서만 수치를 표시해요. 짧은 깜빡임은 놓칠 수 있어요.`),
    h("p", { class: "hint" }, `증가 구간: 다른 측정 가능 구간 ${r.minBaselineSec}초 이상 평균 대비 ${r.increaseRatio}배 및 분당 ${r.minExtraPerMin}회 이상 증가, 구간 내 최소 ${r.minWindowCount}회. 이번 영상 안에서의 비교이며 개인의 평소 기준·감정·진단을 뜻하지 않아요.`),
    b?.status === "ok" && !b.baselineAvailable ? h("p", null, "다른 구간의 측정 시간이 부족해 증가 구간 비교는 하지 않았어요.") : null,
    b?.status === "ok" ? h("table", null,
      h("thead", null, h("tr", null, ["영상 구간", "횟수", "얼굴 측정 시간", "분당 횟수"].map((x) => h("th", { scope: "col" }, x)))),
      h("tbody", null, b.windows.map((w) => h("tr", null,
        h("td", null, h("button", { type: "button", onclick: () => seek(w.startSec) }, `${formatClock(w.startSec)}~${formatClock(w.endSec)}`)),
        h("td", null, w.usable ? `${w.count}회` : "측정 못 함"), h("td", null, `${w.observedSec.toFixed(1)}초`), h("td", null, w.usable ? w.rate.toFixed(1) : "—"))))) : null,
    h("div", { class: "btn-row" }, button, cancel))
  button.addEventListener("click", async () => {
    const controller = new AbortController(), abort = () => controller.abort()
    window.addEventListener("hashchange", abort, { once: true })
    cancel.onclick = abort; cancel.hidden = false; button.disabled = true
    try {
      const blink = await analyzeVideoBlinks(session.videoBlob, { signal: controller.signal, onProgress: (at, total, message) => { status.textContent = `${message} ${Math.floor(at / total * 100)}%` } })
      if (!card.isConnected) return
      if (blink.status === "cancelled") { status.textContent = blink.reason; return }
      session.analysis.blink = blink
      session.analysis.items = [...session.analysis.items.filter((x) => x.type !== "blink"), ...buildReviewItems({ blink })]
        .sort((a, b) => a.startSec - b.startSec).map((x, i) => ({ ...x, id: i + 1 }))
      const saved = await saveSession(session)
      if (!saved.ok) session.notices.push("눈 깜빡임 결과를 저장하지 못했어요. 이 화면을 닫으면 분석 결과가 사라질 수 있어요.")
      if (card.isConnected) onUpdated(session)
    } finally {
      window.removeEventListener("hashchange", abort)
      button.disabled = false; cancel.hidden = true; cancel.onclick = null
    }
  })
  return [fillers, card]
}
