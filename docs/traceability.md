# 요구사항 추적표

기준일: 2026-10-29. 기획→문제→기능→화면→검증을 같은 ID로 연결한다. B4(웹)·B5(문서 정합성) 및 비기능 요구는 전 기능에 적용한다.

| 기능 | 사업 요구 | 요구사항 | 완료 조건 | 화면 | 시나리오 | 검증 | 단계·상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | B2 | FR-01 | AC-01 | UI-01 | S1 | T01 | R0 / 코드 존재·실사용 검증 필요 |
| F2 | B2 | FR-02 | AC-02 | UI-02 | S2 | T02 | R0 / 코드 존재·실사용 검증 필요 |
| F3 | B2 | FR-03 | AC-03 | UI-02·UI-03 | S3 | T03 | R0 / 코드 존재·실사용 검증 필요 |
| F4 | B1 | FR-04 | AC-04 | UI-02·UI-03 | 장치 검증 | T04 | R0 / 코드 존재·실사용 검증 필요 |
| F5 | B1 | FR-05 | AC-05 | UI-03 | 구간 재생 검증 | T05 | R0 / 코드 존재·실사용 검증 필요 |
| F6 | B3 | FR-06 | AC-06 | UI-03·UI-04 | S4 | T06 | R0 / 코드 존재·실사용 검증 필요 |
| F7 | B3 | FR-07 | AC-07 | UI-05 | S5 | T07 | R1 / 계획·미구현 |
| F8 | B2 | FR-08 | AC-08 | UI-05·UI-03 | S5 | T08 | R1 / 계획·미구현 |
| F9 | B2·B3 | FR-09 | AC-09 | UI-06 | S6·S7 | T09 | R3 / 계획·미구현 |
| F10 | B3 | FR-10 | AC-10 | UI-06 | S6·S7 | T10 | R3 / 계획·미구현 |
| F11 | B1·B3·B6 | FR-11 | AC-11 | UI-07·10 | S8·S10 | T11 | R2 / 계획·미구현 |
| F12 | B3 | FR-12 | AC-12 | UI-08 | S8 | T12 | R3 / 계획·미구현 |
| F13 | B6 | FR-13 | AC-13 | UI-09 | S9 | T13 | R1 / 계획·미구현 |
| F14 | B6 | FR-14 | AC-14 | UI-10·07 | S10 | T14 | R2 / 계획·미구현 |
| F15 | B1 | FR-15 | AC-15 | `/import.html`·UI-03 | 별도 미디어 흐름 | T15 | 구현 / 실제 얼굴 정확도 미검증 |
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
| [화면 명세](screen-spec.md) / [실제 흐름](scenarios.yaml) | 현재 화면·S1–S4와 계획 화면·S5–S10 |
| [검증 계획](validation-plan.md) | T01–T14·사용자 검증·실행 증거·미검증 |
| [결정 기록](decisions.md) | 사용자 지시·근거 상태·기존 기록 보존·미확인 |
| [진행 기록](../progress.md) / [README](../README.md) | 현재 구현·실행 방법·검사·남은 일 |

F15–F16의 FR/AC·측정 규칙·저장 구조는 [측정 명세](media-measurements.md), T15–T16은 [검증 계획](validation-plan.md)에 연결한다. 주최 측 YAML·e2e/scenarios에는 새 흐름을 추가하지 않는다.
