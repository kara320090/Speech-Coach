# 주최 측 Vercel AI Gateway 공급자

`AI_PROVIDER=gateway`일 때 서버의 모든 AI 호출을 주최 측 Vercel AI Gateway로 보낸다. 팀원 PC 에이전트·자체 모델·Google 직접 API에 의존하지 않는다. Node 직접 실행의 기본값(`AI_PROVIDER` 미설정·`local`)은 유지한다. Docker Compose와 `render.yaml`은 기본 공급자를 `gateway`로 지정한다.

## 참고한 공식 문서
- OpenAI 호환 Chat Completions: https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions
- 구조화 출력(`response_format: json_schema`)·reasoning·고급 설정(모델 대체 `models`는 보낼 때만 동작)
- 음성 → 글자(베타): https://vercel.com/docs/ai-gateway/modalities/speech-to-text
- 모델 페이지: `google/gemini-3.8-flash`, `google/gemini-3.5-transcribe`

## 호출 경로
| 기능 | API | Gateway 요청 |
| --- | --- | --- |
| 코칭(개념·질문·검토·수정안) | `/api/coach` | `POST /v1/chat/completions` |
| 구간 대화 | `/api/coach/segment` | 위와 같음(`/api/coach` 서비스 재사용) |
| 대화 기반 문단 수정 | `/api/scripts/revise-segment` | 위와 같음 |
| 새 대본 생성 | `/api/scripts/generate` | 위와 같음 |
| 도움 대화 | `/api/coach/support` | 위와 같음 |
| 녹음 글자 변환 | `/api/transcribe` | `POST /v4/ai/transcription-model` |

API 요청·응답 계약은 그대로다. 전사 결과는 기존 `{ text, segments: [{ text, startSecond, endSecond }] }` 형식으로 바꾸고, 조각 길이를 넘는 구간은 버린다. 파일 추출·대본 연결·보존 검사·인용 검증은 서버 규칙이 그대로 맡는다.

## 설정
| 환경변수 | 용도 |
| --- | --- |
| `AI_PROVIDER` | `gateway`로 두면 전환. Docker Compose 기본 `gateway`, Node 직접 실행 기본 `local` |
| `AI_GATEWAY_API_KEY` | 주최 측이 준 키. **서버 환경변수에서만** 읽는다. 채팅·코드·Git·로그에 넣지 않는다 |
| `AI_GATEWAY_TEXT_MODEL` | 기본 `google/gemini-3.8-flash` |
| `AI_GATEWAY_TRANSCRIBE_MODEL` | 기본 `google/gemini-3.5-transcribe` |
| `AI_GATEWAY_TIMEOUT_MS` | 글 요청 대기, 최대 110초 |
| `AI_GATEWAY_TRANSCRIBE_TIMEOUT_MS` | 전사 대기, 기본 90초·최대 110초 |
| `AI_MAX_REQUESTS_PER_MINUTE` / `_PER_DAY` / `_PER_CLIENT_PER_MINUTE` / `AI_MAX_CONCURRENT` | 기능별 호출량 상한(기본 10 / 200 / 4 / 2, 도움 대화 사용자별 6) |
| `TRANSCRIBE_TOTAL_SECONDS` | Gateway 전사 누적 길이 상한. 코드 단독 기본 1800초, Docker Compose 기본 3600초(환경변수로 변경 가능) |

Docker Compose: 주최 측이 `AI_GATEWAY_API_KEY`만 전달해도 `docker compose up --build`로 Gateway를 사용한다. 자체 모델이 필요한 개발자는 `AI_PROVIDER=local`로 명시한다. 키가 없으면 다른 모델로 우회하지 않고 AI 미설정 상태를 반환한다. 키는 compose 파일에 적지 않고 `${AI_GATEWAY_API_KEY}`로만 전달한다. Render 등 배포 서버는 대시보드 비밀 환경변수로 설정한다.

## Render 배포 설정

`render.yaml`은 `AI_PROVIDER=gateway`, `AI_GATEWAY_TEXT_MODEL=google/gemini-3.8-flash`, `AI_GATEWAY_TRANSCRIBE_MODEL=google/gemini-3.5-transcribe`를 지정한다. `AI_GATEWAY_API_KEY`의 실제 값은 저장소에 넣지 않고 Render Environment에서 입력한다.

기존 Render 서비스의 대시보드 환경변수가 예전 `local`로 남아 있을 수 있다. 파일 수정·머지 자체를 운영 전환 완료로 간주하지 않는다. 서비스 Environment에서 위 값과 키 설정을 확인하고 저장·재배포한 뒤 상태 API로 적용 여부를 확인한다. Gateway 선택 시 기존 `AI_EXECUTION_MODE=agent` 값이 남아 있어도 서버는 PC 에이전트를 사용하지 않는다.

브라우저에서 `https://speech-coach-public.vercel.app/api/model-status`를 열어 `provider: "ai-gateway"`, `keyConfigured: true`, `transcription.provider: "ai-gateway"`를 확인한다. 상태 조회는 생성·전사를 호출하지 않으며 사용량을 소모하지 않는다. `connection: "unverified"`는 실제 성공 여부가 아직 확인되지 않은 것이며 설정 실패와 구분한다. 텍스트와 전사의 연결 상태도 별개다.

## 상태 확인
`GET /api/model-status`(생성 요청 없음)는 기능별로 `provider: "ai-gateway"`, `model`, `keyConfigured`(키가 있음), `connection`(`unverified` → 실제 요청 성공 시 `verified`, 인증·크레딧·모델 오류 시 `failed`), 마지막 오류 코드, 누적 사용량(요청 수·토큰·전사 초)을 보여준다. 키 값·본문은 넣지 않는다. 키가 없으면 AI 기능은 "AI가 설정되지 않음" 안내를 돌려주고, 자료 저장·직접 수정·로컬 분석은 계속 쓸 수 있다.

## 비용 보호
- 페이지 로드·상태 확인·자동 저장은 생성 요청을 보내지 않는다. 사용자가 누를 때만 호출한다.
- 재시도 없음, 다른 유료 모델 자동 대체(`models`) 없음. 429는 쉬는 시간을 두고, 인증·크레딧·모델 오류 뒤에는 다시 보내지 않는다.
- 같은 요청이 처리 중이면 결과를 함께 쓰고, 입력 길이·출력 토큰(4096)·동시 요청·분/일 호출량·전사 누적 길이를 제한한다.
- 응답의 usage 숫자만 상태에 누적한다.
- **이 제한은 서버 한 대의 메모리 기준이며 재시작하면 초기화된다. 팀 전체 10달러 예산을 완전히 보장하지 않는다.** 주최 측 Gateway 대시보드의 사용량·한도를 함께 확인해야 한다.

## 검증 범위
`tests/gateway.test.mjs`는 가짜 응답만 쓴다(Gateway·Google 주소로의 실제 요청을 막는 장치 포함). 요청 형식·응답 검증·오류 분류·제한을 확인했을 뿐, 전체 모델 품질·전사 정확도를 검증한 것은 아니다. 음성 → 글자는 Vercel 문서상 베타이며 키별 접근 권한을 실제 호출로 확인해야 한다.


## 시간 구간이 없는 전사
공식 REST 규격의 `segments`는 모델이 제공할 때만 존재하며, 예제도 빈 배열을 허용한다. `text`만 있는 정상 응답은 입력 WAV 조각 전체(0~조각 길이)를 한 구간으로 반환하고 `timingPrecision: "chunk"`를 응답·구간에 표시한다. 빈 전사에는 구간을 만들지 않는다. 유효한 모델 구간은 그대로 유지한다.

브라우저는 파일 전체 시간으로 이동할 때 이 표시를 보존한다. 전체 평균 속도와 군말 후보 수는 집계하지만 조각 내부의 세부 속도 변화·반복 위치·단어 시각은 만들지 않는다. 군말 재생 위치는 조각 전체 범위이며 정확한 발생 시각이 아니다. 대본 연결 API에 전사 구간을 전달할 때 `timingPrecision`도 함께 보내야 한다. API는 조각 추정 시간에 의존한 결과를 자동 확정하지 않고 `ambiguous`로 반환한다. 표식을 누락하면 이 정밀도를 복구할 수 없다.

## 소수 실제 연결 확인 기록
이 보완 이전에 수행된 승인된 Docker 검사 보고에서 텍스트 1회(HTTP 200, 약 3.3초), 가상 음성 약 5초 1회(HTTP 200, 약 4.8초)가 성공했다. 텍스트는 입력 604·출력 59토큰, 전사는 글자만 반환하고 시간 구간·언어 정보는 없었다. 이는 두 합성 사례의 연결 확인일 뿐 실제 발표 정확도나 품질의 검증이 아니다. 이번 보완은 가짜 응답으로만 검사하며 실제 유료 호출을 추가하지 않는다.

## 근거가 없는 문단 수정 요청의 전송 스키마

Google 공급자에 전송할 때 빈 문자열을 포함한 인용 `enum`은 일반 문자열 타입으로 보낸다. 정상 인용 목록과 과업 분류 enum은 유지하며, 모델 응답의 빈 인용·실제 원문 인용 여부는 기존 서버 검증으로 다시 확인한다. 로컬 모델의 스키마는 바꾸지 않는다. 실제 Docker 검증에서 빈 근거 자료로 문단 수정이 HTTP 400으로 거절된 뒤 이 전송 변경으로 성공했다.

## 스튜디오 음성 인식 실행

준비·녹화·구간 재연습 화면에서 음성 전사 동의를 명시적으로 선택한다. 녹음 시작 때 그 선택을 연습 기록에 저장하고, 종료 후 분석은 화면의 나중 상태가 아닌 해당 기록의 선택으로 실행한다. 동의하지 않으면 음성을 전송하지 않는다.

결과 화면은 음성 인식 완료·미실행·실패 이유를 접지 않고 보여 준다. 완료하면 인식된 글도 펼쳐 볼 수 있다. 녹음이 남아 있으면 결과에서 다시 동의하고 '저장된 녹음 음성 인식하기'를 눌러 재녹화 없이 실행할 수 있다. 새로고침 후에는 연습 기록→결과 보기→'스튜디오에서 음성 인식 확인'으로 같은 녹음을 연다. 버튼을 누르지 않으면 호출하지 않으며 동의를 다른 기록으로 넘기지 않는다.

실패한 조각의 자동 재시도는 하지 않는다. 저장된 영상·소리는 보존하고, 재실행은 사용자가 별도로 동의·선택한다. 브라우저 검사는 가상 장치와 가짜 전사 응답으로 이 연결을 확인한 것이며 실제 사람 음성의 인식 정확도 검증과 구분한다.
