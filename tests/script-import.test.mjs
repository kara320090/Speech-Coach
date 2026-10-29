import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { createServer } from "../server.js"
import { IMPORT_LIMITS, normalizeText } from "../server/script-import.js"
import { makeDocx, makeImageOnlyPdf, makePdf } from "./helpers/make-docs.mjs"

// 개인정보 없는 가상 대본 문장
const LINE1 = "안녕하세요. 오늘은 가상의 도시 숲 가꾸기 계획을 소개하겠습니다."
const LINE2 = "첫째, 나무 심기 일정입니다."
const LINE3 = "둘째, 물 주기 당번표입니다."

/** 실제로 포트를 열어 multipart 요청을 보낸다. */
async function withServer(fn, opts = {}) {
  const server = createServer({ env: {}, ...opts })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await fn(base)
  } finally {
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  }
}

function form(files, extra = {}) {
  const fd = new FormData()
  for (const [field, name, data, type = "application/octet-stream"] of files) fd.append(field, new Blob([data], { type }), name)
  for (const [k, v] of Object.entries(extra)) fd.append(k, v)
  return fd
}

async function upload(base, body, init = {}) {
  const res = await fetch(`${base}/api/scripts/import`, { method: "POST", body, ...init })
  return { status: res.status, type: res.headers.get("content-type"), json: await res.json() }
}

const one = (base, name, data, type) => upload(base, form([["file", name, data, type]]))

// 파일 내용이 로그로 새는지 본다(서버는 console을 쓰지 않아야 한다).
const logged = []
for (const k of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[k]
  console[k] = (...a) => {
    logged.push(a.map(String).join(" "))
    orig.apply(console, a)
  }
}

test("TXT(UTF-8): 한글·문단 줄바꿈을 보존하고 BOM·CRLF를 정리해 { fileName, text }로 돌려준다", async () => {
  await withServer(async (base) => {
    const r = await one(base, "가상 발표대본.txt", `\uFEFF${LINE1}\r\n${LINE2}\r\n\r\n${LINE3}\r\n`, "text/plain")
    assert.equal(r.status, 200)
    assert.match(r.type, /application\/json/)
    assert.deepEqual(r.json, { fileName: "가상 발표대본.txt", text: `${LINE1}\n${LINE2}\n\n${LINE3}` })
  })
})

test("PDF(글자 정보 있음): 한글 문장과 줄·문단·페이지 구분을 꺼낸다", async () => {
  const pdf = makePdf(null, { pages: [[{ text: LINE1, y: 760 }, { text: LINE2, y: 740 }, { text: LINE3, y: 690 }], [{ text: "감사합니다.", y: 760 }]] })
  await withServer(async (base) => {
    const r = await one(base, "발표대본.pdf", pdf, "application/pdf")
    assert.equal(r.status, 200)
    assert.equal(r.json.fileName, "발표대본.pdf")
    assert.equal(r.json.text, `${LINE1}\n${LINE2}\n\n${LINE3}\n\n감사합니다.`)
  })
})

test("DOCX: 문단은 빈 줄로, 문단 안 줄바꿈은 줄바꿈으로 꺼낸다", async () => {
  const docx = makeDocx([LINE1, `${LINE2}\n${LINE3}`, "", "감사합니다. & <끝>"])
  await withServer(async (base) => {
    const r = await one(base, "발표대본.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    assert.equal(r.status, 200)
    assert.equal(r.json.text, `${LINE1}\n\n${LINE2}\n${LINE3}\n\n감사합니다. & <끝>`)
  })
})

test("확장자는 대소문자를 가리지 않고, 파일 이름의 경로·제어 문자는 뺀다", async () => {
  await withServer(async (base) => {
    const r = await one(base, "..\\폴더/대본\u0007.TXT", LINE1)
    assert.equal(r.status, 200)
    assert.equal(r.json.fileName, "대본.TXT")
  })
})

/** 오류는 모두 { error, message } 모양이다. */
async function expectError(promise, status, code) {
  const r = await promise
  assert.equal(r.status, status, `${code}: ${JSON.stringify(r.json)}`)
  assert.equal(r.json.error, code)
  assert.equal(typeof r.json.message, "string")
  assert.ok(r.json.message.length > 0)
  assert.deepEqual(Object.keys(r.json).sort(), ["error", "message"])
}

test("요청 오류: 파일 누락·다른 필드 이름·다중 파일·multipart 아님·GET", async () => {
  await withServer(async (base) => {
    await expectError(upload(base, form([], { note: "파일 없음" })), 400, "file-missing")
    await expectError(upload(base, form([["script", "a.txt", LINE1]])), 400, "unexpected-field")
    await expectError(upload(base, form([["file", "a.txt", LINE1], ["file", "b.txt", LINE2]])), 400, "too-many-files")
    await expectError(upload(base, LINE1, { headers: { "content-type": "text/plain" } }), 415, "not-multipart")
    await expectError(upload(base, "--x\r\nbroken", { headers: { "content-type": "multipart/form-data" } }), 400, "bad-request") // 경계(boundary) 없음
    const get = await fetch(`${base}/api/scripts/import`)
    assert.equal(get.status, 405)
    assert.equal(get.headers.get("allow"), "POST")
  })
})

test("크기: 10MB까지 받고 10MB를 넘으면 413", async () => {
  await withServer(async (base) => {
    const ok = Buffer.alloc(IMPORT_LIMITS.maxFileBytes, 0x61) // a × 10MB
    await expectError(one(base, "큰대본.txt", ok), 422, "text-too-long") // 크기는 통과, 글자 수 한도에서 걸림
    await expectError(one(base, "너무큰대본.txt", Buffer.alloc(IMPORT_LIMITS.maxFileBytes + 1, 0x61)), 413, "too-large")
  })
})

/** fetch가 대신 붙이지 않도록 직접 머리를 정해 보낸다. */
function rawPost(base, headers, writeBody) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/scripts/import`, { method: "POST", headers }, (res) => {
      let data = ""
      res.setEncoding("utf8")
      res.on("data", (c) => (data += c))
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(data) }))
    })
    req.on("error", reject)
    writeBody(req)
  })
}

test("요청 크기: 길이를 미리 밝히지 않은(chunked) 큰 요청과 길이를 크게 밝힌 요청도 413", async () => {
  const limits = { importLimits: { ...IMPORT_LIMITS, maxFileBytes: 1000, maxRequestBytes: 2000 } }
  await withServer(async (base) => {
    const boundary = "----testboundary"
    const r = await rawPost(base, { "content-type": `multipart/form-data; boundary=${boundary}`, "transfer-encoding": "chunked" }, (req) => {
      req.write(`--${boundary}\r\ncontent-disposition: form-data; name="note"\r\n\r\n`)
      for (let i = 0; i < 10; i++) req.write("x".repeat(500)) // 파일이 아닌 필드로 요청 전체를 키운다
      req.end(`\r\n--${boundary}--\r\n`)
    })
    assert.deepEqual([r.status, r.json.error], [413, "too-large"])
    const big = await rawPost(base, { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": "999999999" }, (req) => req.write("--"))
    assert.deepEqual([big.status, big.json.error], [413, "too-large"])
  }, limits)
})

test("형식: 미지원 확장자·구형 .doc는 415, 확장자와 실제 내용이 다르면 손상 문서", async () => {
  await withServer(async (base) => {
    await expectError(one(base, "그림.png", Buffer.from([0x89, 0x50, 0x4e, 0x47])), 415, "unsupported-type")
    await expectError(one(base, "확장자없음", LINE1), 415, "unsupported-type")
    await expectError(one(base, "옛날문서.doc", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), 415, "legacy-doc")
    await expectError(one(base, "가짜.pdf", LINE1), 422, "corrupt-document")
    await expectError(one(base, "가짜.docx", LINE1), 422, "corrupt-document")
  })
})

test("내용 오류: 잘못된 UTF-8·UTF-16, 빈 TXT·공백뿐, 빈 DOCX", async () => {
  await withServer(async (base) => {
    await expectError(one(base, "euc-kr.txt", Buffer.from([0xbe, 0xc8, 0xb3, 0xe7])), 422, "invalid-encoding")
    await expectError(one(base, "utf16.txt", Buffer.from([0xff, 0xfe, 0x48, 0xc5, 0x55, 0xb1])), 422, "invalid-encoding")
    await expectError(one(base, "빈.txt", ""), 422, "empty-text")
    await expectError(one(base, "공백.txt", " \n\t\r\n "), 422, "empty-text")
    await expectError(one(base, "빈.docx", makeDocx(["", "   "])), 422, "empty-text")
  })
})

test("손상·암호화·글자 없는 문서: 손상 PDF·DOCX, 암호 PDF·DOCX, 스캔처럼 글자 없는 PDF", async () => {
  await withServer(async (base) => {
    await expectError(one(base, "손상.pdf", Buffer.from("%PDF-1.4\n이것은 PDF 구조가 아닙니다")), 422, "corrupt-document")
    await expectError(one(base, "손상.docx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("깨진 압축 파일")])), 422, "corrupt-document")
    await expectError(one(base, "잠금.pdf", makePdf([{ text: LINE1, y: 700 }], { encrypt: true })), 422, "encrypted-pdf")
    await expectError(one(base, "잠금.docx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])), 422, "encrypted-docx")
    const r = await one(base, "스캔.pdf", makeImageOnlyPdf())
    assert.equal(r.status, 422)
    assert.equal(r.json.error, "no-text-pdf")
    assert.match(r.json.message, /OCR/)
  })
})

test("자원 한도: 글자 수·시간·PDF 페이지 수·동시 처리 수를 넘으면 거절한다", async () => {
  const small = (over) => ({ importLimits: { ...IMPORT_LIMITS, ...over } })
  await withServer((base) => expectError(one(base, "긴.txt", "가".repeat(101)), 422, "text-too-long"), small({ maxTextChars: 100 }))
  await withServer((base) => expectError(one(base, "긴.pdf", makePdf([{ text: "가".repeat(80), y: 700 }])), 422, "text-too-long"), small({ maxTextChars: 30 }))
  await withServer((base) => expectError(one(base, "느림.pdf", makePdf([{ text: LINE1, y: 700 }])), 422, "too-complex"), small({ timeoutMs: 1 }))
  const pages = makePdf(null, { pages: [[{ text: "1", y: 700 }], [{ text: "2", y: 700 }], [{ text: "3", y: 700 }]] })
  await withServer((base) => expectError(one(base, "많은.pdf", pages), 422, "too-complex"), small({ maxPdfPages: 2 }))
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/scripts/import`, { method: "POST", body: form([["file", "a.txt", LINE1]]) })
    assert.equal(res.status, 503)
    assert.equal(res.headers.get("retry-after"), "5")
    assert.equal((await res.json()).error, "busy")
  }, small({ maxConcurrent: 0 }))
})

test("한도 안에서 여러 요청을 동시에 보내도 각자 결과를 받는다", async () => {
  await withServer(async (base) => {
    const rs = await Promise.all([
      one(base, "1.pdf", makePdf([{ text: LINE1, y: 700 }])),
      one(base, "2.docx", makeDocx([LINE2])),
    ])
    assert.deepEqual(rs.map((r) => r.status), [200, 200])
    assert.equal(rs[0].json.text, LINE1)
    assert.equal(rs[1].json.text, LINE2)
  })
})

test("기존 서버 기능은 그대로: /__health, 정적 파일, /api/transcribe 키 없음 503", async () => {
  await withServer(async (base) => {
    assert.deepEqual(await (await fetch(`${base}/__health`)).json(), { status: "ok", releaseId: "t" })
    assert.equal((await fetch(`${base}/`)).status, 200)
    assert.equal((await fetch(`${base}/api/transcribe`, { method: "POST", body: "x" })).status, 503)
  }, { releaseId: "t" })
})

test("normalizeText: 3줄 이상 빈 줄과 줄 끝 공백만 줄이고 한글·문단은 둔다", () => {
  assert.equal(normalizeText(`  ${LINE1}  \n\n\n\n${LINE2}\u00a0\n`), `${LINE1}\n\n${LINE2}`)
})

test("파일 내용·파일 이름은 서버 로그(console)에 남지 않는다", () => {
  for (const s of [LINE1, LINE2, LINE3, "발표대본", "가상"]) assert.ok(!logged.some((l) => l.includes(s)), `로그에 '${s}'가 남았다`)
})
