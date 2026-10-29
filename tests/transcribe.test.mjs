import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { createServer } from "../server.js"
import { encodeWavBytes } from "../public/js/wav.js"

const wavOf = (sec) => Buffer.from(encodeWavBytes(new Float32Array(Math.round(sec * 16000)).fill(0.1), 16000))

async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  return `http://127.0.0.1:${server.address().port}`
}
const close = (server) => new Promise((r) => server.close(r))

/** 가짜 자체 전사 서버. 받은 요청을 calls에 담고 reply(req, body)가 돌려준 값을 응답한다. */
async function withFakeTranscriber(reply, fn) {
  const calls = []
  const gw = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = Buffer.concat(chunks)
    calls.push({ url: req.url, headers: req.headers, body })
    const [status, json] = reply(calls.length, body)
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(json))
  })
  const base = await listen(gw)
  try {
    await fn(base, calls)
  } finally {
    await close(gw)
  }
}

async function withApp(env, fn) {
  const server = createServer({ releaseId: "t", env })
  const base = await listen(server)
  try {
    await fn(base)
  } finally {
    await close(server)
  }
}

const post = (base, body) => fetch(`${base}/api/transcribe`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body })

test("local segment normalization rejects missing times and keeps documented/alias shapes", async () => {
  await withFakeTranscriber(() => [200, { text: "음 어", segments: [
    { text: "bad", startSecond: null, endSecond: 1 },
    { text: "bad", startSecond: "", endSecond: 1 },
    { text: "bad", startSecond: -1, endSecond: 1 },
    { text: "어", start: "1", end: "2" },
    { text: "음", startSecond: 0, endSecond: 1 },
  ] }], async (gw) => {
    await withApp({ LOCAL_STT_URL: gw }, async (base) => {
      const body = await (await post(base, wavOf(2))).json()
      assert.deepEqual(body.segments, [{ text: "음", startSecond: 0, endSecond: 1 }, { text: "어", startSecond: 1, endSecond: 2 }])
    })
  })
})

test("invalid local transcription JSON refunds reserved budget without exposing upstream content", async () => {
  let calls = 0
  const app = createServer({ env: { LOCAL_STT_URL: "http://127.0.0.1:8081", TRANSCRIBE_TOTAL_SECONDS: "1" }, fetchImpl: async () => {
    calls++
    return new Response(calls === 1 ? "private invalid JSON" : JSON.stringify({ text: "음" }))
  } })
  const base = await listen(app)
  try {
    const first = await post(base, wavOf(1))
    assert.equal(first.status, 502); assert.ok(!(await first.text()).includes("private"))
    assert.equal((await post(base, wavOf(1))).status, 200)
  } finally { await close(app) }
})

test("자체 전사 주소가 없으면 503이고 기존 기능은 동작한다", async () => {
  await withApp({}, async (base) => {
    const res = await post(base, wavOf(1))
    assert.equal(res.status, 503)
    assert.equal((await res.json()).error, "not-configured")
    assert.equal((await fetch(`${base}/__health`)).status, 200)
  })
})

test("GET은 405", async () => {
  await withApp({}, async (base) => {
    assert.equal((await fetch(`${base}/api/transcribe`)).status, 405)
  })
})

test("WAV가 아니면 415, 너무 크면 413 (자체 전사 서버를 부르지 않는다)", async () => {
  await withFakeTranscriber(() => [200, { text: "x" }], async (gw, calls) => {
    await withApp({ LOCAL_STT_URL: gw }, async (base) => {
      assert.equal((await post(base, Buffer.from("hello world, not a wav file at all, hello world, not a wav"))).status, 415)
      assert.equal((await post(base, Buffer.alloc(5 * 1024 * 1024))).status, 413)
      assert.equal(calls.length, 0)
    })
  })
})

test("성공: 자체 전사 서버에 올바른 헤더·본문으로 보내고 글과 구간을 정리해 돌려준다", async () => {
  const reply = () => [200, { text: " 안녕하세요 ", segments: [{ text: "안녕하세요", startSecond: 0.5, endSecond: 1.5 }, { text: "", startSecond: 1, endSecond: 2 }, { text: "x", startSecond: 3, endSecond: 2 }], language: "ko", durationInSeconds: 2 }]
  await withFakeTranscriber(reply, async (gw, calls) => {
    await withApp({ LOCAL_STT_URL: `${gw}/` }, async (base) => {
      const res = await post(base, wavOf(2))
      assert.equal(res.status, 200)
      const out = await res.json()
      assert.equal(out.language, "ko")
      assert.deepEqual(out.segments, [{ text: "안녕하세요", startSecond: 0.5, endSecond: 1.5 }]) // 빈 글·거꾸로 된 시간은 버린다
      assert.equal(calls.length, 1)
      const c = calls[0]
      assert.equal(c.url, "/transcribe")
      assert.equal(c.headers.authorization, undefined)
      assert.equal(c.headers["content-type"], "audio/wav")
      assert.equal(c.body.toString("latin1", 0, 4), "RIFF")
      assert.equal(out.processing, "self-hosted")
      assert.equal(JSON.stringify(out).includes("dummy-key"), false) // 키는 응답에 나오지 않는다
    })
  })
})

test("자체 전사 서버 오류를 구분해서 알린다 (401→model-error, 429→model-error, 500→model-error)", async () => {
  for (const [status, error, expected] of [[401, "model-error", 502], [403, "model-error", 502], [429, "model-error", 429], [500, "model-error", 502]]) {
    await withFakeTranscriber(() => [status, { error: "x" }], async (gw) => {
      await withApp({ LOCAL_STT_URL: gw }, async (base) => {
        const res = await post(base, wavOf(1))
        assert.equal(res.status, expected, String(status))
        assert.equal((await res.json()).error, error)
      })
    })
  }
})

test("자체 전사 서버에 연결이 안 되면 502 model-unreachable", async () => {
  await withApp({ LOCAL_STT_URL: "http://127.0.0.1:1" }, async (base) => {
    const res = await post(base, wavOf(1))
    assert.equal(res.status, 502)
    assert.equal((await res.json()).error, "model-unreachable")
  })
})

test("소리 길이 합계 한도를 넘으면 429 budget이고, 실패한 요청의 시간은 돌려받는다", async () => {
  let n = 0
  await withFakeTranscriber(() => (++n === 1 ? [500, {}] : [200, { text: "ok" }]), async (gw, calls) => {
    await withApp({ LOCAL_STT_URL: gw, TRANSCRIBE_TOTAL_SECONDS: "5" }, async (base) => {
      assert.equal((await post(base, wavOf(4))).status, 502) // 실패 → 4초 반환
      assert.equal((await post(base, wavOf(4))).status, 200) // 4초 사용
      const over = await post(base, wavOf(4)) // 합 8초 > 5초
      assert.equal(over.status, 429)
      assert.equal((await over.json()).error, "budget")
      assert.equal(calls.length, 2)
    })
  })
})
