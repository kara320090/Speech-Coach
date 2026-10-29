# Speech-Coach — 대본을 이해하고 내 말로 발표하기

## 공개 웹과 자체 AI 연결

- 프론트엔드: [공개 웹](https://speech-coach-public.vercel.app/), Vercel의 `Other` 프리셋, 출력 폴더 `public`. `vercel.json`이 `/api/*`와 `/__health`를 Render 백엔드로 전달한다.
- 백엔드: `https://speech-coach-2j01.onrender.com`. 화면·코칭·전사·파일 가져오기 API를 제공한다.
- 자체 AI: 운영 PC에서 Qwen·faster-whisper를 직접 실행한다. `npm run start:agent`가 모델을 시작하고 Render의 서명된 작업을 처리한다. 코칭·전사는 외부 AI 제공자 API와 추가 학습 없이 처리하고, 새 대본 생성만 Gemini 3.8 Flash를 사용한다.
- 요청마다 Ed25519 서명·본문 해시·시간·재전송 여부를 확인한다. Git에는 공개 키만 포함하고 개인 키·모델·개인 실행 설정은 운영 PC에 보관한다.
- 운영 PC와 에이전트가 실행 중이어야 AI를 사용할 수 있다. PC가 꺼지면 웹 기본 기능은 유지되고 AI 연결 상태를 안내한다. Render 무료 서버에 모델을 올리거나 PC의 모델 포트를 인터넷에 공개하지 않는다.

준비·실행 명령은 [자체 AI 실행 안내](local-ai/README.md)에 있다.

## 2026-10-30 main 통합 상태

main의 다시봄 화면, TXT 불러오기, 구간 질문·조건 선택·재연습(S9), E2와 공개 조사 기록을 보존했다. 자체 AI 대본 코칭과 선택 전사, 영상 눈 깜빡임을 함께 제공한다. main의 F15는 대본 이해 교차 확인으로 유지하고, PR #3의 눈 깜빡임은 F21로 변경했다. 기존 문서의 미구현 표시는 당시 기록이며, 현재 상태는 이 절과 구현 범위 문서를 따른다. F13–F14 기본 흐름은 구현됐지만 전체 계획 수용 조건이 검증됐다는 뜻은 아니다.

AI로 만든 대본의 낯선 표현을 풀어 보고, 자기 설명과 예상 질문으로 준비하는 **PC·노트북 웹 서비스**다. **새 대본 생성은 Gemini 3.8 Flash**, **기존 대본 분석·쉬운 표현 수정·질문·답변 검토는 Qwen**, **음성 전사는 faster-whisper**로 역할을 나눈다. `/create-script.html`에서 확인한 초안만 새 버전으로 저장하고 `/coach.html`의 자체 AI 연습으로 이어간다. [AI 역할·API 안내](docs/gemini-coach.md).

핵심 흐름: **대본·자료 → 개념 선택 → 자기 설명 → 쉬운 대본 → 예상 질문 → 이전·이번 답변 비교**. 군말·말 더듬음·표정으로 이해나 감정을 판정하지 않는다. 모델 결과는 사용자가 근거와 함께 확인할 초안이다.

## 현재 구현

| 범위 | 상태 |
| --- | --- |
| `/coach.html` 대본 이해 연습 | 자료·버전 저장, 개념/풀이, 자기 설명·질의응답, 쉬운 대본 제안·직접 수정·되돌리기, 답변 비교·JSON 내보내기 구현 |
| 새 대본 생성 | `/create-script.html` → Gemini 3.8 Flash. 주제·근거만 전송, 사용자 확인 후 새 버전 저장. 생성 서비스와 코칭의 상태·실패 분리 |
| 자체 LLM | Node→loopback llama.cpp, 공식 Qwen3-4B Q4_K_M 실제 실행. 인용 범위 제한·수치 변경 적용 차단·요청 취소·오류 처리 |
| 자체 음성 전사 | 파일 불러오기→Node→loopback faster-whisper CPU worker. 외부 AI Gateway 코드는 제거 |
| 기존 연습 | 목표·구간 시간, 마이크·선택 웹캠 기록, 침묵·전사 군말 후보·이전 회차 비교. 외부 처리 가능성이 있는 브라우저 실시간 음성 인식은 비활성화 |
| TXT 대본 불러오기 | main의 파일 선택·편집·녹음 기록 연결을 유지 |
| PDF·DOCX·TXT 추출 API | `POST /api/scripts/import`, 화면 연결은 후속. [API 안내](docs/script-import-api.md) |
| 영상 눈 깜빡임 | MediaPipe를 브라우저에서만 실행. F21, 실제 얼굴 정확도 미검증 |
| 후속 기획 | 개인 실측 시간에 맞춘 자동 수정, 세부 명제 의미 검사, 코칭·녹음의 완전한 연결, 상황 질문·환경 변경 자동 적용 등. [기능별 구현 범위](docs/local-ai-implementation.md) |

새 텍스트 흐름은 첫 구현이다. 쉬운 문장이 생성돼도 내용 이해·학습 효과가 입증된 것은 아니다. 필수 수치·단위가 달라지면 적용을 차단하고 직접 고치게 한다. 부정·조건·한계는 일부 규칙과 사용자 확인으로 다루며 의미 보존을 보증하지 않는다.

## 실행

Node 22.13 이상이 필요하다. 문서 추출용 패키지는 `npm ci --omit=optional`로 설치한다. 프론트 빌드 단계는 없다.

```sh
npm start
```

`http://localhost:3000`에서 기존 연습, `/coach.html`에서 자료 저장·직접 편집을 사용할 수 있다. AI 기능은 별도 모델 프로세스가 필요하며 모델이 없으면 상태를 안내한다. **모델 설치·시작 명령은 [자체 AI 실행 안내](local-ai/README.md)**. 모델·실행기 파일은 Git에 포함하지 않는다.

| 환경변수 | 용도 |
| --- | --- |
| `PORT`, `RELEASE_ID` | 웹 포트·health의 배포 버전 |
| `LOCAL_LLM_URL` | 같은 호스트 LLM 주소, 예 `http://127.0.0.1:8088`. 없으면 AI 코칭 비활성화 |
| `LOCAL_MODEL_NAME` | 실행기 모델 alias, 기본 speech-coach |
| `LOCAL_AI_TIMEOUT_MS` | 기본 90초, 최대 180초. 동시 코칭 요청은 1개 |
| `LOCAL_STT_URL` | 같은 호스트 전사 worker 주소, 예 `http://127.0.0.1:8081` |
| `TRANSCRIBE_TOTAL_SECONDS` | 서버 실행 중 누적 전사 길이, 기본 3600초 |
| `AI_PROVIDER` | 호환 설정 `local`. 코칭은 이 값과 관계없이 자체 모델만 사용 |
| `GEMINI_MODEL`, `GEMINI_API_KEY` | 새 대본 생성 전용 모델(기본 `gemini-3.8-flash`)과 키. 서버 환경변수에서만 읽음. [생성 설정](docs/gemini-coach.md) |

자체 모델 주소는 loopback만 허용하며 외부 URL·리다이렉트를 쓰지 않는다. 자체 모델이 없을 때 Gemini 등 클라우드로 자동 전환하지 않는다(Gemini는 새 대본 생성 API에서만 사용). 과거 `AI_GATEWAY_API_KEY`, `AI_GATEWAY_URL`, `TRANSCRIBE_MODEL`은 더 이상 읽지 않는다. `.env`는 자동 로드하지 않으므로 실행 환경에 설정하거나 Node의 `--env-file`을 사용한다.

## 저장·처리 위치

녹음·영상·측정 결과는 기존 브라우저 IndexedDB에 저장한다. 새 대본·자료·버전·답변은 별도 IndexedDB에 저장해 기존 기록 스키마를 유지한다. 코칭 버튼을 누르면 필요한 텍스트가 자체 모델 서버로 전송된다. 새 대본 생성 버튼을 누른 주제·근거 자료만 Google로 보내며 기존 답변·녹음·영상은 보내지 않는다. 선택 전사는 음성 조각만 자체 전사 서버로 보낸다. 서버는 입력·답변·음성을 파일이나 본문 로그에 보관하지 않는다. 영상·얼굴 데이터는 서버로 보내지 않는다.

자체 서버 처리도 브라우저 밖 전송이다. 개발 PC에서 모두 실행할 때와 운영 서버를 사용할 때를 구분한다. 최초 모델 다운로드는 인터넷을 사용하며 런타임 자동 다운로드는 없다.

## 검사와 배포 범위

`node --test --test-concurrency=1`: **138개 통과**. 기존 S1–S4·S9 **5개**, 새 대본 생성·자체 코칭 별도 브라우저 검사 **9개 통과**. 생성 서비스와 코칭의 독립성은 가짜 응답·실제 서명된 에이전트 전송으로 검사했다. 실제 사람 얼굴·한국어 발표 정확도, 학습 효과·시간 절감은 별도 검증 범위다. [진행 기록](progress.md).

`docker compose up --build`는 모델 없는 기본 웹을 제공하며, Render는 서명된 운영 PC 에이전트로 코칭·전사를 처리한다. PC의 `npm run start:agent`와 모델이 실행 중이어야 자체 AI를 사용할 수 있다. 새 대본 생성은 서버 환경의 Gemini 키를 별도로 사용하며, 생성 서비스가 준비되지 않아도 기존 대본으로 연습할 수 있다. 검사는 [진행 기록](progress.md)에서 현재 확인 범위를 구분한다.

## 기획·정의·분석 문서

| 문서 | 내용 |
| --- | --- |
| [문제 정의 YAML](docs/problem.yaml) / [캔버스 앞면·뒷면](docs/problem-canvas.md) | 새 문제·근거 구분, 기존 E1 보존, F1–F21 |
| [서비스 기획](docs/product-plan.md) | 대상·차별화할 과업·범위·단계·성공 지표 |
| [공개 프로젝트·자체 AI 설계](docs/local-ai-design.md) | 참고 저장소·라이선스·실행 방식·전송 경계 |
| [구현 범위·남은 차이](docs/local-ai-implementation.md) | 기능별 현재 동작·한계·코드 연결 |
| [코칭 설계](docs/coaching-design.md) | 이해 확인·긍정적 피드백·가상 예시·선택권 |
| [경쟁 분석](docs/competitive-analysis.md) | 직접 확인·공식 설명·미확인 구분 |
| [요구사항 정의](docs/requirements-definition.md) / [분석](docs/requirements-analysis.md) | 기능·수용 조건·구조·데이터·인터페이스 |
| [화면·흐름](docs/screen-spec.md) / [현재 제출 흐름](docs/scenarios.yaml) | 새 화면과 기존 S1–S4·S9 |
| [검증](docs/validation-plan.md) / [추적표](docs/traceability.md) | 요구·검사·실제 확인 범위 |
| [결정 기록](docs/decisions.md) / [진행 기록](progress.md) | 범위 변경·근거·확인/미확인 |
| [파일 불러오기](docs/import-feature.md) / [영상·군말 측정](docs/media-measurements.md) | 자체 전사·브라우저 측정·예외 |
| [기존 계산 기준](docs/current-implementation.md) | 기본 시간·침묵·속도 계산의 기준 |

main의 [UI·API 명세](docs/ui-api-spec.md)도 유지한다. 자체 모델 연결은 [실행 안내](local-ai/README.md)를 따른다. main 배포만으로 모델이 자동 설치되지는 않는다.
