import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { defineConfig } from "@playwright/test"
import { E2E_BASE_URL } from "./env"

// 가짜 마이크 파일이 없으면 만든다(저장소에는 커밋하지 않는다).
const fakeSpeech = path.join(__dirname, "fixtures", "fake-speech.wav")
if (!fs.existsSync(fakeSpeech)) execFileSync(process.execPath, [path.join(__dirname, "fixtures", "make-fake-speech.mjs")])

/**
 * 마이크·웹캠 기록 흐름을 확인하는 별도 검사(주최 측 실행 대상 아님).
 * 크롬의 가짜 장치를 쓴다: 마이크는 fixtures/make-fake-speech.mjs가 만드는 fake-speech.wav(0~6초 소리, 6~11초 무음, 11~16초 소리)를 반복해서 들려주고,
 * 웹캠은 크롬이 만드는 테스트 영상을 준다. 실제 사람의 목소리·실제 마이크·실제 카메라로 한 검사가 아니다.
 * 실행: cd e2e && npx playwright test -c media.config.ts
 */
export default defineConfig({
  testDir: "./media",
  testMatch: /\.spec\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    locale: "ko-KR",
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${fakeSpeech}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
    permissions: ["microphone", "camera"],
  },
})
