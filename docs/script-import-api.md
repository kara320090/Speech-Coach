# 대본 파일 글자 꺼내기 API (`POST /api/scripts/import`)

기준일: 2026-10-29. 백엔드 구현 문서이며 프론트 화면 연결은 이 문서를 보고 프론트 담당자가 한다. 현재 화면(대본 패널 ‘대본 편집’의 TXT 불러오기)은 브라우저 안에서 TXT만 읽고 이 API를 부르지 않는다.

## 1. 요청

| 항목 | 값 |
| --- | --- |
| 주소 | `POST /api/scripts/import` (화면과 같은 서버·같은 주소. CORS·API 주소 설정 없음) |
| 형식 | `multipart/form-data` |
| 필드 | **`file`** — 파일 1개. 다른 필드 이름으로 보낸 파일이나 두 번째 파일은 오류 |
| 인증 | 없음(서비스에 로그인이 없음) |

## 2. 지원 형식과 제한

| 형식 | 확장자 | 확인하는 것 |
| --- | --- | --- |
| TXT | `.txt` | UTF-8만. BOM은 빼고 CRLF는 줄바꿈 하나로 바꾼다. EUC-KR·UTF-16은 `invalid-encoding` |
| PDF | `.pdf` | 글자 정보가 있는 PDF. 파일 머리 `%PDF-` 확인 후 실제로 해석한다. 한글 CID 글꼴용 CMap 포함 |
| DOCX | `.docx` | ZIP 형식 워드 문서. 문단은 빈 줄, 문단 안 줄바꿈은 줄바꿈, 표 칸은 탭으로 꺼낸다. 그림은 읽지 않는다 |

확장자는 대소문자를 가리지 않는다. 확장자로 형식을 고른 뒤 실제 파일 머리와 해석 결과로 다시 확인한다(예: 이름만 `.pdf`인 글 파일은 `corrupt-document`).

| 제한 | 값 | 넘으면 |
| --- | --- | --- |
| 파일 크기 | 10MB | 413 `too-large` |
| 요청 전체 크기 | 10MB + 64KB(멀티파트 머리 여유). `Content-Length`가 크면 읽기 전에 거절 | 413 `too-large` |
| 꺼낸 글자 수 | 200,000자(정리 후) | 422 `text-too-long` |
| PDF 페이지 수 | 300쪽 | 422 `too-complex` |
| 문서 하나 해석 시간 | 20초 | 422 `too-complex` |
| 해석 메모리 | 작업 스레드 힙 256MB | 422 `too-complex` |
| 동시 해석 | 2건 | 503 `busy` + `Retry-After: 5` |

제외: 스캔·이미지 PDF와 그림 글자 인식(OCR), 구형 `.doc`, HWP·PPTX 등 다른 형식.

## 3. 응답

### 성공 — `200`

```json
{
  "fileName": "발표대본.pdf",
  "text": "안녕하세요. 오늘은 ...\n둘째 줄입니다.\n\n새 문단입니다."
}
```

- `fileName`: 보낸 파일 이름(경로·제어 문자를 빼고 255자로 자름). 한글 이름 그대로.
- `text`: 줄바꿈은 `\n`. 문단 사이는 빈 줄 하나(`\n\n`), 3줄 이상 빈 줄과 줄 끝 공백은 줄인다. 앞뒤 공백은 뺀다.

### 오류 — 모두 같은 모양

```json
{ "error": "encrypted-pdf", "message": "암호가 걸린 PDF는 읽을 수 없어요. 암호를 해제한 PDF로 다시 보내 주세요." }
```

`message`는 화면에 그대로 보여 줄 수 있는 한국어 문장이다. 분기는 `error` 코드로 한다.

| HTTP | `error` | 상황 |
| --- | --- | --- |
| 400 | `file-missing` | `file` 필드에 파일이 없음 |
| 400 | `unexpected-field` | 파일을 `file`이 아닌 이름으로 보냄 |
| 400 | `too-many-files` | 파일을 2개 이상 보냄 |
| 400 | `bad-request` | 멀티파트를 읽지 못함(경계 없음 등) |
| 405 | (본문 없음) | POST가 아닌 요청. `Allow: POST` |
| 413 | `too-large` | 파일 10MB 초과 또는 요청이 너무 큼 |
| 415 | `not-multipart` | `multipart/form-data`가 아님 |
| 415 | `unsupported-type` | `.txt`·`.pdf`·`.docx`가 아님(확장자 없음 포함) |
| 415 | `legacy-doc` | 구형 `.doc` |
| 422 | `invalid-encoding` | TXT가 UTF-8이 아님 |
| 422 | `empty-text` | 빈 파일·공백뿐인 TXT, 글자 없는 DOCX |
| 422 | `corrupt-document` | 손상된 PDF·DOCX, 확장자와 실제 형식이 다름 |
| 422 | `encrypted-pdf` | 열기 암호가 걸린 PDF |
| 422 | `encrypted-docx` | 암호가 걸린 워드 문서(OLE 형식으로 저장됨) |
| 422 | `no-text-pdf` | 글자 정보가 없는 PDF(스캔·이미지). OCR 미지원 안내 |
| 422 | `text-too-long` | 꺼낸 글자가 20만 자 초과 |
| 422 | `too-complex` | 페이지 수·해석 시간·메모리 한도 초과 |
| 503 | `busy` | 동시 해석 한도. `Retry-After: 5`초 뒤 다시 시도 |

다 받지 못한 업로드에 오류로 답할 때는 `Connection: close`로 연결을 닫는다(남은 업로드를 더 읽지 않음).

## 4. 호출 예시

### curl

```sh
curl -F "file=@발표대본.pdf" http://localhost:3000/api/scripts/import
```

### 브라우저 (`FormData`)

```js
async function importScript(file) {
  const body = new FormData()
  body.append("file", file) // <input type="file">의 File 객체. Content-Type은 직접 넣지 않는다(경계가 자동으로 붙음)
  const res = await fetch("/api/scripts/import", { method: "POST", body })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(data?.message || "대본 파일을 읽지 못했어요."), { code: data?.error, status: res.status })
  return data // { fileName, text }
}
```

- 연결 실패·응답 지연(큰 PDF는 수 초)에 대비해 읽는 중 표시와 중복 요청 막기를 둔다. 필요하면 `AbortController`로 취소한다.
- `busy`(503)는 `Retry-After` 뒤 다시 시도하거나 사용자에게 잠시 뒤 다시 하라고 안내한다.
- 꺼낸 `text`는 사용자가 확인·수정한 뒤 대본으로 쓰게 한다(아래 한계 때문).

## 5. 추출 한계

- **PDF 글 순서**: PDF 안에 글이 그려진 순서대로 꺼낸다. 다단(2단) 편집, 글상자, 머리말·꼬리말, 각주, 표는 화면에서 읽는 순서와 다르게 섞이거나 칸이 한 줄로 이어질 수 있다.
- **PDF 줄·문단**: PDF에는 문단 정보가 없어서 줄 사이 간격이 글자 높이의 약 1.8배보다 넓으면 문단으로 본다. 줄 끝에서 나뉜 낱말·하이픈은 그대로 남는다. 페이지 사이는 빈 줄로 나눈다.
- **PDF 글자**: 글꼴에 유니코드 정보가 없거나 글자를 그림으로 넣은 PDF는 글자가 깨지거나 비어 나올 수 있다. 글자가 전혀 없으면 `no-text-pdf`.
- **암호**: 열기 암호가 없는(인쇄·복사 제한만 있는) PDF는 읽힌다. 열기 암호가 있으면 `encrypted-pdf`.
- **DOCX**: 본문 문단·줄바꿈·표 글자를 꺼낸다. 머리말·꼬리말·각주·메모·글상자 일부와 변경 추적 표시는 빠지거나 다르게 나올 수 있다.
- **TXT**: UTF-8만 지원한다.

## 6. 보안·개인정보·운영

- 파일은 메모리에서만 다루고 디스크·DB에 저장하지 않는다(임시 파일 없음). 외부 서비스·AI로 보내지 않는다.
- 파일 이름·내용을 서버 로그에 남기지 않는다. 문서 해석 라이브러리의 출력도 작업 스레드에서 받아 버린다.
- PDF·DOCX는 문서마다 새 작업 스레드(`worker_threads`)에서 메모리·시간 상한을 두고 해석하고, 끝나면 스레드를 종료한다.
- 구현: `server/script-import.js`(받기·검사·응답), `server/extract-worker.js`(PDF·DOCX 해석), `server.js`(라우트 연결). 라이브러리: `@fastify/busboy`(멀티파트), `pdfjs-dist`(PDF), `mammoth`(DOCX). 버전은 `package.json`·`package-lock.json`에 고정.
- 검사: `tests/script-import.test.mjs`(실제 포트로 멀티파트 요청), 가상 문서는 `tests/helpers/make-docs.mjs`가 코드로 만든다.
