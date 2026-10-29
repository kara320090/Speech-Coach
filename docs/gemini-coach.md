# Gemini는 새 대본 생성에만 사용

기준일: 2026-10-30. 사용자가 지정한 역할은 **새 대본 생성 = Gemini 3.8 Flash**, **기존 대본 분석·쉬운 표현 수정·질문·답변 검토·음성 전사 = 자체 AI**다. 두 서비스의 상태·실패·호출량은 분리한다.

| 화면·API | 처리 위치 | 전송 입력 |
| --- | --- | --- |
| `/create-script.html`, `POST /api/scripts/generate` | Google Gemini (`gemini-3.8-flash`) | 사용자가 생성 버튼을 누른 주제·근거 자료만 |
| `GET /api/scripts/generation-status` | 서버의 생성 상태 조회 | 외부 생성 요청 없음 |
| `/coach.html`, `POST /api/coach` | PC의 Qwen·llama.cpp | 기존 대본·자료·질문·답변 |
| `GET /api/model-status` | 자체 모델·에이전트 상태 조회 | Gemini 호출 없음 |
| `POST /api/transcribe` | PC의 faster-whisper | 사용자가 선택한 음성 조각 |
| 영상 눈 깜빡임·군말 집계 | 브라우저 | 영상·얼굴은 서버 전송 없음 |

`AI_PROVIDER`의 과거 값이 `gemini`여도 코칭은 자체 모델을 쓴다. 자체 모델이 꺼지거나 준비되지 않으면 코칭만 사용 불가로 표시하고 Google로 자동 대체하지 않는다. Gemini 키가 없거나 호출에 실패해도 자체 AI 연습은 계속 사용할 수 있다.

## 새 대본 요청과 저장

요청은 `{task:"generate", topic, sources, requestId, versionId}`다. `topic`은 3~400자, `sources`는 선택·최대 2,400자, 본문 최대 32KB다. 기존 `script`·`answer` 같은 추가 필드와 다른 과업은 400으로 거절하고 외부에 보내지 않는다.

결과는 `result.title`(120자), `result.script`(2,400자), `result.notes`(600자)와 모델·프롬프트·요청 ID를 포함한다. 사실 확인된 대본으로 표시하지 않는다. 사용자가 초안을 읽고 근거와 대조했다고 선택한 뒤 적용하며, 기존 대본·답변 기록을 보존한 새 버전으로 브라우저 IndexedDB에 저장한다. 이후 `/coach.html`에서 자체 AI로 연습한다. 입력을 바꾸거나 취소하면 이전 요청 결과를 적용하지 않는다.

## 서버 설정

- `GEMINI_MODEL=gemini-3.8-flash`, `GEMINI_API_KEY`는 Render 환경변수에만 저장한다. Git·화면·로그·응답에 키를 넣지 않는다.
- `GEMINI_TIMEOUT_MS`: 기본 55,000ms, 범위 5,000~60,000ms. 모델은 자동 교체하지 않는다.
- `AI_MAX_REQUESTS_PER_MINUTE=10`, `AI_MAX_REQUESTS_PER_DAY=200`, `AI_MAX_REQUESTS_PER_CLIENT_PER_MINUTE=4`, `AI_MAX_CONCURRENT=2`는 **새 대본 생성에만** 적용한다. 재배포·여러 인스턴스에서 공유되는 비용 상한은 아니다.
- 3.x는 `thinkingLevel:low`, 명시적으로 2.5를 선택하면 기존 `thinkingBudget:0`을 사용한다. `maxOutputTokens=2048`, JSON Schema와 서버 길이·형식 검사를 적용한다.
- 같은 진행 중 요청은 중복 생성하지 않고, 다른 주제는 서로 구분한다. 429에는 대기 시간과 `Retry-After`를 적용한다. 자동 재시도·자동 공급자 전환은 없다.
- 상태의 `keyConfigured:true`는 키 존재만 의미한다. `connection:verified`는 실제 생성 응답을 받은 상태다. 인증·모델 설정 오류는 생성 서비스 안에서만 중단한다. 503·시간 초과는 별도로 안내한다.

Render는 `AI_EXECUTION_MODE=agent`로 운영 PC의 서명된 에이전트와 연결한다. Vercel의 `/api/*`는 Render로 전달한다. 운영 PC에서 `npm run start:agent`가 실행 중이어야 자체 AI를 사용할 수 있다. Gemini 새 대본 생성은 PC 모델의 준비 여부와 독립적이다.

## 검사

`tests/gemini-coach.test.mjs`: 생성 전용 입력·오류·한도·중복·취소·기존 대본 보존, Gemini 실패 후에도 4개 코칭 과업의 자체 처리. `tests/agent.test.mjs`: 서명된 PC 연결과 Google 호출 없는 실제 전송 경로. `e2e/media/coach-provider.spec.ts`: 생성→확인→버전 보존→자체 코칭 이동과 생성 실패 시 연습 유지. 기본 검사·CI는 실제 Google API를 호출하지 않는다.

수동 실제 생성 확인은 서버 환경에 키를 설정하고 `GEMINI_LIVE_TEST=1 npm run test:gemini-live`로 실행한다. 입력은 개인정보 없는 가상 주제·자료다. 사용량은 Google 프로젝트에 기록될 수 있다. 데이터 처리 조건은 [Google Gemini API 약관](https://ai.google.dev/gemini-api/terms)을 따른다.

## 모델 진단

`npm run gemini:check-models`는 models.get으로 모델 정보 접근 여부만 확인하며 생성하지 않는다. 정보 조회 성공은 실제 대본 생성 성공·무료 사용 가능을 보장하지 않는다. 생성 상태 API의 lastError에는 코드·HTTP 상태·Google 열거 코드·시간·안내만 남기며 원문 메시지·키·프로젝트·입력은 넣지 않는다. 성공하면 지운다. 진단은 생성 서비스 상태에서 확인하고 자체 AI 코칭과 구분한다.
