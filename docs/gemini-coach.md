# 텍스트 AI 코치 — Gemini API 연결 (`AI_PROVIDER=gemini`)

기준일: 2026-10-30. 대본 코치(`/coach.html`)의 `POST /api/coach` 과업(개념 찾기·대본 수정·질문 만들기·답변 검토)을 Google Gemini API로 실행하는 설정과 한계를 적는다. 요청·응답 형식은 자체 모델(`AI_PROVIDER=local`)과 같다. 음성 전사(`/api/transcribe`)와 파일 추출(`/api/scripts/import`)은 바뀌지 않는다.

## 1. 공급자 선택

| `AI_PROVIDER` | 처리하는 곳 | 비고 |
| --- | --- | --- |
| `local` (기본값, 비워 두면 이것) | 같은 서버의 자체 모델(`LOCAL_LLM_URL`, loopback만) | 외부 AI 제공자로 보내지 않음. [자체 모델 문서](local-ai-implementation.md) |
| `gemini` | Google Gemini API (`models.generateContent`, v1beta) | AI 실행을 누른 대본·근거 자료·질문·답변 텍스트가 Google로 전송됨 |
| 그 밖의 값 | 아무 곳에도 보내지 않음 | 상태에 `invalid-provider`로 표시. 다른 공급자로 자동 전환하지 않음 |

화면의 처리 안내는 `/api/model-status`의 `processingNotice`를 그대로 보여 줘서 공급자에 맞게 바뀐다(Gemini 모드: “Google Gemini API로 보내 처리해요”, 자체 모델: “외부 AI 제공자에게는 보내지 않아요”). 녹음·영상·연습 기록은 공급자와 상관없이 브라우저에만 저장된다.

## 2. 환경변수

| 이름 | 값 | 설명 |
| --- | --- | --- |
| `AI_PROVIDER` | `gemini` | 텍스트 AI 공급자 |
| `GEMINI_MODEL` | `gemini-2.5-flash` (기본값) | 이 모델만 호출한다. 다른 모델·등급으로 자동 대체하지 않는다 |
| `GEMINI_API_KEY` | **사용자가 직접 설정** | 서버가 이 환경변수에서만 읽는다. 화면·Git·로그·응답에 넣지 않는다 |
| `GEMINI_TIMEOUT_MS` | `30000` (5000~60000) | 요청 하나의 응답 대기 시간 |
| `AI_MAX_REQUESTS_PER_MINUTE` | `10` | 서버 전체 분당 Gemini 호출 수 |
| `AI_MAX_REQUESTS_PER_DAY` | `200` | 서버 전체 24시간 Gemini 호출 수 |
| `AI_MAX_REQUESTS_PER_CLIENT_PER_MINUTE` | `4` | 요청자(IP)별 분당 호출 수 |
| `AI_MAX_CONCURRENT` | `2` | 동시에 처리하는 Gemini 요청 수 |

무료·유료 등급은 코드가 아니라 **Google 프로젝트의 결제 설정**으로 정해진다. 이 서비스는 무료 사용을 보장하지 않는다. 사용량·요금은 Google AI Studio에서 확인한다.

## 3. Render 배포 절차

`render.yaml`에 `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-2.5-flash`를 넣었고 `GEMINI_API_KEY`는 비워 두었다(`sync: false`).

1. (사용자) [Google AI Studio](https://aistudio.google.com/)에서 프로젝트를 고르고 API 키를 만든다. 필요하면 결제(유료 등급)를 켠다.
2. (사용자) Render 대시보드 → speech-coach 서비스 → **Environment**에서 다음을 확인·입력하고 저장한다.
   - `AI_PROVIDER` = `gemini`
   - `GEMINI_MODEL` = `gemini-2.5-flash`
   - `GEMINI_API_KEY` = 발급한 키 (값을 채팅·이슈·커밋에 붙여 넣지 않는다)
   - 블루프린트로 만든 서비스가 아니면 위 세 값을 직접 추가한다.
3. 저장하면 Render가 다시 배포한다(자동 배포가 꺼져 있으면 **Manual Deploy**).
4. 배포 주소의 `/__health`가 배포 commit을 돌려주는지 확인한다.
5. `/api/model-status`에서 `provider: "gemini"`, `keyConfigured: true`, `reason: "key-configured"`, `connection: "unverified"`를 확인한다. 이 단계는 Google로 요청을 보내지 않는다(키가 **있다**는 뜻일 뿐 키가 맞는지는 아직 모른다).
6. `/coach.html`에서 **개인정보 없는 가상 대본**으로 AI 실행을 한 번 누른다. 성공하면 `/api/model-status`의 `connection`이 `verified`가 된다. 키가 틀리면 `provider-auth`, 결제·지역 조건 문제면 `provider-billing`이 표시되고 그 뒤로는 다시 배포할 때까지 Google로 요청을 보내지 않는다.

로컬에서 확인할 때: `AI_PROVIDER=gemini GEMINI_API_KEY=… npm start` (`.env`는 자동으로 읽지 않는다). 실제 연결만 따로 확인하려면 2절의 키를 넣고 `GEMINI_LIVE_TEST=1 npm run test:gemini-live`를 실행한다(가상 대본으로 질문 만들기 1회, 재시도 없음). 일반 `npm test`·CI는 실제 API를 부르지 않는다.

## 4. 데이터 처리 안내

- Gemini 모드에서는 AI 실행을 누를 때마다 그 요청의 대본·근거 자료·질문·답변 텍스트가 Google Gemini API로 전송된다. 페이지를 열거나 자동 저장·상태 확인을 할 때는 보내지 않는다.
- [Gemini API 추가 약관](https://ai.google.dev/gemini-api/terms)(2026-03-23 수정본 기준): **무료(Unpaid) 서비스**에서는 Google이 입력과 생성 결과를 제품 제공·개선·개발에 쓰고, 사람 검토자가 읽고 주석을 달 수 있다. 약관은 무료 서비스에 민감·기밀·개인 정보를 넣지 말라고 안내한다. **유료(Paid) 서비스**에서는 프롬프트·응답을 제품 개선에 쓰지 않고 정책 위반 감지를 위해 짧게 보관한다. 사용자는 만 18세 이상이어야 하고, 유럽경제지역·스위스·영국에서는 유료 서비스가 필요하다. 약관은 바뀔 수 있으니 배포 전에 원문을 다시 확인한다.
- 개발·검증에는 개인정보 없는 가상 대본만 쓴다. 실제 학생 발표 자료로 검증하려면 결제 등급과 약관을 먼저 확인하고 당사자 동의를 받는다.

## 5. 호출 제한과 오류

- 생성 요청은 사용자가 AI 실행을 누른 `/api/coach` 요청에서만 보낸다. `/api/model-status`는 외부 요청 없이 키 존재·마지막 결과만 알려 준다.
- 입력: 대본 2,400자·근거 2,400자·답변 1,000자·질문 400자, 본문 32KB(자체 모델과 같은 검사). 출력: `maxOutputTokens` 2048, 응답 64KB, 생각 토큰 0(`thinkingBudget: 0`).
- 같은 요청 ID나 같은 내용의 요청이 처리 중이면 새로 부르지 않고 그 결과를 함께 쓴다. 동시 처리·분당·일일·요청자별 한도를 넘으면 429와 `Retry-After`를 돌려준다.
- **재시도하지 않는다.** Gemini가 429를 주면 알려 준 시간(없으면 60초) 동안 모든 Gemini 호출을 멈춘다.
- 근거 자료 없는 답변 검토, 빈 답변, 입력 초과는 Gemini를 부르지 않는다.
- 결과는 자체 모델과 같은 규칙으로 검증한다: 구조화 출력(JSON Schema, 인용은 입력 문장 목록으로 제한) + 서버 검증(원문 인용 일치, 대본 수정의 수치·단위·부정·조건 보존 경고). 통과하지 못하면 502 `invalid-output`.

| HTTP | `error` | 뜻 |
| --- | --- | --- |
| 503 | `not-configured` | `GEMINI_API_KEY` 없음 |
| 503 | `invalid-provider` / `invalid-model` | `AI_PROVIDER`·`GEMINI_MODEL` 값 오류 |
| 502 → 이후 503 | `provider-auth` | Google이 키를 거절(401·403·`API_KEY_INVALID`) |
| 502 → 이후 503 | `provider-billing` | 결제·지역·사용 조건(402·`FAILED_PRECONDITION`) |
| 502 → 이후 503 | `provider-model` | 모델 없음(404) |
| 429 | `provider-rate-limited` | Gemini 사용 한도(`RESOURCE_EXHAUSTED`). `Retry-After` 포함 |
| 429 | `rate-limited` / `busy` | 이 서버의 호출량·동시 처리 한도 |
| 504 | `timeout` | 응답 시간 초과 |
| 503 | `provider-unavailable` | Gemini 서버 오류·연결 실패 |
| 502 | `provider-rejected` | 요청 형식 거절(그 밖의 400) |
| 502 | `provider-blocked` | 안전 필터 등으로 결과 없음 |
| 502 | `invalid-output` | 잘린 응답·JSON 아님·근거 검증 실패 |
| 499 | `cancelled` | 사용자가 취소 |

모든 오류 응답은 `{ error, message }`이고 메시지는 원문이 보존된다고 알린다(사용자 입력은 브라우저에 그대로 남는다). Google 오류 메시지 원문은 넘기지 않는다.

## 6. 한계

- 호출량 제한은 **서버 프로세스 메모리**에만 있다. 서버가 재시작·재배포되거나(무료 Render는 유휴 시 잠듦) 인스턴스가 여러 개면 초기화·분산되므로 **예산을 완전히 보장하지 못한다**. 실제 비용 상한은 Google 프로젝트의 결제·할당량 설정에서 걸어야 한다.
- 요청자 구분은 `X-Forwarded-For` 첫 주소라 조작할 수 있다(보조 제한).
- 구조화 출력과 인용 검증은 결과가 입력 문장을 인용했는지만 확인한다. 해석이 맞는지는 사람이 검토해야 한다.
- 실제 Gemini 연결은 아직 실행하지 않았다(가짜 응답 검사만 통과). 실제 응답에서 스키마 거절(400)이나 출력 품질 문제가 나올 수 있다.

## 7. 구조

| 파일 | 역할 |
| --- | --- |
| `server/coach-provider.js` | `AI_PROVIDER`로 공급자 선택, 처리 안내 문구 |
| `server/gemini-client.js` | Gemini REST 호출·응답 변환·오류 분류만. 주최 측 Gateway로 바꿀 때는 같은 `generateJson()` 모양의 클라이언트를 새로 만든다(아직 구현하지 않음) |
| `server/remote-coach.js` | 외부 공급자 공통: 중복 방지·호출량 제한·쿨다운·상태·출력 검증 연결 |
| `server/local-coach.js` | 자체 모델(기존). 입력 검사·프롬프트·출력 검증 규칙을 Gemini도 함께 쓴다 |
| `tests/gemini-coach.test.mjs` | 가짜 Gemini 응답 검사(실제 호출 차단) |
| `tests/live/gemini-live-check.mjs` | 수동 실제 연결 확인(`GEMINI_LIVE_TEST=1 npm run test:gemini-live`) |
