# 주최 측 Vercel AI Gateway 공급자

`AI_PROVIDER=gateway`일 때 서버의 모든 AI 호출을 주최 측 Vercel AI Gateway로 보낸다. 팀원 PC 에이전트·자체 모델·Google 직접 API에 의존하지 않는다. Node 직접 실행의 기본값(`AI_PROVIDER` 미설정·`local`)은 유지한다. Docker Compose는 채점 환경을 위해 기본 공급자를 `gateway`로 지정한다.

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
