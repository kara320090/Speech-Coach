// Test preparation only. The app/Docker startup never runs FFmpeg.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"

export function makeRealRecording() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const source = path.join(here, "presentation-review.mp4")
  const generated = path.join(here, "generated")
  const camera = path.join(generated, "real-camera.mjpeg"), mic = path.join(generated, "real-mic.wav")
  const manifest = path.join(generated, "recording-input.json")
  const hash = createHash("sha256").update(fs.readFileSync(source)).digest("hex")
  const marker = `${hash}:640x480-letterbox-15fps-v1`
  let cached = null
  if (fs.existsSync(manifest)) cached = JSON.parse(fs.readFileSync(manifest, "utf8"))
  if (cached?.marker === marker && fs.existsSync(camera) && fs.existsSync(mic)) return { camera, mic, sourceHash: hash }
  fs.mkdirSync(generated, { recursive: true })
  const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg"
  const convert = args => {
    const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", source, ...args], { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] })
    if (result.error || result.status !== 0) throw new Error("Recording conversion failed. Install FFmpeg or set FFMPEG_BIN to its executable path.")
  }
  convert(["-vf", "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2,fps=15", "-c:v", "mjpeg", "-q:v", "5", "-pix_fmt", "yuvj420p", "-an", camera])
  convert(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-map_metadata", "-1", mic])
  fs.writeFileSync(manifest, JSON.stringify({ marker, sourceHash: hash, video: "640x480 letterbox, 15 fps, MJPEG", audio: "16kHz mono PCM16 WAV", input: "replayed recording, not a live camera" }, null, 2))
  return { camera, mic, sourceHash: hash }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(makeRealRecording()))
