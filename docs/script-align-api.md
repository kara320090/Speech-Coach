# 검토 시점 ↔ 대본 문장 연결 API (`POST /api/scripts/align`)

기준일: 2026-10-30. 알고리즘 버전 `script-align-v1`. 백엔드만 구현했고 화면 연결 전이다.

영상·녹음에서 찾은 검토 시점(예: 2:14 긴 침묵)이 **대본의 어느 문장 근처인지** 앞뒤 전사 구간으로 찾아 후보를 돌려준다. 결과는 사용자가 확인·수정할 후보이며, 침묵만으로 이해 부족이나 원인을 판단하지 않는다.

- 외부 AI를 부르지 않는다(텍스트 정규화 + 글자 2-gram 유사도 + 순서 정보).
- 대본·전사·결과를 저장하거나 로그에 남기지 않는다. 원문·연습 기록을 바꾸지 않는다.
- `score`는 비슷한 정도(0~1)일 뿐 **확률이나 검증된 정확도가 아니다.**

## 1. 요청

`POST /api/scripts/align`, `Content-Type: application/json`

```json
{
  "scriptVersionId": "script-v3",
  "script": "안녕하세요. 오늘은 가상의 도서관 이용 방법을 소개합니다.\n도서관은 매주 토요일 오전 10시에 문을 엽니다.\n\n대출 기간은 2주이며, 연장은 한 번만 할 수 있습니다!",
  "segments": [
    { "startSecond": 0, "endSecond": 1.5, "text": "안녕하세요" },
    { "startSecond": 1.8, "endSecond": 6, "text": "오늘은 가상의 도서관 이용 방법을 소개합니다" },
    { "startSecond": 6.3, "endSecond": 10, "text": "도서관은 매주 토요일 오전 열 시에 문을 엽니다" },
    { "startSecond": 14, "endSecond": 19, "text": "대출 기간은 이주이며 연장은 한 번만 할 수 있습니다" }
  ],
  "points": [{ "id": "silence-1", "startSecond": 10.2, "endSecond": 13.8 }]
}
```

| 필드 | 형식 | 설명 |
| --- | --- | --- |
| `scriptVersionId` | 문자열, 영문·숫자·`_-.:` 1~80자 | 연습 당시 대본 버전. 결과의 문장 ID는 이 버전 기준 |
| `script` | 문자열 | 연습할 당시의 대본 원문 |
| `segments` | `[{ startSecond, endSecond, text }]` | 시간 위치가 있는 전사 구간. **`/api/transcribe` 응답의 `segments`와 같은 형식·단위(초)** |
| `points` | `[{ id, startSecond, endSecond }]` | 연결할 검토 지점(1개 이상). `id`는 요청 안에서 중복 불가 |

## 2. 응답 (`200`)

```json
{
  "scriptVersionId": "script-v3",
  "algorithmVersion": "script-align-v1",
  "scoreNote": "score는 글자 2-gram 기반 유사도(0~1)이며 확률이나 검증된 정확도가 아니에요.",
  "sentences": [
    { "id": "s1", "index": 0, "paragraphIndex": 0, "text": "안녕하세요.", "start": 0, "end": 6 },
    { "id": "s2", "index": 1, "paragraphIndex": 0, "text": "오늘은 가상의 도서관 이용 방법을 소개합니다.", "start": 7, "end": 32 },
    { "id": "s3", "index": 2, "paragraphIndex": 0, "text": "도서관은 매주 토요일 오전 10시에 문을 엽니다.", "start": 33, "end": 60 },
    { "id": "s4", "index": 3, "paragraphIndex": 1, "text": "대출 기간은 2주이며, 연장은 한 번만 할 수 있습니다!", "start": 62, "end": 93 }
  ],
  "segments": [
    { "index": 2, "startSecond": 6.3, "endSecond": 10, "alignment": { "status": "clear", "sentenceId": "s3", "score": 0.879, "alternatives": [] } }
  ],
  "points": [
    {
      "pointId": "silence-1",
      "scriptVersionId": "script-v3",
      "startSecond": 10.2,
      "endSecond": 13.8,
      "algorithmVersion": "script-align-v1",
      "status": "matched",
      "position": "between",
      "primarySentenceId": "s4",
      "candidates": [
        { "sentenceId": "s4", "index": 3, "paragraphIndex": 1, "text": "대출 기간은 2주이며, 연장은 한 번만 할 수 있습니다!", "start": 62, "end": 93, "role": "after-point", "score": 0.9 },
        { "sentenceId": "s3", "index": 2, "paragraphIndex": 0, "text": "도서관은 매주 토요일 오전 10시에 문을 엽니다.", "start": 33, "end": 60, "role": "before-point", "score": 0.879 }
      ],
      "reasons": [{ "code": "next-sentence", "message": "지점 앞 발화가 앞 문장, 뒤 발화가 다음 문장에 연결돼요(문장 사이)." }],
      "transcript": {
        "during": [],
        "before": { "index": 2, "startSecond": 6.3, "endSecond": 10, "text": "도서관은 매주 토요일 오전 열 시에 문을 엽니다", "alignment": { "status": "clear", "sentenceId": "s3", "score": 0.879, "alternatives": [] } },
        "after": { "index": 3, "startSecond": 14, "endSecond": 19, "text": "대출 기간은 이주이며 연장은 한 번만 할 수 있습니다", "alignment": { "status": "clear", "sentenceId": "s4", "score": 0.9, "alternatives": [] } },
        "gapBeforeSecond": 0.2,
        "gapAfterSecond": 0.2
      }
    }
  ]
}
```

(위 요청을 그대로 보냈을 때의 실제 값. `segments`는 일부만 표시)

### 필드 설명

- `sentences`: 대본을 문장으로 나눈 전체 목록. `start`·`end`는 **원문 문자열의 UTF-16 인덱스**(end 미포함)로 `script.slice(start, end) === text`. 나누는 기준은 화면의 `splitSentences`와 같다(마침표·물음표·느낌표 뒤 공백, 줄바꿈). 빈 줄로 문단(`paragraphIndex`)을 나눈다. 사용자가 후보 외 다른 문장을 고를 때 이 목록을 쓴다.
- `segments[].alignment`: 전사 구간마다 연결된 문장(`clear`/`weak`/`ambiguous`/`none`), 유사도, 비슷한 다른 후보. 순서 정보를 반영한 결과다.
- `points[]`:
  - `status`: `matched`(근거가 한쪽으로 모임) / `ambiguous`(후보가 여럿이거나 근거가 한쪽뿐) / `unmatched`(근처 전사가 없거나 대본과 비슷하지 않음)
  - `position`: `within`(문장 안·지점 안 발화) / `between`(두 문장 사이) / `before-first` / `after-last` / `unknown`
  - `primarySentenceId`: `matched`일 때만 값이 있다. `between`이면 **멈춘 뒤 이어서 말한 문장**을 앞에 둔다(원인 판단이 아니라 표시 기준).
  - `candidates[].role`: `spoken-during`, `around-point`, `before-point`, `after-point`, `alternative`
  - `skippedSentenceIds`: 앞뒤 발화 사이에 전사에서 찾지 못한 문장(생략됐을 수 있음)
  - `transcript`: 지점 안(`during`)·바로 앞(`before`)·바로 뒤(`after`) 전사 구간과 간격. **전사 구간 시간만 그대로 쓰고 구간 안의 단어별 시간은 만들지 않는다.**
  - `reasons[]`: 선택 근거 코드와 설명

| `reasons[].code` | 뜻 |
| --- | --- |
| `spoken-during` | 지점 안 발화가 그 문장과 비슷함 |
| `same-sentence` | 앞뒤 발화가 같은 문장(문장 중간 멈춤) |
| `next-sentence` | 앞=앞 문장, 뒤=다음 문장(문장 사이) |
| `skipped-between` | 앞뒤 사이에 전사에 없는 문장이 있음(최대 3문장) |
| `went-back` | 뒤 발화가 앞쪽 문장(다시 읽기·반복, 최대 2문장 뒤) |
| `start-of-script` / `end-of-script` | 첫 문장 전 / 마지막 문장 뒤 |
| `before-only` / `after-only` | 한쪽 근거만 있음 → `ambiguous` |
| `duplicate-sentence` | 같거나 비슷한 문장이 여러 개라 순서로도 확정 못 함 → `ambiguous` |
| `inconsistent-context` | 앞뒤 발화가 서로 먼 문장 → `ambiguous` |
| `weak-similarity` | 비슷하지만 '대본에 없는 발화'와 점수 차가 작음 → `ambiguous` |
| `no-nearby-transcript` | 앞뒤 20초 안에 전사 없음 → `unmatched` |
| `speech-not-in-script` | 근처 발화가 대본과 비슷하지 않음 → `unmatched` |
| `no-transcript` | 전사 구간이 없음 → `unmatched` |

## 3. 제한

| 항목 | 한도 | 넘으면 |
| --- | --- | --- |
| 요청 본문 | 256KB | 413 `too-large` |
| 대본 | 20,000자, 문장 400개 | 413 `too-large` |
| 전사 구간 | 2,000개, 구간당 1,000자, 합계 60,000자 | 413 `too-large` / 400 `invalid-input` |
| 검토 지점 | 요청당 100개 | 413 `too-large` |
| 작업량 | 전사 구간 수 × 문장 수 ≤ 1,000,000 | 413 `too-large` |
| 시간 값 | 0 ≤ 초 ≤ 14,400(4시간), `startSecond ≤ endSecond`, 유한한 숫자 | 400 `invalid-time` |

참고: 로컬 합성 측정에서 최대 작업량(문장 400 × 구간 2,000, 지점 100)은 약 0.2초, 응답 약 400KB였다. 서버 메인 스레드에서 계산한다.

## 4. 오류

모두 `{ error, message, field? }` 모양이다(`field`는 문제가 된 입력 위치, 예: `points[0]`).

| HTTP | `error` | 상황 |
| --- | --- | --- |
| 400 | `invalid-json` | JSON이 아님 |
| 400 | `invalid-input` | 필드 형식 오류(대본 문자열 아님, ID 형식, segments·points 형식 등) |
| 400 | `empty-script` | 대본이 비어 있음 |
| 400 | `invalid-time` | 음수·무한대·문자열 시간, 시작 > 끝, 4시간 초과 |
| 400 | `duplicate-point-id` | 검토 지점 ID 중복 |
| 405 | (본문 없음) | POST가 아님(`Allow: POST`) |
| 413 | `too-large` | 위 제한 초과 |
| 415 | `content-type` | `application/json`이 아님 |
| 500 | `align-failed` | 예상하지 못한 계산 오류 |

## 5. 알고리즘(v1)과 정확도 한계

1. 대본을 문장으로 나누고, 비교할 때만 NFKC·소문자·글자/숫자만 남기기로 정규화한다(띄어쓰기·문장부호·줄바꿈 차이 무시).
2. 전사 구간과 문장의 유사도 = 0.6 × 포함 비율(겹친 글자 2-gram ÷ 전사 2-gram) + 0.4 × Dice 계수. 0.34 미만이거나 전사 2-gram이 3개 미만(“음”, “네”)이면 연결하지 않는다.
3. 전체 전사에 대해 **단조 경로(Viterbi)**를 찾는다. 각 구간은 한 문장에 연결하거나 '대본에 없는 발화'로 볼 수 있다. 앞으로 건너뛰면 문장당 작은 벌점, 앞 문장으로 되돌아가면(반복·다시 읽기) 큰 벌점을 준다.
4. forward·backward로 “이 구간을 문장 j로 볼 때의 최선 전체 점수”를 구해, 최선과 차이가 작은 다른 문장이 있으면 `ambiguous`로 남긴다(반복 문장). '대본에 없음'과 차이가 작으면 `weak`.
5. 검토 지점은 지점 안 발화가 있으면 그 문장, 없으면(침묵) 앞뒤 20초 안의 가장 가까운 전사 구간이 연결된 문장으로 위치를 정한다.

한계(합성 예시로만 확인했으며 **실제 발표 데이터로 정확도를 검증하지 않았다**):

- 숫자·영어 읽기 차이(“10시”↔“열 시”, “AI”↔“에이아이”)는 정규화하지 않아 유사도가 낮아질 수 있다.
- 크게 바꿔 말하거나 요약한 발화는 연결되지 않을 수 있다(의도적으로 억지 연결하지 않음).
- 전사 구간 하나가 여러 문장에 걸치면 가장 비슷한 한 문장에만 연결된다.
- 아주 짧은 문장, 서로 비슷한 문장이 많은 대본은 `ambiguous`가 늘어난다.
- 전사 품질(인식 오류·구간 시간 오차)에 그대로 영향을 받는다.
- 매개변수(0.34, 벌점 등)는 합성 예시로 정한 값이다. 실제 사용 기록이 쌓이면 사용자 확인 결과와 비교해 조정해야 한다.

## 6. 사용 방법

### 프론트 담당

1. 검토 구간 목록(긴 침묵·반복·군말 등)의 `id`·`startSecond`·`endSecond`와, 그 연습의 대본·`scriptVersionId`·전사 구간(`/api/transcribe` 결과)을 보낸다. 전사가 없으면 모든 지점이 `unmatched`로 온다.
2. `matched`면 `primarySentenceId` 문장을 강조하고 “이 근처가 맞나요?”로 확인받는다. `ambiguous`면 `candidates`를 선택지로, `unmatched`면 `sentences` 전체에서 직접 고르게 한다. 어느 경우든 사용자가 바꿀 수 있어야 한다.
3. 사용자가 고른 결과는 화면 쪽(IndexedDB 등)에 `{ pointId, scriptVersionId, sentenceId, source: "user-confirmed" | "user-changed" | "auto", algorithmVersion }`처럼 따로 저장한다. 이 API는 저장하지 않는다. 대본이 바뀌면(`scriptVersionId`가 달라지면) 문장 ID가 달라지므로 다시 요청한다.
4. `score`를 “정확도 82%”처럼 보여 주지 않는다.

### AI 코칭 담당

- **사용자가 확인·수정한 문장**(또는 `matched`)만 코칭 입력으로 쓰고, `ambiguous`·`unmatched`는 사용자 확인 전에는 쓰지 않는다.
- 전달 예: “2:14~2:19 긴 침묵(측정값) · 대본 s4 ‘대출 기간은…’ 직전(사용자 확인)”. 침묵은 **관찰된 사실**로만 전달하고 이해 부족·긴장 같은 원인으로 바꿔 쓰지 않는다. 원인은 기존 질문 흐름(그때 무슨 일이 있었는지)으로 사용자에게 묻는다.
- `skippedSentenceIds`는 “전사에서 찾지 못했다”는 뜻일 뿐 생략을 확정하지 않는다.

## 7. 구조·검사

- `server/script-align.js`: 입력 검사, 문장 나누기, 유사도, 정렬, 지점 연결, HTTP 처리기. `server.js`는 라우트 연결만.
- `tests/script-align.test.mjs`: 실제 HTTP 요청을 포함한 합성 사례 13개(한글·줄바꿈·문장부호, 정상 순서, 반복 문장, 생략·다시 읽기, 무관한 발화, 침묵 앞뒤, 전사 없음·큰 간격, 추임새·바꿔 말하기, 잘못된 입력, 처리 한도, 저장·로그 없음).


### 조각 단위 전사 시간
전사 구간의 `timingPrecision: "chunk"`는 입력 음성 조각 전체를 뜻하며 정확한 발화 위치가 아니다. 프론트는 이 필드를 전달해야 한다. 이 구간에 의존하는 대본 후보는 `ambiguous`와 `coarse-timing` 사유로 반환하며 사용자가 확인해야 한다. 기존 표식 없는 구간의 계약은 유지한다.
