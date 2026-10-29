// 가짜 마이크 입력 파일을 만든다(16kHz 모노 WAV): 0~6초 소리, 6~11초 무음, 11~16초 소리.
// 크롬의 --use-file-for-fake-audio-capture로 들려주며, 사람의 실제 목소리가 아니라 220Hz 사인파다.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { encodeWavBytes } from "../../public/js/wav.js"

export function makeFakeSpeech(file = path.join(path.dirname(fileURLToPath(import.meta.url)), "fake-speech.wav")) {
  const rate = 16000
  const samples = new Float32Array(rate * 16)
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate
    samples[i] = t >= 6 && t < 11 ? 0 : 0.6 * Math.sin(2 * Math.PI * 220 * t)
  }
  fs.writeFileSync(file, Buffer.from(encodeWavBytes(samples, rate)))
  return file
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(makeFakeSpeech())
