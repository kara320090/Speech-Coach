# 구간 기반 AI 코칭 API (`POST /api/coach/segment`)

기준일: 2026-10-30. 프롬프트 버전 `segment-coach-v1`. 2026-10-30부터 `/studio.html`(다시봄 스튜디오)의 4단계 ‘AI 코칭’에 연결했다(`public/js/studio-page.js`).

기존 `/support-coach.html`의 연결도 유지한다. [기존 통합 화면 설명](supportive-coach.md#통합-화면2026-10-30-자체-ai-구간-대화와-한-화면).

사용자가 확인한 대본 위치와 영상 검토 구간(침묵·반복 등 관찰값)으로 “이 부분에서 어떤 일이 있었나요?”라고 묻고, 답에 따라 개념 풀이·이해 확인·다음 연습 행동으로 잇는다.

- 침묵 같은 **측정값을 이해 부족·긴장 같은 원인으로 바꾸지 않는다.** 감정·지능·성격을 진단하지 않는다.
- 흐름(어떤 질문·행동을 줄지)은 서버 규칙으로 정한다. 글을 만들어야 하는 단계만 **기존 `/api/coach` 서비스**에 맡긴다: 개념 풀이=`concepts`, 확인 질문=`question`, 답변 검토=`review`. 모델 선택(현재 자체 모델), 인용 검증(원문·자료에 실제로 있는 문장만), 동시 처리 1건, 타임아웃, 취소, 오류 코드는 기존 코칭과 같다. Gemini는 쓰지 않는다(새 대본 만들기 전용).
- 대본 수정·적용은 하지 않는다. 대화·대본·전사를 저장하거나 로그에 남기지 않는다.

## 1. 호출 순서

```
연습 기록(검토 구간·전사)
  → POST /api/scripts/align            대본 문장 후보(matched/ambiguous/unmatched)
  → [화면] 사용자가 위치 확인 또는 직접 선택   ← 확인 전에는 코칭하지 않는다
  → POST /api/coach/segment  action=start        상황 질문(모델 호출 없음)
  → POST /api/coach/segment  action=answer/unknown/explain/skip  (이전 대화를 history에 담아 반복)
  → done=true 이면 종료
```

## 2. 요청

```json
{
  "requestId": "req-2",
  "practiceId": "practice-7",
  "scriptVersionId": "v1.2",
  "script": "안녕하세요. 오늘은 가상의 도서관 캐시 정책을 소개합니다.\n캐시는 최근 결과를 5분 동안 저장해 같은 요청에 다시 사용합니다.\n효과는 아직 검증하지 않았습니다.",
  "sources": "캐시는 최근 결과를 5분 동안 저장해 같은 요청에 다시 사용합니다.",
  "point": { "id": "silence-1", "startSecond": 6.2, "endSecond": 10, "observations": [{ "type": "silence", "measured": "4.2초" }] },
  "selection": { "sentenceId": "s3", "start": 33, "end": 70, "text": "캐시는 최근 결과를 5분 동안 저장해 같은 요청에 다시 사용합니다.", "confirmation": "user-confirmed", "alignmentStatus": "matched", "algorithmVersion": "script-align-v1" },
  "transcript": {
    "before": { "startSecond": 1.8, "endSecond": 6, "text": "오늘은 가상의 도서관 캐시 정책을 소개합니다" },
    "during": [],
    "after": { "startSecond": 10.2, "endSecond": 15, "text": "캐시는 최근 결과를 오 분 동안 저장해 같은 요청에 다시 사용합니다" }
  },
  "history": [
    { "role": "coach", "questionKey": "situation", "kind": "question", "text": "0:06~0:10에 … 어떤 일이 있었나요?", "practiceId": "practice-7", "pointId": "silence-1", "scriptVersionId": "v1.2" }
  ],
  "action": { "type": "answer", "questionKey": "situation", "reason": "concept-confusing", "text": "캐시" }
}
```

| 필드 | 설명 |
| --- | --- |
| `requestId`, `practiceId` | 영문·숫자·`_-` 1~80자. `practiceId`는 연습 기록 ID |
| `scriptVersionId` | `/api/scripts/align`과 같은 형식(영문·숫자·`_-.:` 1~80자) |
| `script` | 연습 당시 대본 전체(선택 문장의 위치를 확인하는 데 쓴다. 모델에는 선택 문장과 앞뒤 한 문장만 보낸다) |
| `sources` | 선택. 근거 자료(2,400자, 기존 코칭과 같은 한도) |
| `point` | 검토 지점 `id`·`startSecond`·`endSecond`(초)와 관찰된 사유 `observations[{ type, measured? }]`. `type`: `silence`·`repeat`·`filler`·`gaze`·`speed`·`section` |
| `selection` | `/api/scripts/align` 응답의 `sentences` 항목(`sentenceId`·`start`·`end`·`text`) + `confirmation` + `alignmentStatus`(+ `algorithmVersion`) |
| `selection.confirmation` | `user-confirmed`: 자동 연결이 `matched`이고 사용자가 “맞아요”로 확인. `user-selected`: 사용자가 후보·전체 문장 중 직접 고름(`ambiguous`·`unmatched`도 가능). 없거나 다른 값이면 거절 |
| `transcript` | `/api/scripts/align`의 `points[].transcript`에서 `before`·`during`·`after`(`{ startSecond, endSecond, text }`). 요약용이며 모델에 보내지 않는다 |
| `history` | 이 구간의 지금까지 대화. 서버가 준 `message`를 그대로 넣고, 사용자 항목은 `{ role: "user", questionKey, action, reason?, text?, practiceId, pointId, scriptVersionId }` |
| `action` | `type`: `start`(첫 요청) · `answer` · `unknown`(모르겠어요) · `explain`(설명해 주세요) · `skip`(건너뛰기). `questionKey`는 마지막 코치 메시지의 것. 상황 질문 답은 `reason`(`intended-pause`·`forgot-line`·`concept-confusing`·`awkward-sentence`·`other`)과 선택 `text`, 그 밖의 답은 `text`(선택지의 `value` 또는 자유 입력) |

## 3. 응답 (`200`)

```json
{
  "requestId": "req-2",
  "practiceId": "practice-7",
  "pointId": "silence-1",
  "scriptVersionId": "v1.2",
  "task": "segment-coach",
  "model": "speech-coach",
  "promptVersion": "segment-coach-v1",
  "durationMs": 1830,
  "step": "explanation",
  "done": false,
  "message": {
    "role": "coach", "questionKey": "explanation", "kind": "info",
    "text": "‘캐시’: 최근 결과를 잠시 저장해 두었다가 다시 쓰는 방식이에요. (자료: “캐시는 최근 결과를 5분 동안 저장해 같은 요청에 다시 사용합니다.”)",
    "choices": [{ "value": "check", "label": "이해 확인 질문 받기" }, { "value": "finish", "label": "끝내기" }],
    "pointId": "silence-1", "scriptVersionId": "v1.2", "practiceId": "practice-7", "term": "캐시"
  },
  "followupCount": 0,
  "followupLimit": 3,
  "summary": {
    "observations": [{ "type": "silence", "label": "긴 침묵", "measured": "4.2초", "startSecond": 6.2, "endSecond": 10, "source": "measurement" }],
    "location": { "sentenceId": "s3", "index": 2, "text": "캐시는 최근 결과를 5분 동안 저장해 같은 요청에 다시 사용합니다.", "start": 33, "end": 70, "confirmation": "user-confirmed", "alignmentStatus": "matched", "algorithmVersion": "script-align-v1", "source": "client-confirmed", "note": "사용자가 확인·선택한 위치예요(서버 검증 사실 아님)." },
    "userReports": [{ "questionKey": "situation", "reason": "concept-confusing", "source": "user" }, { "questionKey": "situation", "text": "캐시", "source": "user" }],
    "evidence": [{ "quote": "캐시는 최근 결과를 5분 동안 저장해 같은 요청에 다시 사용합니다.", "source": "provided-material", "supports": "캐시" }],
    "unverified": ["위치는 사용자가 확인·선택한 값이며 서버가 영상·대본으로 검증한 사실이 아니에요."]
  },
  "modelResult": { "concepts": [ "… 기존 /api/coach concepts 결과 그대로 …" ] }
}
```

(가짜 모델 응답으로 만든 예시. `durationMs`는 예시 값.)

- `step`: `ask-situation` · `ask-detail` · `explanation` · `concept-check` · `review` · `practice` · `closed`
- `message.kind`: `question`(답을 기다림) / `info`(설명·연습·종료). `choices`가 있으면 그 `value`를 다음 요청의 `action.text`(상황 질문은 `action.reason`)로 보낸다.
- `done=true`면 이 구간 코칭이 끝났다.
- `summary`는 다음 수정 단계에서 쓸 수 있게 나눠 둔다: `observations`(측정 사실) · `location`(**클라이언트가 확인한 값**, 서버 검증 사실 아님) · `userReports`(사용자 설명) · `evidence`(제공 자료의 실제 인용) · `unverified`(확인하지 못한 것).
- `modelResult`: 모델을 부른 단계에서만, 기존 `/api/coach` 결과 형식 그대로.

### 흐름

| 상황 | 다음 |
| --- | --- |
| `start` | 상황 질문(관찰값과 사용자가 확인한 위치만 말함) |
| `intended-pause` | 종료(“그대로 두어도 돼요”, 문제로 표시하지 않음) |
| `forgot-line` | 연습: 앞 문장 끝 → 이 문장 핵심어로 이어 말하기(연결 단서) |
| `concept-confusing` | 표현을 `text`로 주면 바로 풀이, 없으면 “어떤 표현이 헷갈렸나요?”(후보 3개) → 풀이 → (선택) 확인 질문 → 답변 검토 |
| `awkward-sentence` | “어느 부분이 말하기 어려웠나요?”(문장 덩어리 후보) → 그 부분 끊어 읽기 연습. 대본은 바꾸지 않음 |
| `other` | 사용자 설명을 기록하고 연습 제안 |
| `unknown` | 더 묻지 않고 연습 행동(확인 질문 단계에서는 풀이) |
| `explain` | 풀이 제공 |
| `skip` | 종료 |
| 후속 질문 3회 도달 | 더 묻지 않고 연습 행동 제공 또는 종료 |

이미 물은 질문(`questionKey`)은 다시 묻지 않는다. 근거 자료가 없으면 풀이에 “자료 근거 없음 — 확인이 필요한 풀이 초안”을 붙이고, 답변 검토는 기존 규칙대로 모델을 부르지 않고 `uncertain`(판단 불가)으로 돌려준다.

## 4. 오류

모두 `{ error, message }` 모양이다(429는 `Retry-After` 머리 포함).

| HTTP | `error` | 상황 |
| --- | --- | --- |
| 400 | `invalid-json` · `invalid-input` | JSON 아님, 필드 형식·길이 오류, 관찰 사유 없음, 잘못된 action |
| 400 | `confirmation-required` | `selection` 없음, `confirmation`이 `user-confirmed`·`user-selected`가 아님, `matched`가 아닌데 `user-confirmed` |
| 400 | `selection-mismatch` | 문장 ID·원문·시작·끝 위치가 보낸 대본과 맞지 않음(다른 대본 버전 포함) |
| 400 | `invalid-time` | 지점·전사 시간 오류 |
| 400 | `segment-mismatch` | 전사 구간이 지점에서 60초보다 멂 |
| 409 | `history-mismatch` | 다른 연습·지점·대본 버전의 이력, 마지막 질문이 아닌 답, 시작 전 답·중복 시작 |
| 413 | `too-large` | 본문 128KB, 이력 16개, 전사 구간 10개 초과 |
| 415 | `content-type` | JSON이 아님 |
| 429 | `rate-limited` | 기기별 분당 20회 초과 |
| 403 | `origin` | 허용하지 않은 출처(기존 코칭과 같음) |
| 405 | `method` | POST가 아님 |
| 429 · 499 · 502 · 503 · 504 | `busy` · `cancelled` · `model-error`·`invalid-output`·`unavailable` · `not-configured` · `timeout` | 모델 단계의 기존 `/api/coach` 오류 그대로 |

## 5. 제한

| 항목 | 한도 |
| --- | --- |
| 요청 본문 | 128KB(대본 전체 포함. 다른 `/api/coach`는 32KB 그대로) |
| 대본 | 20,000자 |
| 근거 자료 | 2,400자 |
| 답변·이력 글 하나 | 1,000자 |
| 이력 | 16개 |
| 관찰 사유 | 1~8개 |
| 전사 구간 | 10개, 지점 앞뒤 60초 안 |
| 후속 질문 | 같은 구간 최대 3회(상황 질문 제외) |
| 요청 수 | 기기(IP)별 분당 20회(메모리 기준) |
| 모델 호출 | 기존 자체 모델 코칭과 같은 동시 1건·타임아웃 |

## 6. 한계

- **대화 이력과 사용자 확인은 클라이언트가 보낸 값이다.** 서버는 형식·일관성(연습·지점·대본 버전, 원문 위치)을 검사하지만, 사용자가 실제로 확인했는지나 이력이 조작되지 않았는지는 보장하지 못한다. 질문 상한 3회도 클라이언트가 이력을 줄여 보내면 우회될 수 있다(서버 저장이 없으므로 완전한 서버 보장이 아님).
- 요청 수 제한은 서버 메모리 기준이라 재시작·인스턴스 수에 따라 초기화·분산된다.
- 개념 풀이·확인 질문·답변 검토의 품질은 운영 모델(자체 모델)에 달려 있다. 이번 검사는 **가짜 모델 응답**으로 흐름·검증·오류 처리를 확인한 것이며, 실제 모델 응답 품질이나 실제 발표 개선 효과를 검증하지 않았다.
- 표현 후보(핵심어)·문장 덩어리 후보는 단순 규칙이라 어색할 수 있다. 사용자가 직접 입력할 수 있게 한다.
- 인용 검증은 문장이 자료에 실제로 있는지만 확인한다. 풀이가 맞는지는 사람이 검토해야 한다.

## 7. 프론트 연결 방법

1. 검토 구간에서 **“이 구간 살펴보기”**를 누르면 `/api/scripts/align` 결과의 후보를 보여 주고 사용자가 위치를 고르게 한다.
   - `matched` → “이 문장 근처가 맞나요?” → 맞음 = `confirmation: "user-confirmed"`
   - 다른 문장을 고르거나 `ambiguous`·`unmatched`에서 고름 = `"user-selected"`
   - 확인 전에는 `/api/coach/segment`를 부르지 않는다.
2. `action: { type: "start" }`, `history: []`로 첫 요청 → `message.text`와 `choices`를 질문 카드로 보여 준다.
3. 사용자가 고르면 `history`에 **방금 받은 `message` 객체 그대로**와 사용자 항목을 넣어 다음 요청을 보낸다. 상황 질문 답은 `action.reason`, 그 밖은 `action.text`(선택지 `value` 또는 입력).
4. 화면에 **모르겠어요(`unknown`)·설명해 주세요(`explain`)·건너뛰기(`skip`)** 버튼을 항상 둔다.
5. `done=true`면 카드 종료. `summary`를 연습 기록 쪽(IndexedDB 등)에 구간 ID·대본 버전과 함께 저장해 두면 다음 대본 수정 단계에서 쓸 수 있다(서버는 저장하지 않는다).
6. `409 history-mismatch`면 그 구간 대화를 처음부터 다시 시작한다. 모델 단계 오류(429·503·504 등)면 메시지를 보여 주고 입력한 답을 지우지 않는다.
7. `score`·`reviewState`를 점수나 정확도로 보여 주지 않는다. `summary.location.note`처럼 위치는 사용자가 고른 값이라고 표시한다.

## 8. 구조·검사

- `server/segment-coach.js`: 입력 검사(선택 문장 일관성은 `server/script-align.js`의 `splitScript` 재사용), 흐름 규칙, 기존 코칭 서비스 호출, 요약. 표현 후보·질문 상한은 화면 규칙(`public/js/coach.js`의 `keywordsOf`·`QUESTION_LIMIT`)을 읽기만 한다.
- `server.js`: 라우트 연결·이 경로의 본문 한도만 추가.
- `tests/segment-coach.test.mjs`: 실제 HTTP로 `/api/scripts/align` → `/api/coach/segment` 흐름을 검사(가짜 자체 모델 응답) 16개.

### 사용자가 직접 고른 시점

`point.observations[].type: "manual"`은 사용자가 직접 고른 검토 위치다. 자동 감지된 이상이나 측정값으로 단정하지 않으며 요약의 `source`는 `user-selected`로 반환한다. 이 사유만으로 수정 필요나 이해 부족을 추정하지 않는다.
