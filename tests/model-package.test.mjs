import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { restoreModels } from "../local-ai/model-package.mjs"
const hash = value => createHash("sha256").update(value).digest("hex")
async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "speech-model-package-")), from = path.join(root, "assets"), to = path.join(root, "models")
  await fs.mkdir(from); await fs.writeFile(path.join(from, "one.part"), "first"); await fs.writeFile(path.join(from, "two.part"), "second")
  const manifest = { format: 1, assets: [{ name: "one.part", size: 5, sha256: hash("first") }, { name: "two.part", size: 6, sha256: hash("second") }], models: [{ path: "nested/model.bin", size: 11, sha256: hash("firstsecond"), assets: ["one.part", "two.part"] }] }
  try { await fn({ root, from, to, manifest }) } finally { await fs.rm(root, { recursive: true, force: true }) }
}
test("model assets reconstruct in order, verify the whole model and support idempotent restore", () => fixture(async ({ from, to, manifest }) => {
  assert.deepEqual(await restoreModels(manifest, from, to), ["nested/model.bin"])
  assert.equal(await fs.readFile(path.join(to, "nested/model.bin"), "utf8"), "firstsecond")
  await restoreModels(manifest, from, to)
}))
test("corrupt assets never produce a restored model", () => fixture(async ({ from, to, manifest }) => {
  await fs.writeFile(path.join(from, "one.part"), "wrong")
  await assert.rejects(restoreModels(manifest, from, to), /checksum/)
  await assert.rejects(fs.stat(path.join(to, "nested/model.bin")))
}))
test("restore rejects path traversal and never overwrites a different existing model", () => fixture(async ({ from, to, manifest, root }) => {
  const bad = structuredClone(manifest); bad.models[0].path = "../outside.bin"
  await assert.rejects(restoreModels(bad, from, to), /path/)
  await assert.rejects(fs.stat(path.join(root, "outside.bin")))
  await fs.mkdir(path.join(to, "nested"), { recursive: true }); await fs.writeFile(path.join(to, "nested/model.bin"), "user-content")
  await assert.rejects(restoreModels(manifest, from, to), /Existing model/)
  assert.equal(await fs.readFile(path.join(to, "nested/model.bin"), "utf8"), "user-content")
}))
