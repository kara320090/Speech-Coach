import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "../server.js"

async function withServer(fn) {
  const server = createServer({ releaseId: "test-sha" })
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn(base)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

test("/__health는 인증·리다이렉트 없이 200과 releaseId를 준다", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/__health`, { redirect: "manual" })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { status: "ok", releaseId: "test-sha" })
  })
})

test("첫 화면과 스크립트를 준다", async () => {
  await withServer(async (base) => {
    const html = await fetch(`${base}/`)
    assert.equal(html.status, 200)
    assert.match(await html.text(), /발표 연습 코치/)
    const js = await fetch(`${base}/js/app.js`)
    assert.equal(js.status, 200)
    assert.match(js.headers.get("content-type"), /javascript/)
    assert.match(html.headers.get("permissions-policy"), /microphone=\(self\)/)
  })
})

test("없는 주소는 404(500 아님)", async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/없는-주소`)).status, 404)
    assert.equal((await fetch(`${base}/js/nope.js`)).status, 404)
  })
})

test("public 밖의 파일은 읽을 수 없다", async () => {
  await withServer(async (base) => {
    for (const p of ["/../server.js", "/%2e%2e/server.js", "/..%2fserver.js", "/js/../../package.json"]) {
      const res = await fetch(`${base}${p}`)
      assert.equal(res.status, 404, p)
    }
  })
})
