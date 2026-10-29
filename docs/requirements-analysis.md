# 요구사항 분석서

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
  recorder.js  마이크·선택 영상 / 선택 브라우저 음성 인식
  wav.js       음성 샘플 변환·WAV 생성
  analysis.js  규칙 기반 침묵·반복·속도 변화·회차 비교
  storage.js   IndexedDB 저장, 실패 시 현재 실행 메모리 보관
  import-page.js / importer.js  (번호 미배정) 파일 소리 추출·조각 나누기·선택 글자 변환 요청
       │
       └─ Node 서버: public 파일, GET /__health, POST /api/transcribe(선택 시 AI Gateway 음성 인식 중계)
```

- 현재 서버에는 대본 수정 API, 코칭 질문 API, 데이터베이스, 로그인이 없다. AI 호출은 영상 불러오기에서 사용자가 글자 변환을 켰을 때의 음성 인식 중계뿐이다.
- 연습 녹음·영상·분석 결과를 우리 서버에 보관하는 경로는 없다. 글자 변환을 켜면 소리 조각(WAV)이 서버를 거쳐 외부 음성 인식으로 전달되며 서버는 저장하지 않는다고 코드·문서에 적혀 있다. 실제 배포 환경의 로그 처리는 미검증이다.
- 선택한 브라우저 음성 인식은 브라우저 제공 업체의 외부 처리일 수 있다. “모든 기능이 완전 오프라인”이라고 표현하지 않는다.
- 녹음·시간 측정 실패와 전사 실패는 구분한다. 전사 실패가 실제 발표 품질이 낮다는 뜻은 아니다.

## 3. 확장 설계

1. 프로젝트·대본 버전·필수 항목·목표 조건을 로컬에 저장한다.
2. 연습 결과에 해당 대본 버전과 목표 조건 버전을 연결한다.
3. 전사-대본 대응을 만들고 사용자에게 불확실한 대응을 확인시킨다.
4. 사용자가 외부 AI 처리를 선택하면 필요한 텍스트만 서버를 통해 보낸다. 원본 음성·영상은 기본 전송 대상이 아니다.
5. 서버는 구조화된 수정안과 내용 보존 검사 결과를 반환한다. 브라우저가 형식·버전 일치·필수 항목 ID를 검사한다.
6. 사용자가 선택한 제안을 새 대본 버전으로 저장하고 재연습에서 수정 항목을 대조한다.

결과에서 문장 수정으로 곧바로 이동할 필요는 없다. F13에서 관찰·사용자 설명을 확인하고 F14에서 조건 하나를 선택해 F11로 재연습한다. 초기 질문·조건 편집은 로컬 규칙으로 처리할 수 있다. 선택적 AI 제안의 전송·API는 별도 구현 전 현재 제공 기능으로 표기하지 않는다.

대본 수정용 AI 공급자·모델과 공개 배포 환경은 미정이다(영상 불러오기의 음성 인식 중계 설정과 별개). 외부 AI를 쓰기 전 전송 안내·동의, 비용 제한, 타임아웃, 입력 크기 제한, 요청 중복 방지를 구현한다. 사용자의 수정안 선택은 제품 동작이며 매번 채팅으로 승인을 받는 절차가 아니다.

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
- 전송: 상황 질문 답변·걱정의 원문은 외부로 보내지 않는 것이 기본이다. 외부 AI 처리(예: 단서 문장 다듬기)가 필요하면 전송할 최소 요약과 목적을 먼저 보여 주고 사용자가 선택할 때만 보낸다. 초기 질문·단서·조건 편집은 로컬 규칙으로 동작하며 외부 AI가 없어도 사용할 수 있다.
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

원본 녹음은 사용자 브라우저 보관을 기본으로 한다. 버전 마이그레이션 실패 시 기존 세션을 덮어쓰지 않는다. 보관 기간·크기 한도는 장치 시험 후 정하고, 임의로 오래된 기록을 자동 삭제하지 않는다. 비밀키는 어떤 저장 객체에도 포함하지 않는다. CoachingInquiry 답변 원문은 기본 로컬 보관하며 외부 전송·내보내기에 자동 포함하지 않는다. 삭제 요청 시 연결된 답변·요약·시험도 포함할 범위를 보여 주고 삭제 여부를 확인한다.

## 6. 인터페이스 설계

| 경로 | 현재 여부 | 목적·규칙 |
| --- | --- | --- |
| `GET /`, `/js/*`, `/styles.css` | 구현 | 정적 웹 화면·리소스 |
| `GET /__health` | 구현 | status, releaseId. 실제 배포 SHA 주입 여부는 배포 시 별도 검증 |
| `POST /api/transcribe` | 구현(번호 미배정) | 사용자가 글자 변환을 켠 영상 불러오기에서 WAV 조각을 AI Gateway로 중계. 503/415/413/429/502 구분. 실제 게이트웨이 호출 미검증, 상세는 [import-feature.md](import-feature.md) |
| `POST /api/revisions` | 계획 | 대본·필수 항목·시간 조건·실측 요약으로 제안 생성. baseVersionId와 requestId 반환 |
| `POST /api/content-checks` | 계획 | 제공 근거와 수정문/발화의 일치 검사. 항목 ID별 상태·근거 반환 |
| `POST /api/script-rephrase` | 계획 | F15: 해당 구간 원문·사용자 설명 요약·다듬기 유형으로 자연스러운 말투 제안 생성. 사용자가 전송을 선택한 경우만 호출, 원문에 없는 사실 추가 금지 |

계획 API의 최소 규칙: 입력 검증 실패 400, 크기 초과 413, 사용 한도 429, 외부 처리 실패 502/504. 사용자에게 복구 가능한 안내를 제공하고 원문을 보존한다. 실제 응답 코드·스키마는 구현 시 확정하고 테스트한다. AI_GATEWAY_API_KEY 같은 비밀값은 서버 환경에서만 읽는다. 계획 경로(`/api/revisions`, `/api/content-checks`)가 존재한다고 README에 안내하지 않는다.

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
| AI 요청 지연·실패 | 미완료·재시도/취소 | 기존 결과 보존, 재시도 중복 비용 방지 |
| 분석 중 원문 변경 | 이전 버전의 응답 | 새 버전에 자동 적용하지 않고 재요청 |
| 필수 내용 변경 의심 | 변경 문장·원문 근거·확인 필요 | 사용자가 수정하거나 제안 거절 |
| 연습 조건 불일치 | 비교 제한과 바뀐 조건 | 같은 조건으로 전체 재연습 |
| 원인 미확인·질문 건너뛰기 | 미확인 유지 | 일반 옵션 선택 또는 그대로 연습 |
| 관찰 오탐·자연스러운 표현 | 교정·제외 | 해당 지적·원인 질문을 강제하지 않음 |
| 조건 변경 효과 없음·악화 | 변화·부담·제약 표시 | 되돌리기 또는 다음 옵션 선택 |

## 8. 구현 차이와 의존성

| 항목 | 현재 차이 | 해결 의존성 |
| --- | --- | --- |
| 프로젝트/대본 개념 | 목표·구간 설정만 존재 | F7 데이터 모델·저장 마이그레이션 |
| 시간 범위 | 목표±오차만 존재 | F8 입력·판정·호환 처리 |
| 정확한 발화 대응 | 인식 수신 시각 기반 근사 | 전사 교정·구간 대응·실제 음성 검증 |
| 자동 대본 수정 | API·모델 없음 | F7–F8, 전송 안내, 서버 비용·실패 처리 |
| 내용 보존 | 의미 비교 없음 | 필수 항목·근거 모델·검증 세트 |
| 항목별 재점검 | 측정값 비교만 존재 | R2는 F13–F14·조건 기록·사용자 확인, R3에서 F9–F10 수정안까지 연결 |
| 상황·원인 질문 | 측정값만 있고 질문 흐름 없음 | F13, 재생 확인·사용자 교정·선택권 |
| 연습 조건 시험 | 단서 생성·조건 버전·시험 비교 없음 | F14 및 F11 확장, 실제 사용자 과업 검증 |
| 대본 이해 교차 확인 | 대본·구간 대응·이해 질문·다듬기·교차검증 없음 | F7 대본, 전사-대본 대응, F9–F10, 외부 AI 전송 안내 |
| 저장·삭제 실패 | 저장 안내 존재, 삭제 결과를 화면에서 확인하지 않음 | 오류 전달·재시도 UX·실제 저장소 시험 |
| 운영 검증 | 단위 40개(`9d2a10b`) 및 기존 Docker·health·S1–S4 CI 4개 성공 확인 | 실제 장치·미디어 별도 검사·신규 기능·공개 배포 검증 |

개발 우선순위는 [기획서](product-plan.md), 완료 판정은 [검증 계획](validation-plan.md), 연결표는 [추적표](traceability.md)를 따른다.
