# 요구사항 추적표

## 2026-10-30 AI 처리 역할

새 대본 생성(F22)은 `/create-script.html`·`POST /api/scripts/generate`에서 Gemini 3.8 Flash로 처리한다. 사용자가 입력한 주제·근거 자료만 전송하며, 초안 확인 후 기존 기록을 보존한 새 버전으로 저장한다. 기존 대본의 개념 분석·쉬운 표현 수정·질문·답변 검토는 Qwen, 음성 전사는 faster-whisper로 처리한다. 자체 AI와 Gemini의 상태·실패는 독립적이며 자동 공급자 대체는 없다. API·설정은 [역할 분리 명세](gemini-coach.md)를 따른다.

## 2026-10-30 main 통합 상태

main의 다시봄 화면, TXT 불러오기, 구간 질문·조건 선택·재연습(S9), E2와 공개 조사 기록을 보존했다. 자체 AI 대본 코칭과 선택 전사, 영상 눈 깜빡임을 함께 제공한다. main의 F15는 대본 이해 교차 확인으로 유지하고, PR #3의 눈 깜빡임은 F21로 변경했다. 기존 문서의 미구현 표시는 당시 기록이며, 현재 상태는 이 절과 구현 범위 문서를 따른다. F13–F14 기본 흐름은 구현됐지만 전체 계획 수용 조건이 검증됐다는 뜻은 아니다.

**현재 구현 상태:** 자체 실행 텍스트 코칭과 음성 전사의 첫 구현이 추가됐다. 아래 전체 기획의 완료 조건과 구현된 부분은 [구현 범위](local-ai-implementation.md)에서 구분한다. 외부 AI Gateway와 브라우저 실시간 음성 인식은 제거/비활성화했다.


기준일: 2026-10-29. 기획→문제→기능→화면→검증을 같은 ID로 연결한다. B4(웹)·B5(문서 정합성) 및 비기능 요구는 전 기능에 적용한다.

| 기능 | 사업 요구 | 요구사항 | 완료 조건 | 화면 | 시나리오 | 검증 | 단계·상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | B2 | FR-01 | AC-01 | UI-01 | S1 | T01 | R0 / 코드 존재·실사용 검증 필요 |
| F2 | B2 | FR-02 | AC-02 | UI-02 | S2 | T02 | R0 / 코드 존재·실사용 검증 필요 |
| F3 | B2 | FR-03 | AC-03 | UI-02·UI-03 | S3 | T03 | R0 / 코드 존재·실사용 검증 필요 |
| F4 | B1 | FR-04 | AC-04 | UI-02·UI-03 | 장치 검증 | T04 | R0 / 코드 존재·실사용 검증 필요 |
| F5 | B1 | FR-05 | AC-05 | UI-03 | 구간 재생 검증 | T05 | R0 / 코드 존재·실사용 검증 필요 |
| F6 | B3 | FR-06 | AC-06 | UI-03·UI-04 | S4 | T06 | R0 / 코드 존재·실사용 검증 필요 |
| F7 | B3 | FR-07 | AC-07 | 대본 패널 ‘대본 편집’(TXT 불러오기), UI-05 | S5 | T07 | R1 / 대본 TXT·붙여넣기 입력·파일명 기록·재연습 연결 구현(`tests/script.test.mjs`, `e2e/media/script.spec.ts`), 필수 항목·버전·수정안 미구현 |
| F8 | B2 | FR-08 | AC-08 | UI-05·UI-03 | S5 | T08 | R1 / 계획·미구현 |
| F9 | B2·B3 | FR-09 | AC-09 | UI-06 | S6·S7 | T09 | R3 / 계획·미구현 |
| F10 | B3 | FR-10 | AC-10 | UI-06 | S6·S7 | T10 | R3 / 계획·미구현 |
| F11 | B1·B3·B6 | FR-11 | AC-11 | UI-07·10 | S8·S10 | T11 | R2 / 계획·미구현 |
| F12 | B3 | FR-12 | AC-12 | UI-08 | S8 | T12 | R3 / 계획·미구현 |
| F13 | B6 | FR-13 | AC-13 | UI-09 | S9 | T13 | R1 / 계획·미구현 |
| F14 | B6 | FR-14 | AC-14 | UI-10·07 | S10 | T14 | R2 / 계획·미구현 |
| F15 | B7 | FR-15 | AC-15 | UI-11·06·07 | S11 | T15 | R1(이해 확인)·R3(다듬기·교차검증) / 계획·미구현 |

| F21 | B1 | FR-21 | AC-21 | `/import.html`·UI-03 | 별도 미디어 흐름 | T21 | 구현 / 실제 얼굴 정확도 미검증 |
| F16 | B1 | FR-16 | AC-16 | `/import.html`·UI-03 | 별도 미디어 흐름 | T16 | 구현 / 실제 Gateway 미검증 |

코칭 흐름 세부 연결: 화면 상태는 [화면 명세 2.1](screen-spec.md), 검증 사례 C1–C14는 [검증 계획 4.1](validation-plan.md)에서 T11–T14에 연결된다. 기록 구분(observation·userReport·hypothesis·trialOutcome)과 저장·전송 규칙은 [요구사항 분석 4.6–4.7](requirements-analysis.md).

## 문서별 책임

| 문서 | 포함 내용 |
| --- | --- |
| [problem.yaml](problem.yaml) / [문제 캔버스](problem-canvas.md) | 상황·고객·원인·영향·대안·관찰·5 Whys·해법·통찰·기능 |
| [기획서](product-plan.md) | 대상·서비스 정의·제품 방향·범위·로드맵·성공 지표 |
| [코칭 설계](coaching-design.md) | 관찰 확인·상황 질문·조건 선택·시험·가상 대화·근거 구분 |
| [경쟁 분석](competitive-analysis.md) | 직접 확인·공식 설명·미확인·증거·차별화 결정 |
| [요구사항 정의](requirements-definition.md) | B/FR/AC/NFR, 입력·출력·예외·수용 기준 |
| [요구사항 분석](requirements-analysis.md) | 구조·데이터·API·판정 규칙·오류·구현 차이 |
| [화면 명세](screen-spec.md) / [실제 흐름](scenarios.yaml) | 현재 화면·S1–S4와 계획 화면·S5–S11 |
| [검증 계획](validation-plan.md) | T01–T15·사용자 검증·실행 증거·미검증 |
| [결정 기록](decisions.md) | 사용자 지시·근거 상태·기존 기록 보존·미확인 |
| [진행 기록](../progress.md) / [README](../README.md) | 현재 구현·실행 방법·검사·남은 일 |

F21–F16의 FR/AC·측정 규칙·저장 구조는 [측정 명세](media-measurements.md), T21–T16은 [검증 계획](validation-plan.md)에 연결한다. 주최 측 YAML·e2e/scenarios에는 새 흐름을 추가하지 않는다.


## 새 문제·초기 구현 연결

| 기능 | 사업 요구 | 요구·완료 조건 | 현재 화면·흐름 | 검증 | 현재 상태 |
| --- | --- | --- | --- | --- | --- |
| F7·F9·F10 | B7 | FR/AC-07·09·10 | UI-COACH NC1·NC2 | T07·09·10, 새 코칭 브라우저 검사 | 버전·쉬운 말·보조 검사 구현, 전체 필수 의미 판정은 후속 |
| F11·F12 | B3·B7 | FR/AC-11·12 | UI-COACH NC3 | T11·12 | 답변 비교·JSON 구현, 녹음 자동 연결·HTML은 후속 |
| F17 | B7 | FR-17 / AC-17 | UI-COACH NC1 | T17 | 개념·풀이·인용 초기 구현 |
| F18 | B7 | FR-18 / AC-18 | UI-COACH NC1·NC3 | T18 | 자기 설명·근거 대조 초기 구현, 품질 검증 필요 |
| F19 | B7 | FR-19 / AC-19 | UI-COACH NC3 | T19 | 질문 1개씩·답변 검토 구현, 동등 문항 검증 후속 |
| F20·F16 | B8 | FR-20 / AC-20 / NFR-11 | UI-COACH·UI-IMPORT | T20·T16 | 자체 LLM·전사 구현, 공개 운영·사람 음성 품질 미검증 |

위 표가 새 자체 AI 방향의 현재 상태이며 기존 R1–R3 행은 원래 목표 배치다. 현재 상세 갭은 [구현 범위](local-ai-implementation.md), 실행은 [local-ai/README](../local-ai/README.md). 주최 측 S1–S4와 YAML은 유지한다.

## F22 추적

| 기능 | 요구·완료 조건 | 화면 | 코드·검사 | 범위 |
| --- | --- | --- | --- | --- |
| F22 | FR-22 / AC-22 | UI-CREATE NC4 | script-generation.js·create-script-page.js·gemini-coach.test.mjs·coach-provider.spec.ts | 새 대본 생성·확인·원본 보존·자체 코칭 이동 |

F17–F20·F16은 자체 모델로 처리하며, F22만 외부 Gemini를 사용한다. 주최 측 S1–S4·S9와 scenarios.yaml의 흐름은 유지한다.

## 메인 전사 연결 검증

F16·FR-16·AC-16은 메인 분석과 파일 가져오기에서 동일한 자체 전사 API를 사용한다. `recording-analysis.js`·`tests/recording-analysis.test.mjs`가 짧은 녹음·선택 해제·서버 없음·부분 실패·취소를 검증한다. `e2e/media/main-transcription.spec.ts`는 메인 버튼→WAV 요청→군말·속도·재생 위치·재조회와 원본 보존을 검증한다. 주최 측 S1–S4·S9와 버튼 이름은 유지한다.

## 현재 제출 8개 흐름

S1 TXT 대본 저장·재조회와 시간 미달, S2 초과, S3 구간 차이, S4 이전 회차 비교, S5 자체 AI 쉬운 대본·의미 확인·새 버전·원문 복원, S6 자체 AI 개념·답변 검토·이력 보존, S7 자체 파일 전사·속도·군말·저장, S9 상황 확인·조건 변경·구간 재연습이다. 현재 계약은 scenarios.yaml과 같은 ID의 E2E 파일이며, 앞의 계획 단계 S번호는 당시 확장 계획으로 구분한다.
