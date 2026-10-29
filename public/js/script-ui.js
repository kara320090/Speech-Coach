// 대본 패널 '대본 편집' 모드의 TXT 파일 불러오기 조각.
// 파일 검사·읽기는 script.js가 맡고, 이 파일은 파일 선택·읽는 중·오류·덮어쓰기 확인 화면만 만든다.
// 대본 패널은 자주 다시 그려지므로 읽는 중·오류·확인 대기 상태는 이 모듈 안에 둔다. 파일과 대본은 서버로 보내지 않는다.
import { readScriptFile } from "./script.js"

function el(tag, props, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === "class") e.className = v
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === "hidden" || k === "disabled") e[k] = v
    else e.setAttribute(k, v === true ? "" : String(v))
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  }
  return e
}

/**
 * needsConfirm(text): 지금 대본을 text로 바꾸기 전에 물어야 하면 true (직접 입력·편집했거나 파일로 불러온 대본이 있을 때).
 * apply(name, text): 대본을 바꾸고 파일명을 기록한다.
 * getFile(): 지금 대본의 파일 정보 { name, edited } 또는 null.
 * onChange(): 상태가 바뀌어 대본 패널을 다시 그려야 할 때.
 */
export function createScriptImport({ needsConfirm, apply, getFile, onChange }) {
  const st = { reading: false, status: "", error: "", pending: null }
  let fileLine = null
  const fileText = () => {
    const file = getFile()
    return file ? `불러온 파일: ${file.name}${file.edited ? " (불러온 뒤 수정함)" : ""}` : "불러온 파일 없음"
  }
  const update = () => onChange?.()
  const replace = (name, text) => {
    apply(name, text)
    st.pending = null
    st.status = `'${name}' 내용을 대본에 넣었어요. 확인하고 고쳐 쓸 수 있어요.`
    update()
  }

  async function onPick(ev) {
    const input = ev.target
    const f = input.files?.[0]
    if (!f || st.reading) return // 선택 창을 취소하면 아무것도 바꾸지 않는다
    st.reading = true
    st.error = ""
    st.pending = null
    st.status = `'${f.name}' 파일을 읽는 중이에요…`
    update()
    const r = await readScriptFile(f)
    st.reading = false
    input.value = "" // 같은 파일을 다시 골라도 change가 오도록 비운다
    if (!r.ok) {
      st.status = ""
      st.error = r.message
      return update()
    }
    if (!needsConfirm(r.text)) return replace(f.name, r.text)
    st.status = ""
    st.pending = { name: f.name, text: r.text }
    update()
  }

  function render(disabled = false) {
    const p = st.pending
    fileLine = el("p", { class: "hint", "data-testid": "script-file-name" }, fileText())
    return el(
      "div",
      { class: "script-import" },
      el("div", { class: "field" }, el("label", { for: "f-script-file" }, "TXT 파일 선택"), el("input", { id: "f-script-file", type: "file", accept: ".txt,text/plain", "aria-describedby": "script-file-hint", disabled: disabled || st.reading, onchange: onPick })),
      el("p", { class: "hint", id: "script-file-hint" }, "UTF-8로 저장된 1MB 이하 .txt 파일을 불러와요. 파일은 이 브라우저 안에서만 읽고 서버로 보내지 않아요."),
      fileLine,
      st.status ? el("p", { class: "hint", role: "status", "data-testid": "script-status" }, st.status) : null,
      st.error ? el("div", { class: "errors", role: "alert", "data-testid": "script-error" }, el("strong", null, "대본 파일을 불러오지 못했어요."), " ", st.error, " 지금 대본은 그대로 두었어요.") : null,
      p
        ? el(
            "div",
            { class: "notice", "data-testid": "script-confirm" },
            el("p", null, `지금 대본이 있어요. '${p.name}' 내용으로 바꿀까요? 바꾸면 지금 대본은 사라져요.`),
            el(
              "div",
              { class: "btn-row" },
              el("button", { type: "button", class: "btn btn-primary", disabled, onclick: () => replace(p.name, p.text) }, "파일 내용으로 바꾸기"),
              el("button", { type: "button", class: "btn btn-ghost", onclick: () => { st.pending = null; st.status = "지금 대본을 그대로 두었어요."; update() } }, "지금 대본 유지"),
            ),
          )
        : null,
    )
  }

  /** 대본을 직접 고칠 때 패널 전체를 다시 그리지 않고 파일명 줄만 고친다(입력란 포커스 유지). */
  const refresh = () => {
    if (fileLine) fileLine.textContent = fileText()
  }

  return { render, refresh, busy: () => st.reading }
}
