// POST /api/scripts/import — 대본 파일(TXT·PDF·DOCX) 하나를 받아 글자만 꺼내 돌려준다.
// 파일은 메모리에서만 다루고 디스크에 저장하지 않으며(임시 파일 없음), 외부 서비스로 보내지 않는다.
// PDF·DOCX 해석은 문서마다 새 작업 스레드에서 메모리·시간 상한을 두고 돌린다. 파일 이름·내용은 로그에 남기지 않는다.
import { Worker } from "node:worker_threads"
import busboy from "@fastify/busboy"

export const IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024, // 파일 하나 10MB
  maxRequestBytes: 10 * 1024 * 1024 + 64 * 1024, // multipart 머리·경계 여유
  maxTextChars: 200_000, // 꺼낸 글자 수(공백 포함)
  maxPdfPages: 300,
  timeoutMs: 20_000, // 문서 하나 해석 시간
  workerMemoryMb: 256, // 작업 스레드 힙 상한
  maxConcurrent: 2, // 동시에 해석하는 문서 수
}

const ERRORS = {
  "not-multipart": [415, "multipart/form-data 형식으로 file 필드에 파일 하나를 담아 보내 주세요."],
  "file-missing": [400, "파일이 없어요. file 필드에 파일 하나를 담아 보내 주세요."],
  "unexpected-field": [400, "파일은 file 필드 이름으로 보내 주세요."],
  "too-many-files": [400, "파일은 한 번에 하나만 보낼 수 있어요."],
  "bad-request": [400, "요청을 읽지 못했어요. multipart/form-data 형식을 확인해 주세요."],
  "too-large": [413, "파일이 10MB보다 커서 받지 않았어요."],
  "unsupported-type": [415, "TXT(UTF-8)·PDF·DOCX 파일만 불러올 수 있어요."],
  "legacy-doc": [415, "구형 워드(.doc) 파일은 지원하지 않아요. 워드에서 .docx로 저장한 뒤 다시 보내 주세요."],
  "invalid-encoding": [422, "UTF-8로 저장된 TXT 파일만 읽을 수 있어요. 메모장 등에서 인코딩을 UTF-8로 저장한 뒤 다시 보내 주세요."],
  "empty-text": [422, "파일에서 읽을 글자가 없어요. 빈 파일이거나 공백뿐인 문서예요."],
  "corrupt-document": [422, "문서를 읽지 못했어요. 파일이 손상됐거나 확장자와 실제 형식이 달라요."],
  "encrypted-pdf": [422, "암호가 걸린 PDF는 읽을 수 없어요. 암호를 해제한 PDF로 다시 보내 주세요."],
  "encrypted-docx": [422, "암호가 걸린 워드 문서는 읽을 수 없어요. 암호를 해제한 뒤 다시 보내 주세요."],
  "no-text-pdf": [422, "이 PDF에는 글자 정보가 없어요. 스캔하거나 이미지로 만든 PDF는 글자 인식(OCR)을 지원하지 않아요."],
  "text-too-long": [422, "꺼낸 글자가 20만 자를 넘어서 받지 않았어요. 연습에 쓸 부분만 담은 파일로 보내 주세요."],
  "too-complex": [422, "문서가 너무 크거나 복잡해서 정해진 시간·메모리 안에 읽지 못했어요. 페이지를 줄인 파일로 다시 보내 주세요."],
  busy: [503, "지금 다른 문서를 읽는 중이에요. 잠시 뒤에 다시 보내 주세요."],
}

export class ImportError extends Error {
  constructor(code) {
    super(code)
    this.code = code
    ;[this.status, this.userMessage] = ERRORS[code] || ERRORS["corrupt-document"]
  }
}

/** 오류 응답 본문. 모든 오류가 { error, message } 모양이다(/api/transcribe와 같은 모양). */
export function errorBody(code) {
  const e = new ImportError(code)
  return { status: e.status, body: { error: e.code, message: e.userMessage } }
}

/** 경로·제어 문자를 빼고 길이를 줄인 파일 이름. */
export function cleanFileName(name) {
  const base = String(name || "").split(/[\\/]/).pop()
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || "script"
}

/** 확장자로 형식을 고른다. 실제 내용은 detectAndCheck에서 다시 확인한다. */
export function kindOf(fileName) {
  const ext = (fileName.match(/\.([^.]+)$/)?.[1] || "").toLowerCase()
  if (ext === "txt") return "txt"
  if (ext === "pdf") return "pdf"
  if (ext === "docx") return "docx"
  if (ext === "doc") throw new ImportError("legacy-doc")
  throw new ImportError("unsupported-type")
}

const PDF_MAGIC = Buffer.from("%PDF-")
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) // 암호화 DOCX·구형 DOC가 쓰는 OLE 상자

/** 확장자와 실제 파일 머리가 맞는지 확인한다. */
function checkSignature(kind, buf) {
  if (kind === "pdf" && buf.subarray(0, 1024).indexOf(PDF_MAGIC) === -1) throw new ImportError("corrupt-document")
  if (kind === "docx") {
    if (buf.subarray(0, 8).equals(OLE_MAGIC)) throw new ImportError("encrypted-docx")
    if (!buf.subarray(0, 4).equals(ZIP_MAGIC)) throw new ImportError("corrupt-document")
  }
}

/** 줄바꿈을 \n으로 맞추고, 줄 끝 공백과 3줄 이상 빈 줄을 줄인다. 한글·문단 구분은 그대로 둔다. */
export function normalizeText(text) {
  return String(text)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u000b\u000c\u2028\u2029]/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function decodeUtf8(buf) {
  let text
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf)
  } catch {
    throw new ImportError("invalid-encoding")
  }
  if (text.includes("\u0000")) throw new ImportError("invalid-encoding") // UTF-16 등은 NUL이 섞여 나온다
  return text
}

function runWorker(kind, buf, limits) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./extract-worker.js", import.meta.url), {
      workerData: { kind, limits: { maxPages: limits.maxPdfPages, maxChars: limits.maxTextChars } },
      resourceLimits: { maxOldGenerationSizeMb: limits.workerMemoryMb, maxYoungGenerationSizeMb: 32 },
      stdout: true, // 라이브러리가 찍는 출력이 서버 로그로 새지 않게 받아서 버린다
      stderr: true,
    })
    worker.stdout.resume()
    worker.stderr.resume()
    let done = false
    const finish = (fn, v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      worker.terminate().catch(() => {})
      fn(v)
    }
    const timer = setTimeout(() => finish(reject, new ImportError("too-complex")), limits.timeoutMs)
    worker.once("message", (m) => (m?.ok ? finish(resolve, m.text) : finish(reject, new ImportError(m?.code))))
    worker.once("error", (e) => finish(reject, new ImportError(e?.code === "ERR_WORKER_OUT_OF_MEMORY" ? "too-complex" : "corrupt-document")))
    worker.once("exit", () => finish(reject, new ImportError("too-complex")))
    const copy = new Uint8Array(buf) // 받은 버퍼를 복사해 스레드로 넘긴다
    worker.postMessage(copy, [copy.buffer])
  })
}

/** 파일 내용을 확인하고 글자를 꺼낸다. 반환: 정리된 글. 실패하면 ImportError. */
export async function extractScript(fileName, buf, limits = IMPORT_LIMITS) {
  const kind = kindOf(fileName)
  if (!buf.length) throw new ImportError("empty-text")
  checkSignature(kind, buf)
  const raw = kind === "txt" ? decodeUtf8(buf) : await runWorker(kind, buf, limits)
  const text = normalizeText(raw)
  if (!text) throw new ImportError(kind === "pdf" ? "no-text-pdf" : "empty-text")
  if (text.length > limits.maxTextChars) throw new ImportError("text-too-long")
  return text
}

/**
 * multipart 요청에서 file 필드의 파일 하나를 메모리로 받는다.
 * 반환: { fileName, buffer }. 크기 초과·다중 파일·필드 오류면 ImportError.
 */
export function receiveFile(req, limits = IMPORT_LIMITS) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers["content-type"] || "")
    if (!/^multipart\/form-data\b/i.test(type)) return reject(new ImportError("not-multipart"))
    const declared = Number(req.headers["content-length"])
    if (Number.isFinite(declared) && declared > limits.maxRequestBytes) return reject(new ImportError("too-large"))

    let bb
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: limits.maxFileBytes, fields: 20, fieldSize: 1024, parts: 25 } })
    } catch {
      return reject(new ImportError("bad-request"))
    }
    let file = null
    let failure = null
    let received = 0
    const fail = (code) => {
      failure ||= new ImportError(code)
    }
    // 머리에 길이가 없어도(chunked) 요청 전체 크기를 센다.
    req.on("data", (c) => {
      received += c.length
      if (received > limits.maxRequestBytes) {
        fail("too-large")
        req.unpipe(bb)
        settle()
      }
    })
    bb.on("file", (field, stream, filename) => {
      if (field !== "file") {
        fail("unexpected-field")
        return stream.resume()
      }
      if (file) {
        fail("too-many-files")
        return stream.resume()
      }
      const chunks = []
      file = { fileName: cleanFileName(filename), chunks }
      stream.on("data", (c) => chunks.push(c))
      stream.on("limit", () => fail("too-large"))
    })
    bb.on("filesLimit", () => fail("too-many-files"))
    bb.on("partsLimit", () => fail("bad-request"))
    bb.on("error", () => {
      fail("bad-request")
      settle()
    })
    bb.on("finish", () => settle())
    let settled = false
    function settle() {
      if (settled) return
      settled = true
      if (failure) return reject(failure)
      if (!file) return reject(new ImportError("file-missing"))
      resolve({ fileName: file.fileName, buffer: Buffer.concat(file.chunks) })
    }
    req.pipe(bb)
  })
}

/** server.js에 연결하는 요청 처리기. sendJson(res, status, body)는 서버의 공통 응답 함수. */
export function createScriptImportHandler({ sendJson, limits = IMPORT_LIMITS }) {
  let active = 0
  return async function handleScriptImport(req, res) {
    const reply = (status, body) => {
      if (status >= 400 && !req.complete) {
        // 다 받지 못한 요청은 응답 뒤 연결을 닫는다(남은 업로드를 더 읽지 않는다).
        res.setHeader("Connection", "close")
        res.once("finish", () => req.destroy())
      }
      sendJson(res, status, body)
    }
    const replyError = (e) => {
      const { status, body } = errorBody(e instanceof ImportError ? e.code : "corrupt-document")
      if (status === 503) res.setHeader("Retry-After", "5")
      reply(status, body)
    }
    let upload
    try {
      upload = await receiveFile(req, limits)
    } catch (e) {
      return replyError(e)
    }
    if (active >= limits.maxConcurrent) return replyError(new ImportError("busy"))
    active++
    try {
      const text = await extractScript(upload.fileName, upload.buffer, limits)
      reply(200, { fileName: upload.fileName, text })
    } catch (e) {
      replyError(e)
    } finally {
      active--
      upload.buffer = null
    }
  }
}
