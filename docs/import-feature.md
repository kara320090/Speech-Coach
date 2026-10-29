# 영상·소리 파일 불러오기와 글자 변환 (구현됨)

2026-10-29 학생 요청("mp4를 음성데이터를 빼고 글자변환으로")으로 추가한 기능이다. 다른 기획 문서(F1–F14, S1–S10)와 번호가 겹치지 않게 **번호를 배정하지 않았다**. 어느 번호로 정리할지는 학생이 정한다.

## 하는 일

이미 녹음·녹화해 둔 영상 또는 소리 파일(mp4, m4a, mp3, wav, webm)을 `/import.html`에서 고르고 목표 시간을 적으면, 파일에서 **소리만** 브라우저 안에서 꺼내 같은 결과 화면(`#/result/ID`)으로 보여 준다.

- 항상 하는 분석: 긴 침묵 찾기(기존 기준 그대로), 총 길이와 목표 시간 비교. 결과 화면의 항목을 누르면 영상·소리의 그 위치로 이동한다.
- 학생이 '글자로도 바꿔서 분석'을 **직접 켠 경우에만**: 소리를 글자로 바꿔 평균 말하기 속도, 반복 표현, 속도 변화도 분석한다(기존 기준 그대로).
- 지금은 구간별 시간 계획·마디 표시·목표 속도 범위를 쓰지 않는다(파일에는 '다음 구간'을 누른 기록이 없다).

## 처리 흐름

1. 브라우저가 `AudioContext({ sampleRate: 16000 }).decodeAudioData`로 파일의 소리를 16kHz 모노로 푼다(`public/js/importer.js`). 300MB 초과·30분 초과·소리 없음·읽을 수 없는 형식은 이유를 알리고 멈춘다.
2. 긴 침묵을 찾는다(`analyzeSilence`).
3. 글자 변환을 켰다면 가장 조용한 지점(목표 20초 ± 5초)에서 소리를 조각으로 나눠 `POST /api/transcribe`로 보낸다(동시 3개, 조각마다 실패 시 1회 재시도).
4. 서버(`server.js`)가 `AI_GATEWAY_API_KEY`로 AI Gateway(`POST {AI_GATEWAY_URL}/v4/ai/transcription-model`, 모델 기본값 `google/gemini-3.5-transcribe`)를 호출하고 글과 구간(segments)을 돌려준다.
5. 돌아온 글을 파일 시간 기준의 글 조각으로 바꿔 기존 분석(`analyzeTranscript`)에 넣고, 결과를 이 브라우저의 IndexedDB에 저장한 뒤 결과 화면으로 이동한다.

## 개인정보와 전송 범위

- 영상 파일은 서버로 보내지 않고 이 브라우저 안에만 저장한다.
- 글자 변환을 켜지 않으면 파일·소리 모두 브라우저 밖으로 나가지 않는다.
- 켠 경우에만 16kHz 모노 WAV 조각이 우리 서버를 거쳐 외부 AI 음성 인식 서비스로 전송된다. 켜기 전 화면에 안내하고, 결과 화면에도 보냈다고 적는다. 서버는 받은 소리를 저장하거나 기록하지 않는다.
- 키는 서버 환경변수로만 읽고 응답·화면·저장소에 나오지 않는다.

## 서버 API: `POST /api/transcribe`

| 상황 | 응답 |
| --- | --- |
| `AI_GATEWAY_API_KEY`가 없음 | 503 `not-configured` (글자 변환만 꺼지고 나머지 기능은 그대로) |
| 본문이 WAV가 아님 | 415 `not-wav` |
| 본문이 4MB 초과(약 2분) | 413 `too-large` |
| 서버가 켜져 있는 동안 변환한 소리 길이 합이 한도 초과(기본 3600초, `TRANSCRIBE_TOTAL_SECONDS`) | 429 `budget` (팀 예산 $10 보호용) |
| 게이트웨이가 401·403 | 502 `gateway-auth` |
| 게이트웨이가 429 | 429 `gateway-limit` |
| 게이트웨이 연결 실패(90초 제한 포함) | 502 `gateway-unreachable` |
| 그 밖의 게이트웨이 오류 | 502 `gateway-error` |
| 성공 | 200 `{ text, segments:[{text,startSecond,endSecond}], language, durationInSeconds }` |

실패한 요청은 한도에서 뺀 소리 길이를 돌려받는다. `GET` 등 다른 방식은 405.

## 환경변수

| 이름 | 용도 |
| --- | --- |
| `AI_GATEWAY_API_KEY` | AI Gateway 키(비밀값). 없으면 글자 변환만 꺼진다 |
| `TRANSCRIBE_MODEL` | (선택) 모델. 기본 `google/gemini-3.5-transcribe` |
| `TRANSCRIBE_TOTAL_SECONDS` | (선택) 서버 누적 변환 길이 한도(초). 기본 3600 |
| `AI_GATEWAY_URL` | (선택) 게이트웨이 주소. 기본 `https://ai-gateway.vercel.sh`. 테스트에서 가짜 서버를 가리킬 때 쓴다 |

`docker-compose.yml`의 `app`이 위 이름을 `${이름:-}` 형태로 받아 넘긴다. 값은 저장소에 두지 않는다.

## Render 배포

저장소 루트의 `render.yaml`(Blueprint)이 웹 서비스 하나를 정의한다. 서버 하나가 화면과 `/api/transcribe`를 같이 내보내므로 프론트엔드와 백엔드는 같은 주소로 이미 연결되어 있다(주소 설정·CORS 없음).

1. Render에 가입·로그인하고 GitHub를 연결해 이 저장소(`kara320090/Speech-Coach`)에 접근을 허용한다.
2. New → Blueprint에서 이 저장소를 고르면 `render.yaml`대로 `speech-coach` 웹 서비스가 만들어진다(Node 22, `node server.js`, 상태 확인 `/__health`).
3. 서비스의 Environment에서 `AI_GATEWAY_API_KEY`에 팀 키를 직접 넣는다(키는 채팅·저장소에 적지 않는다). 안 넣으면 글자 변환만 꺼진다.
4. 배포가 끝나면 `https://<서비스 이름>.onrender.com/__health`가 `{"status":"ok","releaseId":"<commit>"}`를 주는지 확인한다. 마이크·웹캠은 HTTPS에서만 허용되는데 Render 주소는 HTTPS다.
5. 무료 플랜은 한동안 접속이 없으면 서버가 잠들어 첫 접속이 느릴 수 있다. 서버가 다시 켜지면 글자 변환 누적 한도(`TRANSCRIBE_TOTAL_SECONDS`) 계산도 0부터 다시 시작한다.

## 검증과 한계

- 단위 테스트(`node --test`, 전체 40개 중 13개): `tests/transcribe.test.mjs`(가짜 게이트웨이 서버로 키 없음·415·413·성공·오류 구분·연결 실패·한도), `tests/importer.test.mjs`(조각 나누기, 글 조각 변환, 재시도·중단).
- 브라우저 검사 `e2e/media/import.spec.ts`(`npx playwright test -c media.config.ts`): 메뉴에서 wav를 불러와 3초 부근의 약 5초 긴 침묵을 찾고 눌러서 이동, 글자 변환(가짜 `/api/transcribe` 응답), 키 없음 처리, 켜지 않으면 호출 없음, 잘못된 입력과 읽을 수 없는 파일. 주최 측 시나리오(`docs/scenarios.yaml`)에는 넣지 않았다.
- ffmpeg로 만든 mp4(H.264+AAC)를 Playwright Chromium에서 불러와 소리를 꺼내고 침묵 위치(0:06~0:11)를 찾는 것을 확인했다. 브라우저가 풀 수 있는 코덱만 가능하다.
- **실제 AI Gateway는 호출해 보지 못했다**(Agent는 키를 받지 않았다). 요청 모양은 Gateway 문서에 맞췄고 가짜 서버로만 확인했다. 실제 응답에 구간(segments)이 없거나 모양이 다르면 조각 전체(약 20초)를 한 구간으로 보므로 시간 위치가 거칠어진다.
- **Render 배포는 해 보지 못했다**(가입·저장소 연결·키 입력은 학생이 직접 해야 한다). `render.yaml`은 Render 설정 규칙대로 썼지만 실제 Render에서 돌려 확인한 것은 아니다.
- 말하기 속도·반복 표현은 전사 품질에 좌우되고, 한글이 아닌 말·숫자·누락에서 한계가 있다(기존 기준과 같다).
