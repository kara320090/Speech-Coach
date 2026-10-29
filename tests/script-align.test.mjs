// 검토 시점 ↔ 대본 문장 연결 검사. 모두 개인정보 없는 합성 대본·전사이며, 실제 발표 정확도를 검증한 것이 아니다.
import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "../server.js"
import { ALGORITHM_VERSION, ALIGN_LIMITS, alignPoints, normalize, splitScript, validateAlignInput } from "../server/script-align.js"

const SCRIPT = [
  "안녕하세요. 오늘은 가상의 도서관 이용 방법을 소개합니다.",
  "도서관은 매주 토요일 오전 10시에 문을 엽니다.",
  "",
  "대출 기간은 2주이며, 연장은 한 번만 할 수 있습니다!",
  "반납은 무인 반납기를 이용하면 됩니다. 감사합니다.",
].join("\n")
// s1 안녕하세요. / s2 오늘은 … 소개합니다. / s3 도서관은 … 엽니다. / s4 대출 … 있습니다! / s5 반납은 … 됩니다. / s6 감사합니다.

const seg = (startSecond, endSecond, text) => ({ startSecond, endSecond, text })
const NORMAL = [
  seg(0, 1.5, "안녕하세요"),
  seg(1.8, 6, "오늘은 가상의 도서관 이용 방법을 소개합니다"),
  seg(6.3, 10, "도서관은 매주 토요일 오전 열 시에 문을 엽니다"),
  // 10~14초 침묵
  seg(14, 19, "대출 기간은 이주이며 연장은 한 번만 할 수 있습니다"),
  seg(19.4, 23, "반납은 무인 반납기를 이용하면 됩니다"),
  seg(23.3, 24.5, "감사합니다"),
]
const run = (extra) => alignPoints(validateAlignInput({ script: SCRIPT, scriptVersionId: "v-test", segments: NORMAL, ...extra }))
const point = (r, id) => r.points.find((p) => p.pointId === id)

async function withServer(fn) {
  const server = createServer({ env: {} })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await fn(base)
  } finally {
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  }
}
const post = (base, body, headers = { "content-type": "application/json" }) =>
  fetch(`${base}/api/scripts/align`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) })

const logged = []
for (const k of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[k]
  console[k] = (...a) => {
    logged.push(a.map(String).join(" "))
    orig.apply(console, a)
  }
}

test("대본 나누기: 문장·문단과 원문 시작·끝 위치를 보존한다(줄바꿈·문장부호 포함)", () => {
  const s = splitScript(SCRIPT)
  assert.deepEqual(s.map((x) => x.id), ["s1", "s2", "s3", "s4", "s5", "s6"])
  for (const x of s) assert.equal(SCRIPT.slice(x.start, x.end), x.text)
  assert.equal(s[3].text, "대출 기간은 2주이며, 연장은 한 번만 할 수 있습니다!")
  assert.deepEqual(s.map((x) => x.paragraphIndex), [0, 0, 0, 1, 1, 1])
  assert.equal(normalize("대출  기간은,\n2주!"), "대출기간은2주")
})

test("HTTP: 같은 순서로 읽은 발화에서 침묵(10~14초)은 s3와 s4 사이로 연결되고 원문·위치·앞뒤 발화를 돌려준다", async () => {
  await withServer(async (base) => {
    const res = await post(base, { script: SCRIPT, scriptVersionId: "v-test", segments: NORMAL, points: [{ id: "silence-1", startSecond: 10.2, endSecond: 13.8 }] })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.algorithmVersion, ALGORITHM_VERSION)
    assert.match(body.scoreNote, /확률이나 검증된 정확도가 아니/)
    const p = body.points[0]
    assert.deepEqual([p.pointId, p.scriptVersionId, p.status, p.position, p.primarySentenceId], ["silence-1", "v-test", "matched", "between", "s4"])
    assert.deepEqual(p.candidates.map((c) => [c.sentenceId, c.role]), [["s4", "after-point"], ["s3", "before-point"]])
    const c = p.candidates[0]
    assert.equal(SCRIPT.slice(c.start, c.end), c.text)
    assert.equal(p.transcript.before.text, NORMAL[2].text)
    assert.equal(p.transcript.after.text, NORMAL[3].text)
    assert.deepEqual([p.transcript.gapBeforeSecond, p.transcript.gapAfterSecond], [0.2, 0.2])
    assert.deepEqual(p.transcript.during, [])
    assert.equal(p.reasons[0].code, "next-sentence")
    // 모든 전사 구간이 순서대로 연결된다(띄어쓰기·숫자 읽기 차이: '10시'→'열 시', '2주'→'이주')
    assert.deepEqual(body.segments.map((s) => s.alignment.sentenceId), ["s1", "s2", "s3", "s4", "s5", "s6"])
    assert.ok(body.segments.every((s) => s.alignment.status === "clear"))
  })
})

test("여러 지점을 한 번에: 문장 중간 멈춤·지점 안 발화·처음·끝", () => {
  const segments = [seg(0, 1.5, "안녕하세요"), seg(1.8, 3.5, "오늘은 가상의 도서관"), seg(6, 8, "이용 방법을 소개합니다"), ...NORMAL.slice(2)]
  const r = alignPoints(validateAlignInput({ script: SCRIPT, scriptVersionId: "v", segments, points: [
    { id: "mid", startSecond: 3.6, endSecond: 5.9 }, // 같은 문장(s2) 안에서 멈춤
    { id: "during", startSecond: 15, endSecond: 17 }, // 지점 안에 s4 발화
    { id: "end", startSecond: 25, endSecond: 30 }, // 마지막 문장 뒤
  ] }))
  assert.deepEqual([point(r, "mid").status, point(r, "mid").position, point(r, "mid").primarySentenceId, point(r, "mid").reasons[0].code], ["matched", "within", "s2", "same-sentence"])
  assert.deepEqual([point(r, "during").status, point(r, "during").position, point(r, "during").primarySentenceId], ["matched", "within", "s4"])
  assert.deepEqual([point(r, "end").status, point(r, "end").position, point(r, "end").primarySentenceId], ["matched", "after-last", "s6"])
})

test("같은 문장이 여러 번 나오는 대본: 앞뒤 순서로 정해지면 그 문장을, 정해지지 않으면 ambiguous", () => {
  const script = "첫째 안내를 드립니다. 다시 한번 확인해 주세요. 둘째 안내를 드립니다. 다시 한번 확인해 주세요. 셋째 안내를 드립니다."
  // s1 첫째 / s2 다시 한번 / s3 둘째 / s4 다시 한번 / s5 셋째
  const ordered = [seg(0, 2, "첫째 안내를 드립니다"), seg(2.2, 4, "다시 한번 확인해 주세요"), seg(4.2, 6, "둘째 안내를 드립니다"), seg(6.2, 8, "다시 한번 확인해 주세요"), seg(12, 14, "셋째 안내를 드립니다")]
  const r = alignPoints(validateAlignInput({ script, scriptVersionId: "v", segments: ordered, points: [{ id: "p", startSecond: 8.5, endSecond: 11.5 }] }))
  assert.deepEqual(r.segments.map((s) => s.alignment.sentenceId), ["s1", "s2", "s3", "s4", "s5"], "순서 정보로 두 번째 '다시 한번'은 s4")
  assert.deepEqual([point(r, "p").status, point(r, "p").primarySentenceId], ["matched", "s5"])
  // 앞뒤 문맥 없이 반복 문장만 있으면 확정하지 않는다
  const lonely = alignPoints(validateAlignInput({ script, scriptVersionId: "v", segments: [seg(30, 32, "다시 한번 확인해 주세요")], points: [{ id: "q", startSecond: 32.5, endSecond: 35 }] }))
  const q = point(lonely, "q")
  assert.equal(q.status, "ambiguous")
  assert.equal(q.primarySentenceId, null)
  assert.ok(q.candidates.some((c) => c.sentenceId === "s2") && q.candidates.some((c) => c.sentenceId === "s4"))
  assert.equal(q.reasons[0].code, "duplicate-sentence")
})

test("일부 문장 생략: 사이 문장을 건너뛰었다고 알리고, 반복(다시 읽기)은 앞 문장으로 연결한다", () => {
  const skipped = [NORMAL[0], NORMAL[1], seg(7, 11, "대출 기간은 이주이며 연장은 한 번만 할 수 있습니다"), NORMAL[4], NORMAL[5]]
  // s3(토요일)을 건너뛴 상태에서 s2 뒤 침묵
  const r = alignPoints(validateAlignInput({ script: SCRIPT, scriptVersionId: "v", segments: skipped, points: [{ id: "gap", startSecond: 6.2, endSecond: 6.8 }] }))
  const g = point(r, "gap")
  assert.deepEqual([g.status, g.position, g.primarySentenceId, g.reasons[0].code], ["matched", "between", "s4", "skipped-between"])
  assert.deepEqual(g.skippedSentenceIds, ["s3"])
  const repeated = [...NORMAL.slice(0, 3), seg(10.5, 13, "도서관은 매주 토요일 오전 열 시에 문을 엽니다"), ...NORMAL.slice(3)]
  const r2 = alignPoints(validateAlignInput({ script: SCRIPT, scriptVersionId: "v", segments: repeated, points: [{ id: "again", startSecond: 13.2, endSecond: 13.9 }] }))
  assert.deepEqual(r2.segments.map((s) => s.alignment.sentenceId), ["s1", "s2", "s3", "s3", "s4", "s5", "s6"])
  assert.deepEqual([point(r2, "again").status, point(r2, "again").primarySentenceId], ["matched", "s4"])
})

test("대본과 무관한 발화는 연결하지 않고, 그 근처 지점은 unmatched", () => {
  const segments = [...NORMAL.slice(0, 3), seg(10.5, 13, "잠깐만요 물 좀 마시고 올게요"), seg(16, 18, "어디까지 했더라")]
  const r = alignPoints(validateAlignInput({ script: SCRIPT, scriptVersionId: "v", segments, points: [{ id: "off", startSecond: 13.5, endSecond: 15.5 }] }))
  assert.equal(r.segments[3].alignment.status, "none")
  assert.equal(r.segments[4].alignment.status, "none")
  const p = point(r, "off")
  assert.deepEqual([p.status, p.primarySentenceId, p.reasons[0].code], ["unmatched", null, "speech-not-in-script"])
})

test("한쪽 근거만 있거나 간격이 크거나 전사가 없으면 확정하지 않는다", () => {
  // 뒤쪽 발화가 20초 넘게 떨어짐 → 앞 근거만 → ambiguous
  const far = [...NORMAL.slice(0, 3), seg(40, 44, "대출 기간은 이주이며 연장은 한 번만 할 수 있습니다")]
  const r = alignPoints(validateAlignInput({ script: SCRIPT, scriptVersionId: "v", segments: far, points: [{ id: "far", startSecond: 10.5, endSecond: 12 }, { id: "nowhere", startSecond: 70, endSecond: 75 }] }))
  const f = point(r, "far")
  assert.deepEqual([f.status, f.position, f.primarySentenceId, f.reasons[0].code], ["ambiguous", "unknown", null, "before-only"])
  assert.equal(f.transcript.after, null)
  assert.deepEqual(f.candidates.map((c) => c.sentenceId), ["s3", "s4"])
  assert.deepEqual([point(r, "nowhere").status, point(r, "nowhere").reasons[0].code], ["unmatched", "no-nearby-transcript"])
  const none = alignPoints(validateAlignInput({ script: SCRIPT, scriptVersionId: "v", segments: [], points: [{ id: "x", startSecond: 1, endSecond: 2 }] }))
  assert.deepEqual([none.points[0].status, none.points[0].reasons[0].code], ["unmatched", "no-transcript"])
})

test("짧은 추임새(음·네)와 바꿔 말한 발화는 억지로 연결하지 않는다", () => {
  const segments = [NORMAL[0], seg(2, 2.4, "음"), seg(3, 7, "오늘 저는 책 빌리는 곳에 대해 말할게요"), ...NORMAL.slice(2)]
  const r = alignPoints(validateAlignInput({ script: SCRIPT, scriptVersionId: "v", segments, points: [{ id: "um", startSecond: 2, endSecond: 2.4 }] }))
  assert.equal(r.segments[1].alignment.status, "none", "추임새")
  assert.notEqual(r.segments[2].alignment.status, "clear", "많이 바꿔 말한 문장은 확정 연결하지 않음")
  assert.notEqual(point(r, "um").status, "matched")
})

test("구간 안의 단어별 시간을 만들지 않는다: 전사 구간 시간만 그대로 돌려준다", () => {
  const r = run({ points: [{ id: "s", startSecond: 10.2, endSecond: 13.8 }] })
  const keys = Object.keys(r.points[0].transcript.before).sort()
  assert.deepEqual(keys, ["alignment", "endSecond", "index", "startSecond", "text"])
  assert.deepEqual([r.points[0].transcript.before.startSecond, r.points[0].transcript.before.endSecond], [6.3, 10])
})

test("입력 검사: 빈 대본·잘못된 시간·중복 ID·형식 오류", () => {
  const ok = { script: SCRIPT, scriptVersionId: "v", segments: NORMAL, points: [{ id: "a", startSecond: 1, endSecond: 2 }] }
  const code = (patch) => { try { validateAlignInput({ ...ok, ...patch }); return "ok" } catch (e) { return e.code } }
  assert.equal(code({}), "ok")
  assert.equal(code({ script: "  \n " }), "empty-script")
  assert.equal(code({ script: 3 }), "invalid-input")
  assert.equal(code({ scriptVersionId: "../x" }), "invalid-input")
  assert.equal(code({ points: [] }), "invalid-input")
  assert.equal(code({ points: [{ id: "a", startSecond: 1, endSecond: 2 }, { id: "a", startSecond: 3, endSecond: 4 }] }), "duplicate-point-id")
  assert.equal(code({ points: [{ id: "a", startSecond: 5, endSecond: 2 }] }), "invalid-time")
  assert.equal(code({ points: [{ id: "a", startSecond: -1, endSecond: 2 }] }), "invalid-time")
  assert.equal(code({ points: [{ id: "a", startSecond: "1", endSecond: 2 }] }), "invalid-time")
  assert.equal(code({ segments: [{ startSecond: 3, endSecond: 1, text: "가" }] }), "invalid-time")
  assert.equal(code({ segments: [{ startSecond: 0, endSecond: Infinity, text: "가" }] }), "invalid-time")
  assert.equal(code({ segments: [{ startSecond: 0, endSecond: 1 }] }), "invalid-input")
})

test("처리 한도: 대본·구간·지점·전사 글자 수·문장×구간 작업량", () => {
  const ok = { script: SCRIPT, scriptVersionId: "v", segments: NORMAL, points: [{ id: "a", startSecond: 1, endSecond: 2 }] }
  const err = (patch) => { try { alignPoints(validateAlignInput({ ...ok, ...patch })); return null } catch (e) { return [e.status, e.code] } }
  assert.deepEqual(err({ script: "가".repeat(ALIGN_LIMITS.scriptChars + 1) }), [413, "too-large"])
  assert.deepEqual(err({ segments: Array.from({ length: ALIGN_LIMITS.segments + 1 }, (_, i) => seg(i, i + 0.5, "가나다")) }), [413, "too-large"])
  assert.deepEqual(err({ points: Array.from({ length: ALIGN_LIMITS.points + 1 }, (_, i) => ({ id: `p${i}`, startSecond: i, endSecond: i })) }), [413, "too-large"])
  assert.deepEqual(err({ segments: Array.from({ length: 70 }, (_, i) => seg(i, i + 0.5, "가".repeat(1000))) }), [413, "too-large"])
  assert.deepEqual(err({ script: Array.from({ length: ALIGN_LIMITS.sentences + 1 }, (_, i) => `문장${i}.`).join(" ") }), [413, "too-large"])
  const manySentences = Array.from({ length: 400 }, (_, i) => `가상 문장 ${i}번입니다.`).join(" ")
  assert.deepEqual(err({ script: manySentences, segments: Array.from({ length: 2600 / 1.3 | 0 }, (_, i) => seg(i, i + 0.5, "가상 문장")) }), null, "400×2000 = 80만은 허용")
})

test("HTTP 오류 형식: JSON 아님·content-type·본문 크기·GET, 오류는 { error, message, field? }", async () => {
  await withServer(async (base) => {
    let r = await post(base, "{broken")
    assert.deepEqual([r.status, (await r.json()).error], [400, "invalid-json"])
    r = await post(base, "{}", { "content-type": "text/plain" })
    assert.deepEqual([r.status, (await r.json()).error], [415, "content-type"])
    r = await post(base, { script: "x".repeat(300 * 1024), scriptVersionId: "v", segments: [], points: [] })
    assert.deepEqual([r.status, (await r.json()).error], [413, "too-large"])
    r = await post(base, { script: SCRIPT, scriptVersionId: "v", segments: NORMAL, points: [{ id: "a", startSecond: 2, endSecond: 1 }] })
    const body = await r.json()
    assert.deepEqual([r.status, body.error, body.field], [400, "invalid-time", "points[0]"])
    assert.deepEqual(Object.keys(body).sort(), ["error", "field", "message"])
    r = await fetch(`${base}/api/scripts/align`)
    assert.deepEqual([r.status, r.headers.get("allow")], [405, "POST"])
  })
})

test("저장·로그 없음: 같은 요청을 두 번 보내도 같은 결과이고, 대본·전사가 로그에 남지 않으며 입력을 바꾸지 않는다", async () => {
  const req = { script: SCRIPT, scriptVersionId: "v-test", segments: NORMAL, points: [{ id: "silence-1", startSecond: 10.2, endSecond: 13.8 }] }
  const frozen = JSON.stringify(req)
  await withServer(async (base) => {
    const a = await (await post(base, req)).json()
    const b = await (await post(base, req)).json()
    assert.deepEqual(a, b)
  })
  assert.equal(JSON.stringify(req), frozen)
  for (const s of ["도서관", "대출 기간", "silence-1"]) assert.ok(!logged.some((l) => l.includes(s)), `로그에 '${s}'`)
})

test("chunk estimates cannot establish the sentence at a review timestamp", () => {
  const r = run({ segments: NORMAL.map(s => ({ ...s, timingPrecision: "chunk" })), points: [{ id: "pause", startSecond: 10.5, endSecond: 13 }] })
  const p = point(r, "pause")
  assert.equal(p.status, "ambiguous")
  assert.equal(p.primarySentenceId, null)
  assert.equal(p.timingPrecision, "chunk")
  assert.ok(p.candidates.length)
  assert.ok(p.reasons.some(r => r.code === "coarse-timing"))
  assert.ok(r.segments.every(s => s.timingPrecision === "chunk"))
  assert.throws(() => validateAlignInput({ script: SCRIPT, scriptVersionId: "v", segments: [{ ...NORMAL[0], timingPrecision: "exact-word" }], points: [{ id: "p", startSecond: 0, endSecond: 1 }] }))
})
