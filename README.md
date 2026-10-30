# Speech-Coach — 다시봄

AI로 만든 대본을 자기 말로 설명하고, 막힌 순간을 돌아보며 다음 연습을 준비하는 PC·노트북 웹 서비스다. 녹화·시간 측정·검토 구간·대본 이해·수정·재연습을 연결한다. 감정·이해력은 음성이나 표정으로 판정하지 않고 사용자 설명과 측정값을 구분한다.

## 실행과 AI 처리

기본 Docker는 **모델 다운로드 없는 Node 22 웹 서버**다. `AI_PROVIDER=gateway`와 서버 전용 `AI_GATEWAY_API_KEY`로 주최 측 Gateway의 실제 응답을 사용한다. 팀원 PC·GPU·2.65GB 가중치 다운로드는 채점 경로에 필요하지 않다. Dockerfile의 시작 명령은 `node server.js`다.

```sh
docker compose up -d --build
```

로컬에서는 Node 22.x로 다음을 실행한다. `.env.example`을 `.env`로 복사해 키를 서버 환경에만 설정한다.

```sh
npm ci --omit=optional
node --env-file=.env server.js
```

첫 화면은 스튜디오다. 주 메뉴의 **영상 불러오기**, **대본 이해 연습**, **기본 연습 화면**으로 이동한다. 로그인은 없다. 브라우저가 물리 장치를 제공하지 않아도 시간·대본 코칭을 사용할 수 있고 파일 업로드로 실제 미디어를 처리할 수 있다.

`AI_PROVIDER=local`은 기존 Qwen·faster-whisper를 자체 실행하는 운영 모드다. [자체 AI 안내](local-ai/README.md), [배포한 모델 가중치](https://github.com/kara320090/Speech-Coach/releases/tag/model-weights-v1), [별도 CPU 모델 Docker 안내](docs/model-distribution.md)를 유지한다. 기본 평가 Docker는 모델 포함 `Dockerfile.selfhosted`와 구분한다.

## 제출 흐름 8개

[문제 정의](docs/problem.yaml) → [시나리오](docs/scenarios.yaml) → 같은 ID의 `e2e/scenarios/*.spec.ts`가 연결된다. 주최 측은 별도 Playwright 설정으로 이 파일들을 실행한다. 가상 장치·고정 응답·조건부 테스트 종료에 기대지 않는다. S5·S6·S8은 실제 AI가 응답해야 끝난다.

| ID | 화면에서 끝내는 흐름 | 기능 |
| --- | --- | --- |
| S1 | 목표보다 일찍 종료 | F1·F2 |
| S2 | 목표 시간 초과 | F2 |
| S3 | 구간 계획과 실제 시간 | F3 |
| S4 | 같은 조건의 이전 연습 비교 | F6 |
| S5 | 상황 대화 → 실제 AI 문단 수정 → 적용 → 구간 재연습 → 원문 복원 | F7·F9·F10·F11·F13·F20 |
| S6 | 실제 영상 파일 → 실제 AI 전사·속도 집계 + 로컬 MediaPipe | F4·F16·F21 |
| S8 | 개념 → 쉬운 대본 → 질문 → 자기 설명 검토 → 원문 복원 | F7·F9·F10·F17·F18·F19·F20 |
| S9 | 관찰 확인 → 조건 하나 선택 → 구간 재연습·전후 비교 | F5·F11·F13·F14 |

선택 해법 네 경로는 핵심 루프(S5·S9), 이해 확인(S8), 시간 안내(S1–S3), 기록·검토·비교(S4·S6)로 각각 확인한다. S1–S4·S9의 기존 단계와 테스트는 유지한다.

## 녹화 입력 재생 증빙

`e2e/media/S7-real-recording.spec.ts`는 채점 밖 보조 검사다. 제공된 실제 `presentation-review.mp4`를 FFmpeg로 MJPEG·WAV로 바꾸고 Chromium 가상 카메라·마이크로 재생해 기존 녹화·전사·코칭·수정·재연습을 실행한다. **이 영상은 녹화 입력을 재생해 앱을 돌린 결과이며 실제 Gateway 응답을 사용한다.** 실제 웹캠의 실시간 촬영이나 학습 효과를 증명하는 자료로 표시하지 않는다.

```sh
cd e2e
npx playwright test
npx playwright test -c media.config.ts S7-real-recording.spec.ts
```

FFmpeg가 PATH에 없으면 `FFMPEG_BIN`에 실행 파일 경로를 설정한다. 변환물은 `e2e/fixtures/generated/`에 캐시하고 Git에서 제외한다. 모델 예시 응답 서버·simulation 주소는 사용하지 않는다. `RECORDING_DEMO_PACE_MS=1500`은 보조 녹화의 읽는 시간을 늘린다.

각 제출 흐름의 영상은 `e2e/test-results/scenarios/`, 녹화 입력 재생의 영상·화면·실제 앱 녹음 WAV·HTTP 증빙은 `e2e/test-results/media/`에 남는다. CI는 성공·실패 모두 `e2e-evidence` 아티팩트로 업로드한다. 같은 입력을 두 번 재생한 결과는 발표 개선의 근거가 아니다.

## 현재 기능과 확인 위치

완료 조건은 [문제 정의 YAML](docs/problem.yaml)의 `done`에 관찰 가능한 화면 상태로 적었다. 자동 시간 예측·전사 자동 연결/4열 비교는 보류 해법에 정리했다. 현재 명세는 20개이며 추가 조사 없이 경험·직접 인용을 채우지 않는다.

| ID | 현재 명세 | 검사 연결 |
| --- | --- | --- |
| F1 | 연습 준비(목표·기준·계획·기록 방법 설정) | S1 |
| F2 | 실시간 발표 보조 | S2 |
| F3 | 구간별 시간 계획 비교 | S3 |
| F4 | 소리·웹캠 영상 기록 | S6·별도 녹화 증빙 |
| F5 | 자동 점검 구간 표시와 구간 재생 | S9·음성 단위 검사 |
| F6 | 연습 결과와 같은 조건 비교 | S4 |
| F7 | 대본·근거 자료·버전 관리 | S5·S8 |
| F9 | 말하기 쉬운 대본 수정 제안 | S5·S8 |
| F10 | 수치·단위와 일부 의미 표현의 보존 검사 | S5·S8·보존 단위 검사 |
| F11 | 구간 재연습과 전후 비교 | S5·S9 |
| F12 | 대본 코칭 기록 JSON 내보내기 | 별도 JSON 브라우저 검사 |
| F13 | 관찰 확인과 상황·원인 질문 (초기 구현, S9) | S5·S9 |
| F14 | 원인에 맞춘 연습 조건 설계와 시험 (초기 구현, S9) | S9 |
| F16 | 녹화·파일 불러오기 전사와 군말·속도 측정 | S6·별도 녹화 증빙 |
| F17 | 낯선 개념 후보와 자료 근거 연결 (초기 구현) | S8 |
| F18 | 자기 말로 설명하는 이해 확인 (초기 구현) | S8 |
| F19 | 자료 기반 예상 질문과 답변 연습 (초기 구현) | S8 |
| F20 | 자체 공개 모델·Gateway 실행과 처리 상태 | S5·S8·공급자 단위 검사 |
| F21 | 영상 눈 깜빡임 측정 | S6·계산 단위 검사 |
| F22 | AI로 새 대본 초안 생성 | 별도 생성 브라우저 검사 |

JSON 내보내기와 새 초안 생성은 별도 브라우저 검사 범위다. 제출 8개가 모든 입력·언어·장치의 품질을 검증한다는 뜻은 아니다.

## 설정

| 환경변수 | 용도·설정 위치 |
| --- | --- |
| `AI_PROVIDER` | Docker 기본 `gateway`; `local`은 운영 PC 자체 모델. 자동 전환 없음 |
| `AI_GATEWAY_API_KEY` | 로컬 Git 제외 `.env`, GitHub repository Secret, 서버 환경변수. 브라우저에 전달하지 않음 |
| `AI_GATEWAY_TEXT_MODEL` | 기본 `google/gemini-3.8-flash` |
| `AI_GATEWAY_TRANSCRIBE_MODEL` | 기본 `google/gemini-3.5-transcribe` |
| `AI_MAX_REQUESTS_PER_CLIENT_PER_MINUTE` | 기본 Compose 6회. S5·S8의 분당 텍스트 요청을 제한 |
| `TRANSCRIBE_TOTAL_SECONDS` | Compose 기본 3,600초, 단독 모듈 기본 1,800초 |
| `PORT`, `RELEASE_ID` | 웹 포트, `/__health`의 실제 배포 버전 |
| `LOCAL_LLM_URL`, `LOCAL_STT_URL` | local 모드의 loopback 모델 주소 |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | local 모드에서 별도 선택한 생성·도움 대화 설정 |
| `FRONTEND_ORIGINS` | 별도 프론트엔드 출처 허용 목록 |

두 기본 모델은 [공식 공개 모델 목록](https://ai-gateway.vercel.sh/v1/models)에서 확인했다. `node tests/live/gateway-catalog-check.mjs`로 키 없이 목록을 다시 확인할 수 있다. 키별 접근·예산은 실제 호출과 대시보드에서 별도로 확인한다. 팀 예산은 총 $10이며 개발·시연 호출도 포함된다.

## 저장·전송과 검사

녹음·영상·대본·답변·분석은 브라우저 IndexedDB에 저장한다. 사용자가 선택한 소리 전사는 소리 조각만 서버의 전사 제공자로 보내고 영상·얼굴은 보내지 않는다. 텍스트 AI 버튼은 필요한 대본·자료·답변을 설정된 공급자로 보낸다. 모델·처리 위치·전송 범위를 화면에 표시하고 원문·이전 답변을 보존한다. 키·소리·글 본문은 서버 로그에 남기지 않는다.

```sh
node --test --test-concurrency=1
python -m pip install -r tools/requirements-dev.txt
python tools/check_submission.py
python tools/render_problem_canvas.py --check
```

CI는 경량 Docker 기동 → `/__health` → 단위·제출 계약 검사 → 실제 AI 제출 흐름 → 녹화 입력 재생 증빙 순으로 확인한다. 가짜 공급자 응답을 쓰는 단위 검사와 실제 AI E2E를 구분한다. 실제 사람의 전사·깜빡임 정답 정확도, 시간 절감·학습 효과, 다음 채점 점수는 별도 확인 대상이다.

## 공개 서비스와 문서

- [Vercel 프론트엔드](https://speech-coach-public.vercel.app/) → `/api/*`·`/__health`는 Render로 중계한다.
- [Render 백엔드](https://speech-coach-2j01.onrender.com/). 실제 운영 공급자는 그 서버 환경설정을 따른다.
- [앞면·뒷면 캔버스](docs/problem-canvas.md) · [출처 조사 원기록](docs/source-records.md) · [기능·시나리오 추적](docs/traceability.md) · [판단·범위](docs/decisions.md) · [진행 기록](progress.md)
