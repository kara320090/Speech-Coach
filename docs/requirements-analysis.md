# 요구사항 분석서

## 메인 분석 버튼의 자체 AI 전사 (2026-10-30)

F16은 파일 불러오기와 함께 메인 녹화의 분석 버튼에서도 동작한다. `transcribe` 선택은 기본 켜짐이며 연습 설정에서 끌 수 있고, 이전에 비활성화됐던 브라우저 실시간 음성 인식 설정과 분리한다. 녹음·기본 결과를 IndexedDB에 먼저 저장한 뒤 소리만 `/api/transcribe`→운영 PC faster-whisper로 처리한다. 영상·얼굴·대본은 이 전사 요청에 포함하지 않는다. 전사 완료 후 기존 브라우저 계산으로 평균 속도·군말 후보·검토 위치를 만든다.

처리 중에는 중복 분석·새 녹화를 막고 진행률과 취소를 제공한다. 전사문·결과를 같은 기록에 다시 저장한다. 서버 미준비·취소·부분 실패·인식된 말 없음은 미측정 이유를 표시하고 녹음·시간·침묵·시선 결과를 유지한다. 부분 전사문은 보존하지만 전체 속도·군말 수치로 사용하지 않는다. 10~13초 같은 짧은 녹음도 인식된 글이 있으면 평균 속도·군말 집계가 가능하고, 속도 변화 구간은 별도 최소 구간 기준을 따른다.

## 2026-10-30 AI 처리 역할

새 대본 생성(F22)은 `/create-script.html`·`POST /api/scripts/generate`에서 Gemini 3.8 Flash로 처리한다. 사용자가 입력한 주제·근거 자료만 전송하며, 초안 확인 후 기존 기록을 보존한 새 버전으로 저장한다. 기존 대본의 개념 분석·쉬운 표현 수정·질문·답변 검토는 Qwen, 음성 전사는 faster-whisper로 처리한다. 자체 AI와 Gemini의 상태·실패는 독립적이며 자동 공급자 대체는 없다. API·설정은 [역할 분리 명세](gemini-coach.md)를 따른다.

**현재 구현 상태:** 자체 실행 텍스트 코칭과 음성 전사의 첫 구현이 추가됐다. 아래 전체 기획의 완료 조건과 구현된 부분은 [구현 범위](local-ai-implementation.md)에서 구분한다. 외부 AI Gateway와 브라우저 실시간 음성 인식은 제거/비활성화했다.


기준일: 2026-10-29. [정의서](requirements-definition.md)의 요구를 처리 규칙·구조·예외·의존성으로 구체화한다. **현재 구조와 앞으로 바꿀 구조를 구분한다.**

## 1. 문제에서 요구사항까지

| 문제·제약 | 필요한 처리 | 기능 | 설계상 주의 |
| --- | --- | --- | --- |
| 녹음·영상을 다시 보며 직접 점검 | 시간 위치·측정값·근거를 하나의 검토 항목으로 묶음 | F4–F5 | 침묵·반복이 반드시 실수라는 판단 금지 |
| 시간 초과·미달 | 목표·실제 비교, 구간 배분, 대본 축약·보완 | F1–F3, F8–F9 | 빨리 말하기만을 해결책으로 강요하지 않음 |
| 수정 효과를 다시 확인해야 함 | 원문·수정안·재연습을 같은 항목 ID로 연결 | F6, F10–F11 | 조건이 다른 연습의 지표를 개선으로 단정하지 않음 |
| 필수 설명이 삭제될 위험 | 필수 항목·수치·조건·부정 의미 대조 | F7, F10 | 사용자 경험으로 확인된 사실이 아닌 설계상 위험 관리 |
| 설치형 앱을 원하지 않음 | 브라우저 녹음·편집·결과 제공 | 전 기능 | 사용자 설치를 요구하지 않는 웹 구조 |
| 반복 표현의 이유를 측정만으로 알 수 없음 | 관찰 교정·짧은 상황 질문·미확인 상태 | F13 | 사용자 설명은 인과 증명의 결과가 아님 |
| 하지 말라는 지시만으로 준비 조건을 바꾸기 어려움 | 선택 가능한 단서·화면·구간 연습과 조건 시험 | F14, F11 | 효과 없음·악화·부담도 함께 기록 |
| AI 도구로 만든 대본을 완벽히 숙지하지 못함(팀 관찰), “이해했다”는 답이 실제와 다를 수 있음 | 이해 교차 확인 질문, 응답별 대본 다듬기, 원문·설명·수정안·발화 교차검증 | F15, F9–F11 | 이해 부족 자동 판정 금지, 원문에 없는 사실 추가 금지 |

## 2. 현재 구현 구조

```text
브라우저
  app.js       설정 / 연습 / 결과 / 기록 화면
  time.js      시간 입력·표시
  plan.js      구간 계획·수동 전환 시각 비교
  recorder.js  마이크·선택 영상 / 브라우저 외부 음성 인식 비활성화
  coach-page.js / coach-store.js  대본 이해·수정·질문 / 별도 IndexedDB
  wav.js       음성 샘플 변환·WAV 생성
  analysis.js  규칙 기반 침묵·반복·속도 변화·회차 비교
  storage.js   IndexedDB 저장, 실패 시 현재 실행 메모리 보관
  import-page.js / importer.js  (F16) 파일 소리 추출·조각 나누기·선택 글자 변환 요청
       │
       └─ Node 서버: public 파일, GET /__health, POST /api/transcribe(자체 worker), POST /api/coach(자체 LLM)
```

- 서버는 자체 LLM 과업 `/api/coach`와 자체 전사 `/api/transcribe`를 제공한다. 서버 DB·로그인은 없다. 새 코칭 기록은 별도 브라우저 IndexedDB에 보관한다.
- 연습 녹음·영상·분석 결과를 우리 서버에 보관하는 경로는 없다. 글자 변환을 켜면 소리 조각(WAV)이 자체 전사 worker로 전달되며 Node·worker는 저장하지 않는다. 실제 배포 환경의 로그 처리는 미검증이다.
- 브라우저 음성 인식은 비활성화했다. 모델 최초 다운로드는 네트워크를 사용하고 자체 서버 처리도 브라우저 밖 전송이므로 브라우저만의 완전 오프라인 제품으로 표현하지 않는다.
- 녹음·시간 측정 실패와 전사 실패는 구분한다. 전사 실패가 실제 발표 품질이 낮다는 뜻은 아니다.

## 3. 확장 설계 — 공개 모델 직접 실행·추가 학습 없음

1. 대본·별도 근거 자료·필수 항목·버전을 로컬 저장하고 문단 ID를 연결한다(F7).
2. 사용자가 요청한 최소 텍스트를 Node 서버에 보내고 직접 운영하는 모델 프로세스에서 개념 후보·근거를 만든다(F17·F20).
3. 사용자의 자기 설명과 원문 근거를 비교한다(F18). 단어 선택·군말·표정만으로 이해·감정을 판정하지 않는다.
4. 쉬운 표현을 제안하고 사실·필수 의미 변화를 검사한다(F9–F10). 자료 부족은 확인 필요로 남긴다.
5. 질문 응답과 도움 없이 다시 설명한 기록을 개념별로 연결한다(F19·F11). 사용자가 상황·환경 변경을 선택하면 F13–F14로 연결한다.
6. 음성 전사는 자체 worker로 구현했다. Gateway 및 외부 업체 처리 가능성이 있는 브라우저 음성 인식은 차단했다. 실제 사람 음성 품질은 후속 검증한다.

실행기·모델·참고 프로젝트·라이선스·배포 구조는 [자체 AI 설계](local-ai-design.md)에 있다. 내부 HTTP 경로는 자체 프로세스 간 통신이며 외부 AI 제공자 API를 쓰는 방식이 아니다. 서버 처리에도 텍스트·선택 음성이 브라우저 밖으로 전송되므로 위치·목적·범위를 안내한다. 초기 구현은 아래 실제 인터페이스·데이터 정정과 구현 범위 문서에 연결한다.

모델 미설치·중단·잘못된 출력에서는 원문·직접 편집·기존 연습을 유지한다. 외부 클라우드로 자동 전환하거나 런타임에서 모델을 자동 내려받지 않는다. 최초 모델 다운로드·운영 장비 준비는 별도다. 사용자 입력·모델 출력을 명령으로 실행하지 않는다.

## 4. 처리 규칙

### 4.1 시간 범위

현재: `targetSec`와 대칭 허용 오차 `toleranceSec`를 사용한다. 화면 정수 초를 기준으로 초과·미달·같음·허용 범위 안을 계산한다.

계획: `minSec ≤ targetSec ≤ maxSec`인 목표 조건을 저장한다. 최소·최대 경계는 범위에 포함한다. `actualSec < minSec`는 미달, `actualSec > maxSec`는 초과다. “발표가 짧을수록 좋다”는 판정을 하지 않는다.

### 4.2 개인 속도와 시간 추정

현재 한국어 속도는 인식된 완성형 한글 음절 수/시간이며, 영어·숫자를 읽었을 때의 실제 발음 길이를 충분히 나타내지 못한다. 인식 결과의 수신 시각은 정확한 단어 타임스탬프가 아니다.

계획은 다음 순서로 구현한다.

- 구간별 실제 소요 시간과 전사·대본의 대응 상태를 저장한다. 누락·불확실 구간은 사용자가 교정할 수 있게 한다.
- 초기 추정은 비교 가능한 같은 구간의 실제 시간과 수정 전후 발화 길이 비율을 사용하고 계산 근거를 표시한다.
- 보유 자료가 부족하거나 수치·영어·긴 쉼 등으로 오차가 큰 구간은 “예상 불가/검증 필요”로 표시한다.
- 실측 자료가 여러 개 쌓이면 조건이 같은 구간의 분포를 보여 준다. 한 번의 측정을 통계적 신뢰 구간으로 포장하지 않는다.
- 수정 대본이 예상 범위에 들더라도 마지막 전체 연습으로 확인한다. 특정 예측 알고리즘의 정확도는 검증 전 수치로 보증하지 않는다.

### 4.3 수정·보존 검사

- 쉬운 말 수정은 시간 실측 없이 사용할 수 있다. 낯선 전문 용어는 필요한 원어를 남기고 풀이를 덧붙인다. 짧은 문장이 전문적 의미·한계·조건을 삭제하지 않도록 확인한다.
- 필수 항목은 단순 단어 목록이 아니라 의미·근거 문장·수치·단위·조건을 가질 수 있다.
- 초과 시 삭제 후보를 필수/선택 내용과 연결한다. 필수 항목 삭제는 자동 적용하지 않는다.
- 미달 시 사용자가 준 근거·예시만 활용한다. 자료가 없으면 “어떤 근거를 보완할지”를 제안하고 사실을 생성하지 않는다.
- 수정안은 원문과 나란히 표시하고 `pending → accepted/rejected` 상태를 가진다. 적용은 새 버전을 생성한다.
- 보존 검사는 `preserved / missing / changed / uncertain`을 구분하고 원문·수정문 위치를 남긴다. AI 출력만으로 사실의 진위를 인증하지 않는다.

### 4.4 재연습 비교

현재 비교 키: 목표 시간과 구간 이름·시간 계획의 문자열. 같은 조건의 최근 이전 기록을 선택한다.

확장 비교 키: 프로젝트 ID, 목표 범위 버전, 필수 항목 집합 버전, 구간 ID, 전체/부분 연습 구분, 분석 방식·버전. 대본 버전은 다를 수 있으며, 비교 화면에 바뀐 문장과 버전을 표시한다.

목표·필수 항목이 바뀌면 측정값을 참고용으로 나열할 수는 있지만 동일 조건 개선 판정은 하지 않는다. `resolved / unresolved / uncertain`은 자동 분석 상태이고 `confirmed / dismissed / unreviewed`는 사용자 확인 상태로 별도 저장한다.

### 4.5 원인 질문과 조건 시험

F13은 `observationPending → confirmed/corrected/dismissed`와 `unasked → userReported/unknown/skipped`를 별도로 기록한다. 자동 인식만으로 원인을 채우지 않는다. 기본 질문 상한은 항목당 3개이며, 답을 모르면 종료·옵션 선택으로 이동한다. 상세 문구는 [코칭 설계](coaching-design.md)를 따른다.

F14는 `proposed → selected → applied → rehearsed → reviewed` 흐름이고 어느 단계에서나 거절·되돌리기가 가능하다. 화면 단서와 사용자 대본을 분리 저장하고 선택하지 않은 원문을 덮어쓰지 않는다. 적용 전후 조건을 기록한다. 도움 없는 조치를 계속 강요하지 않는다.

F11의 일반 회차 비교와 조건 시험을 구분한다. 조건 시험의 선택 조치는 의도한 차이이며 `interventionDifference`로 표시한다. 나머지 차이는 `confounds`로 남긴다. 구간·분석 버전·발화 자료가 비교 가능할 때만 빈도를 대조한다. 횟수와 분석 가능한 녹음 초를 보존하고 분당 빈도는 `count / analyzedSeconds * 60`으로 계산한다. 자료가 없으면 0이 아닌 미측정이다. STT가 군말을 제거할 수 있으므로 사용자 교정 여부와 품질 상태를 표시한다.

질문 분기(F13):

| 단계 | 입력 | 다음 상태 | 질문 수 누적 |
| --- | --- | --- | --- |
| 관찰 확인 | 맞음 | 상황 질문 | 0 |
| 관찰 확인 | 잘못 인식함 / 전사 누락 추가 | 교정 저장 → (누락 추가는) 상황 질문 또는 종료 | 0 |
| 관찰 확인 | 자연스러운 표현·문제 아님 | `dismissed`, 질문 없음 | 0 |
| 상황 질문 “이 순간 어떤 점이 어려웠나요?” | 구체적 상황 | 조치 제안 | 1 |
| 〃 | 긴장 언급 | 걱정 구체화 질문 | 1 |
| 걱정 구체화 “그때 어떤 점이 걱정됐나요?” | 구체적 걱정 | 조치 제안 | 2 |
| 〃 | 모호한 답 | 보조 선택지 1회 | 2 |
| 보조 선택지 | 선택 / 모르겠음 | 조치 제안 / 일반 옵션 | 3(상한) |
| 어느 단계든 | 모르겠음·건너뛰기·중단 | `unknown`/`skipped`, 일반 옵션 또는 그대로 연습 | 유지 |

`trialOutcome`은 improved/noClearChange/worse/uncertain으로 기록하며, 시간·내용·부담의 세부값을 보존한다. 사용자 설명과 시험 결과가 맞아도 원인 확정 필드를 만들지 않는다. 부담 응답은 선택 사항이다. 실제 발표에서 사용할 수 없는 단서는 줄이거나 제거한 전체 연습을 별도로 연결한다.

### 4.6 기록의 네 가지 구분

| 구분 | 의미 | 예 | 만드는 주체 | 저장 규칙 |
| --- | --- | --- | --- | --- |
| `observation` | 측정·재생·사용자 교정으로 확인한 관찰 | 0:42–0:51에 “음” 3회, 사용자 확인 `confirmed` | 분석 규칙 + 사용자 확인 | 측정 근거·분석 버전·교정 여부를 함께 저장 |
| `userReport` | 사용자가 설명한 당시 상황 | “다음 문장을 잊어버릴까 봐요” | 사용자 | 원문은 로컬, 요약은 사용자 확인 후 저장. 인과 확정 아님 |
| `hypothesis` | 아직 확인되지 않은 해석 | “다음 구간 첫 문장이 있으면 덜 막힐 수 있다” | 서비스 제안 또는 사용자 | 항상 미확인 상태로 표시, 시험과 연결 |
| `trialOutcome` | 조건 변경 후 관찰한 결과 | 핵심어 카드로 같은 구간 재연습, 분당 빈도·내용·시간·부담 | 분석 규칙 + 선택적 사용자 응답 | improved/noClearChange/worse/uncertain, 비교 제한 함께 저장 |

`observation` 없이 `userReport`나 `hypothesis`를 자동 생성하지 않는다. `trialOutcome`이 improved여도 `hypothesis`를 확정 원인으로 승격하지 않는다. 원문 대본(ScriptVersion)·수정안(Suggestion)·선택 조치(PracticeAdjustment)·연습 기록(Session)은 ID로 서로 연결해 어떤 조건에서 나온 결과인지 추적한다.

### 4.7 저장·전송·실패 처리(코칭)

- 저장: CoachingInquiry·PracticeAdjustment·ConditionTrial은 브라우저 IndexedDB에 저장한다. 저장 실패 시 현재 화면에 임시 보관 중임을 알리고 원문 대본·기존 세션을 건드리지 않는다.
- 전송: 상황 질문 답변·걱정의 원문은 기기에 보관한다. 자체 모델이 필요한 과업에서는 사용자가 요청한 최소 텍스트·요약과 처리 위치를 안내하고 자체 서버로 보낸다. 외부 AI 제공자 전송·자동 대체는 금지한다. 모델 없이도 질문 건너뛰기·직접 편집·기본 연습이 가능해야 한다.
- 내보내기: 답변 원문은 F12 기본 내보내기에서 제외하고, 사용자가 고른 요약만 포함한다.
- 적용: 사용자가 조치를 선택하지 않으면 대본·화면을 바꾸지 않는다. 적용 전 미리보기를 보이고 적용·거절·되돌리기를 지원한다. 되돌리면 `beforeSettings`로 복원하고 이력을 남긴다.
- 실패: 단서 생성 자료 부족(원문 대본 없음)이면 사용자가 직접 핵심어를 입력하거나 다른 옵션을 고르게 한다. 원문에 없는 사실을 단서에 추가하지 않는다. 재연습 분석 실패 시 `uncertain`으로 두고 0회로 기록하지 않는다.

### 4.8 대본 이해·숙지 교차 확인과 교차검증 (F15)

후보 구간 규칙(판정 아님): 같은 `sectionId`에서 ① 긴 침묵·반복이 있거나 ② 전사와 대본의 대응이 낮거나(건너뜀·크게 다른 발화) ③ 사용자가 직접 표시한 경우. 전사 품질이 낮으면 ②를 쓰지 않고 그 사실을 표시한다.

상태: `comprehension: unasked → understood / unsure / awkwardWording / skipped`. 응답이 없으면 `unasked`로 남기며 `notUnderstood` 같은 판정 상태는 두지 않는다. `understood`는 자기 말 설명·원문 기반 확인 질문으로 다시 확인해 `verification: unchecked → consistent / gapFound / skipped`로 별도 기록한다. `gapFound`는 “설명과 원문이 다른 부분”이며 거짓 응답이라는 뜻으로 쓰지 않는다. 다듬기 제안은 `Suggestion`을 재사용하고 `origin: comprehension`, `basis: userExplanation | sourceSummary | wording`을 기록한다.

교차검증 규칙:

| 비교 | 계산·판단 | 상태 값 |
| --- | --- | --- |
| 원문 ↔ 사용자 설명 | 필수 항목·핵심 개념 대조, 의미 차이는 근거 문장과 함께 표시 | match / missing / differs(확인 필요) / uncertain |
| 원문 ↔ 수정안 | F10 보존 검사 그대로 | preserved / missing / changed / uncertain |
| 수정안 ↔ 재연습 발화 | 구간 대응·차이 표시, 그대로 읽음/자기 말로 전달 구분은 사용자 확인 | aligned / paraphrased / divergent / uncertain |
| 이전 ↔ 재연습 | 같은 구간의 긴 침묵·반복·시간, 분석 가능 길이 | improved / noClearChange / worse / uncertain |

비교 조건이 다르면(구간·분석 버전·부분/전체) 비교 제한을 표시한다. 사용자 설명과 원문이 다를 때 원문 오류일 가능성도 있으므로 어느 쪽도 자동 수정하지 않는다. 외부 AI가 다듬기를 만들면 보낼 범위는 해당 구간 원문과 사용자가 확인한 설명 요약으로 제한하고, 실패·취소 시 원문과 기존 결과를 보존한다.

## 5. 데이터 설계

| 객체 | 주요 필드 | 상태 |
| --- | --- | --- |
| Session | id, createdAt, settings, conditionKey, totalSec, result, marks, sectionRows, media, transcript, analysis, audioBlob, videoBlob, notices | 현재 IndexedDB sessions에 저장 |
| Project | id, title, targetRangeVersionId, activeScriptVersionId | 계획 |
| ScriptVersion | id, projectId, parentVersionId, createdAt, sections[{id,text}], acceptedSuggestionIds | 계획·원문 불변 |
| RequiredContent | id, projectId, versionId, statement, sourceSectionId, evidenceText, protectedFacts | 계획 |
| TargetRange | id, minSec, targetSec, maxSec, sectionBudgets, changedAt | 계획 |
| ReviewIssue | id, sourceSessionId, sectionId, type, startSec, endSec, evidence, analysisVersion | 계획·기존 검토 항목 확장 |
| Suggestion | id, baseScriptVersionId, issueIds, before, after, reason, expectedDuration, status | 계획 |
| ContentCheck | requirementId, scriptVersionId/sessionId, status, evidenceSpans, uncertaintyReason | 계획 |
| RehearsalComparison | previousSessionId, currentSessionId, conditionsMatch, differences, issueResults, humanReviewStatus, trialId, interventionDifference, confounds | 계획 |
| CoachingInquiry | id, issueId, observationStatus, correctedEvidence, questionCount, answers, userReportSummary, causeStatus, userConfirmed, skipped | 계획·원인 확정/감정 자동 판정 없음 |
| PracticeAdjustment | id, inquiryId, type, sourceSectionIds, cueText, beforeSettings, afterSettings, userSelected, revertedAt, realPresentationConstraints | 계획·원문 별도 보존 |
| ComprehensionCheck | id, sessionId, sectionId, scriptVersionId, candidateReasons, aiAuthoredFlag(사용자 선택), comprehension, verification, checkQuestions[{question, sourceSpan, answerLocal, result}], userExplanationLocal, explanationSummary, crossCheck{sourceVsExplanation, sourceVsSuggestion, suggestionVsSpeech, beforeVsAfter}, suggestionIds, rehearsalSessionId | 계획·이해 여부 자동 판정 없음, 설명 원문 로컬 |
| ConditionTrial | id, adjustmentId, baselineSessionId, trialSessionId, controlledConditions, confounds, fillerCount, analyzedSeconds, contentResults, durationResults, optionalBurdenResponse, outcome, userReview | 계획·단일 회차의 인과 확정 금지 |

원본 녹음은 사용자 브라우저 보관을 기본으로 한다. 버전 마이그레이션 실패 시 기존 세션을 덮어쓰지 않는다. 보관 기간·크기 한도는 장치 시험 후 정하고, 임의로 오래된 기록을 자동 삭제하지 않는다. 비밀키는 어떤 저장 객체에도 포함하지 않는다. CoachingInquiry 답변 원문은 기본 로컬 보관하며 자체 서버 처리·내보내기에 자동 포함하지 않는다. 삭제 요청 시 연결된 답변·요약·시험도 포함할 범위를 보여 주고 삭제 여부를 확인한다.

## 6. 인터페이스 설계

| 경로 | 현재 여부 | 목적·규칙 |
| --- | --- | --- |
| `GET /`, `/js/*`, `/styles.css` | 구현 | 정적 웹 화면·리소스 |
| `GET /__health` | 구현 | status, releaseId. 실제 배포 SHA 주입 여부는 배포 시 별도 검증 |
| `POST /api/transcribe` | 구현(F16) | 사용자가 글자 변환을 켠 파일의 WAV 조각을 loopback 자체 worker로 중계. 503/415/413/429/502 구분. 실제 사람 음성 품질 미검증, 상세는 [import-feature.md](import-feature.md) |
| `POST /api/revisions` | 계획 | 자체 모델로 쉬운 표현 또는 시간 조정 제안. sourceIds·baseVersionId·requestId·근거·변경 의심 반환 |
| `POST /api/content-checks` | 계획 | 제공 근거와 수정문/발화의 일치 검사. 항목 ID별 상태·근거 반환 |
| `POST /api/script-rephrase` | 계획 | F15: 해당 구간 원문·사용자 설명 요약·다듬기 유형으로 자연스러운 말투 제안 생성. 사용자가 전송을 선택한 경우만 호출, 원문에 없는 사실 추가 금지 |

| `POST /api/concepts` | 계획 | 대본·자료의 개념 후보, 실제 원문 인용·근거 ID |
| `POST /api/explanations` | 계획 | 본인 설명의 근거 충족·보완 필요·판단 불가·미응답. 정서·지능 판정 없음 |
| `POST /api/questions` | 계획 | 제공 자료로 답할 수 있는 질문·기준 근거·답변 검토 |
| `GET /api/model-status` | 구현 | 자체 모델 준비·처리 위치·alias·프롬프트 버전·미설정 상태. 비밀값·실제 파일 경로 제외 |
| `POST /api/coach` | 구현 | concepts/rewrite/question/review, 버전·요청 ID·모델 alias·프롬프트 버전·처리 시간·근거 결과 |

계획 API의 최소 규칙: 입력 오류 400, 크기 초과 413, 동시 처리·자원 한도 429, 모델 미준비 503, 잘못된 모델 응답 502, 지연 504. 사용자에게 이유와 복구 행동을 보여 주고 원문을 보존한다. 응답에는 requestId·baseVersionId·sourceVersionId·modelRevision·promptVersion·근거를 연결한다. 내부 서버 주소는 운영자 설정만 허용하며 요청에서 임의 외부 URL을 받지 않는다. 개별 revisions/content-checks/concepts/explanations/questions 경로는 설계이며 현재 /api/coach의 task로 묶어 구현했다. 기존 Gateway 키는 새 자체 AI 방식에 필요하지 않다.

## 7. 상태 전이와 예외

```text
준비 → 권한 확인 → 연습 중 ⇄ 일시정지 → 종료·분석 → 결과
                                분석 실패 ─────────→ 측정 가능한 결과만 표시
결과 → 수정 제안 생성 → 검토 → 새 대본 버전 → 부분 재연습 → 전체 재연습
          실패/취소 ─→ 원문·기존 결과 유지
결과 → 관찰 확인 → 상황 질문(선택) → 연습 조건 선택 → 적용·재연습 → 변화 확인
          오탐/건너뛰기 ─→ 기존 연습 계속       거절/되돌리기 ─→ 이전 조건 유지
결과 → 이해 확인 질문 → 응답 분기(이해함/모르겠음/어색함) → (이해함이면) 자기 말 설명·확인 질문 교차검증 → 대본 다듬기 제안 → 선택·새 버전 → 재연습 → 4열 교차검증
          건너뛰기 ─→ 기존 결과           거절/되돌리기 ─→ 원문 유지
```

| 상황 | 사용자에게 보일 상태 | 복구 |
| --- | --- | --- |
| 마이크/카메라 거부 | 기록하지 않는 항목과 이유 | 시간만 측정, 설정에서 재선택 |
| 전사 실패 | 속도·반복·내용 검사 중 불가능한 항목 | 재연습 또는 전사 교정. 시간 기록 유지 |
| 음성 거의 없음 | 신호 부족 | 입력 장치 확인. 좋은 점수로 처리하지 않음 |
| 저장 공간 부족 | 현재 화면 임시 보관·닫으면 손실 가능 | 선택 내보내기/사용자 삭제, 원본 자동 삭제 금지 |
| AI 요청 지연·실패 | 미완료·재시도/취소 | 기존 결과 보존, 재시도 중복 추론·자원 점유 방지 |
| 분석 중 원문 변경 | 이전 버전의 응답 | 새 버전에 자동 적용하지 않고 재요청 |
| 필수 내용 변경 의심 | 변경 문장·원문 근거·확인 필요 | 사용자가 수정하거나 제안 거절 |
| 연습 조건 불일치 | 비교 제한과 바뀐 조건 | 같은 조건으로 전체 재연습 |
| 원인 미확인·질문 건너뛰기 | 미확인 유지 | 일반 옵션 선택 또는 그대로 연습 |
| 관찰 오탐·자연스러운 표현 | 교정·제외 | 해당 지적·원인 질문을 강제하지 않음 |
| 조건 변경 효과 없음·악화 | 변화·부담·제약 표시 | 되돌리기 또는 다음 옵션 선택 |

## 8. 구현 차이와 의존성

| 항목 | 현재 차이 | 해결 의존성 |
| --- | --- | --- |
| 프로젝트/대본 개념 | 새 페이지에 작업 1개·자료·버전 구현 | F7 다중 프로젝트·필수 항목·녹음 자동 연결 후속 |
| 시간 범위 | 목표±오차만 존재 | F8 입력·판정·호환 처리 |
| 정확한 발화 대응 | 인식 수신 시각 기반 근사 | 전사 교정·구간 대응·실제 음성 검증 |
| 자동 대본 수정 | 자체 모델 쉬운 말 수정 구현, 시간 확장 미구현 | R1 F7·F9–F10·F17–F18·F20. 시간 확장은 R3 F8 |
| 내용 보존 | 수치 차단·표현 경고·사용자 확인 구현, 완전한 의미 비교는 없음 | 필수 항목·근거 모델·검증 세트 |
| 항목별 재점검 | 답변 최근 두 개·도움·조건 차이 비교 구현, 녹음 연결 후속 | R2 F18–F19·F11·F13–F14, 근거·도움 여부·조건 기록 |
| 상황·원인 질문 | 측정값만 있고 질문 흐름 없음 | F13, 재생 확인·사용자 교정·선택권 |
| 연습 조건 시험 | 단서 생성·조건 버전·시험 비교 없음 | F14 및 F11 확장, 실제 사용자 과업 검증 |
| 대본 이해 교차 확인 | 대본·구간 대응·이해 질문·다듬기·교차검증 없음 | F7 대본, 전사-대본 대응, F9–F10, 외부 AI 전송 안내 |
| 저장·삭제 실패 | 저장 안내 존재, 삭제 결과를 화면에서 확인하지 않음 | 오류 전달·재시도 UX·실제 저장소 시험 |
| 운영 검증 | 단위 40개(`9d2a10b`) 및 기존 Docker·health·S1–S4 CI 4개 성공 확인 | 실제 장치·미디어 별도 검사·신규 기능·공개 배포 검증 |

개발 우선순위는 [기획서](product-plan.md), 완료 판정은 [검증 계획](validation-plan.md), 연결표는 [추적표](traceability.md)를 따른다.

## 추가 구현 F21·F16

`video-analysis.js`는 고정 로컬 MediaPipe를 로드하고 영상 프레임을 순서대로 읽는다. `blinks.js`는 DOM과 분리된 계산, `fillers.js`는 전사 토큰 후보 계산, `measurement-ui.js`는 기존 결과에 두 측정 카드를 추가한다. app.js는 카드 연결만 추가한다. 영상·원시 얼굴 좌표를 서버로 보내지 않는다.

`session.analysis.blink`에 기준 버전·집계·관측률·구간·검토 항목을, `session.analysis.transcript.fillers`에 후보 종류·횟수·위치를 저장한다. 원시 프레임·랜드마크는 보관하지 않는다. 기존 저장 세션에 필드가 없으면 미측정으로 표시하고 영상을 재분석할 수 있다. 세부 규칙·상태·예외는 [측정 명세](media-measurements.md)를 따른다.


## 새 데이터·판단 규칙 — F17–F20 (계획)

| 객체 | 핵심 필드 | 규칙 |
| --- | --- | --- |
| SourceMaterial | id, versionId, title, origin, paragraphs[{id,text}] | 대본과 별도. 사용자 제공 사실이며 자동 검증 완료 아님 |
| Concept | id, scriptVersionId, sourceVersionId, spans, evidenceIds, proposedExplanation, userStatus | 원문 위치·인용 실제 존재 검사. userStatus: 낯섦/알고 있음/제외 |
| ExplanationAttempt | id, conceptId, questionId, answerText, helpUsed, supportStatus, coveredClaims, missingClaims, conflictingClaims, evidenceSpans, humanReview | 근거와 부합/보완 필요/판단 불가/미응답. 능력 점수·정서 필드 없음 |
| QuestionPractice | id, conceptIds, sourceIds, prompt, referenceClaims, answerAttemptId, equivalenceGroup, helpUsed | 기준 답은 초기 숨김. 근거 없는 질문은 추가 자료 필요 |
| ModelRun | id, task, requestId, baseVersions, modelRevision, quantization, runtimeVersion, promptVersion, durationMs, resultStatus | 민감한 본문 로그 없음. 모델 원문과 검증 통과 결과 구분 |

새 설명은 근거와 비교하되 비슷한 단어를 썼다는 이유만으로 이해 완료로 처리하지 않는다. 자료의 수치·조건·부정과 모순되면 해당 문장·근거를 보여 주고 다음 한 가지를 보완하도록 제안한다. 자료가 부족하거나 모호하면 판단 불가다. 긍정적 표현은 정확성을 희생하지 않는다.

후속 질문 상한은 F13·F18에서 같은 검토 항목을 공유할 때 합산 3개다. 별도 과업으로 선택한 질의응답 연습은 기본 한 번에 최대 3문항이며 추가 연습은 사용자가 시작한다. “모르겠음/설명받기”에는 단계별 시도를 강요하지 않는다. 질문·자료·원문·답변은 모델 지시문으로 실행하지 않는다.

근거 인용 검사는 존재 여부 검증이다. 명제의 사실성이나 논리적 타당성, 학습 효과는 자동 인증하지 않는다. 사용자 설명과 시험 결과가 좋아졌다고 군말의 원인이 이해 부족으로 확정되는 것도 아니다.


## 실제 구현 인터페이스·데이터 정정

위 확장 경로는 목표 설계이며 현재는 `POST /api/coach`의 concepts/rewrite/question/review 분기로 묶었다. 상태는 `GET /api/model-status`, 전사는 같은 `POST /api/transcribe`에서 자체 worker를 호출한다. Gateway 호출과 키 읽기는 제거했다. 브라우저 실시간 음성 인식도 비활성화했다.

현재 데이터는 별도 IndexedDB의 workspace에 script/sources/versionId/versions/attempts/question/concept/helpUsed/followups로 보관한다. Project·RequiredContent·ConditionTrial 등 전체 객체를 구현한 것은 아니다. 실제 필드·제약·오류와 단계별 미구현 범위는 [구현 범위](local-ai-implementation.md)에 기록했다.

## 생성·코칭의 분리 인터페이스

`GET /api/scripts/generation-status`는 생성 서비스, `GET /api/model-status`는 자체 AI 상태를 반환한다. 새 대본 요청은 task=generate·topic·sources·requestId·versionId만 허용한다. 생성 결과의 title·script·notes를 길이·형식 검사 후 사용자 검토 초안으로 반환한다. Gemini의 실패 상태·한도는 생성 서비스에만 적용한다.
