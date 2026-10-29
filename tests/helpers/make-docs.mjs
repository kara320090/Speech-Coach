// 검사용 가상 문서(PDF·DOCX)를 코드로 만든다. 개인정보 없는 가상 문장만 쓰고, 저장소에 바이너리 파일을 두지 않는다.
import zlib from "node:zlib"

/* ───────── PDF ───────── */

/** 글자를 UTF-16BE 16진수로. Identity-H 글꼴에서 CID = 유니코드 코드값으로 쓴다. */
const hex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")

/**
 * 글자 정보가 있는 PDF. lines: [{ text, y }] (y가 클수록 위). 줄 사이를 크게 벌리면 문단으로 읽힌다.
 * 한글은 글꼴을 넣지 않고 ToUnicode 표(코드값 그대로)로 글자를 알려 준다.
 * opts.encrypt: 빈 암호로 열리지 않는 Encrypt 사전을 넣는다(암호화된 PDF 흉내).
 * opts.pages: 페이지마다 lines 배열을 따로 줄 때.
 */
export function makePdf(lines, opts = {}) {
  const pages = opts.pages || [lines]
  const objs = []
  const add = (body) => objs.push(body) && objs.length
  const catalog = add(null)
  const pagesId = add(null)
  const cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end"
  const toUni = add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`)
  const cid = add("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /KoreanTest /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor << /Type /FontDescriptor /FontName /KoreanTest /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 900 /Descent -200 /CapHeight 700 /StemV 80 >> /DW 1000 >>")
  const font = add(`<< /Type /Font /Subtype /Type0 /BaseFont /KoreanTest /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`)
  const kids = []
  for (const pageLines of pages) {
    const ops = pageLines.map((l) => (l.text ? `BT /F1 14 Tf 72 ${l.y} Td <${hex(l.text)}> Tj ET` : "")).join("\n") + (opts.draw ? `\n${opts.draw}` : "")
    const content = add(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`))
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`
  let encryptRef = ""
  if (opts.encrypt) {
    const o = "A".repeat(64)
    const u = "B".repeat(64) // 빈 암호로 계산한 값과 다르므로 사용자 암호가 필요한 문서가 된다
    encryptRef = ` /Encrypt ${add(`<< /Filter /Standard /V 1 /R 2 /Length 40 /P -44 /O <${o}> /U <${u}> >>`)} 0 R`
  }
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
  const offsets = []
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"))
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, "latin1")
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${encryptRef} /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>] >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, "latin1")
}

/** 글자 없이 사각형만 그린 PDF(스캔·이미지 PDF처럼 글자 정보가 없음). */
export const makeImageOnlyPdf = () => makePdf([], { draw: "0.5 g 72 500 300 200 re f" })

/* ───────── DOCX (최소 구성 ZIP) ───────── */

function zip(files) {
  const local = []
  const central = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8")
    const comp = zlib.deflateRawSync(data)
    const nameBuf = Buffer.from(name, "utf8")
    const crc = zlib.crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6) // 이름 UTF-8
    head.writeUInt16LE(8, 8) // deflate
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(comp.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBuf.length, 26)
    local.push(head, nameBuf, comp)
    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(8, 10)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(comp.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt32LE(offset, 42)
    central.push(cen, nameBuf)
    offset += head.length + nameBuf.length + comp.length
  }
  const cenBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(cenBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, cenBuf, end])
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** 문단 배열로 만든 워드 문서. 문단 안의 '\n'은 줄바꿈(<w:br/>)으로 넣는다. */
export function makeDocx(paragraphs) {
  const body = paragraphs
    .map((p) => `<w:p><w:r>${p.split("\n").map((t, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(t)}</w:t>`).join("")}</w:r></w:p>`)
    .join("")
  return zip({
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  })
}
