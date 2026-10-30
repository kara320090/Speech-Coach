import { defineConfig } from "@playwright/test"
import { E2E_BASE_URL } from "./env"

/**
 * 로컬·CI용 설정이다. docker compose up 뒤 `npx playwright test`로 주최 측 실행과 같은 조건을 미리 확인한다.
 * 주최 측 실행은 이 파일을 쓰지 않고 같은 값의 자체 설정으로 실행한다.
 * 이 서비스의 주 사용 플랫폼은 desktop이다(docs/scenarios.yaml).
 */
export default defineConfig({
  testDir: "./scenarios",
  testMatch: /[\\/]S[1-9]\d*\.spec\.ts$/,
  workers: 1,
  retries: 0,
  outputDir: "./test-results/scenarios",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: E2E_BASE_URL,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    video: { mode: "on", size: { width: 1440, height: 900 } },
  },
  projects: [{ name: "desktop", use: { viewport: { width: 1440, height: 900 } } }],
})
