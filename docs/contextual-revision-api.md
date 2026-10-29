# 구간 대화 기반 대본 문단 수정 API (`POST /api/scripts/revise-segment`)

기준일: 2026-10-30. 프롬프트 버전 `contextual-revision-v1`. 2026-10-30부터 `/studio.html`(다시봄 스튜디오)의 5단계 ‘대본 수정’에 연결했다(`public/js/studio-page.js`).

[구간 코칭](segment-coach-api.md)에서 사용자가 확인한 대본 위치와 그 구간에서 나눈 대화를 바탕으로, **대상 문단 하나만** 고친 수정안을 돌려준다. 예: “용어가 어려워서 설명하기 힘들었어요” → 그 용어를 풀어 쓴 말하기 쉬운 문단.

- 질문·대화는 다시 만들지 않는다. `/api/coach/segment`의 `summary`·대화 이력을 받는다.
- 글 생성은 **기존 `/api/coach`의 `rewrite` 과업**을 그대로 호출한다. 모델 선택(현재 자체 모델)·수치·단위·부정·조건·한계 검사(`checkRevision`)·인용 검증·동시 처리·타임아웃·취소·오류 코드가 기존 쉬운 대본 제안과 같다. `rewrite`에는 선택 입력(`request`·`before`·`after`)만 추가했고, 없으면 기존 프롬프트·동작과 같다.
- **사용자가 명시적으로 수정을 요청했을 때만** 모델을 부른다. 서버는 원본 대본·연습 기록을 바꾸지 않는다. 수정안은 제안이다.
- 대본·대화·자료를 저장하거나 로그에 남기지 않는다.

## 1. 호출 순서

```
구간 코칭(/api/coach/segment) done=true
  → [화면] '이 문단 고치기' 버튼(사용자 명시 요청)
  → POST /api/scripts/revise-segment
       status = proposed            → 수정 전후 비교 + 보존 경고 확인 → 사용자가 적용/거절
       status = no-change-needed    → “바꿀 필요가 없어요” 안내
       status = needs-confirmation  → 바꾸고 싶은 점(choices) 고르게 한 뒤 request.focus로 다시 요청
  → [화면] 적용: 현재 대본이 apply.baseScriptVersionId·원문 해시와 같은지 확인 → 이 범위만 바꾼 새 버전 생성
```

## 2. 요청

```json
{
  "requestId": "rev-1",
  "practiceId": "practice-7",
  "scriptVersionId": "v1.2",
  "point": { "id": "silence-1" },
  "script": "안녕하세요. 오늘은 가상의 도서관 서비스를 소개합니다.\n\n이 서비스는 캐시를 이용해 최근 결과를 5분 동안 저장하고, 같은 요청이 오면 저장한 결과를 다시 사용하기 때문에 응답이 빨라지지만 효과는 아직 검증하지 않았습니다.\n\n감사합니다.",
  "sources": "캐시는 최근 결과를 5분 동안 저장해 같은 요청에 다시 사용한다. 효과는 아직 검증하지 않았다.",
  "target": { "paragraphIndex": 1, "start": 32, "end": 124, "text": "이 서비스는 캐시를 이용해 … 검증하지 않았습니다.", "confirmation": "user-confirmed" },
  "mustPreserve": ["5분 동안"],
  "coaching": {
    "summary": {
      "observations": [{ "type": "silence", "measured": "4.2초" }],
      "location": { "sentenceId": "s3" },
      "userReports": [{ "questionKey": "situation", "reason": "concept-confusing" }]
    },
    "history": [
      { "role": "user", "questionKey": "situation", "action": "answer", "reason": "concept-confusing", "text": "용어가 어려워서 설명하기 힘들었어요", "practiceId": "practice-7", "pointId": "silence-1", "scriptVersionId": "v1.2" }
    ]
  },
  "request": { "explicit": true, "focus": ["plain-terms"], "text": "" }
}
```

| 필드 | 설명 |
| --- | --- |
| `requestId`, `practiceId` | 영문·숫자·`_-` 1~80자 |
| `scriptVersionId`, `point.id` | 구간 코칭과 같은 값(영문·숫자·`_-.:` 1~80자) |
| `script` | 원본 대본 전체(대상 범위 확인용. 모델에는 대상 문단과 앞뒤 문단 일부만 보낸다) |
| `target` | 수정할 **문단**. 빈 줄로 나뉜 덩어리 하나와 원문 시작·끝 위치(UTF-16, end 미포함)가 대본과 정확히 같아야 한다. `confirmation`: `user-confirmed`/`user-selected` |
| `sources` | 선택. 근거 자료(2,400자) |
| `mustPreserve` | 선택. 대상 문단 안에 있는 문구 중 반드시 그대로 둘 것(최대 10개·각 200자) |
| `coaching.summary` | `/api/coach/segment` 응답의 `summary`에서 `observations`·`location`·`userReports` |
| `coaching.history` | 그 구간의 대화 이력(같은 `practiceId`·`pointId`·`scriptVersionId`만) |
| `request.explicit` | **반드시 `true`**(사용자가 수정 버튼을 누름). 아니면 거절 |
| `request.focus` | 선택. `plain-terms`(용어 풀기) · `split-sentences`(긴 문장 나누기) · `spoken-style`(구어체) |
| `request.text` | 선택. 사용자가 직접 쓴 수정 요청(400자) |

### 구간 코칭 응답에서 넘기는 값

| 구간 코칭(`/api/coach/segment`) | 수정 요청 |
| --- | --- |
| `practiceId`, `pointId`, `scriptVersionId` | 같은 이름 그대로(`pointId` → `point.id`) |
| `summary.location.sentenceId` | `coaching.summary.location.sentenceId` — 이 문장이 들어 있는 문단을 `target`으로 고른다(`/api/scripts/align`의 `sentences[].paragraphIndex`) |
| `summary.observations` | `coaching.summary.observations`(측정값. 수정 이유로 쓰지 않음) |
| `summary.userReports` | `coaching.summary.userReports` |
| 화면이 모아 둔 `history`(서버가 준 `message`들과 사용자 항목) | `coaching.history` |

## 3. 수정 필요 판단(모델 호출 전, 규칙)

| 대화·요청 | 결과 |
| --- | --- |
| `request.focus`나 `request.text`가 있음 | 그 요청대로 수정안 생성 |
| 상황 답 `concept-confusing` | 필요: 용어 풀기 |
| 상황 답 `awkward-sentence` | 필요: 긴 문장 나누기·구어체 |
| 상황 답 `intended-pause`만 있음(요청 없음) | `no-change-needed` |
| `forgot-line`만 있거나 대화가 없음·불명확 | `needs-confirmation`(+ `choices`) |
| 침묵·군말 등 측정값만 있음 | `needs-confirmation`(측정값으로 원인을 추정하지 않음) |

## 4. 응답 (`200`)

```json
{
  "requestId": "rev-1", "practiceId": "practice-7", "pointId": "silence-1", "scriptVersionId": "v1.2",
  "task": "contextual-revision", "promptVersion": "contextual-revision-v1", "model": "speech-coach", "durationMs": 2140,
  "status": "proposed",
  "target": { "paragraphIndex": 1, "start": 32, "end": 124, "text": "이 서비스는 캐시를 이용해 … 검증하지 않았습니다.", "sentenceIds": ["s3"], "confirmation": "user-confirmed" },
  "revision": { "text": "이 서비스는 최근 결과를 잠시 저장해 두었다가 다시 쓰는 방식인 캐시를 이용해요. 결과를 5분 동안 저장하고, 같은 요청이 오면 저장한 결과를 다시 써서 응답이 빨라져요. 다만 효과는 아직 검증하지 않았어요.", "reason": "캐시를 풀어 쓰고 긴 문장을 나눴어요.", "humanReview": "required" },
  "appliedUserInputs": ["어려운 용어를 쉬운 말로 풀어 쓰기", "용어가 어려워서 설명하기 힘들었어요"],
  "preservation": { "warnings": [], "blocked": false, "reviewRequired": true, "mustPreserveMissing": [], "note": "수치·단위·부정·조건·한계·보존 문구만 확인한 보수적 검사예요. 통과해도 전체 의미가 같다고 보장하지 않아요." },
  "basis": {
    "observations": [{ "type": "silence", "measured": "4.2초", "source": "client-reported-measurement", "note": "측정값이며 원인 근거로 쓰지 않았어요." }],
    "userReports": [{ "reason": "concept-confusing", "text": "용어가 어려워서 설명하기 힘들었어요", "source": "user" }],
    "inferredNeeds": [{ "id": "plain-terms", "label": "어려운 용어를 쉬운 말로 풀어 쓰기", "from": "coaching-answer", "source": "inferred-from-user-answer" }],
    "evidence": [{ "quote": "캐시는 최근 결과를 5분 동안 저장해 같은 요청에 다시 사용한다.", "source": "provided-material" }],
    "unverified": ["대화 요약은 클라이언트가 보낸 값이며 서버가 검증한 사실이 아니에요."]
  },
  "apply": { "baseScriptVersionId": "v1.2", "start": 32, "end": 124, "originalSha256": "924e00e6…", "scriptSha256": "f61f79db…", "note": "적용 전 현재 대본이 같은 버전이고 이 범위의 원문이 그대로인지 확인한 뒤, 이 범위만 바꾼 새 버전을 만들어 주세요. 서버는 대본을 바꾸지 않아요." }
}
```

(가짜 모델 응답으로 만든 예시이며 `userReports`는 일부만 표시. 해시는 위 요청 대본 기준 실제 값의 앞부분.)

- `status`: `proposed`(수정안 있음) · `no-change-needed`(바꾸지 않음, `revision: null`, `reasons`) · `needs-confirmation`(추가 확인 필요, `revision: null`, `reasons`·`choices`)
- `preservation`: 기존 `checkRevision` 결과(`warnings`·`blocked`) + 보존 문구 확인. `blocked=true`(수치·단위 누락·새 수치·보존 문구 누락)면 화면은 적용 버튼을 막고 사용자가 직접 고치게 한다. `warnings`(조건·부정·한계 표현 사라짐 등)는 확인 후 적용.
- `basis`: 관찰(측정값, 클라이언트 보고) · 사용자 설명 · 추정한 필요(사용자 답에서 추정) · 자료 근거(실제 인용) · 미확인을 나눈다.
- `apply`: 적용 시 비교할 식별자. `originalSha256`=대상 문단 원문의 SHA-256, `scriptSha256`=요청한 대본 전체의 SHA-256.

## 5. 오류

모두 `{ error, message }`(429는 `Retry-After` 포함).

| HTTP | `error` | 상황 |
| --- | --- | --- |
| 400 | `invalid-json` · `invalid-input` | 형식·길이 오류, 잘못된 `focus`, 대상 문단에 없는 `mustPreserve` |
| 400 | `revision-not-requested` | `request.explicit`가 `true`가 아님 |
| 400 | `confirmation-required` | `target`이 없거나 사용자 확인·선택 값이 아님 |
| 400 | `target-mismatch` | 문단 번호·원문·시작·끝 위치가 대본과 다름(문단 일부만, 다른 대본 버전 포함) |
| 409 | `context-mismatch` | 대화 이력의 연습·지점·대본 버전이 다름, 코칭에서 확인한 문장이 대상 문단에 없음 |
| 413 | `too-large` | 본문 128KB, 문단 2,400자, 이력 16개, 사용자 설명 12개, 보존 문구 10개 초과 |
| 415 · 403 · 405 | `content-type` · `origin` · `method` | 기존 `/api/coach`와 같음 |
| 429 | `rate-limited` | 기기별 분당 10회(모델을 부르는 요청만 셈) |
| 429 · 499 · 502 · 503 · 504 | `busy` · `cancelled` · `model-error`·`invalid-output`·`unavailable` · `not-configured` · `timeout` | 기존 `rewrite`와 같음. `invalid-output`=형식 오류·자료에 없는 인용 |

## 6. 제한

| 항목 | 한도 |
| --- | --- |
| 요청 본문 | 128KB |
| 대본 | 20,000자 |
| 대상 문단 | 2,400자(기존 rewrite 한도) |
| 근거 자료 | 2,400자 |
| 수정 요청 글 | 400자, 모델에 넘기는 요청 정리 800자 |
| 앞뒤 문맥 | 각 600자(서버가 대본에서 잘라 만든다) |
| 대화 이력·사용자 설명 | 16개·12개, 글 하나 1,000자 |
| 출력 | 기존 rewrite와 같음(수정문 5,000자, 응답 64KB) |
| 요청 수 | 기기(IP)별 분당 10회(메모리 기준), 모델 동시 1건·타임아웃은 기존과 같음 |

## 7. 프론트 연결

1. 구간 코칭이 `done=true`가 되면 **“이 문단 고치기”** 버튼을 보여 준다. 누를 때만 이 API를 `request.explicit: true`로 부른다.
2. `target`은 `/api/scripts/align`의 `sentences`에서 확인한 문장의 `paragraphIndex`로 문단을 정하고, 그 문단의 첫 문장 `start`~마지막 문장 `end`와 `script.slice(start, end)`를 넣는다.
3. `proposed`면 원문(`target.text`)과 수정안(`revision.text`)을 나란히 보여 주고, `preservation.warnings`를 함께 표시한다. `blocked=true`면 적용 버튼을 막고 직접 수정하게 한다. `basis.unverified`가 있으면 “설명 정확성은 확인되지 않았어요”를 보여 준다.
4. **적용은 화면 책임이다.**
   - 현재 대본의 버전이 `apply.baseScriptVersionId`와 같고, 현재 대본의 `start`~`end` 원문 SHA-256이 `apply.originalSha256`과 같은지 다시 확인한다. 다르면 적용하지 않고 다시 요청한다(오래된 결과 방지).
   - `script.slice(0, start) + revision.text + script.slice(end)`로 **이 범위만** 바꾸고 다른 문단은 그대로 둔다.
   - 원본을 덮어쓰지 말고 **새 대본 버전**(새 `scriptVersionId`)으로 저장하고, 되돌리기를 위해 원본 버전을 남긴다. 기존 연습 기록은 원래 버전에 연결된 채로 둔다.
5. `needs-confirmation`이면 `choices`를 보여 주고, 사용자가 고른 값을 `request.focus`에 넣어 다시 요청한다. `no-change-needed`면 수정하지 않는다.

## 8. 한계

- 이번 검사는 **가짜 모델 응답**으로 흐름·검증·오류 처리를 확인한 것이다. 실제 자체 모델의 수정 품질이나 발표 개선 효과는 검증하지 않았다.
- 보존 검사는 수치·단위·일부 부정·조건·한계 단어·보존 문구만 본다. 통과해도 의미가 같다고 보장하지 않는다. 새 사례·사실을 만들지 말라는 규칙은 프롬프트에만 있고 서버가 완전히 검출하지 못한다.
- 대화 요약·사용자 확인은 클라이언트 값이다. 서버는 형식·식별자·대본 범위 일치만 검사한다.
- 요청 수 제한은 서버 메모리 기준이다(재시작 시 초기화).

## 9. 구조·검사

- `server/contextual-revision.js`: 입력 검사(문단 경계는 `splitScript` 재사용), 수정 필요 판단, 기존 `rewrite` 호출, 보존 문구 확인, 응답 정리.
- `server/local-coach.js`: `rewrite`에 선택 입력 `request`·`before`·`after`(없으면 기존과 동일)만 추가.
- `server.js`: 라우트·본문 한도 연결만.
- `tests/contextual-revision.test.mjs`: 실제 HTTP + 가짜 자체 모델 응답 17개.
