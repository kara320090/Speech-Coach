import test from "node:test"
import assert from "node:assert/strict"
import {
  checkScriptFile, decodeScript, readScriptFile, sessionScript, SCRIPT_ERRORS, SCRIPT_MAX_BYTES,
} from "../public/js/script.js"

// 개인정보 없는 가상 대본
const SAMPLE = "안녕하세요. 오늘은 가상의 도시 숲 가꾸기 계획을 소개하겠습니다.\n\n첫째, 나무 심기 일정입니다.\n둘째, 물 주기 당번표입니다."
const txt = (content, name = "가상대본.txt", type = "text/plain") => new File([content], name, { type })

test("정상 UTF-8 TXT: 한글과 줄바꿈(빈 줄 포함)을 그대로 읽는다", async () => {
  const r = await readScriptFile(txt(SAMPLE))
  assert.equal(r.ok, true)
  assert.equal(r.text, SAMPLE)
  assert.deepEqual(r.text.split("\n").map((l) => l === ""), [false, true, false, false])
})

test("BOM은 빼고, Windows·옛 Mac 줄바꿈은 \\n으로 맞춘다", async () => {
  const r = await readScriptFile(txt("﻿도입\r\n본론\r마무리"))
  assert.deepEqual(r, { ok: true, text: "도입\n본론\n마무리" })
})

test("형식 검사: .txt가 아니거나 text/plain이 아니면 읽지 않는다", async () => {
  assert.equal(checkScriptFile({ name: "대본.pdf", type: "application/pdf", size: 10 }), "type")
  assert.equal(checkScriptFile({ name: "대본.docx", type: "", size: 10 }), "type")
  assert.equal(checkScriptFile({ name: "대본.txt", type: "image/png", size: 10 }), "type")
  // 브라우저가 형식을 비워 주는 경우와 대문자 확장자는 받는다
  assert.equal(checkScriptFile({ name: "대본.TXT", type: "", size: 10 }), null)
  assert.equal(checkScriptFile({ name: "대본.txt", type: "text/plain;charset=utf-8", size: 10 }), null)
  const r = await readScriptFile(txt("내용", "슬라이드.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"))
  assert.deepEqual(r, { ok: false, error: "type", message: SCRIPT_ERRORS.type })
})

test("크기: 1MB까지는 읽고, 1MB를 넘으면 읽기 전에 거절한다", async () => {
  const exact = "가".repeat(Math.floor(SCRIPT_MAX_BYTES / 3)) // 가 = 3바이트
  assert.equal((await readScriptFile(txt(exact))).ok, true)
  const r = await readScriptFile(txt("a".repeat(SCRIPT_MAX_BYTES + 1)))
  assert.equal(r.error, "size")
  assert.match(r.message, /1MB/)
})

test("빈 파일과 공백·줄바꿈뿐인 파일은 거절한다", async () => {
  assert.equal((await readScriptFile(txt(""))).error, "empty")
  assert.equal((await readScriptFile(txt("  \n\t\r\n  "))).error, "empty")
  assert.equal((await readScriptFile(txt("﻿"))).error, "empty")
})

test("UTF-8이 아닌 파일(EUC-KR·UTF-16)은 인코딩 안내로 거절한다", () => {
  const eucKr = new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7]) // '안녕'의 EUC-KR 바이트
  assert.equal(decodeScript(eucKr).error, "encoding")
  const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0xc5, 0x55, 0xb1]) // BOM + '안녕' UTF-16LE
  assert.equal(decodeScript(utf16).error, "encoding")
  assert.equal(decodeScript(new Uint8Array([0x41, 0x00, 0x42, 0x00])).error, "encoding")
})

test("파일 읽기에 실패하면 읽기 실패 안내를 준다", async () => {
  const broken = { name: "가상대본.txt", type: "text/plain", size: 10, arrayBuffer: () => Promise.reject(new Error("NotReadableError")) }
  assert.deepEqual(await readScriptFile(broken), { ok: false, error: "read", message: SCRIPT_ERRORS.read })
})

test("sessionScript: session.script와 따로 둔 파일명(scriptFile)을 꺼낸다", () => {
  const edited = `${SAMPLE}\n셋째, 마무리 인사입니다.`
  assert.deepEqual(sessionScript({ script: edited, scriptFile: { name: "가상대본.txt", edited: true } }), { text: edited, fileName: "가상대본.txt" })
  assert.deepEqual(sessionScript({ script: "직접 쓴 대본", scriptFile: null }), { text: "직접 쓴 대본", fileName: "" })
  assert.deepEqual(sessionScript({ script: "" }), { text: "", fileName: "" })
})

test("sessionScript: 대본·파일명이 없는 기존 기록도 오류 없이 대본 없음으로 본다", () => {
  assert.deepEqual(sessionScript({ settings: { targetSec: 60, raw: { tmin: "1" } } }), { text: null, fileName: "" })
  assert.deepEqual(sessionScript({ scriptFile: { name: "고아.txt" } }), { text: null, fileName: "" })
  assert.deepEqual(sessionScript({ script: "글", scriptFile: { name: 3 } }), { text: "글", fileName: "" })
  assert.deepEqual(sessionScript({}), { text: null, fileName: "" })
  assert.deepEqual(sessionScript(undefined), { text: null, fileName: "" })
  assert.deepEqual(sessionScript(null), { text: null, fileName: "" })
})
