// gh handles authentication to this private release; no token is read or saved here.
import fs from "node:fs/promises"
import path from "node:path"
import { restoreModels } from "./model-package.mjs"
const flags = new Map()
for (let i = 2; i < process.argv.length; i += 2) flags.set(process.argv[i], process.argv[i + 1])
if (!flags.get("--from") || !flags.get("--dir")) throw Error("Use --from downloaded-release-directory --dir output-model-directory")
const manifest = JSON.parse(await fs.readFile(new URL("./model-release.json", import.meta.url), "utf8"))
const restored = await restoreModels(manifest, path.resolve(flags.get("--from")), path.resolve(flags.get("--dir")))
console.log(`Verified and restored ${restored.length} model files. Licenses are included in the model directory.`)
