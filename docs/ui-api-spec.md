# 다시봄 UI·API 명세서

기준일: 2026-10-29, commit `5fcd25d` 이후의 **구현된 화면과 인터페이스**를 적는다. 계획 API(`/api/revisions` 등)와 데이터 객체는 [요구사항 분석서 5–7장](requirements-analysis.md)에, 영상 불러오기의 `/api/transcribe` 상세는 [영상 불러오기 문서](import-feature.md)에 있다. 이 문서는 화면을 만지거나 E2E를 쓰는 사람이 **버튼 이름·상태·데이터 모양**을 확인하는 용도다.

## 1. 화면 지도

| 경로 | 화면 | 파일 |
| --- | --- | --- |
| `/#/` | 메인(온보딩 → 한 화면: 녹화·대본·결과) | `public/index.html`, `public/js/app.js` |
| `/#/result/:id` | 저장된 연습 다시 보기(메인 화면에 결과만 채움) | 같음 |
| `/#/history` | 연습 기록 목록 | 같음 |
| `/import.html` | 영상·소리 파일 불러오기 | `public/import.html`, `public/js/import-page.js` |
| `/studio.html` | 다시봄 스튜디오: 대본 준비 → 웹캠 연습 → 결과 분석 → AI 코칭 → 대본 수정 → 다시 연습(1.2절) | `public/studio.html`, `public/js/studio-page.js`, `public/studio.css` |

스타일은 `public/nocturne.css`(디자인 시스템 토큰·공통 클래스)와 `public/styles.css`(화면 배치)다. 색·간격·모서리는 `var(--color-*)`, `var(--space-*)`, `var(--radius-*)` 변수만 쓴다. 시간 상태 경고색만 `--warn`(임박), `--over`(초과)를 따로 둔다.

### 1.1 메인 화면 영역

```text
┌ appbar ──────────────────────────────────────────────────────────────┐
│ 다시봄 │ ●녹화 시작 │ 일시정지* │ 다음 구간* │ 녹화 종료 │ 분석 │ 목표 시간 [3분|5분|10분] 분·초 │ 상태 태그 3개 │ 영상 불러오기 · 연습 기록 · 사용 방법 │
├ workspace ───────────────────────────────┬───────────────────────────┤
│ stage: 웹캠 미리보기 / 재생 플레이어 / 안내 │ script-col: 대본           │
│   hud(녹화 중 시계·상태)                  │   핵심어 카드 · 진행 막대 · 대본 편집 │
│ stage-foot: [카메라|녹화 보기] 안내 문구   │   연습 구간 배너*          │
│ hud-details*(속도·구간 진행·기록 상태)     │   문장 목록 / 편집 textarea │
│                                          │   ▸ 연습 설정(details)      │
├ results ─────────────────────────────────┴───────────────────────────┤
│ 안내(empty) → 분석 후: [연습 전후 비교*] 연습 결과 · 구간별 시간* · 다시 볼 구간(타임라인+목록+질문 카드) · 인식된 글* · 이전 연습과 비교 · 버튼 │
└──────────────────────────────────────────────────────────────────────┘
* 조건부 표시
```

### 1.2 다시봄 스튜디오(`/studio.html`)

Figma Make 시안(dasibom-site, React)을 빌드 없이 쓰도록 ES 모듈로 옮긴 화면이다. 시안의 시연용 값은 모두 실제 기능으로 바꿨다. 메인 화면(`/`)과 E2E 시나리오(S1–S9)는 바꾸지 않았다.

| 단계 | 화면 | 연결한 기능·API |
| --- | --- | --- |
| 1 대본 준비 | 대본 입력·‘파일 불러오기’(교체 확인·취소), 근거 자료(2,400자), 목표 시간 3·5·10분, 카메라·마이크 선택(`enumerateDevices`, 권한 허용 뒤 이름 표시) | `POST /api/scripts/import`. 대본·근거·장치는 `localStorage dasibom.studio` |
| 2 발표 연습 | 웹캠 실시간 미리보기(좌우 반전, `video.live-video`), 녹화 시작·일시정지/계속·연습 종료, 경과·남은 시간(200ms 갱신), 마이크 입력 막대 | `MediaCapture.open({ audioDeviceId, videoDeviceId })` → `start({ recordVideo: true })`. 권한 거부·장치 없음이면 안내와 ‘카메라 연결’ 재시도, 시간만 재기 가능 |
| 3 결과 분석 | 녹화 영상 다시 보기(`video.playback-video`), 타임라인 마커·검토 구간 목록(누르면 해당 시점으로 이동), 발표 시간·평균 속도(음절/분)·긴 침묵, 측정 안내, 대본 위치 확인 카드 | 메인 화면 `analyze()`와 같은 순서: IndexedDB 저장 → `analyzeRecordedSpeech`(`/api/transcribe`) → 다시 저장. 이어서 `POST /api/scripts/align`. `matched`→“맞아요”(`user-confirmed`), 그 밖·다른 문장→직접 선택(`user-selected`) |
| 4 AI 코칭 | 구간 재생, 선택 문장 강조, 대화(선택지·직접 입력·모르겠어요·설명해 주세요·건너뛰기·취소), 후속 질문 n/3, 대화 요약 | `POST /api/coach/segment`(start → answer/unknown/explain/skip). 409 `history-mismatch`면 처음부터 다시 시작. 요약은 세션 `coaching[itemId]`에 저장 |
| 5 대본 수정 | 원문/수정안 비교, 직접 편집 → ‘편집 내용 검사’(`checkRevision`), 반영 내용·자료 근거·보존 검사, 바꾸고 싶은 점 선택(needs-confirmation) | `POST /api/scripts/revise-segment`(`request.explicit: true`). `blocked`면 적용 막음. 적용 전 `apply.baseScriptVersionId`·`originalSha256`을 다시 확인하고 대상 문단만 바꾼 새 대본 버전을 만든다(원본 버전 보존) |
| 6 다시 연습 | 수정 문단만 웹캠으로 부분 연습 → 이전/이번 영상 나란히, 구간 시간·긴 침묵·말하기 속도·군말 후보 표(`[data-testid=practice-compare]`) | 새 세션(`practiceOf` 포함) 저장. 이전 값은 원본 연습에서 이 문단에 연결된 전사 구간 시간(없으면 검토 구간 ±6초)의 `windowMetrics` 어림값 |

스튜디오 세션은 4.1절 세션 형식에 `scriptVersionId`와 `source: { kind: "studio" }`를 더해 저장하므로 `#/history`·`#/result/:id`에서도 보인다. 카메라는 2·6단계에서만 켜고 다른 단계로 가면 끈다.

## 2. 상태 기계

`state.phase`가 화면 전체를 결정한다. `busy()` = `starting | countdown | recording | saving`이며 이때 설정 입력·메뉴·온보딩 버튼이 잠긴다.

```text
idle ─녹화 시작→ starting ─(호흡 3초 조건)→ countdown ─→ recording ⇄ (일시정지: Practice.running=false)
                                                             │ 녹화 종료
                                                             ▼
                                                           saving ─→ recorded ─분석→ analyzed
analyzed ─구간 다시 연습→ idle (state.ctx 설정)      analyzed ─같은 조건으로 다시 연습→ idle
#/result/:id 진입 → analyzed(저장된 세션)            #/history → 기록 화면(phase 유지)
```

| 상태 | 상단 버튼 활성 | 가운데 | 아래 |
| --- | --- | --- | --- |
| idle | 녹화 시작 | 카메라 미리보기(또는 연결 안내) | "'녹화 시작'을 누르고…" 안내 |
| starting | 없음 | "마이크·카메라를 준비하고 있어요…" / "시선 추적을 준비하고 있어요…" | 안내 |
| countdown | 없음 | 큰 숫자 3·2·1 + "숨을 한 번 고르세요" | 안내 |
| recording | 일시정지·다음 구간(구간 계획 있을 때)·녹화 종료 | hud + hud-details | "녹화 중이에요…" |
| saving | 없음 | "녹화를 저장하는 중…" | 안내 |
| recorded | 분석 | 미리보기 | "녹화가 저장됐어요 (m:ss). '분석'을 누르면…" |
| analyzed | 녹화 시작 | [카메라\|녹화 보기] 전환(영상이 있을 때) | 결과 전체 |

카메라 상태 `state.media.cam`: `idle → connecting → ready | audio(마이크만) | failed`. `failed`여도 녹화 시작은 가능하며 시간만 잰다(주최 측 실행 환경 대응).
시선 상태 `state.gaze.status`: `idle → loading → ready | off`. 카메라가 `ready`일 때만 로드하고, 녹화 시작 전에 로드가 끝나길 기다린다.

## 3. 컴포넌트 명세 (이름은 E2E 셀렉터와 같다)

### 3.1 상단(appbar)

| 요소 | 접근성 이름 / id | 동작 |
| --- | --- | --- |
| 브랜드 링크 | "다시봄" → `#/` | busy면 `aria-disabled` |
| 녹화 시작 | button "녹화 시작", `#btn-start` | `startRecording()`. 입력 오류면 `.errors[role=alert]`에 목록 표시 |
| 일시정지 / 다시 시작 | button, `#btn-pause` | recording에서만. 이름이 번갈아 바뀜 |
| 다음 구간 | button "다음 구간", `#btn-next` | 구간 계획이 있을 때만. 모두 누르면 비활성 |
| 녹화 종료 | button "녹화 종료", `#btn-stop` | recording에서만 활성 |
| 분석 | button "분석", `#btn-analyze` | recorded에서만 활성. E2E는 `{ name: "분석", exact: true }` |
| 목표 시간 프리셋 | `.seg-btn` "3분"·"5분"·"10분", `aria-pressed` | 분·초 입력을 채움. 구간 연습 중엔 `tag` "구간 연습 약 m:ss"로 대체 |
| 분·초 입력 | `#f-tmin` aria-label "목표 시간 분", `#f-tsec` "목표 시간 초" | `localStorage`에 즉시 저장 |
| 상태 태그 | `[data-testid=cam-status]`, 시선, 음성 인식 | 문구: 카메라 대기 / 카메라 연결 중 / 카메라·마이크 연결됨 / 마이크만 연결됨 / 카메라·마이크 없음 · 시선 추적 꺼짐 / 준비 중 / 켜짐 / 사용 불가 · 음성 인식 지원 안 됨 / 켜짐 / 꺼짐 |
| 메뉴 | link "영상 불러오기" `/import.html`, link "연습 기록" `#/history`, button "사용 방법" | 사용 방법은 온보딩을 다시 연다 |

### 3.2 온보딩 (`main[aria-label="사용 방법"]`)

- 처음 방문(`localStorage dasibom.onboarded` 없음)이고 경로가 `#/`일 때만 자동 표시.
- 왼쪽 단계 버튼 4개(`aria-current="step"`), 오른쪽 카드에 "단계 n / 4"·제목·설명·시연 블록.
- 버튼: "건너뛰기", "이전"(1단계에서 비활성), "다음"/"시작하기"(4단계). 건너뛰기·시작하기 → `onboarded=1` 저장, 메인 표시, 카메라 연결 시작.

### 3.3 녹화 영역(stage)

| 요소 | 명세 |
| --- | --- |
| `video.stage-video` (미리보기) | `muted autoplay playsinline`, aria-label "웹캠 미리보기". 카메라 `ready`이고 재생 보기가 아닐 때 표시 |
| `video#player` / `audio#player` | 분석 뒤 생성. 영상이면 stage 안에, 소리만이면 stage-foot에. aria-label "연습 영상 다시 보기"/"연습 녹음 다시 듣기" |
| `.stage-empty` | 카메라 없음 안내 + button "카메라 연결"(재시도) |
| `.hud#panel` | `data-state="ok|warn|over"`, aria-label "녹화 중". 안: `#elapsed[data-testid=elapsed]`, `#remaining[data-testid=remaining]`("초과 +m:ss"), `#time-state[data-testid=time-state]`("시간 여유 있음"/"시간 임박"/"목표 시간 초과") |
| `.hud-details` (section "연습 중") | dl: 목표 시간, 말하기 속도 `#speed[data-testid=speed][data-state=slow|fast|ok]`, 구간 진행 `#pace`, 기록 상태 `#rec-status`("소리 기록 중 · 영상 기록 중" 등), 마이크 입력 meter. 음성 인식 켜면 `.live-text`에 마지막 인식 문장 |
| `[카메라 \| 녹화 보기]` | 영상 세션이 있을 때. `aria-pressed` |
| `#seek-status` | "재생 위치를 m:ss로 옮겼어요." |

시계는 200ms마다 갱신하고 **정수 초**로 표시한다. 일시정지 시간은 경과 시간·녹음에서 뺀다.

### 3.4 대본 영역(aside "대본")

| 요소 | 명세 |
| --- | --- |
| 조건 칩 | button "핵심어 카드", "진행 막대" (`.chip`, `aria-pressed`). 즉시 `localStorage` 저장 |
| 대본 편집 / 완료 | textarea aria-label "대본". 문장은 `splitSentences()`로 나눠 `ol.sentences > li[data-n]` 표시 |
| 핵심어 카드 켜짐 | 각 문장 대신 `keywordsOf()` 결과(최대 3낱말, " · " 연결) |
| 진행 막대 | 녹화 중 또는 구간 연습일 때 `.progress`: 채움 비율 = 경과/목표, "지금쯤 n번째 문장", 해당 `li.now` 강조 |
| 연습 구간 배너 | 구간 다시 연습 중: "연습 구간: a–b번 문장 · 목표 약 N초 · {구간 제목}" + button "전체 대본으로". 범위 밖 문장은 `li.dim` |
| 연습 설정(`details.settings`) | summary "연습 설정". 안: `#f-tol` 허용 오차(초), `#f-warn` 임박 알림(남은 초), `#f-smin` 최소(분당 음절), `#f-smax` 최대(분당 음절), `#f-plan` textarea(label "한 줄에 한 구간씩…"), checkbox `#f-video` "웹캠 영상도 기록…", checkbox `#f-speech` "음성 인식으로 말하기 속도·반복 표현 분석…"(지원 안 하면 disabled) |

### 3.5 결과 영역(results)

| 구역 | 접근성 이름 | 내용·testid |
| --- | --- | --- |
| 안내 | `.card.empty[role=status]` | 상태별 안내 문구(2장 표) |
| 연습 전후 비교 | region "연습 전후 비교" (구간 연습 결과일 때 맨 위) | `table[data-testid=practice-compare]` 행: 말 속도·군말·긴 침묵·시선 이탈 비율 (이전 / 다시 연습), 영상 2개 나란히(이전은 구간 −6초부터), button "두 영상 함께 재생", "연습 끝내기" |
| 연습 결과 | region "연습 결과" | `.stats` 타일: 총 연습 시간 `[data-testid=total]`, 목표 시간 `[target]`, 목표와의 차이 `[diff]`(`.tag[data-kind=over|early|within|exact]`), 평균 말하기 속도 `[avg-speed]`, 군말(음, 어), 긴 침묵(3초 이상), 시선 이탈 |
| 구간별 시간 | region "구간별 시간" | 구간 계획이 있을 때. 표 열: 구간·계획·실제·차이 |
| 검토할 구간 | region "검토할 구간" | h2 "다시 볼 구간 N곳", 범례, `.timeline`(마커 `button.mark.g0~g4`, 행=종류), `ul[aria-label="검토할 구간 목록"] > li[data-type]`(button `data-start`=초, "m:ss · 제목", 처리 상태 tag), 측정값/근거 문단, 질문 카드 `.qcard` |
| 인식된 글 | details "인식된 글 보기 (N개 조각)" | 음성 인식 세그먼트 |
| 이전 연습과 비교 | region "이전 연습과 비교" | `[data-testid=no-compare]` 또는 `table[data-testid=compare-table]`(항목·이전·이번·변화) |
| 버튼 | `#btn-again` "같은 조건으로 다시 연습", link "연습 기록 보기" | — |

검토 구간 종류(`item.type`)와 범례 행: `silence`→긴 침묵(g0), `repeat`·`filler`→반복·군말(g1), `gaze`→시선 이탈(g2), `speed`→속도 변화(g3), `section`→구간 시간(g4).

### 3.6 질문 카드(`.qcard[aria-label="질문"]`)

구간 버튼을 누르면 그 위치로 재생을 옮기고 카드가 열린다. 머리: tag "질문 n / 3", "m:ss · 제목", button "건너뛰기".

| 단계 | 질문 | 선택지 → 다음 |
| --- | --- | --- |
| 1 | "표시한 구간이 맞나요?" + 측정값 | "맞아요"→2 · "잘못 인식"→닫고 상태 저장 · "문제 아님"→닫고 저장 · "다시 재생" |
| 2 | "이 구간에서 어떤 일이 있었나요?" (시선 이탈이면 "이때 어디를 보고 있었나요? …") | `.chip` 선택지 `REASONS` = 다음 내용이 안 떠오름 · 시간 신경 쓰임 · 긴장 · 대본·메모를 봄 · 모르겠어요 · 직접 입력(input aria-label "직접 입력") → "다음"(이유 없으면 비활성) |
| 3 | "이렇게 다시 연습해 볼까요?" | `.suggest-opt`(`aria-pressed`) = `suggestFor(이유)` 조건(최대 2, 첫 번째가 기본 선택) → "이 구간 다시 연습" |

규칙: 질문은 최대 3개(`QUESTION_LIMIT`), 언제든 건너뛰기, "긴장"은 선택지 순서상 기본값이 아님, 원인을 자동 추정하지 않음. 처리 상태는 세션 `coaching[itemId] = { status: "건너뜀"|"잘못 인식"|"문제 아님"|"다시 연습함", reason, custom, picks }`로 저장되어 목록의 tag로 보인다.

"이 구간 다시 연습" → `state.ctx = { baseId, item, reason, conds, range, targetSec }` 설정, 조건 칩 적용(`keywords`/`progress`; `countdown`은 녹화 시작 전 3초), 상단 목표 시간이 "구간 연습 약 N초"로 바뀜. 다음 분석 결과는 `practiceOf`를 갖고 맨 위에 전후 비교가 뜬다. "전체 대본으로"/"연습 끝내기" → `ctx` 해제.

### 3.7 연습 기록(`#/history`)

표 열: 날짜·종류(전체 연습 / 구간 연습 · 제목 / 불러온 파일)·목표·연습 시간·목표와의 차이·[결과 보기 링크, 삭제→"정말 삭제" 2단계]. 비어 있으면 `[data-testid=no-sessions]`.

## 4. 브라우저 저장

| 키 (`localStorage`) | 내용 |
| --- | --- |
| `dasibom.settings` | `{ tmin, tsec, tol, warn, smin, smax, plan, video, speech, script, keywords, progress }` — 입력할 때마다 저장 |
| `dasibom.onboarded` | `"1"`이면 온보딩 자동 표시 안 함 |

IndexedDB `speech-coach` / store `sessions`(keyPath `id`)에 세션을 저장한다. 저장 실패 시 메모리에만 두고 결과 화면에 "기록을 이 기기에 저장하지 못했어요"를 알린다.

### 4.1 세션 객체

```ts
{
  id: "s-<base36>",  createdAt: number,
  settings: { targetSec, toleranceSec, warnSec, speedMin, speedMax, sections, planSignature, recordAudio, recordVideo, speechRequested, raw },
  conditionKey: "<targetSec>#<planSignature>" | "practice#<baseId>#<itemId>",
  totalSec: number, result: { diffSec, kind: "over"|"early"|"within"|"exact", label },
  marks: number[], sectionRows: [...],
  media: { audio: "ok"|"failed"|"off", video: "ok"|"failed"|"off", speech: "off"|"ok"|"no-text"|"unsupported"|"denied"|"error", speechDetail },
  analysis: {
    silence: { status, threshold, voicedRatio } | null,
    transcript: { status, totalSyllables, overallRate, ... } | null,
    fillers: { count, times: number[] } | null,            // 신규
    gaze: { status: "ok"|"off", segments: [{startSec,endSec}], offSec },  // 신규
    items: [{ id, type, title, startSec, endSec, basis, measured }],
  },
  script: string,                                           // 신규: 그때의 대본
  conds: { keywords, progress, countdown },                 // 신규: 적용한 연습 조건
  practiceOf: { baseId, itemId, title, startSec, endSec, reason, conds } | null,  // 신규: 구간 다시 연습이면
  coaching: { [itemId]: { status, reason, custom, picks } },// 신규: 질문 카드 답
  transcript: [{ startSec, endSec, text }],
  audioBlob: Blob|null, videoBlob: Blob|null, notices: string[],
  source?: { kind: "import", name, type, bytes },           // 불러오기 세션만
}
```

이전 세션(필드 없음)도 그대로 읽힌다. `gaze`가 없으면 "측정 안 됨"으로 표시한다.

## 5. 서버 API

| 경로 | 응답 | 비고 |
| --- | --- | --- |
| `GET /`, `/import.html`, `/js/*`, `/*.css` | 정적 파일, `Cache-Control: no-cache` | |
| `GET /vendor/mediapipe/*` | `vision_bundle.mjs`(JS), `wasm/vision_wasm_internal.{js,wasm}`(`application/wasm`), `face_landmarker.task`(octet-stream) | 시선 추적. 외부 CDN 없음 |
| `GET /__health` | `{ status: "ok", releaseId }` | |
| `POST /api/transcribe` | [영상 불러오기 문서](import-feature.md#서버-api-post-apitranscribe) | 키 없으면 503 |
| `POST /api/scripts/import` | `multipart/form-data`의 `file` 1개(TXT·PDF·DOCX, 10MB) → `{ fileName, text }`, 오류는 `{ error, message }`. [대본 파일 API 문서](script-import-api.md) | `/studio.html` 1단계에서 사용 |
| `POST /api/scripts/align` | 검토 지점 ↔ 대본 문장 후보. [문서](script-align-api.md) | `/studio.html` 3단계에서 사용 |
| `POST /api/coach/segment` | 사용자가 확인한 위치로 구간 코칭. [문서](segment-coach-api.md) | `/studio.html` 4단계에서 사용 |
| `POST /api/scripts/revise-segment` | 대상 문단 하나의 수정안. [문서](contextual-revision-api.md) | `/studio.html` 5단계에서 사용 |

공통 헤더: `Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; …`, `Permissions-Policy: microphone=(self), camera=(self)`. 인라인 `style` 속성은 막히므로 화면 코드는 `el.style.cssText`로 넣는다.

## 6. 브라우저 모듈 API

### `public/js/coach.js` — 질문·조건 규칙

| 내보냄 | 설명 |
| --- | --- |
| `QUESTION_LIMIT = 3` | 항목당 질문 상한 |
| `CONDITIONS` | `{ keywords, progress, countdown }` 각 `{ label, desc }` |
| `REASONS` | 질문 2 선택지 배열(순서 고정, 긴장은 3번째) |
| `suggestFor(reason) → key[]` | 이유별 조건 최대 2개 |
| `splitSentences(script) → string[]` | 마침표·물음표·느낌표 뒤 공백, 줄바꿈 기준 |
| `keywordsOf(sentence) → string` | 조사 제거 후 긴 낱말 3개, 원래 순서, " · " 연결 |
| `practiceRange({ sentences, item, totalSec, targetSec }) → { range: [i0,i1]|null, targetSec }` | 구간 중앙의 시간 비율로 문장을 어림잡아 앞뒤 1문장 포함, 목표 최소 10초 |
| `expectedSentence(elapsedSec, targetSec, range) → n` | 진행 막대용 현재 문장 번호 |

### `public/js/gaze.js` — 시선

| 내보냄 | 설명 |
| --- | --- |
| `isGazeOff(landmarks) → boolean` | 랜드마크 33·263(눈), 1(코), 152(턱)으로 yaw∉[0.28,0.72] 또는 pitch∉[0.1,0.64]이면 true. 얼굴 없으면 true |
| `class GazeTracker` | `status`, `load() → Promise<status>`(한 번만 로드, GPU 실패 시 CPU), `sample(video) → true|false|null` |

### `public/js/analysis.js` — 신규 함수

| 내보냄 | 설명 |
| --- | --- |
| `analyzeFillers(segments) → { count, times, items }` | 정규식 `^(음+|으+음*|어+|엄+|저기|뭐지|그니까)$` 후보를 8초(`FILLER_GAP_SEC`) 안에 묶음. 항목 앞뒤 1초 여유 |
| `analyzeGaze(samples, durationSec) → { status, segments, offSec, items }` | `samples=[{t, off}]`에서 off가 1.5초(`GAZE_MIN_SEC`) 이상 이어진 구간. 판단 표본 없으면 `status:"off"` |
| `buildReviewItems({ silence, transcript, sectionRows, toleranceSec, fillers, gaze })` | 기존 + 군말·시선 항목을 시간순 병합, `id` 부여 |
| `windowMetrics(session, from, to) → { rate, fillersPerMin, pauses, gazePct }` | 구간 안 측정값. 측정 못 하면 `null` |

### `public/js/recorder.js` — 변경

| 메서드 | 변경 |
| --- | --- |
| `MediaCapture.open({ audio, video, timeoutMs, audioDeviceId = "", videoDeviceId = "" })` | 장치 ID를 주면 그 장치를 선호로 연다(`exact` 아님: 장치가 빠지면 기본 장치). 없으면 기존과 같다 |
| `MediaCapture.start({ recordVideo = true })` | `false`면 카메라가 켜져 있어도 소리만 기록 |
| `MediaCapture.stop({ keepStream = false })` | `true`면 장치를 끄지 않고 미리보기 유지(메인 화면이 사용) |
| `MediaCapture.release()` | 장치 끄기 |

`storage.js`(`saveSession/getSession/listSessions/deleteSession`)와 `time.js`, `plan.js`는 변경 없음.

## 7. 외부 자원

| 자원 | 위치 | 라이선스 |
| --- | --- | --- |
| MediaPipe tasks-vision 0.10.14 (SIMD 빌드) + face_landmarker float16 | `public/vendor/mediapipe/` (약 13MB) | Apache-2.0 ([README](../public/vendor/mediapipe/README.md)) |
| Nocturne 디자인 시스템 CSS | `public/nocturne.css` | claude.ai/design 프로젝트에서 내보냄. 글꼴 `@import`는 CSP 때문에 제거 |

## 8. 검증 연결

| 검사 | 파일 | 범위 |
| --- | --- | --- |
| 단위 | `tests/coach.test.mjs`, `tests/analysis.test.mjs`, `tests/server.test.mjs` | 군말·시선·질문 규칙·범위·전후 수치·CSP·wasm MIME |
| 시나리오(장치 없음) | `e2e/scenarios/S1–S7, S9` + `e2e/fixtures/flow.ts` | 주최 측 실행과 같은 조건 |
| 장치(가짜 마이크·웹캠) | `e2e/media/*.spec.ts` (`media.config.ts`) | 침묵·속도·반복·시선 이탈·권한 거부·저장 실패·불러오기 |

## 9. 알려진 제한

- 시선은 눈동자가 아니라 얼굴 방향으로 어림잡는다. 대본·메모를 보는 자세도 이탈로 잡힌다.
- 구간 다시 연습의 문장 범위는 시간 비율 어림값이다(실제 발화↔대본 대응 아님).
- 시선 추적과 영상 녹화를 함께 켠 상태에서 드물게 영상 파일이 비어 저장되는 경우가 있다(Edge 5회 중 1회). 원인 조사 중.
- F14의 되돌리기·조건 이력·여러 회차 비교는 미구현. F7–F12·F15는 기획 단계.
