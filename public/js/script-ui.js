// 발표 대본 화면 조각: 준비 화면의 대본 입력, 연습 화면 배치, 결과 화면 카드.
// 파일 검사·읽기는 script.js가 맡고, 이 파일은 화면만 만든다. 파일과 대본은 서버로 보내지 않는다.
import { readScriptFile, sessionScript } from "./script.js"

function el(tag, props, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === "class") e.className = v
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === "value" || k === "hidden" || k === "disabled") e[k] = v
    else e.setAttribute(k, v === true ? "" : String(v))
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return e
}

/**
 * 대본 입력: TXT 파일 선택 또는 직접 붙여넣기. 어느 쪽이든 입력란의 내용이 연습에 쓰인다.
 * 파일 선택을 취소하거나 읽기에 실패하면 입력란을 건드리지 않는다.
 * onBusy(true/false)는 파일을 읽는 동안 연습 시작을 막는 데 쓴다.
 */
export function createScriptInput({ text = "", fileName: initialName = "", onBusy } = {}) {
  let fileName = initialName
  let loadedText = text
  let reading = false
  const area = el("textarea", { id: "f-script", rows: "8", placeholder: "대본을 직접 붙여 넣거나, 위에서 TXT 파일을 골라 불러온 뒤 고쳐 쓸 수 있어요." })
  area.value = text
  const file = el("input", { id: "f-script-file", type: "file", accept: ".txt,text/plain", "aria-describedby": "script-file-hint" })
  const fileInfo = el("p", { class: "hint", id: "script-file-name", "data-testid": "script-file-name" })
  const status = el("p", { class: "hint", role: "status", id: "script-status", "data-testid": "script-status" })
  const error = el("div", { class: "errors", role: "alert", id: "script-error", "data-testid": "script-error", hidden: true })
  const confirmBox = el("div", { class: "notice", id: "script-confirm", hidden: true })
  const count = el("p", { class: "hint", id: "script-count" })

  const refresh = () => {
    if (!fileName) fileInfo.textContent = "불러온 파일 없음 (직접 입력한 대본은 그대로 써요)"
    else fileInfo.textContent = `불러온 파일: ${fileName}${area.value !== loadedText ? " (불러온 뒤 수정함)" : ""}`
    count.textContent = area.value.trim() ? `${area.value.length.toLocaleString("ko-KR")}자 · 연습 화면에 이 내용이 그대로 보여요.` : "대본 없이도 연습할 수 있어요."
  }
  const setBusy = (busy) => {
    reading = busy
    file.disabled = busy
    onBusy?.(busy)
  }
  const showError = (msg) => {
    error.replaceChildren(el("strong", null, "대본 파일을 불러오지 못했어요."), " ", msg, " 입력란의 기존 대본은 그대로 두었어요.")
    error.hidden = false
  }
  const apply = (name, newText) => {
    area.value = newText
    fileName = name
    loadedText = newText
    confirmBox.hidden = true
    status.textContent = `'${name}' 내용을 입력란에 넣었어요. 확인하고 고쳐 쓸 수 있어요.`
    refresh()
  }

  file.addEventListener("change", async () => {
    const f = file.files?.[0]
    if (!f || reading) return // 선택 창을 취소하면 아무것도 바꾸지 않는다
    error.hidden = true
    confirmBox.hidden = true
    setBusy(true)
    status.textContent = `'${f.name}' 파일을 읽는 중이에요…`
    const r = await readScriptFile(f)
    setBusy(false)
    file.value = "" // 같은 파일을 다시 골라도 change가 오도록 비운다
    if (!r.ok) {
      status.textContent = ""
      return showError(r.message)
    }
    if (!area.value.trim() || area.value === r.text) return apply(f.name, r.text)
    status.textContent = ""
    confirmBox.replaceChildren(
      el("p", null, `입력란에 이미 대본이 있어요. '${f.name}' 내용으로 바꿀까요? 바꾸면 지금 입력란의 내용은 사라져요.`),
      el(
        "div",
        { class: "btn-row" },
        el("button", { type: "button", id: "btn-script-replace", onclick: () => apply(f.name, r.text) }, "파일 내용으로 바꾸기"),
        el("button", { type: "button", id: "btn-script-keep", onclick: () => { confirmBox.hidden = true; status.textContent = "기존 대본을 그대로 두었어요." } }, "지금 대본 유지"),
      ),
    )
    confirmBox.hidden = false
  })
  area.addEventListener("input", refresh)
  refresh()

  const fieldset = el(
    "fieldset",
    null,
    el("legend", null, "발표 대본 (선택)"),
    el("div", { class: "field" }, el("label", { for: "f-script-file" }, "TXT 파일 선택"), file),
    el("p", { class: "hint", id: "script-file-hint" }, "UTF-8로 저장된 1MB 이하 .txt 파일을 불러와요. 파일은 이 브라우저 안에서만 읽고 서버로 보내지 않아요."),
    fileInfo,
    status,
    error,
    confirmBox,
    el("label", { for: "f-script" }, "대본 내용 (직접 붙여넣기·수정)"),
    area,
    count,
  )
  return {
    fieldset,
    busy: () => reading,
    text: () => area.value,
    fileName: () => (area.value.trim() ? fileName : ""),
  }
}

/** 대본을 줄바꿈을 살린 일반 글자로 보여 주는 영역. 길면 영역 안에서 스크롤한다(자동 스크롤 없음). */
export function scriptBlock(script, testid) {
  return el(
    "section",
    { class: "script-view", "aria-label": "발표 대본" },
    el("h2", null, "발표 대본"),
    el("div", { class: "script-text", tabindex: "0", "data-testid": testid }, script.text),
  )
}

/** 연습 화면의 영상·대본 배치. 둘 다 없으면 null. 데스크톱은 나란히, 좁은 화면은 위아래(script.css). */
export function practiceStage(preview, script) {
  const view = script ? scriptBlock(script, "script-view") : null
  if (!preview && !view) return null
  return el("div", { class: "stage", "data-video": preview ? "on" : "off", "data-script": view ? "on" : "off" }, preview, view)
}

/** 결과 화면의 '이 연습에 쓴 대본' 카드. 대본 기능 이전 기록은 대본 없음으로 보여 준다. */
export function scriptResultCard(session) {
  const used = sessionScript(session)
  return el(
    "section",
    { class: "card", "aria-label": "이 연습의 대본" },
    el("h2", null, "이 연습에 쓴 대본"),
    used
      ? el("details", null, el("summary", null, `대본 보기${used.fileName ? ` (불러온 파일: ${used.fileName})` : ""} · 연습 시작 때 내용 그대로예요`), scriptBlock(used, "result-script"))
      : el("p", { class: "hint", "data-testid": "no-script" }, "대본 없이 한 연습이에요."),
  )
}

/** '같은 조건으로 다시 연습'에 채울 대본 값. */
export function scriptPrefill(session) {
  const used = sessionScript(session)
  return { script: used?.text || "", scriptName: used?.fileName || "" }
}
