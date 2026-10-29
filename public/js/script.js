// 발표 대본: TXT 파일 검사·읽기와 기록에 남길 대본 정리. 파일과 내용은 브라우저 안에서만 다루고 서버로 보내지 않는다.

export const SCRIPT_MAX_BYTES = 1024 * 1024

export const SCRIPT_ERRORS = {
  type: "TXT 파일(.txt)만 불러올 수 있어요. PDF·워드·한글·PPT 파일은 아직 지원하지 않아요. 내용을 복사해 아래 입력란에 붙여 넣어 주세요.",
  size: "파일이 1MB보다 커서 불러오지 않았어요. 대본을 나눠서 붙여 넣거나 1MB 이하 파일로 다시 골라 주세요.",
  empty: "파일에 글자가 없어요. 빈 파일이거나 공백뿐인 파일이에요.",
  encoding: "UTF-8로 저장된 TXT 파일만 읽을 수 있어요. 메모장 등에서 '다른 이름으로 저장' → 인코딩 UTF-8로 저장한 뒤 다시 골라 주세요.",
  read: "파일을 읽지 못했어요. 파일이 옮겨졌거나 열 수 없는 상태인지 확인하고 다시 골라 주세요.",
  textSize: "대본이 1MB보다 길어요. 연습에 쓸 부분만 남겨 주세요.",
}

/** 파일을 읽기 전에 이름·형식·크기를 확인한다. 문제가 없으면 null. */
export function checkScriptFile(file) {
  const name = String(file?.name || "")
  const type = String(file?.type || "").toLowerCase()
  if (!/\.txt$/i.test(name) || (type && !type.startsWith("text/plain"))) return "type"
  if (file.size > SCRIPT_MAX_BYTES) return "size"
  if (file.size === 0) return "empty"
  return null
}

/** UTF-8 바이트를 대본 글로 바꾼다. BOM은 빼고 줄바꿈은 \n으로 맞춘다. */
export function decodeScript(buffer) {
  let text
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    return { ok: false, error: "encoding" }
  }
  // UTF-16 등으로 저장된 파일은 NUL 문자가 섞여 나온다.
  if (text.includes("\u0000")) return { ok: false, error: "encoding" }
  text = normalizeScript(text)
  if (!text.trim()) return { ok: false, error: "empty" }
  return { ok: true, text }
}

export function normalizeScript(text) {
  return String(text ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n")
}

/** 반환: { ok: true, text } 또는 { ok: false, error, message } */
export async function readScriptFile(file) {
  const bad = checkScriptFile(file)
  if (bad) return { ok: false, error: bad, message: SCRIPT_ERRORS[bad] }
  let buffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    return { ok: false, error: "read", message: SCRIPT_ERRORS.read }
  }
  const r = decodeScript(buffer)
  return r.ok ? r : { ...r, message: SCRIPT_ERRORS[r.error] }
}

/** 연습 시작 시 기록에 남길 대본. 공백뿐이면 대본 없음(null). */
export function scriptForPractice(text, fileName) {
  const t = normalizeScript(text)
  if (!t.trim()) return { script: null, error: null }
  if (new TextEncoder().encode(t).length > SCRIPT_MAX_BYTES) return { script: null, error: SCRIPT_ERRORS.textSize }
  return { script: { text: t, fileName: fileName || null }, error: null }
}

/** 기록에서 대본을 꺼낸다. 대본 기능 이전 기록이면 null. */
export function sessionScript(session) {
  const s = session?.settings?.script
  return s && typeof s.text === "string" && s.text.trim() ? s : null
}
