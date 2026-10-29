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

/** 가짜 AI Gateway. 받은 요청을 calls에 담고 reply(req, body)가 돌려준 값을 응답한다. */
async function withFakeGateway(reply, fn) {
  const calls = []
  const gw = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}")
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

test("gateway segment normalization rejects missing times and keeps documented/alias shapes", async () => {
  await withFakeGateway(() => [200, { text: "음 어", segments: [
    { text: "bad", startSecond: null, endSecond: 1 },
    { text: "bad", startSecond: "", endSecond: 1 },
    { text: "bad", startSecond: -1, endSecond: 1 },
    { text: "어", start: "1", end: "2" },
    { text: "음", startSecond: 0, endSecond: 1 },
  ] }], async (gw) => {
    await withApp({ AI_GATEWAY_API_KEY: "test-only", AI_GATEWAY_URL: gw }, async (base) => {
      const body = await (await post(base, wavOf(2))).json()
      assert.deepEqual(body.segments, [{ text: "음", startSecond: 0, endSecond: 1 }, { text: "어", startSecond: 1, endSecond: 2 }])
    })
  })
})

test("invalid gateway JSON refunds reserved budget without exposing upstream content", async () => {
  let calls = 0
  const app = createServer({ env: { AI_GATEWAY_API_KEY: "test-only", TRANSCRIBE_TOTAL_SECONDS: "1" }, fetchImpl: async () => {
    calls++
    return calls === 1 ? { ok: true, json: async () => { throw new Error("upstream private detail") } } : { ok: true, json: async () => ({ text: "음" }) }
  } })
  const base = await listen(app)
  try {
    const first = await post(base, wavOf(1))
    assert.equal(first.status, 502); assert.ok(!(await first.text()).includes("private"))
    assert.equal((await post(base, wavOf(1))).status, 200)
  } finally { await close(app) }
})

test("키가 없으면 503 not-configured이고 다른 주소는 그대로 동작한다", async () => {
  await withApp({}, async (base) => {
    const res = await post(base, wavOf(1))
    assert.equal(res.status, 503)
    assert.equal((await res.json()).error, "not-configured")
    assert.equal((await fetch(`${base}/__health`)).status, 200)
  })
})

test("GET은 405", async () => {
  await withApp({ AI_GATEWAY_API_KEY: "dummy" }, async (base) => {
    assert.equal((await fetch(`${base}/api/transcribe`)).status, 405)
  })
})

test("WAV가 아니면 415, 너무 크면 413 (게이트웨이를 부르지 않는다)", async () => {
  await withFakeGateway(() => [200, { text: "x" }], async (gw, calls) => {
    await withApp({ AI_GATEWAY_API_KEY: "dummy", AI_GATEWAY_URL: gw }, async (base) => {
      assert.equal((await post(base, Buffer.from("hello world, not a wav file at all, hello world, not a wav"))).status, 415)
      assert.equal((await post(base, Buffer.alloc(5 * 1024 * 1024))).status, 413)
      assert.equal(calls.length, 0)
    })
  })
})

test("성공: 게이트웨이에 올바른 헤더·본문으로 보내고 글과 구간을 정리해 돌려준다", async () => {
  const reply = () => [200, { text: " 안녕하세요 ", segments: [{ text: "안녕하세요", startSecond: 0.5, endSecond: 1.5 }, { text: "", startSecond: 1, endSecond: 2 }, { text: "x", startSecond: 3, endSecond: 2 }], language: "ko", durationInSeconds: 2 }]
  await withFakeGateway(reply, async (gw, calls) => {
    await withApp({ AI_GATEWAY_API_KEY: "dummy-key", AI_GATEWAY_URL: `${gw}/`, TRANSCRIBE_MODEL: "test/model" }, async (base) => {
      const res = await post(base, wavOf(2))
      assert.equal(res.status, 200)
      const out = await res.json()
      assert.equal(out.language, "ko")
      assert.deepEqual(out.segments, [{ text: "안녕하세요", startSecond: 0.5, endSecond: 1.5 }]) // 빈 글·거꾸로 된 시간은 버린다
      assert.equal(calls.length, 1)
      const c = calls[0]
      assert.equal(c.url, "/v4/ai/transcription-model")
      assert.equal(c.headers.authorization, "Bearer dummy-key")
      assert.equal(c.headers["ai-model-id"], "test/model")
      assert.equal(c.headers["ai-transcription-model-specification-version"], "4")
      assert.equal(c.body.mediaType, "audio/wav")
      assert.equal(Buffer.from(c.body.audio, "base64").toString("latin1", 0, 4), "RIFF")
      assert.equal(JSON.stringify(out).includes("dummy-key"), false) // 키는 응답에 나오지 않는다
    })
  })
})

test("게이트웨이 오류를 구분해서 알린다 (401→gateway-auth, 429→gateway-limit, 500→gateway-error)", async () => {
  for (const [status, error, expected] of [[401, "gateway-auth", 502], [403, "gateway-auth", 502], [429, "gateway-limit", 429], [500, "gateway-error", 502]]) {
    await withFakeGateway(() => [status, { error: "x" }], async (gw) => {
      await withApp({ AI_GATEWAY_API_KEY: "dummy", AI_GATEWAY_URL: gw }, async (base) => {
        const res = await post(base, wavOf(1))
        assert.equal(res.status, expected, String(status))
        assert.equal((await res.json()).error, error)
      })
    })
  }
})

test("게이트웨이에 연결이 안 되면 502 gateway-unreachable", async () => {
  await withApp({ AI_GATEWAY_API_KEY: "dummy", AI_GATEWAY_URL: "http://127.0.0.1:1" }, async (base) => {
    const res = await post(base, wavOf(1))
    assert.equal(res.status, 502)
    assert.equal((await res.json()).error, "gateway-unreachable")
  })
})

test("소리 길이 합계 한도를 넘으면 429 budget이고, 실패한 요청의 시간은 돌려받는다", async () => {
  let n = 0
  await withFakeGateway(() => (++n === 1 ? [500, {}] : [200, { text: "ok" }]), async (gw, calls) => {
    await withApp({ AI_GATEWAY_API_KEY: "dummy", AI_GATEWAY_URL: gw, TRANSCRIBE_TOTAL_SECONDS: "5" }, async (base) => {
      assert.equal((await post(base, wavOf(4))).status, 502) // 실패 → 4초 반환
      assert.equal((await post(base, wavOf(4))).status, 200) // 4초 사용
      const over = await post(base, wavOf(4)) // 합 8초 > 5초
      assert.equal(over.status, 429)
      assert.equal((await over.json()).error, "budget")
      assert.equal(calls.length, 2)
    })
  })
})
