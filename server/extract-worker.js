// 대본 문서(PDF·DOCX)에서 글자만 꺼내는 작업 스레드. script-import.js가 문서마다 새로 띄우고,
// 메모리 상한(resourceLimits)과 시간 제한을 넘기면 스레드째 끝낸다. 파일 내용은 로그에 남기지 않는다.
import { parentPort, workerData } from "node:worker_threads"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const PDFJS_DIR = path.dirname(require.resolve("pdfjs-dist/package.json"))

class Fail extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

/** 페이지 안 글 조각을 줄·문단으로 잇는다. 줄 사이 간격이 글자 높이보다 많이 벌어지면 문단으로 본다. */
function pageText(items) {
  let out = ""
  let lastY = null
  let lastH = 0
  let lineStart = true
  for (const it of items) {
    if (typeof it.str !== "string") continue // 표시용 marked content
    const y = it.transform[5]
    const h = Math.abs(it.height || it.transform[3]) || lastH
    if (lineStart && lastY !== null && lastY - y > Math.max(lastH, h) * 1.8) out += "\n"
    out += it.str
    lineStart = Boolean(it.hasEOL)
    if (lineStart) out += "\n"
    if (it.str.trim() || it.hasEOL) {
      lastY = y
      lastH = h || lastH
    }
  }
  return out
}

async function pdfText(data, { maxPages, maxChars }) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const task = pdfjs.getDocument({
    data,
    // PDF.js requires a forward trailing slash even on Windows; Node accepts these local paths.
    cMapUrl: path.join(PDFJS_DIR, "cmaps").replaceAll("\\", "/") + "/", // 한글 CID 글꼴을 유니코드로 바꾸는 표
    cMapPacked: true,
    standardFontDataUrl: path.join(PDFJS_DIR, "standard_fonts").replaceAll("\\", "/") + "/",
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0, // 글꼴 경고 등도 출력하지 않는다
  })
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    if (e?.name === "PasswordException") throw new Fail("encrypted-pdf")
    throw new Fail("corrupt-document")
  }
  try {
    if (doc.numPages > maxPages) throw new Fail("too-complex")
    const pages = []
    let chars = 0
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const t = pageText((await page.getTextContent()).items)
      page.cleanup()
      chars += t.length
      if (chars > maxChars * 2) throw new Fail("text-too-long") // 정리 전 길이라 여유를 둔다
      pages.push(t)
    }
    return pages.join("\n\n")
  } catch (e) {
    if (e instanceof Fail) throw e
    throw new Fail("corrupt-document")
  } finally {
    await task.destroy().catch(() => {})
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " }

/**
 * mammoth의 HTML 결과를 글로 바꾼다. extractRawText는 문단 안 줄바꿈(<w:br/>)을 버려서 쓰지 않는다.
 * 문단·제목·목록 항목은 빈 줄로, 줄바꿈은 줄바꿈으로, 표 칸은 탭으로 나눈다.
 */
function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|tr|table|blockquote)>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, k) => ENTITIES[k])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

async function docxText(data) {
  const mammoth = (await import("mammoth")).default
  let r
  try {
    r = await mammoth.convertToHtml({ buffer: Buffer.from(data.buffer, data.byteOffset, data.byteLength) }, { ignoreEmptyParagraphs: false, convertImage: mammoth.images.imgElement(async () => ({ src: "" })) }) // 그림 데이터는 읽지 않는다
  } catch {
    throw new Fail("corrupt-document")
  }
  return htmlToText(r.value)
}

const { kind, limits } = workerData
parentPort.once("message", async (data) => {
  try {
    const text = kind === "pdf" ? await pdfText(data, limits) : await docxText(data)
    parentPort.postMessage({ ok: true, text })
  } catch (e) {
    parentPort.postMessage({ ok: false, code: e instanceof Fail ? e.code : "corrupt-document" })
  }
})
