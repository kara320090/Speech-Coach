/**
 * 주최 측 실행·CI·로컬이 같은 이름으로 넘기는 값. 이 서비스는 로그인이 없어서 주소만 쓴다.
 */
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000"
