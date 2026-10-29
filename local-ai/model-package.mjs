import fs from "node:fs/promises"
import { createReadStream } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import path from "node:path"

export async function fileDigest(file) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}
function inside(root, name) {
  if (typeof name !== "string" || !name || path.isAbsolute(name) || name.split(/[\\/]/).some(p => !p || p === ".." || p === ".")) throw Error("Invalid model path")
  const file = path.resolve(root, name)
  if (!file.startsWith(path.resolve(root) + path.sep)) throw Error("Invalid model path")
  return file
}
export async function restoreModels(manifest, assetsDirectory, modelDirectory) {
  if (manifest?.format !== 1 || !Array.isArray(manifest.assets) || !Array.isArray(manifest.models)) throw Error("Invalid model manifest")
  const assets = new Map()
  for (const asset of manifest.assets) {
    if (!/^[\w.-]+$/.test(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 0 || assets.has(asset.name)) throw Error("Invalid model asset")
    const file = inside(assetsDirectory, asset.name)
    if ((await fs.stat(file)).size !== asset.size || await fileDigest(file) !== asset.sha256) throw Error("Model asset checksum mismatch: " + asset.name)
    assets.set(asset.name, file)
  }
  const result = []
  for (const model of manifest.models) {
    const file = inside(modelDirectory, model.path)
    if (!Array.isArray(model.assets) || !model.assets.length || model.assets.some(name => !assets.has(name)) || !/^[a-f0-9]{64}$/.test(model.sha256)) throw Error("Invalid model parts")
    if (await fs.stat(file).catch(() => null)) {
      if ((await fs.stat(file)).size !== model.size || await fileDigest(file) !== model.sha256) throw Error("Existing model differs; choose an empty model directory")
      result.push(model.path); continue
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temporary = file + "." + randomUUID() + ".partial"
    const output = await fs.open(temporary, "wx")
    try {
      for (const name of model.assets) for await (const chunk of createReadStream(assets.get(name))) await output.writeFile(chunk)
    } finally { await output.close() }
    if ((await fs.stat(temporary)).size !== model.size || await fileDigest(temporary) !== model.sha256) {
      await fs.unlink(temporary); throw Error("Restored model checksum mismatch")
    }
    await fs.rename(temporary, file)
    result.push(model.path)
  }
  const notices = manifest.assets.filter(a => /LICENSE|NOTICE|Apache|MIT/.test(a.name))
  if (notices.length) await fs.mkdir(path.join(modelDirectory, "licenses"), { recursive: true })
  for (const notice of notices) await fs.copyFile(assets.get(notice.name), inside(modelDirectory, "licenses/" + notice.name))
  return result
}
